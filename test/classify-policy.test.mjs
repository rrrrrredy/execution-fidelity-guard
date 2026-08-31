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
    "pnpm --dir app add lodash",
    "yarn --cwd app add lodash",
    "uv --project app sync",
    "poetry --directory app install",
    "python3.11 -m pip install pytest",
    "sudo -u root apt install jq",
    "env -u CI npm install lodash",
    "env -C app npm install lodash",
    "npm --loglevel warn install lodash",
    "pip --index-url https://example.invalid/simple install pytest",
    "python3.11 -m pip --index-url https://example.invalid/simple install pytest",
    "pnpm --filter app add lodash",
    "cargo --color always install ripgrep",
    "command -- npm install lodash",
    "command -p npm install lodash",
    "nohup -- npm install lodash",
    "nice -n 5 npm install lodash",
    "timeout 30 npm install lodash",
    "exec npm install lodash",
    "exec -a npm npm install lodash",
    "time npm install lodash",
    "time -f %e npm install lodash",
    "/usr/bin/time --output timing.txt npm install lodash",
    'sh -c "exec npm install lodash"',
    'sh -c "time -p npm install lodash"',
    "FOO=bar exec npm install lodash",
    "FOO=bar time npm install lodash",
    "FOO=bar time -p env CI=1 exec npm install lodash",
    String.raw`sh -c 'sh -c "sh -c \"npm install lodash\""'`,
    String.raw`sh -c 'sh -c "sh -c \"sh -c \\\"npm install lodash\\\"\""'`,
    "env env env env env env env env env npm install lodash",
    "env -S \"npm install lodash\"",
    "env --split-string=\"npm install lodash\"",
    "env -S npm\\ install\\ lodash",
    "env --split-string=npm\\ install\\ lodash",
    "sudo -H apt install jq",
    "sudo -E -H apt install jq",
    "sh -ec \"npm install lodash\"",
    "bash -xec \"npm install lodash\"",
    "npm add lodash",
    "yarn --cwd app dlx create-vite",
    "yarn global add typescript",
    "yarn global upgrade typescript",
    "dotnet tool update --global dotnet-ef",
    "npm update lodash",
    "pnpm update lodash",
    "yarn up lodash",
    "npm audit fix",
    "pnpm audit --fix",
    "npm rebuild",
    "pnpm rebuild",
    "uv add requests",
    "poetry add requests",
    "poetry update",
    "pipenv update",
    "bundle update",
    "gem update",
    "go get example.com/module@latest",
    "dotnet add package Example.Package",
    "conda update numpy",
    "brew upgrade jq",
    "winget upgrade Demo.App",
    "choco upgrade git",
    "apt upgrade",
    "dnf update",
    "yum upgrade",
    "cargo add serde",
    "cargo update",
  ];
  for (const command of commands) {
    const action = classifyToolAction(preToolInput(command));
    assert.ok(action.tags.includes("install_local"), command);
    assert.equal(action.reversible, false, command);
  }
});

test("classifies dependency removal and update as workspace mutation", () => {
  for (const command of [
    "npm uninstall lodash",
    "pnpm --filter app remove lodash",
    "yarn global remove typescript",
    "dotnet tool uninstall --global dotnet-ef",
  ]) {
    const action = classifyToolAction(preToolInput(command));
    assert.ok(action.tags.includes("write_workspace"), command);
    assert.equal(action.reversible, false, command);
  }
});

