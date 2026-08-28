#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";

const CATEGORY_ROUTES = [
  { id: "supplement_promoted_to_primary", matches: (record) => correctionCodes(record).has("objective_replaced") },
  {
    id: "tool_failure_replaced_goal",
    matches: (record) =>
      record.tool_failure_count > 0 &&
      intersects(correctionCodes(record), ["objective_replaced", "not_what_asked"]),
  },
  { id: "all_scope_narrowed", matches: (record) => correctionCodes(record).has("scope_narrowed") },
  { id: "forbidden_install_or_action", matches: (record) => correctionCodes(record).has("forbidden_action") },
  { id: "local_task_expanded_to_harness", matches: (record) => correctionCodes(record).has("over_governance") },
  { id: "attachment_only_delivery", matches: (record) => correctionCodes(record).has("attachment_only") },
  {
    id: "false_completion",
    matches: (record) =>
      correctionCodes(record).has("false_completion") ||
      (record.tool_failure_count > 0 && record.completion_claim_count > 0),
  },
  { id: "reversible_exploration_blocked", matches: (record) => correctionCodes(record).has("exploration_blocked") },
];

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

function messageText(payload) {
  return (payload?.content ?? [])
    .filter((item) => item?.type === "input_text" || item?.type === "output_text")
    .map((item) => item.text ?? "")
    .join("\n");
}

function isInternalContinuation(text) {
  return (
    text.includes("<codex_internal_context") ||
    text.includes("Continue working toward the active thread goal.") ||
    text.includes("Continuation behavior:")
  );
}

function isHostContext(text) {
  const trimmed = text.trimStart();
  return (
    trimmed.startsWith("<environment_context>") ||
    trimmed.startsWith("<subagent_notification>") ||
    trimmed.startsWith("<turn_aborted>") ||
    trimmed.startsWith("# AGENTS.md instructions") ||
    trimmed.startsWith("<recommended_plugins>") ||
    trimmed.startsWith("The following is the Codex agent history") ||
    (text.includes("<environment_context>") && text.includes("# Workspace Placement"))
  );
}

function correctionCodes(record) {
  return new Set(record.correction_signals.flatMap((signal) => signal.codes));
}

function intersects(values, candidates) {
  return candidates.some((candidate) => values.has(candidate));
}

function chooseMoreComplete(left, right) {
  const leftRank = [left.turn_count, left.file_bytes, left.last_modified_at];
  const rightRank = [right.turn_count, right.file_bytes, right.last_modified_at];
  for (let index = 0; index < leftRank.length; index += 1) {
    if (leftRank[index] !== rightRank[index]) return leftRank[index] > rightRank[index] ? left : right;
  }
  return left;
}

function deduplicate(records) {
  const byThread = new Map();
  for (const record of records) {
    const key = record.thread_id ?? record.rollout_sha256;
    const previous = byThread.get(key);
    byThread.set(key, previous ? chooseMoreComplete(previous, record) : record);
  }
  return [...byThread.values()];
}

function failureNoise(record) {
  return (
    record.correction_signals.length * 10 +
    correctionCodes(record).size * 3 +
    Math.min(record.file_bytes / 1_000_000, 50)
  );
}

function selectFailures(records, perCategory) {
  const selected = new Map();
  for (const route of CATEGORY_ROUTES) {
    const candidates = records
      .filter((record) => record.candidate_label === "failure_candidate")
      .filter(route.matches)
      .sort((left, right) => failureNoise(left) - failureNoise(right))
      .slice(0, perCategory);
    for (const record of candidates) {
      const key = record.thread_id ?? record.rollout_sha256;
      const current = selected.get(key) ?? { record, suggested_categories: [] };
      current.suggested_categories.push(route.id);
      selected.set(key, current);
    }
  }
  for (const record of records
    .filter((candidate) => candidate.candidate_label === "failure_candidate")
    .sort((left, right) => failureNoise(left) - failureNoise(right))) {
    const key = record.thread_id ?? record.rollout_sha256;
    if (!selected.has(key)) {
      selected.set(key, {
        record,
        suggested_categories: ["manual_failure_discovery"],
      });
    }
  }
  return [...selected.values()];
}

