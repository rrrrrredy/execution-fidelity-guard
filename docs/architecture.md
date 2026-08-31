# Architecture

Execution Fidelity Guard is one plugin with a dependency-free Node.js runtime. It does not own the Agent loop.

~~~mermaid
flowchart LR
  A[Provider contract or TaskContractLite] --> B[Contract loader]
  C[Codex Hook event] --> D[Content-free normalizer]
  B --> E[Deterministic policy]
  D --> E
  E --> F[Hook response]
  E --> G[Decision receipt]
  D --> H[Evidence reference]
  H --> I[Completion verifier]
  B --> I
  I --> F
~~~

## Contract precedence

1. A user-intent provider owns the canonical contract.
2. The guard accepts the provider's envelope plus a bounded TaskContractLite-shaped projection.
3. Only when no provider is available may a workspace use `.execution-fidelity/contract.json`.
4. An invalid or missing contract leaves the guard unbound. It cannot hard-block in that state.

The runtime never writes back provider or Continuity state. The complete
read-only interface and four-party ownership split are frozen in
[integration-contract.md](integration-contract.md).

## Event path

- `SessionStart` adds a bounded contract summary or an unbound warning.
- `SubagentStart` adds the same bounded contract summary for the new agent.
- `UserPromptSubmit` reminds the model that the contract remains active.
- `PreToolUse` classifies the pending action and can deny an explicit deterministic conflict.
- `PermissionRequest` can deny the same conflict or abstain. It never returns allow.
- `PostToolUse` records a result hash and status. It cannot undo the action.
- `PreCompact` and `PostCompact` record lifecycle coverage without copying transcript content.
- `SubagentStop` records content-free lifecycle coverage.
- `Stop` checks explicit completion language against the newest applicable
  evidence for every requirement and can continue twice per session and
  contract. A newer full failure or contradiction supersedes an older pass.
- `SessionEnd` records closure metadata and can delete only that session's
  Guard-owned state when explicitly configured.

## Storage

Records are split into per-session `events`, `receipts`, and `evidence` directories. Each record is written to a temporary file and atomically renamed. Concurrent Hooks therefore do not append to a shared JSONL file.

Raw Host session identifiers are used only to resolve a SHA-256-named local
directory. Session, turn, and tool-use identifiers are persisted only as
pseudonymous references. The Stop
counter uses an exclusive per-session lock and atomic state replacement so
overlapping local Hook processes share the same two-attempt cap.
SessionStart and SubagentStart expose only that pseudonymous reference to the
Agent, and storage accepts it as an alias for the same directory.

The retention cap applies independently to each bucket. SessionStart also
prunes inactive session directories older than `EFG_RETENTION_DAYS`, and an
opt-in SessionEnd control can delete the exact ending session. General receipt
storage failure remains non-critical. If the Stop counter cannot be updated,
Guard emits a high-severity reminder and does not request another automatic
continuation.

Every state-directory component is checked before reads, writes, pruning, and
deletion. Links and junctions are rejected, and externally modified record
files above the documented size limits are ignored.

## Failure behavior

Parsing, contract loading, or runtime exceptions fail open: the entry point exits successfully without a deny decision and emits a generic warning. This avoids turning a plugin defect into a replacement permission system.

Native Codex sandboxing and approval behavior remain authoritative.
