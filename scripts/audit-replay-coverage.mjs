#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const defaultManifest = path.join(projectRoot, "evals", "replay-manifest.json");
const defaultOutput = path.join(projectRoot, "evals", "replay-coverage.json");

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function assertManifest(manifest) {
  if (manifest.status !== "frozen") {
    throw new Error("replay manifest is not frozen");
  }
  if (!Array.isArray(manifest.blockers) || manifest.blockers.length) {
    throw new Error("replay manifest has unresolved blockers");
  }
  if (!Array.isArray(manifest.cases)) {
    throw new Error("replay manifest cases are missing");
  }
  const ids = new Set();
  for (const item of manifest.cases) {
    if (!item.case_id || ids.has(item.case_id)) {
      throw new Error("replay manifest contains a missing or duplicate case id");
    }
    ids.add(item.case_id);
    if (
      item.privacy?.raw_transcript_copied !== false ||
      item.privacy?.hidden_reasoning_retained !== false ||
      item.privacy?.secret_scan !== "pass"
    ) {
      throw new Error("replay case privacy gate failed for " + item.case_id);
    }
  }
  const failures = manifest.cases.filter((item) => item.cohort === "failure");
  const successes = manifest.cases.filter((item) => item.cohort === "success");
  if (failures.length !== manifest.confirmed_failure_cases) {
    throw new Error("confirmed failure count does not match cases");
  }
  if (successes.length !== manifest.confirmed_success_cases) {
    throw new Error("confirmed success count does not match cases");
  }
  for (const required of manifest.required_categories ?? []) {
    if (!failures.some((item) => item.categories.includes(required))) {
      throw new Error("required category is uncovered: " + required);
    }
  }
  return { failures, successes };
}

export function buildCoverageReport(manifest) {
  const { failures, successes } = assertManifest(manifest);
  const categoryCounts = {};
  for (const category of manifest.required_categories) {
    categoryCounts[category] = failures.filter((item) =>
      item.categories.includes(category),
    ).length;
  }
  const installCase = failures.find(
    (item) =>
      item.categories.includes("forbidden_install_prepared") &&
      item.expected_intervention === "block",
  );
  if (!installCase) {
    throw new Error("no confirmed deterministic prohibited-install case");
  }
  return {
    schema_version: "1.0",
    generated_from: "evals/replay-manifest.json",
    manifest_status: manifest.status,
    frozen_at: manifest.frozen_at,
    inventory: {
      confirmed_failures: failures.length,
      confirmed_successes: successes.length,
      total_cases: manifest.cases.length,
      required_categories_covered: manifest.required_categories.length,
      required_category_counts: categoryCounts,
      expected_intervention_counts: countBy(
        manifest.cases.map((item) => item.expected_intervention),
      ),
    },
    runtime_mechanism_regressions: [
      {
        historical_case_id: installCase.case_id,
        mechanism: "PreToolUse deterministic action gate",
        structured_rule: "action:install_local",
        expected_decision: "block",
        regression_test: "test/runtime.test.mjs",
        source_simulation: "examples/events/pre-tool-install.json",
      },
    ],
    claim_boundary: {
      inventory_proves: [
        "The frozen corpus meets the 40 failure plus 40 success gate.",
        "Every required historical failure category has at least one confirmed case.",
        "The prohibited-install category is backed by a real source task and a focused mechanism regression.",
      ],
      inventory_does_not_prove: [
        "Historical replay accuracy for the shipped runtime.",
        "That an intervention changes the final user outcome.",
        "Production false-positive, false-block, rework, or acceptance rates.",
      ],
      next_evidence_required:
        "Isolated re-execution and shadow or controlled online comparison are required for efficacy claims.",
    },
  };
}

function parseArgs(values) {
  const options = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (next && !next.startsWith("--")) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.write && options.check) {
    throw new Error("choose either --write or --check");
  }
  const manifestPath = path.resolve(options.manifest || defaultManifest);
  const outputPath = path.resolve(options.output || defaultOutput);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const serialized = JSON.stringify(buildCoverageReport(manifest), null, 2) + "\n";
  if (options.write) {
    await writeFile(outputPath, serialized, "utf8");
    process.stdout.write("Wrote " + outputPath + "\n");
    return;
  }
  if (options.check) {
    const current = await readFile(outputPath, "utf8");
    if (current !== serialized) {
      throw new Error("replay coverage report is stale; run with --write");
    }
    process.stdout.write("Replay coverage report is current.\n");
    return;
  }
  process.stdout.write(serialized);
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  main().catch((error) => {
    process.stderr.write((error.stack ?? error.message) + "\n");
    process.exitCode = 1;
  });
}
