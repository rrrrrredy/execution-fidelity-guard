#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeId, redactText } from "../src/canonical.mjs";
import { loadConfig } from "../src/config.mjs";
import {
  loadContract,
  resolveContractPath,
  validateTaskContractLite,
} from "../src/contract.mjs";
import { evidenceRequirementRef } from "../src/evidence.mjs";
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

function parseArguments(values) {
  const options = {};
  const positional = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = values[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
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

function templateContract() {
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
  }
  if (!report.ok) process.exitCode = 1;
}

async function initContract(options) {
  const input = inputContext(options);
  const env = taskEnvironment(options);
  const target = options.path
    ? path.resolve(input.cwd, String(options.path))
    : resolveContractPath(input, env);
  const contract = templateContract();
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
      "\nReview every placeholder, add only explicit action rules, then set EFG_MODE=balanced when ready.\n",
  );
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
        session_id: sessionId,
        session_present: present,
        counts: {
          events: events.length,
          receipts: receipts.length,
          evidence: evidence.length,
        },
      },
      null,
      2,
    ) + "\n",
  );
}

async function addEvidence(options) {
  const required = ["session", "requirement", "kind", "status", "source"];
  for (const key of required) {
    if (options[key] === undefined) throw new Error("evidence add requires --" + key);
  }
  const env = taskEnvironment(options);
  const input = inputContext(options);
  const binding = await loadContract(input, { env });
  if (binding.status !== "bound") throw new Error("a valid contract must be bound");
  const requirementIndex = Number.parseInt(String(options.requirement), 10) - 1;
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
  const digest = options.sha256 ? String(options.sha256).toLowerCase() : null;
  if (digest && !/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error("--sha256 must be a lowercase SHA-256");
  }
  if (status === "pass" && kind !== "user" && !digest) {
    throw new Error("passing non-user evidence requires --sha256");
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
    source: redactText(options.source, 160),
    captured_at: now.toISOString(),
    freshness: "current_task",
    coverage: "full_requirement",
    status,
    attestation: "caller_attested",
  };
  if (digest) evidence.sha256 = digest;
  const record = {
    schema_version: "1.0",
    evidence_ref: evidenceRef,
    contract_ref: binding.envelope.contract_ref,
    contract_version: binding.envelope.contract_version,
    requirement_refs: [
      evidenceRequirementRef(requirementIndex, requirement.requirement),
    ],
    evidence,
  };
  const config = loadConfig(input, env);
  await writeRecord(config, options.session, "evidence", record);
  process.stdout.write(
    JSON.stringify({ recorded: true, evidence_ref: evidenceRef }, null, 2) + "\n",
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
    session_id: sessionId,
    session_present: present,
    exported_at: new Date().toISOString(),
    events,
    receipts,
    evidence,
    stop_state: stopState,
  };
}

async function showReceipts(options) {
  const bundle = await buildReceiptBundle(options);
  process.stdout.write(JSON.stringify(bundle, null, 2) + "\n");
}

async function exportReceipts(options) {
  if (options.output === undefined || !String(options.output).trim()) {
    throw new Error("receipts export requires --output PATH");
  }
  const bundle = await buildReceiptBundle(options);
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
    JSON.stringify({ deleted, session_id: sessionId }, null, 2) + "\n",
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
      "  " + source + " init [--path PATH]",
      "  " + source + " check --event EVENT.json [--contract PATH] [--mode MODE]",
      "  " + source + " status --session SESSION [--contract PATH] [--state-dir PATH]",
      "  " + source + " evidence add --session SESSION --requirement N --kind KIND --status STATUS --source LABEL [--sha256 HASH] [--contract PATH] [--state-dir PATH]",
      "  " + source + " receipts show --session SESSION [--state-dir PATH]",
      "  " + source + " receipts export --session SESSION --output PATH [--state-dir PATH]",
      "  " + source + " receipts delete --session SESSION --yes [--state-dir PATH]",
      "",
      "From the plugin root, replace the source prefix with: node bin/efg.mjs",
      "A check result of null means continue. Exit 0 means the simulation ran; inspect the JSON decision rather than treating the process exit as allow or deny.",
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
    (command === "receipts" &&
      ["show", "export", "delete"].includes(subcommand));
  const argumentOffset = hasSubcommand ? 4 : 3;
  const { options, positional } = parseArguments(process.argv.slice(argumentOffset));
  if (command === "doctor") await doctor(options);
  else if (command === "init") await initContract(options);
  else if (command === "check") await checkEvent(options, positional);
  else if (command === "status") await showStatus(options);
  else if (command === "evidence" && subcommand === "add") await addEvidence(options);
  else if (command === "receipts" && subcommand === "show") {
    await showReceipts(options);
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
