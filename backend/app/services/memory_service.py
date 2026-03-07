"""Memory service with embedding-based retrieval for chat context."""
from __future__ import annotations

import ast
import csv
import io
import json
import math
import re
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.config import get_settings
from app.services.database import execute_insert, execute_query, execute_update
from app.services.model_capabilities import ModelCapabilityService
from app.services.ollama import ollama_service


def _parse_metadata(raw: Any) -> Dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return {}
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            # Backward compatibility: old rows used str(dict)
            try:
                parsed = ast.literal_eval(text)
                if isinstance(parsed, dict):
                    return parsed
            except Exception:
                return {}
    return {}


def _parse_embedding(raw: Any) -> Optional[List[float]]:
    if raw is None:
        return None
    values: Any = raw
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return None
        try:
            values = json.loads(text)
        except json.JSONDecodeError:
            try:
                values = ast.literal_eval(text)
            except Exception:
                return None

    if not isinstance(values, list):
        return None

    vector: List[float] = []
    for item in values:
        try:
            vector.append(float(item))
        except (TypeError, ValueError):
            return None
    return vector if vector else None


def _cosine_similarity(a: List[float], b: List[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


class MemoryService:
    """Embedding-backed memory retrieval and persistence."""

    PREFERRED_EMBEDDING_MODELS = (
        "nomic-embed-text",
        "mxbai-embed-large",
        "bge-m3",
        "snowflake-arctic-embed",
        "all-minilm",
    )
    RECALL_CUE_KEYWORDS = (
        "记得", "忘了", "还记得", "我是谁", "我叫什么", "我的名字",
        "remember", "forgot", "who am i", "what do you know about me",
    )
    MEMORY_QUERY_CUE_KEYWORDS = (
        "记忆", "记得", "之前", "上次", "历史", "知识库", "资料", "文档", "引用", "参考",
        "memory", "recall", "remember", "earlier", "previous", "history", "knowledge base",
        "rag", "document", "docs", "reference", "cite",
    )
    MIN_VECTOR_SCORE_FOR_AUTO_USE = 0.34
    MIN_VECTOR_SCORE_FOR_CUE_QUERY = 0.20
    MIN_LEXICAL_OVERLAP_FOR_AUTO_USE = 0.20
    MAX_CONTEXT_SNIPPET_CHARS = 180
    MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024
    DEFAULT_IMPORT_CHUNK_SIZE = 900
    DEFAULT_IMPORT_CHUNK_OVERLAP = 120
    SUPPORTED_IMPORT_EXTENSIONS = {
        ".txt",
        ".md",
        ".markdown",
        ".json",
        ".csv",
        ".log",
    }

    def __init__(self):
        self._cached_embedding_model: Optional[str] = None
        self._embedding_model_cached_at = 0.0
        self._cache_ttl_seconds = 30.0

    def invalidate_embedding_model_cache(self) -> None:
        self._cached_embedding_model = None
        self._embedding_model_cached_at = 0.0

    @classmethod
    def _is_memory_recall_query(cls, query: str) -> bool:
        text = (query or "").strip().lower()
        if not text:
            return False
        return any(keyword in text for keyword in cls.RECALL_CUE_KEYWORDS)

    @classmethod
    def _is_memory_or_rag_cue_query(cls, query: str) -> bool:
        text = (query or "").strip().lower()
        if not text:
            return False
        return any(keyword in text for keyword in cls.MEMORY_QUERY_CUE_KEYWORDS)

    @classmethod
    def _query_terms(cls, query: str) -> List[str]:
        text = (query or "").strip().lower()
        if not text:
            return []
        terms: List[str] = []
        terms.extend(re.findall(r"[a-z0-9][a-z0-9_.-]{1,}", text))
        terms.extend(re.findall(r"[\u4e00-\u9fff]{2,}", text))
        dedup: List[str] = []
        seen: set[str] = set()
        for term in terms:
            if term in seen:
                continue
            seen.add(term)
            dedup.append(term)
        return dedup

    @classmethod
    def _lexical_overlap_ratio(cls, query: str, content: str) -> float:
        terms = cls._query_terms(query)
        if not terms:
            return 0.0
        text = (content or "").strip().lower()
        if not text:
            return 0.0
        hits = sum(1 for term in terms if term in text)
        return hits / max(1, len(terms))

    @staticmethod
    def _normalize_memory_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        for row in rows:
            row["metadata"] = _parse_metadata(row.get("metadata"))
        return rows

    @staticmethod
    def _normalize_tags(tags: Optional[List[str]]) -> List[str]:
        if not tags:
            return []
        normalized: List[str] = []
        seen: set[str] = set()
        for raw in tags:
            text = re.sub(r"\s+", " ", str(raw or "").strip())
            if not text:
                continue
            key = text.lower()
            if key in seen:
                continue
            seen.add(key)
            normalized.append(text[:40])
        return normalized

    @classmethod
    def _detect_memory_category(cls, text: str, memory_type: str, metadata: Dict[str, Any]) -> str:
        source_type = str(metadata.get("source_type") or metadata.get("source") or "").lower()
        text_l = (text or "").strip().lower()

        if source_type in {"external_document", "external_import", "file_import"}:
            return "external_knowledge"

        profile_hints = (
            "我叫", "我是", "我的", "我喜欢", "我不喜欢",
            "my name", "i am", "i'm", "i prefer", "i like", "i dislike",
        )
        if any(hint in text_l for hint in profile_hints):
            return "user_profile"

        preference_hints = ("偏好", "习惯", "优先", "preference", "prefer", "habit")
        if any(hint in text_l for hint in preference_hints):
            return "user_preference"

        project_hints = ("项目", "仓库", "代码库", "project", "repo", "codebase", "milestone", "sprint")
        if any(hint in text_l for hint in project_hints):
            return "project_context"

        if memory_type == "episodic":
            return "conversation_memory"
        if memory_type == "semantic":
            return "knowledge_snippet"
        if memory_type == "long_term":
            return "long_term_note"
        return "general_note"

    @classmethod
    def _auto_tags_from_content(cls, text: str, memory_type: str, metadata: Dict[str, Any]) -> List[str]:
        text_l = (text or "").lower()
        category = cls._detect_memory_category(text, memory_type, metadata)
        tags: List[str] = [f"cat:{category}", f"type:{memory_type}"]

        if any(hint in text_l for hint in ("todo", "待办", "下一步", "action item")):
            tags.append("action-item")
        if any(hint in text_l for hint in ("bug", "报错", "异常", "error", "stack trace")):
            tags.append("debug")
        if any(hint in text_l for hint in ("api", "接口", "endpoint")):
            tags.append("api")
        if any(hint in text_l for hint in ("配置", "config", "setting", "环境变量", "env")):
            tags.append("config")

        source_name = str(metadata.get("source_name") or "").strip()
        if source_name:
            stem = Path(source_name).stem.strip().lower()
            stem = re.sub(r"[^a-z0-9\u4e00-\u9fff_-]+", "-", stem).strip("-")
            if stem:
                tags.append(f"src:{stem[:24]}")

        return cls._normalize_tags(tags)

    @classmethod
    def _merge_tags(cls, manual_tags: Optional[List[str]], auto_tags: Optional[List[str]]) -> List[str]:
        return cls._normalize_tags([*(manual_tags or []), *(auto_tags or [])])

    @classmethod
    def _enrich_metadata(
        cls,
        content: str,
        memory_type: str,
        tags: Optional[List[str]],
        importance: float,
        metadata: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        base = dict(metadata or {})
        category = cls._detect_memory_category(content, memory_type, base)
        merged_tags = cls._merge_tags(tags, cls._auto_tags_from_content(content, memory_type, base))

        enriched: Dict[str, Any] = {
            "tags": merged_tags,
            "importance": importance,
            "category": category,
            **base,
        }
        if "source_type" not in enriched:
            enriched["source_type"] = str(base.get("source") or "manual").strip() or "manual"
        return enriched

    @staticmethod
    def _decode_text_bytes(raw: bytes) -> str:
        for encoding in ("utf-8", "utf-8-sig", "gb18030", "latin-1"):
            try:
                return raw.decode(encoding)
            except UnicodeDecodeError:
                continue
        return raw.decode("utf-8", errors="ignore")

    @classmethod
    def _extract_text_from_import_file(cls, filename: str, raw: bytes) -> str:
        ext = Path(filename or "").suffix.lower()
        if ext and ext not in cls.SUPPORTED_IMPORT_EXTENSIONS:
            raise ValueError(f"Unsupported file type: {ext}")

        text = cls._decode_text_bytes(raw).strip()
        if not text:
            return ""

        if ext == ".json":
            try:
                parsed = json.loads(text)
                return json.dumps(parsed, ensure_ascii=False, indent=2)
            except json.JSONDecodeError:
                return text

        if ext == ".csv":
            sio = io.StringIO(text)
            reader = csv.reader(sio)
            rows: List[str] = []
            for row in reader:
                row_text = " | ".join(cell.strip() for cell in row if cell is not None)
                if row_text:
                    rows.append(row_text)
            return "\n".join(rows)

        return text

    @classmethod
    def _chunk_text(cls, text: str, chunk_size: int, overlap: int) -> List[str]:
        normalized = re.sub(r"\r\n?", "\n", (text or "").strip())
        normalized = re.sub(r"\n{3,}", "\n\n", normalized)
        if not normalized:
            return []

        safe_chunk_size = max(300, min(int(chunk_size), 4000))
        safe_overlap = max(0, min(int(overlap), safe_chunk_size // 2))

        paragraphs = [p.strip() for p in normalized.split("\n\n") if p.strip()]
        chunks: List[str] = []
        current = ""

        for paragraph in paragraphs:
            if len(paragraph) > safe_chunk_size:
                words = paragraph.split()
                sub = ""
                for token in words:
                    next_sub = f"{sub} {token}".strip()
                    if len(next_sub) <= safe_chunk_size:
                        sub = next_sub
                        continue
                    if sub:
                        chunks.append(sub)
                    sub = token
                if sub:
                    chunks.append(sub)
                current = ""
                continue

            candidate = f"{current}\n\n{paragraph}".strip() if current else paragraph
            if len(candidate) <= safe_chunk_size:
                current = candidate
                continue

            if current:
                chunks.append(current)
            current = paragraph

        if current:
            chunks.append(current)

        if safe_overlap <= 0 or len(chunks) <= 1:
            return chunks

        overlapped: List[str] = []
        for index, chunk in enumerate(chunks):
            if index == 0:
                overlapped.append(chunk)
                continue
            prev_tail = chunks[index - 1][-safe_overlap:]
            merged = f"{prev_tail}\n{chunk}".strip()
            overlapped.append(merged[:safe_chunk_size + safe_overlap])

        return overlapped

    @staticmethod
    def _snippet_for_reference(content: str, max_chars: int = 140) -> str:
        text = re.sub(r"\s+", " ", (content or "").strip())
        if len(text) <= max_chars:
            return text
        return f"{text[: max_chars - 1]}…"

    async def _keyword_search_memories(self, text: str, limit: int) -> List[Dict[str, Any]]:
        items = await execute_query(
            "SELECT * FROM memory WHERE content LIKE ? ORDER BY updated_at DESC LIMIT ?",
            (f"%{text}%", limit),
        )
        return self._normalize_memory_rows(items)

    async def _recent_memories(self, limit: int) -> List[Dict[str, Any]]:
        items = await execute_query(
            "SELECT * FROM memory ORDER BY updated_at DESC LIMIT ?",
            (limit,),
        )
        return self._normalize_memory_rows(items)

    async def _detect_embedding_model(self) -> Optional[str]:
        try:
            models = await ollama_service.list_models()
        except Exception:
            return None

        settings = get_settings()
        configured_model = (settings.memory_embedding_model or "").strip()
        if configured_model:
            configured_lower = configured_model.lower()
            for model in models:
                name = (model.get("name") or "").strip()
                if not name:
                    continue
                if name.lower() != configured_lower:
                    continue
                details = model.get("details", {})
                if ModelCapabilityService.supports_embedding(name, details):
                    return name
                break

        candidates: List[str] = []
        for model in models:
            name = model.get("name", "")
            if not name:
                continue
            details = model.get("details", {})
            if ModelCapabilityService.supports_embedding(name, details):
                candidates.append(name)

        if not candidates:
            return None

        lower_candidates = {m.lower(): m for m in candidates}
        for preferred in self.PREFERRED_EMBEDDING_MODELS:
            for model_lower, original in lower_candidates.items():
                if preferred in model_lower:
                    return original

        return candidates[0]

    async def list_local_embedding_models(self) -> List[str]:
        try:
            models = await ollama_service.list_models()
        except Exception:
            return []

        candidates: List[str] = []
        for model in models:
            name = (model.get("name") or "").strip()
            if not name:
                continue
            details = model.get("details", {})
            if ModelCapabilityService.supports_embedding(name, details):
                candidates.append(name)
        return sorted(set(candidates))

    async def get_embedding_model(self, refresh: bool = False) -> Optional[str]:
        now = time.time()
        if (
            not refresh
            and self._cached_embedding_model is not None
            and now - self._embedding_model_cached_at < self._cache_ttl_seconds
        ):
            return self._cached_embedding_model

        if not refresh and now - self._embedding_model_cached_at < self._cache_ttl_seconds:
            return self._cached_embedding_model

        model = await self._detect_embedding_model()
        self._cached_embedding_model = model
        self._embedding_model_cached_at = now
        return model

    @staticmethod
    def parse_metadata(raw: Any) -> Dict[str, Any]:
        return _parse_metadata(raw)

    async def get_status(self) -> Dict[str, Any]:
        settings = get_settings()
        configured_model = (settings.memory_embedding_model or "").strip() or None
        if not settings.memory_enabled:
            return {
                "enabled": False,
                "reason": "disabled_by_settings",
                "embedding_model": None,
                "configured_embedding_model": configured_model,
            }

        model = await self.get_embedding_model()
        if not model:
            return {
                "enabled": False,
                "reason": "configured_embedding_model_not_found" if configured_model else "no_embedding_model",
                "embedding_model": None,
                "configured_embedding_model": configured_model,
            }

        return {
            "enabled": True,
            "reason": "ready",
            "embedding_model": model,
            "configured_embedding_model": configured_model,
        }

    async def get_embedding_setup_info(self) -> Dict[str, Any]:
        status = await self.get_status()
        local_embeddings = await self.list_local_embedding_models()
        configured_model = status.get("configured_embedding_model")

        recommended_download_model: Optional[str] = None
        need_download = False

        if status.get("enabled"):
            need_download = False
        elif status.get("reason") == "disabled_by_settings":
            need_download = False
        elif local_embeddings:
            need_download = False
        else:
            need_download = True
            preferred = self.PREFERRED_EMBEDDING_MODELS[0]
            recommended_download_model = f"{preferred}:latest"

        return {
            "status": status,
            "local_embedding_models": local_embeddings,
            "need_download": need_download,
            "recommended_download_model": recommended_download_model,
            "configured_embedding_model": configured_model,
        }

    async def embed_text(self, text: str) -> Optional[List[float]]:
        content = (text or "").strip()
        if not content:
            return None

        status = await self.get_status()
        if not status["enabled"]:
            return None

        model = status["embedding_model"]
        if not model:
            return None

        try:
            result = await ollama_service.embed(model=model, text=content)
        except Exception:
            return None

        if isinstance(result, list) and result and isinstance(result[0], list):
            return [float(x) for x in result[0]]
        if isinstance(result, list):
            return [float(x) for x in result]
        return None

    async def create_memory_item(
        self,
        memory_type: str,
        content: str,
        tags: Optional[List[str]] = None,
        importance: float = 0.5,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        now = time.time()
        memory_id = str(uuid.uuid4())
        text = (content or "").strip()
        if not text:
            raise ValueError("Memory content cannot be empty")
        metadata = self._enrich_metadata(
            content=text,
            memory_type=memory_type,
            tags=tags,
            importance=importance,
            metadata=metadata,
        )

        status = await self.get_status()
        embedding = await self.embed_text(text) if status["enabled"] else None

        full_metadata: Dict[str, Any] = {**metadata}
        if status["embedding_model"]:
            full_metadata["embedding_model"] = status["embedding_model"]

        await execute_insert(
            """INSERT INTO memory (id, type, content, embedding, metadata, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                memory_id,
                memory_type,
                text,
                json.dumps(embedding, ensure_ascii=False) if embedding is not None else None,
                json.dumps(full_metadata, ensure_ascii=False),
                now,
                now,
            ),
        )

        return {
            "id": memory_id,
            "type": memory_type,
            "content": text,
            "embedding": embedding,
            "metadata": full_metadata,
            "created_at": now,
            "updated_at": now,
        }

    async def update_memory_item(
        self,
        memory_id: str,
        content: Optional[str] = None,
        tags: Optional[List[str]] = None,
        importance: Optional[float] = None,
    ) -> None:
        items = await execute_query("SELECT * FROM memory WHERE id = ?", (memory_id,))
        if not items:
            return

        existing = items[0]
        now = time.time()
        next_content = (content if content is not None else existing.get("content", "")).strip()
        metadata = _parse_metadata(existing.get("metadata"))
        next_tags = tags if tags is not None else metadata.get("tags", [])
        next_importance = importance if importance is not None else metadata.get("importance", 0.5)
        memory_type = str(existing.get("type") or "semantic")

        metadata = self._enrich_metadata(
            content=next_content,
            memory_type=memory_type,
            tags=next_tags,
            importance=float(next_importance or 0.5),
            metadata=metadata,
        )

        status = await self.get_status()
        next_embedding = await self.embed_text(next_content) if status["enabled"] else None
        if status["embedding_model"]:
            metadata["embedding_model"] = status["embedding_model"]

        await execute_update(
            """UPDATE memory
               SET content = ?, embedding = ?, metadata = ?, updated_at = ?
               WHERE id = ?""",
            (
                next_content,
                json.dumps(next_embedding, ensure_ascii=False) if next_embedding is not None else None,
                json.dumps(metadata, ensure_ascii=False),
                now,
                memory_id,
            ),
        )

    async def search_memories(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        text = (query or "").strip()
        if not text:
            return []
        limit = max(limit, 1)

        keyword_fallback = await self._keyword_search_memories(text, limit)
        status = await self.get_status()
        if not status["enabled"]:
            return keyword_fallback

        query_embedding = await self.embed_text(text)
        if query_embedding is None:
            if keyword_fallback:
                return keyword_fallback
            if self._is_memory_recall_query(text):
                return await self._recent_memories(limit)
            return []

        candidates = await execute_query(
            """SELECT * FROM memory
               WHERE embedding IS NOT NULL
               ORDER BY updated_at DESC
               LIMIT 400"""
        )

        scored: List[Dict[str, Any]] = []
        for row in candidates:
            emb = _parse_embedding(row.get("embedding"))
            if emb is None:
                continue
            score = _cosine_similarity(query_embedding, emb)
            if score < 0.18:
                continue
            row["score"] = score
            row["metadata"] = _parse_metadata(row.get("metadata"))
            scored.append(row)

        scored.sort(key=lambda x: x["score"], reverse=True)
        top = scored[:limit]
        if top:
            if self._is_memory_recall_query(text) and len(top) < limit:
                recent_items = await self._recent_memories(limit * 2)
                seen_ids = {item.get("id") for item in top if item.get("id")}
                for row in recent_items:
                    row_id = row.get("id")
                    if row_id in seen_ids:
                        continue
                    top.append(row)
                    seen_ids.add(row_id)
                    if len(top) >= limit:
                        break
            return top

        if keyword_fallback:
            return keyword_fallback
        if self._is_memory_recall_query(text):
            return await self._recent_memories(limit)
        return []

    async def import_external_document(
        self,
        *,
        filename: str,
        file_bytes: bytes,
        tags: Optional[List[str]] = None,
        memory_type: str = "semantic",
        chunk_size: int = DEFAULT_IMPORT_CHUNK_SIZE,
        overlap: int = DEFAULT_IMPORT_CHUNK_OVERLAP,
    ) -> Dict[str, Any]:
        if not filename:
            raise ValueError("Filename is required")
        if not file_bytes:
            raise ValueError("File is empty")
        if len(file_bytes) > self.MAX_IMPORT_FILE_BYTES:
            raise ValueError("File is too large; max allowed is 20MB")

        extracted_text = self._extract_text_from_import_file(filename, file_bytes)
        if not extracted_text.strip():
            raise ValueError("No readable text found in file")

        chunks = self._chunk_text(extracted_text, chunk_size=chunk_size, overlap=overlap)
        if not chunks:
            raise ValueError("No valid chunks generated from file")

        source_id = str(uuid.uuid4())
        normalized_tags = self._normalize_tags(tags or [])
        imported_ids: List[str] = []
        total_chunks = len(chunks)

        for index, chunk in enumerate(chunks):
            if not chunk.strip():
                continue

            item = await self.create_memory_item(
                memory_type=memory_type,
                content=chunk,
                tags=normalized_tags,
                importance=0.6,
                metadata={
                    "source": "external_import",
                    "source_type": "external_document",
                    "source_name": filename,
                    "source_id": source_id,
                    "chunk_index": index,
                    "chunk_total": total_chunks,
                },
            )
            imported_ids.append(str(item.get("id")))

        return {
            "source_id": source_id,
            "source_name": filename,
            "memory_type": memory_type,
            "chunk_count": total_chunks,
            "imported_count": len(imported_ids),
            "memory_ids": imported_ids[:20],
            "tags": normalized_tags,
        }

    async def build_chat_memory_payload(
        self,
        query: str,
        limit: int = 4,
        only_when_relevant: bool = True,
    ) -> Dict[str, Any]:
        text = (query or "").strip()
        if not text:
            return {"context": None, "references": []}

        cue_query = self._is_memory_or_rag_cue_query(text)
        query_terms = self._query_terms(text)
        if only_when_relevant and not cue_query and len(query_terms) <= 1:
            return {"context": None, "references": []}

        memories = await self.search_memories(text, limit=max(limit * 3, 10))
        if not memories:
            return {"context": None, "references": []}

        selected: List[Dict[str, Any]] = []
        for item in memories:
            content = (item.get("content") or "").strip()
            if not content:
                continue
            score_raw = item.get("score")
            score_val = float(score_raw) if isinstance(score_raw, (int, float)) else None
            overlap = self._lexical_overlap_ratio(text, content)

            if only_when_relevant:
                if score_val is not None:
                    threshold = (
                        self.MIN_VECTOR_SCORE_FOR_CUE_QUERY
                        if cue_query
                        else self.MIN_VECTOR_SCORE_FOR_AUTO_USE
                    )
                    if score_val < threshold and overlap < self.MIN_LEXICAL_OVERLAP_FOR_AUTO_USE:
                        continue
                else:
                    if overlap < (0.14 if cue_query else self.MIN_LEXICAL_OVERLAP_FOR_AUTO_USE):
                        continue

            selected.append({**item, "_overlap": overlap})
            if len(selected) >= limit:
                break

        if not selected:
            return {"context": None, "references": []}

        lines = [
            "以下是与你当前问题相关的知识/记忆片段（RAG 检索），仅在相关时使用："
        ]
        references: List[Dict[str, Any]] = []

        for idx, item in enumerate(selected, start=1):
            content = (item.get("content") or "").strip()
            if not content:
                continue

            metadata = _parse_metadata(item.get("metadata"))
            label = f"R{idx}"
            score = item.get("score")
            score_val = float(score) if isinstance(score, (int, float)) else None
            snippet = self._snippet_for_reference(content, max_chars=self.MAX_CONTEXT_SNIPPET_CHARS)

            source_name = (
                str(metadata.get("source_name") or "").strip()
                or str(metadata.get("source") or "").strip()
                or str(item.get("type") or "memory")
            )
            chunk_index = metadata.get("chunk_index")
            chunk_suffix = ""
            if isinstance(chunk_index, int):
                chunk_suffix = f" chunk#{chunk_index + 1}"

            lines.append(f"- [{label}] {snippet}")
            references.append({
                "label": label,
                "memory_id": item.get("id"),
                "category": metadata.get("category"),
                "source_name": source_name,
                "source_type": metadata.get("source_type"),
                "chunk_index": chunk_index,
                "score": score_val,
                "overlap": float(item.get("_overlap") or 0.0),
                "snippet": snippet,
                "display": f"{source_name}{chunk_suffix}".strip(),
            })

        if len(lines) <= 1:
            return {"context": None, "references": references}

        return {
            "context": "\n".join(lines),
            "references": references,
        }

    async def build_chat_memory_context(self, query: str, limit: int = 4) -> Optional[str]:
        payload = await self.build_chat_memory_payload(query=query, limit=limit)
        context = payload.get("context")
        if not isinstance(context, str) or not context.strip():
            return None
        return context

    async def remember_user_message(
        self,
        conversation_id: str,
        model: str,
        user_content: str,
    ) -> None:
        text = (user_content or "").strip()
        if not text:
            return

        status = await self.get_status()
        if not status["enabled"]:
            return

        importance = min(1.0, 0.35 + min(len(text), 800) / 2000.0)
        await self.create_memory_item(
            memory_type="episodic",
            content=text,
            tags=["user-message"],
            importance=importance,
            metadata={
                "source": "chat_user_message",
                "source_type": "chat_user",
                "conversation_id": conversation_id,
                "chat_model": model,
            },
        )


memory_service = MemoryService()