function selectSuccesses(records, limit) {
  return records
    .filter((record) => record.candidate_label.startsWith("success_candidate"))
    .sort((left, right) => {
      const strong =
        Number(right.candidate_label === "success_candidate") -
        Number(left.candidate_label === "success_candidate");
      if (strong !== 0) return strong;
      const failureDifference = left.tool_failure_count - right.tool_failure_count;
      return failureDifference !== 0
        ? failureDifference
        : right.success_score - left.success_score;
    })
    .slice(0, limit)
    .map((record) => ({ record, suggested_categories: [] }));
}

function selectDiscoveries(records, limit) {
  return records
    .filter((record) => record.candidate_label === "unclassified")
    .filter((record) => record.assistant_final_count > 0)
    .sort((left, right) => {
      const followupDifference = right.user_message_count - left.user_message_count;
      if (followupDifference !== 0) return followupDifference;
      const failureDifference = right.tool_failure_count - left.tool_failure_count;
      if (failureDifference !== 0) return failureDifference;
      return right.turn_count - left.turn_count;
    })
    .slice(0, limit)
    .map((record) => ({
      record,
      suggested_categories: ["manual_failure_discovery"],
    }));
}

function redact(text) {
  return text
    .replace(/\b(?:sk|ghp|github_pat|hf)_[A-Za-z0-9_-]{12,}\b/gu, "[REDACTED_TOKEN]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/giu, "Bearer [REDACTED_TOKEN]")
    .replace(/\b(password|passwd|api[_-]?key|access[_-]?token)\s*[:=]\s*[^\s,;]+/giu, "$1=[REDACTED]");
}

function excerpt(text, maxChars) {
  const safe = redact(text);
  return safe.length <= maxChars
    ? { text_excerpt: safe, truncated: false }
    : { text_excerpt: safe.slice(0, maxChars) + "\n[TRUNCATED]", truncated: true };
}

async function readMessages(path) {
  const messages = [];
  const stream = createReadStream(path);
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let sourceLineOrdinal = -1;
  for await (const line of lines) {
    sourceLineOrdinal += 1;
    if (!line.includes('"type":"response_item"') || !line.includes('"payload":{"type":"message"')) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = row.payload;
    const text = messageText(payload);
    const isUser =
      payload?.role === "user" &&
      !isInternalContinuation(text) &&
      !isHostContext(text);
    const isFinal = payload?.role === "assistant" && payload?.phase === "final_answer";
    if (!isUser && !isFinal) continue;
    messages.push({
      ordinal: row.ordinal ?? sourceLineOrdinal,
      timestamp: row.timestamp ?? null,
      role: payload.role,
      phase: payload.phase ?? null,
      message_sha256: sha256(text),
      text,
    });
  }
  return messages;
}

function relevantFailureMessages(messages, record) {
  const wanted = new Set(record.correction_signals.slice(0, 4).map((signal) => signal.message_sha256));
  const selected = new Set();
  const firstUser = messages.findIndex((message) => message.role === "user");
  if (firstUser >= 0) selected.add(firstUser);
  for (let index = 0; index < messages.length; index += 1) {
    if (!wanted.has(messages[index].message_sha256)) continue;
    selected.add(index);
    for (let previous = index - 1; previous >= 0; previous -= 1) {
      if (messages[previous].role === "assistant") {
        selected.add(previous);
        break;
      }
    }
    for (let next = index + 1; next < messages.length; next += 1) {
      if (messages[next].role === "assistant") {
        selected.add(next);
        break;
      }
    }
  }
  return [...selected].sort((left, right) => left - right).map((index) => messages[index]);
}

function relevantSuccessMessages(messages, record) {
  const selected = new Set();
  const firstUser = messages.findIndex((message) => message.role === "user");
  if (firstUser >= 0) selected.add(firstUser);
  const lastFinal = messages.findLastIndex((message) => message.role === "assistant");
  if (lastFinal >= 0) selected.add(lastFinal);
  const acceptanceHashes = new Set(record.acceptance_signals.map((signal) => signal.message_sha256));
  messages.forEach((message, index) => {
    if (acceptanceHashes.has(message.message_sha256)) selected.add(index);
  });
  return [...selected].sort((left, right) => left - right).map((index) => messages[index]);
}

function relevantDiscoveryMessages(messages) {
  const selected = new Set();
  const firstUser = messages.findIndex((message) => message.role === "user");
  const lastUser = messages.findLastIndex((message) => message.role === "user");
  const lastFinal = messages.findLastIndex((message) => message.role === "assistant");
  if (firstUser >= 0) selected.add(firstUser);
  if (lastUser >= 0) {
    selected.add(lastUser);
    for (let previous = lastUser - 1; previous >= 0; previous -= 1) {
      if (messages[previous].role === "assistant") {
        selected.add(previous);
        break;
      }
    }
    for (let next = lastUser + 1; next < messages.length; next += 1) {
      if (messages[next].role === "assistant") {
        selected.add(next);
        break;
      }
    }
  }
  if (lastFinal >= 0) selected.add(lastFinal);
  return [...selected].sort((left, right) => left - right).map((index) => messages[index]);
}

async function materialize(item, kind, sessionsRoot, maxChars) {
  const record = item.record;
  const path = resolve(sessionsRoot, record.rollout_relative_path);
  const messages = await readMessages(path);
  const relevant =
    kind === "failure"
      ? relevantFailureMessages(messages, record)
      : kind === "success"
        ? relevantSuccessMessages(messages, record)
        : relevantDiscoveryMessages(messages);
  return {
    review_schema_version: "1.0",
    review_status: "unreviewed",
    candidate_kind: kind,
    suggested_categories: [...new Set(item.suggested_categories)],
    source: {
      thread_id: record.thread_id,
      rollout_relative_path: record.rollout_relative_path,
      rollout_sha256: record.rollout_sha256,
      session_created_at: record.session_created_at,
    },
    routing_signals: {
      correction_codes: [...correctionCodes(record)].sort(),
      correction_count: record.correction_signals.length,
      acceptance_count: record.acceptance_signals.length,
      tool_failure_count: record.tool_failure_count,
      completion_claim_count: record.completion_claim_count,
      failure_score: record.failure_score,
      success_score: record.success_score,
      candidate_label: record.candidate_label,
    },
    excerpts: relevant.map((message) => ({
      ordinal: message.ordinal,
      timestamp: message.timestamp,
      role: message.role,
      phase: message.phase,
      message_sha256: message.message_sha256,
      ...excerpt(message.text, maxChars),
    })),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.index || !args["sessions-root"] || !args.output) {
    throw new Error(
      "Usage: build-private-review-queue.mjs --index <index.jsonl> --sessions-root <root> --output <private.jsonl> [--per-category <n>] [--success-limit <n>] [--max-chars <n>]",
    );
  }
  const indexPath = resolve(args.index);
  const sessionsRoot = resolve(args["sessions-root"]);
  const output = resolve(args.output);
  const perCategory = Number.parseInt(args["per-category"] ?? "20", 10);
  const successLimit = Number.parseInt(args["success-limit"] ?? "120", 10);
  const discoveryLimit = Number.parseInt(args["discovery-limit"] ?? "100", 10);
  const maxChars = Number.parseInt(args["max-chars"] ?? "2500", 10);
  const raw = await readFile(indexPath, "utf8");
  const records = deduplicate(
    raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line)),
  );
  const failures = selectFailures(records, perCategory);
  const successes = selectSuccesses(records, successLimit);
  const discoveries = selectDiscoveries(records, discoveryLimit);
  const materialized = [];
  for (const item of failures) materialized.push(await materialize(item, "failure", sessionsRoot, maxChars));
  for (const item of successes) materialized.push(await materialize(item, "success", sessionsRoot, maxChars));
  for (const item of discoveries) materialized.push(await materialize(item, "discovery", sessionsRoot, maxChars));
  await mkdir(dirname(output), { recursive: true });
  const body = materialized.map((record) => JSON.stringify(record)).join("\n");
  await writeFile(output, body ? body + "\n" : "", "utf8");
  const categoryCounts = Object.fromEntries(
    CATEGORY_ROUTES.map((route) => [
      route.id,
      failures.filter((item) => item.suggested_categories.includes(route.id)).length,
    ]),
  );
  process.stdout.write(
    JSON.stringify(
      {
        deduplicated_sessions: records.length,
        failure_candidates: failures.length,
        success_candidates: successes.length,
        discovery_candidates: discoveries.length,
        category_counts: categoryCounts,
        output,
      },
      null,
      2,
    ) + "\n",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
