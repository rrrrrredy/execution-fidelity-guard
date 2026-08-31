import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  sessionReference,
  sha256,
} from "../plugins/execution-fidelity-guard/src/canonical.mjs";
import {
  sessionStatePath,
  writeRecord,
  writeStopState,
} from "../plugins/execution-fidelity-guard/src/store.mjs";
import {
  makeConfig,
  projectRoot,
  temporaryState,
} from "../test-support/helpers.mjs";

const cli = path.join(
  projectRoot,
  "plugins",
  "execution-fidelity-guard",
  "bin",
  "efg.mjs",
);
const hook = path.join(
  projectRoot,
  "plugins",
  "execution-fidelity-guard",
  "src",
  "hook.mjs",
);

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    ...options,
  });
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

test("documented source simulation resolves contract relative to the caller", () => {
  const result = runCli([
    "check",
    "--mode",
    "balanced",
    "--event",
    "examples/events/pre-tool-install.json",
    "--contract",
    "examples/contracts/no-local-install.json",
  ]);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
});

test("doctor is read-only and reports the safe shadow default", () => {
  const result = runCli(["doctor", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.mode, "shadow");
  assert.match(report.next_action, /init --preset no-local-install/);
});

test("help uses repository-root commands and documents simulation semantics", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /node plugins\/execution-fidelity-guard\/bin\/efg[.]mjs check/,
  );
  assert.match(result.stdout, /\[--mode MODE\]/);
  assert.match(result.stdout, /evidence add.*\[--contract PATH\]/);
  assert.match(result.stdout, /null means continue/);
});

test("explain rejects event types that do not use pre-tool policy", async (t) => {
  const stateRoot = await temporaryState(t);
  const eventPath = path.join(stateRoot, "post-tool.json");
  await writeFile(
    eventPath,
    JSON.stringify({
      session_id: "trial",
      cwd: projectRoot,
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "node --test" },
      tool_response: { exit_code: 0 },
    }),
  );
  const result = runCli(["explain", "--event", eventPath]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /supports only PreToolUse and PermissionRequest/);
});

test("init creates once and refuses to overwrite", async (t) => {
  const stateRoot = await temporaryState(t);
  const target = path.join(stateRoot, "contract.json");
  const first = runCli(["init", "--path", target]);
  const second = runCli(["init", "--path", target]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 1);
  assert.match(second.stderr, /contract already exists/i);
});

test("no-local-install preset creates a ready contract that validates", async (t) => {
  const stateRoot = await temporaryState(t);
  const target = path.join(stateRoot, "ready-contract.json");
  const initialized = runCli([
    "init",
    "--path",
    target,
    "--preset",
    "no-local-install",
    "--objective",
    "Ship a verified public release",
    "--primary-object",
    "Execution Fidelity Guard",
  ]);
  assert.equal(initialized.status, 0, initialized.stderr);
  const contract = JSON.parse(await readFile(target, "utf8"));
  assert.deepEqual(contract.authorization.forbidden, ["action:install_local"]);

  const validated = runCli([
    "contract",
    "validate",
    "--contract",
    target,
    "--json",
  ]);
  assert.equal(validated.status, 0, validated.stderr);
  const report = JSON.parse(validated.stdout);
  assert.equal(report.valid, true);
  assert.equal(report.provider, "task-contract-lite");
  assert.match(report.contract_ref, /^lite:/);
});

