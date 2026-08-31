# Limitations

Execution Fidelity Guard reduces a narrow class of execution drift. It cannot prove that arbitrary Agent behavior is safe or correct.

## Coverage gaps

- Hosted WebSearch and other hosted tools do not use the local function-tool Hook path.
- `write_stdin` transports an existing unified-exec session and does not trigger a second `PreToolUse` decision.
- Specialized tool paths can opt out of Hooks.
- The Codex IDE extension does not currently support plugins.
- A command can invoke a script whose later behavior is invisible to command-prefix classification.
- Common shell wrappers are inspected, but generated scripts, interpreters, and indirect process launch can still hide later behavior.
- A Hook can observe only the event fields Codex provides.

## Decision limits

- Natural-language interpretation is advisory and never a hard-block authority.
- `authorization.allowed` is not an exhaustive allowlist. Unlisted actions are
  not denied unless an explicit `forbidden`, `must_not`, or `requires_user`
  rule matches.
- The classifier intentionally prefers false negatives to broad semantic false positives.
- `PermissionRequest` fires only when Codex already needs approval. The guard abstains unless it finds an explicit conflict.
- `PostToolUse` happens after side effects and cannot roll them back.
- Evidence type matching does not prove the artifact satisfies a natural-language requirement. Such requirements need an explicit contract-bound evidence record.
- CLI evidence supplied with `--artifact` is read and hashed by Guard, but
  the caller still chooses the status and requirement. Byte observation does
  not prove the claim is true or the artifact is semantically sufficient.
- CLI evidence supplied as a label plus digest remains caller-attested.
- Objective, primary object, delivery surface, scope, and must fields are
  bounded Agent context, not deterministic gate inputs in 0.2.2. Cost is not
  represented in the 0.2.2 contract. Hard decisions use explicit structured
  action, tool, or command-prefix rules only.
- Stop is a turn boundary. A warning after the two-attempt cap is not a completion verdict.

## Operational limits

- Node.js 20 or later must be available to the Codex process.
- Command Hooks start a Node process for each event. The exact 0.2.2 Windows
  source snapshot measured 134.57 ms p95 over 100 continue-path runs with
  persistence disabled, while 100 empty Node processes in the same run measured
  117.13 ms p95.
  The latter is diagnostic only and is not subtracted from Guard latency. The
  full path remains above the provisional 100 ms PRD target. Other hosts can
  differ.
- State is local to the configured Codex home unless `EFG_STATE_DIR` changes it.
- With `EFG_PERSIST=false`, later Hook events cannot use evidence from earlier events.
- Overlapping local Stop processes that share one state root use an exclusive
  owner-token file lock and one atomic counter. A stale lock is reclaimed only
  after 30 seconds when its same-host process is known to be dead; release uses
  an owner check plus atomic rename so an old holder cannot unlink a new lock.
  The cap is not global across machines, different state roots, erased state,
  or filesystems that do not preserve the required exclusive-create and rename
  semantics. A lock failure produces a reminder and no automatic continuation.
- The live Intent Loop adapter and Continuity bridge are not implemented; the
  provider interface is a local file and the Continuity schema is reserved.
- The separate unofficial DeepSeek Harness adapter is pinned to upstream
  `0.1.2-alpha.2`, stores receipts only in memory, and has no locally installed
  profile walkthrough in this release process.
- A provider projection hash validates one document but does not prove global
  contract-version monotonicity across erased state.
- Receipt files are not signed and can be modified by a local process with filesystem access.
- State reads, writes, pruning, and deletion reject link or junction components
  and oversized records. A hostile local process with concurrent filesystem
  access is still outside the security boundary.
- Windows ACL inheritance is platform-managed; the runtime requests restrictive file modes where the platform supports them.
- There is no remote dashboard, telemetry service, or cross-machine synchronization.
- The repository can aggregate pseudonymous receipt bundles toward a shadow
  sample target. Only sessions whose events consistently record
  `guard_mode=shadow` count toward that gate. No 100-task real shadow cohort or
  800-task controlled online comparison has been completed for this release.

In `shadow`, pending-tool conflicts are non-blocking reminders and completion
gaps are recorded without turn steering. `balanced` is the only enforcing and
completion-continuing mode; `off` emits no Hook policy or context output.

Use `shadow` mode first and inspect real would-block receipts before enabling `balanced` in consequential workflows.
