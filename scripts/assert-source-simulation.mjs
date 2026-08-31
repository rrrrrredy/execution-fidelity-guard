#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const cli = path.join(
  projectRoot,
  "plugins",
  "execution-fidelity-guard",
  "bin",
  "efg.mjs",
);
const result = spawnSync(
  process.execPath,
  [
    cli,
    "check",
    "--mode",
    "balanced",
    "--event",
    "examples/events/pre-tool-install.json",
    "--contract",
    "examples/contracts/no-local-install.json",
  ],
  {
    cwd: projectRoot,
    encoding: "utf8",
    windowsHide: true,
  },
);
if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(
    (result.stderr || result.stdout || "source simulation failed").trim(),
  );
}
let output;
try {
  output = JSON.parse(result.stdout);
} catch {
  throw new Error("source simulation did not return JSON");
}
const decision = output?.hookSpecificOutput?.permissionDecision;
if (decision !== "deny") {
  throw new Error("prohibited-install simulation did not return deny");
}
process.stdout.write(
  JSON.stringify(
    {
      ok: true,
      hook_event: output.hookSpecificOutput.hookEventName,
      permission_decision: decision,
    },
    null,
    2,
  ) + "\n",
);
