#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

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

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function extractFirstFinalAnswer(jsonl) {
  const rows = jsonl
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSONL at line ${index + 1}: ${error.message}`);
      }
    });

  const final = rows.find(
    (row) =>
      row?.type === "response_item" &&
      row?.payload?.type === "message" &&
      row?.payload?.phase === "final_answer",
  );

  if (!final) {
    throw new Error("No final_answer response item found.");
  }

  const text = (final.payload.content ?? [])
    .filter((item) => item?.type === "output_text")
    .map((item) => item.text ?? "")
    .join("\n");

  if (!text) {
    throw new Error("The first final_answer contains no output_text.");
  }

  return text;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.source || !args.output || !args["expected-sha256"]) {
    throw new Error(
      "Usage: freeze-upstream.mjs --source <rollout.jsonl> --output <file.md> --expected-sha256 <hex>",
    );
  }

  const source = resolve(args.source);
  const output = resolve(args.output);
  const expected = args["expected-sha256"].toLowerCase();
  const text = extractFirstFinalAnswer(await readFile(source, "utf8"));
  const actual = sha256(text);

  if (actual !== expected) {
    throw new Error(`Recovered input hash mismatch: expected ${expected}, got ${actual}`);
  }

  try {
    const existing = await readFile(output, "utf8");
    const existingHash = sha256(existing);
    if (existingHash !== expected) {
      throw new Error(
        `Frozen output already exists with a different hash: ${existingHash}`,
      );
    }
    process.stdout.write(`Verified existing frozen input: ${output}\n`);
    return;
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, text, { encoding: "utf8", flag: "wx" });
  process.stdout.write(`Frozen upstream input: ${output}\nSHA-256: ${actual}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
