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

## Completion evidence

Hook-observed results are stored as hashes and minimal labels. They are partial evidence unless a requirement uses the exact deterministic form `evidence:<kind>` or `evidence:<kind>:action:<tag>`.

For a natural-language requirement, bind a verified artifact manually:

    node "${PLUGIN_ROOT}/bin/efg.mjs" evidence add --session SESSION --requirement 1 --kind test --status pass --source "node --test receipt" --sha256 HASH

Passing non-user evidence requires a SHA-256. Manual records are
`caller_attested`: the CLI does not open the artifact or prove the claim.
A user attestation may use kind `user` without a hash. Never mark evidence
`pass` based only on model confidence or a completion sentence.

The Stop hook can continue verification at most twice under normal sequential
Host delivery. Concurrent Stop processes can race the counter. Reaching the
cap is a warning, not proof of completion.

## Privacy and failure boundary

Do not persist prompts, full commands, tool outputs, transcripts, hidden reasoning, credentials, or secrets. Store only contract references, normalized labels, hashes, evidence references, and decision receipts.

If the guard fails or the contract is invalid, it fails open and must not weaken Codex sandboxing, native approvals, or other controls. Report that coverage gap accurately.
