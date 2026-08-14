# Codex hooks

The project registers two hooks in `.codex/hooks.json`:

- `pre_tool_use.py` blocks obvious access to secret files or environment dumps and blocks recursive force-deletion commands in Bash/PowerShell.
- `post_tool_use.py` appends shell and edit events to the ignored `.codex/logs/tool-events.jsonl` file.

The registered commands use this project's absolute path, and the audit hook resolves
the log directory from its own script path. Both hooks therefore work even when Codex
starts the hook process outside the Git worktree. If the project is moved, update both
paths in `.codex/hooks.json` and trust the changed definitions again.

Codex does not automatically trust project command hooks. Start a new Codex session, open `/hooks`, review the exact definitions and scripts, and explicitly trust them before relying on the guardrail.

Test the pre-hook directly from PowerShell:

```powershell
'{"tool_name":"Bash","tool_input":{"command":"Get-Content .env"}}' |
  uv run --script .codex/hooks/pre_tool_use.py
$LASTEXITCODE # expected: 2
```

An ordinary command should exit `0`. Hook failures intentionally fail open; this is a focused guardrail, not a complete security boundary. Codex sandboxing, approval policy, repository trust, and normal code review still apply.
