#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { access, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  identifierReference,
  makeId,
  redactText,
  sessionReference,
  sha256,
} from "../src/canonical.mjs";
import { classifyToolAction } from "../src/classify.mjs";
import { loadConfig } from "../src/config.mjs";
import {
  loadContract,
  parseContractDocument,
  resolveContractPath,
  validateTaskContractLite,
} from "../src/contract.mjs";
import {
  assessCompletionEvidence,
  evidenceRequirementRef,
} from "../src/evidence.mjs";
import { decidePreTool } from "../src/policy.mjs";
import { handleHook } from "../src/runtime.mjs";
import {
  deleteSession,
  readRecords,
  readStopState,
  sessionExists,
  writeRecord,
} from "../src/store.mjs";

const pluginRoot = fileURLToPath(new URL("..", import.meta.url));
const evidenceKinds = new Set([
  "file",
  "command",
  "test",
  "api",
  "database",
  "real_page",
  "release",
  "user",
]);
const SESSION_REFERENCE = /^session:[a-f0-9]{64}$/;
const TURN_REFERENCE = /^turn:[a-f0-9]{64}$/;
const TOOL_USE_REFERENCE = /^tool-use:[a-f0-9]{64}$/;
const MAXIMUM_ARTIFACT_BYTES = 64 * 1024 * 1024;
const BOOLEAN_OPTIONS = new Set(["help", "json", "yes"]);

function parseArguments(values) {
  const options = {};
  const positional = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    if (value === "--") {
      positional.push(...values.slice(index + 1));
      break;
    }
    const raw = value.slice(2);
    const separator = raw.indexOf("=");
    const key = separator >= 0 ? raw.slice(0, separator) : raw;
    if (!key) throw new Error("invalid empty option");
    if (separator >= 0) {
      const inline = raw.slice(separator + 1);
      if (BOOLEAN_OPTIONS.has(key)) {
        throw new Error("--" + key + " does not accept a value");
      }
      if (!inline) throw new Error("--" + key + " requires a value");
      options[key] = inline;
      continue;
    }
    if (BOOLEAN_OPTIONS.has(key)) {
      options[key] = true;
      continue;
    }
    const next = values[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      options[key] = next;
      index += 1;
    } else {
      throw new Error("--" + key + " requires a value");
    }
  }
  return { options, positional };
}

function taskEnvironment(options) {
  const env = { ...process.env };
  if (options.contract) {
    env.EFG_CONTRACT_PATH = path.resolve(String(options.contract));
  }
  if (options.mode) env.EFG_MODE = String(options.mode);
  if (options["state-dir"]) env.EFG_STATE_DIR = String(options["state-dir"]);
  return env;
}

function inputContext(options, hookEventName = "SessionStart") {
  return {
    session_id: String(options.session || "cli"),
    cwd: path.resolve(String(options.cwd || process.cwd())),
    hook_event_name: hookEventName,
    source: "startup",
  };
}

async function readJson(filePath, maximum = 1024 * 1024) {
  const buffer = await readFile(filePath);
  if (buffer.length > maximum) throw new Error("JSON input exceeds the safety limit");
  return JSON.parse(buffer.toString("utf8"));
}

function templateContract(options = {}) {
  if (options.preset === "no-local-install") {
    if (!options.objective || !String(options.objective).trim()) {
      throw new Error(
        "the no-local-install preset requires --objective TEXT",
      );
    }
    if (!options["primary-object"] || !String(options["primary-object"]).trim()) {
      throw new Error(
        "the no-local-install preset requires --primary-object TEXT",
      );
    }
    return {
      objective: String(options.objective).trim(),
      primary_object: String(options["primary-object"]).trim(),
      delivery_surface: [
        String(options["delivery-surface"] || "repository").trim(),
      ],
      scope: {
        include: ["workspace"],
        exclude: ["local plugin installation"],
      },
      must_and_must_not: {
        must: ["Preserve the requested outcome and validate the deliverable."],
        must_not: ["Install or enable the product in the local Host."],
      },
      authorization: {
        allowed: ["action:read", "action:write"],
        requires_user: [],
        forbidden: ["action:install_local"],
      },
      completion_evidence: [
        {
          requirement: "evidence:test",
          acceptable_sources: ["test"],
        },
      ],
    };
  }
  if (options.preset) {
    throw new Error("unknown init preset: " + options.preset);
  }
  return {
    objective: "Replace with the exact user-requested outcome.",
    primary_object: "Replace with the primary object being changed or delivered.",
    delivery_surface: ["repository"],
    scope: {
      include: ["workspace"],
      exclude: [],
    },
    must_and_must_not: {
      must: ["Replace with non-negotiable requirements."],
      must_not: [],
    },
    authorization: {
      allowed: [],
      requires_user: [],
      forbidden: [],
    },
    completion_evidence: [
      {
        requirement: "evidence:test",
        acceptable_sources: ["test"],
      },
    ],
  };
}

