# Changelog

All notable changes follow semantic versioning.

## 0.1.0 - 2026-08-28

### Added

- Self-hosted Git marketplace packaging for Codex.
- Provider-envelope and seven-field TaskContractLite loading.
- Shadow, balanced, and off modes.
- Deterministic PreToolUse block and requires-user decisions.
- PermissionRequest deny-or-abstain behavior.
- Content-free normalized events, decision receipts, and evidence references.
- PostToolUse failure feedback and structured evidence matching.
- Completion verification with a two-attempt cap under normal sequential Host delivery.
- Dependency-free doctor, init, check, status, evidence, and per-session receipt CLI.
- Thirty-day inactive-session retention, explicit exact-session deletion, and optional SessionEnd deletion.
- Canonical projection hash enforcement for provider-owned intent contracts.
- A frozen Intent Loop, Continuity, Guard, and Host integration contract.
- De-identified public replay artifacts with source threads, paths, times, task
  types, and task-derived summaries kept private.
- Init-template readiness checks, collision-resistant session directories,
  fallback snapshot verification, caller-attested evidence labels, and direct
  command regression coverage.
- Positive, negative, failure-regression, privacy, and lifecycle tests.
- Frozen historical replay protocol and public coverage manifest.
- Cross-platform dependency-free CI, market release validation, and a source-only Hook latency benchmark.

### Known limits

- Hosted and specialized tool coverage is incomplete.
- Natural-language rules are reminders only.
- PostToolUse cannot roll back completed side effects.
- The release is a public preview and not an authorization or sandbox boundary.
- Live Intent Loop and Continuity bridges are not implemented or verified.
- Objective, object, delivery, scope, and cost are context fields rather than
  deterministic hard gates in this preview.
- Concurrent Stop processes can race the continuation counter.
- One Windows source benchmark missed the provisional 100 ms continue-path p95 target (140.41 ms with persistence disabled).
