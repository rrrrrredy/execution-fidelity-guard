# Execution Fidelity Guard

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933.svg)](package.json)
[![CI](https://github.com/rrrrrredy/execution-fidelity-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/rrrrrredy/execution-fidelity-guard/actions/workflows/ci.yml)

Execution Fidelity Guard is a local-first Codex plugin that applies explicit
structured action rules, records observed results, and checks completion claims
against contract-bound evidence.

It targets a specific failure: the Agent remembers the broad goal but quietly
crosses an explicit action or authorization boundary, or claims completion
without the required evidence. The objective, object, delivery surface, and
scope fields remain bounded context in 0.1.0; they are not deterministic,
path-aware gates.

Version 0.1.0 is an open-source preview. It is usable today, but it is a guardrail, not a sandbox or complete security boundary.

## What it does

- Loads a provider-owned intent contract or a strict seven-field TaskContractLite fallback.
- Classifies local tool actions before execution.
- Blocks only deterministic contract conflicts.
- Pauses `requires_user` actions until the user answers and the canonical contract owner publishes a revised contract that records the allowance.
- Records result and decision receipts without retaining prompt, command, or output content.
- Continues an explicit completion claim when required evidence is missing, with a two-attempt cap under normal sequential Host delivery.
- Starts in `shadow` mode so teams can measure would-block behavior before enforcement.

## Decision boundary

| Outcome | Meaning | Hook behavior |
|---|---|---|
| `continue` | No material conflict | No model-visible output |
| `remind` | Possible semantic or coverage concern | Adds concise context; never hard-blocks |
| `ask` | An explicit rule requires user authorization | Denies the pending action and supplies the question |
| `block` | An explicit structured rule conflicts | Denies before the action runs |
| `continue_verification` | Completion evidence is missing or failed | Requests one focused verification pass |

Execution Fidelity Guard never auto-approves native Codex permission requests.

## Evaluate from source without installing

Requirements: Git and Node.js 20 or later. There are no runtime dependencies.

    git clone https://github.com/rrrrrredy/execution-fidelity-guard.git
    cd execution-fidelity-guard
    node plugins/execution-fidelity-guard/bin/efg.mjs doctor
    node plugins/execution-fidelity-guard/bin/efg.mjs check --mode balanced --event examples/events/pre-tool-install.json --contract examples/contracts/no-local-install.json
    node --test

The simulated install action should return a `PreToolUse` deny decision. `check` is read-only and disables persistence.
For a permitted read simulation, `null` means continue. Exit code 0 means
the simulation ran successfully; inspect the JSON output rather than treating
the process exit as an allow or deny verdict.

## Install from the GitHub marketplace

Review the repository and Hook commands before trusting them. Codex requires trust review for non-managed Hooks; see the [official Hooks documentation](https://learn.chatgpt.com/docs/hooks).

    codex plugin marketplace add rrrrrredy/execution-fidelity-guard --ref v0.1.0
    codex plugin add execution-fidelity-guard@execution-fidelity-guard

Start a new Codex task after installation so the Skill and Hooks are discovered. These commands modify local Codex plugin state; they are not needed for source evaluation.

To remove it:

    codex plugin remove execution-fidelity-guard@execution-fidelity-guard
    codex plugin marketplace remove execution-fidelity-guard

## Bind a task contract

Ask Codex to use `$execution-fidelity`, or create a fallback contract from a source checkout:

    node plugins/execution-fidelity-guard/bin/efg.mjs init

This creates `.execution-fidelity/contract.json` without overwriting an existing file. Replace every placeholder before enforcement.

The fallback has exactly seven fields:

1. `objective`
2. `primary_object`
3. `delivery_surface`
4. `scope`
5. `must_and_must_not`
6. `authorization`
7. `completion_evidence`

See [the no-local-install example](examples/contracts/no-local-install.json) and [the action-rule reference](docs/action-rules.md).

For a provider integration, version semantics, and the final ownership split
between Intent Loop, Continuity, Guard, and Codex, read the
[integration contract](docs/integration-contract.md).

## Modes

- `shadow` is the default. It records deterministic would-block and would-ask decisions as reminders.
- `balanced` enforces explicit structured `forbidden`, `must_not`, and `requires_user` rules.
- `off` records coverage as unobserved and applies no policy.

Set a mode for the Codex process with `EFG_MODE`. Do not switch to `balanced` until the contract has been reviewed.

Other optional environment variables:

- `EFG_CONTRACT_PATH`: contract path, relative to the workspace or absolute.
- `EFG_STATE_DIR`: local receipt directory.
- `EFG_PERSIST=false`: disable receipt persistence.
- `EFG_MAX_RECORDS`: per-session, per-bucket retention cap.
- `EFG_RETENTION_DAYS`: inactive session retention in days; defaults to 30 and is clamped to 1 through 3650.
- `EFG_DELETE_ON_SESSION_END=true`: delete only the ending session's Guard-owned state after its final receipt.
- `EFG_MAX_STOP_CONTINUATIONS`: completion continuation cap; values above two are rejected.

## Completion evidence

A passing Hook-observed result automatically satisfies a requirement only when the requirement is deterministic:

- `evidence:test`
- `evidence:<kind>:action:<tag>`

Natural-language requirements need an explicit evidence record. Passing non-user evidence requires a SHA-256:

    node plugins/execution-fidelity-guard/bin/efg.mjs evidence add --contract .execution-fidelity/contract.json --session SESSION --requirement 1 --kind test --status pass --source "test receipt" --sha256 HASH

Manual evidence is explicitly marked `caller_attested`. The digest should be
the SHA-256 of the exact evidence artifact bytes, for example:

    (Get-FileHash -Algorithm SHA256 .\test-results.json).Hash.ToLower()
    sha256sum ./test-results.json

Guard records the supplied digest and label but does not open the artifact or
verify that the caller's claim is true. A fluent completion sentence therefore
does not become Hook-observed proof, but a caller can still submit a false
attestation.

Cross-event completion checks require persistence. If `EFG_PERSIST=false`,
action checks still work, but a later Stop event cannot recover earlier evidence.

Inspect, export, or explicitly delete one session's Guard-owned state from a
source checkout:

    node plugins/execution-fidelity-guard/bin/efg.mjs receipts show --session SESSION
    node plugins/execution-fidelity-guard/bin/efg.mjs receipts export --session SESSION --output guard-receipts.json
    node plugins/execution-fidelity-guard/bin/efg.mjs receipts delete --session SESSION --yes

Export refuses to overwrite an existing file. Delete requires `--yes` and
targets only the normalized session directory under the dedicated state root.

## Privacy

The runtime makes no network calls. It stores contract references, action labels, hashes, evidence references, and decision receipts under `$CODEX_HOME/plugin-data/execution-fidelity-guard/v1` by default.

It does not intentionally retain prompts, full commands, tool outputs, transcript contents, hidden reasoning, credentials, or secrets. See [PRIVACY.md](PRIVACY.md).

## Known limits

- Hosted tools such as WebSearch do not traverse the local Hook path.
- A later `write_stdin` call does not trigger a second `PreToolUse` decision.
- Specialized tools can opt out of Hooks.
- Shell classification is intentionally conservative and cannot prove arbitrary script behavior.
- Shell wrappers are inspected only for common direct forms; generated scripts and indirect process launch remain outside the deterministic boundary.
- The seven-field contract carries objective, object, delivery, and scope context, but 0.1.0 hard decisions use only explicit `action:`, `tool:`, and `command-prefix:` rules.
- Natural-language rules never become hard blocks without an explicit structured rule.
- `PostToolUse` cannot undo a side effect that already happened.
- A Stop event is a turn boundary, not authoritative task completion.
- Disabling persistence disables evidence continuity between Hook events.
- Manual CLI evidence is caller-attested, not independently verified.
- Concurrent Stop Hook processes can race the persisted continuation counter; the two-attempt cap is guaranteed only for normal sequential Host delivery.
- No live Intent Loop adapter or Continuity bridge has been integrated in 0.1.0; the provider document is file-based and the Continuity schema is a reserved boundary.
- The provider hash validates the current projection but cannot prove global version monotonicity across erased state.

Read [docs/limitations.md](docs/limitations.md) before using `balanced` mode.

## Evidence status

The de-identified public inventory contains 41 confirmed historical failures
and 40 confirmed comparison successes across all eight required categories. It
publishes no source thread IDs, rollout paths, capture times, or task-derived
summaries. One real
prohibited-install failure is tied to the shipped `action:install_local`
mechanism regression. See [the inventory audit](evals/inventory-audit-2026-08-28.md)
and [the generated coverage report](evals/replay-coverage.json).

This is coverage evidence, not an 81-case runtime accuracy result. Product
efficacy, false-positive rates, and outcome improvement still require isolated
re-execution and shadow or controlled online comparison. Do not enable
`balanced` broadly based on the inventory alone.

The full command-Hook process continue path measured p50 124.47 ms and p95
140.41 ms on one Windows x64 / Node 20.19.1 source checkout with persistence
disabled. That misses the PRD's provisional 100 ms p95 hypothesis, although it
remains well inside the configured three-second Hook timeout. See
[the raw benchmark snapshot](evals/hook-latency-windows-2026-08-28.json) and
measure on your own host before broad rollout.

## Development

    node --test
    node scripts/sync-package-assets.mjs --check
    node scripts/audit-replay-coverage.mjs --check
    node scripts/validate-release.mjs
    node scripts/benchmark-hook.mjs

Maintainers also run the current Codex plugin and Skill validators before a
release. Those validators are bundled with Codex development environments and
are not runtime dependencies.

Historical replay labels are private by design. The public manifest contains only hashes, labels, and provenance needed to audit coverage.

## License

Apache License 2.0. It permits commercial use, modification, and redistribution and includes an explicit patent grant. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