async function doctor(options) {
  const env = taskEnvironment(options);
  const input = inputContext(options);
  const binding = await loadContract(input, { env });
  const config = loadConfig(input, env);
  const checks = [];
  const major = Number.parseInt(process.versions.node.split(".")[0], 10);
  checks.push({
    name: "node",
    status: major >= 20 ? "pass" : "fail",
    detail: process.versions.node,
  });
  for (const relative of [
    ".codex-plugin/plugin.json",
    "hooks/hooks.json",
    "src/hook.mjs",
    "skills/execution-fidelity/SKILL.md",
  ]) {
    try {
      await access(path.join(pluginRoot, relative));
      checks.push({ name: relative, status: "pass" });
    } catch {
      checks.push({ name: relative, status: "fail" });
    }
  }
  try {
    const hooks = await readJson(path.join(pluginRoot, "hooks", "hooks.json"));
    const commandText = JSON.stringify(hooks);
    checks.push({
      name: "hook-command-portability",
      status: commandText.includes("$" + "{PLUGIN_ROOT}/src/hook.mjs")
        ? "pass"
        : "fail",
    });
  } catch {
    checks.push({ name: "hooks-json", status: "fail" });
  }
  checks.push({
    name: "contract",
    status: binding.status === "bound" ? "pass" : "warn",
    detail:
      binding.status === "bound"
        ? binding.envelope.contract_ref + " v" + binding.envelope.contract_version
        : binding.status +
          (binding.errors?.[0]
            ? " - " + redactText(binding.errors[0], 160)
            : ""),
  });
  const report = {
    ok: checks.every((check) => check.status !== "fail"),
    mode: config.mode,
    persistence: config.persist,
    retention_days: config.retentionDays,
    delete_on_session_end: config.deleteOnSessionEnd,
    contract_path: resolveContractPath(input, env),
    next_action:
      binding.status === "bound"
        ? null
        : "Create and review a contract with init --preset no-local-install --objective TEXT --primary-object TEXT, or pass --contract PATH.",
    checks,
  };
  if (options.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    for (const check of checks) {
      process.stdout.write(
        check.status.toUpperCase().padEnd(5) +
          " " +
          check.name +
          (check.detail ? " - " + check.detail : "") +
          "\n",
      );
    }
    process.stdout.write("Mode: " + config.mode + "\n");
    process.stdout.write("Retention: " + config.retentionDays + " day(s)\n");
    process.stdout.write(
      "Delete on session end: " + config.deleteOnSessionEnd + "\n",
    );
    process.stdout.write("Contract: " + report.contract_path + "\n");
    if (report.next_action) process.stdout.write("Next: " + report.next_action + "\n");
  }
  if (!report.ok) process.exitCode = 1;
}

async function initContract(options) {
  const input = inputContext(options);
  const env = taskEnvironment(options);
  const target = options.path
    ? path.resolve(input.cwd, String(options.path))
    : resolveContractPath(input, env);
  const contract = templateContract(options);
  const errors = validateTaskContractLite(contract);
  if (errors.length) throw new Error("internal template is invalid: " + errors.join("; "));
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await writeFile(target, JSON.stringify(contract, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(
        "contract already exists; edit it in place or choose a different --path",
      );
    }
    throw error;
  }
  process.stdout.write(
    "Created " +
      target +
      (options.preset
        ? "\nCreated a valid preset contract. Review it in shadow mode before enabling balanced mode.\n"
        : "\nReview every placeholder, add only explicit action rules, then set EFG_MODE=balanced when ready.\n"),
  );
}

