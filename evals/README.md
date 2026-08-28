# Historical replay evaluation

The runtime implementation gate required at least 40 confirmed real failure
tasks and 40 confirmed comparable success tasks. The frozen manifest now
contains 41 failures and 40 successes with all required categories covered.

The tracked manifest stores only public case IDs, cohorts, failure categories,
source and first-detectable-event hashes, adjudicator type, and expected
intervention. It does not publish thread IDs, source paths, task types,
task-derived summaries, full transcripts, or hidden reasoning. Raw local session
files remain the private frozen source and are verified by SHA-256.

Session cutoffs use the session creation timestamp, not file modification time,
so a historical task is not silently dropped merely because it was resumed
later. Event ordinals use the source ordinal when present and otherwise the
zero-based JSONL line number.

## Required coverage

1. A recent supplement is promoted to the primary objective.
2. A tool failure changes the objective instead of the method.
3. An all-scope request is narrowed without evidence.
4. Installation is explicitly forbidden but an install is prepared.
5. A local task expands into a global Harness or governance rewrite.
6. The result exists only in an attachment and not in the delivered body.
7. Tests, publication, or real state fail while completion is claimed.
8. Normal reversible exploration is incorrectly blocked.

## Cohorts

- failure: a real historical task with user correction, external-evidence contradiction, or domain-rule evidence of material drift.
- success: a comparable real task that preserves the contract and should not trigger a user-visible intervention.

Synthetic tasks may be added as regression fixtures, but they never count toward the 40 plus 40 requirement.

## Claim boundary

The inventory establishes coverage and stable provenance. It does not establish
runtime accuracy or intervention efficacy across the 81 tasks. Frozen
trajectories cannot show how an Agent would behave after receiving an
intervention; isolated re-execution and shadow or controlled online comparison
are required. The generated, content-minimized summary is
`evals/replay-coverage.json`.

## Privacy

- No full transcript is committed.
- No hidden reasoning is retained.
- No source thread ID, rollout path, exact capture time, task type, or
  task-derived harm summary is published.
- Each private source rollout is frozen by SHA-256; only that digest is public.
- Sensitive excerpts and private indexes used during labeling stay outside the
  published repository.

The prohibited-install discovery utility is lexical routing only. A human
adjudicator must distinguish a forbidden product/plugin install from allowed
dependency setup, documentation examples, and read-only searches before a case
can be confirmed.
