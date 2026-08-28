// SPDX-License-Identifier: Apache-2.0
import os from "node:os";
import path from "node:path";

const VALID_MODES = new Set(["off", "shadow", "balanced"]);

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

export function loadConfig(input, env = process.env) {
  const cwd = path.resolve(String(input.cwd || process.cwd()));
  const requestedMode = String(env.EFG_MODE || "shadow").toLowerCase();
  const codexHome = env.CODEX_HOME
    ? path.resolve(env.CODEX_HOME)
    : path.join(os.homedir(), ".codex");
  const stateRoot = env.EFG_STATE_DIR
    ? path.resolve(cwd, env.EFG_STATE_DIR)
    : path.join(codexHome, "plugin-data", "execution-fidelity-guard", "v1");
  return {
    mode: VALID_MODES.has(requestedMode) ? requestedMode : "shadow",
    stateRoot,
    persist: !["0", "false", "no"].includes(
      String(env.EFG_PERSIST ?? "true").toLowerCase(),
    ),
    maxStopContinuations: boundedInteger(
      env.EFG_MAX_STOP_CONTINUATIONS,
      2,
      0,
      2,
    ),
    maxRecordsPerBucket: boundedInteger(env.EFG_MAX_RECORDS, 1000, 50, 10000),
    retentionDays: boundedInteger(env.EFG_RETENTION_DAYS, 30, 1, 3650),
    deleteOnSessionEnd: ["1", "true", "yes"].includes(
      String(env.EFG_DELETE_ON_SESSION_END ?? "false").toLowerCase(),
    ),
  };
}
