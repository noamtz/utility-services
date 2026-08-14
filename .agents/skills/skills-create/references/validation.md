# Validate a Codex skill

## Structure

- Folder name matches frontmatter `name` and uses lowercase hyphen-case.
- `SKILL.md` exists and frontmatter contains only `name` and `description`.
- Every linked resource exists and is directly reachable from `SKILL.md`.
- No unused README, guide, template, script, or placeholder file remains.

## Trigger matrix

Test or reason through:

1. A direct request that should trigger.
2. An indirect request expressing the same goal.
3. An incomplete request that should cause a focused question.
4. A nearby request that should not trigger.
5. A realistic edge case or safety boundary.

Refine `description` when selection is wrong; refine the body when execution is wrong.

## Workflow

- Inputs come from the user's request and are resolved before use.
- Commands and file paths exist in the target project.
- The body states what not to infer, when to ask, and what to return.
- Detailed material uses progressive disclosure without deep reference chains.
- New or changed scripts run successfully on representative input.

## Codex compatibility

- Explicit invocation uses `$skill-name`.
- No legacy agent directory, instruction filename, settings path, tool allowlist, model field, or argument-substitution syntax remains.
- Custom-agent, MCP, and hook behavior is routed to the appropriate `.codex` surface.

## Repository validation

Run `python tooling/validate_codex_layer.py` when the repository provides it. If the built-in skill-creator validator is available, run its `quick_validate.py` against the changed skill folder as an additional structural check.

Report the cases checked, not only a generic “validated” claim.
