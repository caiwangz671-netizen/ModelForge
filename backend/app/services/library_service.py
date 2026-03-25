"""Service for fetching and parsing models from ollama.com/library."""
from __future__ import annotations

import asyncio
import html
import json
import logging
import re
import time
from typing import Any, Dict, List

import httpx

from app.config import resolve_runtime_state_dir


logger = logging.getLogger(__name__)


def _clean_text(raw: str) -> str:
    text = html.unescape(raw or "")
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


class LibraryService:
    """Fetches Ollama official library pages and exposes parsed model metadata."""

    BASE_URL = "https://ollama.com"

    def __init__(self):
        timeout = httpx.Timeout(connect=4.0, read=12.0, write=10.0, pool=5.0)
        self.client = httpx.AsyncClient(
            base_url=self.BASE_URL,
            timeout=timeout,
            headers={
                "User-Agent": "modelforge/1.0 (+https://ollama.com/library)",
            },
        )
        self._models_cache: List[Dict[str, Any]] = []
        self._models_cached_at = 0.0
        self._models_cache_ttl = 45.0
        self._models_source = "official-api"

        self._tags_cache: Dict[str, List[Dict[str, Any]]] = {}
        self._tags_cached_at: Dict[str, float] = {}
        self._tags_cache_ttl = 45.0
        self._max_retries = 3
        self._retry_backoff = 0.5

        self._cache_dir = resolve_runtime_state_dir() / ".cache"
        self._cache_path = self._cache_dir / "library_cache.json"
        self._cache_lock = asyncio.Lock()
        self._load_disk_cache()

    def _load_disk_cache(self) -> None:
        if not self._cache_path.exists():
            return
        try:
            payload = json.loads(self._cache_path.read_text(encoding="utf-8"))
            if not isinstance(payload, dict):
                return

            models = payload.get("models")
            if isinstance(models, list):
                self._models_cache = [m for m in models if isinstance(m, dict)]
                self._models_cached_at = float(payload.get("models_cached_at") or 0.0)
                self._models_source = str(payload.get("models_source") or "official-api")

            tags = payload.get("tags")
            if isinstance(tags, dict):
                normalized_tags: Dict[str, List[Dict[str, Any]]] = {}
                for key, value in tags.items():
                    if not isinstance(key, str) or not isinstance(value, list):
                        continue
                    normalized_tags[key] = [t for t in value if isinstance(t, dict)]
                self._tags_cache = normalized_tags

            tags_cached_at = payload.get("tags_cached_at")
            if isinstance(tags_cached_at, dict):
                normalized_cached_at: Dict[str, float] = {}
                for key, value in tags_cached_at.items():
                    if isinstance(key, str):
                        try:
                            normalized_cached_at[key] = float(value)
                        except Exception:
                            continue
                self._tags_cached_at = normalized_cached_at
        except Exception:
            logger.exception("Failed to load library disk cache from %s", self._cache_path)

    async def _persist_disk_cache(self) -> None:
        payload = {
            "models_cached_at": self._models_cached_at,
            "models_source": self._models_source,
            "models": self._models_cache,
            "tags_cached_at": self._tags_cached_at,
            "tags": self._tags_cache,
        }
        async with self._cache_lock:
            try:
                self._cache_dir.mkdir(parents=True, exist_ok=True)
                self._cache_path.write_text(
                    json.dumps(payload, ensure_ascii=False),
                    encoding="utf-8",
                )
            except Exception:
                logger.exception("Failed to persist library disk cache to %s", self._cache_path)

    async def _request_text(
        self,
        path: str,
        *,
        max_retries: int | None = None,
        timeout: float | None = None,
    ) -> str:
        retries = max_retries if isinstance(max_retries, int) and max_retries > 0 else self._max_retries
        last_error: Exception | None = None
        for attempt in range(retries):
            try:
                response = await self.client.get(path, timeout=timeout)
                response.raise_for_status()
                return response.text
            except Exception as e:
                last_error = e
                if attempt < retries - 1:
                    await asyncio.sleep(self._retry_backoff * (2 ** attempt))
        if last_error is not None:
            raise last_error
        raise RuntimeError(f"Failed to fetch {path}")

    async def _request_json(self, path: str) -> Dict[str, Any]:
        text = await self._request_text(path)
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                return parsed
            raise RuntimeError("Top-level JSON is not an object")
        except Exception:
            raise RuntimeError(f"Invalid JSON response from {path}")

    async def _fetch_catalog_entries(self) -> List[Dict[str, Any]]:
        data = await self._request_json("/api/tags")
        models = data.get("models")
        if isinstance(models, list):
            return [m for m in models if isinstance(m, dict)]
        return []

    def get_models_meta(self) -> Dict[str, Any]:
        now = time.time()
        return {
            "source": self._models_source,
            "fetched_at": self._models_cached_at or None,
            "cache_ttl_seconds": self._models_cache_ttl,
            "cache_age_seconds": max(0.0, now - self._models_cached_at) if self._models_cached_at else None,
            "count": len(self._models_cache),
        }

    @staticmethod
    def _split_model_tag(name: str) -> tuple[str, str]:
        normalized = (name or "").strip()
        if ":" in normalized:
            base, tag = normalized.split(":", 1)
            return base.strip(), tag.strip() or "latest"
        return normalized, "latest"

    async def _fallback_models_from_catalog(self) -> List[Dict[str, Any]]:
        entries = await self._fetch_catalog_entries()
        grouped: Dict[str, Dict[str, Any]] = {}

        for entry in entries:
            full_name = (entry.get("name") or "").strip()
            if not full_name:
                continue
            base, _tag = self._split_model_tag(full_name)
            if not base:
                continue

            item = grouped.get(base)
            if item is None:
                item = {
                    "name": base,
                    "slug": base,
                    "description": "官方模型目录（回退模式）",
                    "capabilities": [],
                    "sizes": [],
                    "pull_count": None,
                    "tag_count": 0,
                    "updated": None,
                    "library_url": f"{self.BASE_URL}/library/{base}",
                }
                grouped[base] = item

            item["tag_count"] = int(item["tag_count"] or 0) + 1

            details = entry.get("details") or {}
            parameter_size = (details.get("parameter_size") or "").strip()
            if parameter_size and parameter_size not in item["sizes"]:
                item["sizes"].append(parameter_size)

            modified_at = (entry.get("modified_at") or "").strip()
            if modified_at and (not item["updated"] or modified_at > item["updated"]):
                item["updated"] = modified_at

        models = list(grouped.values())
        models.sort(key=lambda m: m["name"].lower())
        return models

    @staticmethod
    def _merge_catalog_with_library(
        catalog_models: List[Dict[str, Any]],
        library_models: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        merged: Dict[str, Dict[str, Any]] = {}

        def key_for(item: Dict[str, Any]) -> str:
            slug = str(item.get("slug") or "").strip().lower()
            if slug:
                return slug
            name = str(item.get("name") or "").strip().lower()
            if ":" in name:
                name = name.split(":", 1)[0]
            return name

        for item in catalog_models:
            k = key_for(item)
            if not k:
                continue
            merged[k] = {**item}

        for item in library_models:
            k = key_for(item)
            if not k:
                continue
            if k not in merged:
                merged[k] = {**item}
                continue

            current = merged[k]
            incoming = {**item}

            if incoming.get("description"):
                current["description"] = incoming["description"]
            if incoming.get("capabilities"):
                current["capabilities"] = incoming["capabilities"]
            if incoming.get("pull_count"):
                current["pull_count"] = incoming["pull_count"]
            if incoming.get("tag_count") is not None:
                current["tag_count"] = incoming["tag_count"]
            if incoming.get("updated"):
                current["updated"] = incoming["updated"]
            if incoming.get("library_url"):
                current["library_url"] = incoming["library_url"]

            sizes = list(current.get("sizes") or [])
            for size in incoming.get("sizes") or []:
                if size not in sizes:
                    sizes.append(size)
            current["sizes"] = sizes

        models = list(merged.values())
        models.sort(key=lambda m: m.get("name", "").lower())
        return models

    async def _fallback_tags_from_catalog(self, model_name: str) -> List[Dict[str, Any]]:
        entries = await self._fetch_catalog_entries()
        target = (model_name or "").strip().lower()
        if not target:
            return []

        refs: List[str] = []
        seen: set[str] = set()

        for entry in entries:
            full_name = (entry.get("name") or "").strip()
            if not full_name:
                continue
            base, _tag = self._split_model_tag(full_name)
            if base.lower() != target and full_name.lower() != target:
                continue
            if full_name in seen:
                continue
            seen.add(full_name)
            refs.append(full_name)

        if not refs:
            refs = [model_name]

        tags: List[Dict[str, Any]] = []
        for full_name in refs:
            _base, tag = self._split_model_tag(full_name)
            tags.append(
                {
                    "full_name": full_name,
                    "tag": tag or "latest",
                    "is_latest": (tag or "latest") == "latest",
                    "library_url": f"{self.BASE_URL}/library/{full_name}",
                }
            )
        tags.sort(key=lambda item: (0 if item["is_latest"] else 1, item["full_name"]))
        return tags

    async def list_models(self, refresh: bool = False) -> List[Dict[str, Any]]:
        now = time.time()
        if (
            not refresh
            and self._models_cache
            and now - self._models_cached_at < self._models_cache_ttl
        ):
            return self._models_cache

        models: List[Dict[str, Any]] = []
        source = "official-api"
        # Primary path: /api/tags is the most real-time official catalog source.
        try:
            models = await self._fallback_models_from_catalog()
        except Exception:
            models = []

        # Best-effort enrichment from /search; the HTML there updates faster than the older /library view.
        if models:
            try:
                html_text = await self._request_text("/search", max_retries=1, timeout=3.5)
                parsed = self._parse_library_models(html_text)
                if parsed:
                    models = self._merge_catalog_with_library(models, parsed)
                    source = "official-api+search"
            except Exception:
                logger.info("Search HTML enrichment failed; serving catalog-only models")

            try:
                html_text = await self._request_text("/library", max_retries=1, timeout=2.5)
                parsed = self._parse_library_models(html_text)
                if parsed:
                    models = self._merge_catalog_with_library(models, parsed)
                    source = "official-api+search+library"
            except Exception:
                logger.info("Library HTML enrichment failed; serving merged search/catalog models")
        else:
            try:
                html_text = await self._request_text("/search", max_retries=2, timeout=6.0)
                models = self._parse_library_models(html_text)
                source = "official-search"
            except Exception:
                models = []
            if not models:
                try:
                    html_text = await self._request_text("/library", max_retries=2, timeout=6.0)
                    models = self._parse_library_models(html_text)
                    source = "official-library"
                except Exception:
                    models = []

        if not models and self._models_cache:
            return self._models_cache
        if not models:
            raise RuntimeError("Failed to fetch library models from both /library and /api/tags")

        self._models_cache = models
        self._models_cached_at = now
        self._models_source = source
        await self._persist_disk_cache()
        return models

    async def list_model_tags(self, model_name: str, refresh: bool = False) -> List[Dict[str, Any]]:
        name = (model_name or "").strip()
        if not name:
            return []
        now = time.time()
        cached = self._tags_cache.get(name)
        cached_at = self._tags_cached_at.get(name, 0.0)
        if not refresh and cached is not None and now - cached_at < self._tags_cache_ttl:
            return cached

        tags: List[Dict[str, Any]] = []
        # Primary path: derive tags from /api/tags catalog.
        try:
            tags = await self._fallback_tags_from_catalog(name)
        except Exception:
            tags = []

        # Best-effort HTML parsing fallback for edge cases where catalog misses variants.
        if not tags or len(tags) <= 1:
            try:
                html_text = await self._request_text(f"/library/{name}", max_retries=1, timeout=2.5)
                parsed = self._parse_model_tags(name, html_text)
                if parsed:
                    tags = parsed
            except Exception:
                # Keep catalog-derived tags; no hard failure.
                pass

        if not tags and cached is not None:
            return cached
        if not tags:
            tags = [
                {
                    "full_name": name,
                    "tag": "latest",
                    "is_latest": True,
                    "library_url": f"{self.BASE_URL}/library/{name}",
                }
            ]

        self._tags_cache[name] = tags
        self._tags_cached_at[name] = now
        await self._persist_disk_cache()
        return tags

    def _parse_library_models(self, html_text: str) -> List[Dict[str, Any]]:
        model_blocks = re.findall(r"<li x-test-model.*?</li>", html_text, re.DOTALL)
        models: List[Dict[str, Any]] = []
        seen: set[str] = set()

        for block in model_blocks:
            href_match = re.search(r'href="/library/([^":?/]+)"\s+class="group', block)
            if not href_match:
                continue
            slug = _clean_text(href_match.group(1))
            if not slug or slug in seen:
                continue

            title_match = re.search(r'x-test-model-title[^>]*title="([^"]+)"', block)
            if title_match:
                name = _clean_text(title_match.group(1))
            else:
                title_text_match = re.search(r'x-test-search-response-title>(.*?)</span>', block, re.DOTALL)
                container_title_match = re.search(r'<div class="flex flex-col mb-1" title="([^"]+)"', block)
                name = _clean_text((title_text_match.group(1) if title_text_match else None) or (container_title_match.group(1) if container_title_match else slug))

            desc_match = re.search(r'x-test-model-title.*?<p[^>]*>(.*?)</p>', block, re.DOTALL)
            if not desc_match:
                desc_match = re.search(r'<p class="max-w-lg break-words[^>]*>(.*?)</p>', block, re.DOTALL)
            description = _clean_text(desc_match.group(1)) if desc_match else ""

            capabilities = [
                _clean_text(item)
                for item in re.findall(r'x-test-capability[^>]*>(.*?)</span>', block, re.DOTALL)
            ]
            sizes = [
                _clean_text(item)
                for item in re.findall(r'x-test-size[^>]*>(.*?)</span>', block, re.DOTALL)
            ]
            pull_count = None
            pull_match = re.search(r'x-test-pull-count>(.*?)</span>', block, re.DOTALL)
            if pull_match:
                pull_count = _clean_text(pull_match.group(1))

            tag_count = None
            tag_match = re.search(r'x-test-tag-count>(.*?)</span>', block, re.DOTALL)
            if tag_match:
                tag_count_text = _clean_text(tag_match.group(1))
                try:
                    tag_count = int(tag_count_text)
                except ValueError:
                    tag_count = None

            updated = None
            updated_match = re.search(r'x-test-updated>(.*?)</span>', block, re.DOTALL)
            if updated_match:
                updated = _clean_text(updated_match.group(1))

            models.append(
                {
                    "name": name,
                    "slug": slug,
                    "description": description,
                    "capabilities": [c for c in capabilities if c],
                    "sizes": [s for s in sizes if s],
                    "pull_count": pull_count,
                    "tag_count": tag_count,
                    "updated": updated,
                    "library_url": f"{self.BASE_URL}/library/{slug}",
                }
            )
            seen.add(slug)

        return models

    def _parse_model_tags(self, model_name: str, html_text: str) -> List[Dict[str, Any]]:
        # Canonical references on model pages
        #   <input class="command hidden" value="gpt-oss:20b" />
        raw_refs = re.findall(r'<input class="command hidden" value="([^"]+)"', html_text)
        if not raw_refs:
            # Fallback from links:
            #   href="/library/gpt-oss:20b"
            raw_refs = re.findall(rf'href="/library/({re.escape(model_name)}:[^"]+)"', html_text)

        unique_refs: List[str] = []
        seen: set[str] = set()
        for ref in raw_refs:
            normalized = _clean_text(ref)
            if not normalized:
                continue
            if not (normalized == model_name or normalized.startswith(f"{model_name}:")):
                continue
            if normalized in seen:
                continue
            seen.add(normalized)
            unique_refs.append(normalized)

        if not unique_refs:
            unique_refs = [model_name]

        tags: List[Dict[str, Any]] = []
        for full_name in unique_refs:
            if ":" in full_name:
                _, tag = full_name.split(":", 1)
            else:
                tag = "latest"
            tags.append(
                {
                    "full_name": full_name,
                    "tag": tag,
                    "is_latest": tag == "latest" or full_name == model_name,
                    "library_url": f"{self.BASE_URL}/library/{full_name}",
                }
            )

        # Prefer showing latest first
        tags.sort(key=lambda item: (0 if item["is_latest"] else 1, item["full_name"]))
        return tags


library_service = LibraryService()
