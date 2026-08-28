import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  buildForkBoundaries,
  indexRollout,
  readPrimarySessionMeta,
} from "../scripts/index-sessions.mjs";
import {
  evaluateInventory,
  readMessageEvents,
  selectDetection,
} from "../scripts/materialize-replay-manifest.mjs";
import {
  projectRoot,
  temporaryState,
} from "../test-support/helpers.mjs";

function line(row) {
  return JSON.stringify(row);
}

function meta(id, timestamp, extra = {}) {
  return {
    type: "session_meta",
    timestamp,
    payload: {
      id,
      timestamp,
      cwd: "/workspace",
      ...extra,
    },
  };
}

function message(role, text, ordinal, phase = null) {
  const payload = {
    type: "message",
    role,
    content: [
      {
        type: role === "user" ? "input_text" : "output_text",
        text,
      },
    ],
  };
  if (phase) payload.phase = phase;
  return {
    type: "response_item",
    ordinal,
    timestamp: "2026-01-01T00:00:00.000Z",
    payload,
  };
}

async function writeRollout(filePath, rows) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, rows.map(line).join("\n") + "\n", "utf8");
}

test("session creation time, not later mtime, controls the cutoff", async (t) => {
  const directory = await temporaryState(t);
  const filePath = path.join(directory, "rollout-created-before-cutoff.jsonl");
  await writeRollout(filePath, [
    meta("thread-created-before", "2026-01-01T00:00:00.000Z"),
    message("assistant", "Completed.", 1, "final_answer"),
  ]);
  const later = new Date("2026-09-01T00:00:00.000Z");
  await utimes(filePath, later, later);
  const record = await indexRollout(
    filePath,
    directory,
    new Date("2026-08-28T00:00:00.000Z"),
    null,
  );
  assert.equal(record.thread_id, "thread-created-before");
  assert.equal(record.session_created_at, "2026-01-01T00:00:00.000Z");
});

test("only the primary session_meta determines root eligibility", async (t) => {
  const directory = await temporaryState(t);
  const filePath = path.join(directory, "rollout-primary-meta.jsonl");
  await writeRollout(filePath, [
    meta("root-thread", "2026-01-01T00:00:00.000Z"),
    meta("copied-subagent", "2026-01-01T00:00:00.000Z", {
      parent_thread_id: "root-thread",
    }),
    message("assistant", "Completed.", 2, "final_answer"),
  ]);
  const primary = await readPrimarySessionMeta(filePath);
  const record = await indexRollout(filePath, directory, null, null);
  assert.equal(primary.payload.id, "root-thread");
  assert.equal(record.thread_id, "root-thread");
});

test("resolved user fork excludes copied parent history", async (t) => {
  const directory = await temporaryState(t);
  const parentPath = path.join(directory, "rollout-parent.jsonl");
  const forkPath = path.join(directory, "rollout-fork.jsonl");
  const parentRows = [
    meta("parent-thread", "2026-01-01T00:00:00.000Z"),
    message("assistant", "Parent completed.", 1, "final_answer"),
  ];
  await writeRollout(parentPath, parentRows);
  const parentTime = new Date("2026-01-02T00:00:00.000Z");
  await utimes(parentPath, parentTime, parentTime);
  const forkRows = [
    meta("fork-thread", "2026-01-03T00:00:00.000Z", {
      forked_from_id: "parent-thread",
    }),
    ...parentRows,
    message("user", "Continue with the new branch.", 3),
    message("assistant", "Fork completed.", 4, "final_answer"),
  ];
  await writeRollout(forkPath, forkRows);
  const inventory = await buildForkBoundaries(
    [parentPath, forkPath],
    [parentPath, forkPath],
  );
  const boundary = inventory.boundaries.get(forkPath);
  assert.equal(inventory.resolved, 1);
  assert.equal(boundary.copiedThroughOrdinal, parentRows.length);

  const record = await indexRollout(forkPath, directory, null, boundary);
  assert.equal(record.user_message_count, 1);
  assert.equal(record.assistant_final_count, 1);
  assert.equal(record.fork_history_copied_through_ordinal, parentRows.length);

  const events = await readMessageEvents(
    forkPath,
    record.fork_history_copied_through_ordinal,
  );
  const selected = selectDetection(
    {
      case_id: "efg-failure-001",
      detection: { strategy: "last_assistant_final" },
    },
    record,
    events,
  );
  assert.equal(selected.ordinal, 4);
});

