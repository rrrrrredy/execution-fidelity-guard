#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const CORRECTION_PATTERNS = [
  {
    code: "not_what_asked",
    pattern: /(?:不是.{0,24}(?:让你|要你|我的要求|这个|这样)|我说的是|这不是|完全不是|你理解错|跑偏|偏了|不对|not what i asked|that(?:'s| is) not|wrong)/iu,
  },
  {
    code: "missing_work",
    pattern: /(?:没有做|没做|漏了|遗漏|为什么.{0,24}(?:没有|没|还)|you missed|did not do|didn't do)/iu,
  },
  {
    code: "objective_replaced",
    pattern: /(?:主目标|原目标|目标.{0,12}(?:变|换|替换)|把.{0,20}当成.{0,12}主|changed the objective|replaced the goal)/iu,
  },
  {
    code: "scope_narrowed",
    pattern: /(?:(?:全部|所有|完整|正文).{0,28}(?:没有|没|只|漏|缩)|只做了|范围.{0,12}(?:缩|少)|narrowed the scope|only did)/iu,
  },
  {
    code: "forbidden_action",
    pattern: /(?:(?:明确|已经|我说过).{0,20}(?:不要|禁止)|不要.{0,20}(?:安装|发布|部署|修改|删除)|forbid|do not install|don't install)/iu,
  },
  {
    code: "attachment_only",
    pattern: /(?:(?:正文|回复).{0,20}(?:没有|没).{0,20}(?:结果|结论)|只有附件|只在附件|attachment only)/iu,
  },
  {
    code: "false_completion",
    pattern: /(?:(?:测试|发布|页面|真实状态|构建).{0,24}(?:失败|没有|没).{0,24}(?:完成|上线|通过)|并没有完成|没有实际|claimed complete|not actually complete)/iu,
  },
  {
    code: "over_governance",
    pattern: /(?:(?:局部|这个任务).{0,24}(?:全局|Harness|治理)|过度治理|又变成.{0,12}框架|turned into a harness)/iu,
  },
  {
    code: "exploration_blocked",
    pattern: /(?:(?:正常|可逆|只读|探索).{0,24}(?:阻止|拦截|不让)|blocked exploration)/iu,
  },
  {
    code: "quality_rejected",
    pattern:
      /(?:你(?:没|没有).{0,12}理解|你在干什么|完全偏离|严重错误|浪费了?我的(?:时间|token)|(?:这版|这段|这个|这些|上一版|你(?:的|给的)).{0,36}(?:机器味|AI味|人机感|不够好|太浅|太泛|太空|不专业|无聊|boring|不符合预期))/iu,
  },
];

const ACCEPTANCE_PATTERN =
  /^\s*(?:可以(?:了)?|很好|不错|完成(?:了)?|就这样|谢谢|没问题|这次可以|ok(?:ay)?|looks good|great|done)\s*[！!。.]*\s*$/iu;

const COMPLETION_CLAIM_PATTERN =
  /(?:已完成|完成了|已经实现|已经修复|已经发布|已经部署|已经上线|交付完成|implemented|fixed|published|deployed|completed|done)/iu;

const TOOL_FAILURE_PATTERN =
  /(?:Script failed|Process exited with code [1-9][0-9]*|exit_code["']?\s*[:=]\s*[1-9][0-9]*|status["']?\s*:\s*["']failed["']|isError["']?\s*:\s*true)/iu;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    args[key] = value;
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

function isInternalContinuation(text) {
  return (
    text.includes("<codex_internal_context") ||
    text.includes("Continue working toward the active thread goal.") ||
    text.includes("Continuation behavior:")
  );
}

function isHostContext(text) {
  const trimmed = text.trimStart();
  return (
    trimmed.startsWith("<environment_context>") ||
    trimmed.startsWith("<subagent_notification>") ||
    trimmed.startsWith("<turn_aborted>") ||
    trimmed.startsWith("# AGENTS.md instructions") ||
    trimmed.startsWith("<recommended_plugins>") ||
    trimmed.startsWith("The following is the Codex agent history") ||
    (text.includes("<environment_context>") && text.includes("# Workspace Placement"))
  );
}

export async function listRollouts(root) {
  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && /^rollout-.*\.jsonl$/u.test(entry.name)) {
        files.push(path);
      }
    }
  }

  await visit(root);
  return files;
}

export async function readPrimarySessionMeta(path) {
  const stream = createReadStream(path);
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      try {
        const row = JSON.parse(line);
        return row.type === "session_meta" ? row : null;
      } catch {
        return null;
      }
    }
  } catch {
    return null;
  } finally {
    lines.close();
    stream.destroy();
  }
  return null;
}

async function countLines(path) {
  let count = 0;
  const stream = createReadStream(path);
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const _line of lines) {
    count += 1;
  }
  return count;
}

