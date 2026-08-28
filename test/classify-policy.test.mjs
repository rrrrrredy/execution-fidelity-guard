import assert from "node:assert/strict";
import test from "node:test";
import { classifyToolAction } from "../plugins/execution-fidelity-guard/src/classify.mjs";
import { decidePreTool } from "../plugins/execution-fidelity-guard/src/policy.mjs";
import {
  makeBinding,
  makeContract,
  preToolInput,
} from "../test-support/helpers.mjs";

test("classifies explicit and implicit local package installation commands", () => {
  const commands = [
    "pip install pytest",
    "python -m pip install -e .",
    "npm ci",
    "uv sync",
    "npx prettier .",
    "pnpm dlx eslint .",
    "pipx run black .",
    "Install-Module Pester",
    '& $taskPython -m pip install "pytest"',
    "echo ready & pip install pytest",
    'bash -lc "pip install pytest"',
    'pwsh -Command "npm ci"',
    "cmd /c python -m pip install pytest",
    "sudo -E pip install pytest",
    "env CI=1 npm exec prettier .",
    "uv run pytest",
    "corepack prepare pnpm@latest",
    "npm --prefix . install lodash",
    "pip --disable-pip-version-check install pytest",
    "apt-get -y install jq",
  ];
  for (const command of commands) {
    const action = classifyToolAction(preToolInput(command));
    assert.ok(action.tags.includes("install_local"), command);
  }
});

test("does not classify documentation searches or normal test runs as installation", () => {
  const commands = [
    "rg -n 'pip install|npm install' docs",
    "Get-Content install-notes.md",
    "npm run test",
    "node --test",
    'node -e "console.log(\\"pip install\\")"',
  ];
  for (const command of commands) {
    const action = classifyToolAction(preToolInput(command));
    assert.equal(action.tags.includes("install_local"), false, command);
  }
});

test("detects destructive git branch deletion", () => {
  const action = classifyToolAction(preToolInput("git branch -D temporary"));
  assert.ok(action.tags.includes("delete"));
  assert.ok(action.tags.includes("destructive"));
});

test("classifies common direct mutation forms before structured policy", () => {
  const cases = [
    ["npm --prefix . install lodash", "install_local", "action:install_local"],
    [
      "pip --disable-pip-version-check install pytest",
      "install_local",
      "action:install_local",
    ],
    ["apt-get -y install jq", "install_local", "action:install_local"],
    ["find . -delete", "destructive", "action:destructive"],
    ["sed -i s/a/b/ file", "write_workspace", "action:write"],
    ["git branch --delete temp", "destructive", "action:destructive"],
    ["gh pr merge 1", "external_side_effect", "action:external"],
  ];
  for (const [command, tag, rule] of cases) {
    const action = classifyToolAction(preToolInput(command));
    assert.ok(action.tags.includes(tag), command);
    const binding = makeBinding(makeContract({ forbidden: [rule] }));
    const decision = decidePreTool({ binding, action, mode: "balanced" });
    assert.equal(decision.decision, "block", command);
  }
});

test("classifies mutations behind common global command options", () => {
  const cases = [
    ["git -C repo push", "publish", "action:publish"],
    ["npm --workspace=pkg publish", "publish", "action:publish"],
    ["gh --repo o/r pr merge 1", "external_side_effect", "action:external"],
    [
      "gh api --method=POST repos/o/r/issues",
      "external_side_effect",
      "action:external",
    ],
    [
      "gh api repos/o/r/issues -f title=test",
      "external_side_effect",
      "action:external",
    ],
    ["gh -R o/r pr close 1", "external_side_effect", "action:external"],
    ["npm -w pkg publish", "publish", "action:publish"],
    ["npm unpublish pkg@1.0.0", "publish", "action:publish"],
    ["npm deprecate pkg@1.0.0 old", "publish", "action:publish"],
    ["gh secret set TOKEN", "external_side_effect", "action:external"],
    ["gh variable delete NAME", "external_side_effect", "action:external"],
    ["gh run rerun 123", "external_side_effect", "action:external"],
    ["git -C repo branch -D old", "destructive", "action:destructive"],
    ["git --git-dir=.git push", "publish", "action:publish"],
  ];
  for (const [command, tag, rule] of cases) {
    const action = classifyToolAction(preToolInput(command));
    assert.ok(action.tags.includes(tag), command);
    const binding = makeBinding(makeContract({ forbidden: [rule] }));
    const decision = decidePreTool({ binding, action, mode: "balanced" });
    assert.equal(decision.decision, "block", command);
  }
});

