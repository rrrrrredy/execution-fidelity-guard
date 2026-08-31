# Ecosystem and cross-platform assessment

Assessment date: 2026-08-31.

## Decision

The operating-system cross-platform version is worth shipping now. The Codex
package uses dependency-free Node.js 20+, and the DeepSeek Harness adapter uses
the upstream-supported Node.js 22.19 or 24+ range. Both repositories test
source, validation, and packed execution on Windows, Ubuntu, and macOS. This
claim applies to the exact commits with green public CI; installed-client UX
and macOS/Linux latency are still unmeasured.

DeepSeek Harness is also worth supporting as a separate alpha adapter. Its
public tool and Agent-turn extension points map closely to Guard's boundary,
while a separate repository keeps Host-specific lifecycle and permission
semantics explicit.

| Host | Decision | Current state |
|---|---|---|
| Codex CLI and supported desktop plugin surfaces | Ship 0.2.2 | Source and package paths implemented; local installed-client delivery intentionally untested |
| Codex IDE extension | Do not target | This Host surface does not currently support plugins |
| DeepSeek Harness | Ship unofficial 0.1.0-alpha.2 | Real ToolRuntime and AgentLoop integration, exact Harness alpha pin, in-memory receipts |
| Other Agent Hosts | Wait | A third adapter needs user demand and real efficacy evidence |

## Why DeepSeek Harness fits

DeepSeek Harness exposes four relevant extension points:

- `tools/pre-execute` for advisory checks and native ask results;
- monotonic `ctx.tools.guard()` for a deterministic veto;
- immutable `tools/result` for authoritative outcome observation; and
- `agent/turn-stopping` for bounded completion verification.

The adapter uses those native boundaries and leaves planning, execution,
sandboxing, permissions, sessions, and final user interaction with Harness. It
does not copy Codex Hook payloads or claim DeepSeek endorsement.

The ecosystem is still a developer preview. The adapter therefore pins
DeepSeek Harness `0.1.2-alpha.2`, is published as a GitHub prerelease, and must
re-run real integration tests before accepting a newer upstream alpha.

## How the project joins the ecosystem

1. Keep the adapter in its own public Apache-2.0 repository:
   `rrrrrredy/dsh-execution-fidelity-guard`.
2. Ship buildless JavaScript with a `dsh.bundle.patch`, exact peer ranges, and
   no install lifecycle script.
3. Tag the repository with `dsh-plugin`, `deepseek-harness`, and
   `execution-fidelity` so it appears in GitHub's community discovery path.
4. Publish a prerelease with the exact compatible Harness version and source,
   integration, validation, and packed-execution results.
5. Let Harness developers inspect from source first, then install an exact tag:

       dsh plugin --profile <profile> add github:rrrrrredy/dsh-execution-fidelity-guard#v0.1.0-alpha.2
       dsh --profile <profile> --dump-config

6. Submit a community showcase only after a real installed-profile walkthrough
   exists. The current release does not claim that missing UX evidence.

## Evidence boundary

The adapter is suitable for Harness developers who already accept upstream
alpha churn and want explicit execution constraints. It is not ready for a
general end-user promise: the 100-task shadow pilot, 800-task controlled
comparison, false-block rate, user-time effect, and installed-profile UX remain
unverified. The Codex Windows source path also remains above its provisional
100 ms p95 target: the exact 0.2.2 Windows source result is 134.57 ms over
100 runs. Installed-client and macOS/Linux latency remain unmeasured.

Official references:

- [DeepSeek Harness repository](https://github.com/deepseek-ai/deepseek-harness)
- [DeepSeek Harness v0.1.2-alpha.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/v0.1.2-alpha.2)
- [Plugin packaging](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish)
- [Tool subsystem](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/tools)
- [Core events](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/core)
