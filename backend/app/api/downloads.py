"""Downloads API routes"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict
from typing import Optional, Dict, Any
import asyncio
import time
import uuid

from app.services.database import execute_query, execute_insert, execute_update
from app.services.ollama import ollama_service

router = APIRouter()

# In-memory download progress store
download_progress: Dict[str, Dict[str, Any]] = {}
download_workers: Dict[str, asyncio.Task] = {}
download_start_lock = asyncio.Lock()

# Retry/metric tuning
MAX_PULL_RETRIES = 3
RETRY_BASE_SECONDS = 2.0
RETRY_MAX_SECONDS = 15.0
SPEED_ALPHA = 0.35
MAX_CONCURRENT_PULLS = 1
ACTIVE_DOWNLOAD_STATUSES = ("queued", "downloading", "paused")

PREPARING_STATUS_TOKENS = (
    "pulling manifest",
    "retrieving manifest",
    "reading model metadata",
)
ASSEMBLY_STATUS_TOKENS = (
    "creating system layer",
    "creating new layer",
    "using existing layer",
    "using already created layer",
)
FINALIZING_STATUS_TOKENS = (
    "verifying sha256 digest",
    "verifying conversion",
    "writing manifest",
    "removing any unused layers",
)


class DownloadRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    model_name: str
    model_version: Optional[str] = "latest"


class DownloadTask(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    id: str
    model_name: str
    model_version: str
    status: str
    progress: float
    downloaded_size: int
    total_size: int
    speed: float
    eta: int
    status_text: Optional[str] = None
    retry_count: int = 0
    error: Optional[str] = None
    created_at: float
    updated_at: float


def _resolve_model_name(model_name: str, model_version: Optional[str]) -> str:
    if ":" in model_name:
        return model_name
    if model_version and model_version != "latest":
        return f"{model_name}:{model_version}"
    return model_name


def _normalize_model_ref(model_name: str, model_version: Optional[str]) -> str:
    return _resolve_model_name(model_name, model_version).strip().lower()


def _coerce_int(value: Any) -> int:
    try:
        if value in (None, ""):
            return 0
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def _coerce_float(value: Any) -> float:
    try:
        if value in (None, ""):
            return 0.0
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _normalize_download_task(task: Dict[str, Any]) -> Dict[str, Any]:
    normalized = dict(task)
    normalized["progress"] = max(0.0, _coerce_float(normalized.get("progress")))
    normalized["downloaded_size"] = max(0, _coerce_int(normalized.get("downloaded_size")))
    normalized["total_size"] = max(0, _coerce_int(normalized.get("total_size")))
    if normalized.get("status") == "completed" and normalized["total_size"] == 0:
        normalized["total_size"] = normalized["downloaded_size"]
    normalized["speed"] = max(0.0, _coerce_float(normalized.get("speed")))
    normalized["eta"] = max(0, _coerce_int(normalized.get("eta")))
    normalized["retry_count"] = max(0, _coerce_int(normalized.get("retry_count")))
    status_text = normalized.get("status_text")
    normalized["status_text"] = str(status_text).strip() if status_text not in (None, "") else str(normalized.get("status") or "")
    return normalized


def _classify_pull_phase(status_text: str | None) -> str:
    text = str(status_text or "").strip().lower()
    if not text:
        return "downloading"
    if text == "success":
        return "completed"
    if any(token in text for token in FINALIZING_STATUS_TOKENS):
        return "finalizing"
    if any(token in text for token in ASSEMBLY_STATUS_TOKENS):
        return "assembling"
    if any(token in text for token in PREPARING_STATUS_TOKENS):
        return "preparing"
    return "downloading"


def _present_pull_status(status_text: str | None) -> str:
    phase = _classify_pull_phase(status_text)
    if phase == "preparing":
        return "preparing download"
    if phase == "assembling":
        return "assembling model layers"
    if phase == "finalizing":
        return "verifying and finalizing"
    if phase == "completed":
        return "completed"
    return str(status_text or "downloading").strip() or "downloading"


async def _drain_download_queue() -> None:
    async with download_start_lock:
        active_workers = 0
        for task_id, worker in list(download_workers.items()):
            if worker.done():
                download_workers.pop(task_id, None)
                continue
            active_workers += 1

        available_slots = max(0, MAX_CONCURRENT_PULLS - active_workers)
        if available_slots <= 0:
            return

        queued_tasks = await execute_query(
            """
            SELECT * FROM download_tasks
            WHERE status = 'queued'
            ORDER BY created_at ASC
            """
        )

        for task in queued_tasks:
            if available_slots <= 0:
                break

            task_id = str(task.get("id") or "")
            if not task_id:
                continue

            existing = download_workers.get(task_id)
            if existing and not existing.done():
                continue

            model_ref = _resolve_model_name(
                str(task.get("model_name") or ""),
                str(task.get("model_version") or "latest"),
            )
            worker = asyncio.create_task(_download_model(task_id, model_ref))
            download_workers[task_id] = worker
            available_slots -= 1


async def _persist_download_state(task_id: str, state: Dict[str, Any], *, status: Optional[str] = None, error: Optional[str] = None) -> None:
    now = time.time()
    normalized = _normalize_download_task(
        {
            **state,
            "status": status or state.get("status") or "queued",
            "error": error,
        }
    )
    await execute_update(
        """
        UPDATE download_tasks
        SET status = ?, progress = ?, downloaded_size = ?, total_size = ?, speed = ?, eta = ?,
            status_text = ?, retry_count = ?, error = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            normalized["status"],
            normalized["progress"],
            normalized["downloaded_size"],
            normalized["total_size"],
            normalized["speed"],
            normalized["eta"],
            normalized["status_text"],
            normalized["retry_count"],
            error,
            now,
            task_id,
        ),
    )


