import assert from "node:assert/strict";
import test from "node:test";
import { classifyToolAction } from "../plugins/execution-fidelity-guard/src/classify.mjs";
import {
  assessCompletionEvidence,
  deriveEvidence,
} from "../plugins/execution-fidelity-guard/src/evidence.mjs";
import { makeBinding, preToolInput } from "../test-support/helpers.mjs";

function observed(command, response, capturedAt, suffix) {
  const binding = makeBinding();
  const input = {
    ...preToolInput(command),
    hook_event_name: "PostToolUse",
    tool_response: response,
  };
  const action = classifyToolAction(input);
  const record = deriveEvidence(
    input,
    { event_id: "evt_" + suffix },
    binding,
    action,
    new Date(capturedAt),
  );
  return { binding, record };
}

test("only a direct test command can automatically satisfy test evidence", () => {
  const direct = observed(
    "node --test",
    { exit_code: 0 },
    "2026-08-31T00:00:00.000Z",
    "direct",
  );
  assert.equal(direct.record.evidence.kind, "test");
  assert.equal(direct.record.evidence.coverage, "full_requirement");
  assert.equal(assessCompletionEvidence(direct.binding, [direct.record]).complete, true);

  for (const command of [
    "echo node --test",
    "node --test || true",
    "node --test > report.txt",
    "node --test $(echo hidden)",
  ]) {
    const attempt = observed(
      command,
      { exit_code: 0 },
      "2026-08-31T00:01:00.000Z",
      command,
    );
    assert.equal(attempt.record.evidence.kind, "command", command);
    assert.equal(attempt.record.evidence.coverage, "partial_requirement", command);
    assert.equal(assessCompletionEvidence(attempt.binding, [attempt.record]).complete, false);
  }
});

test("unstructured output text cannot attest a passing exit status", () => {
  const attempt = observed(
    "node --test",
    "exit code 0",
    "2026-08-31T00:00:00.000Z",
    "text",
  );
  assert.equal(attempt.record.evidence.status, "unknown");
  assert.equal(attempt.record.evidence.coverage, "partial_requirement");
  assert.equal(assessCompletionEvidence(attempt.binding, [attempt.record]).complete, false);
});

test("latest full evidence wins for pass, fail, and contradictory results", () => {
  const pass = observed(
    "node --test",
    { exit_code: 0 },
    "2026-08-31T00:00:00.000Z",
    "pass",
  );
  const fail = observed(
    "node --test",
    { exit_code: 1 },
    "2026-08-31T00:01:00.000Z",
    "fail",
  );
  assert.equal(fail.record.evidence.coverage, "full_requirement");
  assert.equal(assessCompletionEvidence(pass.binding, [pass.record, fail.record]).complete, false);
  assert.equal(assessCompletionEvidence(pass.binding, [fail.record, pass.record]).complete, false);

  const laterPass = observed(
    "node --test",
    { exit_code: 0 },
    "2026-08-31T00:02:00.000Z",
    "later-pass",
  );
  assert.equal(
    assessCompletionEvidence(pass.binding, [pass.record, fail.record, laterPass.record]).complete,
    true,
  );

  const contradictory = structuredClone(laterPass.record);
  contradictory.evidence.status = "contradictory";
  contradictory.evidence.captured_at = "2026-08-31T00:03:00.000Z";
  assert.equal(
    assessCompletionEvidence(pass.binding, [laterPass.record, contradictory]).complete,
    false,
  );
});

test("HTTP status codes use HTTP semantics without replacing process exit codes", () => {
  for (const statusCode of [200, 204, 302]) {
    const attempt = observed(
      "node --test",
      { statusCode },
      "2026-08-31T00:00:00.000Z",
      String(statusCode),
    );
    assert.equal(attempt.record.evidence.status, "pass", String(statusCode));
  }
  for (const statusCode of [400, 503]) {
    const attempt = observed(
      "node --test",
      { statusCode },
      "2026-08-31T00:00:00.000Z",
      String(statusCode),
    );
    assert.equal(attempt.record.evidence.status, "fail", String(statusCode));
  }
});
