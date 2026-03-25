"""Shared model-name helpers used across backend services."""
from __future__ import annotations


def normalize_model_name(name: str) -> str:
    """Lowercase and strip whitespace from a model name."""
    return (name or "").strip().lower()


def base_model_name(name: str) -> str:
    """Return the base name without any tag suffix (e.g. 'llama3' from 'llama3:8b')."""
    return normalize_model_name(name).split(":", 1)[0]
