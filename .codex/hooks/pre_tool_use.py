#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.9"
# ///
"""Codex PreToolUse guardrail for obvious secret access and destructive deletes.

Codex sends one JSON event on stdin. Exit code 2 blocks the tool and returns the
stderr reason to the agent. Unexpected hook failures deliberately fail open so a
broken local policy cannot brick the session.
"""

from __future__ import annotations

import json
import re
import sys
from typing import Any


ENV_TEMPLATE_SUFFIXES = (".env.example", ".env.sample", ".env.template")

SECRET_PATH = re.compile(
    r"(?<![\w.-])\.env(?:\.[A-Za-z0-9_-]+)?(?![\w.-])|"
    r"\.pem(?![\w.-])|\.key(?![\w.-])|"
    r"(?:^|[/\\\s])id_(?:rsa|ed25519)(?![\w.-])|[/\\]\.ssh[/\\]|"
    r"[/\\]\.aws[/\\]credentials(?![\w.-])|[/\\]\.netrc(?![\w.-])|"
    r"credentials\.json(?![\w.-])",
    re.IGNORECASE,
)

ENV_DUMP = (
    re.compile(r"\bprintenv\b", re.IGNORECASE),
    re.compile(r"(?:^|[;&|]\s*)env\s*(?:[|>]|$)", re.IGNORECASE),
    re.compile(
        r"\becho\b.*\$\{?[A-Z_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)",
        re.IGNORECASE,
    ),
    re.compile(r"os\.environ|process\.env|ENV\[", re.IGNORECASE),
    re.compile(r"Get-ChildItem\s+(?:Env:|environment)", re.IGNORECASE),
    re.compile(r"\b(?:dir|ls|gci)\s+Env:", re.IGNORECASE),
)

RECURSIVE_FORCE_DELETE = (
    re.compile(r"\brm\b[^\r\n]*(?:-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)", re.IGNORECASE),
    re.compile(r"\brm\b[^\r\n]*(?:--recursive[^\r\n]*--force|--force[^\r\n]*--recursive)", re.IGNORECASE),
    re.compile(
        r"\bRemove-Item\b[^\r\n]*(?:-Recurse[^\r\n]*-Force|-Force[^\r\n]*-Recurse)",
        re.IGNORECASE,
    ),
)

BLOCKED_SECRET_MESSAGE = (
    "BLOCKED: access to likely secret material is not allowed. "
    "Use a committed .env.example/.sample/.template file or ask the user for a safe input."
)
BLOCKED_DELETE_MESSAGE = (
    "BLOCKED: recursive force deletion is disabled by the project hook. "
    "Resolve and verify a narrow target, then use a recoverable or explicitly approved operation."
)


def _command_text(tool_input: Any) -> str:
    if not isinstance(tool_input, dict):
        return ""
    command = tool_input.get("command", "")
    return command if isinstance(command, str) else ""


def _is_safe_template(text: str) -> bool:
    normalized = text.replace("\\", "/").lower()
    return any(suffix in normalized for suffix in ENV_TEMPLATE_SUFFIXES)


def is_secret_access(tool_name: str, tool_input: Any) -> bool:
    """Detect obvious secret paths and environment-dump commands."""
    text = _command_text(tool_input).replace("\\", "/")
    if not text:
        return False

    if tool_name == "Bash" and any(pattern.search(text) for pattern in ENV_DUMP):
        return True

    matches = [match.group(0) for match in SECRET_PATH.finditer(text)]
    return any(not _is_safe_template(match) for match in matches)


def is_recursive_force_delete(tool_name: str, tool_input: Any) -> bool:
    if tool_name != "Bash":
        return False
    command = _command_text(tool_input)
    return any(pattern.search(command) for pattern in RECURSIVE_FORCE_DELETE)


def main() -> None:
    try:
        event = json.load(sys.stdin)
        tool_name = event.get("tool_name", "")
        tool_input = event.get("tool_input", {})

        if is_secret_access(tool_name, tool_input):
            print(BLOCKED_SECRET_MESSAGE, file=sys.stderr)
            raise SystemExit(2)

        if is_recursive_force_delete(tool_name, tool_input):
            print(BLOCKED_DELETE_MESSAGE, file=sys.stderr)
            raise SystemExit(2)
    except SystemExit:
        raise
    except Exception:
        raise SystemExit(0)


if __name__ == "__main__":
    main()
