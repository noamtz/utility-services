---
name: rules-create-global
description: Create or re-derive a lean project-root AGENTS.md for Codex from an architecture decision, PRD plus architecture, existing codebase, or codebase-analysis artifact. Use when initializing the AI layer, onboarding a repository, replacing generic instructions, or making project rules match the real system.
---

# Create project rules

Produce a truthful, project-specific `AGENTS.md`: codebase map, ground rules, commands, working principles, and optional subagent routing.

## Resolve the source

Read the user's request and classify the repository:

- **Greenfield:** use the architecture or technical specification as the source for technical rules. A PRD provides product context, not implementation conventions.
- **Brownfield:** derive facts from the repository and its existing instructions. If the repository is large, use a supplied codebase-analysis artifact or explicitly delegated read-only exploration.
- **Existing rules:** read and preserve valid, intentional rules. Make a recoverable copy before replacing material hand-written content.

If the source is insufficient to determine a material technical choice, ask for that choice instead of inventing it.

## Build the file

Use `.agents/templates/AGENTS.md.template` as the starting shape. Keep only content that earns always-on context:

1. A one-paragraph product and stack description.
2. An architecture map of important directories, integration points, and ownership boundaries.
3. Specific conventions the repository chose: types, structure, errors, data, security, testing, and Git workflow.
4. Working principles that define authorization, assumptions, scope, validation, and external/destructive boundaries.
5. The small set of commands Codex should actually run.
6. Custom-agent routing only when `.codex/agents/` defines useful project agents.
7. Links to on-demand `.agents/skills/` and `.agents/references/` material instead of copying procedures into the rules file.

Use nested `AGENTS.md` or `AGENTS.override.md` files only when a subtree needs rules that are genuinely more specific than the root.

## Quality bar

- State project choices, not slogans such as “write clean code.”
- Do not claim commands, paths, or architecture that were not verified.
- State each rule once and keep the file comfortably below Codex's project-instruction byte limit.
- Use `$skill-name` for explicit skill invocation.
- Do not add legacy instruction filenames, legacy agent directories, or argument-substitution syntax.
- If code review needs a hard repository rule, put it under `## Code Review Rules` close to the governed code.

## Validate

Check every mapped path and command against the repository. Run `python tooling/validate_codex_layer.py` when present, then summarize what changed, what evidence supports it, and which open choices still need the owner.
