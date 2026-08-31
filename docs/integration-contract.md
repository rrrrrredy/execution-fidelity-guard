# Intent, continuity, guard, and host integration contract

Status: frozen for Execution Fidelity Guard 0.2.2 and the separate unofficial
DeepSeek Harness adapter 0.1.0-alpha.2.

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
Loop state and must not be treated as provider-owned truth. A caller-supplied
standalone fallback envelope is rejected so the caller cannot reuse a stale
`contract_ref` or `contract_version` after changing the projection.

## Version semantics

- Provider documents and bare TaskContractLite inputs use wire schema `1.0`,
  which runtime 0.2.2 accepts exactly. Continuity snapshots and decision
  receipts also remain `1.0`.
- Guard-owned normalized event and evidence-record outputs use wire schema
  `2.0`, introduced in runtime 0.2.0 and retained in 0.2.2. The major bump covers new subagent event values,
  pseudonymous Host identifier semantics, and artifact attestation that strict
  1.0 consumers cannot safely assume they understand. The `facts` object is an
  intentionally open extension point already present in event schema 2.0;
  runtime 0.2.2 documents the optional token `guard_mode` there without
  changing the envelope, required fields, or their semantics. A compatible
  envelope or required-semantics addition would require a documented wire
  minor version.
- Shadow-pilot summaries use wire schema `1.1`; their sample gate counts only
  sessions whose events consistently record `guard_mode=shadow`.
- Package version and wire `schema_version` are independent. Consumers select
  the matching schema for each record. Any future incompatible shape requires
  another wire major version; compatible additions require a documented minor
  version.
- `contract_ref` is the stable identity of one user intent.
- `contract_version` is a positive integer. Intent Loop increments it for every
  material, user-authorized change to the objective, object, delivery surface,
  scope, constraints, authorization, or completion evidence.
- A `(contract_ref, contract_version)` pair is immutable. Re-serialization with
  the same canonical projection is allowed; changing the projection requires a
  larger version.
- `snapshot_sha256` proves that the current document and projection agree. Guard
  0.2.2 does not maintain a global version ledger, so it cannot prove that a
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
3. emits bounded context, including at SessionStart and SubagentStart, or deny
   responses to the Host; and
4. accepts an explicit manual evidence record through its own CLI.

`requires_user` follows the Host's approval surface without transferring state
ownership. On Codex, Guard has no native one-call ask result: the action remains
denied until Intent Loop publishes a higher contract version, or a reviewed
TaskContractLite fallback is edited so its content-derived identity changes.
A chat answer is not consumed by Codex Guard, and retrying the unchanged
contract asks again. On DeepSeek Harness, native ask can authorize only that
exact pending call. It does not modify the contract, write Intent or Continuity
state, or authorize a later similar call; the later call asks again.

`authorization.allowed` is not a closed allowlist. It records an explicit
positive match, while an unlisted action continues unless `forbidden`,
`must_not`, or `requires_user` matches. Guard does not infer default-deny from
an incomplete allowed list.

The shipped `continuity-snapshot.schema.json` reserves the smallest future
Continuity interchange: `contract_ref`, `contract_version`, `phase`,
`open_commitments`, `evidence_refs`, and `captured_at`, plus schema version.
Guard 0.2.2 does not load that snapshot and no live Continuity bridge is
implemented.

## Not implemented, not verified, or not guaranteed

- No live Intent Loop adapter has been integrated; only file-based provider
  document loading and validation are implemented.
- No live Continuity producer or consumer bridge has been implemented.
- This Codex package is Host-specific. A separate unofficial DeepSeek Harness
  adapter is implemented against Harness `0.1.2-alpha.2`; its source and real
  ToolRuntime/AgentLoop composition are tested, but installed-profile UX and
  future Harness alphas are not guaranteed.
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
- The exact 0.2.2 Windows source continue path measured 134.57 ms p95 over 100
  runs with persistence disabled; 100 empty Node processes measured 117.13 ms
  p95 in the same run. The
  process floor is diagnostic only, the full path misses the provisional 100 ms
  target, and installed-client, macOS, and Linux latency remain unmeasured.
- No 100-task real shadow cohort or 800-task controlled online comparison has
  been completed. The shipped aggregator freezes receipt bundles and counts
  only mode-proven shadow sessions; it does not establish real sampling,
  accuracy, efficacy, or outcome improvement without adjudication and
  controlled execution.
- There is no semantic model in 0.2.2, and natural-language rules cannot become
  hard blocks by themselves.
- Objective, primary-object, delivery-surface, scope, and must fields are
  bounded Agent context, not deterministic gate inputs in 0.2.2. Cost is not
  represented in the 0.2.2 input schema and is not gated.
- The seven-field input has no expected release repository or tag. Neither
  adapter creates automatic `release` evidence from generic release commands;
  a Host or user must verify the intended public Release separately.
- `artifact_observed` evidence proves only which local file bytes Guard
  read and hashed. The status and semantic sufficiency remain caller claims;
  label-plus-digest evidence remains fully caller-attested.
- Overlapping Stop processes share an atomic two-attempt counter only when they
  use the same local state root and filesystem. The cap is not global across
  machines, different state roots, or erased state.
- SubagentStart contract injection and SubagentStop recording are covered by
  source tests. Installed-client delivery and whether every future subagent
  implementation traverses these Host events remain unverified.
- The Codex IDE extension does not currently support plugins, so Guard cannot
  execute on that Host surface.
