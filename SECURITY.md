# Security policy

## Supported versions

Security fixes are applied to the latest tagged 0.2.x preview. Older previews may not receive patches.

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/rrrrrredy/execution-fidelity-guard/security/advisories/new) for vulnerabilities, secret exposure, bypasses of explicit deterministic rules, unsafe state-path behavior, or receipt privacy failures.

Do not include credentials, private transcripts, or live exploit payloads in a public issue. General correctness bugs and false positives can use the public issue tracker.

## Security boundary

Execution Fidelity Guard is a defense-in-depth guardrail. It is not a sandbox, authorization service, malware scanner, or substitute for Codex native approvals. A runtime failure deliberately fails open and reports a coverage gap.

Reports are most useful when they include the affected version, operating system, Hook event shape with sensitive content removed, expected decision, actual decision, and a minimal reproduction.
