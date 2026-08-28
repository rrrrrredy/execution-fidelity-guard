import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { buildCoverageReport } from "../scripts/audit-replay-coverage.mjs";
import { projectRoot } from "../test-support/helpers.mjs";

test("public replay report preserves the evidence boundary", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(projectRoot, "evals", "replay-manifest.json"), "utf8"),
  );
  const report = buildCoverageReport(manifest);
  const publicManifest = JSON.stringify(manifest);
  assert.equal(report.inventory.confirmed_failures, 41);
  assert.equal(report.inventory.confirmed_successes, 40);
  assert.equal(report.inventory.total_cases, 81);
  assert.equal(report.inventory.required_categories_covered, 8);
  assert.equal(
    report.runtime_mechanism_regressions[0].historical_case_id,
    "efg-failure-041",
  );
  assert.match(
    report.claim_boundary.next_evidence_required,
    /Isolated re-execution/,
  );
  assert.equal(JSON.stringify(report).includes("rollout_relative_path"), false);
  assert.equal(JSON.stringify(report).includes("original_harm"), false);
  for (const privateField of [
    "thread_id",
    "rollout_relative_path",
    "captured_at",
    "original_harm",
    "task_type",
  ]) {
    assert.equal(publicManifest.includes('"' + privateField + '"'), false);
  }
  assert.ok(
    manifest.cases.every(
      (item) =>
        Object.keys(item.source).length === 1 &&
        typeof item.source.rollout_sha256 === "string",
    ),
  );
});
