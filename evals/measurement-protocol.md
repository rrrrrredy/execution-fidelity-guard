# Measurement protocol

## Unit of analysis

One case is one real user task represented by one stable Codex source thread and its frozen rollout hash. Multiple turns in the same thread do not count as separate tasks.

## Required labels

Each case records:

- cohort: failure or success;
- task type and matched comparison case;
- severity;
- material-drift category;
- first event where the drift was observable;
- available adjudicator: user, external evidence, or domain rule;
- original harm;
- expected intervention level;
- source rollout hash and event reference;
- whether isolated re-execution is required to measure intervention efficacy.

## Five replay arms

1. Native Agent without the plugin.
2. Deterministic rules only.
3. Executing Agent self-check.
4. Independent semantic reviewer.
5. Deterministic rules plus independent semantic candidate review plus external evidence.

## What frozen replay can prove

Frozen trajectories measure detection, false positives, and lead time. They cannot prove that an intervention would improve the delivered outcome because the historical Agent did not actually receive that intervention.

## What requires isolated re-execution

Outcome acceptance, rework reduction, additional user time, and exploration impact require isolated task re-execution with controlled model version, permission mode, task type, and environment.

## Adjudication authority

- User intent, authorization, preference, and acceptance belong to the user.
- File, command, test, API, database, real-page, and release facts belong to current evidence.
- High-risk domain rules require the relevant rule set or domain reviewer.
- An independent model is a candidate classifier and explanation aid, never the sole final judge.

## Primary metrics

- Major drift early-detection rate.
- Observable-subset recall.
- Lead time in substantive actions and wall time.
- High-risk detection before irreversible action.
- Material rework relative to control.
- Invalid user-visible reminders.
- False blocks.
- Additional user time.
- User-accepted outcome rate.
- Open-task success and exploration-quality non-inferiority.
- Deterministic continue-path p95 latency.
- Semantic-review p95 latency.
- Incremental token and wall-clock cost.

Tool calls, Hook calls, and plan steps are diagnostic only.
