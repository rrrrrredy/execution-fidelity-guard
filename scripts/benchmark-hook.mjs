#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const hookPath = path.join(
  projectRoot,
  "plugins",
  "execution-fidelity-guard",
  "src",
  "hook.mjs",
);

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

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

export function percentile(values, fraction) {
  if (!values.length) throw new Error("percentile requires at least one value");
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function runHook(event, contractPath) {
  const started = performance.now();
  const result = spawnSync(process.execPath, [hookPath], {
    cwd: projectRoot,
    input: JSON.stringify(event),
    encoding: "utf8",
    timeout: 3000,
    windowsHide: true,
    env: {
      ...process.env,
      EFG_MODE: "balanced",
      EFG_PERSIST: "false",
      EFG_CONTRACT_PATH: contractPath,
    },
  });
  const elapsed = performance.now() - started;
  if (result.error) throw result.error;
  if (result.status !== 0 || result.stderr.trim()) {
    throw new Error(
      "hook benchmark invocation failed: " +
        (result.stderr.trim() || "exit " + result.status),
    );
  }
  if (result.stdout.trim()) {
    throw new Error("continue-path Hook unexpectedly produced model-visible output");
  }
  return elapsed;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const iterations = boundedInteger(options.iterations, 30, 5, 200);
  const warmup = boundedInteger(options.warmup, 5, 0, 50);
  const eventPath = path.resolve(
    options.event ||
      path.join(projectRoot, "examples", "events", "pre-tool-read.json"),
  );
  const contractPath = path.resolve(
    options.contract ||
      path.join(projectRoot, "examples", "contracts", "no-local-install.json"),
  );
  const event = JSON.parse(await readFile(eventPath, "utf8"));
  event.cwd = projectRoot;

  for (let index = 0; index < warmup; index += 1) {
    runHook(event, contractPath);
  }
  const durations = [];
  for (let index = 0; index < iterations; index += 1) {
    durations.push(runHook(event, contractPath));
  }
  const report = {
    schema_version: "1.0",
    measured_at: new Date().toISOString(),
    path: "command_hook_process_continue",
    event: "PreToolUse",
    decision: "continue",
    persistence: false,
    iterations,
    warmup,
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpu_count: os.cpus().length,
    },
    latency_ms: {
      p50: round(percentile(durations, 0.5)),
      p95: round(percentile(durations, 0.95)),
      max: round(Math.max(...durations)),
    },
    claim_boundary:
      "One local machine and source checkout; not a cross-device service-level objective.",
  };
  const serialized = JSON.stringify(report, null, 2) + "\n";
  if (options.output) {
    await writeFile(path.resolve(String(options.output)), serialized, "utf8");
  }
  process.stdout.write(serialized);
  if (options["max-p95"]) {
    const maximum = Number(options["max-p95"]);
    if (!Number.isFinite(maximum) || report.latency_ms.p95 > maximum) {
      process.exitCode = 1;
    }
  }
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
