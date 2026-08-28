import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { projectRoot } from "../test-support/helpers.mjs";

test("release tree passes the dependency-free market package gate", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(projectRoot, "scripts", "validate-release.mjs")],
    { cwd: projectRoot, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.version, "0.1.0");
  assert.equal(report.runtime_dependencies, 0);
});
