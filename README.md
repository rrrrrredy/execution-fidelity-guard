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
scope fields remain bounded context in 0.2.1; they are not deterministic,
path-aware gates.

Version 0.2.1 is an open-source preview. It is usable today, but it is a guardrail, not a sandbox or complete security boundary.

## What it does

- Loads a provider-owned intent contract or a strict seven-field TaskContractLite fallback.
- Classifies local tool actions before execution.
- Blocks only deterministic contract conflicts.
- Pauses `requires_user` actions until the user answers and the canonical contract owner publishes a revised contract that records the allowance.
- Records result and decision receipts without retaining prompt, command, or output content.
- Continues an explicit completion claim when required evidence is missing, with an atomic two-attempt cap per session and contract.
- Reinjects the compact active contract when Codex starts a subagent.
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
    node plugins/execution-fidelity-guard/bin/efg.mjs demo
    node plugins/execution-fidelity-guard/bin/efg.mjs check --mode balanced --event examples/events/pre-tool-install.json --contract examples/contracts/no-local-install.json
    node plugins/execution-fidelity-guard/bin/efg.mjs explain --mode balanced --event examples/events/pre-tool-install.json --contract examples/contracts/no-local-install.json

`demo`, `check`, and `explain` run from source and do not install the plugin.
The demo shows one permitted read and one blocked install. The simulated install
action should return a `PreToolUse` deny decision. `check` is read-only and disables persistence.
For a permitted read simulation, `null` means continue. Exit code 0 means
the simulation ran successfully; inspect the JSON output rather than treating
the process exit as an allow or deny verdict.

The first `doctor` run can report `contract - unbound`. That is expected
before you create or point to a contract; use the preset in the next section.

## Install from the GitHub marketplace

