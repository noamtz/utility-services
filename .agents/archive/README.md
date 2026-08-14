# Migration archive

These files preserve the pre-migration Claude agent definitions, settings, MCP JSON, and duplicate command prompts. Codex does not scan this directory; the active equivalents are:

- instructions: `AGENTS.md`
- skills: `.agents/skills/`
- custom agents: `.codex/agents/*.toml`
- hooks and MCP: `.codex/hooks.json` and `.codex/config.toml`
- Archon workflows: `.archon/workflows/`

Do not edit the archive as active configuration. Remove it only after the new Codex layer has been used successfully and the history is safely preserved in version control.
