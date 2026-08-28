#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCoverageReport } from "./audit-replay-coverage.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const pluginRoot = path.join(projectRoot, "plugins", "execution-fidelity-guard");
const failures = [];
let checkCount = 0;

function check(condition, message) {
  checkCount += 1;
  if (!condition) failures.push(message);
}

async function readText(relative) {
  return readFile(path.join(projectRoot, relative), "utf8");
}

async function readJson(relative) {
  try {
    return JSON.parse(await readText(relative));
  } catch (error) {
    failures.push(relative + " is not valid JSON: " + error.message);
    return null;
  }
}

async function exists(relative) {
  try {
    await lstat(path.join(projectRoot, relative));
    return true;
  } catch {
    return false;
  }
}

async function walk(directory, relativeBase = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.join(relativeBase, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      failures.push("release surface contains a symbolic link: " + relative);
    } else if (entry.isDirectory()) {
      files.push(...(await walk(absolute, relative)));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
  return files;
}

function emptyDependencyMap(value) {
  return !value || Object.keys(value).length === 0;
}

async function validate() {
  const required = [
    ".agents/plugins/marketplace.json",
    "README.md",
    "LICENSE",
    "NOTICE",
    "PRIVACY.md",
    "SECURITY.md",
    "CHANGELOG.md",
    "CONTRIBUTING.md",
    "docs/integration-contract.md",
    "evals/replay-manifest.json",
    "evals/replay-coverage.json",
    "evals/hook-latency-windows-2026-08-28.json",
    "scripts/benchmark-hook.mjs",
    "plugins/execution-fidelity-guard/.codex-plugin/plugin.json",
    "plugins/execution-fidelity-guard/hooks/hooks.json",
    "plugins/execution-fidelity-guard/skills/execution-fidelity/SKILL.md",
    "plugins/execution-fidelity-guard/bin/efg.mjs",
    "plugins/execution-fidelity-guard/src/hook.mjs",
    "plugins/execution-fidelity-guard/spec/provider-contract.schema.json",
    "plugins/execution-fidelity-guard/spec/continuity-snapshot.schema.json",
  ];
  for (const relative of required) {
    check(await exists(relative), "missing release file: " + relative);
  }

  const packageJson = await readJson("package.json");
  const manifest = await readJson(
    "plugins/execution-fidelity-guard/.codex-plugin/plugin.json",
  );
  const marketplace = await readJson(".agents/plugins/marketplace.json");
  const hooks = await readJson("plugins/execution-fidelity-guard/hooks/hooks.json");
  const replay = await readJson("evals/replay-manifest.json");
  const coverage = await readJson("evals/replay-coverage.json");
  const latency = await readJson("evals/hook-latency-windows-2026-08-28.json");
  if (
    [packageJson, manifest, marketplace, hooks, replay, coverage, latency].some(
      (value) => !value,
    )
  ) {
    return;
  }

  check(packageJson.name === "execution-fidelity-guard", "package name mismatch");
  check(packageJson.private === false, "package must be publicly packageable");
  check(
    /^0[.]1[.][0-9]+$/.test(packageJson.version),
    "release version must be a 0.1.x preview",
  );
  check(manifest.version === packageJson.version, "manifest version mismatch");
  check(packageJson.license === "Apache-2.0", "package license mismatch");
  check(manifest.license === "Apache-2.0", "plugin license mismatch");
  check(packageJson.engines?.node === ">=20", "Node engine must be >=20");
  const packageFiles = new Set(packageJson.files ?? []);
  for (const requiredPackagePath of [
    "PRIVACY.md",
    "SECURITY.md",
    "docs/action-rules.md",
    "docs/integration-contract.md",
    "docs/limitations.md",
    "examples",
    "evals/replay-manifest.json",
    "evals/replay-coverage.json",
    "evals/inventory-audit-2026-08-28.md",
    "evals/hook-latency-windows-2026-08-28.json",
  ]) {
    check(
      packageFiles.has(requiredPackagePath),
      "package omits a README-linked release path: " + requiredPackagePath,
    );
  }
  check(
    [...packageFiles].every((entry) => !entry.startsWith("evals/private")),
    "package file list exposes private evaluation data",
  );
  check(
    [...packageFiles].every(
      (entry) => entry !== "docs" && !entry.startsWith("docs/frozen"),
    ),
    "package file list exposes frozen internal source material",
  );
  for (const key of [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
    "bundledDependencies",
  ]) {
    check(emptyDependencyMap(packageJson[key]), "runtime dependency map is not empty: " + key);
  }
  check(
    packageJson.repository?.url ===
      "git+https://github.com/rrrrrredy/execution-fidelity-guard.git",
    "package repository URL mismatch",
  );
  check(
    manifest.repository ===
      "https://github.com/rrrrrredy/execution-fidelity-guard",
    "plugin repository URL mismatch",
  );
  check(
    Array.isArray(manifest.interface?.defaultPrompt) &&
      manifest.interface.defaultPrompt.length >= 1 &&
      manifest.interface.defaultPrompt.length <= 5,
    "plugin defaultPrompt must contain one to five examples",
  );
  check(!("hooks" in manifest), "manifest should use default hooks/hooks.json discovery");

  check(marketplace.name === "execution-fidelity-guard", "marketplace name mismatch");
  check(marketplace.plugins?.length === 1, "marketplace must publish one plugin");
  const marketPlugin = marketplace.plugins?.[0] ?? {};
  check(marketPlugin.name === manifest.name, "marketplace plugin name mismatch");
  check(
    marketPlugin.source?.source === "local" &&
      marketPlugin.source?.path === "./plugins/execution-fidelity-guard",
    "marketplace local source path mismatch",
  );
  check(
    path.resolve(projectRoot, marketPlugin.source?.path ?? "") === pluginRoot,
    "marketplace source escapes or misses the plugin directory",
  );
  check(
    marketPlugin.policy?.installation === "AVAILABLE",
    "marketplace installation policy must be AVAILABLE",
  );

  const requiredEvents = [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PermissionRequest",
    "PostToolUse",
    "PreCompact",
    "PostCompact",
    "Stop",
    "SessionEnd",
  ];
  const hookEvents = Object.keys(hooks.hooks ?? {});
  check(
    requiredEvents.every((event) => hookEvents.includes(event)),
    "hooks configuration is missing a required lifecycle event",
  );
  const expectedCommand = 'node "__PLUGIN_ROOT__/src/hook.mjs"'.replace(
    "__PLUGIN_ROOT__",
    "$" + "{PLUGIN_ROOT}",
  );
  for (const [event, groups] of Object.entries(hooks.hooks ?? {})) {
    check(Array.isArray(groups) && groups.length > 0, event + " has no hook group");
    for (const group of groups ?? []) {
      for (const handler of group.hooks ?? []) {
        check(handler.type === "command", event + " must use a command hook");
        check(handler.command === expectedCommand, event + " command is not portable");
        check(
          Number.isFinite(handler.timeout) &&
            handler.timeout > 0 &&
            handler.timeout <= 3,
          event + " timeout must be between zero and three seconds",
        );
      }
    }
  }

  const rootLicense = await readText("LICENSE");
  const pluginLicense = await readText("plugins/execution-fidelity-guard/LICENSE");
  const rootNotice = await readText("NOTICE");
  const pluginNotice = await readText("plugins/execution-fidelity-guard/NOTICE");
  check(rootLicense === pluginLicense, "plugin LICENSE is stale");
  check(rootNotice === pluginNotice, "plugin NOTICE is stale");
  check(
    rootLicense.includes("Apache License") && rootLicense.includes("Version 2.0"),
    "root LICENSE is not Apache-2.0 text",
  );

  check(replay.status === "frozen", "replay manifest is not frozen");
  check(
    replay.confirmed_failure_cases >= 40 && replay.confirmed_success_cases >= 40,
    "replay manifest does not meet the 40 plus 40 gate",
  );
  check(replay.blockers?.length === 0, "replay manifest has blockers");
  check(
    replay.source_root === "$" + "CODEX_HOME/sessions",
    "public replay source root is not portable",
  );
  for (const item of replay.cases ?? []) {
    check(
      !("thread_id" in (item.source ?? {})) &&
        !("rollout_relative_path" in (item.source ?? {})) &&
        !("captured_at" in (item.source ?? {})) &&
        !("original_harm" in item) &&
        !("task_type" in item),
      "public replay case exposes private source linkage: " + item.case_id,
    );
  }
  const expectedCoverage = buildCoverageReport(replay);
  check(
    JSON.stringify(coverage) === JSON.stringify(expectedCoverage),
    "replay coverage report is stale",
  );
  check(
    latency.path === "command_hook_process_continue" &&
      latency.event === "PreToolUse" &&
      latency.decision === "continue" &&
      latency.persistence === false,
    "Hook latency snapshot does not describe the source continue path",
  );
  check(
    Number.isFinite(latency.latency_ms?.p95) &&
      latency.latency_ms.p95 > 0 &&
      latency.latency_ms.p95 < 3000,
    "Hook latency snapshot is invalid or exceeds the configured timeout",
  );

  const pluginFiles = await walk(pluginRoot);
  const textExtensions = new Set([".json", ".md", ".mjs"]);
  for (const relative of pluginFiles) {
    if (!textExtensions.has(path.extname(relative))) continue;
    const content = await readFile(path.join(pluginRoot, relative), "utf8");
    check(!/[A-Z]:[\\/](?:Users|Codex)[\\/]/i.test(content), "local path in plugin: " + relative);
    check(!/\b(?:TODO|FIXME)\b/.test(content), "unfinished marker in plugin: " + relative);
    if (relative.endsWith(".mjs")) {
      check(
        content.split(/\r?\n/).slice(0, 3).join("\n").includes("SPDX-License-Identifier: Apache-2.0"),
        "missing SPDX header: " + relative,
      );
      check(
        !/from\s+["']node:(?:http|https|net|tls|dns|child_process)["']|\bfetch\s*\(|\bWebSocket\b/.test(content),
        "network or subprocess API in local-first plugin: " + relative,
      );
    }
    if (relative.endsWith(".json")) {
      try {
        JSON.parse(content);
      } catch {
        failures.push("invalid plugin JSON: " + relative);
      }
    }
  }
  check(!(await exists("node_modules")), "node_modules must not be in the release tree");
  check(!(await exists(".venv")), ".venv must not be in the release tree");
  const ignore = await readText(".gitignore");
  check(ignore.includes("evals/private/"), "private evaluation directory is not ignored");
  check(ignore.includes("docs/frozen/"), "exact upstream task inputs are not ignored");
  check(ignore.includes(".runtime/"), "runtime test state is not ignored");
  const integration = await readText("docs/integration-contract.md");
  check(
    integration.includes("Guard does not write any state back to Intent Loop or Continuity"),
    "integration contract does not freeze read-only Guard ownership",
  );
  check(
    integration.includes(`${latency.latency_ms.p95} ms p95`),
    "integration contract omits the measured performance gap",
  );
  const privacy = await readText("PRIVACY.md");
  check(
    privacy.includes("EFG_RETENTION_DAYS") &&
      privacy.includes("receipts delete --session SESSION --yes"),
    "privacy controls do not document retention and exact-session deletion",
  );

  if (!failures.length) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          version: packageJson.version,
          checks: checkCount,
          plugin_files: pluginFiles.length,
          runtime_dependencies: 0,
        },
        null,
        2,
      ) + "\n",
    );
  }
}

await validate();
if (failures.length) {
  for (const failure of failures) process.stderr.write("FAIL " + failure + "\n");
  process.exitCode = 1;
}
