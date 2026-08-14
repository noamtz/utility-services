# Create a Codex skill

## 1. Define the job

Capture concrete examples of requests that should trigger the skill, adjacent requests that should not, required inputs, expected output, and cases where Codex must ask or stop.

Decide whether the reusable value is:

- procedural instructions in `SKILL.md`;
- on-demand knowledge in `references/`;
- deterministic processing in `scripts/`; or
- output material in `assets/`.

## 2. Scaffold

Create `.agents/skills/<name>/SKILL.md`. Use lowercase hyphen-case and match the folder to the frontmatter name.

Start from `templates/SKILL.template.md`. Do not create resource folders until the workflow needs them.

## 3. Write metadata

The description must say what the skill does, when Codex should use it, and important boundaries. Use literal trigger language from the examples. Keep only `name` and `description` in frontmatter.

## 4. Write the workflow

Use imperative steps. State:

1. What context to read first.
2. How to resolve or validate inputs from the user's request.
3. The core sequence and decision points.
4. Which facts must not be guessed.
5. Which actions require confirmation.
6. What artifact or response to return.
7. How to validate completion.

Use `$skill-name` only when referring to explicit invocation or chaining another skill. Do not use argument placeholders from legacy custom commands.

## 5. Add resources deliberately

Move long examples, variant-specific instructions, and external schemas into directly linked `references/`. Add a script only for repeated or fragile deterministic work and test it. Put copied output templates in `assets/`.

Add `agents/openai.yaml` only when UI metadata, implicit-invocation policy, or tool dependencies are useful.

## 6. Convert a legacy prompt

Preserve the proven procedure, but convert mechanics:

- prompt directory → `.agents/skills/<name>/`;
- slash-command invocation → `$skill-name`;
- argument placeholders → inputs described in the current user request;
- tool/model/frontmatter controls → supported Codex configuration or ordinary instructions;
- provider-specific agent spawning → bounded Codex delegation instructions;
- settings and hooks → `.codex/config.toml` or `.codex/hooks.json`.

Remove the old active prompt after preserving it in version control or a clearly non-loaded archive.

## 7. Validate

Follow `validation.md`. Test at least one positive trigger, one indirect trigger, one negative trigger, an incomplete input, and a realistic edge case.
