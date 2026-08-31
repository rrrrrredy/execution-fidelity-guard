// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  summarizePilotBundles,
  summarizePilotDirectory,
} from "../scripts/summarize-shadow-pilot.mjs";

function bundle(sessionHex, options = {}) {
  const suffix = sessionHex.slice(0, 8);
  const reasons = options.reasons ?? ["no_material_conflict"];
  const isWouldBlock = reasons.includes("shadow_would_block");
  const isWouldAsk = reasons.includes("shadow_would_ask");
  const events = [
    {
      schema_version: "2.0",
      event_id: "evt_" + suffix,
      session_id: "session:" + sessionHex,
      event_type: options.eventType ?? "pre_tool_use",
      contract_ref: "fallback:test",
      contract_version: 1,
      coverage: options.eventCoverage ?? "observed",
      facts: {
        contract_status: options.contractStatus ?? "bound",
        ...(options.guardMode === null
          ? {}
          : { guard_mode: options.guardMode ?? "shadow" }),
      },
    },
  ];
  if (options.includeStop) {
    events.push({
      schema_version: "2.0",
      event_id: "evt_stop_" + suffix,
      session_id: "session:" + sessionHex,
      event_type: "stop",
      contract_ref: "fallback:test",
      contract_version: 1,
      coverage: "observed",
      facts: {
        contract_status: "bound",
        ...(options.guardMode === null
          ? {}
          : { guard_mode: options.guardMode ?? "shadow" }),
      },
    });
  }
  return {
    schema_version: "1.0",
    kind: "execution-fidelity-guard-session-receipts",
    session_ref: "session:" + sessionHex,
    session_present: true,
    exported_at: "2026-08-31T00:00:00.000Z",
    events,
    receipts: [
      {
        schema_version: "1.0",
        receipt_id: "rcpt_" + suffix,
        event_ref: "evt_" + suffix,
        contract_ref: "fallback:test",
        contract_version: 1,
        decision: options.decision ?? "continue",
        authority: options.authority ?? "deterministic_rule",
        severity:
          options.severity ?? (isWouldBlock ? "high" : isWouldAsk ? "medium" : "low"),
        visibility: options.visibility ?? (isWouldBlock || isWouldAsk ? "model" : "silent"),
        rule_ids: options.ruleIds ?? (isWouldBlock || isWouldAsk ? ["rule_test"] : []),
        coverage: options.coverage ?? "observed",
        reason_codes: reasons,
        latency_ms: options.latency ?? 3,
      },
    ],
    evidence: [],
    stop_state: null,
  };
}

test("shadow pilot summary deduplicates sessions and preserves the claim boundary", () => {
  const first = "1".repeat(64);
  const second = "2".repeat(64);
  const report = summarizePilotBundles(
    [
      { label: "one.json", sha256: "a".repeat(64), bundle: bundle(first) },
      {
        label: "two.json",
        sha256: "b".repeat(64),
        bundle: bundle(second, {
          includeStop: true,
          decision: "remind",
          reasons: ["shadow_would_block", "explicit_contract_conflict"],
          latency: 9,
        }),
      },
    ],
    { targetSessions: 100, now: "2026-08-31T00:00:00.000Z" },
  );

  assert.equal(report.sessions.unique, 2);
  assert.equal(report.schema_version, "1.1");
  assert.equal(report.sessions.in_shadow_mode, 2);
  assert.equal(report.sessions.with_pre_tool_use, 2);
  assert.equal(report.sessions.with_stop, 1);
  assert.equal(report.sessions.with_shadow_candidate, 1);
  assert.deepEqual(report.observations.decisions, { continue: 1, remind: 1 });
  assert.equal(report.observations.shadow_candidates.would_block, 1);
  assert.equal(report.observations.runtime_decision_latency_ms.p50, 3);
  assert.equal(report.observations.runtime_decision_latency_ms.p95, 9);
  assert.equal(report.sample_gate.reached, false);
  assert.equal(report.sample_gate.eligible_shadow_sessions, 2);
  assert.equal(report.sample_gate.remaining, 98);
  assert.match(report.claim_boundary.join(" "), /does not by itself prove/);
  assert.match(report.claim_boundary.join(" "), /does not establish precision/);
  assert.throws(
    () =>
      summarizePilotBundles(
        [{ label: "one.json", sha256: "a".repeat(64), bundle: bundle(first) }],
        { targetSessions: "100x" },
      ),
    /--target must be a positive integer/,
  );
});

