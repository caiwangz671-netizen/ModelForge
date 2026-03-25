"""Runtime service for model residency and auto-unload behavior."""
from __future__ import annotations

from typing import List, Set

from app.config import get_settings
from app.utils.model_names import normalize_model_name as _normalize_model_name
from app.utils.model_names import base_model_name as _base_model_name


class ModelResidencyService:
    """Manage models that should stay resident in Ollama memory."""

    @staticmethod
    def _read_models_from_settings() -> Set[str]:
        settings = get_settings()
        raw = (settings.resident_models or "").strip()
        if not raw:
            return set()
        models: Set[str] = set()
        for token in raw.split(","):
            normalized = _normalize_model_name(token)
            if normalized:
                models.add(normalized)
        return models

    @staticmethod
    def _write_models_to_settings(models: Set[str]) -> None:
        settings = get_settings()
        settings.resident_models = ",".join(sorted(models))

    def list_resident_models(self) -> List[str]:
        return sorted(self._read_models_from_settings())

    def is_resident(self, model_name: str) -> bool:
        normalized = _normalize_model_name(model_name)
        if not normalized:
            return False
        base = _base_model_name(normalized)
        resident = self._read_models_from_settings()
        if normalized in resident:
            return True
        # Backward compatibility: an old untagged resident entry acts as a family-wide rule.
        return any(":" not in item and _base_model_name(item) == base for item in resident)

    def set_resident(self, model_name: str, resident: bool) -> List[str]:
        normalized = _normalize_model_name(model_name)
        if not normalized:
            return self.list_resident_models()

        models = self._read_models_from_settings()

        if resident:
            models.add(normalized)
        else:
            models.discard(normalized)

        self._write_models_to_settings(models)
        return sorted(models)

    @staticmethod
    def get_auto_unload_after_response() -> bool:
        return bool(get_settings().auto_unload_after_response)

    @staticmethod
    def set_auto_unload_after_response(enabled: bool) -> bool:
        settings = get_settings()
        settings.auto_unload_after_response = bool(enabled)
        return settings.auto_unload_after_response


model_residency_service = ModelResidencyService()
