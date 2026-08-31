import assert from "node:assert/strict";
import { access, readFile, readdir, utimes } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  identifierReference,
  sessionReference,
} from "../plugins/execution-fidelity-guard/src/canonical.mjs";
import { handleHook } from "../plugins/execution-fidelity-guard/src/runtime.mjs";
import {
  deleteSession,
  sessionStatePath,
  writeRecord,
} from "../plugins/execution-fidelity-guard/src/store.mjs";
import {
  makeBinding,
  makeConfig,
  makeContract,
  preToolInput,
  projectRoot,
  temporaryState,
} from "../test-support/helpers.mjs";

async function readTree(directory) {
  const chunks = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(child);
      else chunks.push(await readFile(child, "utf8"));
    }
  }
  await visit(directory);
  return chunks.join("\n");
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

test("PreToolUse blocks a deterministic forbidden install", async (t) => {
  const stateRoot = await temporaryState(t);
  const binding = makeBinding(
    makeContract({ forbidden: ["action:install_local"] }),
  );
  const output = await handleHook(preToolInput("pip install pytest"), {
    binding,
    config: makeConfig(stateRoot),
    now: "2026-08-28T01:00:00.000Z",
  });
  assert.equal(
    output.hookSpecificOutput.permissionDecision,
    "deny",
  );
  assert.equal(output.hookSpecificOutput.hookEventName, "PreToolUse");
});

test("PreToolUse maps requires_user to deny plus an unlock question", async (t) => {
  const stateRoot = await temporaryState(t);
  const binding = makeBinding(
    makeContract({ requiresUser: ["action:publish"] }),
  );
  const output = await handleHook(
    preToolInput("gh release create v0.1.0"),
    {
      binding,
      config: makeConfig(stateRoot),
    },
  );
  assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
  assert.match(
    output.hookSpecificOutput.permissionDecisionReason,
    /Ask the user one concise question/,
  );
});

test("PermissionRequest abstains instead of weakening native approval", async (t) => {
  const stateRoot = await temporaryState(t);
  const binding = makeBinding(
    makeContract({ allowed: ["action:write"] }),
  );
  const input = {
    ...preToolInput("git status"),
    hook_event_name: "PermissionRequest",
  };
  const output = await handleHook(input, {
    binding,
    config: makeConfig(stateRoot),
  });
  assert.equal(output, null);
});

test("PermissionRequest denies a deterministic conflict but never returns allow", async (t) => {
  const stateRoot = await temporaryState(t);
  const binding = makeBinding(
    makeContract({ forbidden: ["action:install_local"] }),
  );
  const input = {
    ...preToolInput("pip install pytest"),
    hook_event_name: "PermissionRequest",
  };
  const output = await handleHook(input, {
    binding,
    config: makeConfig(stateRoot),
  });
  assert.equal(
    output.hookSpecificOutput.decision.behavior,
    "deny",
  );
  assert.equal(JSON.stringify(output).includes('"allow"'), false);
});

test("PostToolUse failure becomes contradictory evidence, not rollback", async (t) => {
  const stateRoot = await temporaryState(t);
  const binding = makeBinding();
  const input = {
    ...preToolInput("node --test"),
    hook_event_name: "PostToolUse",
    tool_response: { exit_code: 1, output: "one test failed" },
  };
  const output = await handleHook(input, {
    binding,
    config: makeConfig(stateRoot),
  });
  assert.match(
    output.hookSpecificOutput.additionalContext,
    /failed tool result/,
  );
  assert.equal(JSON.stringify(output).includes("rollback"), false);
});

test("passing structured test evidence satisfies Stop verification", async (t) => {
  const stateRoot = await temporaryState(t);
  const binding = makeBinding();
  const config = makeConfig(stateRoot);
  await handleHook(
    {
      ...preToolInput("node --test"),
      hook_event_name: "PostToolUse",
      tool_response: { exit_code: 0, output: "all tests passed" },
    },
    { binding, config },
  );
  const output = await handleHook(
    {
      session_id: "session-test",
      cwd: projectRoot,
      hook_event_name: "Stop",
      turn_id: "turn-test",
      stop_hook_active: false,
      last_assistant_message: "Everything is completed.",
    },
    { binding, config },
  );
  assert.deepEqual(output, {});
});

