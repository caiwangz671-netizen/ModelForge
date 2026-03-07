"""Backend entry point for packaged desktop app."""
from __future__ import annotations

import os

import uvicorn


def _to_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    lowered = value.strip().lower()
    if lowered in {"1", "true", "yes", "on"}:
        return True
    if lowered in {"0", "false", "no", "off"}:
        return False
    return default


def main() -> None:
    host = os.getenv("BACKEND_HOST", "127.0.0.1")
    port = int(os.getenv("BACKEND_PORT", "18000"))
    log_level = os.getenv("BACKEND_LOG_LEVEL", "info")
    reload_enabled = _to_bool(os.getenv("BACKEND_RELOAD"), False)

    uvicorn.run(
        "app.main:app",
        host=host,
        port=port,
        reload=reload_enabled,
        log_level=log_level,
        workers=1,
    )


if __name__ == "__main__":
    main()
