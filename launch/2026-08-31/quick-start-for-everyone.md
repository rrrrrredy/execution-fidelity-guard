# 用最简单的话说明

## 这是什么

Execution Fidelity Guard 给 Codex 加了两张检查表：

1. 动手前：这件事能做、要先问，还是明确禁止？
2. 说完成前：测试、文件或发布证据真的齐了吗？

例如你说“不要在本机安装”，Codex 准备运行安装命令时，它可以提前拦住。Codex 说“已经完成”时，它会检查任务要求的证据，并留下不含原始提示词的回执。

它是护栏，不会替代 Codex 自带的沙箱和审批。

## 先看看，不安装

电脑需要 Git 和 Node.js 20。依次运行：

    git clone https://github.com/rrrrrredy/execution-fidelity-guard.git
    cd execution-fidelity-guard
    node plugins/execution-fidelity-guard/bin/efg.mjs doctor
    node plugins/execution-fidelity-guard/bin/efg.mjs demo

demo 会展示一次放行和一次拦截，不会安装插件，也不会修改 Codex 配置。

## 决定长期使用

在确认源码和 Hook 命令后运行：

    codex plugin marketplace add rrrrrredy/execution-fidelity-guard --ref v0.2.1
    codex plugin add execution-fidelity-guard@execution-fidelity-guard

然后新开一个 Codex 任务，告诉它使用 execution-fidelity Skill，并说清楚目标、不能做的事、交付时要看到什么证据。第一次建议保留默认 shadow 模式，先观察它会在哪些地方提醒或拦截。

需要卸载时运行：

    codex plugin remove execution-fidelity-guard@execution-fidelity-guard
    codex plugin marketplace remove execution-fidelity-guard

Codex IDE extension 当前不能使用插件。Codex CLI 和支持插件的桌面环境才是这个版本的目标。