Review the repository and Hook commands before trusting them. Codex requires trust review for non-managed Hooks; see the [official Hooks documentation](https://learn.chatgpt.com/docs/hooks).

The supported Host surface is Codex CLI and Codex desktop environments where
plugins are available. The Codex IDE extension does not currently support
plugins, so this Guard cannot run there.

    codex plugin marketplace add rrrrrredy/execution-fidelity-guard --ref v0.2.1
    codex plugin add execution-fidelity-guard@execution-fidelity-guard

Start a new Codex task after installation so the Skill and Hooks are discovered. These commands modify local Codex plugin state; they are not needed for source evaluation.

To remove it:

    codex plugin remove execution-fidelity-guard@execution-fidelity-guard
    codex plugin marketplace remove execution-fidelity-guard

## Bind a task contract

Ask Codex to use `$execution-fidelity`, or create a fallback contract from a source checkout:

    node plugins/execution-fidelity-guard/bin/efg.mjs init

This creates `.execution-fidelity/contract.json` without overwriting an existing file. Replace every placeholder before enforcement.

For a ready no-local-install starting point, supply the objective and primary
object explicitly, then validate the result:

    node plugins/execution-fidelity-guard/bin/efg.mjs init --preset no-local-install --objective "Ship a verified release" --primary-object "my project"
    node plugins/execution-fidelity-guard/bin/efg.mjs contract validate --json

The fallback has exactly seven fields:

1. `objective`
2. `primary_object`
3. `delivery_surface`
4. `scope`
5. `must_and_must_not`
6. `authorization`
7. `completion_evidence`

See [the no-local-install example](examples/contracts/no-local-install.json) and [the action-rule reference](docs/action-rules.md).

`authorization.allowed` records a positive match. It is not an exhaustive
allowlist: an unlisted action continues unless a matching `forbidden`,
`must_not`, or `requires_user` rule intervenes. Use explicit structured rules
for every boundary that must gate execution.

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

A passing Hook-observed result automatically satisfies a requirement only when
the requirement is deterministic and the Host reports a structured success.
For `evidence:test`, the shell command must be one direct test command; chained,
piped, redirected, or merely printed test text cannot satisfy it automatically:

- `evidence:test`
- `evidence:<kind>:action:<tag>`

Natural-language requirements need an explicit evidence record. The safest
source-only path asks Guard to read a regular file of at most 64 MiB and compute
the SHA-256 itself:

    node plugins/execution-fidelity-guard/bin/efg.mjs evidence add --contract .execution-fidelity/contract.json --state-dir .runtime/source-trial --session source-trial-1 --requirement 1 --kind test --status pass --artifact test-results.json

Replace test-results.json with a real result from the current task.
The value 1 selects the first item in the contract's completion_evidence list;
its acceptable_sources must include test.

This is marked `artifact_observed`: Guard verified the artifact bytes and
computed their digest. The caller still chooses the status and requirement, so
this does not prove that the artifact is truthful or semantically sufficient.

For an external artifact Guard cannot open, supply a label and digest:

    node plugins/execution-fidelity-guard/bin/efg.mjs evidence add --contract .execution-fidelity/contract.json --state-dir .runtime/source-trial --session source-trial-1 --requirement 1 --kind test --status pass --source "external test receipt" --sha256 HASH

That record is marked `caller_attested`. The digest should be the SHA-256 of the
exact evidence artifact bytes, for example:

    (Get-FileHash -Algorithm SHA256 .\test-results.json).Hash.ToLower()
    sha256sum ./test-results.json

Guard never turns a fluent completion sentence into observed proof. Both
evidence paths can still carry a false status or an artifact that does not
actually satisfy the requirement.

For each requirement, the newest applicable full evidence wins. A newer failed
or contradictory run invalidates an older pass until a still-newer full pass is
recorded.

Cross-event completion checks require persistence. If `EFG_PERSIST=false`,
action checks still work, but `evidence add` is rejected and a later Stop event
cannot recover earlier evidence.

`--session` is a lookup key. For a source-only trial, choose one label such
as `source-trial-1` and reuse it exactly in every command. In an installed
workflow, SessionStart and SubagentStart give the Agent a pseudonymous
`session:<sha256>` reference; the CLI accepts that value without exposing the
raw Host identifier. Manual evidence is an advanced Agent or automation path.
If the key does not match retained state, `status` and
`receipts summary` report `session_not_found` and a next action.

Inspect, export, or explicitly delete one session's Guard-owned state from a
source checkout:

Source-only demo, check, and explain decisions are intentionally not persisted.
The trial summary below therefore contains only evidence or receipts created by
persistence-enabled commands, such as evidence add.

    node plugins/execution-fidelity-guard/bin/efg.mjs receipts show --state-dir .runtime/source-trial --session source-trial-1
    node plugins/execution-fidelity-guard/bin/efg.mjs receipts summary --state-dir .runtime/source-trial --session source-trial-1 --contract .execution-fidelity/contract.json
    node plugins/execution-fidelity-guard/bin/efg.mjs status --state-dir .runtime/source-trial --session source-trial-1 --contract .execution-fidelity/contract.json
    node plugins/execution-fidelity-guard/bin/efg.mjs receipts export --state-dir .runtime/source-trial --session source-trial-1 --output guard-receipts.json
    node plugins/execution-fidelity-guard/bin/efg.mjs receipts delete --state-dir .runtime/source-trial --session source-trial-1 --yes

Export refuses to overwrite an existing file. Delete requires `--yes` and
targets only the normalized session directory under the dedicated state root.

## Privacy

The runtime makes no network calls. It stores pseudonymous SHA-256 session,
turn, and tool-use references, contract references, action labels, content
hashes, evidence references, and decision receipts under
`$CODEX_HOME/plugin-data/execution-fidelity-guard/v1` by default.

It does not intentionally retain prompts, full commands, tool outputs, transcript contents, hidden reasoning, credentials, or secrets. See [PRIVACY.md](PRIVACY.md).

## Known limits

- Hosted tools such as WebSearch do not traverse the local Hook path.
- A later `write_stdin` call does not trigger a second `PreToolUse` decision.
- Specialized tools can opt out of Hooks.
- The Codex IDE extension does not currently support plugins.
- Shell classification is intentionally conservative and cannot prove arbitrary script behavior.
- Shell wrappers are inspected only for common direct forms; generated scripts and indirect process launch remain outside the deterministic boundary.
- The seven-field contract carries objective, object, delivery, and scope context, but 0.2.1 hard decisions use only explicit `action:`, `tool:`, and `command-prefix:` rules.
- Cost is not represented in the seven-field 0.2.1 contract and is not gated.
- Natural-language rules never become hard blocks without an explicit structured rule.
- `PostToolUse` cannot undo a side effect that already happened.
- A Stop event is a turn boundary, not authoritative task completion.
- Disabling persistence disables evidence continuity between Hook events.
- CLI evidence can verify artifact bytes and digest, but the supplied status and
  semantic sufficiency remain attestations.
- No live Intent Loop adapter or Continuity bridge has been integrated in 0.2.1; the provider document is file-based and the Continuity schema is a reserved boundary.
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

The full command-Hook process continue path measured p50 184.76 ms and p95
296.05 ms on one Windows x64 / Node 20.19.1 source checkout with persistence
disabled. In the same run, an empty Node process measured 189.73 ms p95. The
process floor is diagnostic only and is not subtracted from Guard latency. The
result misses the PRD's provisional 100 ms p95 hypothesis, although it remains
inside the configured three-second Hook timeout. See [the raw benchmark
snapshot](evals/hook-latency-windows-2026-08-31-v0.2.1.json) and measure on your
own host before broad rollout.

## Run a real shadow pilot

This workflow assumes the plugin is installed on the pilot Host and real Hook
events have already been recorded. The summarizer does not create or simulate a
pilot. Keep the default `shadow` mode and persistence enabled. At the end of
each real task, export that task's pseudonymous receipt bundle into a private
directory:

    node plugins/execution-fidelity-guard/bin/efg.mjs receipts export --session SESSION --state-dir STATE_DIR --output pilot-receipts/task-001.json

After collecting distinct task sessions, freeze and summarize the cohort:

    npm run pilot:summary -- --input pilot-receipts --output shadow-pilot.json --target 100

The summarizer accepts only regular JSON receipt exports, rejects duplicate
session and receipt identifiers, hashes every input bundle, and reports the
remaining sample count plus observed would-block and would-ask decisions. Keep
the bundles private; do not commit them to this repository.

Reaching 100 pseudonymous sessions does not prove they were independently
sampled real user tasks. The summary also does not establish precision,
false-positive rate, rework reduction, or outcome improvement without separate
user, external-evidence, or domain-rule adjudication. Its machine-readable
output contract is [evals/shadow-pilot-summary.schema.json](evals/shadow-pilot-summary.schema.json).

## Development

These commands are supported from a source checkout and are also included in
the packaged source artifact:

    node --test
    node scripts/sync-package-assets.mjs --check
    node scripts/audit-replay-coverage.mjs --check
    node scripts/validate-release.mjs
    node scripts/assert-source-simulation.mjs
    node scripts/verify-packed-artifact.mjs
    npm run verify:packed-execution
    node scripts/benchmark-hook.mjs
    npm run pilot:summary -- --input PRIVATE_RECEIPT_DIRECTORY

`node --test` writes temporary test state under ignored `.runtime/tests` and
the suite removes its per-case directories after each run.

The packed-execution verifier creates a temporary npm tarball, extracts it,
runs its own release validator and prohibited-install decision assertion, then
removes the temporary files. It does not install the package.

Maintainers also run the current Codex plugin and Skill validators before a
release. Those validators are bundled with Codex development environments and
are not runtime dependencies.

Historical replay labels are private by design. The public manifest contains only hashes, labels, and provenance needed to audit coverage.

## License

Apache License 2.0. It permits commercial use, modification, and redistribution and includes an explicit patent grant. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
