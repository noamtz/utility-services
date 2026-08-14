# Codex AI Layer Starter

This repository contains a project-scoped Codex setup: `AGENTS.md`, repo skills, custom agents, hooks, an MCP server, and optional Archon workflows.

## First run

1. Open the repository as a trusted project in Codex.
2. Restart Codex so it discovers `AGENTS.md`, `.agents/skills`, `.codex/config.toml`, and `.codex/agents`.
3. Open `/hooks`, review the two project hook definitions, and trust them if their scripts match your policy.
4. Run `codex mcp list` and confirm `codebase-search` is enabled. It requires `uv` and installs its script dependencies on first launch.
5. Run `python tooling/validate_codex_layer.py`.

To exercise the MCP server without starting a Codex session, run:

```powershell
uv run --script tooling/mcp/codebase_search.py --self-test
```

Skills are invoked with `$skill-name`, for example `$prime-codebase` or `$piv-plan-implementation`. Ask Codex directly to delegate when you want parallel subagents, for example: “Have `codebase-analyst` map billing and `research-agent` verify the provider API, then wait for both and summarize.”

The `posthog-analyst` agent requires a separately configured PostHog MCP server and credential environment. The repository intentionally does not commit that external credential configuration.

Archon workflows under `.archon/workflows` use the Codex provider. Validate them with `archon validate workflows` when Archon is installed.
