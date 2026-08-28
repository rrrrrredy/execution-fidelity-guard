// SPDX-License-Identifier: Apache-2.0
import { assessCompletionEvidence } from "./evidence.mjs";

export function hasCompletionClaim(value) {
  const text = String(value ?? "");
  if (!text.trim()) return false;
  const negatives = [
    /(?:尚未|还没|没有|未能|无法|不能).{0,8}(?:完成|交付|发布|上线)/,
    /\b(?:not|isn't|is not|wasn't|was not)\s+(?:done|complete|completed|finished|shipped|released)\b/i,
  ];
  if (negatives.some((pattern) => pattern.test(text))) return false;
  return [
    /(?:已完成|全部完成|完成了|已交付|交付完成|已经完成|已发布|已上线|搞定)/,
    /\b(?:done|completed|finished|shipped|released|production-ready)\b/i,
    /\ball tests pass(?:ed)?\b/i,
  ].some((pattern) => pattern.test(text));
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
