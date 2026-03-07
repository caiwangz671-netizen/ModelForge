"""Computer use beta API routes."""
from __future__ import annotations

import asyncio
import json
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from app.services.computer_helper_client import computer_helper_client
from app.services.computer_use_service import computer_use_service

router = APIRouter()


class SessionCreateRequest(BaseModel):
    model: str
    goal: str
    approval_mode: Optional[str] = None
    parent_session_id: Optional[str] = None
    cwd: Optional[str] = None
    allowed_paths: list[str] = Field(default_factory=list)


class ApprovalRequest(BaseModel):
    approval_id: str
    edited_input: Optional[dict[str, Any]] = None


class RejectionRequest(BaseModel):
    approval_id: str
    reason: Optional[str] = None


@router.get("/status")
async def get_computer_use_status():
    return await computer_use_service.get_status()


@router.post("/request-permissions")
async def request_permissions():
    return await computer_helper_client.request_permissions()


@router.post("/sessions")
async def create_session(request: SessionCreateRequest):
    try:
        return await computer_use_service.create_session(
            model=request.model,
            goal=request.goal,
            approval_mode=request.approval_mode,
            parent_session_id=request.parent_session_id,
            cwd=request.cwd,
            allowed_paths=request.allowed_paths,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/sessions")
async def list_sessions():
    try:
        return await computer_use_service.list_sessions()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/sessions")
async def delete_all_sessions():
    try:
        return await computer_use_service.delete_all_sessions()
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/sessions/{session_id}")
async def get_session(session_id: str):
    try:
        return await computer_use_service.get_session(session_id)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/sessions/{session_id}/run")
async def run_session(session_id: str):
    try:
        return await computer_use_service.start_session(session_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/sessions/{session_id}/events")
async def stream_session_events(session_id: str):
    async def event_stream():
        stream = computer_use_service.subscribe(session_id)
        try:
            while True:
                try:
                    event = await asyncio.wait_for(anext(stream), timeout=15)
                except asyncio.TimeoutError:
                    # Keep the SSE connection alive during long tool/model rounds.
                    yield ": ping\n\n"
                    continue
                except StopAsyncIteration:
                    break
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'error': str(exc)}, ensure_ascii=False)}\n\n"
        finally:
            await stream.aclose()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@router.post("/sessions/{session_id}/approve")
async def approve_action(session_id: str, request: ApprovalRequest):
    try:
        return await computer_use_service.approve(
            session_id,
            request.approval_id,
            edited_input=request.edited_input,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/sessions/{session_id}/reject")
async def reject_action(session_id: str, request: RejectionRequest):
    try:
        return await computer_use_service.reject(
            session_id,
            request.approval_id,
            reason=request.reason,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/sessions/{session_id}/pause")
async def pause_session(session_id: str):
    try:
        return await computer_use_service.pause_session(session_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/sessions/{session_id}/resume")
async def resume_session(session_id: str):
    try:
        return await computer_use_service.resume_session(session_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/sessions/{session_id}/cancel")
async def cancel_session(session_id: str):
    try:
        return await computer_use_service.cancel_session(session_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/sessions/{session_id}/artifacts/{artifact_id}")
async def get_artifact(session_id: str, artifact_id: str):
    try:
        file_path, mime_type = await computer_use_service.get_artifact_file(session_id, artifact_id)
        return FileResponse(file_path, media_type=mime_type)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc))
