---
name: skills-create
description: Create a new repo-scoped Codex skill or adapt an existing one. Use when the user asks to author, edit, retune, fix triggering, localize commands, trim, split, or validate a skill under .agents/skills, including explicit $skills-create requests.
---

# Create or adapt a Codex skill

Infer whether the user wants a new skill or a change to an existing one. Resolve the real target before editing; search repo-scoped `.agents/skills/` and user-scoped `~/.agents/skills/` when needed.

Read `references/skill-standards.md` before making structural or metadata changes. Then use:

- `references/creating-skills.md` for a new workflow or a legacy prompt conversion.
- `references/adapting-skills.md` for an existing skill whose behavior or triggering needs to change.
- `references/refactoring-skills.md` when the body is large enough to split into progressive-disclosure resources.
- `references/validation.md` before reporting completion.

## Shared workflow

1. Derive concrete positive triggers, negative triggers, expected inputs, output contract, and failure boundaries from the user's request.
2. Read applicable `AGENTS.md` instructions and inspect the real project commands, tools, and nearby skill conventions.
3. Keep the skill focused on one recognizable job. Split workflows that have different triggers, inputs, or success criteria.
4. Put only `name` and `description` in YAML frontmatter. Put detailed procedure in the body and optional UI/dependency metadata in `agents/openai.yaml`.
5. Use `.agents/skills/<name>/SKILL.md`; the folder and frontmatter name must match lowercase hyphen-case.
6. Write imperative instructions for another Codex instance. Read inputs from the user's request; do not use command-prompt argument substitution.
7. Put detailed policies and examples in `references/`, deterministic helpers in `scripts/`, and copied output materials in `assets/`. Link every bundled resource from `SKILL.md` and state when to use it.
8. Validate structure, triggering, resource wiring, command realism, and provider-specific mechanics.

## Interaction rule

Ask only when a missing answer materially changes the workflow, tool dependency, safety boundary, or output. Otherwise make a reversible assumption and state it.

## Deliverable

Return the files created or changed, trigger behavior, resources added, validation performed, and any dependency or restart requirement. Codex detects repo-skill changes automatically in current clients, but a new session is the reliable fallback if discovery appears stale.
