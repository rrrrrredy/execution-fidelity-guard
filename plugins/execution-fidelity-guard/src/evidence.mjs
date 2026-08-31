// SPDX-License-Identifier: Apache-2.0
import { makeId, sha256 } from "./canonical.mjs";

export function evidenceRequirementRef(index, requirement) {
  return "requirement:" + index + ":" + sha256(requirement).slice(0, 16);
}

function inferStatus(response) {
  if (response && typeof response === "object") {
    if (response.isError === true || response.success === false) return "fail";
    for (const key of ["exit_code", "exitCode"]) {
      if (Number.isInteger(response[key])) return response[key] === 0 ? "pass" : "fail";
    }
    if (Number.isInteger(response.statusCode)) {
      if (response.statusCode >= 200 && response.statusCode < 400) return "pass";
      if (response.statusCode >= 400 && response.statusCode < 600) return "fail";
      return "unknown";
    }
    if (response.success === true) return "pass";
  }
  return "unknown";
}

function isDirectTestCommand(command) {
  if (
    /(?:^|\s)(?:--help|-h|--version|--collect-only|--co|-list|--list|--list-tests|--if-present|--no-run)(?:=|\s|$)/i.test(
      command,
    )
  ) return false;
  return /^\s*(?:node\s+--test|npm\s+(?:run\s+)?test|pnpm\s+(?:run\s+)?test|yarn\s+(?:run\s+)?test|pytest|cargo\s+test|go\s+test|dotnet\s+test)(?:\s+[^;&|<>`$(){}\r\n]*)?\s*$/i.test(
    command,
  );
}

function inferKind(input, action) {
  const command = action.command.toLowerCase();
  const toolName = action.toolName.toLowerCase();
  if (isDirectTestCommand(command)) return "test";
  if (toolName === "bash") return "command";
  if (toolName === "apply_patch" || action.tags.includes("write_workspace")) return "file";
  if (/(browser|playwright|screenshot|real_page)/.test(toolName)) return "real_page";
  if (toolName.startsWith("mcp__")) return "api";
  return "command";
}

function matchedRequirementRefs(binding, evidence, action) {
  if (binding.status !== "bound") return [];
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
  if (requirementRefs.length && status !== "unknown") {
    evidence.coverage = "full_requirement";
  }
  return {
    schema_version: "2.0",
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
  const latest = new Map();
  for (const [recordIndex, record] of records.entries()) {
    if (
      record.contract_ref !== binding.envelope.contract_ref ||
      record.contract_version !== binding.envelope.contract_version
    ) {
      continue;
    }
    const capturedAt = Date.parse(record.evidence?.captured_at ?? "");
    const timestamp = Number.isFinite(capturedAt) ? capturedAt : Number.NEGATIVE_INFINITY;
    for (const ref of record.requirement_refs ?? []) {
      const prior = latest.get(ref);
      if (
        !prior ||
        timestamp > prior.timestamp ||
        (timestamp === prior.timestamp && recordIndex > prior.recordIndex)
      ) {
        latest.set(ref, {
          status: record.evidence?.status,
          coverage: record.evidence?.coverage,
          timestamp,
          recordIndex,
        });
      }
    }
  }
  const missing = binding.contract.completion_evidence
    .map((item, index) => ({
      index,
      ref: evidenceRequirementRef(index, item.requirement),
      requirement: item.requirement,
    }))
    .filter((item) => {
      const evidence = latest.get(item.ref);
      return (
        evidence?.status !== "pass" ||
        evidence?.coverage !== "full_requirement"
      );
    });
  return { complete: missing.length === 0, missing, reason: "evaluated" };
}
