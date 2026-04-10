import asyncio
import os
import platform
import subprocess
import zipfile
import shutil
import time
import httpx
from typing import Dict, Any, Optional
from app.config import get_settings

settings = get_settings()

class OllamaInstallService:
    """Service to handle background download and installation of Ollama."""
    
    def __init__(self):
        self._state: Dict[str, Any] = {
            "status": "idle", # idle, downloading, extracting, installing, completed, failed
            "progress": 0.0,
            "speed_kbps": 0.0,
            "error": None,
            "started_at": None,
            "completed_at": None,
            "total_bytes": 0,
            "downloaded_bytes": 0,
        }
        self._lock = asyncio.Lock()
        self._task: Optional[asyncio.Task] = None

    async def get_status(self) -> Dict[str, Any]:
        async with self._lock:
            return self._state.copy()

    def _update_state(self, **kwargs):
        for k, v in kwargs.items():
            if k in self._state:
                self._state[k] = v

    async def start_install(self):
        async with self._lock:
            if self._state["status"] in ["downloading", "extracting", "installing"]:
                return {"message": "Installation already in progress"}
            
            # Reset state
            self._state = {
                "status": "downloading",
                "progress": 0.0,
                "speed_kbps": 0.0,
                "error": None,
                "started_at": time.time(),
                "completed_at": None,
                "total_bytes": 0,
                "downloaded_bytes": 0,
            }
            
            self._task = asyncio.create_task(self._run_install_loop())
            return {"message": "Installation started in background"}

    async def _run_install_loop(self):
        try:
            system = platform.system()
            if system == "Darwin":
                await self._install_macos()
            elif system == "Windows":
                await self._install_windows()
            else:
                raise Exception(f"Automatic installation not supported on {system}")
            
            self._update_state(status="completed", progress=1.0, completed_at=time.time())
        except Exception as e:
            print(f"Ollama installation failed: {str(e)}")
            self._update_state(status="failed", error=str(e))

    async def _install_macos(self):
        url = "https://ollama.com/download/Ollama-darwin.zip"
        dest_dir = os.path.join(settings.model_state_dir, "install_tmp")
        os.makedirs(dest_dir, exist_ok=True)
        zip_path = os.path.join(dest_dir, "Ollama-darwin.zip")
        
        # 1. Download
        await self._download_file(url, zip_path)
        
        # 2. Extract
        self._update_state(status="extracting", progress=0.95)
        extract_path = os.path.join(dest_dir, "extracted")
        os.makedirs(extract_path, exist_ok=True)
        
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(extract_path)
            
        # 3. Install (Move to /Applications if possible, otherwise keep in local dir)
        self._update_state(status="installing")
        app_name = "Ollama.app"
        extracted_app = os.path.join(extract_path, app_name)
        
        target_app = "/Applications/Ollama.app"
        
        # Check if we can write to /Applications
        try:
            if os.path.exists(target_app):
                # If it already exists, maybe it was just not running?
                # But we're here because it's missing or unusable.
                pass
            
            # Try to move. On Mac, this might fail without sudo if not an admin.
            # However, for a user-facing desktop app, we'll try common paths.
            user_apps = os.path.expanduser("~/Applications")
            os.makedirs(user_apps, exist_ok=True)
            user_target = os.path.join(user_apps, app_name)
            
            if os.path.exists(user_target):
                shutil.rmtree(user_target)
            
            shutil.move(extracted_app, user_target)
            
            # Launch it
            subprocess.Popen(["open", "-g", user_target])
            
        except Exception as e:
            # Fallback: Just try to launch from the extracted dir if move fails
            print(f"Failed to move Ollama to Applications: {str(e)}")
            subprocess.Popen(["open", "-g", extracted_app])

    async def _install_windows(self):
        url = "https://ollama.com/download/OllamaSetup.exe"
        dest_dir = os.path.join(settings.model_state_dir, "install_tmp")
        os.makedirs(dest_dir, exist_ok=True)
        exe_path = os.path.join(dest_dir, "OllamaSetup.exe")
        
        # 1. Download
        await self._download_file(url, exe_path)
        
        # 2. Run
        self._update_state(status="installing", progress=0.98)
        subprocess.Popen([exe_path, "/silent"])

    async def _download_file(self, url: str, path: str):
        async with httpx.AsyncClient(timeout=600.0) as client:
            async with client.stream("GET", url) as response:
                response.raise_for_status()
                total = int(response.headers.get("content-length", 0))
                self._update_state(total_bytes=total)
                
                downloaded = 0
                start_time = time.time()
                
                with open(path, "wb") as f:
                    async for chunk in response.aiter_bytes():
                        f.write(chunk)
                        downloaded += len(chunk)
                        
                        # Update progress every ~0.5s or significant chunk
                        now = time.time()
                        elapsed = now - start_time
                        if elapsed > 0.5:
                            speed = (downloaded / 1024) / elapsed # KB/s
                            progress = min(0.99, downloaded / total) if total > 0 else 0.5
                            self._update_state(
                                progress=progress,
                                downloaded_bytes=downloaded,
                                speed_kbps=speed
                            )
                
                self._update_state(downloaded_bytes=downloaded, progress=0.9)

# Singleton instance
ollama_install_service = OllamaInstallService()