async function validateContract(options) {
  const env = taskEnvironment(options);
  const input = inputContext(options);
  const binding = await loadContract(input, { env });
  const report = {
    valid: binding.status === "bound",
    status: binding.status,
    path: binding.path,
    provider: binding.status === "bound" ? binding.provider : null,
    contract_ref:
      binding.status === "bound" ? binding.envelope.contract_ref : null,
    contract_version:
      binding.status === "bound" ? binding.envelope.contract_version : null,
    schema_version:
      binding.status === "bound" ? binding.envelope.schema_version : null,
    snapshot_sha256:
      binding.status === "bound" ? binding.snapshotHash : null,
    errors: (binding.errors ?? []).slice(0, 10),
  };
  if (options.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else if (report.valid) {
    process.stdout.write(
      "VALID " +
        report.contract_ref +
        " v" +
        report.contract_version +
        " (" +
        report.provider +
        ")\n",
    );
  } else {
    process.stdout.write(
      report.status.toUpperCase() +
        (report.errors.length ? " - " + report.errors.join("; ") : "") +
        "\n",
    );
  }
  if (!report.valid) process.exitCode = 1;
}

async function checkEvent(options, positional) {
  const eventPath = options.event || positional[0];
  if (!eventPath) throw new Error("check requires --event <json-file>");
  const input = await readJson(path.resolve(String(eventPath)));
  const env = taskEnvironment(options);
  const config = { ...loadConfig(input, env), persist: false };
  const output = await handleHook(input, { env, config });
  process.stdout.write(JSON.stringify(output ?? null, null, 2) + "\n");
}

function decisionView(decision) {
  return {
    decision: decision.decision,
    authority: decision.authority,
    severity: decision.severity,
    reason_codes: decision.reasonCodes,
    rule_ids: decision.ruleIds,
    visibility: decision.visibility,
    reversible: decision.reversible,
    coverage: decision.coverage,
    unlock: decision.unlock,
  };
}

async function explainEvent(options, positional) {
  const eventPath = options.event || positional[0];
  if (!eventPath) throw new Error("explain requires --event <json-file>");
  const input = await readJson(path.resolve(String(eventPath)));
  const eventName = String(input.hook_event_name || "");
  if (!["PreToolUse", "PermissionRequest"].includes(eventName)) {
    throw new Error("explain supports only PreToolUse and PermissionRequest events");
  }
  const env = taskEnvironment(options);
  const binding = await loadContract(input, { env });
  const config = { ...loadConfig(input, env), persist: false };
  const action = classifyToolAction(input);
  const decision = decidePreTool({
    binding,
    action,
    mode: config.mode,
  });
  process.stdout.write(
    JSON.stringify(
      {
        event: String(input.hook_event_name || "unknown"),
        tool_name: action.toolName,
        action_tags: action.tags,
        high_risk: action.highRisk,
        reversible: action.reversible,
        contract_status: binding.status,
        mode: config.mode,
        result: decisionView(decision),
      },
      null,
      2,
    ) + "\n",
  );
}

async function demo() {
  const contract = {
    objective: "Demonstrate a deterministic no-local-install contract.",
    primary_object: "the demonstration workspace",
    delivery_surface: ["terminal"],
    scope: { include: ["demonstration"], exclude: ["local installation"] },
    must_and_must_not: {
      must: ["Show one allowed and one blocked action."],
      must_not: [],
    },
    authorization: {
      allowed: ["action:read"],
      requires_user: [],
      forbidden: ["action:install_local"],
    },
    completion_evidence: [
      { requirement: "evidence:test", acceptable_sources: ["test"] },
    ],
  };
  const binding = parseContractDocument(contract, {
    modifiedAt: "2026-08-31T00:00:00.000Z",
  });
  const cases = [
    { label: "read the workspace", command: "rg --files" },
    { label: "install a package locally", command: "npm install left-pad" },
  ].map((item) => {
    const action = classifyToolAction({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: item.command },
    });
    return {
      label: item.label,
      action_tags: action.tags,
      result: decisionView(
        decidePreTool({ binding, action, mode: "balanced" }),
      ),
    };
  });
  process.stdout.write(
    JSON.stringify(
      {
        writes_state: false,
        installs_plugin: false,
        contract_ref: binding.envelope.contract_ref,
        cases,
      },
      null,
      2,
    ) + "\n",
  );
}

function normalizedSessionReference(value) {
  const text = String(value ?? "unknown");
  return SESSION_REFERENCE.test(text) ? text : sessionReference(text);
}

function sanitizeSessionIds(value) {
  if (Array.isArray(value)) return value.map(sanitizeSessionIds);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === "session_id"
        ? normalizedSessionReference(item)
        : key === "turn_id"
          ? TURN_REFERENCE.test(String(item ?? ""))
            ? item
            : item == null
              ? null
              : identifierReference("turn", item)
          : key === "tool_use_id"
            ? TOOL_USE_REFERENCE.test(String(item ?? ""))
              ? item
              : item == null
                ? null
                : identifierReference("tool-use", item)
            : sanitizeSessionIds(item),
    ]),
  );
}