export async function buildForkBoundaries(allFiles, targetFiles) {
  const primaryById = new Map();
  const primaryByPath = new Map();
  for (const path of allFiles) {
    const row = await readPrimarySessionMeta(path);
    if (!row?.payload?.id) continue;
    const item = { path, row };
    primaryById.set(row.payload.id, item);
    primaryByPath.set(path, item);
  }

  const boundaries = new Map();
  let resolved = 0;
  let unresolved = 0;
  for (const path of targetFiles) {
    const item = primaryByPath.get(path);
    const payload = item?.row?.payload;
    if (!payload?.forked_from_id) continue;
    const source = payload.source;
    const threadSource = payload.thread_source;
    if (
      payload.parent_thread_id ||
      source?.subagent ||
      source === "automation" ||
      ["subagent", "guardian_review", "automation"].includes(threadSource)
    ) {
      continue;
    }

    const parent = primaryById.get(payload.forked_from_id);
    const forkCreated = new Date(payload.timestamp ?? item.row.timestamp);
    if (!parent || Number.isNaN(forkCreated.getTime())) {
      boundaries.set(path, { exclude: true });
      unresolved += 1;
      continue;
    }
    const parentMetadata = await stat(parent.path);
    if (parentMetadata.mtime > forkCreated) {
      boundaries.set(path, { exclude: true });
      unresolved += 1;
      continue;
    }

    // A user fork stores its own meta row, followed by the complete frozen
    // parent JSONL, then the fork's novel suffix. The parent line count is a
    // deterministic boundary only while the parent has not changed since the
    // fork was created.
    const parentLineCount = await countLines(parent.path);
    boundaries.set(path, {
      exclude: false,
      copiedThroughOrdinal: parentLineCount,
    });
    resolved += 1;
  }
  return { boundaries, resolved, unresolved };
}

