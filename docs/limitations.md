# Limitations

Execution Fidelity Guard reduces a narrow class of execution drift. It cannot prove that arbitrary Agent behavior is safe or correct.

## Coverage gaps

- Hosted WebSearch and other hosted tools do not use the local function-tool Hook path.
- `write_stdin` transports an existing unified-exec session and does not trigger a second `PreToolUse` decision.
- Specialized tool paths can opt out of Hooks.
- A command can invoke a script whose later behavior is invisible to command-prefix classification.
- Common shell wrappers are inspected, but generated scripts, interpreters, and indirect process launch can still hide later behavior.
- A Hook can observe only the event fields Codex provides.

## Decision limits

- Natural-language interpretation is advisory and never a hard-block authority.
- The classifier intentionally prefers false negatives to broad semantic false positives.
- `PermissionRequest` fires only when Codex already needs approval. The guard abstains unless it finds an explicit conflict.
- `PostToolUse` happens after side effects and cannot roll them back.
- Evidence type matching does not prove the artifact satisfies a natural-language requirement. Such requirements need an explicit contract-bound evidence record.
- Manual CLI evidence is caller-attested. Guard stores the supplied digest but
  does not open the artifact, verify its bytes, or prove the claim is true.
- Objective, primary object, delivery surface, scope, and cost are not
  deterministic gate inputs in 0.1.0. Hard decisions use explicit structured
  action, tool, or command-prefix rules only.
- Stop is a turn boundary. A warning after the two-attempt cap is not a completion verdict.

## Operational limits

- Node.js 20 or later must be available to the Codex process.
- Command Hooks start a Node process for each event. The 2026-08-28 Windows
  source benchmark measured 140.41 ms p95 on the continue path with persistence
  disabled, above the provisional 100 ms PRD target. Other hosts can differ.
- State is local to the configured Codex home unless `EFG_STATE_DIR` changes it.
- With `EFG_PERSIST=false`, later Hook events cannot use evidence from earlier events.
- Concurrent Stop processes can race the read-modify-write counter. The
  two-attempt limit applies to normal sequential Host delivery.
- The live Intent Loop adapter and Continuity bridge are not implemented; the
  provider interface is a local file and the Continuity schema is reserved.
- A provider projection hash validates one document but does not prove global
  contract-version monotonicity across erased state.
- Receipt files are not signed and can be modified by a local process with filesystem access.
- Windows ACL inheritance is platform-managed; the runtime requests restrictive file modes where the platform supports them.
- There is no remote dashboard, telemetry service, or cross-machine synchronization.

Use `shadow` mode first and inspect real would-block receipts before enabling `balanced` in consequential workflows.
