# Intent, continuity, guard, and host integration contract

Status: frozen for Execution Fidelity Guard 0.1.0.

This contract keeps four products from becoming competing sources of truth.
It describes the interface implemented by this repository and names the
integration work that has not been implemented or verified.

## Guard read-only input

When Intent Loop is available, Guard reads one local provider document from the
configured contract path. The minimum accepted document is:

~~~json
{
  "envelope": {
    "schema_version": "1.0",
    "contract_ref": "intent:stable-task-id",
    "contract_version": 1,
    "source": "user-intent-plugin",
    "source_message_refs": [],
    "snapshot_sha256": "lowercase SHA-256 of the canonical projection",
    "updated_at": "2026-08-28T00:00:00.000Z"
  },
  "projection": {
    "objective": "Exact user-requested outcome",
    "primary_object": "Object being changed or delivered",
    "delivery_surface": ["repository"],
    "scope": {
      "include": ["workspace"],
      "exclude": []
    },
    "must_and_must_not": {
      "must": [],
      "must_not": []
    },
    "authorization": {
      "allowed": [],
      "requires_user": [],
      "forbidden": []
    },
    "completion_evidence": [
      {
        "requirement": "Evidence required for completion",
        "acceptable_sources": ["test"]
      }
    ]
  }
}
~~~

The projection has exactly seven top-level fields. Additional fields fail
validation. The complete machine-readable contracts are
`provider-contract.schema.json`, `contract-envelope.schema.json`, and
`task-contract-lite.schema.json` under the plugin `spec` directory.

Guard canonicalizes the projection by recursively sorting object keys while
preserving array order, computes SHA-256 over that JSON, and requires it to
match `snapshot_sha256`. A missing or invalid provider document leaves Guard
unbound and advisory; it does not hard-block.

If Intent Loop is unavailable, a workspace may provide the same seven-field
projection as TaskContractLite. Guard derives a content-addressed contract
reference and assigns fallback version 1. The fallback is not a copy of Intent
Loop state and must not be treated as provider-owned truth.

## Version semantics

- `schema_version` is the wire format version. Runtime 0.1.0 accepts exactly
  `1.0`; a future incompatible shape requires a new major schema version.
- `contract_ref` is the stable identity of one user intent.
- `contract_version` is a positive integer. Intent Loop increments it for every
  material, user-authorized change to the objective, object, delivery surface,
  scope, constraints, authorization, or completion evidence.
- A `(contract_ref, contract_version)` pair is immutable. Re-serialization with
  the same canonical projection is allowed; changing the projection requires a
  larger version.
- `snapshot_sha256` proves that the current document and projection agree. Guard
  0.1.0 does not maintain a global version ledger, so it cannot prove that a
  provider never reused a version with a different, newly hashed projection or
  that versions were globally monotonic across erased state.
- `updated_at` and `source_message_refs` are provenance. They do not override the
  version identity or make the latest message the objective by themselves.

## State ownership

| Product | Owns | Must not own |
|---|---|---|
| Intent Loop | Canonical current user intent, `contract_ref`, `contract_version`, material-change classification, and user-message provenance | Guard decisions, execution receipts, Host permissions, or continuity resume state |
| Continuity | Resume phase, open commitments, and references to contract and evidence needed after interruption or compaction | Canonical intent, authorization decisions, raw transcript copies, or Guard policy |
| Guard | Normalized Hook events, deterministic action classification, decisions, minimal evidence and receipts, retention, and the bounded Stop continuation counter | Intent mutation, provider versioning, Agent-loop control, sandbox policy, or native permission approval |
| Host | Tool execution, Hook delivery, task lifecycle, user interaction, sandboxing, trust review, and native permission decisions | Rewriting provider intent or treating Guard receipts as proof of user authorization |

Guard does not write any state back to Intent Loop or Continuity. It only:

1. reads the provider document;
2. writes Guard-owned local events, receipts, evidence, and Stop state when
   persistence is enabled;
3. emits bounded context or deny responses to the Host; and
4. accepts an explicit manual evidence record through its own CLI.

A `requires_user` decision remains denied until the owner changes the
contract. A user answer in chat is not consumed by Guard. Intent Loop records
the approved bounded action in a higher contract version; a reviewed
TaskContractLite fallback must be edited so its content-derived identity
changes. Retrying the unchanged contract asks again.

The shipped `continuity-snapshot.schema.json` reserves the smallest future
Continuity interchange: `contract_ref`, `contract_version`, `phase`,
`open_commitments`, `evidence_refs`, and `captured_at`, plus schema version.
Guard 0.1.0 does not load that snapshot and no live Continuity bridge is
implemented.

## Not implemented, not verified, or not guaranteed

- No live Intent Loop adapter has been integrated; only file-based provider
  document loading and validation are implemented.
- No live Continuity producer or consumer bridge has been implemented.
- The plugin was not installed into the maintainer's local Codex environment,
  so installed-client discovery and end-to-end Hook delivery remain unverified.
- Hosted WebSearch, specialized tools that opt out of Hooks, and later
  `write_stdin` input are outside complete interception.
- Common direct shell wrappers are classified, but generated scripts and
  indirect process launch can hide later behavior.
- Hook exceptions fail open. Multiple Hook configurations can run concurrently,
  and Guard does not replace Host sandbox or approval policy.
- Guard has no native question UI. An `ask` decision denies the pending action
  and tells the Agent to ask the user.
- Stop is a turn boundary, not authoritative goal completion.
- The frozen 41-failure and 40-success inventory proves corpus coverage, not
  81-case runtime accuracy, false-positive rate, or outcome improvement.
- The measured Windows source continue path was 140.41 ms p95 with persistence
  disabled, missing the provisional 100 ms target. Installed-client, macOS, and
  Linux latency have not been measured.
- There is no semantic model in 0.1.0, and natural-language rules cannot become
  hard blocks by themselves.
- Objective, primary-object, delivery-surface, scope, and cost fields are not
  deterministic gate inputs in 0.1.0.
- Manual CLI evidence is caller-attested rather than independently verified.
- Concurrent Stop processes can race the two-attempt counter; the cap assumes
  normal sequential Host delivery.
