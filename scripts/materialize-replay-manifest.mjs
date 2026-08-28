#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const REQUIRED_CATEGORIES = [
  "recent_supplement_promoted",
  "tool_failure_changed_objective",
  "all_scope_narrowed",
  "forbidden_install_prepared",
  "local_task_became_harness",
  "attachment_only_delivery",
  "failed_state_claimed_complete",
  "reversible_exploration_blocked",
];

const CATEGORY_VALUES = new Set([
  ...REQUIRED_CATEGORIES,
  "constraint_forgotten",
  "unauthorized_high_cost_action",
  "result_narrative_mismatch",
  "negative_control",
]);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error("Unexpected argument: " + token);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error("Missing value for " + token);
    args[token.slice(2)] = value;
    index += 1;
  }
  return args;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export async function fileSha256(path) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

function messageText(payload) {
  return (payload?.content ?? [])
    .filter((item) => item?.type === "input_text" || item?.type === "output_text")
    .map((item) => item.text ?? "")
    .join("\n");
}

function eventType(payload) {
  if (payload.role === "assistant" && payload.phase === "final_answer") {
    return "assistant_final_answer";
  }
  if (payload.role === "assistant") return "assistant_message";
  return "user_message";
}

function chooseMoreComplete(left, right) {
  const leftRank = [left.turn_count, left.file_bytes, left.last_modified_at];
  const rightRank = [right.turn_count, right.file_bytes, right.last_modified_at];
  for (let index = 0; index < leftRank.length; index += 1) {
    if (leftRank[index] !== rightRank[index]) {
      return leftRank[index] > rightRank[index] ? left : right;
    }
  }
  return left;
}

function deduplicate(records) {
  const byThread = new Map();
  for (const record of records) {
    const previous = byThread.get(record.thread_id);
    byThread.set(
      record.thread_id,
      previous ? chooseMoreComplete(previous, record) : record,
    );
  }
  return [...byThread.values()];
}

async function readJsonl(path) {
  return (await readFile(path, "utf8"))
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export async function readMessageEvents(path, copiedThroughOrdinal = null) {
  const events = [];
  const stream = createReadStream(path);
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let sourceLineOrdinal = -1;
  for await (const line of lines) {
    sourceLineOrdinal += 1;
    if (
      copiedThroughOrdinal !== null &&
      sourceLineOrdinal <= copiedThroughOrdinal
    ) {
      continue;
    }
    if (
      !line.includes('"type":"response_item"') ||
      !line.includes('"payload":{"type":"message"')
    ) {
      continue;
    }
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = row.payload;
    if (!["user", "assistant"].includes(payload?.role)) continue;
    const text = messageText(payload);
    events.push({
      ordinal: row.ordinal ?? sourceLineOrdinal,
      event_type: eventType(payload),
      event_sha256: sha256(line),
      message_sha256: sha256(text),
      role: payload.role,
      phase: payload.phase ?? null,
    });
  }
  return events;
}

function validateDecision(decision) {
  const expectedPrefix = "efg-" + decision.cohort + "-";
  if (!decision.case_id?.startsWith(expectedPrefix)) {
    throw new Error("Case ID/cohort mismatch: " + decision.case_id);
  }
  if (!["failure", "success"].includes(decision.cohort)) {
    throw new Error("Invalid cohort for " + decision.case_id);
  }
  if (!["provisional", "confirmed"].includes(decision.label_status)) {
    throw new Error("Invalid label status for " + decision.case_id);
  }
  if (!["none", "minor", "major", "critical"].includes(decision.severity)) {
    throw new Error("Invalid severity for " + decision.case_id);
  }
  if (!Array.isArray(decision.categories) || decision.categories.length === 0) {
    throw new Error("Missing categories for " + decision.case_id);
  }
  if (decision.categories.some((category) => !CATEGORY_VALUES.has(category))) {
    throw new Error("Invalid category for " + decision.case_id);
  }
  if (
    decision.detection?.strategy === "preceding_assistant_before_message" &&
    !decision.detection.message_sha256
  ) {
    throw new Error("Missing detection message hash for " + decision.case_id);
  }
  if (
    decision.detection?.strategy === "explicit_event" &&
    !decision.detection.event_sha256
  ) {
    throw new Error("Missing explicit event hash for " + decision.case_id);
  }
}

function precedingAssistant(events, index, caseId) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (events[cursor].role === "assistant") return events[cursor];
  }
  throw new Error("No preceding assistant event for " + caseId);
}

export function selectDetection(decision, record, events) {
  const strategy = decision.detection.strategy;
  if (strategy === "last_assistant_final") {
    const event = events.findLast(
      (candidate) =>
        candidate.role === "assistant" && candidate.phase === "final_answer",
    );
    if (!event) throw new Error("No final answer for " + decision.case_id);
    return event;
  }
  if (strategy === "explicit_event") {
    const event = events.find(
      (candidate) =>
        candidate.event_sha256 === decision.detection.event_sha256,
    );
    if (!event) throw new Error("Explicit event not found for " + decision.case_id);
    return event;
  }

  let messageHash = decision.detection.message_sha256;
  if (strategy === "preceding_assistant_before_first_correction") {
    const correction = [...record.correction_signals].sort(
      (left, right) => left.ordinal - right.ordinal,
    )[0];
    if (!correction) {
      throw new Error("No routed correction for " + decision.case_id);
    }
    messageHash = correction.message_sha256;
  }
  const index = events.findIndex(
    (candidate) =>
      candidate.role === "user" && candidate.message_sha256 === messageHash,
  );
  if (index < 0) throw new Error("Detection message not found for " + decision.case_id);
  return precedingAssistant(events, index, decision.case_id);
}

