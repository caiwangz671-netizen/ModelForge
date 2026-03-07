"""Memory API routes"""
import json

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from typing import Optional, List
from app.services.database import execute_query, execute_update
from app.services.memory_service import memory_service

router = APIRouter()


class MemoryCreate(BaseModel):
    type: str  # "short_term", "long_term", "semantic", "episodic"
    content: str
    tags: List[str] = Field(default_factory=list)
    importance: Optional[float] = 0.5


class MemoryUpdate(BaseModel):
    content: Optional[str] = None
    tags: Optional[List[str]] = None
    importance: Optional[float] = None


class MemorySearchRequest(BaseModel):
    query: str
    limit: int = 10


def _serialize_memory_item(item: dict) -> dict:
    payload = dict(item)
    payload["metadata"] = memory_service.parse_metadata(payload.get("metadata"))
    payload.pop("embedding", None)
    return payload


@router.get("/")
async def list_memory(
    type: Optional[str] = None,
    session_id: Optional[str] = None,
    limit: int = 50,
    offset: int = 0
):
    """List memory items"""
    try:
        query = "SELECT * FROM memory WHERE 1=1"
        params = []
        
        if type:
            query += " AND type = ?"
            params.append(type)
        
        if session_id:
            # This would need metadata parsing, simplified for now
            pass
        
        query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        
        items = await execute_query(query, tuple(params))
        return {"items": [_serialize_memory_item(item) for item in items]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/")
async def create_memory(request: MemoryCreate):
    """Create a new memory item"""
    try:
        memory = await memory_service.create_memory_item(
            memory_type=request.type,
            content=request.content,
            tags=request.tags or [],
            importance=request.importance if request.importance is not None else 0.5,
            metadata={"source": "manual_api"},
        )
        return _serialize_memory_item(memory)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/import")
async def import_memory_file(
    file: UploadFile = File(...),
    memory_type: str = Form("semantic"),
    tags: Optional[str] = Form(None),
    chunk_size: int = Form(900),
    overlap: int = Form(120),
):
    """Import external text-like file into memory as chunked RAG knowledge."""
    try:
        raw = await file.read()
        parsed_tags: List[str] = []
        if tags:
            text = tags.strip()
            if text.startswith("["):
                try:
                    parsed = json.loads(text)
                    if isinstance(parsed, list):
                        parsed_tags = [str(item).strip() for item in parsed if str(item).strip()]
                except json.JSONDecodeError:
                    parsed_tags = []
            else:
                parsed_tags = [part.strip() for part in text.split(",") if part.strip()]

        result = await memory_service.import_external_document(
            filename=file.filename or "uploaded.txt",
            file_bytes=raw,
            tags=parsed_tags,
            memory_type=memory_type,
            chunk_size=chunk_size,
            overlap=overlap,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status")
async def get_memory_status():
    """Get automatic memory runtime status."""
    try:
        return await memory_service.get_status()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/embedding-setup")
async def get_embedding_setup():
    """Get embedding setup recommendation for first-time memory usage."""
    try:
        return await memory_service.get_embedding_setup_info()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/search")
async def search_memory(request: MemorySearchRequest):
    """Search memory items (embedding search when available)."""
    try:
        limit = max(1, min(request.limit, 100))
        items = await memory_service.search_memories(query=request.query, limit=limit)
        return {"items": [_serialize_memory_item(item) for item in items]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{memory_id}")
async def update_memory(memory_id: str, request: MemoryUpdate):
    """Update a memory item"""
    try:
        await memory_service.update_memory_item(
            memory_id=memory_id,
            content=request.content,
            tags=request.tags,
            importance=request.importance,
        )
        return {"message": "Memory updated"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{memory_id}")
async def delete_memory(memory_id: str):
    """Delete a memory item"""
    try:
        await execute_update(
            "DELETE FROM memory WHERE id = ?",
            (memory_id,)
        )
        return {"message": "Memory deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{memory_id}")
async def get_memory(memory_id: str):
    """Get a memory item"""
    try:
        items = await execute_query(
            "SELECT * FROM memory WHERE id = ?",
            (memory_id,)
        )
        if not items:
            raise HTTPException(status_code=404, detail="Memory not found")
        return _serialize_memory_item(items[0])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
