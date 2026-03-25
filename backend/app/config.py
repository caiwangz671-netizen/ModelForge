"""Application configuration"""
import os
from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _resolve_runtime_state_dir() -> Path:
    raw = os.getenv("MODELFORGE_STATE_DIR", "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    return PROJECT_ROOT


def _resolve_runtime_env_file() -> Path:
    raw = os.getenv("MODELFORGE_ENV_FILE", "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    return (_resolve_runtime_state_dir() / ".env").resolve()


RUNTIME_STATE_DIR = _resolve_runtime_state_dir()
RUNTIME_ENV_FILE = _resolve_runtime_env_file()


def resolve_runtime_state_dir() -> Path:
    return RUNTIME_STATE_DIR


def resolve_persisted_env_path() -> Path:
    return RUNTIME_ENV_FILE


class Settings(BaseSettings):
    """Application settings"""
    
    # Ollama settings
    ollama_host: str = "http://localhost:11434"
    
    # Database settings
    database_url: str = Field(default_factory=lambda: str((RUNTIME_STATE_DIR / "ollama_studio.db").resolve()))
    
    # API settings
    api_prefix: str = "/api"
    debug: bool = True
    memory_enabled: bool = True
    memory_embedding_model: Optional[str] = None
    max_output_tokens: int = 8192
    max_context_tokens: int = 8192
    auto_unload_after_response: bool = True
    inject_runtime_time: bool = True
    resident_models: Optional[str] = None
    
    # CORS settings
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    model_config = SettingsConfigDict(
        env_file=str(RUNTIME_ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    @field_validator("debug", mode="before")
    @classmethod
    def _parse_debug(cls, value):
        if isinstance(value, str):
            text = value.strip().lower()
            if text in {"release", "prod", "production"}:
                return False
            if text in {"debug", "dev", "development"}:
                return True
        return value

    @field_validator("max_output_tokens", mode="before")
    @classmethod
    def _parse_max_output_tokens(cls, value):
        if value is None:
            return 8192
        parsed = int(value)
        if parsed < 128:
            return 128
        if parsed > 262144:
            return 262144
        return parsed

    @field_validator("max_context_tokens", mode="before")
    @classmethod
    def _parse_max_context_tokens(cls, value):
        if value is None:
            return 8192
        parsed = int(value)
        if parsed < 512:
            return 512
        if parsed > 1048576:
            return 1048576
        return parsed

    @field_validator("auto_unload_after_response", "inject_runtime_time", mode="before")
    @classmethod
    def _parse_bool_setting(cls, value):
        if isinstance(value, str):
            text = value.strip().lower()
            if text in {"1", "true", "yes", "on"}:
                return True
            if text in {"0", "false", "no", "off"}:
                return False
        return bool(value)


@lru_cache()
def get_settings() -> Settings:
    return Settings()
