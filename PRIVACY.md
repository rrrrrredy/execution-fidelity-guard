# Privacy

Execution Fidelity Guard is local-first and has no runtime telemetry or network client.

## Data stored

When persistence is enabled, the plugin stores per-session JSON records containing:

- contract reference and version;
- event type, time, and content hashes;
- normalized action labels;
- evidence kind, status, hash, and requirement reference;
- decision, authority, reason code, and latency.

The default location is `$CODEX_HOME/plugin-data/execution-fidelity-guard/v1`. Each event, receipt, and evidence record is written as a separate file. The oldest records are removed when a per-bucket session cap is exceeded. At SessionStart, inactive session directories older than the configured retention period are removed. The default is 30 days.

## Data not intentionally stored

The runtime does not intentionally persist:

- user prompts or assistant messages;
- full shell commands or tool arguments;
- tool response bodies;
- transcript content;
- hidden reasoning;
- passwords, tokens, API keys, or credentials.

Content is hashed before persistence. Model-visible contract context is length-limited and applies token and credential redaction.

## Controls

- Set `EFG_PERSIST=false` to disable runtime persistence.
- Set `EFG_STATE_DIR` to select a dedicated local state directory.
- Set `EFG_RETENTION_DAYS` to a value from 1 through 3650.
- Set `EFG_DELETE_ON_SESSION_END=true` to delete only the ending session's Guard-owned state after SessionEnd is recorded.
- Use `receipts show` or `receipts export` to inspect one session. Export refuses to overwrite an existing file.
- Use `receipts delete --session SESSION --yes` for an explicit, exact-session deletion.
- Remove the plugin through Codex to stop future Hook execution.
- Delete only the dedicated Execution Fidelity Guard state directory when you intentionally want to erase retained receipts.

Disabling this plugin does not change Codex's sandbox, approval policy, or other native controls.

## Limitations

No redaction system can prove arbitrary user-provided text is secret-free. Put identifiers rather than sensitive values in task contracts and evidence labels. A local user or process with access to the state directory can read its metadata.

For security reports, follow [SECURITY.md](SECURITY.md).
