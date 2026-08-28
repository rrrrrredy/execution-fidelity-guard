# Contributing

Contributions are welcome under Apache-2.0.

## Development setup

Node.js 20 or later is the only runtime requirement. Do not add a dependency when a Node built-in provides the needed behavior.

    git clone https://github.com/rrrrrredy/execution-fidelity-guard.git
    cd execution-fidelity-guard
    node --test
    node scripts/sync-package-assets.mjs --check
    node plugins/execution-fidelity-guard/bin/efg.mjs doctor

## Change requirements

- Preserve the provider-owned intent source of truth.
- Add positive, negative, and real failure-regression tests for deterministic hard blocks.
- Keep semantic judgments advisory.
- Never return an allow decision from `PermissionRequest`.
- Keep stored events content-free; test that prompts, commands, responses, and secrets are absent.
- Preserve the two-attempt Stop continuation cap.
- Update schemas and public documentation when a wire contract changes.
- Do not add private transcripts or `evals/private` artifacts to Git.

Run the Codex plugin and Skill validators when available. A green unit suite proves implementation behavior, not product efficacy; keep outcome claims tied to replay or hands-on evidence.

Open a focused pull request with the problem, behavior change, tests, and any remaining coverage gap.
