#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MAX_BUNDLES = 1000;
const MAX_BUNDLE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const SESSION_REFERENCE = /^session:[a-f0-9]{64}$/;
const DECISIONS = new Set([
  "continue",
  "remind",
  "ask",
  "block",
  "continue_verification",
]);
const COVERAGE = new Set(["observed", "partial", "unobserved"]);
const GUARD_MODES = new Set(["shadow", "balanced", "off"]);
const EVENT_TYPES = new Set([
  "session_start",
  "subagent_start",
  "user_prompt_submit",
  "pre_tool_use",
  "permission_request",
  "post_tool_use",
  "pre_compact",
  "post_compact",
  "subagent_stop",
  "stop",
  "session_end",
]);
const REASON_CODES = new Set([
  "no_material_conflict",
  "guard_disabled",
  "contract_unbound",
  "high_risk_action_uncovered",
  "shadow_would_block",
  "explicit_contract_conflict",
  "shadow_would_ask",
  "shadow_would_continue_verification",
  "explicit_user_authorization_required",
  "semantic_constraint_candidate",
  "no_deterministic_match",
  "explicit_contract_allowance",
  "event_observed",
  "completion_claim_unverified",
  "stop_state_unavailable",
  "required_evidence_missing",
  "continuation_cap_reached",
  "tool_result_failed",
  "completion_evidence_not_satisfied",
  "tool_result_recorded",
]);

function fail(message) {
  throw new Error(message);
}

function parseArgs(values) {
  const options = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--help" || value === "-h") {
      options.help = true;
      continue;
    }
    if (!value.startsWith("--")) fail("unexpected argument: " + value);
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) fail("--" + key + " requires a value");
    options[key] = next;
    index += 1;
  }
  return options;
}