test("similar read-only or non-install forms remain outside mutation tags", () => {
  const cases = [
    ["npm --prefix . run test", "install_local"],
    ["pip --disable-pip-version-check list", "install_local"],
    ["apt-get -y update", "install_local"],
    ["find . -name package.json", "destructive"],
    ["sed -n 1p file", "write_workspace"],
    ["git branch --list", "destructive"],
    ["gh pr view 1", "external_side_effect"],
    ["git -C repo branch --list", "destructive"],
    ["gh --repo o/r pr view 1", "external_side_effect"],
    ["gh api --method=GET repos/o/r", "external_side_effect"],
    ["gh secret list", "external_side_effect"],
    ["gh variable list", "external_side_effect"],
    ["gh run view 123", "external_side_effect"],
    ["npm --workspace=pkg run test", "publish"],
    ["npm view pkg version", "publish"],
  ];
  for (const [command, tag] of cases) {
    const action = classifyToolAction(preToolInput(command));
    assert.equal(action.tags.includes(tag), false, command);
  }
});

test("deterministic forbidden action blocks", () => {
  const binding = makeBinding(
    makeContract({ forbidden: ["action:install_local"] }),
  );
  const action = classifyToolAction(preToolInput("pip install pytest"));
  const result = decidePreTool({ binding, action, mode: "balanced" });
  assert.equal(result.decision, "block");
  assert.equal(result.authority, "deterministic_rule");
  assert.match(result.ruleIds[0], /^forbidden:[a-f0-9]{16}$/);
  assert.equal(result.ruleIds[0].includes("install_local"), false);
});

test("requires_user becomes ask and never an allow decision", () => {
  const binding = makeBinding(
    makeContract({ requiresUser: ["action:publish"] }),
  );
  const action = classifyToolAction(
    preToolInput("gh release create v0.1.0"),
  );
  const result = decidePreTool({ binding, action, mode: "balanced" });
  assert.equal(result.decision, "ask");
  assert.equal(result.unlock.includes("authorize or reject"), true);
  assert.match(result.unlock, /new contract version/);

  const repeated = decidePreTool({ binding, action, mode: "balanced" });
  assert.equal(repeated.decision, "ask");

  const approvedBinding = makeBinding(
    makeContract({ allowed: ["action:publish"] }),
    { contractRef: "contract:test", contractVersion: 2 },
  );
  const approved = decidePreTool({
    binding: approvedBinding,
    action,
    mode: "balanced",
  });
  assert.equal(approved.decision, "continue");
  assert.ok(approved.reasonCodes.includes("explicit_contract_allowance"));
});

test("natural language constraints are reminders, not hard blocks", () => {
  const binding = makeBinding(
    makeContract({ forbidden: ["Do not install anything locally"] }),
  );
  const action = classifyToolAction(preToolInput("pip install pytest"));
  const result = decidePreTool({ binding, action, mode: "balanced" });
  assert.equal(result.decision, "remind");
  assert.equal(result.authority, "semantic_candidate");
});

test("shadow mode records a would-block reminder", () => {
  const binding = makeBinding(
    makeContract({ forbidden: ["action:install_local"] }),
  );
  const action = classifyToolAction(preToolInput("pip install pytest"));
  const result = decidePreTool({ binding, action, mode: "shadow" });
  assert.equal(result.decision, "remind");
  assert.ok(result.reasonCodes.includes("shadow_would_block"));
});

test("unbound high-risk actions remain advisory", () => {
  const action = classifyToolAction(preToolInput("pip install pytest"));
  const result = decidePreTool({
    binding: { status: "unbound" },
    action,
    mode: "balanced",
  });
  assert.equal(result.decision, "remind");
  assert.notEqual(result.decision, "block");
});

test("low-cost reads continue silently", () => {
  const binding = makeBinding(
    makeContract({ forbidden: ["action:install_local"] }),
  );
  const action = classifyToolAction(preToolInput("rg --files"));
  const result = decidePreTool({ binding, action, mode: "balanced" });
  assert.equal(result.decision, "continue");
  assert.equal(result.visibility, "silent");
});

test("local planning state is not mislabeled as an external side effect", () => {
  for (const toolName of [
    "create_goal",
    "update_goal",
    "update_plan",
    "mcp__functions__create_goal",
    "mcp__functions__update_goal",
    "mcp__functions__update_plan",
  ]) {
    const action = classifyToolAction({ tool_name: toolName, tool_input: {} });
    assert.deepEqual(action.tags, ["read"]);
    assert.equal(action.highRisk, false);
  }
});

test("read-only prefixed MCP tool names take precedence over embedded nouns", () => {
  const action = classifyToolAction({
    tool_name: "mcp__codex_app__list_archived_threads",
    tool_input: {},
  });
  assert.deepEqual(action.tags, ["read"]);
  assert.equal(action.highRisk, false);
});
