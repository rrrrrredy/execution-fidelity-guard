# Changelog

All notable changes follow semantic versioning.

## 0.2.1 - 2026-08-31

### Added

- A dependency-free shadow-pilot summarizer that rejects duplicate sessions,
  events, one-event-to-many-receipt mappings, unknown reason codes, and
  receipts; freezes each pseudonymous export by SHA-256; and reports progress
  toward a caller-selected real-session target.
- A machine-readable shadow-pilot summary schema with explicit sampling and
  efficacy claim boundaries.
- An optional empty-Node process-floor diagnostic in the Hook benchmark.

### Changed

- Persistence, evidence, and completion modules are loaded only for events that
  use them, reducing unnecessary work on the no-persistence continue path.
- SessionEnd still honors exact-session deletion when event persistence is off.
- State paths accept verified non-link Windows 8.3 aliases after
  canonicalization while link and junction components remain rejected.
- Concurrent stale Stop-lock recovery now uses an owner-token reclaim claim and
  revalidates the stale owner before removal, preserving one linearized
  transition under contention.
- Release validation now checks the shadow-pilot workflow and the benchmark's
  process-floor claim boundary.
- CI now pins checkout and Node setup actions to reviewed v7 commit SHAs.
- Custom Hook benchmark fixtures report their actual event name.
- The final Windows source benchmark records 296.05 ms p95 with persistence
  disabled; the same run's empty-Node process floor was 189.73 ms p95. The
  provisional 100 ms p95 hypothesis remains unmet.

### Known limits

- No 100-task real shadow cohort or 800-task controlled online comparison has
  been completed. The aggregator makes collection auditable but is not product
  efficacy evidence.
- Installed-client Hook delivery remains deliberately untested on the
  maintainer's machine.
- Live Intent Loop, Continuity, DeepSeek Harness, and other Host adapters remain
  unimplemented.

## 0.2.0 - 2026-08-31

### Added

- Ready `no-local-install` contract preset plus `contract validate`.
- Source-only `demo` and content-free `explain` commands.
- Completion status and compact receipt summaries.
- Guard-observed artifact hashing with mismatch rejection and a 64 MiB limit.
- SubagentStart contract injection and SubagentStop lifecycle receipts.
- macOS coverage in the dependency-free CI matrix.
- Self-consistent npm source artifacts containing every advertised script and test.

### Changed

- Persisted and exported Host session, turn, and tool-use identifiers are now
  pseudonymous SHA-256 references; legacy raw fields are sanitized on display
  and export.
- Overlapping local Stop processes now share an exclusive per-session lock and
  atomic two-attempt counter.
- Evidence documentation distinguishes Hook observation, artifact-byte
  observation, and caller attestation.
- Newer full failure or contradictory evidence supersedes an older pass;
  chained or text-only test output cannot create a passing completion receipt.
- Guard-owned event and evidence records move to wire schema 2.0; input
  contracts and decision receipts remain wire schema 1.0.
- State operations reject link or junction path components and oversized
  externally modified records. Stop locks use owner tokens, local-process
  liveness checks, atomic rename on release, and a 30-second stale threshold.
- CI now parses the prohibited-install simulation decision and executes the
  release validator and block assertion from a real extracted npm tarball.
- The current Windows source benchmark records 172.02 ms p95 with persistence
  disabled. The provisional 100 ms p95 hypothesis remains unmet.

### Known limits

- The public preview is still a guardrail, not a sandbox or authorization
  boundary.
- Live Intent Loop and Continuity bridges remain file-contract interfaces only.
- Installed-client Hook delivery was deliberately not tested on the maintainer's
  machine.
- Artifact-byte observation does not verify a caller-supplied status or semantic
  sufficiency.
- Product efficacy, false-positive rate, and outcome improvement remain
  unproven without isolated replay and controlled online evaluation.

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
- Objective, object, delivery, and scope are context fields rather than
  deterministic hard gates in this preview; cost is not represented.
- Concurrent Stop processes can race the continuation counter.
- One Windows source benchmark missed the provisional 100 ms continue-path p95 target (140.41 ms with persistence disabled).