async function showStatus(options) {
  const env = taskEnvironment(options);
  const input = inputContext(options);
  const binding = await loadContract(input, { env });
  const config = loadConfig(input, env);
  const sessionId = String(options.session || "cli");
  const [events, receipts, evidence, present] = await Promise.all([
    readRecords(config, sessionId, "events"),
    readRecords(config, sessionId, "receipts"),
    readRecords(config, sessionId, "evidence"),
    sessionExists({ ...config, persist: true }, sessionId),
  ]);
  const completion = assessCompletionEvidence(binding, evidence);
  process.stdout.write(
    JSON.stringify(
      {
        mode: config.mode,
        contract_status: binding.status,
        contract_ref:
          binding.status === "bound" ? binding.envelope.contract_ref : null,
        contract_version:
          binding.status === "bound" ? binding.envelope.contract_version : null,
        contract_errors:
          binding.status === "invalid" ? (binding.errors ?? []).slice(0, 5) : [],
        session_ref: normalizedSessionReference(sessionId),
        session_present: present,
        session_status: present ? "found" : "session_not_found",
        next_action: present
          ? null
          : "Reuse the same caller-chosen source trial label, or the pseudonymous Guard session reference shown in SessionStart context.",
        counts: {
          events: events.length,
          receipts: receipts.length,
          evidence: evidence.length,
        },
        completion: {
          complete: completion.complete,
          reason: completion.reason,
          missing: completion.missing,
        },
      },
      null,
      2,
    ) + "\n",
  );
}

async function addEvidence(options) {
  const required = ["session", "requirement", "kind", "status"];
  for (const key of required) {
    if (options[key] === undefined) throw new Error("evidence add requires --" + key);
  }
  if (options.source === undefined && options.artifact === undefined) {
    throw new Error("evidence add requires --source LABEL or --artifact PATH");
  }
  const env = taskEnvironment(options);
  const input = inputContext(options);
  const binding = await loadContract(input, { env });
  if (binding.status !== "bound") throw new Error("a valid contract must be bound");
  const config = loadConfig(input, env);
  if (!config.persist) {
    throw new Error("evidence add requires persistence; set EFG_PERSIST=true");
  }
  const requirementValue = String(options.requirement);
  if (!/^[1-9][0-9]*$/.test(requirementValue)) {
    throw new Error("requirement must be a valid 1-based index");
  }
  const requirementNumber = Number(requirementValue);
  if (!Number.isSafeInteger(requirementNumber)) {
    throw new Error("requirement must be a valid 1-based index");
  }
  const requirementIndex = requirementNumber - 1;
  const requirement = binding.contract.completion_evidence[requirementIndex];
  if (!requirement) throw new Error("requirement must be a valid 1-based index");
  const kind = String(options.kind).toLowerCase();
  if (!evidenceKinds.has(kind) || !requirement.acceptable_sources.includes(kind)) {
    throw new Error("kind is not accepted by the selected requirement");
  }
  const status = String(options.status).toLowerCase();
  if (!["pass", "fail", "contradictory", "unknown"].includes(status)) {
    throw new Error("status must be pass, fail, contradictory, or unknown");
  }
  let digest = options.sha256 ? String(options.sha256).toLowerCase() : null;
  if (digest && !/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error("--sha256 must be a lowercase SHA-256");
  }
  let artifactPath = null;
  if (options.artifact !== undefined) {
    artifactPath = path.resolve(String(options.artifact));
    let info;
    try {
      info = await lstat(artifactPath);
    } catch (error) {
      if (["ENOENT", "EACCES", "EPERM"].includes(error?.code)) {
        throw new Error("artifact not found or unreadable: " + artifactPath);
      }
      throw error;
    }
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error("--artifact must name a regular, non-symbolic-link file");
    }
    if (info.size > MAXIMUM_ARTIFACT_BYTES) {
      throw new Error("--artifact exceeds the 64 MiB safety limit");
    }
    const observedDigest = sha256(await readFile(artifactPath));
    if (digest && digest !== observedDigest) {
      throw new Error("--sha256 does not match the observed artifact bytes");
    }
    digest = observedDigest;
  }
  if (status === "pass" && kind !== "user" && !digest) {
    throw new Error(
      "passing non-user evidence requires --artifact or --sha256",
    );
  }
  const now = new Date();
  const evidenceRef = makeId("ev_manual_", [
    binding.envelope.contract_ref,
    requirementIndex,
    kind,
  ]);
  const evidence = {
    evidence_ref: evidenceRef,
    kind,
    source:
      options.source !== undefined
        ? redactText(options.source, 160)
        : "artifact:" + digest.slice(0, 16),
    captured_at: now.toISOString(),
    freshness: "current_task",
    coverage: "full_requirement",
    status,
    attestation: artifactPath ? "artifact_observed" : "caller_attested",
  };
  if (digest) evidence.sha256 = digest;
  if (artifactPath) {
    evidence.redacted_locator = redactText(path.basename(artifactPath), 120);
  }
  const record = {
    schema_version: "2.0",
    evidence_ref: evidenceRef,
    contract_ref: binding.envelope.contract_ref,
    contract_version: binding.envelope.contract_version,
    requirement_refs: [
      evidenceRequirementRef(requirementIndex, requirement.requirement),
    ],
    evidence,
  };
  await writeRecord(config, options.session, "evidence", record);
  process.stdout.write(
    JSON.stringify(
      {
        recorded: true,
        evidence_ref: evidenceRef,
        session_ref: normalizedSessionReference(options.session),
        requirement_ref: record.requirement_refs[0],
        attestation: evidence.attestation,
        sha256: evidence.sha256 ?? null,
      },
      null,
      2,
    ) + "\n",
  );
}