test("Stop continues at most twice when required evidence is missing", async (t) => {
  const stateRoot = await temporaryState(t);
  const binding = makeBinding(
    makeContract({
      completion: [
        {
          requirement: "A human has verified the released UI",
          acceptable_sources: ["user", "real_page"],
        },
      ],
    }),
  );
  const config = makeConfig(stateRoot);
  const input = {
    session_id: "session-test",
    cwd: projectRoot,
    hook_event_name: "Stop",
    turn_id: "turn-test",
    stop_hook_active: false,
    last_assistant_message: "全部完成并已交付。",
  };
  const first = await handleHook(input, { binding, config });
  const second = await handleHook(
    { ...input, stop_hook_active: true },
    { binding, config },
  );
  const third = await handleHook(
    { ...input, stop_hook_active: true },
    { binding, config },
  );
  assert.equal(first.decision, "block");
  assert.equal(second.decision, "block");
  assert.equal(third.decision, undefined);
  assert.match(third.systemMessage, /continuation cap/);
});

test("concurrent Stop events share one atomic two-attempt cap", async (t) => {
  const stateRoot = await temporaryState(t);
  const binding = makeBinding(
    makeContract({
      completion: [
        {
          requirement: "A human has verified the released UI",
          acceptable_sources: ["user", "real_page"],
        },
      ],
    }),
  );
  const config = makeConfig(stateRoot);
  const input = {
    session_id: "concurrent-stop-session",
    cwd: projectRoot,
    hook_event_name: "Stop",
    turn_id: "turn-concurrent",
    stop_hook_active: false,
    last_assistant_message: "全部完成并已交付。",
  };
  const outputs = await Promise.all(
    Array.from({ length: 8 }, () => handleHook(input, { binding, config })),
  );
  assert.equal(
    outputs.filter((output) => output?.decision === "block").length,
    2,
  );
  assert.equal(
    outputs.filter((output) => /continuation cap/.test(output?.systemMessage ?? ""))
      .length,
    6,
  );
});

test("persisted records contain hashes and labels, not prompt or secret content", async (t) => {
  const stateRoot = await temporaryState(t);
  const secret = ["ghp", "_", "a".repeat(36)].join("");
  const prompt = "Never leak the private launch phrase violet-capybara.";
  const binding = makeBinding(
    makeContract({ forbidden: ["action:install_local"] }),
  );
  const config = makeConfig(stateRoot);
  await handleHook(
    {
      session_id: "privacy-session",
      cwd: projectRoot,
      hook_event_name: "UserPromptSubmit",
      turn_id: "turn-privacy",
      prompt,
      permission_mode: "default",
    },
    { binding, config },
  );
  await handleHook(
    preToolInput("pip install package --token=" + secret, {
      session_id: "privacy-session",
    }),
    { binding, config },
  );
  const persisted = await readTree(stateRoot);
  assert.equal(persisted.includes("privacy-session"), false);
  assert.match(persisted, new RegExp(sessionReference("privacy-session")));
  assert.equal(persisted.includes("turn-privacy"), false);
  assert.equal(persisted.includes("tool-test"), false);
  assert.match(persisted, new RegExp(identifierReference("turn", "turn-privacy")));
  assert.match(persisted, new RegExp(identifierReference("tool-use", "tool-test")));
  assert.equal(persisted.includes("violet-capybara"), false);
  assert.equal(persisted.includes(secret), false);
  assert.equal(persisted.includes("pip install"), false);
  assert.match(persisted, /input_sha256/);
});

test("SessionStart preserves its session reference within the Host context limit", async (t) => {
  const stateRoot = await temporaryState(t);
  const contract = makeContract({
    forbidden: Array.from({ length: 20 }, (_, index) =>
      "command-prefix:" + "x".repeat(100) + index,
    ),
  });
  contract.objective = "o".repeat(1000);
  contract.primary_object = "p".repeat(1000);
  contract.must_and_must_not.must = Array.from(
    { length: 20 },
    (_, index) => "must-" + index + "-" + "m".repeat(100),
  );
  const output = await handleHook(
    {
      session_id: "long-context-session",
      cwd: projectRoot,
      hook_event_name: "SessionStart",
      source: "startup",
    },
    { binding: makeBinding(contract), config: makeConfig(stateRoot) },
  );
  const context = output.hookSpecificOutput.additionalContext;
  assert.ok(context.length <= 1200);
  assert.ok(context.startsWith("Guard session reference: "));
  assert.match(context, new RegExp(sessionReference("long-context-session")));
});

