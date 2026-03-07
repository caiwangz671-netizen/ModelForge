"""Client for the local Electron/Node computer helper server."""
from __future__ import annotations

import os
from typing import Any, Optional

import httpx


class ComputerHelperClient:
    def __init__(self) -> None:
        self._base_url = ""
        self._token = ""
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=2.0))
        self.reload_from_env()

    def reload_from_env(self) -> None:
        self._base_url = os.getenv("MODELFORGE_COMPUTER_HELPER_URL", "").strip().rstrip("/")
        self._token = os.getenv("MODELFORGE_COMPUTER_HELPER_TOKEN", "").strip()

    @property
    def configured(self) -> bool:
        return bool(self._base_url and self._token)

    async def close(self) -> None:
        await self._client.aclose()

    async def _request(self, method: str, path: str, payload: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        self.reload_from_env()
        if not self.configured:
            return {
                "ok": False,
                "error": "Computer helper is not configured",
                "desktop_available": False,
            }

        headers = {"Authorization": f"Bearer {self._token}"}
        try:
            response = await self._client.request(
                method,
                f"{self._base_url}{path}",
                json=payload,
                headers=headers,
            )
            response.raise_for_status()
            data = response.json()
            if isinstance(data, dict):
                return data
            return {"ok": False, "error": "Helper returned invalid response"}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    async def health(self) -> dict[str, Any]:
        return await self._request("GET", "/health")

    async def snapshot(self, file_path: str, include_ocr: bool = True) -> dict[str, Any]:
        return await self._request(
            "POST",
            "/snapshot",
            {"file_path": file_path, "include_ocr": include_ocr},
        )

    async def query_state(self) -> dict[str, Any]:
        return await self._request("POST", "/query-state", {})

    async def click(
        self,
        x: int,
        y: int,
        *,
        coordinate_space: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"x": x, "y": y}
        if isinstance(coordinate_space, dict) and coordinate_space:
            payload["coordinate_space"] = coordinate_space
        return await self._request("POST", "/click", payload)

    async def type_text(self, text: str) -> dict[str, Any]:
        return await self._request("POST", "/type", {"text": text})

    async def keypress(self, key: str, modifiers: Optional[list[str]] = None) -> dict[str, Any]:
        return await self._request(
            "POST",
            "/keypress",
            {"key": key, "modifiers": modifiers or []},
        )

    async def scroll(self, delta_x: int = 0, delta_y: int = 0) -> dict[str, Any]:
        return await self._request(
            "POST",
            "/scroll",
            {"delta_x": delta_x, "delta_y": delta_y},
        )

    async def open_url(self, url: str) -> dict[str, Any]:
        return await self._request("POST", "/open-url", {"url": url})

    async def open_app(self, app_name: str) -> dict[str, Any]:
        return await self._request("POST", "/open-app", {"app_name": app_name})

    async def request_permissions(self) -> dict[str, Any]:
        return await self._request("POST", "/request-permissions", {})

    async def hide_main_window(self) -> dict[str, Any]:
        return await self._request("POST", "/hide-main-window", {})

    async def show_main_window(self, *, focus: bool = False) -> dict[str, Any]:
        return await self._request("POST", "/show-main-window", {"focus": focus})

    async def browser_navigate(self, url: str, *, show: bool = True, focus: bool = True) -> dict[str, Any]:
        return await self._request(
            "POST",
            "/browser/navigate",
            {"url": url, "show": show, "focus": focus},
        )

    async def browser_show(self, *, focus: bool = True) -> dict[str, Any]:
        return await self._request("POST", "/browser/show", {"focus": focus})

    async def browser_close(self) -> dict[str, Any]:
        return await self._request("POST", "/browser/close", {})

    async def browser_state(self, *, focus: bool = False) -> dict[str, Any]:
        return await self._request("POST", "/browser/state", {"focus": focus})

    async def browser_click(self, element_id: str) -> dict[str, Any]:
        return await self._request("POST", "/browser/click", {"element_id": element_id})

    async def browser_type(self, element_id: str, text: str, *, clear: bool = True) -> dict[str, Any]:
        return await self._request(
            "POST",
            "/browser/type",
            {"element_id": element_id, "text": text, "clear": clear},
        )

    async def browser_keypress(self, key: str, modifiers: Optional[list[str]] = None) -> dict[str, Any]:
        return await self._request(
            "POST",
            "/browser/keypress",
            {"key": key, "modifiers": modifiers or []},
        )

    async def browser_scroll(self, delta_x: int = 0, delta_y: int = 0) -> dict[str, Any]:
        return await self._request(
            "POST",
            "/browser/scroll",
            {"delta_x": delta_x, "delta_y": delta_y},
        )

    async def browser_back(self) -> dict[str, Any]:
        return await self._request("POST", "/browser/back", {})

    async def show_status_hud(
        self,
        *,
        eyebrow: str = "Computer Use",
        title: str = "",
        detail: str = "",
    ) -> dict[str, Any]:
        return await self._request(
            "POST",
            "/hud/show",
            {"eyebrow": eyebrow, "title": title, "detail": detail},
        )

    async def update_status_hud(
        self,
        *,
        eyebrow: str = "Computer Use",
        title: str = "",
        detail: str = "",
    ) -> dict[str, Any]:
        return await self._request(
            "POST",
            "/hud/update",
            {"eyebrow": eyebrow, "title": title, "detail": detail},
        )

    async def hide_status_hud(self) -> dict[str, Any]:
        return await self._request("POST", "/hud/hide", {})


computer_helper_client = ComputerHelperClient()
