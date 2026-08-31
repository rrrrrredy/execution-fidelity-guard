---
name: execution-fidelity
description: Inspect, establish, or explain an Execution Fidelity Guard task contract and its action, evidence, or completion decisions. Use when a user asks why an action was blocked or reminded, wants to bind the seven-field fallback contract, or needs contract-bound completion evidence. Do not use it as a planner, permission bypass, or general memory system.
metadata:
  short-description: Explain task-contract guard decisions
---

# Execution Fidelity

Apply explicit structured action rules and evidence checks from the active task
contract without taking ownership of the Agent loop, planning, native
approvals, or the user's intent.

## Source of truth

Use a user-intent provider envelope and bounded projection when one is available. Never replace or write back that provider's canonical state.

Use TaskContractLite only when no user-intent provider is available. Its seven fields are:

- `objective`
- `primary_object`
- `delivery_surface`
- `scope`
- `must_and_must_not`
- `authorization`
- `completion_evidence`

Do not infer that the latest message replaces the objective. Treat it as continuation or amendment unless the user explicitly replaces the objective.

## Inspect or establish a contract

Run the read-only diagnostic first:

    node "${PLUGIN_ROOT}/bin/efg.mjs" doctor

From the repository root, use
`node plugins/execution-fidelity-guard/bin/efg.mjs doctor`.

If the fallback is unbound and the user wants one, create the template:

    node "${PLUGIN_ROOT}/bin/efg.mjs" init

Review and replace every placeholder before relying on it. Do not overwrite an existing contract or create one merely to bypass a decision.

When the user's explicit boundary forbids local installation, create a ready
starting contract without inventing the objective or object:

    node "${PLUGIN_ROOT}/bin/efg.mjs" init --preset no-local-install --objective "EXACT OUTCOME" --primary-object "PRIMARY OBJECT"
    node "${PLUGIN_ROOT}/bin/efg.mjs" contract validate --json

## Deterministic action rules

Only structured rules can hard-block or require a user question:

- `action:read`
- `action:write` or `action:write_workspace`
- `action:delete` or `action:destructive`
- `action:install_local`
- `action:network`
- `action:publish`
- `action:external`
- `tool:<exact canonical hook tool name>`
- `command-prefix:<literal command prefix>`

Place them under `authorization.allowed`, `authorization.requires_user`, `authorization.forbidden`, or `must_and_must_not.must_not`.

`authorization.allowed` is not a closed allowlist. An unlisted action continues
unless `forbidden`, `must_not`, or `requires_user` matches. Put each boundary
that must gate execution in one of those three fields and validate reserved
action tags before relying on them.

Natural-language constraints remain semantic candidates. They can remind but cannot hard-block by themselves. Do not rewrite natural language into a structured rule unless the user has made the same authorization boundary explicit.

Default mode is `shadow`: record and explain would-block or would-ask decisions without enforcing them. Use `EFG_MODE=balanced` only after the contract has been reviewed. Never auto-approve a `PermissionRequest`.

## Handle a decision

- `continue`: proceed without extra ceremony.
- `remind`: compare the pending action with the active contract; do not portray the reminder as a deterministic conflict.
- `ask`: relay one concise authorization question to the user. A chat
  answer is not consumed automatically. Do not retry until the canonical owner
  publishes a revised contract that moves the exact rule to `allowed`.
- `block`: choose a non-conflicting action or obtain an explicit contract change. Do not edit the contract simply to evade the block.
- `continue_verification`: gather new evidence before repeating a completion claim.

To reproduce a hook decision without installing the plugin:

    node "${PLUGIN_ROOT}/bin/efg.mjs" check --event EVENT.json --contract CONTRACT.json

For a content-free explanation of classification and policy, use:

    node "${PLUGIN_ROOT}/bin/efg.mjs" explain --event EVENT.json --contract CONTRACT.json --mode balanced

Use `demo` for a no-write, no-install walkthrough.

## Completion evidence

Hook-observed results are stored as hashes and minimal labels. They are partial
evidence unless a requirement uses the exact deterministic form
`evidence:<kind>` or `evidence:<kind>:action:<tag>`. A test can satisfy
automatically only when it is one direct test command and the Host supplies a
structured passing result; chains, pipes, redirects, and text that merely says
"exit code 0" do not qualify.

For a natural-language requirement, prefer having Guard observe and hash the
artifact bytes:

    node "${PLUGIN_ROOT}/bin/efg.mjs" evidence add --session SESSION_REF --requirement 1 --kind test --status pass --artifact test-results.json

The CLI records this as `artifact_observed`. That proves only which bytes
were read and hashed; the caller-supplied status and semantic sufficiency remain
unverified. If Guard cannot open the artifact, use `--source LABEL --sha256 HASH`;
that record is `caller_attested`. A user attestation may use kind `user`
without a hash. Never mark evidence `pass` based only on model confidence
or a completion sentence.

Persistence must be enabled for `evidence add`. For each requirement, the
newest applicable full record wins, so a newer failure or contradiction
invalidates an older pass.

Use the pseudonymous `session:<sha256>` reference injected at SessionStart
or SubagentStart as `SESSION_REF`; do not request or reveal the raw Host
session identifier. For a source-only trial with no Host events, choose one
label and reuse it exactly. Treat `session_not_found` as a lookup error,
not as proof that completion evidence is missing.

The Stop hook uses a per-session lock and can continue verification at most
twice for one contract even when matching Stop processes overlap. Reaching the
cap is a warning, not proof of completion. A lock or storage failure must not
create an unbounded continuation loop.

## Privacy and failure boundary

Do not persist prompts, full commands, tool outputs, transcripts, hidden
reasoning, credentials, secrets, or raw Host session, turn, or tool-use
identifiers. Store only pseudonymous references, contract references,
normalized labels, hashes, evidence references, and decision receipts.

If the guard fails or the contract is invalid, it fails open and must not weaken Codex sandboxing, native approvals, or other controls. Report that coverage gap accurately.
