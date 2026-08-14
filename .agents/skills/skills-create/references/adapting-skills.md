# Adapt an existing Codex skill

## Diagnose before editing

Locate and read the actual `SKILL.md` and every resource its workflow requires. Reproduce the problem from the user's example when safe.

Classify the failure:

- **Under-triggering or false triggering:** description problem.
- **Wrong workflow or output:** body instructions or missing reference.
- **Wrong commands or conventions:** project localization problem.
- **Missing deterministic behavior:** script or hook boundary problem.
- **Bloated context:** progressive-disclosure problem.
- **Provider mismatch:** stale paths, invocation, tool names, subagent format, hook schema, or configuration.

## Interview only for material gaps

Ask what success looks like, what currently happens, a concrete failing request, and any safety or output boundary that cannot be inferred. Skip questions already answered by the user or repository.

## Apply the smallest durable change

### Retarget triggering

Edit `description`. Put the job, literal trigger language, and important exclusions there. Do not rely on a “when to use” body section.

### Localize the workflow

Replace assumed commands, paths, frameworks, and validation with the repository's real equivalents. Read CI, manifests, and `AGENTS.md` rather than guessing.

### Change the output contract

State required sections and evidence, but allow judgment where multiple valid outputs exist. Use a template asset only when exact structure is a product requirement.

### Add safety or stopping behavior

Use instructions for judgment-based boundaries. Use a Codex hook when the user needs deterministic enforcement around a supported lifecycle event.

### Split and trim

Keep the common decision path in `SKILL.md`. Move long examples and variants to directly linked `references/`; repeated fragile transformations to tested `scripts/`; copied materials to `assets/`.

### Repair Codex compatibility

Use `.agents/skills`, `$skill-name`, name/description-only frontmatter, `.codex/agents/*.toml`, `.codex/config.toml`, and `.codex/hooks.json`. Read inputs from the user's request rather than command-prompt placeholders.

## Verify

Re-run the original failing case and the trigger matrix from `validation.md`. Check that the change solves the diagnosed failure without broadening the skill into adjacent jobs.