function requiredSession(options, command) {
  if (options.session === undefined || !String(options.session).trim()) {
    throw new Error(command + " requires --session SESSION");
  }
  return String(options.session);
}

async function buildReceiptBundle(options) {
  const sessionId = requiredSession(options, "receipts");
  const env = taskEnvironment(options);
  const input = inputContext({ ...options, session: sessionId });
  const config = { ...loadConfig(input, env), persist: true };
  const [events, receipts, evidence, stopState, present] = await Promise.all([
    readRecords(config, sessionId, "events"),
    readRecords(config, sessionId, "receipts"),
    readRecords(config, sessionId, "evidence"),
    readStopState(config, sessionId),
    sessionExists(config, sessionId),
  ]);
  return {
    schema_version: "1.0",
    kind: "execution-fidelity-guard-session-receipts",
    session_ref: normalizedSessionReference(sessionId),
    session_present: present,
    exported_at: new Date().toISOString(),
    events: sanitizeSessionIds(events),
    receipts: sanitizeSessionIds(receipts),
    evidence: sanitizeSessionIds(evidence),
    stop_state: sanitizeSessionIds(stopState),
  };
}

async function showReceipts(options) {
  const bundle = await buildReceiptBundle(options);
  process.stdout.write(JSON.stringify(bundle, null, 2) + "\n");
}

