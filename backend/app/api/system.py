"""System API routes"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import json

from app.services.ollama import ollama_service
from app.services.memory_service import memory_service
from app.services.model_residency_service import model_residency_service
from app.utils.env import upsert_env_value

router = APIRouter()


class SettingsUpdate(BaseModel):
    ollama_host: Optional[str] = None
    memory_enabled: Optional[bool] = None
    memory_embedding_model: Optional[str] = None
    max_output_tokens: Optional[int] = None
    max_context_tokens: Optional[int] = None
    auto_unload_after_response: Optional[bool] = None
    inject_runtime_time: Optional[bool] = None


@router.get("/health")
async def system_health():
    """Check system health"""
    try:
        # Check Ollama connection
        ollama_status = "healthy"
        ollama_version = None
        try:
            version_info = await ollama_service.get_version()
            ollama_version = version_info.get("version")
        except Exception as e:
            ollama_status = f"unhealthy: {str(e)}"
        
        memory_status = await memory_service.get_status()

        return {
            "status": "healthy",
            "ollama": {
                "status": ollama_status,
                "version": ollama_version
            },
            "memory": memory_status,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/version")
async def get_version():
    """Get Ollama version"""
    try:
        version = await ollama_service.get_version()
        return version
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/settings")
async def get_settings():
    """Get system settings"""
    from app.config import get_settings
    settings = get_settings()
    memory_status = await memory_service.get_status()
    
    return {
        "ollama_host": settings.ollama_host,
        "debug": settings.debug,
        "memory_enabled": settings.memory_enabled,
        "memory_embedding_model": settings.memory_embedding_model,
        "max_output_tokens": settings.max_output_tokens,
        "max_context_tokens": settings.max_context_tokens,
        "auto_unload_after_response": settings.auto_unload_after_response,
        "inject_runtime_time": settings.inject_runtime_time,
        "resident_models": model_residency_service.list_resident_models(),
        "memory_status": memory_status,
    }


@router.put("/settings")
async def update_settings(request: SettingsUpdate):
    """Update system settings"""
    from app.config import get_settings, resolve_persisted_env_path
    settings = get_settings()
    env_path = resolve_persisted_env_path()

    if request.ollama_host:
        ollama_service.base_url = request.ollama_host
        ollama_service.client.base_url = request.ollama_host
        ollama_service.quick_client.base_url = request.ollama_host
        settings.ollama_host = request.ollama_host
        upsert_env_value(env_path, "OLLAMA_HOST", request.ollama_host)
        memory_service.invalidate_embedding_model_cache()

    if request.memory_enabled is not None:
        settings.memory_enabled = request.memory_enabled
        upsert_env_value(env_path, "MEMORY_ENABLED", "true" if request.memory_enabled else "false")

    if request.memory_embedding_model is not None:
        next_embedding = request.memory_embedding_model.strip() or None
        settings.memory_embedding_model = next_embedding
        upsert_env_value(env_path, "MEMORY_EMBEDDING_MODEL", next_embedding)
        memory_service.invalidate_embedding_model_cache()

    if request.max_output_tokens is not None:
        if request.max_output_tokens <= 0:
            raise HTTPException(status_code=400, detail="max_output_tokens must be > 0")
        settings.max_output_tokens = max(128, min(int(request.max_output_tokens), 262144))
        upsert_env_value(env_path, "MAX_OUTPUT_TOKENS", str(settings.max_output_tokens))

    if request.max_context_tokens is not None:
        if request.max_context_tokens <= 0:
            raise HTTPException(status_code=400, detail="max_context_tokens must be > 0")
        settings.max_context_tokens = max(512, min(int(request.max_context_tokens), 1048576))
        upsert_env_value(env_path, "MAX_CONTEXT_TOKENS", str(settings.max_context_tokens))

    if request.auto_unload_after_response is not None:
        model_residency_service.set_auto_unload_after_response(request.auto_unload_after_response)
        settings.auto_unload_after_response = request.auto_unload_after_response
        upsert_env_value(
            env_path,
            "AUTO_UNLOAD_AFTER_RESPONSE",
            "true" if request.auto_unload_after_response else "false",
        )

    if request.inject_runtime_time is not None:
        settings.inject_runtime_time = request.inject_runtime_time
        upsert_env_value(
            env_path,
            "INJECT_RUNTIME_TIME",
            "true" if request.inject_runtime_time else "false",
        )
    
    return {"message": "Settings updated"}


@router.get("/hardware")
async def get_hardware_info():
    """Detect host hardware: RAM, CPU, GPU (best-effort)"""
    import os
    import platform
    import re
    import subprocess

    try:
        import psutil  # type: ignore
    except Exception:
        psutil = None

    vm_total = 0
    vm_available = 0
    vm_used = 0
    vm_percent = 0.0
    cpu_count = os.cpu_count() or 0
    cpu_count_physical = cpu_count

    if psutil is not None:
        vm = psutil.virtual_memory()
        vm_total = int(vm.total)
        vm_available = int(vm.available)
        vm_used = int(vm.used)
        vm_percent = float(vm.percent)
        cpu_count = psutil.cpu_count(logical=True) or cpu_count
        cpu_count_physical = psutil.cpu_count(logical=False) or cpu_count_physical

    gpu_info = None
    gpu_vram_bytes = None
    vm_total_override = None

    def _darwin_available_memory_bytes() -> int | None:
        """
        Approximate available memory using vm_stat output when psutil is unavailable.
        """
        try:
            vmstat_result = subprocess.run(
                ["vm_stat"],
                capture_output=True,
                text=True,
                timeout=2,
            )
            if vmstat_result.returncode != 0:
                return None

            page_size = 4096
            pages: dict[str, int] = {}
            for line in vmstat_result.stdout.splitlines():
                line_s = line.strip()
                if "page size of" in line_s:
                    match = re.search(r"page size of\s+(\d+)\s+bytes", line_s)
                    if match:
                        page_size = int(match.group(1))
                    continue
                if ":" not in line_s:
                    continue
                key, raw_value = line_s.split(":", 1)
                value = raw_value.strip().rstrip(".").replace(".", "")
                if value.isdigit():
                    pages[key.strip()] = int(value)

            free_pages = pages.get("Pages free", 0)
            inactive_pages = pages.get("Pages inactive", 0)
            speculative_pages = pages.get("Pages speculative", 0)
            return (free_pages + inactive_pages + speculative_pages) * page_size
        except Exception:
            return None

    def _windows_gpu_info() -> tuple[str | None, int | None]:
        """
        Query Windows GPU info through PowerShell CIM when available.
        """
        try:
            result = subprocess.run(
                [
                    "powershell.exe",
                    "-NoLogo",
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    (
                        "Get-CimInstance Win32_VideoController | "
                        "Select-Object -Property Name,AdapterRAM | "
                        "ConvertTo-Json -Compress"
                    ),
                ],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if result.returncode != 0 or not result.stdout.strip():
                return None, None
            payload = json.loads(result.stdout)
            items = payload if isinstance(payload, list) else [payload]
            for item in items:
                if not isinstance(item, dict):
                    continue
                name = str(item.get("Name") or "").strip()
                raw_ram = item.get("AdapterRAM")
                adapter_ram = None
                try:
                    if raw_ram is not None and str(raw_ram).strip():
                        adapter_ram = int(raw_ram)
                except Exception:
                    adapter_ram = None
                if name:
                    return name, adapter_ram
        except Exception:
            return None, None
        return None, None

    # Try NVIDIA GPU
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
            parts = result.stdout.strip().split(",")
            gpu_info = parts[0].strip()
            if len(parts) > 1:
                gpu_vram_bytes = int(float(parts[1].strip()) * 1024 * 1024)  # MiB -> bytes
    except Exception:
        pass

    # Try macOS Metal (Apple Silicon unified memory)
    # Get accurate physical memory first (psutil virtual_memory can be weird on mac)
    if platform.system() == "Darwin":
        try:
            mem_result = subprocess.run(
                ["sysctl", "-n", "hw.memsize"], 
                capture_output=True, text=True, timeout=2
            )
            if mem_result.returncode == 0:
                vm_total_override = int(mem_result.stdout.strip())
        except Exception:
            pass

        if vm_total_override is not None:
            vm_total = vm_total_override
            if vm_available <= 0:
                vm_available = _darwin_available_memory_bytes() or 0
            vm_used = max(vm_total - vm_available, 0)
            vm_percent = (vm_used / vm_total * 100.0) if vm_total > 0 else 0.0

        if gpu_info is None:
            try:
                result = subprocess.run(
                    ["system_profiler", "SPDisplaysDataType"],
                    capture_output=True, text=True, timeout=10,
                )
                if result.returncode == 0:
                    for line in result.stdout.splitlines():
                        line_s = line.strip()
                        if "Chipset Model:" in line_s or "Chip:" in line_s:
                            gpu_info = line_s.split(":", 1)[1].strip()
                            break
                    # On Apple Silicon, GPU uses unified memory = total physical RAM
                    if gpu_info and any(x in gpu_info for x in ["Apple", "M1", "M2", "M3", "M4"]):
                        gpu_vram_bytes = vm_total
            except Exception:
                pass

    if platform.system() == "Windows" and gpu_info is None:
        detected_gpu, detected_vram = _windows_gpu_info()
        if detected_gpu:
            gpu_info = detected_gpu
        if detected_vram and detected_vram > 0:
            gpu_vram_bytes = detected_vram

    return {
        "ram_total": vm_total,
        "ram_available": vm_available,
        "ram_used": vm_used,
        "ram_percent": vm_percent,
        "cpu_cores_logical": cpu_count,
        "cpu_cores_physical": cpu_count_physical,
        "cpu_arch": platform.machine(),
        "os": platform.system(),
        "gpu_name": gpu_info,
        "gpu_vram_bytes": gpu_vram_bytes,
    }
