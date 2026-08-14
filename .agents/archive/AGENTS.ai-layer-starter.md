# Codex AI Layer Starter

## What this repository is

This repository is a reusable, project-scoped AI engineering layer for Codex. It packages durable instructions, skills, custom subagents, lifecycle hooks, MCP tooling, and optional Archon workflows that can be copied into an application repository and then tailored to that application's real stack.

## Architecture map

```text
AGENTS.md                  # Always-on Codex project instructions and operating rules
.agents/skills/            # Repo-scoped Codex skills; each skill has a SKILL.md
.agents/references/        # Shared, on-demand engineering references
.agents/templates/         # Templates copied or adapted by skills
.agents/examples/          # Example artifacts; not loaded automatically
.codex/config.toml         # Project-scoped Codex agents and MCP configuration
.codex/agents/             # Project-scoped custom subagents in standalone TOML files
.codex/hooks.json          # Lifecycle hook registration
.codex/hooks/              # Trusted hook implementations
.archon/workflows/         # Optional Codex-backed Archon workflow DAGs
tooling/mcp/               # Local MCP servers exposed through .codex/config.toml
tooling/validate_codex_layer.py # Deterministic structural validation for this layer
```

Files under `.agents/archive/` are migration source material only. Codex does not load them.

## Ground rules

- Treat `AGENTS.md` as the single source of truth for project instructions. Add nested `AGENTS.md` or `AGENTS.override.md` files only when a subtree genuinely needs more specific guidance.
- Put reusable workflows in `.agents/skills/<name>/SKILL.md`. Skill folders and frontmatter names must match and use lowercase hyphen-case.
- Skill frontmatter contains only `name` and `description`. Put UI metadata or tool dependencies in `agents/openai.yaml` when needed.
- Invoke a skill explicitly with `$skill-name`. Do not use legacy slash-command invocations or command-prompt argument placeholders inside skills; read inputs from the user's request.
- Define project subagents as `.codex/agents/*.toml` with `name`, `description`, and `developer_instructions`. Keep each agent narrow and use `sandbox_mode = "read-only"` unless its job truly requires edits.
- Keep secrets out of prompts, logs, committed config, and memory. Configure MCP credentials through environment variables or supported authentication, never static tokens.
- Keep `.codex/config.toml`, `.codex/hooks.json`, and the files they reference consistent. Project hooks must be reviewed and trusted in Codex before they can run.
- Prefer `rg` and `rg --files` for codebase discovery. Reuse the `codebase-search` MCP server for structural Python/TypeScript questions when it is available.
- Preserve unrelated user changes. Do not make destructive, external, or scope-expanding changes without clear authorization.

## Subagent routing

Delegate only when the work divides into independent, useful lanes or when the user requests parallel agents. Prefer these custom agents:

- `codebase-analyst`: deep, read-only mapping of one subsystem before planning or changes.
- `research-agent`: focused code or official-documentation research that returns cited evidence.
- `code-reviewer`: findings-first review for correctness, security, regressions, and missing tests.
- `system-reviewer`: compare an execution report with its plan and improve the AI process.
- `posthog-analyst`: read-only product analytics when the PostHog MCP server is configured.
- `meta-agent`: create or retune project-scoped Codex custom-agent TOML files.

When delegating, give each agent a bounded task, specify whether it may edit, wait for all required results, and synthesize the outcome in the main thread.

## Working principles

- For review, diagnosis, explanation, or planning requests, inspect and report without implementing unless the user also asks for changes.
- For build, change, fix, finish, or migration requests, make the in-scope local changes and run proportionate non-destructive validation.
- Make reasonable, reversible assumptions when they preserve intent. Surface assumptions that materially affect scope, architecture, security, cost, or external systems.
- Keep plans and skills lean: state each rule once, move detailed references out of always-loaded context, and validate against real repository behavior.
- Lead reviews with concrete findings and file references. Avoid style-only findings unless they hide a real defect.

## Validation

After changing the AI layer, run:

```powershell
python tooling/validate_codex_layer.py
uv run --script tooling/mcp/codebase_search.py --self-test
```

When the optional tools are installed, also run:

```powershell
codex mcp list
archon validate workflows
```

Restart Codex after changing project instructions, configuration, agents, or trusted hooks so the new session rebuilds its configuration chain.
