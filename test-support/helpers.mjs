// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "../plugins/execution-fidelity-guard/src/canonical.mjs";

export const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const testStateRoot = path.join(projectRoot, ".runtime", "tests");

export function makeContract({
  forbidden = [],
  requiresUser = [],
  allowed = [],
  mustNot = [],
  completion = [{ requirement: "evidence:test", acceptable_sources: ["test"] }],
} = {}) {
  return {
    objective: "Ship a verified artifact without changing the requested outcome.",
    primary_object: "the requested project",
    delivery_surface: ["repository"],
    scope: { include: ["workspace"], exclude: [] },
    must_and_must_not: { must: ["preserve objective"], must_not: mustNot },
    authorization: {
      allowed,
      requires_user: requiresUser,
      forbidden,
    },
    completion_evidence: completion,
  };
}

export function makeBinding(contract = makeContract(), overrides = {}) {
  const snapshotHash = sha256(contract);
  return {
    status: "bound",
    provider: "task-contract-lite",
    contract,
    snapshotHash,
    envelope: {
      schema_version: "1.0",
      contract_ref: overrides.contractRef ?? "contract:test",
      contract_version: overrides.contractVersion ?? 1,
      source: "task-contract-lite",
      source_message_refs: [],
      snapshot_sha256: snapshotHash,
      task_contract_lite: contract,
      updated_at: "2026-08-28T00:00:00.000Z",
    },
  };
}

export async function temporaryState(t) {
  await mkdir(testStateRoot, { recursive: true });
  const directory = path.join(testStateRoot, "case-" + randomUUID());
  await mkdir(directory, { recursive: true });
  t.after(async () => {
    const resolved = path.resolve(directory);
    const base = path.resolve(testStateRoot) + path.sep;
    assert.ok(resolved.startsWith(base), "cleanup must stay under .runtime/tests");
    await rm(resolved, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  });
  return directory;
}

export function makeConfig(stateRoot, overrides = {}) {
  return {
    mode: "balanced",
    stateRoot,
    persist: true,
    maxStopContinuations: 2,
    maxRecordsPerBucket: 1000,
    retentionDays: 30,
    deleteOnSessionEnd: false,
    ...overrides,
  };
}

export function preToolInput(command, overrides = {}) {
  return {
    session_id: "session-test",
    cwd: projectRoot,
    hook_event_name: "PreToolUse",
    turn_id: "turn-test",
    tool_name: "Bash",
    tool_use_id: "tool-test",
    tool_input: { command },
    permission_mode: "default",
    ...overrides,
  };
}
