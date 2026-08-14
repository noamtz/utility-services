---
name: rules-check-drift
description: Compare the active AGENTS.md instruction chain with the current repository and recent changes. Use before a merge, during code review, after structural changes, or when Codex guidance may contain stale paths, commands, architecture, or conventions.
---

# Check AGENTS.md drift

Audit the applicable root and nested `AGENTS.md` / `AGENTS.override.md` files against the repository. This is advisory unless the user explicitly asks to apply fixes.

## Scope

Use a diff range supplied in the user's request. Otherwise inspect uncommitted and staged changes with `git diff HEAD`; if the tree is clean, compare the current branch with its merge base against the default branch.

Ignore archived migration material. Review skills or custom agents only when an instruction file points to them or the changed files affect their documented routing.

## Checks

1. **Architecture map:** every path exists, descriptions still match ownership, and new important boundaries are not missing.
2. **Commands:** install, run, test, lint, typecheck, and validation commands still exist and match CI or manifests.
3. **Conventions:** rules remain true in representative changed code and do not conflict with closer nested instructions.
4. **Working principles:** authorization and validation rules are internally consistent and not duplicated.
5. **Codex surfaces:** skill paths use `.agents/skills`, agents use `.codex/agents/*.toml`, configuration uses `.codex/config.toml`, hooks use `.codex/hooks.json`, and explicit skills use `$skill-name`.
6. **Instruction budget:** remove generic or redundant text that dilutes project-specific rules.

## Output

For each material issue, report:

```text
Severity: stale | false | missing | redundant
Instruction: <quoted or summarized rule>
Evidence: <file:line or command result>
Minimal change: <smallest truthful edit>
```

If no drift exists, say so and list what was verified. Apply or commit edits only when the user asks.
