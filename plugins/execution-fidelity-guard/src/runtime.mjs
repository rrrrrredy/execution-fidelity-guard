// SPDX-License-Identifier: Apache-2.0
import {
  identifierReference,
  makeId,
  sessionReference,
  sha256,
  toEventType,
} from "./canonical.mjs";
import { classifyToolAction } from "./classify.mjs";
import { assessStop } from "./completion.mjs";
import { loadConfig } from "./config.mjs";
import { compactContractContext, loadContract } from "./contract.mjs";
import { deriveEvidence } from "./evidence.mjs";
import { decidePreTool, messageForDecision } from "./policy.mjs";
import {
  bestEffort,
  deleteSession,
  pruneExpiredSessions,
  readRecords,
  transitionStopState,
  writeRecord,
} from "./store.mjs";

const SUPPORTED_EVENTS = new Set([
  "SessionStart",
  "SubagentStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PreCompact",
  "PostCompact",
  "SubagentStop",
  "Stop",
  "SessionEnd",
]);

function contractIdentity(binding) {
  return binding.status === "bound"
    ? {
        contractRef: binding.envelope.contract_ref,
        contractVersion: binding.envelope.contract_version,
      }
    : { contractRef: "unbound", contractVersion: 1 };
}

function eventHashInput(input) {
  switch (input.hook_event_name) {
    case "UserPromptSubmit":
      return input.prompt ?? null;
    case "PreToolUse":
    case "PermissionRequest":
    case "PostToolUse":
      return input.tool_input ?? null;
    case "Stop":
    case "SubagentStop":
      return input.last_assistant_message ?? null;
    case "SessionStart":
      return input.source ?? null;
    case "SubagentStart":
      return { agent_id: input.agent_id ?? null, agent_type: input.agent_type ?? null };
    case "PreCompact":
    case "PostCompact":
      return input.trigger ?? null;
    case "SessionEnd":
      return input.reason ?? null;
    default:
      return null;
  }
}

function eventFacts(input, binding, action) {
  const facts = { contract_status: binding.status };
  if (binding.status === "bound") facts.contract_provider = binding.provider;
  if (input.permission_mode) facts.permission_mode = String(input.permission_mode);
  if (input.source) facts.source = String(input.source);
  if (input.trigger) facts.trigger = String(input.trigger);
  if (input.reason) facts.reason = String(input.reason);
  if (input.agent_type) facts.agent_type = String(input.agent_type);
  if (action) {
    facts.action_tags = action.tags;
    facts.reversible = action.reversible;
  }
  return facts;
}

function normalizedEvent(input, binding, action, now) {
  const identity = contractIdentity(binding);
  const eventType = toEventType(input.hook_event_name);
  return {
    schema_version: "2.0",
    event_id: makeId("evt_", [
      input.session_id,
      input.turn_id,
      input.tool_use_id,
      eventType,
    ]),
    session_id: sessionReference(input.session_id),
    turn_id:
      input.turn_id == null ? null : identifierReference("turn", input.turn_id),
    tool_use_id:
      input.tool_use_id == null
        ? null
        : identifierReference("tool-use", input.tool_use_id),
    event_type: eventType,
    observed_at: now.toISOString(),
    tool_name: input.tool_name == null ? null : String(input.tool_name),
    contract_ref: identity.contractRef,
    contract_version: identity.contractVersion,
    coverage: binding.status === "bound" ? "observed" : "partial",
    input_sha256: sha256(eventHashInput(input)),
    result_sha256:
      input.hook_event_name === "PostToolUse"
        ? sha256(input.tool_response ?? null)
        : null,
    facts: eventFacts(input, binding, action),
  };
}

function continueDecision(overrides = {}) {
  return {
    decision: "continue",
    authority: "deterministic_rule",
    severity: "low",
    reasonCodes: ["event_observed"],
    ruleIds: [],
    evidenceRefs: [],
    visibility: "silent",
    reversible: true,
    coverage: "observed",
    unlock: null,
    ...overrides,
  };
}

