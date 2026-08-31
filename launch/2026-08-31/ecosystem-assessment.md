# Ecosystem and cross-platform assessment

Assessment date: 2026-08-31.

## Decision

An operating-system cross-platform version is worth doing now and is already
partly present: the runtime is dependency-free Node.js and CI targets Windows,
Linux, and macOS. This becomes a verified claim only after the exact release
commit passes all three public CI runners. Installed-client behavior and
latency on macOS and Linux remain unverified.

A cross-Host version is also worth doing, but as a host-neutral core plus thin
adapters after the Codex evidence gate. Do not market the current Codex plugin
as universal, and do not turn architectural fit into a compatibility claim.
DeepSeek Harness should be the first separate adapter only after the real
shadow and controlled-evaluation gates below.

| Host | Decision | Current state |
|---|---|---|
| Codex CLI and supported desktop plugin surfaces | Ship 0.2.1 | Implemented; installed-client delivery remains unverified in this release process |
| Codex IDE extension | Do not target yet | The Host does not currently support plugins |
| DeepSeek Harness | Prepare the adapter design; do not ship yet | Strong architectural fit; no adapter exists and Codex efficacy gates remain open |
| Other Agent Hosts | Wait for evidence of demand | Avoid a lowest-common-denominator API before one second adapter proves the boundary |

## DeepSeek Harness fit

The fit is strong. DeepSeek Harness describes plugins as its unit of extension
and exposes typed interception points around tools and Agent turns. Its
documented `tools/pre-execute`, monotonic `ctx.tools.guard()`,
immutable `tools/result`, and `agent/turn-stopping` extension points map
closely to Guard's advisory gate, deterministic deny, evidence observation, and
completion check. The project is still a developer preview and its repository
warns that compatibility-breaking changes are expected, so an adapter must pin
and test specific Harness versions.

Current Guard is not yet a DeepSeek Harness plugin. Codex `hooks.json`, Hook
payloads, permission responses, and lifecycle names are Host-specific. Adding a
`dsh-plugin` topic or submitting to the community showcase before a real run
would violate the community requirement for an actual Harness integration.

## Recommended implementation

1. Extract the contract parser, action taxonomy, deterministic policy, evidence
   ordering, and receipt schemas into a Host-neutral internal core. Preserve
   the frozen Intent Loop and Continuity input boundary.
2. Create a separate package named with the permitted `DSH` shorthand, for
   example `dsh-execution-fidelity-guard`. Do not rename the Codex project or
   imply DeepSeek endorsement.
3. Implement a Cordis plugin module exporting `apply(ctx)`. Use
   `tools/pre-execute` for shadow reminders and user-approval decisions,
   `ctx.tools.guard()` for final deterministic denials that later listeners
   cannot undo, `tools/result` for the authoritative normalized outcome, and
   `agent/turn-stopping` for bounded completion steering.
4. Publish a built npm or tarball package with `dsh.bundle` pointing to its
   Cordis patch. A built artifact avoids requiring users to authorize a Git
   source build step.
5. Test against the pinned current release candidate and the latest alpha,
   including deny/abstain semantics, event payloads, concurrency, persistence,
   uninstall, and latency. Do not carry Codex permission semantics across by
   name; map only behavior verified in Harness.
6. After a real end-to-end run, add the `dsh-plugin` GitHub topic and post an
   explicitly unofficial showcase with repository URL, screenshots,
   installation steps, and the exact integration points.

## Go gate

Do not start a cross-Host product release merely because Codex 0.2.1 is public.
First require its exact commit to pass the three OS runners, complete the real
100-session shadow pilot with independent adjudication, and run the PRD's
controlled 800-task comparison without crossing the false-block, user-time, or
exploration-loss limits. A bounded, unpublished DSH feasibility spike may
validate event semantics after the shadow gate, but it is not a product release.

The first DSH release must then have a real Harness execution trace, pin tested
Harness versions, and keep the same read-only relationship to Intent Loop and
Continuity. Until those gates pass, describe the project as suitable for the
ecosystem, not as already compatible with it.

Official references:

- [DeepSeek Harness overview](https://www.deepseek.com/harness/en/)
- [DeepSeek Harness repository](https://github.com/deepseek-ai/deepseek-harness)
- [Plugin development](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/)
- [Plugin packaging](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish)
- [Architecture and events](https://deepseek-harness.github.io/deepseek-harness/en/reference/)
- [Tool policy and result events](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/tools)
- [Brand guidelines](https://github.com/deepseek-ai/deepseek-harness/blob/master/BRAND_GUIDELINES.md)
- [Community plugin topic](https://github.com/topics/dsh-plugin)
- [Codex plugin support](https://learn.chatgpt.com/docs/plugins)
