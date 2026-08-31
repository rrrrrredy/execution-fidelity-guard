// SPDX-License-Identifier: Apache-2.0
import { createHash, randomUUID } from "node:crypto";

export const MAX_HOOK_INPUT_BYTES = 1024 * 1024;

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, sortValue(value[key])]),
    );
  }
  return value;
}

export function stableStringify(value) {
  return JSON.stringify(sortValue(value));
}

export function sha256(value) {
  const input =
    typeof value === "string" || Buffer.isBuffer(value)
      ? value
      : stableStringify(value);
  return createHash("sha256").update(input).digest("hex");
}

export function identifierReference(kind, value) {
  const prefix = String(kind ?? "identifier")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-") || "identifier";
  return prefix + ":" + sha256(String(value ?? "unknown"));
}

export function sessionReference(value) {
  return identifierReference("session", value);
}

export function makeId(prefix, parts = []) {
  return prefix + sha256([...parts, Date.now(), randomUUID()]).slice(0, 24);
}

export function safeId(value, fallback = "unknown") {
  return (
    String(value ?? "").trim().replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 96) ||
    fallback
  );
}

export function redactText(value, maxLength = 1000) {
  return String(value ?? "")
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{12,})\b/g,
      "[REDACTED_TOKEN]",
    )
    .replace(
      /\b(password|passwd|token|secret|authorization|api[_-]?key)\b\s*[:=]\s*([^\s,;]+)/gi,
      "$1=[REDACTED]",
    )
    .slice(0, maxLength);
}

export async function readJsonStdin(
  stream = process.stdin,
  maxBytes = MAX_HOOK_INPUT_BYTES,
) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) {
      throw new Error("hook input exceeds the 1 MiB safety limit");
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) throw new Error("hook input is empty");
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("hook input must be a JSON object");
  }
  return parsed;
}

export function toEventType(hookEventName) {
  return String(hookEventName ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
}
