# Social launch copy

## X

English:

Execution Fidelity Guard is an open-source Codex plugin for two agent failures: crossing explicit boundaries and claiming completion without evidence. It checks actions first, keeps receipts, and defaults to shadow mode. https://github.com/rrrrrredy/execution-fidelity-guard

Validation: 274 raw characters, 244 X-weighted characters with the URL counted
as 23 characters, and ASCII punctuation only.

中文翻译：

Execution Fidelity Guard 是一个开源 Codex 插件，专门盯住两类 Agent 失误：越过明确边界，以及没有证据就宣布完成。它会先检查操作，保留回执，并默认从 shadow 模式开始。

## 小红书

### 5 个标题

1. 给 Codex 加一道“交付前检查”
2. Agent 说完成了，证据在哪？
3. 我做了一个防止 AI 越界执行的插件
4. 让 Codex 记住哪些事绝对不能做
5. 开源了：Execution Fidelity Guard

### 正文

我开源了 Execution Fidelity Guard，一个给 Codex 用的执行边界插件。

做项目时，我最怕 AI 出现两种情况：

1. 明明说了“不要在本机安装”，它还是准备跑安装命令。
2. 测试、页面、发布状态还没确认，它先说“已经完成”。

插件会在 Codex 动手前读取一份任务合同。合同里写清楚哪些操作可以做、哪些要先问、哪些禁止。遇到明确冲突，它会挡在执行前。准备交付时，它还会检查需要的证据够不够。

默认是 shadow 模式，只记录“这里会拦”，方便先观察误伤，再决定要不要打开真正拦截。

v0.2.0 可以这样试：

• demo：不安装，直接看一次放行和一次拦截
• no-local-install：快速写好“禁止本机安装”
• explain：看某个操作为什么被拦
• receipts summary：看决策和完成证据
• artifact evidence：读取文件并记录 SHA-256

代码在本地运行，没有网络调用，运行时零依赖。它不会代替 Codex 的沙箱和审批。目前 80 项测试全过，真实 npm 包也做了解包执行验证。Windows 源码路径 p95 为 172.02ms，高于最初的 100ms 目标；真实项目中的误报率和效果还要靠更多使用数据。

适合经常让 Agent 改仓库、做发布、跑长任务的人。先跑 demo，再从 shadow 模式开始。

GitHub：https://github.com/rrrrrredy/execution-fidelity-guard

### 配图

- 封面：xiaohongshu/01-cover.png
- 执行前检查：xiaohongshu/02-action-gate.png
- 交付证据链：xiaohongshu/03-evidence-chain.png
