# Action rule reference

Hard decisions require an explicit structured rule. Matching is case-insensitive.

## Rule forms

- `action:<tag>` matches a normalized action tag.
- `tool:<name>` matches the exact canonical Hook tool name.
- `command-prefix:<text>` matches the literal beginning of a Bash command after whitespace trimming.

Supported action tags:

- `read`
- `write` or `write_workspace`
- `delete`
- `destructive`
- `install_local`
- `network`
- `publish`
- `external` or `external_side_effect`
- `unknown`

## Precedence

Rules are evaluated in this order:

1. `authorization.forbidden`
2. `must_and_must_not.must_not`
3. `authorization.requires_user`
4. `authorization.allowed`

A forbidden or must-not match wins over an allow match. `requires_user`
denies the pending action and asks the Agent to obtain one explicit user
answer. Guard does not consume approval from chat and does not own
authorization state. After approval, Intent Loop must publish a higher
`contract_version` that moves the exact bounded rule to `allowed`; for a
TaskContractLite fallback, the user or Agent edits the reviewed fallback so its
content-derived reference changes. Retrying the unchanged contract asks again.
An allow rule never auto-approves a native Codex permission request.
`authorization.allowed` is a positive match list, not a closed allowlist.
Actions absent from it continue unless a matching `forbidden`, `must_not`, or
`requires_user` rule applies. A high-risk action still receives a semantic
reminder when an unstructured constraint is present; an allow match does not
silence that reminder.

In `shadow` mode, a pending-tool would-block or would-ask result becomes a
non-blocking reminder. A missing-evidence Stop is recorded silently and does
not continue or block the turn. Only `balanced` enforces structured action
rules and requests bounded completion verification.

## Local install classification

The classifier recognizes listed direct install, add, dependency-changing
update, upgrade, audit-fix, rebuild, sync, and execution verbs for common
package managers and environment provisioners, including:

- pip, `python -m pip`, uv, pipx, poetry, pipenv;
- npm, npx, pnpm, yarn, bun, bunx;
- cargo, go, gem, bundle, dotnet tool;
- conda, mamba, winget, choco, scoop, brew, apt, dnf, and yum;
- PowerShell `Install-Package` and `Install-Module`.

Searches such as `rg "pip install"` and normal commands such as `node --test` do not match install_local.

The parser splits unquoted shell segments and inspects the leading executable
plus the documented direct verb forms. This list is not a claim of complete
package-manager grammar. It is not a complete PowerShell, cmd.exe, or POSIX
shell interpreter. Commands hidden behind arbitrary scripts, aliases, eval,
encoded payloads, unsupported manager verbs, or unsupported wrappers may not
be recognized.

Version 0.2.2 injects objective, primary-object, delivery-surface, scope, and
must fields as bounded Agent context, but it does not derive path-aware gates
from them. Cost is not a TaskContractLite field in 0.2.2. Hard decisions use
the structured rule forms above.

## Natural-language constraints

A sentence such as "do not install locally" remains a semantic reminder. To enforce the same already-explicit boundary, use:

    "authorization": {
      "forbidden": ["action:install_local"]
    }

Do not translate ambiguous natural language into a structured rule without confirming the intended authorization boundary.
`contract validate` rejects a reserved structured prefix with an unsupported
action tag, such as `action:install-local`; use the documented underscore form.
