import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
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

test("init creates once and refuses to overwrite", async (t) => {
  const stateRoot = await temporaryState(t);
  const target = path.join(stateRoot, "contract.json");
  const first = runCli(["init", "--path", target]);
  const second = runCli(["init", "--path", target]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 1);
  assert.match(second.stderr, /contract already exists/i);
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

test("receipts can be shown, exported without overwrite, and explicitly deleted", async (t) => {
  const stateRoot = await temporaryState(t);
  const sessionId = "receipt-session";
  const config = makeConfig(stateRoot);
  await writeRecord(config, sessionId, "events", { event_id: "evt_cli" });
  await writeRecord(config, sessionId, "receipts", { receipt_id: "rcpt_cli" });
  await writeRecord(config, sessionId, "evidence", { evidence_ref: "ev_cli" });
  await writeStopState(config, sessionId, {
    schema_version: "1.0",
    attempts: 1,
  });
  const env = { ...process.env, EFG_STATE_DIR: stateRoot };

  const shown = runCli(["receipts", "show", "--session", sessionId], { env });
  assert.equal(shown.status, 0, shown.stderr);
  const shownBundle = JSON.parse(shown.stdout);
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
  assert.equal(exportedBundle.session_id, sessionId);
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
  const shown = runCli(
    ["receipts", "show", "--state-dir", stateRoot, "--session", sessionId],
  );
  assert.equal(shown.status, 0, shown.stderr);
  const bundle = JSON.parse(shown.stdout);
  assert.equal(bundle.evidence[0].evidence.attestation, "caller_attested");
});