function countBy(values, select) {
  const counts = new Map();
  for (const value of values) {
    const key = String(select(value) ?? "unknown");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries(counts);
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function round(value) {
  return value == null ? null : Math.round(value * 100) / 100;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sameStrings(actual, expected) {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function validateShadowCandidate(receipt, event, label) {
  const hasWouldBlock = receipt.reason_codes.includes("shadow_would_block");
  const hasWouldAsk = receipt.reason_codes.includes("shadow_would_ask");
  if (!hasWouldBlock && !hasWouldAsk) return;
  const expectedReasons = hasWouldBlock
    ? ["shadow_would_block", "explicit_contract_conflict"]
    : ["shadow_would_ask", "explicit_user_authorization_required"];
  const expectedSeverity = hasWouldBlock ? "high" : "medium";
  if (
    hasWouldBlock === hasWouldAsk ||
    !sameStrings(receipt.reason_codes, expectedReasons) ||
    !["pre_tool_use", "permission_request"].includes(event.event_type) ||
    event.coverage !== "observed" ||
    event.facts?.contract_status !== "bound" ||
    receipt.decision !== "remind" ||
    receipt.authority !== "deterministic_rule" ||
    receipt.severity !== expectedSeverity ||
    receipt.visibility !== "model" ||
    receipt.coverage !== "observed" ||
    !Array.isArray(receipt.rule_ids) ||
    receipt.rule_ids.length !== 1
  ) {
    fail(label + " has an invalid shadow candidate tuple");
  }
}

function validateBundle(bundle, sourceLabel) {
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    fail(sourceLabel + " is not a receipt bundle object");
  }
  if (
    bundle.schema_version !== "1.0" ||
    bundle.kind !== "execution-fidelity-guard-session-receipts"
  ) {
    fail(sourceLabel + " is not an Execution Fidelity Guard receipt export");
  }
  if (!SESSION_REFERENCE.test(String(bundle.session_ref ?? ""))) {
    fail(sourceLabel + " has an invalid pseudonymous session_ref");
  }
  if (bundle.session_present !== true) {
    fail(sourceLabel + " does not represent a retained session");
  }
  if (!Array.isArray(bundle.events) || !Array.isArray(bundle.receipts)) {
    fail(sourceLabel + " must contain events and receipts arrays");
  }
  if (bundle.events.length === 0 || bundle.receipts.length === 0) {
    fail(sourceLabel + " has no observed events or decision receipts");
  }
  const eventIds = new Set();
  const eventsById = new Map();
  const guardModes = new Set();
  for (const [index, event] of bundle.events.entries()) {
    const label = sourceLabel + " event #" + (index + 1);
    if (
      !event ||
      typeof event !== "object" ||
      Array.isArray(event) ||
      event.schema_version !== "2.0" ||
      typeof event.event_id !== "string" ||
      !event.event_id
    ) {
      fail(label + " is not a normalized schema 2.0 event");
    }
    if (eventIds.has(event.event_id)) fail(label + " duplicates an event_id");
    if (event.session_id !== bundle.session_ref) {
      fail(label + " does not match the bundle session_ref");
    }
    if (!EVENT_TYPES.has(event.event_type)) {
      fail(label + " has an unsupported event_type");
    }
    const guardMode = event.facts?.guard_mode;
    if (guardMode !== undefined && !GUARD_MODES.has(guardMode)) {
      fail(label + " has an unsupported guard_mode");
    }
    guardModes.add(guardMode ?? "unknown");
    if (
      typeof event.contract_ref !== "string" ||
      !event.contract_ref ||
      !Number.isInteger(event.contract_version) ||
      event.contract_version < 1
    ) {
      fail(label + " has an invalid contract identity");
    }
    eventIds.add(event.event_id);
    eventsById.set(event.event_id, event);
  }
  if (guardModes.size !== 1) {
    fail(sourceLabel + " mixes guard_mode values within one session");
  }
  const receiptEventRefs = new Set();
  for (const [index, receipt] of bundle.receipts.entries()) {
    const label = sourceLabel + " receipt #" + (index + 1);
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
      fail(label + " is invalid");
    }
    if (typeof receipt.receipt_id !== "string" || !receipt.receipt_id) {
      fail(label + " has no receipt_id");
    }
    const referencedEvent = eventsById.get(receipt.event_ref);
    if (!referencedEvent) {
      fail(label + " does not reference an event in the same bundle");
    }
    if (receiptEventRefs.has(receipt.event_ref)) {
      fail(label + " duplicates a receipt event_ref");
    }
    receiptEventRefs.add(receipt.event_ref);
    if (
      receipt.schema_version !== "1.0" ||
      receipt.contract_ref !== referencedEvent.contract_ref ||
      receipt.contract_version !== referencedEvent.contract_version
    ) {
      fail(label + " does not match its event contract identity");
    }
    if (!DECISIONS.has(receipt.decision)) {
      fail(label + " has an unsupported decision");
    }
    if (!COVERAGE.has(receipt.coverage)) {
      fail(label + " has unsupported coverage");
    }
    if (
      !Array.isArray(receipt.reason_codes) ||
      receipt.reason_codes.length === 0 ||
      !receipt.reason_codes.every((item) => typeof item === "string" && item) ||
      new Set(receipt.reason_codes).size !== receipt.reason_codes.length
    ) {
      fail(label + " has invalid reason_codes");
    }
    if (!receipt.reason_codes.every((item) => REASON_CODES.has(item))) {
      fail(label + " has unsupported reason_codes");
    }
    validateShadowCandidate(receipt, referencedEvent, label);
    if (
      typeof receipt.latency_ms !== "number" ||
      !Number.isFinite(receipt.latency_ms) ||
      receipt.latency_ms < 0
    ) {
      fail(label + " has invalid latency_ms");
    }
  }
  return { bundle, guardMode: [...guardModes][0] };
}

export function summarizePilotBundles(entries, options = {}) {
  const targetValue = String(options.targetSessions ?? 100);
  if (!/^[1-9][0-9]*$/.test(targetValue)) {
    fail("--target must be a positive integer");
  }
  const targetSessions = Number(targetValue);
  if (!Number.isSafeInteger(targetSessions)) {
    fail("--target must be a safe positive integer");
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    fail("at least one receipt bundle is required");
  }
  if (entries.length > MAX_BUNDLES) {
    fail("receipt bundle cohort exceeds the " + MAX_BUNDLES + " file limit");
  }

  const sessions = new Set();
  const eventIds = new Set();
  const receiptIds = new Set();
  const receiptEventRefs = new Set();
  const receipts = [];
  const events = [];
  const bundleHashes = [];
  const sessionsWithPreTool = new Set();
  const sessionsWithStop = new Set();
  const sessionsWithCandidate = new Set();
  const sessionsInShadowMode = new Set();

  for (const entry of entries) {
    if (!/^[a-f0-9]{64}$/.test(String(entry.sha256 ?? ""))) {
      fail(entry.label + " has an invalid bundle SHA-256");
    }
    const validated = validateBundle(entry.bundle, entry.label);
    const bundle = validated.bundle;
    if (sessions.has(bundle.session_ref)) {
      fail(
        "duplicate session_ref across receipt bundles: " +
          bundle.session_ref +
          ". Search the input JSON files for this session_ref and remove the duplicate export.",
      );
    }
    sessions.add(bundle.session_ref);
    if (validated.guardMode === "shadow") {
      sessionsInShadowMode.add(bundle.session_ref);
    }
    bundleHashes.push(entry.sha256);

    for (const event of bundle.events) {
      if (eventIds.has(event.event_id)) {
        fail("duplicate event_id across receipt bundles: " + event.event_id);
      }
      eventIds.add(event.event_id);
      events.push(event);
      if (event?.event_type === "pre_tool_use") {
        sessionsWithPreTool.add(bundle.session_ref);
      }
      if (event?.event_type === "stop") sessionsWithStop.add(bundle.session_ref);
    }
    for (const receipt of bundle.receipts) {
      if (receiptIds.has(receipt.receipt_id)) {
        fail("duplicate receipt_id across receipt bundles: " + receipt.receipt_id);
      }
      receiptIds.add(receipt.receipt_id);
      if (receiptEventRefs.has(receipt.event_ref)) {
        fail("duplicate receipt event_ref across receipt bundles: " + receipt.event_ref);
      }
      receiptEventRefs.add(receipt.event_ref);
      receipts.push(receipt);
      if (
        receipt.reason_codes.includes("shadow_would_block") ||
        receipt.reason_codes.includes("shadow_would_ask")
      ) {
        sessionsWithCandidate.add(bundle.session_ref);
      }
    }
  }

  bundleHashes.sort();
  const latencies = receipts.map((item) => item.latency_ms);
  const shadowWouldBlock = receipts.filter((item) =>
    item.reason_codes.includes("shadow_would_block"),
  ).length;
  const shadowWouldAsk = receipts.filter((item) =>
    item.reason_codes.includes("shadow_would_ask"),
  ).length;

  return {
    schema_version: "1.1",
    kind: "execution-fidelity-guard-shadow-pilot-summary",
    generated_at: new Date(options.now ?? Date.now()).toISOString(),
    input: {
      bundle_count: entries.length,
      bundle_sha256: bundleHashes,
      cohort_sha256: sha256(bundleHashes.join("\n")),
    },
    sessions: {
      unique: sessions.size,
      in_shadow_mode: sessionsInShadowMode.size,
      with_pre_tool_use: sessionsWithPreTool.size,
      with_stop: sessionsWithStop.size,
      with_shadow_candidate: sessionsWithCandidate.size,
    },
    sample_gate: {
      target_sessions: targetSessions,
      eligible_shadow_sessions: sessionsInShadowMode.size,
      reached: sessionsInShadowMode.size >= targetSessions,
      remaining: Math.max(0, targetSessions - sessionsInShadowMode.size),
    },
    observations: {
      events: events.length,
      receipts: receipts.length,
      decisions: countBy(receipts, (item) => item.decision),
      coverage: countBy(receipts, (item) => item.coverage),
      reasons: countBy(
        receipts.flatMap((item) => item.reason_codes),
        (item) => item,
      ),
      shadow_candidates: {
        would_block: shadowWouldBlock,
        would_ask: shadowWouldAsk,
      },
      runtime_decision_latency_ms: {
        p50: round(percentile(latencies, 0.5)),
        p95: round(percentile(latencies, 0.95)),
        max: round(latencies.length ? Math.max(...latencies) : null),
      },
    },
    claim_boundary: [
      "The report proves only what is present in the supplied pseudonymous receipt exports.",
      "A unique session receipt does not by itself prove that the session was a real user task or that tasks were independently sampled.",
      "Only sessions whose exported normalized events consistently record guard_mode=shadow count toward the sample gate; older or mode-unbound exports remain diagnostic only.",
      "Without user, external-evidence, or domain-rule adjudication, this report does not establish precision, false-positive rate, intervention efficacy, rework reduction, or outcome improvement.",
      "Receipt latency starts inside the loaded Guard runtime; use the command-Hook benchmark for end-to-end process latency.",
    ],
  };
}

export async function summarizePilotDirectory(inputDirectory, options = {}) {
  const root = path.resolve(inputDirectory);
  const outputPath = options.outputPath ? path.resolve(options.outputPath) : null;
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    fail("receipt bundle input must be a regular directory");
  }
  const names = (await readdir(root)).sort();
  const entries = [];
  let totalBytes = 0;
  for (const name of names) {
    const sourcePath = path.join(root, name);
    if (outputPath && path.resolve(sourcePath) === outputPath) continue;
    if (!name.endsWith(".json")) {
      fail("receipt bundle directory contains a non-JSON entry: " + name);
    }
    if (entries.length >= MAX_BUNDLES) {
      fail("receipt bundle directory exceeds the " + MAX_BUNDLES + " file limit");
    }
    const info = await lstat(sourcePath);
    if (info.isSymbolicLink() || !info.isFile()) {
      fail("receipt bundle input must be a regular file: " + name);
    }
    if (info.size > MAX_BUNDLE_BYTES) {
      fail("receipt bundle exceeds the 16 MiB limit: " + name);
    }
    const bytes = await readFile(sourcePath);
    if (bytes.byteLength > MAX_BUNDLE_BYTES) {
      fail("receipt bundle exceeds the 16 MiB limit after read: " + name);
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) {
      fail("receipt bundle cohort exceeds the 128 MiB total limit");
    }
    let bundle;
    try {
      bundle = JSON.parse(bytes.toString("utf8"));
    } catch {
      fail("receipt bundle is not valid JSON: " + name);
    }
    entries.push({ label: name, sha256: sha256(bytes), bundle });
  }
  return summarizePilotBundles(entries, options);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(
      "Usage: node scripts/summarize-shadow-pilot.mjs --input DIR [--output FILE] [--target 100]\n",
    );
    return;
  }
  if (!options.input) fail("--input DIR is required");
  const outputPath = options.output ? path.resolve(options.output) : null;
  const report = await summarizePilotDirectory(options.input, {
    outputPath,
    targetSessions: options.target ?? 100,
  });
  const serialized = JSON.stringify(report, null, 2) + "\n";
  if (!outputPath) {
    process.stdout.write(serialized);
    return;
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  try {
    await writeFile(outputPath, serialized, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    if (error?.code === "EEXIST") {
      fail("output already exists; choose a new path");
    }
    throw error;
  }
  process.stdout.write(
    JSON.stringify({ written: true, output: outputPath, sessions: report.sessions.unique }) +
      "\n",
  );
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  main().catch((error) => {
    process.stderr.write("shadow pilot summary: " + error.message + "\n");
    process.exitCode = 1;
  });
}