test("evidence add fails instead of claiming a record when persistence is off", async (t) => {
  const stateRoot = await temporaryState(t);
  const contractPath = path.join(stateRoot, "contract.json");
  await writeFile(contractPath, JSON.stringify({
    objective: "Verify a release",
    primary_object: "the package",
    delivery_surface: ["repository"],
    scope: { include: ["workspace"], exclude: [] },
    must_and_must_not: { must: [], must_not: [] },
    authorization: { allowed: [], requires_user: [], forbidden: [] },
    completion_evidence: [
      { requirement: "evidence:test", acceptable_sources: ["test"] },
    ],
  }));
  const result = runCli([
    "evidence", "add",
    "--session", "trial",
    "--requirement", "1",
    "--kind", "test",
    "--status", "pass",
    "--source", "caller",
    "--sha256", "a".repeat(64),
    "--contract", contractPath,
    "--state-dir", stateRoot,
  ], {
    env: { ...process.env, EFG_PERSIST: "false" },
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout.includes('"recorded": true'), false);
  assert.match(result.stderr, /requires persistence/);
});

test("an untouched init template remains invalid and advisory in balanced mode", async (t) => {
  const stateRoot = await temporaryState(t);
  const target = path.join(stateRoot, "contract.json");
  const initialized = runCli(["init", "--path", target]);
  assert.equal(initialized.status, 0, initialized.stderr);

  const doctor = runCli(["doctor", "--contract", target, "--json"]);
  assert.equal(doctor.status, 0, doctor.stderr);
  const doctorReport = JSON.parse(doctor.stdout);
  const contractCheck = doctorReport.checks.find((item) => item.name === "contract");
  assert.equal(contractCheck.status, "warn");
  assert.match(contractCheck.detail, /init placeholders/);

  const status = runCli([
    "status",
    "--contract",
    target,
    "--state-dir",
    stateRoot,
    "--session",
    "template-session",
  ]);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).contract_status, "invalid");

  const checked = runCli([
    "check",
    "--mode",
    "balanced",
    "--event",
    "examples/events/pre-tool-install.json",
    "--contract",
    target,
  ]);
  assert.equal(checked.status, 0, checked.stderr);
  const output = JSON.parse(checked.stdout);
  assert.match(output.hookSpecificOutput.additionalContext, /contract_unbound/);
});

