import assert from "node:assert/strict";
import test from "node:test";
import {
  compactContractContext,
  parseContractDocument,
  validateTaskContractLite,
} from "../plugins/execution-fidelity-guard/src/contract.mjs";
import { sha256 } from "../plugins/execution-fidelity-guard/src/canonical.mjs";
import { makeContract } from "../test-support/helpers.mjs";

test("plain TaskContractLite binds with a content-derived reference", () => {
  const contract = makeContract();
  const result = parseContractDocument(contract, {
    modifiedAt: "2026-08-28T00:00:00.000Z",
  });
  assert.equal(result.status, "bound");
  assert.match(result.envelope.contract_ref, /^lite:[a-f0-9]{20}$/);
  assert.equal(result.provider, "task-contract-lite");
});

test("user-intent provider requires an envelope plus bounded projection", () => {
  const contract = makeContract();
  const result = parseContractDocument({
    envelope: {
      schema_version: "1.0",
      contract_ref: "intent:123",
      contract_version: 4,
      source: "user-intent-plugin",
      source_message_refs: ["msg:1"],
      snapshot_sha256: sha256(contract),
      updated_at: "2026-08-28T00:00:00.000Z",
    },
    projection: contract,
  });
  assert.equal(result.status, "bound");
  assert.equal(result.provider, "user-intent-plugin");
  assert.equal(result.envelope.contract_version, 4);
});

test("user-intent provider rejects a missing or mismatched projection hash", () => {
  const contract = makeContract();
  const envelope = {
    schema_version: "1.0",
    contract_ref: "intent:123",
    contract_version: 4,
    source: "user-intent-plugin",
    source_message_refs: ["msg:1"],
    updated_at: "2026-08-28T00:00:00.000Z",
  };
  const missing = parseContractDocument({ envelope, projection: contract });
  assert.equal(missing.status, "invalid");
  assert.ok(missing.errors.some((error) => error.includes("requires snapshot_sha256")));

  const mismatch = parseContractDocument({
    envelope: { ...envelope, snapshot_sha256: "0".repeat(64) },
    projection: contract,
  });
  assert.equal(mismatch.status, "invalid");
  assert.ok(mismatch.errors.some((error) => error.includes("canonical projection")));
});

test("bare user-intent envelope is rejected because it has no policy projection", () => {
  const result = parseContractDocument({
    schema_version: "1.0",
    contract_ref: "intent:123",
    contract_version: 1,
    source: "user-intent-plugin",
    source_message_refs: [],
    updated_at: "2026-08-28T00:00:00.000Z",
  });
  assert.equal(result.status, "invalid");
  assert.ok(result.errors.some((error) => error.includes("bounded projection")));
});

test("explicit fallback envelope requires a matching canonical snapshot hash", () => {
  const contract = makeContract();
  const envelope = {
    schema_version: "1.0",
    contract_ref: "fallback:test",
    contract_version: 1,
    source: "task-contract-lite",
    source_message_refs: [],
    snapshot_sha256: "0".repeat(64),
    task_contract_lite: contract,
    updated_at: "2026-08-28T00:00:00.000Z",
  };
  const mismatch = parseContractDocument(envelope);
  assert.equal(mismatch.status, "invalid");
  assert.ok(mismatch.errors.some((error) => error.includes("canonical task contract")));

  const valid = parseContractDocument({
    ...envelope,
    snapshot_sha256: sha256(contract),
  });
  assert.equal(valid.status, "bound");
  assert.equal(valid.snapshotHash, sha256(contract));
});

test("generated init placeholders are structurally valid but not ready to bind", () => {
  const contract = {
    ...makeContract({ mustNot: [] }),
    objective: "Replace with the exact user-requested outcome.",
    primary_object: "Replace with the primary object being changed or delivered.",
    must_and_must_not: {
      must: ["Replace with non-negotiable requirements."],
      must_not: [],
    },
  };
  assert.deepEqual(validateTaskContractLite(contract), []);
  const result = parseContractDocument(contract);
  assert.equal(result.status, "invalid");
  assert.ok(result.errors.some((error) => error.includes("init placeholders")));
});

test("unknown fields fail strict fallback validation", () => {
  const contract = { ...makeContract(), hidden_transcript: "must not exist" };
  const errors = validateTaskContractLite(contract);
  assert.ok(errors.some((error) => error.includes("hidden_transcript")));
});

test("contract context redacts credentials before model visibility", () => {
  const token = ["ghp", "_", "a".repeat(36)].join("");
  const contract = makeContract({
    mustNot: ["token=" + token],
  });
  const result = parseContractDocument(contract);
  const context = compactContractContext(result);
  assert.equal(context.includes(token), false);
  assert.ok(context.includes("[REDACTED"));
});
