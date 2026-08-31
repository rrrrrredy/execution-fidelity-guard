#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

async function filesBelow(relative) {
  const root = path.join(projectRoot, relative);
  const result = [];
  async function visit(directory, base) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name);
      const item = path.posix.join(base, entry.name);
      if (entry.isDirectory()) await visit(child, item);
      else if (entry.isFile()) result.push(item);
    }
  }
  await visit(root, relative.replace(/\\/g, "/"));
  return result;
}

const npmCommand =
  process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "npm";
const npmArguments =
  process.platform === "win32"
    ? ["/d", "/s", "/c", "npm pack --dry-run --ignore-scripts --json"]
    : ["pack", "--dry-run", "--ignore-scripts", "--json"];
const packed = spawnSync(
  npmCommand,
  npmArguments,
  { cwd: projectRoot, encoding: "utf8", windowsHide: true },
);
if (packed.error) throw packed.error;
if (packed.status !== 0) {
  throw new Error((packed.stderr || packed.stdout || "npm pack failed").trim());
}
const report = JSON.parse(packed.stdout)?.[0];
if (!report || !Array.isArray(report.files)) {
  throw new Error("npm pack did not return a file inventory");
}
const packaged = new Set(
  report.files.map((entry) => String(entry.path).replace(/\\/g, "/")),
);
const packageJson = JSON.parse(
  await readFile(path.join(projectRoot, "package.json"), "utf8"),
);
const scriptTargets = Object.values(packageJson.scripts ?? {}).flatMap((command) =>
  [...String(command).matchAll(/\bnode\s+([^\s]+)/g)].map((match) => match[1]),
).filter((target) => !target.startsWith("-"));
const required = new Set([
  ".github/workflows/ci.yml",
  ".agents/plugins/marketplace.json",
  "test-support/helpers.mjs",
  ...scriptTargets,
  ...(await filesBelow("scripts")),
  ...(await filesBelow("test")),
]);
const missing = [...required].filter((item) => !packaged.has(item));
if (missing.length) {
  throw new Error("packed artifact omits required files: " + missing.join(", "));
}
for (const forbidden of ["evals/private/", "docs/frozen/", ".runtime/"]) {
  if ([...packaged].some((item) => item.startsWith(forbidden))) {
    throw new Error("packed artifact exposes private or runtime data: " + forbidden);
  }
}
process.stdout.write(
  JSON.stringify(
    {
      ok: true,
      package: report.filename,
      files: packaged.size,
      scripts: Object.keys(packageJson.scripts ?? {}).length,
      tests: [...packaged].filter((item) => item.startsWith("test/")).length,
    },
    null,
    2,
  ) + "\n",
);
