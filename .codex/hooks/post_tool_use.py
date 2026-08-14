#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.9"
# ///
"""Append Codex shell/edit hook events to a local JSON Lines audit log."""

from __future__ import annotations

import json
import sys
from pathlib import Path


def repository_root() -> Path:
    """Resolve the project from this script, independent of hook process cwd."""
    return Path(__file__).resolve().parents[2]


def main() -> None:
    try:
        event = json.load(sys.stdin)
        repo_root = repository_root()
        log_dir = repo_root / ".codex" / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        log_path = log_dir / "tool-events.jsonl"
        with log_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, ensure_ascii=False, separators=(",", ":")))
            handle.write("\n")
    except Exception:
        pass


if __name__ == "__main__":
    main()