test("shadow pilot gate excludes off, balanced, and legacy mode-unbound sessions", () => {
  const report = summarizePilotBundles(
    [
      {
        label: "shadow.json",
        sha256: "1".repeat(64),
        bundle: bundle("1".repeat(64), { guardMode: "shadow" }),
      },
      {
        label: "off.json",
        sha256: "2".repeat(64),
        bundle: bundle("2".repeat(64), { guardMode: "off" }),
      },
      {
        label: "balanced.json",
        sha256: "3".repeat(64),
        bundle: bundle("3".repeat(64), { guardMode: "balanced" }),
      },
      {
        label: "legacy.json",
        sha256: "4".repeat(64),
        bundle: bundle("4".repeat(64), { guardMode: null }),
      },
    ],
    { targetSessions: 2 },
  );

  assert.equal(report.sessions.unique, 4);
  assert.equal(report.sessions.in_shadow_mode, 1);
  assert.equal(report.sample_gate.eligible_shadow_sessions, 1);
  assert.equal(report.sample_gate.reached, false);
  assert.equal(report.sample_gate.remaining, 1);
  assert.match(report.claim_boundary.join(" "), /guard_mode=shadow/);
});

test("shadow pilot accepts a non-intervening shadow completion-gap receipt", () => {
  const value = bundle("5".repeat(64), { includeStop: true });
  value.receipts.push({
    ...value.receipts[0],
    receipt_id: "rcpt_shadow_stop",
    event_ref: value.events[1].event_id,
    decision: "remind",
    authority: "external_evidence",
    severity: "medium",
    visibility: "silent",
    reason_codes: [
      "shadow_would_continue_verification",
      "completion_claim_unverified",
    ],
  });
  const report = summarizePilotBundles([
    { label: "shadow-stop.json", sha256: "5".repeat(64), bundle: value },
  ]);
  assert.equal(report.sessions.in_shadow_mode, 1);
  assert.equal(report.observations.reasons.shadow_would_continue_verification, 1);
});

