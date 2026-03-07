"""Ollama service for interacting with Ollama API"""
import asyncio
import httpx
from typing import AsyncGenerator, Optional, Union
import json
import time
from app.config import get_settings

settings = get_settings()


class OllamaService:
    """Service for interacting with Ollama API"""
    
    def __init__(self):
        self.base_url = settings.ollama_host
        # Longer timeout for model downloads (30 minutes)
        self.client = httpx.AsyncClient(base_url=self.base_url, timeout=1800.0)
        # Separate client for quick operations
        self.quick_client = httpx.AsyncClient(base_url=self.base_url, timeout=30.0)
        # Cache expensive /api/show responses (includes tensors metadata).
        self._model_info_cache: dict[str, tuple[float, dict]] = {}
        self._model_info_cache_ttl_seconds = 300

    @staticmethod
    def _normalize_model_name(model_name: str) -> str:
        return (model_name or "").strip()

    @staticmethod
    def _base_model_name(model_name: str) -> str:
        normalized = (model_name or "").strip().lower()
        return normalized.split(":", 1)[0] if normalized else ""

    @staticmethod
    def _dedupe_preserve_order(items: list[str]) -> list[str]:
        deduped: list[str] = []
        seen: set[str] = set()
        for item in items:
            normalized = (item or "").strip()
            if not normalized:
                continue
            key = normalized.lower()
            if key in seen:
                continue
            seen.add(key)
            deduped.append(normalized)
        return deduped
    
    async def list_models(self) -> list[dict]:
        """List all available models from Ollama"""
        try:
            response = await self.quick_client.get("/api/tags")
            response.raise_for_status()
            data = response.json()
            return data.get("models", [])
        except Exception as e:
            raise Exception(f"Failed to list models: {str(e)}")
    
    async def get_model_info(self, model_name: str) -> dict:
        """Get detailed information about a model"""
        normalized_name = (model_name or "").strip()
        if not normalized_name:
            raise Exception("Model name is required")

        now = time.time()
        cached = self._model_info_cache.get(normalized_name)
        if cached and (now - cached[0]) < self._model_info_cache_ttl_seconds:
            return cached[1]

        try:
            # Official docs use {"model": "..."} for /api/show.
            response = await self.quick_client.post("/api/show", json={"model": normalized_name})
            if response.status_code >= 400:
                # Backward-compatibility for older Ollama variants expecting {"name": "..."}.
                response = await self.quick_client.post("/api/show", json={"name": normalized_name})
            response.raise_for_status()
            data = response.json()
            self._model_info_cache[normalized_name] = (now, data)
            return data
        except Exception as e:
            raise Exception(f"Failed to get model info: {str(e)}")

    @staticmethod
    def parse_capabilities(model_info: Optional[dict]) -> set[str]:
        """Extract normalized capability names from /api/show response."""
        if not isinstance(model_info, dict):
            return set()
        caps = model_info.get("capabilities")
        if not isinstance(caps, list):
            return set()
        normalized: set[str] = set()
        for cap in caps:
            if cap is None:
                continue
            normalized.add(str(cap).strip().lower())
        return normalized

    async def get_model_capabilities(
        self,
        model_name: str,
        refresh: bool = False,
    ) -> set[str]:
        """Return capabilities declared by Ollama for the model via /api/show."""
        normalized_name = (model_name or "").strip()
        if not normalized_name:
            return set()

        if refresh:
            self._model_info_cache.pop(normalized_name, None)

        try:
            info = await self.get_model_info(normalized_name)
            return self.parse_capabilities(info)
        except Exception:
            return set()

    async def supports_thinking(
        self,
        model_name: str,
        refresh: bool = False,
    ) -> Optional[bool]:
        """
        Determine thinking support from official /api/show capabilities.
        Returns:
          - True/False when capabilities are available
          - None when model info/capabilities are unavailable
        """
        normalized_name = (model_name or "").strip()
        if not normalized_name:
            return None

        if refresh:
            self._model_info_cache.pop(normalized_name, None)

        try:
            info = await self.get_model_info(normalized_name)
        except Exception:
            return None

        caps = self.parse_capabilities(info)
        if not caps:
            return None
        return "thinking" in caps

    async def list_running_models(self) -> list[dict]:
        """List currently loaded/running models in Ollama memory"""
        try:
            response = await self.quick_client.get("/api/ps")
            response.raise_for_status()
            data = response.json()
            return data.get("models", [])
        except Exception as e:
            raise Exception(f"Failed to list running models: {str(e)}")

    async def _resolve_unload_targets(self, model_name: str) -> list[str]:
        """
        Resolve unload targets from running models.
        This handles base-name unload requests when Ollama keeps a tagged variant in memory.
        """
        normalized = self._normalize_model_name(model_name)
        if not normalized:
            return []

        base = self._base_model_name(normalized)
        targets: list[str] = []

        try:
            running = await self.list_running_models()
        except Exception:
            running = []

        for item in running:
            candidate = self._normalize_model_name(
                str(item.get("name") or item.get("model") or "")
            )
            if not candidate:
                continue
            candidate_lc = candidate.lower()
            if candidate_lc == normalized.lower() or self._base_model_name(candidate) == base:
                targets.append(candidate)

        # No running match: still try explicit candidate to keep API behavior predictable.
        if not targets:
            targets.append(normalized)
            if ":" not in normalized:
                targets.append(f"{normalized}:latest")

        return self._dedupe_preserve_order(targets)

    async def _unload_single_model(self, model_name: str) -> None:
        response = await self.quick_client.post(
            "/api/generate",
            json={"model": model_name, "prompt": "", "keep_alive": 0},
        )
        response.raise_for_status()

    async def _wait_until_unloaded(
        self,
        targets: list[str],
        timeout_seconds: float = 6.0,
        poll_interval_seconds: float = 0.25,
    ) -> bool:
        if not targets:
            return True

        target_norm = {self._normalize_model_name(item).lower() for item in targets if item}
        target_base = {self._base_model_name(item) for item in targets if item}
        deadline = time.time() + timeout_seconds

        while time.time() < deadline:
            try:
                running = await self.list_running_models()
            except Exception:
                await asyncio.sleep(poll_interval_seconds)
                continue

            still_running = False
            for item in running:
                running_name = self._normalize_model_name(
                    str(item.get("name") or item.get("model") or "")
                )
                if not running_name:
                    continue
                running_norm = running_name.lower()
                running_base = self._base_model_name(running_name)
                if running_norm in target_norm or running_base in target_base:
                    still_running = True
                    break

            if not still_running:
                return True

            await asyncio.sleep(poll_interval_seconds)

        return False

    async def _delete_single_model(self, model_name: str) -> None:
        """
        Prefer the documented `model` key; fall back to `name` for backward compatibility.
        """
        response = await self.quick_client.request("DELETE", "/api/delete", json={"model": model_name})
        if response.status_code == 400:
            response = await self.quick_client.request("DELETE", "/api/delete", json={"name": model_name})
        response.raise_for_status()
    
    async def pull_model(self, model_name: str) -> AsyncGenerator[dict, None]:
        """Pull/download a model from Ollama"""
        try:
            async with self.client.stream(
                "POST", 
                "/api/pull", 
                json={"name": model_name, "stream": True}
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line.strip():
                        try:
                            data = json.loads(line)
                            yield data
                        except json.JSONDecodeError:
                            continue
        except Exception as e:
            yield {"error": str(e)}
    
    async def delete_model(self, model_name: str) -> bool:
        """Delete a model from Ollama"""
        normalized = self._normalize_model_name(model_name)
        if not normalized:
            raise Exception("Model name is required")

        # Best effort: unload matching running variants first to avoid "in use" failures.
        unload_targets = await self._resolve_unload_targets(normalized)
        for target in unload_targets:
            try:
                await self._unload_single_model(target)
            except Exception:
                continue

        # Give Ollama a short window to apply keep_alive=0 before delete.
        await self._wait_until_unloaded(unload_targets)

        delete_candidates: list[str] = [normalized]
        if ":" not in normalized:
            delete_candidates.append(f"{normalized}:latest")
        delete_candidates = self._dedupe_preserve_order(delete_candidates)

        errors: list[str] = []
        deleted = False
        for candidate in delete_candidates:
            for attempt in range(3):
                try:
                    await self._delete_single_model(candidate)
                    deleted = True
                    break
                except httpx.HTTPStatusError as e:
                    status = e.response.status_code if e.response is not None else None
                    detail = (e.response.text if e.response is not None else str(e)).lower()
                    if status == 404:
                        errors.append(f"{candidate}: not found")
                        break
                    # Ollama may still report model in use right after unload.
                    if status in {400, 409, 500} and ("in use" in detail or "loaded" in detail):
                        await asyncio.sleep(0.25 * (attempt + 1))
                        continue
                    errors.append(f"{candidate}: {str(e)}")
                    break
                except Exception as e:
                    errors.append(f"{candidate}: {str(e)}")
                    break
            if deleted:
                break

        if deleted:
            return True

        message = "; ".join(errors) if errors else "unknown error"
        raise Exception(f"Failed to delete model: {message}")

    async def unload_model(self, model_name: str) -> bool:
        """
        Unload model(s) from memory by setting keep_alive=0.
        Resolves running variants to avoid base/tag mismatch issues.
        """
        normalized = self._normalize_model_name(model_name)
        if not normalized:
            raise Exception("Model name is required")

        targets = await self._resolve_unload_targets(normalized)
        errors: list[str] = []
        unloaded = False

        for target in targets:
            try:
                await self._unload_single_model(target)
                unloaded = True
            except httpx.HTTPStatusError as e:
                status = e.response.status_code if e.response is not None else None
                # Keep trying other candidates if one target isn't found.
                if status == 404:
                    errors.append(f"{target}: not found")
                    continue
                errors.append(f"{target}: {str(e)}")
            except Exception as e:
                errors.append(f"{target}: {str(e)}")

        if unloaded:
            if await self._wait_until_unloaded(targets):
                return True
            message = "; ".join(errors) if errors else "request accepted but model is still running"
            raise Exception(f"Failed to unload model: {message}")

        if await self._wait_until_unloaded(targets):
            return True

        message = "; ".join(errors) if errors else "unknown error"
        raise Exception(f"Failed to unload model: {message}")

    async def load_model(self, model_name: str, keep_alive: Optional[Union[int, str]] = -1) -> bool:
        """
        Preload a model into memory.
        Uses /api/generate with an empty prompt and configurable keep_alive.
        """
        payload: dict = {"model": model_name, "prompt": ""}
        if keep_alive is not None:
            payload["keep_alive"] = keep_alive
        try:
            response = await self.quick_client.post("/api/generate", json=payload)
            response.raise_for_status()
            return True
        except Exception as e:
            raise Exception(f"Failed to load model: {str(e)}")

    async def embed(self, model: str, text: str) -> list[float] | list[list[float]]:
        """Generate embeddings for a text input."""
        try:
            # Preferred endpoint in recent Ollama versions
            response = await self.quick_client.post(
                "/api/embed",
                json={"model": model, "input": text},
            )
            response.raise_for_status()
            data = response.json()
            if "embeddings" in data:
                return data["embeddings"]
            if "embedding" in data:
                return data["embedding"]
            raise Exception("No embedding field in response")
        except Exception:
            # Fallback for older endpoint compatibility
            try:
                response = await self.quick_client.post(
                    "/api/embeddings",
                    json={"model": model, "prompt": text},
                )
                response.raise_for_status()
                data = response.json()
                if "embedding" in data:
                    return data["embedding"]
                raise Exception("No embedding field in fallback response")
            except Exception as e:
                raise Exception(f"Failed to embed text: {str(e)}")
    
    async def generate(
        self, 
        model: str, 
        prompt: str, 
        system: Optional[str] = None,
        options: Optional[dict] = None
    ) -> AsyncGenerator[dict, None]:
        """Generate text using a model"""
        payload = {
            "model": model,
            "prompt": prompt,
            "stream": True
        }
        if system:
            payload["system"] = system
        if options:
            payload["options"] = options
        
        try:
            async with self.client.stream("POST", "/api/generate", json=payload) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line.strip():
                        try:
                            data = json.loads(line)
                            yield data
                        except json.JSONDecodeError:
                            continue
        except Exception as e:
            yield {"error": str(e), "done": True}
    
    async def chat(
        self,
        model: str,
        messages: list[dict],
        options: Optional[dict] = None,
        think: Optional[Union[bool, str]] = None,
        keep_alive: Optional[Union[int, str]] = None,
        tools: Optional[list[dict]] = None,
        format: Optional[Union[str, dict]] = None,
    ) -> AsyncGenerator[dict, None]:
        """Chat with a model"""
        payload = {
            "model": model,
            "messages": messages,
            "stream": True
        }
        if options:
            payload["options"] = options
        if think is not None:
            payload["think"] = think
        if keep_alive is not None:
            payload["keep_alive"] = keep_alive
        if tools:
            payload["tools"] = tools
        if format is not None:
            payload["format"] = format
        
        try:
            async with self.client.stream("POST", "/api/chat", json=payload) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line.strip():
                        try:
                            data = json.loads(line)
                            yield data
                        except json.JSONDecodeError:
                            continue
        except Exception as e:
            yield {"error": str(e), "done": True}

    async def chat_once(
        self,
        model: str,
        messages: list[dict],
        options: Optional[dict] = None,
        think: Optional[Union[bool, str]] = None,
        keep_alive: Optional[Union[int, str]] = None,
        tools: Optional[list[dict]] = None,
        format: Optional[Union[str, dict]] = None,
    ) -> dict:
        """Non-streaming chat helper for single-shot tasks such as OCR extraction."""
        payload = {
            "model": model,
            "messages": messages,
            "stream": False,
        }
        if options:
            payload["options"] = options
        if think is not None:
            payload["think"] = think
        if keep_alive is not None:
            payload["keep_alive"] = keep_alive
        if tools:
            payload["tools"] = tools
        if format is not None:
            payload["format"] = format

        try:
            response = await self.client.post("/api/chat", json=payload)
            response.raise_for_status()
            data = response.json()
            if isinstance(data, dict):
                return data
            raise Exception("Invalid response from Ollama /api/chat")
        except Exception as e:
            raise Exception(f"Failed to chat once: {str(e)}")
    
    async def get_version(self) -> dict:
        """Get Ollama version"""
        try:
            response = await self.quick_client.get("/api/version")
            response.raise_for_status()
            return response.json()
        except Exception as e:
            raise Exception(f"Failed to get version: {str(e)}")


# Singleton instance
ollama_service = OllamaService()
