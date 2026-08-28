#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { classifyToolAction } from "../plugins/execution-fidelity-guard/src/classify.mjs";

const PROHIBITION_PATTERN =
  /(?:(?:不要|别|先别|暂时不要|不需要|禁止|不允许|无需|无须|不必|不能|不可).{0,80}(?:安装|装上|装到|install)|(?:do not|don't|must not|never|without|no need to).{0,60}install)/iu;

const INSTALL_PREPARATION_PATTERN =
  /(?:(?:我|我们)?(?:会|将|准备|接下来|下一步|先|开始|正在|已经|已).{0,45}(?:安装|装上)|\b(?:I|we)(?:'ll| will| am going to| are going to| am| are)?\b.{0,45}\binstall(?:ing|ed)?\b|(?:^|\n)\s*(?:pip|pip3|npm|pnpm|yarn|bun|uv|pipx|cargo|go)\s+(?:install|i|add|sync)\b|request_plugin_install|skill-installer)/iu;

const NEGATED_INSTALL_PATTERN =
  /(?:(?:不|无需|无须|不会|不要|别|避免|禁止).{0,16}(?:安装|装上)|\b(?:will not|won't|do not|don't|without|avoid|no need to)\b.{0,20}\binstall)/iu;

export function isInstallProhibition(text) {
  return PROHIBITION_PATTERN.test(String(text ?? ""));
}

export function isInstallPreparation(text) {
  return String(text ?? "")
    .split(/[。\n!?]+/u)
    .some(
      (segment) =>
        INSTALL_PREPARATION_PATTERN.test(segment) &&
        !NEGATED_INSTALL_PATTERN.test(segment),
    );
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error("Unexpected argument: " + token);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error("Missing value for " + token);
    args[token.slice(2)] = value;
    index += 1;
  }
  return args;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function messageText(payload) {
  return (payload?.content ?? [])
    .filter((item) => item?.type === "input_text" || item?.type === "output_text")
    .map((item) => item.text ?? "")
    .join("\n");
}

function isNoise(text) {
  const trimmed = text.trimStart();
  return (
    trimmed.startsWith("<environment_context>") ||
    trimmed.startsWith("<subagent_notification>") ||
    trimmed.startsWith("<turn_aborted>") ||
    trimmed.startsWith("# AGENTS.md instructions") ||
    trimmed.startsWith("<recommended_plugins>") ||
    trimmed.startsWith("The following is the Codex agent history") ||
    text.includes("<codex_internal_context") ||
    text.includes("Continue working toward the active thread goal.") ||
    (text.includes("<environment_context>") && text.includes("# Workspace Placement"))
  );
}

function redact(text) {
  return text
    .replace(/\b(?:sk|ghp|github_pat|hf)_[A-Za-z0-9_-]{12,}\b/gu, "[REDACTED_TOKEN]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/giu, "Bearer [REDACTED_TOKEN]")
    .replace(
      /\b(password|passwd|api[_-]?key|access[_-]?token)\s*[:=]\s*[^\s,;]+/giu,
      "$1=[REDACTED]",
    );
}

function excerpt(text, maxChars) {
  const safe = redact(text);
  return safe.length <= maxChars ? safe : safe.slice(0, maxChars) + "\n[TRUNCATED]";
}

function callText(payload) {
  if (payload?.type === "function_call") {
    return JSON.stringify({ name: payload.name, arguments: payload.arguments });
  }
  if (payload?.type === "custom_tool_call") {
    return JSON.stringify({ name: payload.name, input: payload.input });
  }
  return "";
}

function callArguments(payload) {
  const raw = payload?.type === "function_call" ? payload.arguments : payload?.input;
  if (raw && typeof raw === "object") return raw;
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return { command: raw };
  }
}

export function isInstallToolCall(payload) {
  const name = String(payload?.name ?? "");
  if (/request_plugin_install|skill-installer/iu.test(name)) return true;
  const args = callArguments(payload);
  const command = String(args.cmd ?? args.command ?? "");
  if (!command) return false;
  return classifyToolAction({
    tool_name: "Bash",
    tool_input: { command },
  }).tags.includes("install_local");
}

export async function inspectRollout(path, source, maxChars, includeNearMisses) {
  const hits = [];
  const prohibitions = [];
  const stream = createReadStream(path);
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let prohibition = null;

  for await (const line of lines) {
    if (
      !line.includes('"type":"response_item"') ||
      !(
        line.includes('"payload":{"type":"message"') ||
        line.includes('"payload":{"type":"custom_tool_call"') ||
        line.includes('"payload":{"type":"function_call"')
      )
    ) {
      continue;
    }

    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }

    const payload = row.payload;
    if (payload?.type === "message") {
      const text = messageText(payload);
      if (
        payload.role === "user" &&
        !isNoise(text) &&
        isInstallProhibition(text)
      ) {
        prohibition = {
          ordinal: row.ordinal ?? null,
          timestamp: row.timestamp ?? null,
          event_sha256: sha256(line),
          message_sha256: sha256(text),
          excerpt: excerpt(text, maxChars),
        };
        prohibitions.push(prohibition);
        continue;
      }

      if (
        prohibition &&
        payload.role === "assistant" &&
        isInstallPreparation(text)
      ) {
        hits.push({
          evidence_kind: "assistant_install_preparation",
          prohibition,
          subsequent_event: {
            ordinal: row.ordinal ?? null,
            timestamp: row.timestamp ?? null,
            event_sha256: sha256(line),
            excerpt: excerpt(text, maxChars),
          },
        });
      }
      continue;
    }

    if (!prohibition) continue;
    const text = callText(payload);
    if (isInstallToolCall(payload)) {
      hits.push({
        evidence_kind: "install_related_tool_call",
        prohibition,
        subsequent_event: {
          ordinal: row.ordinal ?? null,
          timestamp: row.timestamp ?? null,
          event_sha256: sha256(line),
          tool_name: payload.name ?? null,
          excerpt: excerpt(text, maxChars),
        },
      });
    }
  }

  if (hits.length === 0 && !includeNearMisses) return null;
  if (prohibitions.length === 0) return null;
  return {
    review_schema_version: "1.0",
    review_status: "unreviewed",
    warning: "Lexical routing only. Manual review must distinguish product install, dependency setup, documentation, and read-only search.",
    source,
    prohibitions,
    hits,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.index || !args["sessions-root"] || !args.output) {
    throw new Error(
      "Usage: discover-prohibited-installs.mjs --index <index.jsonl> --sessions-root <root> --output <private.jsonl> [--max-chars <n>]",
    );
  }

  const indexPath = resolve(args.index);
  const sessionsRoot = resolve(args["sessions-root"]);
  const output = resolve(args.output);
  const maxChars = Number.parseInt(args["max-chars"] ?? "1800", 10);
  const includeNearMisses = args["include-near-misses"] === "true";
  const records = (await readFile(indexPath, "utf8"))
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  const candidates = [];
  for (const record of records) {
    const path = resolve(sessionsRoot, record.rollout_relative_path);
    const result = await inspectRollout(
      path,
      {
        thread_id: record.thread_id,
        rollout_relative_path: record.rollout_relative_path,
        rollout_sha256: record.rollout_sha256,
        session_created_at: record.session_created_at,
      },
      maxChars,
      includeNearMisses,
    );
    if (result) candidates.push(result);
  }

  await mkdir(dirname(output), { recursive: true });
  const body = candidates.map((record) => JSON.stringify(record)).join("\n");
  await writeFile(output, body ? body + "\n" : "", "utf8");
  process.stdout.write(
    JSON.stringify(
      {
        scanned_root_tasks: records.length,
        routed_candidates: candidates.length,
        routed_hits: candidates.reduce((sum, candidate) => sum + candidate.hits.length, 0),
        routed_prohibitions: candidates.reduce(
          (sum, candidate) => sum + candidate.prohibitions.length,
          0,
        ),
        include_near_misses: includeNearMisses,
        output,
      },
      null,
      2,
    ) + "\n",
  );
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  main().catch((error) => {
    process.stderr.write((error.stack ?? error.message) + "\n");
    process.exitCode = 1;
  });
}