test("shadow pilot summary rejects duplicate sessions and receipts", () => {
  const session = "3".repeat(64);
  assert.throws(
    () =>
      summarizePilotBundles([
        { label: "one.json", sha256: "c".repeat(64), bundle: bundle(session) },
        { label: "two.json", sha256: "d".repeat(64), bundle: bundle(session) },
      ]),
    /duplicate session_ref/,
  );

  const first = bundle("4".repeat(64));
  const second = bundle("5".repeat(64));
  second.receipts[0].receipt_id = first.receipts[0].receipt_id;
  assert.throws(
    () =>
      summarizePilotBundles([
        { label: "one.json", sha256: "e".repeat(64), bundle: first },
        { label: "two.json", sha256: "f".repeat(64), bundle: second },
      ]),
    /duplicate receipt_id/,
  );

  const empty = bundle("7".repeat(64));
  empty.receipts = [];
  assert.throws(
    () =>
      summarizePilotBundles([
        { label: "empty.json", sha256: "7".repeat(64), bundle: empty },
      ]),
    /no observed events or decision receipts/,
  );

  const inflated = bundle("8".repeat(64));
  inflated.receipts.push({
    ...inflated.receipts[0],
    receipt_id: "rcpt_inflated",
  });
  assert.throws(
    () =>
      summarizePilotBundles([
        { label: "inflated.json", sha256: "8".repeat(64), bundle: inflated },
      ]),
    /duplicates a receipt event_ref/,
  );

  const sessionMismatch = bundle("9".repeat(64));
  sessionMismatch.events[0].session_id = "session:" + "a".repeat(64);
  assert.throws(
    () =>
      summarizePilotBundles([
        {
          label: "session-mismatch.json",
          sha256: "9".repeat(64),
          bundle: sessionMismatch,
        },
      ]),
    /does not match the bundle session_ref/,
  );

  const emptyReasons = bundle("c".repeat(64));
  emptyReasons.receipts[0].reason_codes = [];
  assert.throws(
    () =>
      summarizePilotBundles([
        {
          label: "empty-reasons.json",
          sha256: "c".repeat(64),
          bundle: emptyReasons,
        },
      ]),
    /invalid reason_codes/,
  );

  const privateReason = "launch_token_SK_LIVE_ABC123";
  const leakedReason = bundle("d".repeat(64));
  leakedReason.receipts[0].reason_codes = [
    "shadow_would_block",
    privateReason,
  ];
  assert.throws(
    () =>
      summarizePilotBundles([
        {
          label: "private-reason.json",
          sha256: "d".repeat(64),
          bundle: leakedReason,
        },
      ]),
    (error) => {
      assert.match(error.message, /unsupported reason_codes/);
      assert.equal(error.message.includes(privateReason), false);
      return true;
    },
  );

  const dualShadow = bundle("e".repeat(64), {
    decision: "remind",
    reasons: [
      "shadow_would_block",
      "explicit_contract_conflict",
      "shadow_would_ask",
      "explicit_user_authorization_required",
    ],
  });
  assert.throws(
    () =>
      summarizePilotBundles([
        { label: "dual-shadow.json", sha256: "e".repeat(64), bundle: dualShadow },
      ]),
    /invalid shadow candidate tuple/,
  );

  for (const [label, invalid] of [
    ["wrong-event", bundle("f".repeat(64), {
      eventType: "session_start",
      decision: "remind",
      reasons: ["shadow_would_block", "explicit_contract_conflict"],
    })],
    ["wrong-authority", bundle("1".repeat(64), {
      authority: "semantic_candidate",
      decision: "remind",
      reasons: ["shadow_would_block", "explicit_contract_conflict"],
    })],
    ["wrong-coverage", bundle("2".repeat(64), {
      coverage: "partial",
      decision: "remind",
      reasons: ["shadow_would_block", "explicit_contract_conflict"],
    })],
    ["missing-pair", bundle("3".repeat(64), {
      decision: "remind",
      reasons: ["shadow_would_block"],
    })],
  ]) {
    assert.throws(
      () =>
        summarizePilotBundles([
          { label: label + ".json", sha256: "0".repeat(64), bundle: invalid },
        ]),
      /invalid shadow candidate tuple/,
    );
  }

  const duplicateEventFirst = bundle("a".repeat(64));
  const duplicateEventSecond = bundle("b".repeat(64));
  duplicateEventSecond.events[0].event_id = duplicateEventFirst.events[0].event_id;
  duplicateEventSecond.receipts[0].event_ref = duplicateEventFirst.events[0].event_id;
  assert.throws(
    () =>
      summarizePilotBundles([
        {
          label: "event-one.json",
          sha256: "1".repeat(64),
          bundle: duplicateEventFirst,
        },
        {
          label: "event-two.json",
          sha256: "2".repeat(64),
          bundle: duplicateEventSecond,
        },
      ]),
    /duplicate event_id across receipt bundles/,
  );
});

test("shadow pilot directory hashes regular JSON bundles without exposing paths", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "efg-shadow-pilot-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    path.join(directory, "session.json"),
    JSON.stringify(bundle("6".repeat(64))) + "\n",
    "utf8",
  );
  const nonJsonPath = path.join(directory, "notes.txt");
  await writeFile(nonJsonPath, "not a receipt\n", "utf8");
  await assert.rejects(
    summarizePilotDirectory(directory, { targetSessions: 1 }),
    /non-JSON entry/,
  );
  await rm(nonJsonPath);

  const report = await summarizePilotDirectory(directory, {
    targetSessions: 1,
    now: "2026-08-31T00:00:00.000Z",
  });
  assert.equal(report.sample_gate.reached, true);
  assert.equal(report.input.bundle_sha256.length, 1);
  assert.match(report.input.bundle_sha256[0], /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(report).includes(directory), false);
  assert.equal(JSON.stringify(report).includes("session.json"), false);
});