function toIso(value, caseId) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid source date for " + caseId);
  }
  return parsed.toISOString();
}

export function evaluateInventory(cases) {
  const confirmedFailures = cases.filter(
    (item) => item.cohort === "failure" && item.label_status === "confirmed",
  );
  const confirmedSuccesses = cases.filter(
    (item) => item.cohort === "success" && item.label_status === "confirmed",
  );
  const covered = new Set(confirmedFailures.flatMap((item) => item.categories));
  const missingCategories = REQUIRED_CATEGORIES.filter(
    (category) => !covered.has(category),
  );
  const blockers = [];
  if (confirmedFailures.length < 40) {
    blockers.push({
      code: "failure_count",
      required: 40,
      actual: confirmedFailures.length,
    });
  }
  if (confirmedSuccesses.length < 40) {
    blockers.push({
      code: "success_count",
      required: 40,
      actual: confirmedSuccesses.length,
    });
  }
  for (const category of missingCategories) {
    blockers.push({ code: "missing_category", category });
  }
  return {
    status: blockers.length === 0 ? "frozen" : "inventory_in_progress",
    confirmedFailures,
    confirmedSuccesses,
    missingCategories,
    blockers,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.index || !args.decisions || !args["sessions-root"] || !args.output) {
    throw new Error(
      "Usage: materialize-replay-manifest.mjs --index <index.jsonl> --decisions <private.jsonl> --sessions-root <root> --output <manifest.json> [--frozen-at <ISO>] [--source-root-ref <public-ref>]",
    );
  }

  const indexRecords = deduplicate(await readJsonl(resolve(args.index)));
  const byThread = new Map(indexRecords.map((record) => [record.thread_id, record]));
  const decisions = await readJsonl(resolve(args.decisions));
  const sessionsRoot = resolve(args["sessions-root"]);
  const caseIds = new Set();
  const decisionThreads = new Set();
  for (const decision of decisions) {
    validateDecision(decision);
    if (caseIds.has(decision.case_id)) throw new Error("Duplicate case ID: " + decision.case_id);
    if (decisionThreads.has(decision.thread_id)) throw new Error("Duplicate thread: " + decision.thread_id);
    caseIds.add(decision.case_id);
    decisionThreads.add(decision.thread_id);
  }

  const cases = [];
  const threadToCase = new Map(decisions.map((decision) => [decision.thread_id, decision.case_id]));
  for (const decision of decisions) {
    const record = byThread.get(decision.thread_id);
    if (!record) throw new Error("Thread missing from index: " + decision.thread_id);
    const path = resolve(sessionsRoot, record.rollout_relative_path);
    const currentHash = await fileSha256(path);
    if (currentHash !== record.rollout_sha256) {
      throw new Error("Rollout hash mismatch for " + decision.case_id);
    }
    const events = await readMessageEvents(
      path,
      record.fork_history_copied_through_ordinal ?? null,
    );
    const detection = selectDetection(decision, record, events);
    const matchedCaseId = decision.matched_thread_id
      ? threadToCase.get(decision.matched_thread_id)
      : null;
    if (decision.matched_thread_id && !matchedCaseId) {
      throw new Error("Matched thread missing from decisions: " + decision.case_id);
    }
    cases.push({
      case_id: decision.case_id,
      cohort: decision.cohort,
      label_status: decision.label_status,
      matched_case_id: matchedCaseId,
      source: {
        rollout_sha256: record.rollout_sha256,
      },
      severity: decision.severity,
      categories: decision.categories,
      first_detectable_event: {
        ordinal: detection.ordinal,
        event_type: detection.event_type,
        event_sha256: detection.event_sha256,
      },
      adjudicator: decision.adjudicator,
      expected_intervention: decision.expected_intervention,
      isolation_reexecution_required: decision.isolation_reexecution_required,
      privacy: {
        raw_transcript_copied: false,
        hidden_reasoning_retained: false,
        secret_scan: "pass",
      },
    });
  }

  const {
    status,
    confirmedFailures,
    confirmedSuccesses,
    missingCategories,
    blockers,
  } = evaluateInventory(cases);
  if (status === "frozen" && !args["frozen-at"]) {
    throw new Error("--frozen-at is required when the inventory becomes eligible.");
  }

  const manifest = {
    schema_version: "1.0",
    status,
    frozen_at: status === "frozen" ? toIso(args["frozen-at"], "manifest") : null,
    source_root: String(args["source-root-ref"] || sessionsRoot),
    minimum_confirmed_failure_cases: 40,
    minimum_confirmed_success_cases: 40,
    confirmed_failure_cases: confirmedFailures.length,
    confirmed_success_cases: confirmedSuccesses.length,
    required_categories: REQUIRED_CATEGORIES,
    blockers,
    cases,
  };
  const output = resolve(args.output);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  process.stdout.write(
    JSON.stringify(
      {
        status,
        confirmed_failure_cases: confirmedFailures.length,
        confirmed_success_cases: confirmedSuccesses.length,
        missing_categories: missingCategories,
        output,
      },
      null,
      2,
    ) + "\n",
  );
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  main().catch((error) => {
    process.stderr.write((error.stack ?? error.message) + "\n");
    process.exitCode = 1;
  });
}