test("fork is excluded when the parent changed after fork creation", async (t) => {
  const directory = await temporaryState(t);
  const parentPath = path.join(directory, "rollout-parent.jsonl");
  const forkPath = path.join(directory, "rollout-fork.jsonl");
  await writeRollout(parentPath, [
    meta("parent-thread", "2026-01-01T00:00:00.000Z"),
  ]);
  const changedAfterFork = new Date("2026-01-04T00:00:00.000Z");
  await utimes(parentPath, changedAfterFork, changedAfterFork);
  await writeRollout(forkPath, [
    meta("fork-thread", "2026-01-03T00:00:00.000Z", {
      forked_from_id: "parent-thread",
    }),
  ]);
  const inventory = await buildForkBoundaries(
    [parentPath, forkPath],
    [forkPath],
  );
  assert.equal(inventory.unresolved, 1);
  assert.equal(inventory.boundaries.get(forkPath).exclude, true);
});

test("inventory gate freezes only with 40 failures, 40 successes, and all categories", () => {
  const categories = [
    "recent_supplement_promoted",
    "tool_failure_changed_objective",
    "all_scope_narrowed",
    "forbidden_install_prepared",
    "local_task_became_harness",
    "attachment_only_delivery",
    "failed_state_claimed_complete",
    "reversible_exploration_blocked",
  ];
  const failures = Array.from({ length: 40 }, (_, index) => ({
    cohort: "failure",
    label_status: "confirmed",
    categories: [categories[index % categories.length]],
  }));
  const successes = Array.from({ length: 40 }, () => ({
    cohort: "success",
    label_status: "confirmed",
    categories: ["negative_control"],
  }));
  assert.equal(evaluateInventory([...failures, ...successes]).status, "frozen");
  const incomplete = evaluateInventory([...failures, ...successes.slice(1)]);
  assert.equal(incomplete.status, "inventory_in_progress");
  assert.ok(incomplete.blockers.some((item) => item.code === "success_count"));
});

test("materializer rejects a source rollout hash mismatch", async (t) => {
  const directory = await temporaryState(t);
  const sessionsRoot = path.join(directory, "sessions");
  const rolloutPath = path.join(sessionsRoot, "rollout-case.jsonl");
  await writeRollout(rolloutPath, [
    meta("thread-hash", "2026-01-01T00:00:00.000Z"),
    message("assistant", "Completed.", 1, "final_answer"),
  ]);
  const indexPath = path.join(directory, "index.jsonl");
  const decisionsPath = path.join(directory, "decisions.jsonl");
  const outputPath = path.join(directory, "manifest.json");
  await writeFile(
    indexPath,
    line({
      thread_id: "thread-hash",
      rollout_relative_path: "rollout-case.jsonl",
      rollout_sha256: "0".repeat(64),
      session_created_at: "2026-01-01T00:00:00.000Z",
      correction_signals: [],
      fork_history_copied_through_ordinal: null,
    }) + "\n",
    "utf8",
  );
  await writeFile(
    decisionsPath,
    line({
      case_id: "efg-failure-001",
      thread_id: "thread-hash",
      cohort: "failure",
      label_status: "confirmed",
      task_type: "test",
      severity: "major",
      categories: ["failed_state_claimed_complete"],
      detection: { strategy: "last_assistant_final" },
      adjudicator: "user",
      original_harm: "test",
      expected_intervention: "continue_verification",
      isolation_reexecution_required: true,
    }) + "\n",
    "utf8",
  );
  const script = path.join(projectRoot, "scripts", "materialize-replay-manifest.mjs");
  const result = spawnSync(
    process.execPath,
    [
      script,
      "--index",
      indexPath,
      "--decisions",
      decisionsPath,
      "--sessions-root",
      sessionsRoot,
      "--output",
      outputPath,
    ],
    { cwd: projectRoot, encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Rollout hash mismatch/);
});
