# Execution Fidelity Guard 0.2.0

Execution Fidelity Guard is an Apache-2.0 open-source Codex plugin that checks
explicit task boundaries before tool execution and checks contract-bound
evidence when an Agent claims completion.

## What is ready

- Source-only doctor, demo, contract initialization, validation, explanation,
  status, evidence, and receipt workflows.
- Deterministic action gates for local installation, workspace writes,
  destructive operations, publishing, network activity, and external changes.
- SessionStart, SubagentStart, PreToolUse, PermissionRequest, PostToolUse,
  Stop, SubagentStop, and SessionEnd coverage.
- Pseudonymous identifiers, local-only storage, bounded records, exact-session
  deletion, and owner-token Stop locking.
- Apache-2.0 licensing, security and privacy policies, contribution guide,
  three-OS CI, package inventory verification, and real tarball execution.

## Release evidence

- 80 of 80 automated tests passed on the final local candidate.
- The source release validator passed 287 checks with zero runtime dependencies.
- A real npm tarball was created, extracted, and ran 285 internal validation
  checks plus a prohibited-install simulation that returned deny.
- The final Windows x64 and Node.js 20.19.1 source benchmark measured
  146.54 ms p50 and 172.02 ms p95 with persistence disabled.

## Honest limits

- The 100 ms provisional p95 target is not met.
- Installed-client behavior is intentionally untested on the maintainer
  machine because this release process forbids local installation.
- Product efficacy, false-positive rate, and outcome improvement are not yet
  established by controlled real-world use.
- Live Intent Loop and Continuity adapters are not implemented.
- DeepSeek Harness is a strong next adapter target, but this package is not
  currently a DeepSeek Harness plugin.
