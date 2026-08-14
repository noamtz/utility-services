---
name: hooks-create
description: Create or update a project-scoped Codex lifecycle hook from a plain-language policy or automation request. Use when the user asks to block a risky tool call, enforce a deterministic check, log tool activity, add a session/compaction/subagent hook, or modify .codex/hooks.json and its scripts.
---

# Create a Codex hook

Turn the behavior in the user's request into a working, reviewed project hook.

## Workflow

1. Read `AGENTS.md`, `.codex/config.toml`, `.codex/hooks.json`, and existing `.codex/hooks/` scripts.
2. Confirm the current Codex hook event, input, matcher, output, and trust behavior from official OpenAI documentation when the requested behavior depends on exact or current semantics.
3. Resolve only material ambiguity:
   - What exact event or action should trigger?
   - Is the hook observational, advisory, mutating, or blocking?
   - What paths, tools, patterns, exit conditions, and platforms are in scope?
4. Choose the narrowest event:
   - `PreToolUse`: inspect, deny, or rewrite supported local tool calls.
   - `PermissionRequest`: allow or deny a tool call that already requires approval.
   - `PostToolUse`: observe a completed local tool call.
   - `UserPromptSubmit`: add model-visible context after a prompt arrives.
   - `SessionStart` / `SessionEnd`: initialize or close a main session.
   - `SubagentStart` / `SubagentStop`: add context or inspect subagent lifecycle.
   - `PreCompact` / `PostCompact`: preserve or restore context around compaction.
   - `Stop`: validate before the main turn finishes.
5. Prefer a small Python script under `.codex/hooks/` for non-trivial logic. Read one JSON event from stdin, write only the documented response shape, avoid secrets, and fail open unless the user explicitly requires a hard gate.
6. Register the hook in `.codex/hooks.json`. Use a precise regex matcher when the event supports one. Add both `command` and `commandWindows` when the project is cross-platform.
7. Test the script directly with representative allow, deny, malformed-input, and platform-specific cases.
8. Parse `.codex/hooks.json`, run `python tooling/validate_codex_layer.py` when present, and report the manual trust step.

## Codex-specific rules

- Project hooks are loaded only for trusted projects and do not run until the user reviews and trusts their exact definition in `/hooks`.
- `PreToolUse` reports canonical tool names such as `Bash`, `apply_patch`, and MCP tool names. `apply_patch` can also match `Edit` or `Write`, but hook input still reports `tool_name: "apply_patch"`.
- For `Bash` and `apply_patch`, inspect `tool_input.command`.
- To deny in `PreToolUse`, prefer documented JSON with `permissionDecision: "deny"`; exit code `2` plus a concise stderr reason is also supported.
- Hooks are guardrails, not a complete security boundary. Preserve Codex sandboxing, approvals, repository trust, and normal review.
- Do not weaken an existing hook or broaden access merely to make a test pass.

## Deliverable

Return the files changed, event and matcher, behavior tested, limitations, and this required next step: restart Codex, open `/hooks`, review the new definition, and trust it if acceptable.
