# Social launch copy

## X

English:

Execution Fidelity Guard is now open source for Codex and DeepSeek Harness. It checks agent actions against explicit constraints, asks before user-owned choices, and verifies completion claims against evidence. Tested on Windows, macOS, and Linux. https://github.com/rrrrrredy/execution-fidelity-guard

Validation: 301 raw characters, 271 X-weighted characters with the URL counted
as 23 characters, and ASCII punctuation only.

中文翻译：

Execution Fidelity Guard 已经为 Codex 和 DeepSeek Harness 开源。它会用明确约束检查 Agent 的操作，把需要用户决定的事交还给用户，并用证据核对完成声明。Windows、macOS、Linux 均已通过测试。

## 小红书

### 5 个标题

1. 给 Agent 加一道交付前检查
2. 它说做完了，我先看证据
3. 一条“禁止本机安装”能不能真的拦住 Agent
4. Codex 和 DeepSeek Harness 都能用的执行检查
5. 我把 Agent 的越界动作拦在执行前

### 正文

我开源了 Execution Fidelity Guard，给 Agent 加一道执行前和交付前检查。

做项目时，我最怕两件事：

1. 明明写了“不要在本机安装”，Agent 还是准备跑安装命令。
2. 测试、页面、发布状态没核实，它先宣布完成。

现在可以把要求写进一份 7 字段任务合同：目标、主要对象、交付面、范围、硬约束、授权、完成证据。

插件在工具真正执行前做判断：

• 低成本、可撤销的操作直接继续
• 有风险信号就提醒
• 需要你决定就询问
• 撞上明确禁令就阻止

Agent 说完成时，它还会检查证据，缺证据最多续验 2 次。

目前有两个公开版本：

• Codex v0.2.1：85 项测试，通过真实打包执行
• DeepSeek Harness v0.1.0-alpha.1：接入原生 ask、ToolRuntime 和 AgentLoop

两个版本都跑过 Windows、macOS、Linux CI。默认 shadow，只观察和记录，先看看是否误伤再开 balanced。插件自身不联网，不上传对话；收据只保留哈希和判断信息。

工程验证已经完成，实际效果还要靠真实任务继续积累。100 个 Shadow 和 800 个在线对照还没有数据，Windows 源码路径 p95 296.05ms，也高于 100ms 目标。

适合常让 Agent 改仓库、做发布、跑长任务的人。先看 demo，再写第一条硬约束。

Codex：https://github.com/rrrrrredy/execution-fidelity-guard

DeepSeek Harness：https://github.com/rrrrrredy/dsh-execution-fidelity-guard

### 配图

- 封面：xiaohongshu/01-cover-v2.png
- 执行前检查：xiaohongshu/02-action-gate-v2.png
- 交付证据链：xiaohongshu/03-evidence-chain-v2.png
