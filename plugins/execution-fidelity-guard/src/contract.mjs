// SPDX-License-Identifier: Apache-2.0
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { redactText, sha256 } from "./canonical.mjs";

const REQUIRED_TOP_LEVEL = [
  "objective",
  "primary_object",
  "delivery_surface",
  "scope",
  "must_and_must_not",
  "authorization",
  "completion_evidence",
];

const INIT_PLACEHOLDERS = new Set([
  "Replace with the exact user-requested outcome.",
  "Replace with the primary object being changed or delivered.",
  "Replace with non-negotiable requirements.",
]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function containsInitPlaceholder(value) {
  if (typeof value === "string") return INIT_PLACEHOLDERS.has(value.trim());
  if (Array.isArray(value)) return value.some(containsInitPlaceholder);
  if (isRecord(value)) return Object.values(value).some(containsInitPlaceholder);
  return false;
}

function contractReadinessErrors(value) {
  return containsInitPlaceholder(value)
    ? ["contract contains generated init placeholders"]
    : [];
}

function exactKeys(value, allowed, label, errors) {
  if (!isRecord(value)) {
    errors.push(label + " must be an object");
    return;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(label + " has unsupported field: " + key);
  }
}

function stringArray(value, label, errors, { min = 0 } = {}) {
  if (!Array.isArray(value) || value.length < min) {
    errors.push(label + " must be an array with at least " + min + " item(s)");
    return;
  }
  if (value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    errors.push(label + " must contain only non-empty strings");
  }
}

export function validateTaskContractLite(value) {
  const errors = [];
  exactKeys(value, REQUIRED_TOP_LEVEL, "contract", errors);
  if (!isRecord(value)) return errors;
  for (const key of REQUIRED_TOP_LEVEL) {
    if (!(key in value)) errors.push("contract is missing required field: " + key);
  }
  for (const key of ["objective", "primary_object"]) {
    if (typeof value[key] !== "string" || !value[key].trim()) {
      errors.push(key + " must be a non-empty string");
    }
  }
  stringArray(value.delivery_surface, "delivery_surface", errors, { min: 1 });
  exactKeys(value.scope, ["include", "exclude"], "scope", errors);
  if (isRecord(value.scope)) {
    stringArray(value.scope.include, "scope.include", errors);
    stringArray(value.scope.exclude, "scope.exclude", errors);
  }
  exactKeys(
    value.must_and_must_not,
    ["must", "must_not"],
    "must_and_must_not",
    errors,
  );
  if (isRecord(value.must_and_must_not)) {
    stringArray(value.must_and_must_not.must, "must_and_must_not.must", errors);
    stringArray(
      value.must_and_must_not.must_not,
      "must_and_must_not.must_not",
      errors,
    );
  }
  exactKeys(
    value.authorization,
    ["allowed", "requires_user", "forbidden"],
    "authorization",
    errors,
  );
  if (isRecord(value.authorization)) {
    for (const key of ["allowed", "requires_user", "forbidden"]) {
      stringArray(value.authorization[key], "authorization." + key, errors);
    }
  }
  if (!Array.isArray(value.completion_evidence) || value.completion_evidence.length < 1) {
    errors.push("completion_evidence must contain at least one requirement");
  } else {
    const allowedKinds = new Set([
      "file", "command", "test", "api", "database", "real_page", "release", "user",
    ]);
    for (const [index, item] of value.completion_evidence.entries()) {
      const label = "completion_evidence[" + index + "]";
      exactKeys(item, ["requirement", "acceptable_sources"], label, errors);
      if (!isRecord(item)) continue;
      if (typeof item.requirement !== "string" || !item.requirement.trim()) {
        errors.push(label + ".requirement must be a non-empty string");
      }
      stringArray(item.acceptable_sources, label + ".acceptable_sources", errors, {
        min: 1,
      });
      if (
        Array.isArray(item.acceptable_sources) &&
        item.acceptable_sources.some((kind) => !allowedKinds.has(kind))
      ) {
        errors.push(label + ".acceptable_sources contains an unsupported kind");
      }
    }
  }
  return errors;
}

function validateEnvelope(value) {
  const errors = [];
  if (!isRecord(value)) return ["envelope must be an object"];
  exactKeys(value, [
    "schema_version", "contract_ref", "contract_version", "source",
    "source_message_refs", "snapshot_sha256", "task_contract_lite", "updated_at",
  ], "envelope", errors);
  if (value.schema_version !== "1.0") errors.push("unsupported schema_version");
  if (typeof value.contract_ref !== "string" || !value.contract_ref.trim()) {
    errors.push("contract_ref must be a non-empty string");
  }
  if (!Number.isInteger(value.contract_version) || value.contract_version < 1) {
    errors.push("contract_version must be a positive integer");
  }
  if (!["user-intent-plugin", "task-contract-lite"].includes(value.source)) {
    errors.push("source must be user-intent-plugin or task-contract-lite");
  }
  stringArray(value.source_message_refs, "source_message_refs", errors);
  if (typeof value.updated_at !== "string" || Number.isNaN(Date.parse(value.updated_at))) {
    errors.push("updated_at must be an ISO date-time");
  }
  if (
    value.snapshot_sha256 !== undefined &&
    !/^[a-f0-9]{64}$/.test(value.snapshot_sha256)
  ) {
    errors.push("snapshot_sha256 must be a lowercase SHA-256");
  }
  if (value.source === "task-contract-lite") {
    if (!value.task_contract_lite) errors.push("task_contract_lite is required");
  } else if ("task_contract_lite" in value) {
    errors.push("user-intent-plugin envelope cannot embed task_contract_lite");
  }
  return errors;
}

export function parseContractDocument(raw, metadata = {}) {
  const modifiedAt = metadata.modifiedAt ?? new Date(0).toISOString();
  if (isRecord(raw) && "envelope" in raw && "projection" in raw) {
    const wrapperErrors = [];
    exactKeys(raw, ["envelope", "projection"], "provider document", wrapperErrors);
    const envelopeErrors = validateEnvelope(raw.envelope);
    const projectionErrors = [
      ...validateTaskContractLite(raw.projection),
      ...contractReadinessErrors(raw.projection),
    ];
    const projectionHash = sha256(raw.projection);
    if (raw.envelope?.source !== "user-intent-plugin") {
      envelopeErrors.push("provider document envelope must use user-intent-plugin source");
    }
    if (raw.envelope?.snapshot_sha256 === undefined) {
      envelopeErrors.push("provider document requires snapshot_sha256");
    } else if (raw.envelope.snapshot_sha256 !== projectionHash) {
      envelopeErrors.push("snapshot_sha256 does not match the canonical projection");
    }
    const errors = [...wrapperErrors, ...envelopeErrors, ...projectionErrors];
    return errors.length
      ? { status: "invalid", errors }
      : {
          status: "bound",
          envelope: raw.envelope,
          contract: raw.projection,
          provider: "user-intent-plugin",
          snapshotHash: projectionHash,
        };
  }
  if (isRecord(raw) && "schema_version" in raw && "contract_ref" in raw) {
    const errors = validateEnvelope(raw);
    let snapshotHash = null;
    if (raw.source === "task-contract-lite") {
      errors.push(...validateTaskContractLite(raw.task_contract_lite));
      errors.push(...contractReadinessErrors(raw.task_contract_lite));
      if (isRecord(raw.task_contract_lite)) {
        snapshotHash = sha256(raw.task_contract_lite);
      }
      if (raw.snapshot_sha256 === undefined) {
        errors.push("task-contract-lite envelope requires snapshot_sha256");
      } else if (snapshotHash && raw.snapshot_sha256 !== snapshotHash) {
        errors.push("snapshot_sha256 does not match the canonical task contract");
      }
    } else {
      errors.push("user-intent-plugin envelopes require a separate bounded projection");
    }
    return errors.length
      ? { status: "invalid", errors }
      : {
          status: "bound",
          envelope: raw,
          contract: raw.task_contract_lite,
          provider: "task-contract-lite",
          snapshotHash,
        };
  }
  const errors = [
    ...validateTaskContractLite(raw),
    ...contractReadinessErrors(raw),
  ];
  if (errors.length) return { status: "invalid", errors };
  const snapshotHash = sha256(raw);
  return {
    status: "bound",
    envelope: {
      schema_version: "1.0",
      contract_ref: "lite:" + snapshotHash.slice(0, 20),
      contract_version: 1,
      source: "task-contract-lite",
      source_message_refs: [],
      snapshot_sha256: snapshotHash,
      updated_at: modifiedAt,
      task_contract_lite: raw,
    },
    contract: raw,
    provider: "task-contract-lite",
    snapshotHash,
  };
}

export function resolveContractPath(input, env = process.env) {
  const cwd = path.resolve(String(input.cwd || process.cwd()));
  const configured = env.EFG_CONTRACT_PATH?.trim();
  return configured
    ? path.resolve(cwd, configured)
    : path.join(cwd, ".execution-fidelity", "contract.json");
}

export async function loadContract(input, options = {}) {
  const contractPath = resolveContractPath(input, options.env);
  try {
    const info = await stat(contractPath);
    if (!info.isFile()) {
      return { status: "unbound", path: contractPath, errors: ["not a file"] };
    }
    if (info.size > 256 * 1024) {
      return {
        status: "invalid",
        path: contractPath,
        errors: ["contract exceeds the 256 KiB safety limit"],
      };
    }
    const raw = JSON.parse(await readFile(contractPath, "utf8"));
    return {
      ...parseContractDocument(raw, { modifiedAt: info.mtime.toISOString() }),
      path: contractPath,
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { status: "unbound", path: contractPath, errors: [] };
    }
    return {
      status: "invalid",
      path: contractPath,
      errors: [redactText(error?.message || "contract load failed", 200)],
    };
  }
}

export function compactContractContext(binding) {
  if (binding.status !== "bound") {
    return "Execution Fidelity Guard is unbound and advisory only. No action will be blocked until a valid task contract is provided.";
  }
  const { envelope, contract } = binding;
  const rules = [
    ...contract.must_and_must_not.must_not,
    ...contract.authorization.requires_user,
    ...contract.authorization.forbidden,
  ]
    .slice(0, 12)
    .map((item) => redactText(item, 120));
  const parts = [
    "Execution Fidelity Guard contract " +
      envelope.contract_ref + " v" + envelope.contract_version + " is active.",
    "Objective: " + redactText(contract.objective, 220),
    "Primary object: " + redactText(contract.primary_object, 160),
  ];
  if (rules.length) parts.push("Active constraints: " + rules.join("; "));
  return parts.join(" ");
}