async def _find_active_download_task(model_name: str, model_version: Optional[str]) -> Optional[dict[str, Any]]:
    target_ref = _normalize_model_ref(model_name, model_version)
    tasks = await execute_query(
        """
        SELECT * FROM download_tasks
        WHERE status IN ('queued', 'downloading', 'paused')
        ORDER BY created_at DESC
        """
    )
    for task in tasks:
        task_ref = _normalize_model_ref(
            str(task.get("model_name") or ""),
            str(task.get("model_version") or "latest"),
        )
        if task_ref == target_ref:
            return task
    return None


async def mark_stale_downloads_failed() -> None:
    now = time.time()
    await execute_update(
        """
        UPDATE download_tasks
        SET status = ?, status_text = ?, speed = 0, eta = 0, error = ?, updated_at = ?
        WHERE status IN ('queued', 'downloading', 'paused')
        """,
        ("failed", "failed", "Download interrupted by backend restart", now),
    )


def _is_transient_error(message: str) -> bool:
    text = (message or "").lower()
    transient_tokens = [
        "timeout",
        "timed out",
        "connection reset",
        "connection refused",
        "network",
        "eof",
        "temporarily unavailable",
        "502",
        "503",
        "504",
        "bad gateway",
        "service unavailable",
        "gateway timeout",
    ]
    return any(token in text for token in transient_tokens)


def _retry_delay(attempt: int) -> float:
    # attempt starts from 1 for the first retry
    delay = RETRY_BASE_SECONDS * (2 ** (attempt - 1))
    return min(delay, RETRY_MAX_SECONDS)


@router.get("/")
async def list_downloads():
    """List all download tasks"""
    try:
        tasks = [
            _normalize_download_task(task)
            for task in await execute_query(
            "SELECT * FROM download_tasks ORDER BY created_at DESC"
            )
        ]
        # Merge with in-memory progress
        for task in tasks:
            task_id = task["id"]
            if task_id in download_progress:
                task.update(_normalize_download_task({**task, **download_progress[task_id]}))
        return {"tasks": tasks}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/")