function receiptFor(event, decision, now, latencyMs) {
  return {
    schema_version: "1.0",
    receipt_id: makeId("rcpt_", [event.event_id, decision.decision]),
    event_ref: event.event_id,
    contract_ref: event.contract_ref,
    contract_version: event.contract_version,
    decision: decision.decision,
    authority: decision.authority,
    severity: decision.severity,
    reason_codes: decision.reasonCodes,
    rule_ids: decision.ruleIds,
    evidence_refs: decision.evidenceRefs,
    visibility: decision.visibility,
    reversible: decision.reversible,
    coverage: decision.coverage,
    unlock: decision.unlock,
    semantic_model: null,
    decided_at: now.toISOString(),
    latency_ms: latencyMs,
  };
}

function preToolOutput(decision, binding, action) {
  const message = messageForDecision(decision, binding, action);
  if (decision.decision === "block" || decision.decision === "ask") {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: message,
      },
    };
  }
  if (decision.decision === "remind") {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: message,
      },
    };
  }
  return null;
}

function permissionOutput(decision, binding, action) {
  const message = messageForDecision(decision, binding, action);
  if (decision.decision === "block" || decision.decision === "ask") {
    return {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "deny", message },
      },
    };
  }
  if (decision.decision === "remind") return { systemMessage: message };
  return null;
}

function contractPromptContext(binding) {
  if (binding.status !== "bound") return null;
  return (
    "Execution Fidelity Guard: contract " +
    binding.envelope.contract_ref +
    " v" +
    binding.envelope.contract_version +
    " remains active. Treat the new prompt as continuation or amendment unless it explicitly replaces the objective."
  );
}

function contractSessionContext(binding, sessionId) {
  const prefix =
    "Guard session reference: " +
    sessionReference(sessionId) +
    ". Reuse this pseudonymous value for source CLI status, evidence, and receipt commands. ";
  return (prefix + compactContractContext(binding)).slice(0, 1200);
}

async function stopDecision({ input, binding, config, sessionId, now }) {
  const evidenceRecords = await bestEffort(() =>
    readRecords(config, sessionId, "evidence"),
  );
  const assessment = assessStop(
    binding,
    evidenceRecords ?? [],
    input.last_assistant_message,
  );
  if (!assessment.shouldVerify || assessment.complete) {
    if (assessment.complete) {
      await bestEffort(() =>
        transitionStopState(config, sessionId, () => ({
          state: {
            schema_version: "1.0",
            contract_ref: binding.envelope.contract_ref,
            contract_version: binding.envelope.contract_version,
            attempts: 0,
            updated_at: now.toISOString(),
          },
          value: true,
        })),
      );
    }
    return { decision: continueDecision(), output: {} };
  }

  const missingIndexes = assessment.missing
    .slice(0, 8)
    .map((item) => "#" + (item.index + 1))
    .join(", ");

  let transition;
  if (config.persist) {
    transition = await bestEffort(() =>
      transitionStopState(config, sessionId, (prior) => {
        const sameContract =
          prior?.contract_ref === binding.envelope.contract_ref &&
          prior?.contract_version === binding.envelope.contract_version;
        const attempts = sameContract ? Number(prior.attempts || 0) : 0;
        if (attempts >= config.maxStopContinuations) {
          return { value: { continue: false, attempts } };
        }
        return {
          state: {
            schema_version: "1.0",
            contract_ref: binding.envelope.contract_ref,
            contract_version: binding.envelope.contract_version,
            attempts: attempts + 1,
            updated_at: now.toISOString(),
          },
          value: { continue: true, attempts },
        };
      }),
    );
    if (!transition) {
      const warning =
        "Execution Fidelity Guard could not update the completion counter. Completion remains unverified for requirement(s) " +
        missingIndexes +
        "; the turn will not be continued automatically.";
      return {
        decision: continueDecision({
          decision: "remind",
          authority: "external_evidence",
          severity: "high",
          reasonCodes: ["completion_claim_unverified", "stop_state_unavailable"],
          visibility: "user",
          unlock: warning,
        }),
        output: { systemMessage: warning },
      };
    }
  } else {
    const attempts = input.stop_hook_active ? config.maxStopContinuations : 0;
    transition = {
      continue: attempts < config.maxStopContinuations,
      attempts,
    };
  }

  if (transition.continue) {
    const reason =
      "Execution Fidelity Guard found an explicit completion claim but lacks full, passing evidence for requirement(s) " +
      missingIndexes +
      ". Run a focused verification pass and record contract-bound evidence. Do not repeat the completion claim without new evidence.";
    return {
      decision: continueDecision({
        decision: "continue_verification",
        authority: "external_evidence",
        severity: "high",
        reasonCodes: ["completion_claim_unverified", "required_evidence_missing"],
        visibility: "model",
        unlock: reason,
      }),
      output: { decision: "block", reason },
    };
  }

  const warning =
    "Execution Fidelity Guard reached its continuation cap. Completion remains unverified for requirement(s) " +
    missingIndexes +
    "; this warning does not prove the task is complete.";
  return {
    decision: continueDecision({
      decision: "remind",
      authority: "external_evidence",
      severity: "high",
      reasonCodes: ["completion_claim_unverified", "continuation_cap_reached"],
      visibility: "user",
      unlock: warning,
    }),
    output: { systemMessage: warning },
  };
}

