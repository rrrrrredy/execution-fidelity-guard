# Social launch copy

## X

English:

Execution Fidelity Guard is open source: a Codex plugin + unofficial DeepSeek Harness alpha. Shadow observes/reminds; balanced can block explicit conflicts and check contract-bound evidence. Source paths are CI-tested on Windows, macOS and Linux. https://github.com/rrrrrredy/execution-fidelity-guard

Validation: 270 X-weighted characters with the URL counted as 23 characters;
ASCII punctuation only.

中文翻译：

Execution Fidelity Guard 已开源：一个 Codex 插件，加一个非官方 DeepSeek Harness alpha。shadow 负责观察和提醒；balanced 可以阻止明确冲突，并检查任务合同要求的完成证据。Windows、macOS、Linux 源码路径均已通过 CI。

## 小红书

### 5 个标题

1. 给 Agent 加一道交付前检查
2. 它说做完了，我先看证据
3. balanced 下，安装命令会先被拦住
4. Codex 和 DeepSeek Harness 都能用的执行检查
5. 我给 Agent 写了一份 7 字段任务合同

### 正文

我开源了 Execution Fidelity Guard，给 Agent 加一道动手前和交付前检查。

做项目时有两类问题很麻烦：写了“不要在本机安装”，Agent 仍准备跑安装命令；测试、页面、发布状态还没核实，它先说完成。

现在可以把要求写进一份 7 字段任务合同：目标、主要对象、交付面、范围、硬约束、授权、完成证据。

工具执行前，它会判断：

• 低成本、可撤销的操作直接继续
• 有风险信号就提醒
• 需要你决定就询问
• 撞上明确禁令就阻止

默认 shadow：工具动作不拦截；命中明确冲突时提醒，完成证据缺口只记录。balanced 才会询问、阻止，或最多续验 2 次。

两个公开版本：

• Codex v0.2.2：源码、校验和真实打包执行已测试
• DeepSeek Harness v0.1.0-alpha.2：接入 Harness 原生工具检查和结果回传

两个仓库的源码路径都跑 Windows、macOS、Linux CI。插件自身不联网，不上传对话；回执保留哈希和判断信息。Harness alpha 的回执只放内存。

工程检查已经通过，实际效果还要靠真实任务积累。100 个 shadow 和 800 个在线对照还没有数据；Codex 0.2.2 的 Windows 源码路径 p95 为 134.57ms，也高于 100ms 目标。

常让 Agent 改仓库、做发布、跑长任务的人可以先看 demo，再写第一条硬约束。Harness 用户建议先跑 npm test 和 validate。

Codex：https://github.com/rrrrrredy/execution-fidelity-guard

DeepSeek Harness：https://github.com/rrrrrredy/dsh-execution-fidelity-guard

### 配图

- 封面：xiaohongshu/01-cover-v3.png
- 模式说明：xiaohongshu/02-modes-v3.png
- 交付证据链：xiaohongshu/03-evidence-chain-v3.png