test("Subagent lifecycle receives compact contract context without raw agent content", async (t) => {
  const stateRoot = await temporaryState(t);
  const binding = makeBinding();
  const config = makeConfig(stateRoot);
  const started = await handleHook(
    {
      session_id: "subagent-session",
      cwd: projectRoot,
      hook_event_name: "SubagentStart",
      agent_id: "raw-agent-identifier",
      agent_type: "reviewer",
    },
    { binding, config },
  );
  assert.equal(
    started.hookSpecificOutput.hookEventName,
    "SubagentStart",
  );
  assert.match(started.hookSpecificOutput.additionalContext, /contract:test/);
  assert.match(
    started.hookSpecificOutput.additionalContext,
    new RegExp(sessionReference("subagent-session")),
  );

  const stopped = await handleHook(
    {
      session_id: "subagent-session",
      cwd: projectRoot,
      hook_event_name: "SubagentStop",
      agent_id: "raw-agent-identifier",
      agent_type: "reviewer",
      last_assistant_message: "private-review-content",
    },
    { binding, config },
  );
  assert.equal(stopped, null);
  const persisted = await readTree(stateRoot);
  assert.equal(persisted.includes("subagent-session"), false);
  assert.equal(persisted.includes("raw-agent-identifier"), false);
  assert.equal(persisted.includes("private-review-content"), false);
  assert.match(persisted, /"agent_type":"reviewer"/);
});

test("SessionStart prunes only session directories older than retention", async (t) => {
  const stateRoot = await temporaryState(t);
  const config = makeConfig(stateRoot, { retentionDays: 30 });
  await writeRecord(config, "stale-session", "events", { event_id: "evt_stale" });
  await writeRecord(config, "fresh-session", "events", { event_id: "evt_fresh" });
  const sessions = path.join(stateRoot, "sessions");
  await utimes(
    sessionStatePath(config, "stale-session"),
    new Date("2026-06-01T00:00:00.000Z"),
    new Date("2026-06-01T00:00:00.000Z"),
  );
  await utimes(
    sessionStatePath(config, "fresh-session"),
    new Date("2026-08-27T00:00:00.000Z"),
    new Date("2026-08-27T00:00:00.000Z"),
  );

  await handleHook(
    {
      session_id: "prune-trigger",
      cwd: projectRoot,
      hook_event_name: "SessionStart",
      source: "startup",
    },
    {
      binding: makeBinding(),
      config,
      now: "2026-08-28T00:00:00.000Z",
    },
  );

  assert.equal(await pathExists(sessionStatePath(config, "stale-session")), false);
  assert.equal(await pathExists(sessionStatePath(config, "fresh-session")), true);
  assert.equal(await pathExists(sessionStatePath(config, "prune-trigger")), true);
});

test("SessionEnd deletion removes only the exact session when opted in", async (t) => {
  const stateRoot = await temporaryState(t);
  const config = makeConfig(stateRoot, { deleteOnSessionEnd: true });
  await writeRecord(config, "ending-session", "events", { event_id: "evt_end" });
  await writeRecord(config, "other-session", "events", { event_id: "evt_other" });

  await handleHook(
    {
      session_id: "ending-session",
      cwd: projectRoot,
      hook_event_name: "SessionEnd",
      reason: "other",
    },
    { binding: makeBinding(), config },
  );

  assert.equal(await pathExists(sessionStatePath(config, "ending-session")), false);
  assert.equal(await pathExists(sessionStatePath(config, "other-session")), true);
});

test("hashed session directories do not collide after identifier normalization", async (t) => {
  const stateRoot = await temporaryState(t);
  const config = makeConfig(stateRoot);
  await writeRecord(config, "a/b", "events", { event_id: "evt_slash" });
  await writeRecord(config, "a_b", "events", { event_id: "evt_underscore" });
  const slashPath = sessionStatePath(config, "a/b");
  const underscorePath = sessionStatePath(config, "a_b");
  assert.notEqual(slashPath, underscorePath);

  await deleteSession(config, "a/b");
  assert.equal(await pathExists(slashPath), false);
  assert.equal(await pathExists(underscorePath), true);
});