function countBy(values, select) {
  const counts = {};
  for (const value of values) {
    const key = String(select(value) ?? "unknown");
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

async function summarizeReceipts(options) {
  const bundle = await buildReceiptBundle(options);
  const env = taskEnvironment(options);
  const input = inputContext(options);
  const binding = await loadContract(input, { env });
  const completion = assessCompletionEvidence(binding, bundle.evidence);
  process.stdout.write(
    JSON.stringify(
      {
        schema_version: "1.0",
        session_ref: bundle.session_ref,
        session_present: bundle.session_present,
        session_status: bundle.session_present ? "found" : "session_not_found",
        next_action: bundle.session_present
          ? null
          : "Reuse the same caller-chosen source trial label, or the pseudonymous Guard session reference shown in SessionStart context.",
        decisions: countBy(bundle.receipts, (item) => item.decision),
        reasons: countBy(
          bundle.receipts.flatMap((item) => item.reason_codes ?? []),
          (item) => item,
        ),
        evidence_status: countBy(
          bundle.evidence,
          (item) => item.evidence?.status,
        ),
        evidence_attestation: countBy(
          bundle.evidence,
          (item) => item.evidence?.attestation,
        ),
        completion: {
          complete: completion.complete,
          reason: completion.reason,
          missing: completion.missing,
        },
      },
      null,
      2,
    ) + "\n",
  );
}

async function exportReceipts(options) {
  if (options.output === undefined || !String(options.output).trim()) {
    throw new Error("receipts export requires --output PATH");
  }
  const bundle = await buildReceiptBundle(options);
  if (!bundle.session_present) {
    throw new Error(
      "session not found; reuse the same source-trial label or SessionStart session reference",
    );
  }
  const target = path.resolve(String(options.output));
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await writeFile(target, JSON.stringify(bundle, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(
        "export target already exists; choose a new --output path",
      );
    }
    throw error;
  }
  process.stdout.write(
    JSON.stringify(
      {
        exported: true,
        output: target,
        counts: {
          events: bundle.events.length,
          receipts: bundle.receipts.length,
          evidence: bundle.evidence.length,
        },
      },
      null,
      2,
    ) + "\n",
  );
}

async function deleteReceipts(options) {
  const sessionId = requiredSession(options, "receipts delete");
  if (options.yes !== true) {
    throw new Error("receipts delete requires the explicit --yes flag");
  }
  const env = taskEnvironment(options);
  const input = inputContext({ ...options, session: sessionId });
  const config = { ...loadConfig(input, env), persist: true };
  const deleted = await deleteSession(config, sessionId);
  process.stdout.write(
    JSON.stringify(
      { deleted, session_ref: normalizedSessionReference(sessionId) },
      null,
      2,
    ) + "\n",
  );
}

function help() {
  const source = "node plugins/execution-fidelity-guard/bin/efg.mjs";
  process.stdout.write(
    [
      "Execution Fidelity Guard",
      "",
      "Usage from the repository root:",
      "  " + source + " doctor [--contract PATH] [--json]",
      "  " + source + " init [--path PATH] [--preset no-local-install --objective TEXT --primary-object TEXT]",
      "  " + source + " contract validate [--contract PATH] [--json]",
      "  " + source + " check --event EVENT.json [--contract PATH] [--mode MODE]",
      "  " + source + " explain --event EVENT.json [--contract PATH] [--mode MODE]",
      "  " + source + " demo",
      "  " + source + " status --session SESSION [--contract PATH] [--state-dir PATH]",
      "  " + source + " evidence add --session SESSION --requirement N --kind KIND --status STATUS (--artifact PATH | --source LABEL [--sha256 HASH]) [--contract PATH] [--state-dir PATH]",
      "  " + source + " receipts show --session SESSION [--state-dir PATH]",
      "  " + source + " receipts summary --session SESSION [--contract PATH] [--state-dir PATH]",
      "  " + source + " receipts export --session SESSION --output PATH [--state-dir PATH]",
      "  " + source + " receipts delete --session SESSION --yes [--state-dir PATH]",
      "",
      "From the plugin root, replace the source prefix with: node bin/efg.mjs",
      "A check result of null means continue. Exit 0 means the simulation ran; inspect the JSON decision rather than treating the process exit as allow or deny.",
      "Explain accepts only PreToolUse and PermissionRequest events. Evidence add requires persistence.",
      "For a source trial, choose one session label such as source-trial-1 and reuse it in every status, evidence, and receipts command.",
      "After installation, SessionStart gives the Agent a pseudonymous Guard session reference that the same commands accept.",
      "The CLI runs directly from source and does not install the plugin.",
      "",
    ].join("\n"),
  );
}

async function main() {
  const command = process.argv[2] || "help";
  const subcommand = process.argv[3];
  const hasSubcommand =
    (command === "evidence" && subcommand === "add") ||
    (command === "contract" && subcommand === "validate") ||
    (command === "receipts" &&
      ["show", "summary", "export", "delete"].includes(subcommand));
  const argumentOffset = hasSubcommand ? 4 : 3;
  const { options, positional } = parseArguments(process.argv.slice(argumentOffset));
  if (command === "doctor") await doctor(options);
  else if (command === "init") await initContract(options);
  else if (command === "contract" && subcommand === "validate") {
    await validateContract(options);
  }
  else if (command === "check") await checkEvent(options, positional);
  else if (command === "explain") await explainEvent(options, positional);
  else if (command === "demo") await demo();
  else if (command === "status") await showStatus(options);
  else if (command === "evidence" && subcommand === "add") await addEvidence(options);
  else if (command === "receipts" && subcommand === "show") {
    await showReceipts(options);
  } else if (command === "receipts" && subcommand === "summary") {
    await summarizeReceipts(options);
  } else if (command === "receipts" && subcommand === "export") {
    await exportReceipts(options);
  } else if (command === "receipts" && subcommand === "delete") {
    await deleteReceipts(options);
  }
  else if (["help", "--help", "-h"].includes(command)) help();
  else throw new Error("unknown command: " + command);
}

try {
  await main();
} catch (error) {
  process.stderr.write("efg: " + redactText(error?.message || "command failed", 500) + "\n");
  process.exitCode = 1;
}