export async function handleHook(input, options = {}) {
  const startedAt = Date.now();
  const eventName = String(input.hook_event_name ?? "");
  if (!SUPPORTED_EVENTS.has(eventName)) return null;

  const now = options.now ? new Date(options.now) : new Date();
  const config = options.config ?? loadConfig(input, options.env);
  const binding =
    options.binding ?? (await loadContract(input, { env: options.env }));
  const sessionId = String(input.session_id || "unknown");
  if (eventName === "SessionStart") {
    await bestEffort(() => pruneExpiredSessions(config, now));
  }
  const action = ["PreToolUse", "PermissionRequest", "PostToolUse"].includes(eventName)
    ? classifyToolAction(input)
    : null;
  const event = normalizedEvent(input, binding, action, now);
  await bestEffort(() => writeRecord(config, sessionId, "events", event));

  let decision = continueDecision({
    coverage: binding.status === "bound" ? "observed" : "partial",
  });
  let output = null;

  if (eventName === "SessionStart") {
    output = {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: contractSessionContext(binding, sessionId),
      },
    };
  } else if (eventName === "SubagentStart") {
    output = {
      hookSpecificOutput: {
        hookEventName: "SubagentStart",
        additionalContext: contractSessionContext(binding, sessionId),
      },
    };
  } else if (eventName === "UserPromptSubmit") {
    const context = contractPromptContext(binding);
    output = context
      ? {
          hookSpecificOutput: {
            hookEventName: "UserPromptSubmit",
            additionalContext: context,
          },
        }
      : null;
  } else if (eventName === "PreToolUse") {
    decision = decidePreTool({ binding, action, mode: config.mode });
    output = preToolOutput(decision, binding, action);
  } else if (eventName === "PermissionRequest") {
    decision = decidePreTool({ binding, action, mode: config.mode });
    output = permissionOutput(decision, binding, action);
  } else if (eventName === "PostToolUse") {
    const evidenceRecord = deriveEvidence(input, event, binding, action, now);
    await bestEffort(() =>
      writeRecord(config, sessionId, "evidence", evidenceRecord),
    );
    if (evidenceRecord.evidence.status === "fail") {
      const message =
        "Execution Fidelity Guard recorded a failed tool result. Treat it as contradictory evidence and continue verification before claiming completion.";
      decision = continueDecision({
        decision: "continue_verification",
        authority: "external_evidence",
        severity: "medium",
        reasonCodes: ["tool_result_failed", "completion_evidence_not_satisfied"],
        evidenceRefs: [evidenceRecord.evidence_ref],
        visibility: "model",
      });
      output = {
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: message,
        },
      };
    } else {
      decision = continueDecision({
        authority: "external_evidence",
        reasonCodes: ["tool_result_recorded"],
        evidenceRefs: [evidenceRecord.evidence_ref],
      });
    }
  } else if (eventName === "Stop") {
    const result = await stopDecision({
      input,
      binding,
      config,
      sessionId,
      now,
    });
    decision = result.decision;
    output = result.output;
  }

  const receipt = receiptFor(event, decision, now, Date.now() - startedAt);
  await bestEffort(() => writeRecord(config, sessionId, "receipts", receipt));
  if (eventName === "SessionEnd" && config.deleteOnSessionEnd) {
    await bestEffort(() => deleteSession(config, sessionId));
  }
  return output;
}