export async function indexRollout(path, root, cutoff, forkBoundary) {
  if (forkBoundary?.exclude) return null;
  const metadata = await stat(path);

  const digest = createHash("sha256");
  const stream = createReadStream(path);
  stream.on("data", (chunk) => digest.update(chunk));
  const lines = createInterface({ input: stream, crlfDelay: Infinity });

  let threadId = null;
  let createdAt = null;
  let forkedFromThreadId = null;
  let cwdHash = null;
  let turnCount = 0;
  let userMessageCount = 0;
  let assistantFinalCount = 0;
  let toolCallCount = 0;
  let toolFailureCount = 0;
  let completionClaimCount = 0;
  let seenAssistant = false;
  let firstMeaningfulUserHash = null;
  let lastFinalHash = null;
  let ineligibleSession = false;
  let seenSessionMeta = false;
  let sourceLineOrdinal = -1;
  const correctionSignals = [];
  const acceptanceSignals = [];

  for await (const line of lines) {
    sourceLineOrdinal += 1;
    if (
      sourceLineOrdinal > 0 &&
      forkBoundary?.copiedThroughOrdinal !== undefined &&
      sourceLineOrdinal <= forkBoundary.copiedThroughOrdinal
    ) {
      continue;
    }
    if (line.includes('"type":"turn_context"')) {
      turnCount += 1;
      continue;
    }

    if (
      line.includes('"payload":{"type":"custom_tool_call"') ||
      line.includes('"payload":{"type":"function_call"')
    ) {
      toolCallCount += 1;
      continue;
    }

    if (line.includes('"payload":{"type":"custom_tool_call_output"')) {
      if (TOOL_FAILURE_PATTERN.test(line)) {
        toolFailureCount += 1;
      }
      continue;
    }

    const isSessionMeta = line.includes('"type":"session_meta"');
    const isMessage =
      line.includes('"type":"response_item"') &&
      line.includes('"payload":{"type":"message"');
    if (!isSessionMeta && !isMessage) {
      continue;
    }

    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }

    if (isSessionMeta) {
      // Fork rollouts can retain a second session_meta row for the parent
      // transcript. Only the first row identifies the file being indexed.
      if (seenSessionMeta) {
        continue;
      }
      seenSessionMeta = true;
      const source = row.payload?.source;
      const threadSource = row.payload?.thread_source;
      if (
        row.payload?.parent_thread_id ||
        source?.subagent ||
        source === "automation" ||
        ["subagent", "guardian_review", "automation"].includes(threadSource)
      ) {
        ineligibleSession = true;
        break;
      }
      threadId = row.payload?.id ?? threadId;
      createdAt = row.payload?.timestamp ?? row.timestamp ?? createdAt;
      forkedFromThreadId = row.payload?.forked_from_id ?? null;
      if (row.payload?.cwd) {
        cwdHash = sha256(row.payload.cwd);
      }
      continue;
    }

    const payload = row.payload;
    const text = messageText(payload);
    if (payload?.role === "assistant") {
      seenAssistant = true;
      if (payload.phase === "final_answer") {
        assistantFinalCount += 1;
        lastFinalHash = sha256(text);
        if (COMPLETION_CLAIM_PATTERN.test(text)) {
          completionClaimCount += 1;
        }
      }
      continue;
    }

    if (
      payload?.role !== "user" ||
      isInternalContinuation(text) ||
      isHostContext(text)
    ) {
      continue;
    }

    userMessageCount += 1;
    const textHash = sha256(text);
    if (!firstMeaningfulUserHash) {
      firstMeaningfulUserHash = textHash;
    }

    if (!seenAssistant) {
      continue;
    }

    const codes = CORRECTION_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(
      ({ code }) => code,
    );
    if (codes.length > 0) {
      correctionSignals.push({
        ordinal: row.ordinal ?? sourceLineOrdinal,
        event_sha256: sha256(line),
        message_sha256: textHash,
        codes,
      });
    }
    if (ACCEPTANCE_PATTERN.test(text)) {
      acceptanceSignals.push({
        ordinal: row.ordinal ?? sourceLineOrdinal,
        event_sha256: sha256(line),
        message_sha256: textHash,
      });
    }
  }

  if (ineligibleSession) {
    return null;
  }
  const createdTime = createdAt ? new Date(createdAt) : metadata.mtime;
  if (cutoff && !Number.isNaN(createdTime.getTime()) && createdTime >= cutoff) {
    return null;
  }

  const rolloutHash = digest.digest("hex");
  const uniqueCorrectionCodes = new Set(
    correctionSignals.flatMap((signal) => signal.codes),
  );
  const failureScore =
    correctionSignals.length * 10 +
    uniqueCorrectionCodes.size * 2 +
    Math.min(toolFailureCount, 5) +
    (toolFailureCount > 0 && completionClaimCount > 0 ? 4 : 0);
  const successScore =
    acceptanceSignals.length * 10 +
    assistantFinalCount * 2 +
    (correctionSignals.length === 0 ? 5 : -20) -
    Math.min(toolFailureCount, 3);

  let candidateLabel = "unclassified";
  if (correctionSignals.length > 0) {
    candidateLabel = "failure_candidate";
  } else if (acceptanceSignals.length > 0) {
    candidateLabel = "success_candidate";
  } else if (assistantFinalCount > 0 && completionClaimCount > 0) {
    candidateLabel = "success_candidate_weak";
  }

  return {
    schema_version: "1.0",
    thread_id: threadId ?? path.match(/([0-9a-f-]{36})\.jsonl$/iu)?.[1] ?? null,
    forked_from_thread_id: forkedFromThreadId,
    fork_history_copied_through_ordinal:
      forkBoundary?.copiedThroughOrdinal ?? null,
    rollout_relative_path: relative(root, path).replaceAll("\\", "/"),
    rollout_sha256: rolloutHash,
    session_created_at: createdAt,
    last_modified_at: metadata.mtime.toISOString(),
    cwd_sha256: cwdHash,
    file_bytes: metadata.size,
    turn_count: turnCount,
    user_message_count: userMessageCount,
    assistant_final_count: assistantFinalCount,
    tool_call_count: toolCallCount,
    tool_failure_count: toolFailureCount,
    completion_claim_count: completionClaimCount,
    first_meaningful_user_sha256: firstMeaningfulUserHash,
    last_final_sha256: lastFinalHash,
    correction_signals: correctionSignals,
    acceptance_signals: acceptanceSignals,
    failure_score: failureScore,
    success_score: successScore,
    candidate_label: candidateLabel,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.root || !args.output) {
    throw new Error(
      "Usage: index-sessions.mjs --root <sessions-root> --output <index.jsonl> [--older-than <ISO>] [--concurrency <n>] [--max-files <n>]",
    );
  }

  const root = resolve(args.root);
  const output = resolve(args.output);
  const cutoff = args["older-than"] ? new Date(args["older-than"]) : null;
  if (cutoff && Number.isNaN(cutoff.getTime())) {
    throw new Error("Invalid --older-than date.");
  }

  const concurrency = Math.max(1, Number.parseInt(args.concurrency ?? "4", 10));
  const maxFiles = args["max-files"]
    ? Math.max(1, Number.parseInt(args["max-files"], 10))
    : Number.POSITIVE_INFINITY;
  const allFiles = await listRollouts(root);
  const files = allFiles.slice(0, maxFiles);
  const forkInventory = await buildForkBoundaries(allFiles, files);
  const results = new Array(files.length);
  let cursor = 0;

  async function worker() {
    while (cursor < files.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await indexRollout(
        files[index],
        root,
        cutoff,
        forkInventory.boundaries.get(files[index]),
      );
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, files.length) }, () => worker()),
  );

  const indexed = results.filter(Boolean);
  const body = indexed.map((record) => JSON.stringify(record)).join("\n");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, body ? `${body}\n` : "", "utf8");

  const counts = Object.fromEntries(
    ["failure_candidate", "success_candidate", "success_candidate_weak", "unclassified"].map(
      (label) => [label, indexed.filter((record) => record.candidate_label === label).length],
    ),
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        scanned: files.length,
        indexed: indexed.length,
        user_forks_resolved: forkInventory.resolved,
        user_forks_unresolved_excluded: forkInventory.unresolved,
        counts,
        output,
      },
      null,
      2,
    )}\n`,
  );
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  main().catch((error) => {
    process.stderr.write(String(error.stack ?? error.message) + "\n");
    process.exitCode = 1;
  });
}
