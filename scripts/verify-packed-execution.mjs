#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      (result.stderr || result.stdout || command + " failed").trim(),
    );
  }
  return result.stdout;
}

function pack(destination) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    throw new Error(
      "run this verifier through npm run verify:packed-execution",
    );
  }
  return run(
    process.execPath,
    [
      npmCli,
      "pack",
      "--ignore-scripts",
      "--json",
      "--pack-destination",
      destination,
    ],
    projectRoot,
  );
}

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "efg-pack-"));
let report;
try {
  const packed = JSON.parse(pack(temporaryRoot))?.[0];
  if (!packed?.filename) throw new Error("npm pack did not return a filename");
  const archive = path.join(temporaryRoot, path.basename(packed.filename));
  run("tar", ["-xf", archive, "-C", temporaryRoot], projectRoot);

  const extractedRoot = path.join(temporaryRoot, "package");
  const packageJson = JSON.parse(
    await readFile(path.join(extractedRoot, "package.json"), "utf8"),
  );
  if (
    packageJson.name !== "execution-fidelity-guard" ||
    packageJson.version !== packed.version
  ) {
    throw new Error("extracted package identity does not match npm pack output");
  }

  const validation = JSON.parse(
    run(process.execPath, ["scripts/validate-release.mjs"], extractedRoot),
  );
  const simulation = JSON.parse(
    run(process.execPath, ["scripts/assert-source-simulation.mjs"], extractedRoot),
  );
  if (!validation.ok || simulation.permission_decision !== "deny") {
    throw new Error("extracted package did not pass its executable release gates");
  }
  report = {
    ok: true,
    package: packed.filename,
    version: packed.version,
    extracted_validation_checks: validation.checks,
    prohibited_install_decision: simulation.permission_decision,
    installed: false,
  };
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

process.stdout.write(JSON.stringify(report, null, 2) + "\n");
