// SPDX-License-Identifier: Apache-2.0
import { assessCompletionEvidence } from "./evidence.mjs";

export function hasCompletionClaim(value) {
  const text = String(value ?? "");
  if (!text.trim()) return false;
  const clauses = text.split(/[.!?;,\n。！？；，]+|\b(?:but|however|yet\s+(?=(?:the|we|it|all)\b))\b|但是|不过|然而|但/i);
  const negatives = [
    /(?:尚未|还没|没有|未能|无法|不能|未).{0,8}(?:完成|交付|发布|上线|搞定)/,
    /\b(?:not|never|isn't|wasn't|aren't|weren't|haven't|hasn't)(?:\s+yet)?\s+(?:done|complete[d]?|finished|shipped|released|production-ready|all tests pass(?:ed)?)\b/i,
  ];
  const positives = [
    /(?:已(?:经)?(?:完成|交付|发布|上线)|全部完成|完成了|交付完成|搞定)/,
    /\b(?:done|completed|finished|shipped|released|production-ready)\b/i,
    /\b(?:is|are|was|were) complete\b|\ball tests pass(?:ed)?\b/i,
  ];
  return clauses.some((clause) =>
    !negatives.some((pattern) => pattern.test(clause)) &&
    positives.some((pattern) => pattern.test(clause)),
  );
}

export function assessStop(binding, evidenceRecords, assistantMessage) {
  if (!hasCompletionClaim(assistantMessage)) {
    return { shouldVerify: false, complete: false, missing: [] };
  }
  const evidence = assessCompletionEvidence(binding, evidenceRecords);
  return {
    shouldVerify: binding.status === "bound",
    complete: evidence.complete,
    missing: evidence.missing,
    reason: evidence.reason,
  };
}