test("does not classify documentation searches or normal test runs as installation", () => {
  const commands = [
    "rg -n 'pip install|npm install' docs",
    "Get-Content install-notes.md",
    "npm run test",
    "node --test",
    "npm --loglevel warn test",
    "pip --index-url https://example.invalid/simple list",
    "pnpm --filter app test",
    "cargo --color always test",
    "timeout --help",
    "nice -n 5 npm test",
    "exec npm test",
    "time -p npm test",
    "command -v npm install",
    "command -V npm install",
    "sh -e \"npm test\"",
    "bash -- \"npm install lodash\"",
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

test("distinguishes git branch inspection from ref and config mutation", () => {
  for (const command of ["git branch", "git branch --list feature", "git branch --show-current"]) {
    const action = classifyToolAction(preToolInput(command));
    assert.ok(action.tags.includes("read"), command);
    assert.equal(action.tags.includes("write_workspace"), false, command);
  }
  for (const command of [
    "git branch new-feature",
    "git branch -M main",
    "git branch --set-upstream-to=origin/main main",
  ]) {
    const action = classifyToolAction(preToolInput(command));
    assert.ok(action.tags.includes("write_workspace"), command);
    assert.equal(action.reversible, false, command);
  }
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
    ["cp source.txt target.txt", "write_workspace", "action:write"],
    ["mv old.txt new.txt", "write_workspace", "action:write"],
    ["tee output.txt", "write_workspace", "action:write"],
    ["git apply change.patch", "write_workspace", "action:write"],
    ["git cherry-pick abc123", "write_workspace", "action:write"],
    ["git stash", "write_workspace", "action:write"],
    ["git switch feature", "write_workspace", "action:write"],
    ["git worktree add ../trial feature", "write_workspace", "action:write"],
    ["Write-Output hi | Out-File note.txt", "write_workspace", "action:write"],
    ["Out-File -FilePath note.txt -InputObject hi", "write_workspace", "action:write"],
    ["Clear-Content note.txt", "write_workspace", "action:write"],
    ["Rename-Item old.txt new.txt", "write_workspace", "action:write"],
    ["Get-Process | Export-Csv processes.csv", "write_workspace", "action:write"],
    ["Get-Process | Export-Clixml processes.xml", "write_workspace", "action:write"],
    ["Start-Transcript transcript.txt", "write_workspace", "action:write"],
    ["ln -s source target", "write_workspace", "action:write"],
    ["chmod 600 secret.txt", "write_workspace", "action:write"],
    ["chown user file.txt", "write_workspace", "action:write"],
    ["truncate -s 0 file.txt", "write_workspace", "action:write"],
    ["patch -p1 < changes.diff", "write_workspace", "action:write"],
    ["dd if=source.img of=target.img", "write_workspace", "action:write"],
    ["install source.bin destination.bin", "write_workspace", "action:write"],
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

test("classifies direct HTTP mutations as external side effects", () => {
  for (const command of [
    "curl -X POST https://example.invalid/items",
    "curl --data x=1 https://example.invalid/items",
    "curl -F file=@note.txt https://example.invalid/upload",
    "curl -T note.txt https://example.invalid/upload",
    "wget --post-data=x=1 https://example.invalid/items",
    "wget --method=DELETE https://example.invalid/items/1",
    "Invoke-RestMethod -Method Post https://example.invalid/items",
    "iwr -Method Delete https://example.invalid/items/1",
  ]) {
    const action = classifyToolAction(preToolInput(command));
    assert.ok(action.tags.includes("external_side_effect"), command);
    const decision = decidePreTool({
      binding: makeBinding(makeContract({ forbidden: ["action:external"] })),
      action,
      mode: "balanced",
    });
    assert.equal(decision.decision, "block", command);
  }
  for (const command of [
    "curl https://example.invalid/items",
    "curl -X HEAD https://example.invalid/items",
    "wget https://example.invalid/items",
    "irm -Method Get https://example.invalid/items",
  ]) {
    const action = classifyToolAction(preToolInput(command));
    assert.equal(action.tags.includes("external_side_effect"), false, command);
    assert.ok(action.tags.includes("network"), command);
  }
});

test("classifies direct Git deletion subcommands", () => {
  for (const command of [
    "git tag -d v1",
    "git stash drop",
    "git stash clear",
    "git worktree remove ../trial",
    "git worktree prune",
  ]) {
    const action = classifyToolAction(preToolInput(command));
    assert.ok(action.tags.includes("delete"), command);
    assert.ok(action.tags.includes("destructive"), command);
    assert.equal(decidePreTool({
      binding: makeBinding(makeContract({ forbidden: ["action:delete"] })),
      action,
      mode: "balanced",
    }).decision, "block", command);
  }
  const remote = classifyToolAction(preToolInput("git remote remove origin"));
  assert.ok(remote.tags.includes("write_workspace"));
  for (const command of [
    "git push --delete origin feature",
    "git push origin :feature",
    "gh repo delete owner/repo --yes",
    "gh release delete v1 --yes",
    "gh api -X DELETE repos/owner/repo/issues/1",
    "curl -X DELETE https://example.invalid/items/1",
    "wget --method=DELETE https://example.invalid/items/1",
    "iwr -Method Delete https://example.invalid/items/1",
  ]) {
    const action = classifyToolAction(preToolInput(command));
    assert.ok(action.tags.includes("delete"), command);
    assert.ok(action.tags.includes("destructive"), command);
    assert.ok(action.tags.includes("external_side_effect"), command);
    assert.equal(decidePreTool({
      binding: makeBinding(makeContract({ forbidden: ["action:delete"] })),
      action,
      mode: "balanced",
    }).decision, "block", command);
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
    ["git stash list", "write_workspace"],
    ["git stash show", "write_workspace"],
    ["git worktree list", "write_workspace"],
    ["chmod --help", "write_workspace"],
    ["patch --dry-run -p1 < changes.diff", "write_workspace"],
    ["dd if=source.img", "write_workspace"],
  ];
  for (const [command, tag] of cases) {
    const action = classifyToolAction(preToolInput(command));
    assert.equal(action.tags.includes(tag), false, command);
  }
});

test("named external mutations do not fall through as reads", () => {
  for (const toolName of [
    "mcp__codex_app__move_thread_to_sidebar_section",
    "mcp__github__add_issue_comment",
    "mcp__github__merge_pull_request",
    "mcp__codex_app__automation_update",
    "mcp__codex_app__reorder_section",
    "mcp__server__database_update",
    "mcp__server__update_preview",
  ]) {
    const action = classifyToolAction({ tool_name: toolName, tool_input: {} });
    assert.ok(action.tags.includes("external_side_effect"), toolName);
    assert.equal(action.tags.includes("read"), false, toolName);
  }
  for (const command of ["gh pr comment 7 --body ok", "gh issue comment 8 --body ok"]) {
    const action = classifyToolAction(preToolInput(command));
    assert.ok(action.tags.includes("external_side_effect"), command);
  }
});

test("unknown named tools stay unknown instead of matching read inside another word", () => {
  const action = classifyToolAction({
    tool_name: "mcp__example__thread_compactor",
    tool_input: {},
  });
  assert.deepEqual(action.tags, ["unknown"]);
});

test("read-prefixed named tools take precedence over a later update noun", () => {
  for (const toolName of [
    "mcp__server__list_updates",
    "mcp__server__get_update_status",
  ]) {
    const action = classifyToolAction({ tool_name: toolName, tool_input: {} });
    assert.deepEqual(action.tags, ["read"], toolName);
  }
});

test("workspace writes are not claimed to be reversible", () => {
  const action = classifyToolAction(preToolInput("Set-Content note.txt value"));
  assert.ok(action.tags.includes("write_workspace"));
  assert.equal(action.reversible, false);
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

test("structured allowance does not suppress a natural-language safety reminder", () => {
  const binding = makeBinding(
    makeContract({
      allowed: ["action:external"],
      forbidden: ["Do not publish releases"],
    }),
  );
  const action = classifyToolAction(preToolInput("git push origin main"));
  const result = decidePreTool({ binding, action, mode: "balanced" });
  assert.equal(result.decision, "remind");
  assert.ok(result.reasonCodes.includes("semantic_constraint_candidate"));
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
