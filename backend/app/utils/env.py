"""Helpers for updating persisted env-backed settings."""
from __future__ import annotations

from pathlib import Path
from typing import Optional


def upsert_env_value(env_path: Path, key: str, value: Optional[str]) -> None:
    lines: list[str] = []
    if env_path.exists():
        lines = env_path.read_text(encoding="utf-8").splitlines()

    target_prefix = f"{key}="
    replaced = False
    next_lines: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith(target_prefix):
            if value is not None:
                next_lines.append(f"{key}={value}")
            replaced = True
            continue
        next_lines.append(line)

    if value is not None and not replaced:
        next_lines.append(f"{key}={value}")

    env_path.parent.mkdir(parents=True, exist_ok=True)
    env_path.write_text("\n".join(next_lines) + "\n", encoding="utf-8")
