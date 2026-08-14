# Codex skill standards

## Contents

- Anatomy
- Frontmatter
- Trigger design
- Body design
- Resources
- Codex mechanics
- Quality checks

## Anatomy

```text
.agents/skills/<skill-name>/
├── SKILL.md              # required
├── agents/openai.yaml    # optional UI and dependency metadata
├── references/           # optional on-demand documentation
├── scripts/              # optional deterministic helpers
└── assets/               # optional output materials
```

Do not add auxiliary READMEs, changelogs, installation guides, or quick-reference files that the workflow does not need.

## Frontmatter

Use exactly two YAML keys:

```yaml
---
name: verb-led-skill-name
description: What the skill does and the concrete requests or contexts that should trigger it. Include important boundaries that prevent false positives.
---
```

- `name` uses lowercase letters, digits, and hyphens, is at most 64 characters, and matches the folder.
- `description` is the primary trigger surface. Front-load the job and literal user language. Include when to use the skill and important “not for” boundaries.
- Do not put tool allowlists, model pins, invocation flags, argument declarations, or hooks in `SKILL.md` frontmatter. Codex reads only `name` and `description` for skill selection.

When UI metadata or tool dependencies improve discovery, add `agents/openai.yaml` with supported `interface`, `policy`, and `dependencies` fields. Keep it synchronized with `SKILL.md`.

## Trigger design

Write the description so it matches:

1. Direct requests: “create a release checklist skill.”
2. Indirect requests expressing the same goal.
3. Existing-skill change requests that name a skill but do not say “edit.”
4. Boundaries that exclude adjacent workflows.

Do not hide “when to use” guidance only in the body; Codex sees the body after triggering.

## Body design

- Use imperative language.
- Assume Codex already knows general software engineering; keep only non-obvious workflow and project knowledge.
- State inputs, ordered decisions, output contract, facts not to infer, and stop/ask conditions.
- Read inputs from the current user request. Explicit invocation uses `$skill-name`; Codex skills do not use legacy command-prompt argument substitution.
- Keep `SKILL.md` under roughly 500 lines. Split detailed variants or examples into directly linked references before it becomes difficult to scan.
- Avoid repeating `AGENTS.md` rules unless the skill needs a stricter task-specific constraint.

## Resources

- `references/`: policies, schemas, detailed examples, background, and variant-specific procedures that Codex should load only when needed.
- `scripts/`: repeated deterministic computation or fragile transformations. Run every new or changed script on representative input.
- `assets/`: templates, images, boilerplate, or files copied into outputs rather than read as instructions.

Link each resource directly from `SKILL.md` and explain the condition that requires it. Do not duplicate the same guidance in both the body and a reference.

## Codex mechanics

- Repo scope: `.agents/skills` from the working directory up to the repository root.
- User scope: `~/.agents/skills`.
- Explicit invocation: `$skill-name` in Codex CLI or IDE.
- Implicit invocation: match the skill description.
- Custom agents are separate TOML files under `.codex/agents`; do not encode an agent manifest in skill frontmatter.
- Project configuration, MCP servers, and hooks live under `.codex`, not inside skill frontmatter.
- A skill may instruct Codex to delegate, but should say when parallelism is useful and require bounded, independent assignments.

## Quality checks

- Folder, name, and references resolve.
- Frontmatter has only `name` and `description`.
- Positive and negative trigger examples are realistic.
- Commands exist in the target repository and do not assume a platform without saying so.
- The output contract is reviewable.
- Safety and external-action boundaries are explicit where needed.
- No stale provider-specific paths, tool names, or invocation syntax remain.
