// SPDX-License-Identifier: Apache-2.0
import { sha256 } from "./canonical.mjs";

const STRUCTURED_RULE = /^(action|tool|command-prefix):(.+)$/i;

export function parseRule(value) {
  const raw = String(value ?? "").trim();
  const match = raw.match(STRUCTURED_RULE);
  if (!match) return { raw, structured: false };
  return {
    raw,
    structured: true,
    kind: match[1].toLowerCase(),
    value: match[2].trim().toLowerCase(),
  };
}

function matchesRule(rule, action) {
  if (!rule.structured || !rule.value) return false;
  if (rule.kind === "action") {
    const aliases = {
      write: ["write_workspace"],
      external: ["external_side_effect", "publish", "network"],
      destructive: ["destructive", "delete"],
    };
    const accepted = aliases[rule.value] ?? [rule.value];
    return accepted.some((value) => action.tags.includes(value));
  }
  if (rule.kind === "tool") {
    return action.toolName.toLowerCase() === rule.value;
  }
  if (rule.kind === "command-prefix") {
    return action.command.trim().toLowerCase().startsWith(rule.value);
  }
  return false;
}

function baseDecision(overrides = {}) {
  return {
    decision: "continue",
    authority: "deterministic_rule",
    severity: "low",
    reasonCodes: ["no_material_conflict"],
    ruleIds: [],
    evidenceRefs: [],
    visibility: "silent",
    reversible: true,
    coverage: "observed",
    unlock: null,
    ...overrides,
  };
}

function ruleId(bucket, rule) {
  return bucket + ":" + sha256(rule.raw).slice(0, 16);
}

export function decidePreTool({ binding, action, mode = "balanced" }) {
  if (mode === "off") {
    return baseDecision({ reasonCodes: ["guard_disabled"], coverage: "unobserved" });
  }
  if (binding.status !== "bound") {
    if (!action.highRisk) {
      return baseDecision({
        reasonCodes: ["contract_unbound"],
        coverage: "partial",
        reversible: action.reversible,
      });
    }
    return baseDecision({
      decision: "remind",
      authority: "semantic_candidate",
      severity: "medium",
      reasonCodes: ["contract_unbound", "high_risk_action_uncovered"],
      visibility: "model",
      coverage: "partial",
      reversible: action.reversible,
      unlock: "Bind a valid task contract before relying on this guard.",
    });
  }

  const contract = binding.contract;
  const forbidden = [
    ...contract.authorization.forbidden.map((value) => ["forbidden", parseRule(value)]),
    ...contract.must_and_must_not.must_not.map((value) => ["must_not", parseRule(value)]),
  ];
  for (const [bucket, rule] of forbidden) {
    if (!matchesRule(rule, action)) continue;
    if (mode === "shadow") {
      return baseDecision({
        decision: "remind",
        authority: "deterministic_rule",
        severity: "high",
        reasonCodes: ["shadow_would_block", "explicit_contract_conflict"],
        ruleIds: [ruleId(bucket, rule)],
        visibility: "model",
        reversible: action.reversible,
      });
    }
    return baseDecision({
      decision: "block",
      authority: "deterministic_rule",
      severity: "high",
      reasonCodes: ["explicit_contract_conflict"],
      ruleIds: [ruleId(bucket, rule)],
      visibility: "user",
      reversible: action.reversible,
      unlock:
        "Change the contract or choose an action outside the matched " +
        rule.kind +
        " rule.",
    });
  }

  for (const value of contract.authorization.requires_user) {
    const rule = parseRule(value);
    if (!matchesRule(rule, action)) continue;
    if (mode === "shadow") {
      return baseDecision({
        decision: "remind",
        authority: "deterministic_rule",
        severity: "medium",
        reasonCodes: ["shadow_would_ask", "explicit_user_authorization_required"],
        ruleIds: [ruleId("requires_user", rule)],
        visibility: "model",
        reversible: action.reversible,
      });
    }
    return baseDecision({
      decision: "ask",
      authority: "deterministic_rule",
      severity: "medium",
      reasonCodes: ["explicit_user_authorization_required"],
      ruleIds: [ruleId("requires_user", rule)],
      visibility: "user",
      reversible: action.reversible,
      unlock:
        "Ask the user one concise question to authorize or reject this " +
        action.tags.join(", ") +
        " action. Approval is not consumed from chat automatically; before retrying, the canonical contract owner must publish a new contract version that moves this exact rule to allowed.",
    });
  }

  const hasUnstructuredConstraint = [
    ...contract.authorization.forbidden,
    ...contract.authorization.requires_user,
    ...contract.must_and_must_not.must_not,
  ]
    .map(parseRule)
    .some((rule) => !rule.structured);

  if (action.highRisk && hasUnstructuredConstraint) {
    return baseDecision({
      decision: "remind",
      authority: "semantic_candidate",
      severity: "medium",
      reasonCodes: ["semantic_constraint_candidate", "no_deterministic_match"],
      visibility: "model",
      reversible: action.reversible,
      unlock: "Compare the pending action with the natural-language contract constraints.",
    });
  }

  const allowed = contract.authorization.allowed.map(parseRule);
  if (allowed.some((rule) => matchesRule(rule, action))) {
    return baseDecision({
      reasonCodes: ["explicit_contract_allowance"],
      reversible: action.reversible,
    });
  }

  return baseDecision({ reversible: action.reversible });
}

export function messageForDecision(decision, binding, action) {
  const ref =
    binding.status === "bound"
      ? binding.envelope.contract_ref + " v" + binding.envelope.contract_version
      : "unbound contract";
  const label = action.tags.join(", ");
  if (decision.decision === "block") {
    return (
      "Execution Fidelity Guard blocked this " +
      label + " action under " + ref + ". " + decision.unlock
    );
  }
  if (decision.decision === "ask") {
    return (
      "Execution Fidelity Guard paused this " +
      label + " action under " + ref + ". " + decision.unlock
    );
  }
  if (decision.decision === "remind") {
    return (
      "Execution Fidelity Guard advisory for " +
      ref + ": " + decision.reasonCodes.join(", ") + ". " +
      (decision.unlock ?? "")
    ).trim();
  }
  return "";
}
