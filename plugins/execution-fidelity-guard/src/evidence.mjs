// SPDX-License-Identifier: Apache-2.0
import { makeId, sha256 } from "./canonical.mjs";

export function evidenceRequirementRef(index, requirement) {
  return "requirement:" + index + ":" + sha256(requirement).slice(0, 16);
}

function inferStatus(response) {
  if (response && typeof response === "object") {
    if (response.isError === true || response.success === false) return "fail";
    for (const key of ["exit_code", "exitCode", "statusCode"]) {
      if (Number.isInteger(response[key])) return response[key] === 0 ? "pass" : "fail";
    }
    if (response.success === true) return "pass";
  }
  const text =
    typeof response === "string"
      ? response
      : response && typeof response === "object"
        ? String(response.output ?? response.text ?? "")
        : "";
  if (/\b(exit(?:ed)? (?:code|status)|exit_code)\s*[:=]?\s*[1-9]\d*\b/i.test(text)) {
    return "fail";
  }
  if (/\b(exit(?:ed)? (?:code|status)|exit_code)\s*[:=]?\s*0\b/i.test(text)) {
    return "pass";
  }
  return "unknown";
}

function inferKind(input, action) {
  const command = action.command.toLowerCase();
  const toolName = action.toolName.toLowerCase();
  if (
    /(^|[;&|]\s*|\s)(node\s+--test|npm\s+(?:run\s+)?test|pnpm\s+(?:run\s+)?test|yarn\s+test|pytest|cargo\s+test|go\s+test|dotnet\s+test)(\s|$)/i.test(command)
  ) {
    return "test";
  }
  if (/^\s*gh\s+release\s+(?:create|view)\b/i.test(command)) return "release";
  if (toolName === "bash") return "command";
  if (toolName === "apply_patch" || action.tags.includes("write_workspace")) return "file";
  if (/(browser|playwright|screenshot|real_page)/.test(toolName)) return "real_page";
  if (toolName.startsWith("mcp__")) return "api";
  if (action.tags.includes("publish")) return "release";
  return "command";
}

function matchedRequirementRefs(binding, evidence, action) {
  if (binding.status !== "bound" || evidence.status !== "pass") return [];
  const refs = [];
  for (const [index, item] of binding.contract.completion_evidence.entries()) {
    const match = item.requirement
      .trim()
      .toLowerCase()
      .match(/^evidence:([a-z_]+)(?::action:([a-z_]+))?$/);
    if (!match) continue;
    const [, kind, actionTag] = match;
    if (kind !== evidence.kind || !item.acceptable_sources.includes(evidence.kind)) {
      continue;
    }
    if (actionTag && !action.tags.includes(actionTag)) continue;
    refs.push(evidenceRequirementRef(index, item.requirement));
  }
  return refs;
}

export function deriveEvidence(input, event, binding, action, now = new Date()) {
  const status = inferStatus(input.tool_response);
  const kind = inferKind(input, action);
  const evidence = {
    evidence_ref: makeId("ev_", [event.event_id, kind]),
    kind,
    source: action.toolName + ":" + sha256(input.tool_input ?? null).slice(0, 16),
    sha256: sha256(input.tool_response ?? null),
    captured_at: now.toISOString(),
    freshness: "current_event",
    coverage: "partial_requirement",
    status,
    attestation: "hook_observed",
  };
  const requirementRefs = matchedRequirementRefs(binding, evidence, action);
  if (requirementRefs.length) evidence.coverage = "full_requirement";
  return {
    schema_version: "1.0",
    evidence_ref: evidence.evidence_ref,
    contract_ref:
      binding.status === "bound" ? binding.envelope.contract_ref : "unbound",
    contract_version:
      binding.status === "bound" ? binding.envelope.contract_version : 1,
    requirement_refs: requirementRefs,
    evidence,
  };
}

export function assessCompletionEvidence(binding, records) {
  if (binding.status !== "bound") {
    return { complete: false, missing: [], reason: "contract_unbound" };
  }
  const satisfied = new Set();
  for (const record of records) {
    if (
      record.contract_ref !== binding.envelope.contract_ref ||
      record.contract_version !== binding.envelope.contract_version ||
      record.evidence?.status !== "pass" ||
      record.evidence?.coverage !== "full_requirement"
    ) {
      continue;
    }
    for (const ref of record.requirement_refs ?? []) satisfied.add(ref);
  }
  const missing = binding.contract.completion_evidence
    .map((item, index) => ({
      index,
      ref: evidenceRequirementRef(index, item.requirement),
      requirement: item.requirement,
    }))
    .filter((item) => !satisfied.has(item.ref));
  return { complete: missing.length === 0, missing, reason: "evaluated" };
}