test("malformed Hook input fails open without echoing input", () => {
  const secret = ["ghp", "_", "a".repeat(36)].join("");
  const result = spawnSync(process.execPath, [hook], {
    cwd: projectRoot,
    input: '{"token":"' + secret + '"',
    encoding: "utf8",
    env: { ...process.env, EFG_PERSIST: "false" },
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /failed open/);
  assert.equal(result.stderr.includes(secret), false);
});

test("demo and explain show decisions without installing or echoing commands", () => {
  const demonstrated = runCli(["demo"]);
  assert.equal(demonstrated.status, 0, demonstrated.stderr);
  const demo = JSON.parse(demonstrated.stdout);
  assert.equal(demo.writes_state, false);
  assert.equal(demo.installs_plugin, false);
  assert.equal(demo.cases[0].result.decision, "continue");
  assert.equal(demo.cases[1].result.decision, "block");
  assert.equal(demo.cases[1].result.reversible, false);

  const explained = runCli([
    "explain",
    "--mode",
    "balanced",
    "--event",
    "examples/events/pre-tool-install.json",
    "--contract",
    "examples/contracts/no-local-install.json",
  ]);
  assert.equal(explained.status, 0, explained.stderr);
  const explanation = JSON.parse(explained.stdout);
  assert.equal(explanation.result.decision, "block");
  assert.equal(explanation.result.reversible, false);
  assert.deepEqual(explanation.action_tags, [
    "install_local",
    "network",
    "write_workspace",
  ]);
  assert.equal(explained.stdout.includes("npm install"), false);
});

test("receipts can be shown, exported without overwrite, and explicitly deleted", async (t) => {
  const stateRoot = await temporaryState(t);
  const sessionId = "receipt-session";
  const config = makeConfig(stateRoot);
  await writeRecord(config, sessionId, "events", { event_id: "evt_cli" });
  await writeRecord(config, sessionId, "receipts", {
    receipt_id: "rcpt_cli",
    decision: "block",
    reason_codes: ["explicit_contract_conflict"],
  });
  await writeRecord(config, sessionId, "evidence", { evidence_ref: "ev_cli" });
  await writeStopState(config, sessionId, {
    schema_version: "1.0",
    attempts: 1,
  });
  const env = { ...process.env, EFG_STATE_DIR: stateRoot };

  const shown = runCli(
    ["receipts", "show", "--session", sessionReference(sessionId)],
    { env },
  );
  assert.equal(shown.status, 0, shown.stderr);
  const shownBundle = JSON.parse(shown.stdout);
  assert.equal(shownBundle.session_ref, sessionReference(sessionId));
  assert.equal(shownBundle.session_present, true);
  assert.equal(shownBundle.events.length, 1);
  assert.equal(shownBundle.receipts.length, 1);
  assert.equal(shownBundle.evidence.length, 1);
  assert.equal(shownBundle.stop_state.attempts, 1);

  const exportPath = path.join(stateRoot, "exports", "bundle.json");
  const exported = runCli(
    ["receipts", "export", "--session", sessionId, "--output", exportPath],
    { env },
  );
  assert.equal(exported.status, 0, exported.stderr);
  const exportedBundle = JSON.parse(await readFile(exportPath, "utf8"));
  assert.equal(exportedBundle.session_ref, sessionReference(sessionId));
  assert.equal(JSON.stringify(exportedBundle).includes(sessionId), false);
  const summarized = runCli(
    ["receipts", "summary", "--session", sessionId],
    { env },
  );
  assert.equal(summarized.status, 0, summarized.stderr);
  const summary = JSON.parse(summarized.stdout);
  assert.equal(summary.session_status, "found");
  assert.equal(summary.decisions.block, 1);
  assert.equal(summary.reasons.explicit_contract_conflict, 1);
  const overwrite = runCli(
    ["receipts", "export", "--session", sessionId, "--output", exportPath],
    { env },
  );
  assert.equal(overwrite.status, 1);
  assert.match(overwrite.stderr, /export target already exists/i);

  const withoutConfirmation = runCli(
    ["receipts", "delete", "--session", sessionId],
    { env },
  );
  assert.equal(withoutConfirmation.status, 1);
  assert.match(withoutConfirmation.stderr, /explicit --yes/);
  const sessionPath = sessionStatePath(config, sessionId);
  assert.equal(await pathExists(sessionPath), true);

  const deleted = runCli(
    ["receipts", "delete", "--session", sessionId, "--yes"],
    { env },
  );
  assert.equal(deleted.status, 0, deleted.stderr);
  assert.equal(JSON.parse(deleted.stdout).deleted, true);
  assert.equal(await pathExists(sessionPath), false);
});

test("manual evidence is explicitly marked caller-attested", async (t) => {
  const stateRoot = await temporaryState(t);
  const sessionId = "manual-evidence-session";
  const added = runCli(
    [
      "evidence",
      "add",
      "--contract",
      "examples/contracts/no-local-install.json",
      "--state-dir",
      stateRoot,
      "--session",
      sessionId,
      "--requirement",
      "1",
      "--kind",
      "test",
      "--status",
      "pass",
      "--source",
      "caller-provided test report",
      "--sha256",
      "a".repeat(64),
    ],
  );
  assert.equal(added.status, 0, added.stderr);
  const addedReceipt = JSON.parse(added.stdout);
  assert.equal(addedReceipt.attestation, "caller_attested");
  assert.equal(addedReceipt.sha256, "a".repeat(64));
  assert.equal(addedReceipt.session_ref, sessionReference(sessionId));
  const shown = runCli(
    ["receipts", "show", "--state-dir", stateRoot, "--session", sessionId],
  );
  assert.equal(shown.status, 0, shown.stderr);
  const bundle = JSON.parse(shown.stdout);
  assert.equal(bundle.evidence[0].evidence.attestation, "caller_attested");
});

test("artifact evidence hashes observed bytes and rejects a supplied mismatch", async (t) => {
  const stateRoot = await temporaryState(t);
  const sessionId = "artifact-evidence-session";
  const artifact = path.join(stateRoot, "test-report.txt");
  const bytes = "55 tests passed\n";
  await writeFile(artifact, bytes, "utf8");

  const added = runCli([
    "evidence",
    "add",
    "--contract",
    "examples/contracts/no-local-install.json",
    "--state-dir",
    stateRoot,
    "--session",
    sessionId,
    "--requirement",
    "1",
    "--kind",
    "test",
    "--status",
    "pass",
    "--artifact",
    artifact,
  ]);
  assert.equal(added.status, 0, added.stderr);
  const addedReceipt = JSON.parse(added.stdout);
  assert.equal(addedReceipt.attestation, "artifact_observed");
  assert.equal(addedReceipt.sha256, sha256(Buffer.from(bytes)));
  const shown = runCli([
    "receipts",
    "show",
    "--state-dir",
    stateRoot,
    "--session",
    sessionId,
  ]);
  assert.equal(shown.status, 0, shown.stderr);
  const evidence = JSON.parse(shown.stdout).evidence[0].evidence;
  assert.equal(evidence.attestation, "artifact_observed");
  assert.equal(evidence.sha256, sha256(Buffer.from(bytes)));
  assert.equal(evidence.redacted_locator, "test-report.txt");

  const mismatch = runCli([
    "evidence",
    "add",
    "--contract",
    "examples/contracts/no-local-install.json",
    "--state-dir",
    stateRoot,
    "--session",
    sessionId,
    "--requirement",
    "1",
    "--kind",
    "test",
    "--status",
    "pass",
    "--artifact",
    artifact,
    "--sha256",
    "a".repeat(64),
  ]);
  assert.equal(mismatch.status, 1);
  assert.match(mismatch.stderr, /does not match the observed artifact bytes/);
});

test("missing artifact errors are actionable and do not expose a Node stack", async (t) => {
  const stateRoot = await temporaryState(t);
  const contractPath = path.join(stateRoot, "contract.json");
  const initialized = runCli([
    "init", "--path", contractPath,
    "--preset", "no-local-install",
    "--objective", "Verify evidence",
    "--primary-object", "the artifact",
  ]);
  assert.equal(initialized.status, 0, initialized.stderr);
  const missing = path.join(stateRoot, "missing-report.json");
  const result = runCli([
    "evidence", "add",
    "--session", "trial",
    "--requirement", "1",
    "--kind", "test",
    "--status", "pass",
    "--artifact", missing,
    "--contract", contractPath,
    "--state-dir", stateRoot,
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /artifact not found or unreadable/);
  assert.equal(result.stderr.includes("at async"), false);
});

test("status and summary make a missing session actionable", async (t) => {
  const stateRoot = await temporaryState(t);
  const args = [
    "--contract",
    "examples/contracts/no-local-install.json",
    "--state-dir",
    stateRoot,
    "--session",
    "mistyped-session",
  ];
  const status = runCli(["status", ...args]);
  assert.equal(status.status, 0, status.stderr);
  const report = JSON.parse(status.stdout);
  assert.equal(report.session_present, false);
  assert.equal(report.session_status, "session_not_found");
  assert.match(report.next_action, /Reuse the same/);

  const summarized = runCli(["receipts", "summary", ...args]);
  assert.equal(summarized.status, 0, summarized.stderr);
  const summary = JSON.parse(summarized.stdout);
  assert.equal(summary.session_status, "session_not_found");
  assert.match(summary.next_action, /SessionStart context/);

  const exportPath = path.join(stateRoot, "missing-session-export.json");
  const exported = runCli([
    "receipts",
    "export",
    ...args,
    "--output",
    exportPath,
  ]);
  assert.equal(exported.status, 1);
  assert.match(exported.stderr, /session not found/);
  assert.equal(await pathExists(exportPath), false);
});

test("CLI rejects missing option values and malformed requirement indexes", async (t) => {
  const missingValue = runCli(["status", "--session"]);
  assert.equal(missingValue.status, 1);
  assert.match(missingValue.stderr, /--session requires a value/);

  const stateRoot = await temporaryState(t);
  const contractPath = path.join(stateRoot, "contract.json");
  const initialized = runCli([
    "init", "--path", contractPath,
    "--preset", "no-local-install",
    "--objective", "Verify evidence",
    "--primary-object", "the artifact",
  ]);
  assert.equal(initialized.status, 0, initialized.stderr);
  const malformed = runCli([
    "evidence", "add",
    "--contract", contractPath,
    "--state-dir", stateRoot,
    "--session", "source-trial",
    "--requirement", "1junk",
    "--kind", "test",
    "--status", "pass",
    "--source", "caller",
    "--sha256", "a".repeat(64),
  ]);
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr, /valid 1-based index/);
});