async def start_download(request: DownloadRequest):
    """Start a new download"""
    try:
        async with download_start_lock:
            existing_task = await _find_active_download_task(request.model_name, request.model_version)
            if existing_task:
                existing_task_id = str(existing_task["id"])
                existing_progress = download_progress.get(existing_task_id, {})
                return {
                    "id": existing_task_id,
                    "message": "Download already in progress",
                    "duplicate": True,
                    "status": existing_task.get("status"),
                    "status_text": existing_progress.get("status_text") or existing_task.get("status"),
                }

            task_id = str(uuid.uuid4())
            now = time.time()

            # Insert into database
            await execute_insert(
                """INSERT INTO download_tasks
                   (id, model_name, model_version, status, progress, downloaded_size, total_size,
                    speed, eta, status_text, retry_count, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    task_id,
                    request.model_name,
                    request.model_version,
                    "queued",
                    0,
                    0,
                    0,
                    0,
                    0,
                    "waiting in queue",
                    0,
                    now,
                    now,
                )
            )

            # Initialize progress tracking
            download_progress[task_id] = {
                "progress": 0,
                "downloaded_size": 0,
                "total_size": 0,
                "speed": 0,
                "eta": 0,
                "status_text": "waiting in queue",
                "retry_count": 0,
            }

        await _drain_download_queue()

        return {"id": task_id, "message": "Download started", "duplicate": False}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def _download_model(task_id: str, model_name: str):
    """Background task to download a model"""
    try:
        last_completed: Optional[int] = None
        last_sample_ts: Optional[float] = None
        ema_speed = 0.0
        last_nonzero_speed = 0.0
        last_total: Optional[int] = None

        for attempt in range(MAX_PULL_RETRIES):
            if attempt > 0:
                delay = _retry_delay(attempt)
                download_progress[task_id] = {
                    **download_progress.get(task_id, {}),
                    "status_text": f"network issue, retrying in {int(delay)}s ({attempt}/{MAX_PULL_RETRIES - 1})",
                    "retry_count": attempt,
                }
                await _persist_download_state(task_id, download_progress[task_id], status="queued")
                await asyncio.sleep(delay)

            download_progress[task_id] = {
                **download_progress.get(task_id, {}),
                "status_text": "downloading",
                "retry_count": attempt,
                "error": None,
            }
            await _persist_download_state(task_id, download_progress[task_id], status="downloading", error=None)

            should_retry = False
            stream_done = False

            async for data in ollama_service.pull_model(model_name):
                now = time.time()

                if "error" in data:
                    error_text = str(data.get("error") or "Unknown download error")
                    transient = _is_transient_error(error_text)

                    if transient and attempt < MAX_PULL_RETRIES - 1:
                        should_retry = True
                        download_progress[task_id] = {
                            **download_progress.get(task_id, {}),
                            "status_text": f"network error, preparing retry ({attempt + 1}/{MAX_PULL_RETRIES - 1})",
                            "retry_count": attempt + 1,
                            "error": error_text,
                        }
                        await _persist_download_state(task_id, download_progress[task_id], status="queued", error=error_text)
                        break

                    download_progress[task_id] = {
                        **download_progress.get(task_id, {}),
                        "status_text": "failed",
                        "error": error_text,
                    }
                    await _persist_download_state(task_id, download_progress[task_id], status="failed", error=error_text)
                    return

                status = str(data.get("status", "")).strip()
                phase = _classify_pull_phase(status)

                if "completed" in data and "total" in data:
                    completed = int(data.get("completed") or 0)
                    total = int(data.get("total") or 0)

                    # Ollama reports pull progress per blob/layer. When it switches blobs
                    # the counters can reset, so restart the delta window but keep the last
                    # meaningful transfer speed for display smoothing.
                    if (
                        last_completed is not None
                        and (completed < last_completed or (last_total is not None and total != last_total))
                    ):
                        last_completed = None
                        last_sample_ts = None
                        ema_speed = 0.0

                    if last_completed is not None and last_sample_ts is not None:
                        delta_bytes = completed - last_completed
                        delta_seconds = max(now - last_sample_ts, 1e-6)
                        if delta_bytes > 0:
                            instant_speed = delta_bytes / delta_seconds
                            ema_speed = (
                                instant_speed
                                if ema_speed <= 0
                                else (SPEED_ALPHA * instant_speed + (1 - SPEED_ALPHA) * ema_speed)
                            )
                            last_nonzero_speed = ema_speed

                    last_completed = completed
                    last_sample_ts = now
                    last_total = total

                    progress = (completed / total * 100) if total > 0 else 0.0
                    display_speed = ema_speed if ema_speed > 0 else last_nonzero_speed
                    eta = int((total - completed) / display_speed) if total > completed and display_speed > 1 else 0

                    download_progress[task_id] = {
                        **download_progress.get(task_id, {}),
                        "progress": round(progress, 1),
                        "downloaded_size": completed,
                        "total_size": total,
                        "speed": round(display_speed, 2),
                        "eta": eta,
                        "status_text": _present_pull_status(status),
                        "retry_count": attempt,
                        "error": None,
                    }
                    await _persist_download_state(task_id, download_progress[task_id], status="downloading", error=None)
                elif status:
                    latest = download_progress.get(task_id, {})
                    progress = float(latest.get("progress") or 0)
                    if phase == "finalizing" and progress >= 90:
                        progress = max(progress, 99.0)
                    download_progress[task_id] = {
                        **latest,
                        "progress": progress,
                        "speed": 0,
                        "eta": 0,
                        "status_text": _present_pull_status(status),
                        "retry_count": attempt,
                    }
                    await _persist_download_state(task_id, download_progress[task_id], status="downloading", error=None)

                if status == "success" or data.get("done"):
                    stream_done = True
                    latest = download_progress.get(task_id, {})
                    final_total = int(latest.get("total_size") or latest.get("downloaded_size") or 0)
                    final_downloaded = int(latest.get("downloaded_size") or final_total)

                    download_progress[task_id] = {
                        **latest,
                        "progress": 100,
                        "downloaded_size": final_downloaded,
                        "total_size": final_total,
                        "speed": 0,
                        "eta": 0,
                        "status_text": "completed",
                        "retry_count": attempt,
                        "error": None,
                    }
                    await _persist_download_state(task_id, download_progress[task_id], status="completed", error=None)
                    return

            if stream_done:
                return

            if should_retry:
                continue

            # Stream ended unexpectedly without success marker.
            if attempt < MAX_PULL_RETRIES - 1:
                download_progress[task_id] = {
                    **download_progress.get(task_id, {}),
                    "status_text": f"download stream interrupted, preparing retry ({attempt + 1}/{MAX_PULL_RETRIES - 1})",
                    "retry_count": attempt + 1,
                }
                await _persist_download_state(task_id, download_progress[task_id], status="queued")
                continue

            error_text = "Download stream ended unexpectedly"
            download_progress[task_id] = {
                **download_progress.get(task_id, {}),
                "status_text": "failed",
                "error": error_text,
            }
            await _persist_download_state(task_id, download_progress[task_id], status="failed", error=error_text)
            return

    except asyncio.CancelledError:
        download_progress[task_id] = {
            **download_progress.get(task_id, {}),
            "status_text": "cancelled",
        }
        await _persist_download_state(task_id, download_progress[task_id], status="cancelled")
        raise
    except Exception as e:
        download_progress[task_id] = {
            **download_progress.get(task_id, {}),
            "status_text": "failed",
            "error": str(e),
        }
        await _persist_download_state(task_id, download_progress[task_id], status="failed", error=str(e))
    finally:
        download_workers.pop(task_id, None)
        await _drain_download_queue()


@router.delete("/history")
async def clear_download_history():
    """Delete completed/failed/cancelled download history without touching active tasks."""
    try:
        active_tasks = await execute_query(
            """
            SELECT id FROM download_tasks
            WHERE status IN ('queued', 'downloading', 'paused')
            """
        )
        active_ids = {str(task.get("id") or "") for task in active_tasks if task.get("id")}

        deleted = await execute_update(
            """
            DELETE FROM download_tasks
            WHERE status NOT IN ('queued', 'downloading', 'paused')
            """
        )

        for task_id in list(download_progress.keys()):
            if task_id not in active_ids:
                download_progress.pop(task_id, None)

        return {"message": "Download history cleared", "deleted": deleted}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{task_id}")
async def get_download_status(task_id: str):
    """Get download status"""
    try:
        tasks = await execute_query(
            "SELECT * FROM download_tasks WHERE id = ?",
            (task_id,)
        )
        if not tasks:
            raise HTTPException(status_code=404, detail="Download task not found")

        task = _normalize_download_task(tasks[0])
        if task_id in download_progress:
            task.update(_normalize_download_task({**task, **download_progress[task_id]}))

        return task
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{task_id}")
async def cancel_download(task_id: str):
    """Cancel a download"""
    try:
        worker = download_workers.get(task_id)
        if worker and not worker.done():
            worker.cancel()

        download_progress[task_id] = {
            **download_progress.get(task_id, {}),
            "status_text": "cancelled",
        }
        await _persist_download_state(task_id, download_progress[task_id], status="cancelled")
        await _drain_download_queue()
        return {"message": "Download cancelled"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
