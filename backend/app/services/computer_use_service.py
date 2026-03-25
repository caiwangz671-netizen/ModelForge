"""Computer use session orchestration service."""
from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, AsyncGenerator, Optional

from app.config import PROJECT_ROOT
from app.services.chat_service import ChatService
from app.services.computer_helper_client import computer_helper_client
from app.services.database import execute_insert, execute_query, execute_update
from app.services.model_capabilities import ModelCapabilityService
from app.services.ollama import ollama_service
from app.services.prompt_service import PromptService

MAX_TOOL_ROUNDS = max(24, int(os.getenv("MODELFORGE_COMPUTER_USE_MAX_TOOL_ROUNDS", "48")))
TERMINAL_SESSION_STATUSES = {"completed", "failed", "cancelled"}
AUTO_TOOLS = {
    "computer_snapshot",
    "computer_query_state",
    "computer_locate_target",
    "computer_wait_for_user",
    "browser_query_state",
}
READ_ONLY_TOOLS = {"fs_list", "fs_read_text"}
WRITE_TOOLS = {"fs_write_text"}
ACCESSIBILITY_REQUIRED_TOOLS = {
    "computer_query_state",
    "computer_click",
    "computer_click_box",
    "computer_click_target",
    "computer_type",
    "computer_keypress",
    "computer_scroll",
}
HIGH_RISK_TOOLS = {
    "computer_click",
    "computer_click_box",
    "computer_click_target",
    "computer_type",
    "computer_keypress",
    "computer_scroll",
    "computer_open_url",
    "computer_open_app",
    "browser_navigate",
    "browser_click",
    "browser_type",
    "browser_keypress",
    "browser_scroll",
    "browser_back",
    "terminal_exec",
}
APPROVAL_MODE_REVIEW_ALL = "review_all"
APPROVAL_MODE_HANDS_FREE = "hands_free"
DEFAULT_APPROVAL_MODE = APPROVAL_MODE_HANDS_FREE
APPROVAL_MODES = {APPROVAL_MODE_REVIEW_ALL, APPROVAL_MODE_HANDS_FREE}
HANDS_FREE_AUTO_APPROVED_TOOLS = {
    "computer_click",
    "computer_click_box",
    "computer_click_target",
    "computer_keypress",
    "computer_scroll",
    "computer_open_url",
    "computer_open_app",
    "browser_navigate",
    "browser_click",
    "browser_type",
    "browser_keypress",
    "browser_scroll",
    "browser_back",
}
RETRYABLE_TOOLS = {
    "computer_snapshot",
    "computer_query_state",
    "computer_click",
    "computer_click_box",
    "computer_click_target",
    "computer_keypress",
    "computer_scroll",
    "computer_open_app",
    "browser_navigate",
    "browser_query_state",
    "browser_click",
    "browser_type",
    "browser_keypress",
    "browser_scroll",
    "browser_back",
}
MAX_TOOL_RETRIES = max(2, int(os.getenv("MODELFORGE_COMPUTER_USE_MAX_TOOL_RETRIES", "4")))
RECOMMENDED_OCR_MODEL = "glm-ocr:latest"
RECOMMENDED_LOCAL_OCR_NAME = "Tesseract OCR"
RECOMMENDED_LOCAL_OCR_INSTALL_HINT = "brew install tesseract"
NATIVE_VIDEO_CAPS = {"video", "videos", "video_input", "video-input"}
DIRECT_VISUAL_CAPS = NATIVE_VIDEO_CAPS | {"vision", "image", "images"}
OCR_EXTRACTION_PROMPT = (
    "You are extracting OCR from a desktop screenshot.\n"
    "Return only the visible text and short structural labels in reading order.\n"
    "Do not explain. Do not summarize. If nothing is readable, return an empty string."
)
NATIVE_VIDEO_SNAPSHOT_PROMPT = (
    "You are analyzing the latest desktop frame for an autonomous computer-use agent.\n"
    "Return Simplified Chinese Markdown only.\n"
    "Use this structure when information is available:\n"
    "### 当前界面\n"
    "- 活动应用: ...\n"
    "- 当前页面: ...\n"
    "### 关键内容\n"
    "- ...\n"
    "### 可操作控件\n"
    "- 左侧/中部/右侧: ...\n"
    "### 风险或阻塞\n"
    "- 无明显阻塞。\n"
    "Rules:\n"
    "- Keep it concise. No more than 8 bullets total.\n"
    "- Do not dump the whole UI.\n"
    "- Focus on task-relevant state only.\n"
    "- If the page clearly looks like a login, signup, captcha, SMS verification, payment, or checkout screen, call that out explicitly.\n"
    "- If the screenshot mainly shows ModelForge itself, say that briefly and mention only the current task state, model, permissions, and blockers.\n"
    "- Do not speculate. Do not add advice."
)
VISION_LOCATE_TARGET_PROMPT = (
    "You are locating a click target on a desktop screenshot for an autonomous computer-use agent.\n"
    "Return JSON only with this schema:\n"
    "{\n"
    '  "found": true,\n'
    '  "target": "简短目标名",\n'
    '  "bbox": {"x": 0, "y": 0, "width": 0, "height": 0},\n'
    '  "point": {"x": 0, "y": 0},\n'
    '  "confidence": 0.0,\n'
    '  "reason": "简短原因"\n'
    "}\n"
    "Rules:\n"
    "- Coordinates must be in screenshot pixels.\n"
    "- point must be a safe clickable point inside bbox.\n"
    "- If the target is not visible or confidence is low, return found=false and explain why.\n"
    "- Prefer exact visible UI controls or text labels over guessed areas.\n"
    "- If there are multiple matches, pick the most task-relevant one."
)
SECRET_HINTS = (
    "password",
    "passwd",
    "otp",
    "token",
    "api key",
    "verification",
    "secret",
    "验证码",
    "密码",
    "口令",
)
SAFE_TERMINAL_PREFIXES = (
    "pwd",
    "ls",
    "find",
    "rg",
    "grep",
    "cat",
    "head",
    "tail",
    "wc",
    "stat",
    "file",
    "open",
)
DANGEROUS_TERMINAL_MARKERS = (
    " rm ",
    "rm -",
    " rm/",
    "sudo",
    "chmod",
    "chown",
    "mkfs",
    "diskutil erase",
    "git push",
    "scp ",
    "ssh ",
    "curl ",
    "wget ",
    "brew install",
    "brew uninstall",
    "npm install",
    "pnpm add",
    "yarn add",
    ">",
    ">>",
    "| sh",
    "| bash",
)
TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "computer_snapshot",
            "description": "Capture a fresh screenshot and return desktop perception text using direct visual routing when available, otherwise OCR.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "computer_query_state",
            "description": "Read current frontmost app, window title, and focused element metadata.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "computer_click",
            "description": "Click the desktop at the given screen coordinates.",
            "parameters": {
                "type": "object",
                "properties": {
                    "x": {"type": "integer"},
                    "y": {"type": "integer"},
                },
                "required": ["x", "y"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "computer_click_box",
            "description": "Click inside a bounding box using ratios within that box. Prefer this over raw screen coordinates when you know the target bounds.",
            "parameters": {
                "type": "object",
                "properties": {
                    "x": {"type": "integer"},
                    "y": {"type": "integer"},
                    "width": {"type": "integer"},
                    "height": {"type": "integer"},
                    "x_ratio": {"type": "number"},
                    "y_ratio": {"type": "number"},
                },
                "required": ["x", "y", "width", "height"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "computer_locate_target",
            "description": "Locate a visible UI target on a fresh screenshot and return a bounding box plus a safe click point.",
            "parameters": {
                "type": "object",
                "properties": {
                    "target": {"type": "string"},
                },
                "required": ["target"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "computer_click_target",
            "description": "Locate a visible UI target on a fresh screenshot and click it using a bounding box plus a safe click point.",
            "parameters": {
                "type": "object",
                "properties": {
                    "target": {"type": "string"},
                    "x_ratio": {"type": "number"},
                    "y_ratio": {"type": "number"},
                },
                "required": ["target"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "computer_type",
            "description": "Type plain text into the currently focused field.",
            "parameters": {
                "type": "object",
                "properties": {"text": {"type": "string"}},
                "required": ["text"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "computer_keypress",
            "description": "Press a key with optional modifiers, for example Enter or Cmd+L.",
            "parameters": {
                "type": "object",
                "properties": {
                    "key": {"type": "string"},
                    "modifiers": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["key"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "computer_scroll",
            "description": "Scroll the current view by delta values.",
            "parameters": {
                "type": "object",
                "properties": {
                    "delta_x": {"type": "integer"},
                    "delta_y": {"type": "integer"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "computer_open_url",
            "description": "Open a URL using the default browser.",
            "parameters": {
                "type": "object",
                "properties": {"url": {"type": "string"}},
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "computer_open_app",
            "description": "Open a native desktop application by name or executable identifier.",
            "parameters": {
                "type": "object",
                "properties": {"app_name": {"type": "string"}},
                "required": ["app_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "browser_navigate",
            "description": "Open or navigate the controlled browser window to a URL.",
            "parameters": {
                "type": "object",
                "properties": {"url": {"type": "string"}},
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "browser_query_state",
            "description": "Read the controlled browser DOM state, including URL, title, visible interactive elements, and login indicators.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "browser_click",
            "description": "Click a visible element in the controlled browser by element_id from browser_query_state.",
            "parameters": {
                "type": "object",
                "properties": {"element_id": {"type": "string"}},
                "required": ["element_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "browser_type",
            "description": "Type into a visible input in the controlled browser by element_id from browser_query_state.",
            "parameters": {
                "type": "object",
                "properties": {
                    "element_id": {"type": "string"},
                    "text": {"type": "string"},
                    "clear": {"type": "boolean"},
                },
                "required": ["element_id", "text"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "browser_keypress",
            "description": "Send a key press to the controlled browser, for example Enter or Cmd+L.",
            "parameters": {
                "type": "object",
                "properties": {
                    "key": {"type": "string"},
                    "modifiers": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["key"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "browser_scroll",
            "description": "Scroll the controlled browser viewport by delta values.",
            "parameters": {
                "type": "object",
                "properties": {
                    "delta_x": {"type": "integer"},
                    "delta_y": {"type": "integer"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "browser_back",
            "description": "Navigate back in the controlled browser history.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "computer_wait_for_user",
            "description": "Pause the session and ask the user to take over, for example to log in or solve a captcha, then continue after the user resumes.",
            "parameters": {
                "type": "object",
                "properties": {
                    "reason": {"type": "string"},
                },
                "required": ["reason"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "terminal_exec",
            "description": "Run a non-interactive shell command in the current working directory.",
            "parameters": {
                "type": "object",
                "properties": {"command": {"type": "string"}},
                "required": ["command"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fs_list",
            "description": "List files and directories under a path.",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fs_read_text",
            "description": "Read a UTF-8 text file from disk.",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fs_write_text",
            "description": "Write UTF-8 text to a file on disk.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "content": {"type": "string"},
                },
                "required": ["path", "content"],
            },
        },
    },
]
COMPUTER_USE_SYSTEM_PROMPT = PromptService.build_computer_use_system_prompt()
NATIVE_VIDEO_ROUTE_NOTE = PromptService.build_computer_use_route_note(True)
OCR_ROUTE_SYSTEM_NOTE = PromptService.build_computer_use_route_note(False)
OBSERVATION_ONLY_SYSTEM_NOTE = PromptService.build_computer_use_observation_only_note()
BROWSER_ONLY_SYSTEM_NOTE = PromptService.build_computer_use_browser_only_note()
HANDS_FREE_SYSTEM_NOTE = PromptService.build_computer_use_hands_free_note()


def _now() -> float:
    return time.time()


def _loads_json(raw: Any, default: Any) -> Any:
    if raw is None:
        return default
    if isinstance(raw, (list, dict)):
        return raw
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return default
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return default
    return default


def _dumps_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _truncate(text: str, limit: int = 4000) -> str:
    if len(text) <= limit:
        return text
    return f"{text[:limit]}...(truncated)"


def _is_safe_terminal_command(command: str) -> bool:
    normalized = f" {str(command or '').strip().lower()} "
    if not normalized.strip():
        return False
    if any(marker in normalized for marker in DANGEROUS_TERMINAL_MARKERS):
        return False
    stripped = normalized.strip()
    if any(stripped == prefix or stripped.startswith(f"{prefix} ") for prefix in SAFE_TERMINAL_PREFIXES):
        return True
    if re.match(r"^(npm|pnpm|yarn)\s+(run\s+)?(build|dev|preview|start)\b", stripped):
        return True
    if re.match(r"^python3?\s+-m\s+http\.server\b", stripped):
        return True
    if re.match(r"^npx\s+vite(\s+(preview|dev))?\b", stripped):
        return True
    return False


def _normalize_snapshot_markdown(text: str) -> str:
    next_text = (text or "").replace("\r\n", "\n").strip()
    if not next_text:
        return ""

    section_titles = (
        "**Active App/Window:**",
        "**Visible Text:**",
        "**UI Controls & Position:**",
        "**Warnings/Errors/Blockers:**",
        "**Warnings/Blockers:**",
        "**Blockers:**",
    )
    for title in section_titles:
        next_text = next_text.replace(f" {title}", f"\n\n{title}\n")

    next_text = re.sub(r"(?m)^\*\s+", "- ", next_text)
    next_text = re.sub(r"(?<!\n)\s+\*\s+\*\*", r"\n- **", next_text)
    next_text = re.sub(r"\n{3,}", "\n\n", next_text)
    return next_text.strip()


def _extract_json_candidate(text: str) -> Optional[dict[str, Any]]:
    raw = (text or "").strip()
    if not raw:
        return None

    candidates = [raw]
    fenced = re.sub(r"^```(?:json)?\s*\n?", "", raw)
    fenced = re.sub(r"\n?```$", "", fenced).strip()
    if fenced and fenced != raw:
        candidates.append(fenced)

    object_match = re.search(r"\{[\s\S]*\}", fenced or raw)
    if object_match:
        candidates.append(object_match.group(0))

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


def _parse_int_like(value: Any) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return int(round(float(value)))
    if isinstance(value, str):
        matches = re.findall(r"-?\d+(?:\.\d+)?", value)
        if not matches:
            return None
        try:
            return int(round(float(matches[0])))
        except ValueError:
            return None
    return None


def _parse_point_like(raw: Any) -> Optional[dict[str, int]]:
    if isinstance(raw, dict):
        x = _parse_int_like(raw.get("x"))
        y = _parse_int_like(raw.get("y"))
        if x is None or y is None:
            return None
        return {"x": x, "y": y}

    if isinstance(raw, (list, tuple)) and len(raw) >= 2:
        x = _parse_int_like(raw[0])
        y = _parse_int_like(raw[1])
        if x is None or y is None:
            return None
        return {"x": x, "y": y}

    if isinstance(raw, str):
        matches = re.findall(r"-?\d+(?:\.\d+)?", raw)
        if len(matches) < 2:
            return None
        try:
            return {
                "x": int(round(float(matches[0]))),
                "y": int(round(float(matches[1]))),
            }
        except ValueError:
            return None

    return None


def _coerce_point_from_tool_input(tool_input: dict[str, Any]) -> Optional[dict[str, int]]:
    for key in ("point", "coordinates", "coordinate", "position"):
        point = _parse_point_like(tool_input.get(key))
        if point:
            return point

    x_raw = tool_input.get("x")
    y_raw = tool_input.get("y")
    if isinstance(x_raw, str) and _parse_int_like(y_raw) is None:
        combined = _parse_point_like(x_raw)
        if combined:
            return combined

    x = _parse_int_like(x_raw)
    y = _parse_int_like(y_raw)
    if x is None or y is None:
        return None
    return {"x": x, "y": y}


def _normalize_bbox(raw: Any) -> Optional[dict[str, int]]:
    if not isinstance(raw, dict):
        return None
    x = _parse_int_like(raw.get("x"))
    y = _parse_int_like(raw.get("y"))
    width = _parse_int_like(raw.get("width"))
    height = _parse_int_like(raw.get("height"))
    if x is None or y is None or width is None or height is None:
        return None
    if width <= 0 or height <= 0:
        return None
    return {"x": x, "y": y, "width": width, "height": height}


def _compute_point_from_box(
    bbox: dict[str, int],
    x_ratio: Optional[float] = None,
    y_ratio: Optional[float] = None,
) -> dict[str, int]:
    safe_x_ratio = min(1.0, max(0.0, float(x_ratio if x_ratio is not None else 0.5)))
    safe_y_ratio = min(1.0, max(0.0, float(y_ratio if y_ratio is not None else 0.5)))
    x = int(round(bbox["x"] + bbox["width"] * safe_x_ratio))
    y = int(round(bbox["y"] + bbox["height"] * safe_y_ratio))
    x = min(max(x, bbox["x"]), bbox["x"] + bbox["width"] - 1)
    y = min(max(y, bbox["y"]), bbox["y"] + bbox["height"] - 1)
    return {"x": x, "y": y}


def _normalize_model_tool_calls(raw: object) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    parsed: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        fn = item.get("function")
        if not isinstance(fn, dict):
            continue
        name = str(fn.get("name") or "").strip()
        if not name:
            continue
        args_raw = fn.get("arguments")
        if isinstance(args_raw, dict):
            args = args_raw
        elif isinstance(args_raw, str):
            args = _loads_json(args_raw, {})
            if not isinstance(args, dict):
                args = {}
        else:
            args = {}
        parsed.append(
            {
                "id": str(item.get("id") or uuid.uuid4()),
                "function": {"name": name, "arguments": args},
            }
        )
    return parsed


def _try_parse_embedded_tool_calls(raw_text: str) -> list[dict[str, Any]]:
    text = (raw_text or "").strip()
    if not text:
        return []
    candidates = [text]
    if text.startswith("```") and text.endswith("```"):
        lines = text.splitlines()
        if len(lines) >= 3:
            candidates.append("\n".join(lines[1:-1]).strip())
    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        payload = parsed if isinstance(parsed, list) else [parsed]
        tool_calls: list[dict[str, Any]] = []
        for item in payload:
            if not isinstance(item, dict):
                continue
            if isinstance(item.get("function"), dict):
                tool_calls.extend(_normalize_model_tool_calls([item]))
                continue
            name = str(item.get("name") or item.get("tool") or "").strip()
            if not name:
                continue
            parameters = item.get("parameters") or item.get("arguments") or {}
            if not isinstance(parameters, dict):
                parameters = {}
            tool_calls.append(
                {
                    "id": str(item.get("id") or uuid.uuid4()),
                    "function": {"name": name, "arguments": parameters},
                }
            )
        if tool_calls:
            return tool_calls
    return []


def _tool_to_event_type(tool_name: str) -> str:
    if tool_name.startswith("fs_"):
        return "filesystem"
    if tool_name.startswith("terminal"):
        return "terminal"
    return "computer"


def _computer_use_root() -> Path:
    raw = os.getenv("MODELFORGE_COMPUTER_USE_DIR", "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    return (PROJECT_ROOT / "data" / "computer-use").resolve()


def _resolve_path(raw_path: str, cwd: str) -> str:
    candidate = Path(raw_path).expanduser()
    if not candidate.is_absolute():
        candidate = Path(cwd).expanduser() / candidate
    return str(candidate.resolve())


def _is_within(path: str, allowed_paths: list[str]) -> bool:
    target = Path(path).resolve()
    for allowed in allowed_paths:
        try:
            if target.is_relative_to(Path(allowed).resolve()):
                return True
        except Exception:
            continue
    return False


def _default_cwd() -> str:
    return str((Path.home() / "Desktop").resolve())


def _default_allowed_paths(cwd: str) -> list[str]:
    candidates = [
        Path(cwd).expanduser(),
        Path.home() / "Desktop",
        Path.home() / "Downloads",
    ]
    normalized: list[str] = []
    seen: set[str] = set()
    for item in candidates:
        path = str(item.resolve())
        if path in seen:
            continue
        seen.add(path)
        normalized.append(path)
    return normalized


def _normalize_approval_mode(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in APPROVAL_MODES:
        return normalized
    return DEFAULT_APPROVAL_MODE


def _is_hands_free_mode(value: Any) -> bool:
    return _normalize_approval_mode(value) == APPROVAL_MODE_HANDS_FREE


def _is_terminal_session_status(status: Optional[str]) -> bool:
    return str(status or "").strip().lower() in TERMINAL_SESSION_STATUSES


def _format_session_status_label(status: Any) -> str:
    mapping = {
        "idle": "待开始",
        "running": "执行中",
        "waiting_approval": "等待确认",
        "paused": "已暂停",
        "completed": "已完成",
        "failed": "已失败",
        "cancelled": "已终止",
    }
    key = str(status or "").strip().lower()
    return mapping.get(key, key or "未知状态")


def _format_status_hud_tone(status: Any) -> str:
    key = str(status or "").strip().lower()
    if key in {"completed"}:
        return "success"
    if key in {"waiting_approval", "paused"}:
        return "warning"
    if key in {"failed", "cancelled"}:
        return "error"
    if key in {"running"}:
        return "running"
    return "neutral"


@dataclass
class ApprovalWaiter:
    approval_id: str
    action_id: str
    tool_name: str
    original_input: dict[str, Any]
    future: asyncio.Future


@dataclass
class RuntimeSession:
    subscribers: set[asyncio.Queue] = field(default_factory=set)
    pause_event: asyncio.Event = field(default_factory=asyncio.Event)
    task: Optional[asyncio.Task] = None
    cancel_requested: bool = False
    pending_approval: Optional[ApprovalWaiter] = None
    last_snapshot_coordinate_space: Optional[dict[str, Any]] = None

    def __post_init__(self) -> None:
        self.pause_event.set()


def _supports_native_video(official_caps: set[str] | None) -> bool:
    normalized = {str(cap).strip().lower() for cap in (official_caps or set()) if cap}
    return bool(NATIVE_VIDEO_CAPS & normalized)


def _supports_direct_visual_route(official_caps: set[str] | None) -> bool:
    normalized = {str(cap).strip().lower() for cap in (official_caps or set()) if cap}
    return bool(DIRECT_VISUAL_CAPS & normalized)


class ComputerUseService:
    def __init__(self) -> None:
        self._runtime: dict[str, RuntimeSession] = {}
        self._active_session_id: Optional[str] = None
        self._active_lock = asyncio.Lock()
        self._ocr_model_cache: tuple[float, list[dict[str, Any]]] | None = None
        self._ocr_model_cache_ttl_seconds = 60

    async def _list_installed_ocr_models(self) -> list[dict[str, Any]]:
        cached = self._ocr_model_cache
        if cached and (_now() - cached[0]) < self._ocr_model_cache_ttl_seconds:
            return cached[1]

        try:
            models = await ollama_service.list_models()
        except Exception:
            models = []

        semaphore = asyncio.Semaphore(6)

        async def _inspect(model: dict[str, Any]) -> Optional[dict[str, Any]]:
            name = str(model.get("name") or "").strip()
            if not name:
                return None
            details = model.get("details") if isinstance(model.get("details"), dict) else {}
            async with semaphore:
                official_caps = await ollama_service.get_model_capabilities(name)

            supports_vision = ModelCapabilityService.supports_vision(
                name,
                details,
                official_caps=official_caps,
            )
            supports_video = _supports_native_video(official_caps)
            supports_ocr = ModelCapabilityService.supports_ocr(
                name,
                details,
                official_caps=official_caps,
            )
            if not supports_ocr:
                return None

            name_lower = name.lower()
            family_lower = str(details.get("family") or "").lower()
            dedicated = "ocr" in name_lower or "ocr" in family_lower
            return {
                "name": name,
                "supports_ocr": supports_ocr,
                "supports_video": supports_video,
                "supports_vision": supports_vision,
                "supports_tools": "tools" in official_caps,
                "dedicated": dedicated,
                "size": model.get("size"),
            }

        inspected = await asyncio.gather(
            *[_inspect(model) for model in models],
            return_exceptions=True,
        )
        candidates = [item for item in inspected if isinstance(item, dict)]
        candidates.sort(
            key=lambda item: (
                0 if item.get("dedicated") else 1,
                0 if item.get("supports_tools") else 1,
                0 if item.get("supports_video") else 1,
                0 if item.get("supports_vision") else 1,
                str(item.get("name") or "").lower(),
            )
        )
        self._ocr_model_cache = (_now(), candidates)
        return candidates

    async def _preferred_ocr_model(self) -> Optional[dict[str, Any]]:
        models = await self._list_installed_ocr_models()
        return models[0] if models else None

    async def _ocr_text_with_ollama(self, file_path: Path, model_name: str) -> str:
        if not file_path.exists() or not file_path.is_file():
            return ""
        try:
            thinking_supported = await ollama_service.supports_thinking(model_name)
            image_b64 = base64.b64encode(file_path.read_bytes()).decode("ascii")
            response = await ollama_service.chat_once(
                model=model_name,
                messages=[
                    {
                        "role": "user",
                        "content": OCR_EXTRACTION_PROMPT,
                        "images": [image_b64],
                    }
                ],
                options={"temperature": 0},
                think=False if thinking_supported else None,
                keep_alive="10m",
            )
        except Exception:
            return ""

        message = response.get("message") if isinstance(response, dict) else None
        if not isinstance(message, dict):
            return ""
        content = _normalize_snapshot_markdown(str(message.get("content") or "").strip())
        return _truncate(content, 12000)

    async def _native_snapshot_with_model(self, file_path: Path, model_name: str) -> str:
        if not file_path.exists() or not file_path.is_file():
            return ""
        try:
            thinking_supported = await ollama_service.supports_thinking(model_name)
            image_b64 = base64.b64encode(file_path.read_bytes()).decode("ascii")
            response = await ollama_service.chat_once(
                model=model_name,
                messages=[
                    {
                        "role": "user",
                        "content": NATIVE_VIDEO_SNAPSHOT_PROMPT,
                        "images": [image_b64],
                    }
                ],
                options={"temperature": 0},
                think=False if thinking_supported else None,
                keep_alive="10m",
            )
        except Exception:
            return ""

        message = response.get("message") if isinstance(response, dict) else None
        if not isinstance(message, dict):
            return ""
        content = str(message.get("content") or "").strip()
        return _truncate(content, 12000)

    async def _locator_strategy(self, session_model: str) -> Optional[dict[str, str]]:
        session_caps = await ollama_service.get_model_capabilities(session_model)
        if _supports_direct_visual_route(session_caps):
            return {"model_name": session_model, "route": "visual"}
        preferred_ocr_model = await self._preferred_ocr_model()
        if preferred_ocr_model and preferred_ocr_model.get("name"):
            return {"model_name": str(preferred_ocr_model["name"]), "route": "ocr"}
        return None

    async def _locate_target_with_model(self, file_path: Path, model_name: str, target: str) -> dict[str, Any]:
        if not file_path.exists() or not file_path.is_file():
            return {"ok": False, "error": "Screenshot is unavailable for target location"}
        format_schema = {
            "type": "object",
            "properties": {
                "found": {"type": "boolean"},
                "target": {"type": "string"},
                "bbox": {
                    "type": "object",
                    "properties": {
                        "x": {"type": "number"},
                        "y": {"type": "number"},
                        "width": {"type": "number"},
                        "height": {"type": "number"},
                    },
                    "required": ["x", "y", "width", "height"],
                },
                "point": {
                    "type": "object",
                    "properties": {
                        "x": {"type": "number"},
                        "y": {"type": "number"},
                    },
                    "required": ["x", "y"],
                },
                "confidence": {"type": "number"},
                "reason": {"type": "string"},
            },
            "required": ["found", "target", "reason"],
        }
        try:
            thinking_supported = await ollama_service.supports_thinking(model_name)
            image_b64 = base64.b64encode(file_path.read_bytes()).decode("ascii")
            messages = [
                {
                    "role": "user",
                    "content": f"{VISION_LOCATE_TARGET_PROMPT}\n\nTarget: {target}",
                    "images": [image_b64],
                }
            ]
            try:
                response = await ollama_service.chat_once(
                    model=model_name,
                    messages=messages,
                    options={"temperature": 0},
                    think=False if thinking_supported else None,
                    keep_alive="10m",
                    format=format_schema,
                )
            except Exception:
                response = await ollama_service.chat_once(
                    model=model_name,
                    messages=messages,
                    options={"temperature": 0},
                    think=False if thinking_supported else None,
                    keep_alive="10m",
                )
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

        message = response.get("message") if isinstance(response, dict) else None
        if not isinstance(message, dict):
            return {"ok": False, "error": "Target locator returned an invalid response"}

        content = str(message.get("content") or "")
        parsed = _extract_json_candidate(content)
        if not isinstance(parsed, dict) and content.strip():
            try:
                repair = await ollama_service.chat_once(
                    model=model_name,
                    messages=[
                        {
                            "role": "system",
                            "content": (
                                "Convert the previous locator output into valid JSON only. "
                                "Keep the same schema and do not add explanation."
                            ),
                        },
                        {
                            "role": "user",
                            "content": f"Target: {target}\n\nPrevious output:\n{content}",
                        },
                    ],
                    options={"temperature": 0},
                    format=format_schema,
                    keep_alive="10m",
                )
                repair_message = repair.get("message") if isinstance(repair, dict) else None
                if isinstance(repair_message, dict):
                    parsed = _extract_json_candidate(str(repair_message.get("content") or ""))
            except Exception:
                parsed = parsed
        if not isinstance(parsed, dict):
            return {"ok": False, "error": "Target locator did not return JSON"}

        found = bool(parsed.get("found"))
        bbox = _normalize_bbox(parsed.get("bbox"))
        point = _parse_point_like(parsed.get("point"))
        if bbox and point is None:
            point = _compute_point_from_box(bbox)

        return {
            "ok": found and bbox is not None and point is not None,
            "found": found,
            "target": str(parsed.get("target") or target).strip() or target,
            "bbox": bbox,
            "point": point,
            "confidence": parsed.get("confidence"),
            "reason": str(parsed.get("reason") or "").strip() or None,
            "locator_model": model_name,
            "raw": parsed,
            "error": None if (found and bbox and point) else str(parsed.get("reason") or "Target not found"),
        }

    async def _capture_snapshot_artifact(
        self,
        session: dict[str, Any],
        runtime: Optional[RuntimeSession] = None,
    ) -> tuple[dict[str, Any], Optional[Path]]:
        artifact_dir = _computer_use_root() / session["id"] / "artifacts"
        artifact_dir.mkdir(parents=True, exist_ok=True)
        file_path = artifact_dir / f"{uuid.uuid4()}.png"
        result = await computer_helper_client.snapshot(str(file_path), include_ocr=True)
        if not result.get("ok") or not file_path.exists():
            return result, None
        if runtime is not None:
            coordinate_space = result.get("coordinate_space")
            runtime.last_snapshot_coordinate_space = coordinate_space if isinstance(coordinate_space, dict) else None

        helper_ocr_text = str(result.get("ocr_text") or "").strip()
        observation_text = ""

        # If local OCR already provides rich text (>= 120 chars), skip expensive
        # Ollama OCR passes on local hardware. Native video-capable models still
        # use their own direct perception route and do not respect this shortcut.
        _ocr_rich_threshold = int(os.getenv("MODELFORGE_COMPUTER_USE_OCR_RICH_THRESHOLD", "120"))
        _ocr_is_rich = len(helper_ocr_text) >= _ocr_rich_threshold

        session_caps = await ollama_service.get_model_capabilities(session["model"])
        if _supports_direct_visual_route(session_caps):
            native_text = await self._native_snapshot_with_model(file_path, session["model"])
            if native_text:
                observation_text = native_text
                result["perception_route"] = "visual"
                result["video_model"] = session["model"]
                result["visual_model"] = session["model"]
                result["perception_model"] = session["model"]
                result["live_native"] = True

        if not observation_text:
            ocr_text = helper_ocr_text
            preferred_ocr_model = await self._preferred_ocr_model()
            if preferred_ocr_model and not _ocr_is_rich:
                ollama_ocr_text = await self._ocr_text_with_ollama(file_path, str(preferred_ocr_model["name"]))
                if ollama_ocr_text:
                    ocr_text = ollama_ocr_text
                    result["ocr_source"] = "ollama"
                    result["ocr_model"] = preferred_ocr_model["name"]
                    result["perception_model"] = preferred_ocr_model["name"]
                elif ocr_text:
                    result["ocr_source"] = "local"
                    result["perception_model"] = RECOMMENDED_LOCAL_OCR_NAME
            elif ocr_text:
                result["ocr_source"] = "local"
                result["perception_model"] = RECOMMENDED_LOCAL_OCR_NAME
            observation_text = ocr_text
            if observation_text:
                result["perception_route"] = "ocr"

        result["ocr_text"] = helper_ocr_text
        result["observation_text"] = observation_text
        summary = _truncate(observation_text.strip() or str(result.get("summary") or "Screenshot captured"), 800)
        artifact_id = await self._save_artifact(session["id"], "screenshot", str(file_path), summary)
        result["artifact_id"] = artifact_id
        result["artifact_url"] = f"/api/computer-use/sessions/{session['id']}/artifacts/{artifact_id}"
        return result, file_path

    async def mark_stale_sessions_failed(self) -> None:
        await execute_update(
            """
            UPDATE computer_use_sessions
            SET status = ?, error = ?, completed_at = ?, updated_at = ?
            WHERE status IN ('running', 'waiting_approval', 'paused')
            """,
            ("failed", "Session interrupted by backend restart", _now(), _now()),
        )

    def _runtime_for(self, session_id: str) -> RuntimeSession:
        runtime = self._runtime.get(session_id)
        if runtime is None:
            runtime = RuntimeSession()
            self._runtime[session_id] = runtime
        return runtime

    async def get_status(self) -> dict[str, Any]:
        helper_health = await computer_helper_client.health()
        desktop_mode = computer_helper_client.configured
        local_ocr = helper_health.get("ocr") if isinstance(helper_health, dict) else None
        if not isinstance(local_ocr, dict):
            local_ocr = {
                "available": False,
                "recommended": RECOMMENDED_LOCAL_OCR_NAME,
                "install_hint": RECOMMENDED_LOCAL_OCR_INSTALL_HINT,
            }
        installed_ocr_models = await self._list_installed_ocr_models()
        preferred_ocr_model = installed_ocr_models[0] if installed_ocr_models else None
        local_ocr_available = bool(local_ocr.get("available"))
        ollama_ocr_available = preferred_ocr_model is not None
        if ollama_ocr_available:
            selected_source = "ollama"
            recommended_name = str(preferred_ocr_model.get("name") or RECOMMENDED_OCR_MODEL)
            recommended_install_hint = ""
        elif local_ocr_available:
            selected_source = "local"
            recommended_name = str(local_ocr.get("recommended") or RECOMMENDED_LOCAL_OCR_NAME)
            recommended_install_hint = str(local_ocr.get("install_hint") or RECOMMENDED_LOCAL_OCR_INSTALL_HINT)
        else:
            selected_source = "none"
            recommended_name = RECOMMENDED_OCR_MODEL
            recommended_install_hint = f"ollama pull {RECOMMENDED_OCR_MODEL}"

        ocr = {
            "available": bool(local_ocr_available or ollama_ocr_available),
            "source": selected_source,
            "local_engine_available": local_ocr_available,
            "local_engine_name": str(local_ocr.get("recommended") or RECOMMENDED_LOCAL_OCR_NAME),
            "installed_model_available": ollama_ocr_available,
            "installed_models": [str(item.get("name") or "") for item in installed_ocr_models if item.get("name")],
            "selected_model": str(preferred_ocr_model.get("name") or "") if preferred_ocr_model else None,
            "recommended": recommended_name,
            "install_hint": recommended_install_hint,
            "fallback_install_hint": str(local_ocr.get("install_hint") or RECOMMENDED_LOCAL_OCR_INSTALL_HINT),
        }
        return {
            "desktop_mode": desktop_mode,
            "desktop_available": desktop_mode and bool(helper_health.get("desktop_available")),
            "snapshot_available": desktop_mode and bool(helper_health.get("snapshot_available")),
            "controlled_browser_available": desktop_mode and bool(helper_health.get("controlled_browser_available", True)),
            "helper": helper_health,
            "ocr": ocr,
            "recommended_ocr": {
                "name": recommended_name,
                "install_hint": recommended_install_hint,
                "fallback_name": str(local_ocr.get("recommended") or RECOMMENDED_LOCAL_OCR_NAME),
                "fallback_install_hint": str(local_ocr.get("install_hint") or RECOMMENDED_LOCAL_OCR_INSTALL_HINT),
            },
            "default_cwd": _default_cwd(),
            "default_allowed_paths": _default_allowed_paths(_default_cwd()),
        }

    async def _validate_session_request(
        self,
        model: str,
        *,
        helper_status: Optional[dict[str, Any]] = None,
    ) -> set[str]:
        normalized_model = str(model or "").strip()
        if not normalized_model:
            raise RuntimeError("Model is required")

        status_payload = helper_status if isinstance(helper_status, dict) else await self.get_status()
        if not status_payload.get("desktop_available") and not status_payload.get("controlled_browser_available"):
            raise RuntimeError("Computer helper is unavailable; desktop automation or controlled browser mode is required")

        official_caps = await ollama_service.get_model_capabilities(normalized_model)
        if "tools" not in official_caps:
            raise RuntimeError("Selected model does not declare tools capability in Ollama")
        has_perception_fallback = bool(status_payload.get("ocr", {}).get("available"))
        has_browser_observation = bool(status_payload.get("controlled_browser_available"))
        if not _supports_direct_visual_route(official_caps) and not has_perception_fallback and not has_browser_observation:
            raise RuntimeError(
                "Selected model does not declare a usable direct visual capability, and no OCR fallback or controlled browser observation is available. "
                f"Install an Ollama OCR model (recommended: {RECOMMENDED_OCR_MODEL}), install Tesseract OCR, "
                "or run inside the desktop app with controlled browser support."
            )
        return official_caps

    async def create_session(
        self,
        model: str,
        goal: str,
        approval_mode: Optional[str] = None,
        parent_session_id: Optional[str] = None,
        cwd: Optional[str] = None,
        allowed_paths: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        model_name = str(model or "").strip()
        goal_text = str(goal or "").strip()
        if not goal_text:
            raise RuntimeError("Goal is required")
        await self._validate_session_request(model_name)

        session_id = str(uuid.uuid4())
        base_cwd = _resolve_path(cwd or _default_cwd(), _default_cwd())
        normalized_allowed = _default_allowed_paths(base_cwd)
        for item in allowed_paths or []:
            resolved = _resolve_path(item, base_cwd)
            if resolved not in normalized_allowed:
                normalized_allowed.append(resolved)
        now = _now()
        normalized_approval_mode = _normalize_approval_mode(approval_mode)
        await execute_insert(
            """
            INSERT INTO computer_use_sessions
            (id, model, goal, approval_mode, parent_session_id, cwd, allowed_paths, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                session_id,
                model_name,
                goal_text,
                normalized_approval_mode,
                str(parent_session_id or "").strip() or None,
                base_cwd,
                _dumps_json(normalized_allowed),
                "idle",
                now,
                now,
            ),
        )
        return await self.get_session(session_id)

    async def _session_row(self, session_id: str) -> dict[str, Any]:
        rows = await execute_query(
            "SELECT * FROM computer_use_sessions WHERE id = ?",
            (session_id,),
        )
        if not rows:
            raise ValueError("Computer use session not found")
        return rows[0]

    async def get_session(self, session_id: str) -> dict[str, Any]:
        session = await self._session_row(session_id)
        actions = await execute_query(
            "SELECT * FROM computer_use_actions WHERE session_id = ? ORDER BY created_at ASC",
            (session_id,),
        )
        approvals = await execute_query(
            "SELECT * FROM computer_use_approvals WHERE session_id = ? ORDER BY created_at ASC",
            (session_id,),
        )
        artifacts = await execute_query(
            "SELECT * FROM computer_use_artifacts WHERE session_id = ? ORDER BY created_at DESC",
            (session_id,),
        )

        latest_artifact_id = session.get("latest_artifact_id")
        return {
            "id": session["id"],
            "model": session["model"],
            "goal": session["goal"],
            "approval_mode": _normalize_approval_mode(session.get("approval_mode")),
            "parent_session_id": session.get("parent_session_id"),
            "cwd": session["cwd"],
            "allowed_paths": _loads_json(session.get("allowed_paths"), []),
            "status": session["status"],
            "latest_artifact_id": latest_artifact_id,
            "latest_artifact_url": (
                f"/api/computer-use/sessions/{session_id}/artifacts/{latest_artifact_id}"
                if latest_artifact_id
                else None
            ),
            "latest_screen_summary": session.get("latest_screen_summary"),
            "thinking_text": session.get("thinking_text") or "",
            "assistant_text": session.get("assistant_text") or "",
            "error": session.get("error"),
            "created_at": session.get("created_at"),
            "updated_at": session.get("updated_at"),
            "started_at": session.get("started_at"),
            "completed_at": session.get("completed_at"),
            "actions": [
                {
                    "id": action["id"],
                    "tool_name": action["tool_name"],
                    "risk_level": action["risk_level"],
                    "input_payload": _loads_json(action.get("input_payload"), {}),
                    "output_payload": _loads_json(action.get("output_payload"), {}),
                    "status": action["status"],
                    "requires_approval": bool(action.get("requires_approval")),
                    "error": action.get("error"),
                    "created_at": action.get("created_at"),
                    "updated_at": action.get("updated_at"),
                }
                for action in actions
            ],
            "approvals": [
                {
                    "id": approval["id"],
                    "action_id": approval["action_id"],
                    "tool_name": approval["tool_name"],
                    "status": approval["status"],
                    "reason": approval.get("reason"),
                    "edited_input": _loads_json(approval.get("edited_input"), None),
                    "created_at": approval.get("created_at"),
                    "resolved_at": approval.get("resolved_at"),
                }
                for approval in approvals
            ],
            "artifacts": [
                {
                    "id": artifact["id"],
                    "kind": artifact["kind"],
                    "mime_type": artifact["mime_type"],
                    "summary": artifact.get("summary"),
                    "created_at": artifact.get("created_at"),
                    "url": f"/api/computer-use/sessions/{session_id}/artifacts/{artifact['id']}",
                }
                for artifact in artifacts
            ],
        }

    async def list_sessions(self, limit: int = 100) -> list[dict[str, Any]]:
        rows = await execute_query(
            """
            SELECT id, model, goal, approval_mode, parent_session_id, status, latest_artifact_id, error,
                   created_at, updated_at, started_at, completed_at
            FROM computer_use_sessions
            ORDER BY updated_at DESC
            LIMIT ?
            """,
            (limit,),
        )
        items: list[dict[str, Any]] = []
        for row in rows:
            latest_artifact_id = row.get("latest_artifact_id")
            items.append(
                {
                    "id": row["id"],
                    "model": row["model"],
                    "goal": row["goal"],
                    "approval_mode": _normalize_approval_mode(row.get("approval_mode")),
                    "parent_session_id": row.get("parent_session_id"),
                    "status": row["status"],
                    "error": row.get("error"),
                    "latest_artifact_id": latest_artifact_id,
                    "latest_artifact_url": (
                        f"/api/computer-use/sessions/{row['id']}/artifacts/{latest_artifact_id}"
                        if latest_artifact_id
                        else None
                    ),
                    "created_at": row.get("created_at"),
                    "updated_at": row.get("updated_at"),
                    "started_at": row.get("started_at"),
                    "completed_at": row.get("completed_at"),
                }
            )
        return items

    async def delete_all_sessions(self) -> dict[str, Any]:
        rows = await execute_query(
            """
            SELECT id, status
            FROM computer_use_sessions
            """
        )
        session_ids = [str(row.get("id") or "").strip() for row in rows if str(row.get("id") or "").strip()]
        active_session_ids = [
            session_id for session_id, row in (
                (str(row.get("id") or "").strip(), row) for row in rows
            )
            if session_id and not _is_terminal_session_status(str(row.get("status") or "").strip().lower())
        ]

        tasks_to_wait: list[asyncio.Task] = []
        for session_id in active_session_ids:
            runtime = self._runtime.get(session_id)
            if not runtime:
                continue
            runtime.cancel_requested = True
            runtime.pause_event.set()
            if runtime.pending_approval and not runtime.pending_approval.future.done():
                runtime.pending_approval.future.set_result(
                    {"decision": "reject", "reason": "History cleared by user"}
                )
            if runtime.task and not runtime.task.done():
                runtime.task.cancel()
                tasks_to_wait.append(runtime.task)

        if tasks_to_wait:
            await asyncio.gather(*tasks_to_wait, return_exceptions=True)

        if session_ids:
            if self._active_session_id in session_ids:
                self._active_session_id = None
            for session_id in session_ids:
                self._runtime.pop(session_id, None)
            try:
                await computer_helper_client.hide_status_hud()
                await computer_helper_client.show_main_window(focus=True)
            except Exception:
                pass
            await execute_update("DELETE FROM computer_use_sessions")

        return {"message": "All computer use sessions deleted", "deleted_count": len(session_ids)}

    async def _build_parent_context_messages(self, parent_session_id: Optional[str]) -> list[dict[str, Any]]:
        current_parent = str(parent_session_id or "").strip()
        if not current_parent:
            return []

        context_lines: list[str] = []
        seen: set[str] = set()
        hops = 0
        while current_parent and current_parent not in seen and hops < 4:
            seen.add(current_parent)
            try:
                row = await self._session_row(current_parent)
            except Exception:
                break
            goal = str(row.get("goal") or "").strip()
            status = _format_session_status_label(row.get("status"))
            summary = _truncate(str(row.get("assistant_text") or "").strip(), 600)
            screen = _truncate(str(row.get("latest_screen_summary") or "").strip(), 240)
            context_lines.append(f"任务: {goal or '未命名任务'}")
            context_lines.append(f"状态: {status}")
            if summary:
                context_lines.append(f"结果摘要: {summary}")
            elif screen:
                context_lines.append(f"最后观察: {screen}")
            context_lines.append("")
            current_parent = str(row.get("parent_session_id") or "").strip()
            hops += 1

        if not context_lines:
            return []

        return [
            {
                "role": "system",
                "content": (
                    "Below is the recent Computer Use task context in the same thread. "
                    "Use it to preserve continuity, avoid repeating completed work, and continue from prior outcomes.\n\n"
                    + "\n".join(context_lines).strip()
                ),
            }
        ]

    async def get_artifact_file(self, session_id: str, artifact_id: str) -> tuple[str, str]:
        rows = await execute_query(
            """
            SELECT file_path, mime_type
            FROM computer_use_artifacts
            WHERE session_id = ? AND id = ?
            """,
            (session_id, artifact_id),
        )
        if not rows:
            raise ValueError("Artifact not found")
        row = rows[0]
        return row["file_path"], row["mime_type"]

    async def subscribe(self, session_id: str) -> AsyncGenerator[dict[str, Any], None]:
        runtime = self._runtime_for(session_id)
        queue: asyncio.Queue = asyncio.Queue()
        runtime.subscribers.add(queue)
        try:
            yield {"type": "session_state", "session": await self.get_session(session_id)}
            while True:
                event = await queue.get()
                yield event
                if event.get("type") == "done":
                    break
        finally:
            runtime.subscribers.discard(queue)

    async def _emit(self, session_id: str, payload: dict[str, Any]) -> None:
        runtime = self._runtime_for(session_id)
        for queue in list(runtime.subscribers):
            await queue.put(payload)

    async def _set_session_status(
        self,
        session_id: str,
        status: str,
        *,
        error: Optional[str] = None,
        started: bool = False,
        completed: bool = False,
    ) -> None:
        now = _now()
        row = await self._session_row(session_id)
        started_at = row.get("started_at")
        completed_at = row.get("completed_at")
        if started and not started_at:
            started_at = now
        if completed:
            completed_at = now
        await execute_update(
            """
            UPDATE computer_use_sessions
            SET status = ?, error = ?, updated_at = ?, started_at = ?, completed_at = ?
            WHERE id = ?
            """,
            (status, error, now, started_at, completed_at, session_id),
        )
        await self._sync_main_window_visibility(row, status)
        await self._sync_status_hud(row, status)
        await self._emit(session_id, {"type": "session_state", "session": await self.get_session(session_id)})

    async def _sync_main_window_visibility(self, session_row: dict[str, Any], next_status: str) -> None:
        if not _is_hands_free_mode(session_row.get("approval_mode")):
            return
        try:
            if next_status == "running":
                await computer_helper_client.hide_main_window()
            elif next_status in {"waiting_approval", "paused", "completed", "failed", "cancelled"}:
                await computer_helper_client.show_main_window(focus=True)
        except Exception:
            return

    async def _sync_status_hud(
        self,
        session_row: dict[str, Any],
        next_status: str,
        *,
        detail: Optional[str] = None,
    ) -> None:
        if not _is_hands_free_mode(session_row.get("approval_mode")):
            await computer_helper_client.hide_status_hud()
            return
        if next_status == "idle" or next_status in TERMINAL_SESSION_STATUSES:
            await computer_helper_client.hide_status_hud()
            return
        full_session = await self.get_session(str(session_row["id"]))
        goal = _truncate(str(session_row.get("goal") or "").strip(), 92)
        error_text = _truncate(str(session_row.get("error") or "").strip(), 140)
        actions = full_session.get("actions") or []
        approvals = full_session.get("approvals") or []
        latest_action = actions[-1] if actions else None
        latest_output = latest_action.get("output_payload") if isinstance(latest_action, dict) else {}
        latest_result_text = _truncate(
            str(
                (latest_output or {}).get("summary")
                or (latest_output or {}).get("message")
                or (latest_output or {}).get("hint")
                or (latest_output or {}).get("reason")
                or (latest_output or {}).get("error")
                or ""
            ).strip(),
            140,
        )
        detail_text = detail or latest_result_text or error_text or goal or "正在处理当前任务"
        latest_tool = _truncate(str((latest_action or {}).get("tool_name") or "").strip(), 42)
        action_count = len(actions)
        pending_approval_count = sum(1 for item in approvals if item.get("status") == "pending")
        screen_summary = _truncate(str(full_session.get("latest_screen_summary") or "").strip(), 140)
        model_name = _truncate(str(session_row.get("model") or "").strip(), 36)
        route_name = str((latest_output or {}).get("perception_route") or (latest_output or {}).get("locator_route") or "").strip().lower()
        if not route_name and model_name:
            try:
                route_name = "visual" if _supports_direct_visual_route(await ollama_service.get_model_capabilities(str(session_row.get("model") or ""))) else "ocr"
            except Exception:
                route_name = ""
        route_label = {
            "visual": "视觉直连",
            "ocr": "OCR 感知",
        }.get(route_name, "待定")
        chip_secondary_parts = [route_label, f"动作 {action_count}"]
        if pending_approval_count:
            chip_secondary_parts.append(f"待确认 {pending_approval_count}")
        footer_text = screen_summary or latest_result_text or " · ".join(
            part for part in [model_name, f"状态 {_format_session_status_label(next_status)}"] if part
        )
        await computer_helper_client.show_status_hud(
            eyebrow="Computer Use",
            title=_format_session_status_label(next_status),
            detail=detail_text,
            subtitle=goal,
            chip_primary=latest_tool,
            chip_secondary=" · ".join(chip_secondary_parts),
            footer=footer_text,
            stats=[
                {"label": "模型", "value": model_name or "-"},
                {"label": "路线", "value": route_label},
                {"label": "步骤", "value": str(action_count)},
                {"label": "审批", "value": str(pending_approval_count)},
            ],
            tone=_format_status_hud_tone(next_status),
        )

    async def _append_text(self, session_id: str, field_name: str, delta: str) -> None:
        if not delta:
            return
        now = _now()
        await execute_update(
            f"""
            UPDATE computer_use_sessions
            SET {field_name} = COALESCE({field_name}, '') || ?, updated_at = ?
            WHERE id = ?
            """,
            (delta, now, session_id),
        )

    async def _append_assistant_message(self, session_id: str, markdown_text: str) -> None:
        if not markdown_text.strip():
            return
        prefix = "\n\n" if markdown_text[:2] != "\n\n" else ""
        payload = f"{prefix}{markdown_text.strip()}"
        await self._append_text(session_id, "assistant_text", payload)
        await self._emit(session_id, {"type": "assistant_delta", "delta": payload})

    async def start_session(self, session_id: str) -> dict[str, Any]:
        async with self._active_lock:
            if self._active_session_id and self._active_session_id != session_id:
                current = await self._session_row(self._active_session_id)
                if not _is_terminal_session_status(current.get("status")):
                    raise RuntimeError("Only one active computer use session is allowed")

            runtime = self._runtime_for(session_id)
            if runtime.task and not runtime.task.done():
                return await self.get_session(session_id)

            session_row = await self._session_row(session_id)
            status = str(session_row.get("status") or "").strip().lower()
            if status != "idle":
                raise RuntimeError(
                    "Only idle sessions can be started. Use resume for paused sessions, or create a new session."
                )
            helper_status = await self.get_status()
            await self._validate_session_request(str(session_row.get("model") or ""), helper_status=helper_status)

            runtime.cancel_requested = False
            runtime.pause_event.set()
            runtime.task = asyncio.create_task(self._run_session(session_id))
            self._active_session_id = session_id
        return await self.get_session(session_id)

    async def pause_session(self, session_id: str) -> dict[str, Any]:
        runtime = self._runtime_for(session_id)
        runtime.pause_event.clear()
        row = await self._session_row(session_id)
        if row["status"] != "waiting_approval":
            await self._set_session_status(session_id, "paused")
        return await self.get_session(session_id)

    async def resume_session(self, session_id: str) -> dict[str, Any]:
        runtime = self._runtime_for(session_id)
        runtime.pause_event.set()
        if runtime.pending_approval:
            await self._set_session_status(session_id, "waiting_approval")
        else:
            await self._set_session_status(session_id, "running")
        return await self.get_session(session_id)

    async def cancel_session(self, session_id: str) -> dict[str, Any]:
        runtime = self._runtime_for(session_id)
        runtime.cancel_requested = True
        runtime.pause_event.set()
        if runtime.pending_approval and not runtime.pending_approval.future.done():
            runtime.pending_approval.future.set_result(
                {"decision": "reject", "reason": "Cancelled by user"}
            )
        if runtime.task and not runtime.task.done():
            runtime.task.cancel()
        await self._set_session_status(session_id, "cancelled", completed=True)
        await self._emit(session_id, {"type": "done", "session": await self.get_session(session_id)})
        return await self.get_session(session_id)

    async def approve(self, session_id: str, approval_id: str, edited_input: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        runtime = self._runtime_for(session_id)
        pending = runtime.pending_approval
        if not pending or pending.approval_id != approval_id:
            raise ValueError("Pending approval not found")
        await execute_update(
            """
            UPDATE computer_use_approvals
            SET status = ?, edited_input = ?, resolved_at = ?
            WHERE id = ?
            """,
            ("approved", _dumps_json(edited_input) if edited_input is not None else None, _now(), approval_id),
        )
        await self._emit(
            session_id,
            {
                "type": "approval_resolved",
                "approval_id": approval_id,
                "status": "approved",
                "edited_input": edited_input,
            },
        )
        if not pending.future.done():
            pending.future.set_result(
                {"decision": "approve", "edited_input": edited_input or pending.original_input}
            )
        runtime.pending_approval = None
        await self._set_session_status(session_id, "running")
        return await self.get_session(session_id)

    async def reject(self, session_id: str, approval_id: str, reason: Optional[str] = None) -> dict[str, Any]:
        runtime = self._runtime_for(session_id)
        pending = runtime.pending_approval
        if not pending or pending.approval_id != approval_id:
            raise ValueError("Pending approval not found")
        await execute_update(
            """
            UPDATE computer_use_approvals
            SET status = ?, reason = ?, resolved_at = ?
            WHERE id = ?
            """,
            ("rejected", reason, _now(), approval_id),
        )
        await self._emit(
            session_id,
            {
                "type": "approval_resolved",
                "approval_id": approval_id,
                "status": "rejected",
                "reason": reason,
            },
        )
        if not pending.future.done():
            pending.future.set_result({"decision": "reject", "reason": reason or "Rejected by user"})
        runtime.pending_approval = None
        await self._set_session_status(session_id, "running")
        return await self.get_session(session_id)

    async def _chat_round(
        self,
        session_id: str,
        model: str,
        messages: list[dict[str, Any]],
        *,
        tools_enabled: bool,
        think_enabled: bool,
    ) -> tuple[str, str, list[dict[str, Any]], Optional[str]]:
        thinking_parts: list[str] = []
        content_parts: list[str] = []
        tool_calls: list[dict[str, Any]] = []
        async for chunk in ollama_service.chat(
            model,
            messages,
            options={"temperature": 0.2},
            think=True if think_enabled else None,
            tools=TOOL_SCHEMAS if tools_enabled else None,
        ):
            if "error" in chunk:
                return "", "".join(thinking_parts), [], str(chunk.get("error") or "Unknown model error")
            message = chunk.get("message") or {}
            thinking_delta = message.get("thinking") or ""
            content_delta = message.get("content") or ""
            tool_calls_delta = _normalize_model_tool_calls(message.get("tool_calls"))
            if thinking_delta:
                thinking_parts.append(thinking_delta)
                await self._append_text(session_id, "thinking_text", thinking_delta)
                await self._emit(session_id, {"type": "thinking_delta", "delta": thinking_delta})
            if content_delta:
                content_parts.append(content_delta)
            if tool_calls_delta:
                tool_calls = tool_calls_delta
            if chunk.get("done"):
                break

        raw_content = "".join(content_parts).strip()
        if tools_enabled and not tool_calls and raw_content:
            tool_calls = _try_parse_embedded_tool_calls(raw_content)

        if raw_content and not tool_calls:
            await self._append_text(session_id, "assistant_text", raw_content)
            await self._emit(session_id, {"type": "assistant_delta", "delta": raw_content})
        return raw_content, "".join(thinking_parts), tool_calls, None

    async def _save_action(
        self,
        session_id: str,
        tool_name: str,
        risk_level: str,
        input_payload: dict[str, Any],
        *,
        status: str,
        requires_approval: bool,
    ) -> str:
        action_id = str(uuid.uuid4())
        now = _now()
        await execute_insert(
            """
            INSERT INTO computer_use_actions
            (id, session_id, tool_name, risk_level, input_payload, status, requires_approval, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                action_id,
                session_id,
                tool_name,
                risk_level,
                _dumps_json(input_payload),
                status,
                1 if requires_approval else 0,
                now,
                now,
            ),
        )
        return action_id

    async def _finish_action(
        self,
        action_id: str,
        output_payload: dict[str, Any],
        *,
        status: str,
        error: Optional[str] = None,
    ) -> None:
        await execute_update(
            """
            UPDATE computer_use_actions
            SET output_payload = ?, status = ?, error = ?, updated_at = ?
            WHERE id = ?
            """,
            (_dumps_json(output_payload), status, error, _now(), action_id),
        )

    async def _create_approval(self, session_id: str, action_id: str, tool_name: str, reason: str) -> str:
        approval_id = str(uuid.uuid4())
        await execute_insert(
            """
            INSERT INTO computer_use_approvals
            (id, session_id, action_id, status, tool_name, reason, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (approval_id, session_id, action_id, "pending", tool_name, reason, _now()),
        )
        return approval_id

    async def _save_artifact(self, session_id: str, kind: str, file_path: str, summary: str) -> str:
        artifact_id = str(uuid.uuid4())
        await execute_insert(
            """
            INSERT INTO computer_use_artifacts
            (id, session_id, kind, file_path, mime_type, summary, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (artifact_id, session_id, kind, file_path, "image/png", summary, _now()),
        )
        await execute_update(
            """
            UPDATE computer_use_sessions
            SET latest_artifact_id = ?, latest_screen_summary = ?, updated_at = ?
            WHERE id = ?
            """,
            (artifact_id, summary, _now(), session_id),
        )
        return artifact_id

    async def _path_policy(
        self,
        session: dict[str, Any],
        tool_name: str,
        raw_path: str,
    ) -> tuple[str, bool, Optional[str], str]:
        resolved = _resolve_path(raw_path or ".", session["cwd"])
        allowed = session["allowed_paths"]
        within_allowed = _is_within(resolved, allowed)
        if tool_name in READ_ONLY_TOOLS:
            if within_allowed:
                return resolved, False, None, "low"
            return resolved, True, None, "medium"
        if tool_name in WRITE_TOOLS:
            if within_allowed:
                return resolved, True, None, "high"
            return resolved, True, "Write operations outside allowed paths are blocked in beta", "critical"
        return resolved, False, None, "medium"

    async def _helper_sensitive_context(self) -> dict[str, Any]:
        state = await computer_helper_client.query_state()
        if not isinstance(state, dict):
            return {}
        focused = state.get("focused")
        return focused if isinstance(focused, dict) else {}

    async def _accessibility_block_reason(self, tool_name: str) -> Optional[str]:
        if tool_name not in ACCESSIBILITY_REQUIRED_TOOLS:
            return None
        health = await computer_helper_client.health()
        if isinstance(health, dict) and health.get("desktop_available") is False:
            limitations = health.get("limitations")
            limitation_note = ""
            if isinstance(limitations, list):
                limitation_note = next(
                    (
                        str(item).strip()
                        for item in limitations
                        if isinstance(item, str) and str(item).strip()
                    ),
                    "",
                )
            if limitation_note:
                return limitation_note
            return "Desktop input control is unavailable on this platform right now"
        permissions = health.get("permissions") if isinstance(health, dict) else None
        if isinstance(permissions, dict) and permissions.get("accessibility") is False:
            return "Accessibility permission is required for this desktop action"
        if isinstance(health, dict) and health.get("ok") is False:
            helper_error = str(health.get("error") or "").strip()
            if helper_error:
                return helper_error
        return None

    async def _assess_risk(
        self,
        session: dict[str, Any],
        tool_name: str,
        tool_input: dict[str, Any],
    ) -> tuple[str, bool, Optional[str], Optional[str], dict[str, Any]]:
        metadata: dict[str, Any] = {}
        approval_mode = _normalize_approval_mode(session.get("approval_mode"))
        accessibility_block_reason = await self._accessibility_block_reason(tool_name)
        if accessibility_block_reason:
            return "high", False, accessibility_block_reason, None, metadata
        if tool_name in AUTO_TOOLS:
            return "low", False, None, None, metadata
        if tool_name in READ_ONLY_TOOLS or tool_name in WRITE_TOOLS:
            resolved, requires_approval, blocked_reason, risk_level = await self._path_policy(
                session,
                tool_name,
                str(tool_input.get("path") or ""),
            )
            tool_input["path"] = resolved
            if tool_name in WRITE_TOOLS and approval_mode == APPROVAL_MODE_HANDS_FREE and blocked_reason is None:
                return risk_level, False, None, None, metadata
            reason = None if not requires_approval else "Path is outside default read scope" if tool_name in READ_ONLY_TOOLS and blocked_reason is None else "This file change requires approval"
            return risk_level, requires_approval, blocked_reason, reason, metadata
        if tool_name == "computer_type":
            metadata = await self._helper_sensitive_context()
            text = str(tool_input.get("text") or "")
            meta_text = " ".join(
                str(metadata.get(key) or "")
                for key in ("role", "title", "description", "placeholder", "value")
            ).lower()
            if any(hint in meta_text for hint in SECRET_HINTS):
                return "critical", True, None, "Focused field looks sensitive", metadata
            if len(text) >= 24 and any(char.isdigit() for char in text) and any(not char.isalnum() for char in text):
                return "critical", True, None, "Typed text looks like a secret or token", metadata
            if approval_mode == APPROVAL_MODE_HANDS_FREE:
                return "high", False, None, None, metadata
            return "high", True, None, "Typing requires approval", metadata
        if tool_name == "browser_type":
            text = str(tool_input.get("text") or "")
            if len(text) >= 24 and any(char.isdigit() for char in text) and any(not char.isalnum() for char in text):
                return "critical", True, None, "Typed text looks like a secret or token", metadata
            if approval_mode == APPROVAL_MODE_HANDS_FREE:
                return "high", False, None, None, metadata
            return "high", True, None, "Browser typing requires approval", metadata
        if tool_name == "terminal_exec":
            command = str(tool_input.get("command") or "").strip()
            if not command:
                return "high", True, "Command is empty", "Terminal command requires approval", metadata
            metadata["safe_command"] = _is_safe_terminal_command(command)
            if approval_mode == APPROVAL_MODE_HANDS_FREE and metadata["safe_command"]:
                return "medium", False, None, None, metadata
            return "high", True, None, "Terminal command requires approval", metadata
        if tool_name in HIGH_RISK_TOOLS:
            if approval_mode == APPROVAL_MODE_HANDS_FREE and tool_name in HANDS_FREE_AUTO_APPROVED_TOOLS:
                return "high", False, None, None, metadata
            return "high", True, None, "Desktop action requires approval", metadata
        return "medium", True, None, "Action requires approval", metadata

    async def _perform_terminal(self, session: dict[str, Any], tool_input: dict[str, Any]) -> dict[str, Any]:
        command = str(tool_input.get("command") or "").strip()
        if not command:
            return {"ok": False, "error": "Empty command"}
        cwd = session["cwd"]
        if not _is_within(cwd, session["allowed_paths"]):
            return {"ok": False, "error": "Working directory is outside allowed paths"}

        process = await asyncio.create_subprocess_shell(
            command,
            cwd=cwd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=20)
        except asyncio.TimeoutError:
            process.kill()
            await process.communicate()
            return {"ok": False, "error": "Command timed out after 20 seconds"}

        stdout_text = _truncate(stdout.decode("utf-8", errors="replace"), 4000)
        stderr_text = _truncate(stderr.decode("utf-8", errors="replace"), 4000)
        return {
            "ok": process.returncode == 0,
            "returncode": process.returncode,
            "stdout": stdout_text,
            "stderr": stderr_text,
        }

    async def _perform_fs_list(self, path: str) -> dict[str, Any]:
        target = Path(path)
        if not target.exists():
            return {"ok": False, "error": "Path does not exist"}
        entries = []
        for child in sorted(target.iterdir(), key=lambda item: item.name.lower())[:200]:
            entries.append(
                {
                    "name": child.name,
                    "path": str(child),
                    "is_dir": child.is_dir(),
                    "size": child.stat().st_size if child.is_file() else None,
                }
            )
        return {"ok": True, "path": str(target), "entries": entries}

    async def _perform_fs_read(self, path: str) -> dict[str, Any]:
        target = Path(path)
        if not target.exists() or not target.is_file():
            return {"ok": False, "error": "File does not exist"}
        content = target.read_text(encoding="utf-8", errors="replace")
        return {"ok": True, "path": str(target), "content": _truncate(content, 12000)}

    async def _perform_fs_write(self, path: str, content: str) -> dict[str, Any]:
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return {"ok": True, "path": str(target), "bytes_written": len(content.encode("utf-8"))}

    def _should_retry_tool_result(self, tool_name: str, result: dict[str, Any], attempt: int) -> bool:
        if tool_name not in RETRYABLE_TOOLS or attempt >= MAX_TOOL_RETRIES:
            return False
        if result.get("ok") is True:
            return False
        if result.get("rejected") or result.get("sensitive"):
            return False
        error_text = str(result.get("error") or "").strip().lower()
        unretryable_markers = (
            "user takeover",
            "sensitive",
            "password",
            "captcha",
            "not open",
            "unsupported tool",
            "a valid bounding box is required",
            "target is required",
            "url is required",
        )
        return not any(marker in error_text for marker in unretryable_markers)

    async def _perform_tool_with_retries(
        self,
        session: dict[str, Any],
        tool_name: str,
        tool_input: dict[str, Any],
        runtime: Optional[RuntimeSession] = None,
    ) -> dict[str, Any]:
        attempt = 0
        last_result: dict[str, Any] = {"ok": False, "error": "Tool did not run"}
        while attempt <= MAX_TOOL_RETRIES:
            result = await self._perform_tool(session, tool_name, tool_input, runtime=runtime)
            if not isinstance(result, dict):
                result = {"ok": False, "error": "Tool returned an invalid response"}
            if result.get("ok") is True:
                if attempt > 0:
                    result["retry_count"] = attempt
                return result
            last_result = result
            if not self._should_retry_tool_result(tool_name, result, attempt):
                break
            attempt += 1
            await asyncio.sleep(0.35 * attempt)
        if attempt > 0:
            last_result["retry_count"] = attempt
        last_result.setdefault("recoverable", True)
        return last_result

    async def _perform_tool(
        self,
        session: dict[str, Any],
        tool_name: str,
        tool_input: dict[str, Any],
        runtime: Optional[RuntimeSession] = None,
    ) -> dict[str, Any]:
        if tool_name == "computer_snapshot":
            result, _ = await self._capture_snapshot_artifact(session, runtime=runtime)
            return result
        if tool_name == "computer_query_state":
            return await computer_helper_client.query_state()
        if tool_name == "computer_click":
            point = _coerce_point_from_tool_input(tool_input)
            if not point:
                return {"ok": False, "error": "A valid point is required"}
            coordinate_space = runtime.last_snapshot_coordinate_space if runtime is not None else None
            return await computer_helper_client.click(
                point["x"],
                point["y"],
                coordinate_space=coordinate_space,
            )
        if tool_name == "computer_click_box":
            bbox = _normalize_bbox(tool_input)
            if not bbox:
                return {"ok": False, "error": "A valid bounding box is required"}
            point = _compute_point_from_box(
                bbox,
                tool_input.get("x_ratio") if isinstance(tool_input.get("x_ratio"), (int, float)) else None,
                tool_input.get("y_ratio") if isinstance(tool_input.get("y_ratio"), (int, float)) else None,
            )
            coordinate_space = runtime.last_snapshot_coordinate_space if runtime is not None else None
            click_result = await computer_helper_client.click(
                point["x"],
                point["y"],
                coordinate_space=coordinate_space,
            )
            return {
                **click_result,
                "bbox": bbox,
                "point": point,
            }
        if tool_name == "computer_locate_target":
            target = str(tool_input.get("target") or "").strip()
            if not target:
                return {"ok": False, "error": "Target is required"}
            snapshot_result, file_path = await self._capture_snapshot_artifact(session, runtime=runtime)
            if not snapshot_result.get("ok") or not file_path:
                return snapshot_result
            locator_strategy = await self._locator_strategy(session["model"])
            if not locator_strategy:
                return {"ok": False, "error": "No native video or OCR model is available to locate UI targets"}
            locate_result = await self._locate_target_with_model(file_path, locator_strategy["model_name"], target)
            return {
                **locate_result,
                "locator_route": locator_strategy["route"],
                "artifact_id": snapshot_result.get("artifact_id"),
                "artifact_url": snapshot_result.get("artifact_url"),
                "observation_text": snapshot_result.get("observation_text"),
            }
        if tool_name == "computer_click_target":
            target = str(tool_input.get("target") or "").strip()
            if not target:
                return {"ok": False, "error": "Target is required"}
            snapshot_result, file_path = await self._capture_snapshot_artifact(session, runtime=runtime)
            if not snapshot_result.get("ok") or not file_path:
                return snapshot_result
            locator_strategy = await self._locator_strategy(session["model"])
            if not locator_strategy:
                return {"ok": False, "error": "No native video or OCR model is available to locate UI targets"}
            locate_result = await self._locate_target_with_model(file_path, locator_strategy["model_name"], target)
            if not locate_result.get("ok"):
                return {
                    **locate_result,
                    "locator_route": locator_strategy["route"],
                    "artifact_id": snapshot_result.get("artifact_id"),
                    "artifact_url": snapshot_result.get("artifact_url"),
                    "observation_text": snapshot_result.get("observation_text"),
                }
            bbox = locate_result.get("bbox")
            if not isinstance(bbox, dict):
                return {"ok": False, "error": "Locator returned no bounding box"}
            point = _compute_point_from_box(
                bbox,
                tool_input.get("x_ratio") if isinstance(tool_input.get("x_ratio"), (int, float)) else None,
                tool_input.get("y_ratio") if isinstance(tool_input.get("y_ratio"), (int, float)) else None,
            )
            coordinate_space = snapshot_result.get("coordinate_space")
            if not isinstance(coordinate_space, dict) and runtime is not None:
                coordinate_space = runtime.last_snapshot_coordinate_space
            click_result = await computer_helper_client.click(
                point["x"],
                point["y"],
                coordinate_space=coordinate_space if isinstance(coordinate_space, dict) else None,
            )
            return {
                **click_result,
                "target": locate_result.get("target") or target,
                "bbox": bbox,
                "point": point,
                "confidence": locate_result.get("confidence"),
                "reason": locate_result.get("reason"),
                "locator_model": locate_result.get("locator_model"),
                "locator_route": locator_strategy["route"],
                "artifact_id": snapshot_result.get("artifact_id"),
                "artifact_url": snapshot_result.get("artifact_url"),
            }
        if tool_name == "computer_type":
            return await computer_helper_client.type_text(str(tool_input.get("text") or ""))
        if tool_name == "computer_keypress":
            modifiers = tool_input.get("modifiers")
            if not isinstance(modifiers, list):
                modifiers = []
            return await computer_helper_client.keypress(str(tool_input.get("key") or ""), [str(item) for item in modifiers])
        if tool_name == "computer_scroll":
            delta_x = _parse_int_like(tool_input.get("delta_x")) or 0
            delta_y = _parse_int_like(tool_input.get("delta_y")) or 0
            return await computer_helper_client.scroll(
                delta_x,
                delta_y,
            )
        if tool_name == "computer_open_url":
            return await computer_helper_client.open_url(str(tool_input.get("url") or ""))
        if tool_name == "computer_open_app":
            return await computer_helper_client.open_app(str(tool_input.get("app_name") or ""))
        if tool_name == "browser_navigate":
            return await computer_helper_client.browser_navigate(
                str(tool_input.get("url") or ""),
                show=True,
                focus=True,
            )
        if tool_name == "browser_query_state":
            return await computer_helper_client.browser_state(focus=True)
        if tool_name == "browser_click":
            return await computer_helper_client.browser_click(str(tool_input.get("element_id") or ""))
        if tool_name == "browser_type":
            return await computer_helper_client.browser_type(
                str(tool_input.get("element_id") or ""),
                str(tool_input.get("text") or ""),
                clear=tool_input.get("clear") is not False,
            )
        if tool_name == "browser_keypress":
            modifiers = tool_input.get("modifiers")
            if not isinstance(modifiers, list):
                modifiers = []
            return await computer_helper_client.browser_keypress(
                str(tool_input.get("key") or ""),
                [str(item) for item in modifiers],
            )
        if tool_name == "browser_scroll":
            delta_x = _parse_int_like(tool_input.get("delta_x")) or 0
            delta_y = _parse_int_like(tool_input.get("delta_y")) or 0
            return await computer_helper_client.browser_scroll(
                delta_x,
                delta_y,
            )
        if tool_name == "browser_back":
            return await computer_helper_client.browser_back()
        if tool_name == "computer_wait_for_user":
            if runtime is None:
                return {"ok": False, "error": "Runtime session is unavailable"}
            reason = str(tool_input.get("reason") or "").strip()
            if not reason:
                reason = "检测到需要你手动接管，请完成必要操作后点击继续。"
            await self._append_assistant_message(
                session["id"],
                f"### 需要你接管\n- {reason}\n- 完成后点击“继续”，我会从当前页面重新观察并接着执行。",
            )
            await computer_helper_client.browser_show(focus=True)
            runtime.pause_event.clear()
            await self._set_session_status(session["id"], "paused")
            await self._sync_status_hud(session, "paused", detail=reason)
            await runtime.pause_event.wait()
            return {
                "ok": True,
                "resumed": True,
                "reason": reason,
                "next_step": "Capture a fresh snapshot before continuing",
            }
        if tool_name == "terminal_exec":
            return await self._perform_terminal(session, tool_input)
        if tool_name == "fs_list":
            return await self._perform_fs_list(str(tool_input.get("path") or session["cwd"]))
        if tool_name == "fs_read_text":
            return await self._perform_fs_read(str(tool_input.get("path") or session["cwd"]))
        if tool_name == "fs_write_text":
            return await self._perform_fs_write(
                str(tool_input.get("path") or session["cwd"]),
                str(tool_input.get("content") or ""),
            )
        return {"ok": False, "error": f"Unsupported tool: {tool_name}"}

    async def _execute_tool_call(
        self,
        session: dict[str, Any],
        tool_name: str,
        tool_input: dict[str, Any],
    ) -> dict[str, Any]:
        runtime = self._runtime_for(session["id"])
        risk_level, requires_approval, blocked_reason, approval_reason, metadata = await self._assess_risk(
            session,
            tool_name,
            tool_input,
        )
        action_id = await self._save_action(
            session["id"],
            tool_name,
            risk_level,
            tool_input,
            status="pending",
            requires_approval=requires_approval,
        )

        if blocked_reason:
            output = {
                "ok": False,
                "error": blocked_reason,
                "recoverable": True,
                "hint": "The action was blocked. Re-plan from the current state instead of repeating it blindly.",
            }
            await self._finish_action(action_id, output, status="error", error=blocked_reason)
            await self._emit(
                session["id"],
                {
                    "type": "action_completed",
                    "action": {
                        "id": action_id,
                        "tool_name": tool_name,
                        "risk_level": risk_level,
                        "status": "error",
                        "output_payload": output,
                        "error": blocked_reason,
                    },
                },
            )
            return output

        input_to_execute = dict(tool_input)
        if requires_approval:
            approval_id = await self._create_approval(
                session["id"],
                action_id,
                tool_name,
                approval_reason or "Approval required",
            )
            future: asyncio.Future = asyncio.get_running_loop().create_future()
            runtime.pending_approval = ApprovalWaiter(
                approval_id=approval_id,
                action_id=action_id,
                tool_name=tool_name,
                original_input=dict(tool_input),
                future=future,
            )
            await self._set_session_status(session["id"], "waiting_approval")
            await self._sync_status_hud(
                session,
                "waiting_approval",
                detail=approval_reason or f"等待确认: {tool_name}",
            )
            await self._emit(
                session["id"],
                {
                    "type": "approval_required",
                    "approval": {
                        "id": approval_id,
                        "action_id": action_id,
                        "tool_name": tool_name,
                        "reason": approval_reason,
                        "metadata": metadata,
                        "input_payload": tool_input,
                    },
                },
            )
            decision = await future
            if decision.get("decision") != "approve":
                reason = str(decision.get("reason") or "Rejected by user")
                output = {
                    "ok": False,
                    "error": reason,
                    "rejected": True,
                    "recoverable": True,
                    "hint": "The user rejected this action. Choose another approach or ask for a different takeover step.",
                }
                await self._finish_action(action_id, output, status="error", error=reason)
                await self._emit(
                    session["id"],
                    {
                        "type": "action_completed",
                        "action": {
                            "id": action_id,
                            "tool_name": tool_name,
                            "risk_level": risk_level,
                            "status": "error",
                            "output_payload": output,
                            "error": reason,
                        },
                    },
                )
                return output
            edited_input = decision.get("edited_input")
            if isinstance(edited_input, dict):
                input_to_execute = edited_input

        await execute_update(
            "UPDATE computer_use_actions SET status = ?, updated_at = ? WHERE id = ?",
            ("running", _now(), action_id),
        )
        await self._emit(
            session["id"],
            {
                "type": "action_started",
                "action": {
                    "id": action_id,
                    "tool_name": tool_name,
                    "risk_level": risk_level,
                    "status": "running",
                    "input_payload": input_to_execute,
                },
            },
        )
        await self._sync_status_hud(
            session,
            "running",
            detail=f"正在执行: {tool_name}",
        )
        result = await self._perform_tool_with_retries(session, tool_name, input_to_execute, runtime=runtime)
        if not isinstance(result, dict):
            result = {"ok": False, "error": "Tool returned an invalid response"}
        elif result.get("ok") is not True and not str(result.get("error") or "").strip():
            result = {
                **result,
                "ok": False,
                "error": "Tool returned no success flag or error details",
            }
        if result.get("ok") is not True and tool_name in RETRYABLE_TOOLS and "recoverable" not in result:
            result["recoverable"] = True
        status = "completed" if result.get("ok") else "error"
        error = str(result.get("error") or "") or None
        await self._finish_action(action_id, result, status=status, error=error)
        await self._emit(
            session["id"],
            {
                "type": "action_completed",
                "action": {
                    "id": action_id,
                    "tool_name": tool_name,
                    "risk_level": risk_level,
                    "status": status,
                    "input_payload": input_to_execute,
                    "output_payload": result,
                    "error": error,
                },
            },
        )
        await self._sync_status_hud(
            session,
            "running",
            detail=(
                f"已完成: {tool_name}"
                if status == "completed"
                else f"已重规划: {tool_name}"
            ),
        )
        return result

    async def _run_session(self, session_id: str) -> None:
        runtime = self._runtime_for(session_id)
        try:
            session = await self.get_session(session_id)
            official_caps = await self._validate_session_request(session["model"])
            helper_status = await self.get_status()
            thinking_supported = await ollama_service.supports_thinking(session["model"])

            await execute_update(
                """
                UPDATE computer_use_sessions
                SET thinking_text = '', assistant_text = '', error = NULL, updated_at = ?
                WHERE id = ?
                """,
                (_now(), session_id),
            )
            await self._set_session_status(session_id, "running", started=True)

            messages: list[dict[str, Any]] = [
                {"role": "system", "content": COMPUTER_USE_SYSTEM_PROMPT},
                *(
                    [{"role": "system", "content": NATIVE_VIDEO_ROUTE_NOTE}]
                    if _supports_direct_visual_route(official_caps)
                    else [{"role": "system", "content": OCR_ROUTE_SYSTEM_NOTE}]
                ),
                *(
                    [{"role": "system", "content": HANDS_FREE_SYSTEM_NOTE}]
                    if _is_hands_free_mode(session.get("approval_mode"))
                    else []
                ),
                *(
                    [{"role": "system", "content": BROWSER_ONLY_SYSTEM_NOTE}]
                    if (
                        helper_status.get("controlled_browser_available")
                        and not helper_status.get("desktop_available")
                    )
                    else []
                ),
                *(
                    [{"role": "system", "content": OBSERVATION_ONLY_SYSTEM_NOTE}]
                    if helper_status.get("helper", {}).get("permissions", {}).get("accessibility") is False
                    else []
                ),
                *await self._build_parent_context_messages(session.get("parent_session_id")),
                {"role": "user", "content": session["goal"]},
            ]

            tool_round = 0
            forced_summary_used = False
            while tool_round < MAX_TOOL_ROUNDS:
                if runtime.cancel_requested:
                    raise asyncio.CancelledError()
                await runtime.pause_event.wait()
                if runtime.cancel_requested:
                    raise asyncio.CancelledError()

                assistant_text, _, tool_calls, error = await self._chat_round(
                    session_id,
                    session["model"],
                    messages,
                    tools_enabled=True,
                    think_enabled=thinking_supported is True,
                )
                if error:
                    raise RuntimeError(error)

                if tool_calls:
                    messages.append({"role": "assistant", "content": assistant_text or "", "tool_calls": tool_calls})
                    for tool_call in tool_calls:
                        function = tool_call.get("function") or {}
                        tool_name = str(function.get("name") or "").strip()
                        tool_input = function.get("arguments") or {}
                        if not isinstance(tool_input, dict):
                            tool_input = {}
                        result = await self._execute_tool_call(session, tool_name, tool_input)
                        messages.append(
                            {
                                "role": "tool",
                                "name": tool_name,
                                "content": _dumps_json(
                                    {
                                        "ok": result.get("ok", False),
                                        "result": result,
                                    }
                                ),
                            }
                        )
                        if result.get("ok") is not True and result.get("recoverable"):
                            messages.append(
                                {
                                    "role": "system",
                                    "content": (
                                        "The previous tool action did not succeed, but the session is still active. "
                                        "Re-plan from the current page state, avoid repeating the exact same failed action blindly, "
                                        "and continue with a safer or alternative approach."
                                    ),
                                }
                            )
                    tool_round += 1
                    continue

                if assistant_text.strip():
                    await self._set_session_status(session_id, "completed", completed=True)
                    await self._emit(session_id, {"type": "done", "session": await self.get_session(session_id)})
                    return

                if not forced_summary_used:
                    forced_summary_used = True
                    messages.append(
                        {
                            "role": "system",
                            "content": (
                                "Stop acting. Give the user a concise direct status summary in Simplified Chinese Markdown "
                                "based on the observed state so far. Use short bullets and avoid copying raw snapshot text."
                            ),
                        }
                    )
                    summary_text, _, _, summary_error = await self._chat_round(
                        session_id,
                        session["model"],
                        messages,
                        tools_enabled=False,
                        think_enabled=thinking_supported is True,
                    )
                    if summary_error:
                        raise RuntimeError(summary_error)
                    if summary_text.strip():
                        await self._set_session_status(session_id, "completed", completed=True)
                        await self._emit(session_id, {"type": "done", "session": await self.get_session(session_id)})
                        return

                raise RuntimeError("Model did not produce actionable tool calls or a final answer")

            raise RuntimeError(f"Tool round limit exceeded ({MAX_TOOL_ROUNDS})")
        except asyncio.CancelledError:
            await self._set_session_status(session_id, "cancelled", completed=True)
            await self._emit(session_id, {"type": "done", "session": await self.get_session(session_id)})
        except Exception as exc:
            await self._set_session_status(session_id, "failed", error=str(exc), completed=True)
            await self._emit(session_id, {"type": "error", "error": str(exc)})
            await self._emit(session_id, {"type": "done", "session": await self.get_session(session_id)})
        finally:
            async with self._active_lock:
                if self._active_session_id == session_id:
                    self._active_session_id = None
            runtime.pending_approval = None
            runtime.task = None


computer_use_service = ComputerUseService()
