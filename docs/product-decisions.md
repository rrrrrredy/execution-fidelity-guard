# Product decisions after current-platform verification

The private frozen upstream research and PRD remains unchanged and is excluded
from publication. This file records the sanitized implementation decisions
caused by verified Codex behavior.

## Adopt

1. Keep Execution Fidelity Guard as an independent, lightweight plugin for the Codex MVP.
2. Treat the user-intent plugin's versioned contract_ref as the sole intent truth.
3. Use TaskContractLite only when no user-intent plugin contract is available.
4. Read context continuity only as contract_ref, phase, open commitments, and evidence references.
5. Use deterministic candidate filtering before any semantic review.
6. Keep low-cost, read-only, workspace-local, reversible exploration silent.
7. Permit hard blocking only for deterministic contract or authorization conflicts.
8. Prefer file, command, test, API, database, real-page, and release evidence over language confidence.
9. Persist only contract references, normalized facts, evidence references, decisions, and measured outcomes.
10. Keep semantic hard blocking disabled.

## Adjust

| Upstream expectation | Current adjustment | Reason |
|---|---|---|
| SessionStart and PostCompact restore minimal context | SessionStart handles startup, resume, and compact restoration. PostCompact records compaction only. | PostCompact has no event-specific additionalContext output. |
| Ask through a plugin lifecycle hook | Deny the pending action and instruct the Agent to ask one concise user question. Retrying stays denied until the canonical owner publishes a revised contract that records the allowance. | PreToolUse ask is parsed but unsupported; a pure plugin has no native question UI and Guard must not own authorization state. |
| PermissionRequest assists authorization | Deny only deterministic conflict; otherwise abstain. | The event fires only when native approval is already pending, and auto-approval would weaken user authority. |
| Manifest points to hooks | Use default hooks/hooks.json discovery and omit the manifest hooks field. | Official runtime supports both; the current local validator rejects the explicit manifest field. |
| PostToolUse can correct failed execution | It records and feeds back failure but never claims rollback. | Side effects have already occurred. |
| Stop prevents false completion | It verifies only explicit completion or delivery signals and can continue at most twice. | Stop is a turn boundary, not a goal-completion event. |
| Optional MCP in MVP | Start with local files and hook entry points. Add a bundled MCP server only when an actual intent or continuity provider needs a structured runtime bridge. | An empty MCP surface adds operational failure without product value. |
| Deterministic continue p95 target | Keep the official command-Hook path for v0.1.0 and publish the measured miss instead of adding a persistent MCP process only to hide Node cold start. | The local Windows p95 was 140.41 ms with persistence disabled versus the provisional 100 ms target; a new long-lived server would add lifecycle and tool-surface risk without an installed integration test. |

## Reject

1. Reusing or converting the separate offline regression Harness into the plugin. It remains an independent evaluation asset.
2. Building a complete App Server client for the MVP.
3. Copying or writing back the user-intent plugin's full canonical state.
4. Treating the latest message as the new primary objective without classification and explicit replacement evidence.
5. Hard blocking from a single semantic-model judgment.
6. Auto-approving native Codex permission requests.
7. Reading hidden chain-of-thought as product evidence.
8. Claiming Hosted WebSearch, specialized tools, or untrusted hooks are covered.
9. Installing or enabling the plugin locally merely to validate a release; source simulation and package validation are sufficient.
10. Calling green tests, hook counts, or model ratings proof of product efficacy.

## Gate result

The Codex MVP remains a plugin and passes the implementation Go gate. It may be
published as an explicitly labeled open-source preview with a default
`shadow` mode. A production-efficacy Go or No-Go remains open until
isolated replay, shadow tasks, and controlled online comparison meet the PRD
outcome thresholds.
