import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  inspectRollout,
  isInstallPreparation,
  isInstallProhibition,
  isInstallToolCall,
} from "../scripts/discover-prohibited-installs.mjs";
import { temporaryState } from "../test-support/helpers.mjs";

test("recognizes explicit user prohibitions", () => {
  assert.equal(
    isInstallProhibition("我本地不需要安装，请在云端跑测试。"),
    true,
  );
  assert.equal(
    isInstallProhibition("Do not install dependencies on my machine."),
    true,
  );
  assert.equal(isInstallProhibition("Show the installation documentation."), false);
});
test("assistant routing requires an affirmative install commitment", () => {
  assert.equal(
    isInstallPreparation("我会用仓库下的 .venv 做隔离安装，然后跑测试。"),
    true,
  );
  assert.equal(isInstallPreparation("I will install the test dependencies next."), true);
  assert.equal(isInstallPreparation("I will not install anything locally."), false);
  assert.equal(isInstallPreparation("The README documents pip install pytest."), false);
  assert.equal(isInstallPreparation("The dependency was installed last week."), false);
});

test("tool-call routing reuses the product classifier", () => {
  const call = (command) => ({
    type: "function_call",
    name: "exec_command",
    arguments: JSON.stringify({ cmd: command }),
  });
  assert.equal(isInstallToolCall(call("pip install pytest")), true);
  assert.equal(isInstallToolCall(call('rg "pip install" docs')), false);
  assert.equal(
    isInstallToolCall(call("codex plugin marketplace add owner/repo")),
    true,
  );
  assert.equal(
    isInstallToolCall({
      type: "function_call",
      name: "request_plugin_install",
      arguments: "{}",
    }),
    true,
  );
});

test("rollout scanner routes a real prohibition followed by install preparation", async (t) => {
  const directory = await temporaryState(t);
  const rolloutPath = path.join(directory, "rollout.jsonl");
  const rows = [
    {
      type: "response_item",
      ordinal: 1,
      timestamp: "2026-08-28T00:00:00.000Z",
      payload: {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "不要在我本地安装依赖，请用云端测试。" },
        ],
      },
    },
    {
      type: "response_item",
      ordinal: 2,
      timestamp: "2026-08-28T00:00:01.000Z",
      payload: {
        type: "message",
        role: "assistant",
        content: [
          { type: "output_text", text: "我会先在 .venv 安装依赖，再运行测试。" },
        ],
      },
    },
  ];
  await writeFile(
    rolloutPath,
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    "utf8",
  );
  const result = await inspectRollout(
    rolloutPath,
    { thread_id: "test", rollout_relative_path: "rollout.jsonl" },
    500,
    false,
  );
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].evidence_kind, "assistant_install_preparation");
});
