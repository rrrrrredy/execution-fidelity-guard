# Execution Fidelity Guard 0.2.2

Correctness and evidence-integrity patch for the Codex preview.

This release closes common package-manager option and shell-wrapper bypasses,
including nested `env`, `sudo`, `command`, `nohup`, `nice`, `timeout`, `exec`,
and `time` forms. It distinguishes read-only Git branch inspection from
mutation and prevents named-tool heuristics from overriding parsed commands.
It also covers common dependency-changing manager verbs, core PowerShell and
POSIX file writers, mutating HTTP calls, and explicit local or remote deletion
forms without treating nearby read-only commands as mutations.

Automatic test evidence now excludes help, version, list, collection-only,
`--if-present`, and compile-without-running forms. Generic release commands no
longer create release evidence because the contract cannot bind an expected
repository and tag.

Mode behavior is explicit: `off` emits no Hook policy/context output; `shadow`
keeps pending-tool conflicts non-blocking and records completion gaps without
steering; `balanced` enforces structured rules and may request at most two
verification passes.

Shadow-pilot summary schema 1.1 counts only sessions with consistent exported
`guard_mode=shadow` provenance. Off, balanced, and legacy mode-unbound exports
remain diagnostic and cannot satisfy the 100-session gate.

## Release verification

- 98 of 98 automated tests passed on the local Windows candidate.
- The release validator passed 295 checks with zero runtime dependencies.
- The npm tarball surface contains 82 files. A fresh extraction passed 293
  internal checks and returned deny for the prohibited-install simulation;
  the verifier confirms it did not install the plugin.
- The exact release commit is required to pass public Windows, Ubuntu, and
  macOS CI before the tag and Release are published.

The release remains an Apache-2.0 guardrail, not a sandbox or authorization
boundary. The exact 0.2.2 Windows source Hook path measured 134.57 ms p95 over
100 runs against a provisional 100 ms target. Installed-client UX, a real 100-task shadow cohort,
the 800-task controlled comparison, and real-world efficacy remain unverified.

A separate unofficial DeepSeek Harness adapter is available at
https://github.com/rrrrrredy/dsh-execution-fidelity-guard and is pinned to
Harness 0.1.2-alpha.2.
