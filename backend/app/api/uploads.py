"""Uploads API routes"""
from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
import os
import time
import uuid
from pathlib import Path

from app.services.database import execute_insert, execute_query
from app.config import resolve_runtime_state_dir

router = APIRouter()

def get_upload_dir() -> Path:
    upload_dir = resolve_runtime_state_dir() / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    return upload_dir

@router.post("")
async def upload_file(file: UploadFile = File(...)):
    """Upload a file and record in database"""
    try:
        upload_id = str(uuid.uuid4())
        upload_dir = get_upload_dir()
        
        # Create a unique storage name to avoid collisions
        ext = Path(file.filename).suffix if file.filename else ""
        storage_filename = f"{upload_id}{ext}"
        storage_path = upload_dir / storage_filename
        
        # Save file to disk
        content = await file.read()
        size = len(content)
        
        with open(storage_path, "wb") as f:
            f.write(content)
            
        # Record in database
        now = time.time()
        await execute_insert(
            """INSERT INTO uploads (id, filename, mime_type, size, storage_path, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (upload_id, file.filename or "unknown", file.content_type or "application/octet-stream", size, str(storage_path), now)
        )
        
        return {
            "id": upload_id,
            "filename": file.filename,
            "mime_type": file.content_type,
            "size": size,
            "url": f"/api/uploads/{upload_id}/file"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{upload_id}/file")
async def get_uploaded_file(upload_id: str):
    """Retrieve an uploaded file"""
    try:
        rows = await execute_query("SELECT storage_path, filename, mime_type FROM uploads WHERE id = ?", (upload_id,))
        if not rows:
            raise HTTPException(status_code=404, detail="File not found")
        
        row = rows[0]
        storage_path = row["storage_path"]
        
        if not os.path.exists(storage_path):
            raise HTTPException(status_code=404, detail="File missing on disk")
            
        return FileResponse(
            path=storage_path,
            filename=row["filename"],
            media_type=row["mime_type"]
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{upload_id}")
async def get_upload_metadata(upload_id: str):
    """Get metadata for an upload"""
    try:
        rows = await execute_query("SELECT * FROM uploads WHERE id = ?", (upload_id,))
        if not rows:
            raise HTTPException(status_code=404, detail="Upload not found")
        return rows[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
