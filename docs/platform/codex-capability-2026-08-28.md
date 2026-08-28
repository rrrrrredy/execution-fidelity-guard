# Codex capability verification

Verified on 2026-08-28. This document separates current official behavior, local runtime evidence, and the product decision derived from them.

## Evidence levels

- Official: current OpenAI Docs or OpenAI Developers documentation.
- Local: direct output from the installed Codex CLI or the plugin-creator validator.
- Decision: the bounded MVP behavior adopted from those facts.

## Local baseline

| Check | Current evidence |
|---|---|
| Codex CLI | Local: codex-cli 0.150.0-alpha.8 |
| Feature flags | Local: hooks is stable and true; plugins is stable and true |
| Plugin command | Local: codex plugin supports add, list, marketplace, and remove |
| App Server command | Local: codex app-server is present and exposes stdio, Unix socket, and WebSocket transports |
| MCP command | Local: codex mcp supports list, get, add, remove, login, and logout |
| Plugin scaffold | Local: plugin-creator validation supports manifests, Skills, Hooks, scripts, and optional MCP structure in an isolated scratch directory. |
| Plugin validation | Local: validate_plugin.py passed the isolated scaffold |
| Catalog collision | Local: no execution-fidelity-guard name was found in configured available plugin catalogs |

The source plugin has not been installed, enabled, trusted, or added to any marketplace.

## Lifecycle capability matrix

| Event or surface | Current host behavior | MVP use | Limitation |
|---|---|---|---|
| SessionStart | Official: source is startup, resume, clear, or compact. Command output can add developer context. A compact source runs before the immediate post-compaction model continuation. | Restore only contract reference, contract version, phase, open commitments, and evidence references. | A plugin hook is skipped until its exact definition is trusted. |
| PostCompact | Official: receives manual or auto trigger and supports common output fields. It has no event-specific additionalContext field. | Record that compaction occurred and reconcile local receipt state. | Do not claim PostCompact itself restores model context. SessionStart with source compact performs restoration. |
| UserPromptSubmit | Official: receives the pending prompt, can add developer context, and can block. | Classify the latest message as replace, supplement, correction, preference, question, or status request. Default behavior is non-blocking. | Classification is not allowed to replace the canonical user-intent contract by recency alone. |
| PreToolUse | Official: covers shell, unified exec, apply_patch, MCP calls, and most local function tools. It can deny, add model-visible context, or rewrite supported input. | Match explicit structured action, tool, and command-prefix rules. Weak semantic candidates produce model-only reminders. | There is no deterministic path-aware scope, primary-object, delivery-surface, or cost gate in 0.1.0. permissionDecision ask is currently unsupported. Hosted tools and opted-out specialized paths are not covered. |
| PermissionRequest | Official: runs only when Codex is already about to request approval. It can allow, deny, or abstain and leave the normal approval flow in place. | Deny only a deterministic contract conflict. Otherwise return no decision so native approval continues. | It cannot create an approval prompt for an action that would not otherwise require one. The plugin never auto-approves. |
| PostToolUse | Official: receives supported tool input and response, including non-zero shell results. A block can replace feedback and continue the model, but cannot undo side effects. | Record actual result, failure, evidence, and contradiction with an earlier expectation. | No rollback claim is allowed. Hosted and specialized unobserved paths remain blind. |
| Stop | Official: receives last_assistant_message and stop_hook_active. A block means continue the turn with a new continuation prompt. | Run only when the message contains a completion or final-delivery signal. Continue verification at most twice under normal sequential Host delivery, using persisted per-turn attempt count. | Concurrent Stop processes can race the counter. Stop is a turn-end signal, not proof that the user goal is complete. |
| SessionEnd | Official: advisory, synchronous, limited to three seconds, and unable to steer or keep a thread open. | Minimal cleanup and final local audit only. | It cannot enforce continued work. |

## Interaction levels

| Level | Implementable host behavior |
|---|---|
| Continue | Exit successfully with no model-visible output. |
| Remind | Return PreToolUse or prompt additional context visible to the model, not the user. |
| Ask | Deny the pending action with a concise reason that instructs the Agent to ask one user question. A pure plugin hook cannot open the native question UI. |
| Block | Return a deterministic deny at PreToolUse or PermissionRequest with the conflict and unlock path. |
| Continue verification | Return a Stop block reason; persist and cap the per-turn continuation count at two. |

## Coverage blind spots

1. Hosted WebSearch does not use the local function-tool hook path.
2. Specialized tools can opt out of default tool hooks.
3. write_stdin does not receive a second PreToolUse check for an already approved unified-exec session.
4. transcript_path is convenient but explicitly not a stable hook interface.
5. Plugin hooks do not run until the user reviews and trusts the current hook hash.
6. MCP tool-hook server errors, missing servers, and unavailable tools do not block the operation.
7. SessionStart can run before MCP is ready.
8. Hook failures must be reported as coverage failures; they do not replace Codex sandboxing or approval behavior.
9. PostToolUse feedback cannot reverse an external or irreversible side effect.
10. Stop observes a turn ending and the last assistant message, not a host-level goal-completion fact.

## Plugin packaging decision

Official plugin packaging supports .codex-plugin/plugin.json, skills, hooks/hooks.json, and optional MCP configuration. Official docs also permit a hooks manifest field. The current local plugin-creator validator rejects that manifest field, while default hook discovery at hooks/hooks.json is officially supported.

Decision: use the default hooks/hooks.json location and omit the manifest hooks field. This satisfies both current runtime discovery and the validated local ingestion schema.

## App Server decision

App Server exposes richer item lifecycle, authoritative item/completed state, turn/completed status, approval requests, experimental user-input requests, WebSearch items, plans, and diffs.

Decision: do not build an App Server client for the MVP. Local tool gates, result receipts, contract restoration, and Stop continuation provide a meaningful bounded plugin. Rebuilding the client only to close remaining event gaps would cross the frozen boundary into a second Harness. App Server remains a separately gated future proposal.

## Go or No-Go

GO for a bounded Codex Plugin MVP:

- It can intervene before observable local actions, after observable results, and before a turn with a completion claim ends.
- It can remain silent on low-cost reversible exploration.
- It can retain contract references and evidence receipts without owning intent or the Agent loop.

NO-GO for any claim of complete execution enforcement, native question UI, Hosted WebSearch interception, automatic rollback, or authoritative user-goal completion.

## Official sources

- [Package your plugin](https://developers.openai.com/plugins/build/plugins)
- [Codex Hooks](https://learn.chatgpt.com/docs/hooks)
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Agent approvals and security](https://learn.chatgpt.com/docs/agent-approvals-security)
- [Model Context Protocol](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
