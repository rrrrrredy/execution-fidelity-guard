# Execution Fidelity Guard 0.2.1

Execution Fidelity Guard is an Apache-2.0 open-source Codex plugin that checks
explicit task boundaries before tool execution and checks contract-bound
evidence when an Agent claims completion.

## What changed

- Added a dependency-free command that freezes and aggregates pseudonymous
  receipt exports while collecting a real 100-session shadow pilot.
- Rejects duplicate sessions, events, one-event-to-many-receipt mappings,
  unknown reason codes, symlinked inputs, oversized bundles, and accidental
  output overwrite.
- Lazy-loads persistence and event-specific modules so the ordinary
  no-persistence continue path does less work.
- Preserves exact SessionEnd deletion when persistence is off and accepts
  verified non-link Windows 8.3 path aliases without relaxing junction checks.
- Adds an empty-Node process-floor diagnostic to make Windows cold-start cost
  visible without subtracting it from Guard latency.
- Pins CI actions to exact reviewed v7 commits and reports the actual Hook event
  when benchmarking a custom fixture.

## Release evidence

- 85 of 85 automated tests passed on the local Windows release candidate.
- The source release validator passed 295 checks with zero runtime dependencies.
- A real npm tarball was created, extracted, passed 293 internal validation
  checks, and returned deny for the prohibited-install simulation without
  installing the plugin.
- Ten rounds of 20 simultaneous stale-lock contenders remained linearized:
  one transition at a time, complete results 1 through 20, and final state 20.
- The final Windows x64 and Node.js 20.19.1 source benchmark measured 184.76 ms
  p50 and 296.05 ms p95 with persistence disabled. The same run's empty-Node
  process floor measured 189.73 ms p95.

## Honest limits

- The provisional 100 ms continue-path p95 target is not met.
- The shadow summarizer enables auditable collection; it does not mean the 100
  real shadow tasks or 800-task controlled comparison have been completed.
- Installed-client behavior remains intentionally untested on the maintainer's
  machine because this release process forbids local installation.
- Product efficacy, false-positive rate, rework reduction, and outcome
  improvement are not yet established by controlled real-world use.
- Live Intent Loop, Continuity, DeepSeek Harness, and other Host adapters are
  not implemented.
