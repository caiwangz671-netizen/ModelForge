"""Chat API routes"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Any, Optional, List, Union
from datetime import datetime, timezone
import json
import re
import time
import uuid

from app.services.database import execute_query, execute_insert, execute_update
from app.services.ollama import ollama_service
from app.services.chat_service import ChatService
from app.services.memory_service import memory_service
from app.services.model_capabilities import ModelCapabilityService
from app.services.model_residency_service import model_residency_service
from app.services.web_search_service import web_search_service
from app.config import get_settings

router = APIRouter()

MAX_TOOL_CALL_ROUNDS = 10
WEB_SEARCH_TOOL_NAME = "web_search"
WEB_READ_TOOL_NAME = "web_read"
WEB_SEARCH_TOOL_SCHEMA = {
    "type": "function",
    "function": {
        "name": WEB_SEARCH_TOOL_NAME,
        "description": (
            "Search the web and return candidate result URLs. "
            "Use this for current facts or when you need sources."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query keywords",
                },
                "max_results": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 20,
                    "description": "Maximum number of results to retrieve (default 8).",
                },
            },
            "required": ["query"],
        },
    },
}
WEB_READ_TOOL_SCHEMA = {
    "type": "function",
    "function": {
        "name": WEB_READ_TOOL_NAME,
        "description": (
            "Read a specific web page URL and extract the main textual content. "
            "Use this after web_search to inspect pages before answering."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The URL to open and read",
                },
                "max_chars": {
                    "type": "integer",
                    "minimum": 500,
                    "maximum": 50000,
                    "description": "Maximum number of characters to extract (default 12000).",
                },
            },
            "required": ["url"],
        },
    },
}
TOOL_SCHEMAS = [WEB_SEARCH_TOOL_SCHEMA, WEB_READ_TOOL_SCHEMA]


class ChatMessage(BaseModel):
    role: str  # "system", "user", "assistant"
    content: str


class ChatRequest(BaseModel):
    model: str
    messages: List[ChatMessage]
    system: Optional[str] = None
    temperature: Optional[float] = 0.7
    top_p: Optional[float] = 0.9
    max_tokens: Optional[int] = None
    max_context_tokens: Optional[int] = None
    conversation_id: Optional[str] = None
    think: Optional[Union[bool, str]] = None
    remember: Optional[bool] = False
    web_search: Optional[bool] = False
    persist_user_message: Optional[bool] = True


class ConversationCreate(BaseModel):
    title: Optional[str] = "New Conversation"
    model: str


class TitleGenerateRequest(BaseModel):
    messages: List[ChatMessage]
    model: str
    conversation_id: Optional[str] = None


class TitleUpdateRequest(BaseModel):
    title: str


class ModelUpdateRequest(BaseModel):
    model: str


async def _ensure_conversation_exists(
    conversation_id: str,
    model: str,
    messages: List[dict],
):
    existing = await execute_query(
        "SELECT id FROM conversations WHERE id = ?",
        (conversation_id,),
    )
    if existing:
        return

    now = time.time()
    title = ChatService.generate_conversation_title(messages)
    await execute_insert(
        """INSERT INTO conversations (id, title, model, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)""",
        (conversation_id, title, model, now, now),
    )


def _default_think_mode(model_name: str) -> Union[bool, str]:
    model_lower = model_name.lower()
    # Ollama docs: gpt-oss accepts reasoning levels low/medium/high
    if "gptoss" in model_lower.replace("-", ""):
        return "medium"
    return True


def _format_utc_offset(offset: str) -> str:
    if not offset:
        return ""
    if len(offset) == 5 and (offset.startswith("+") or offset.startswith("-")):
        return f"{offset[:3]}:{offset[3:]}"
    return offset


def _build_runtime_time_system_message() -> str:
    now_local = datetime.now().astimezone()
    now_utc = now_local.astimezone(timezone.utc)
    tz_name = now_local.tzname() or "Local"
    utc_offset = _format_utc_offset(now_local.strftime("%z"))

    return (
        "Runtime time context (authoritative):\n"
        f"- Local datetime: {now_local.strftime('%Y-%m-%d %H:%M:%S')} {tz_name} (UTC{utc_offset})\n"
        f"- UTC datetime: {now_utc.strftime('%Y-%m-%d %H:%M:%S')} UTC\n"
        "When the user asks about current date/time (e.g., now/today), use this context."
    )


def _build_markdown_math_output_system_message() -> str:
    return (
        "Output formatting requirements (must follow):\n"
        "1) Use clean Markdown for the final answer.\n"
        "2) Math rules:\n"
        "   - Inline math: use $...$\n"
        "   - Display math: use $$...$$ with opening and closing $$ on separate lines\n"
        "   - Always close math delimiters; never leave unpaired $ or $$\n"
        "   - Do not use \\(...\\) or \\[...\\]; convert to $...$ / $$...$$\n"
        "3) Do not put currency or normal text in math delimiters.\n"
        "4) For lists, use Markdown lists; do not use LaTeX itemize/enumerate environments.\n"
        "5) For code, use fenced code blocks with triple backticks.\n"
        "6) Do not use fenced code blocks for plain words/tool names (e.g., web_search/web_read); "
        "write them as normal text or inline code.\n"
        "Return only the answer content."
    )


def _build_web_search_tool_system_message() -> str:
    return (
        "Tool usage policy:\n"
        "- Use `web_search` to find candidate sources.\n"
        "- Use `web_read` to open URLs and read actual page content before final answer.\n"
        "- Do not claim you've read a page unless you actually called `web_read`.\n"
        "- Do not output your internal plan (e.g. 'let me search again').\n"
        "- If search is noisy, refine query silently and then answer succinctly.\n"
        "- Do not fabricate citations.\n"
        "- If tool results are irrelevant, say they are irrelevant and ask for refinement.\n"
        "- Do not add a separate 'Sources' or 'References' section in the answer body.\n"
        "- Do not append raw URLs or inline citation lists unless the user explicitly demands inline format.\n"
        "- The application will render references separately at the end, together with knowledge-base citations.\n"
        "- Focus the answer body on conclusions and evidence, not citation formatting."
    )


def _parse_json_dict_list(raw: object) -> List[dict]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [item for item in raw if isinstance(item, dict)]
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return []
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                return [item for item in parsed if isinstance(item, dict)]
        except json.JSONDecodeError:
            return []
    return []


def _parse_rag_references(raw: object) -> List[dict]:
    return _parse_json_dict_list(raw)


def _parse_tool_calls(raw: object) -> List[dict]:
    return _parse_json_dict_list(raw)


def _dedupe_references(references: List[dict]) -> List[dict]:
    deduped: List[dict] = []
    seen: set[str] = set()
    for ref in references:
        if not isinstance(ref, dict):
            continue
        final_url = str(ref.get("final_url") or ref.get("url") or "").strip().lower()
        memory_id = str(ref.get("memory_id") or "").strip().lower()
        source_name = str(ref.get("source_name") or ref.get("title") or ref.get("display") or "").strip().lower()
        key = final_url or memory_id or source_name
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(ref)
    return deduped


def _snippet_from_text(text: str, max_chars: int = 180) -> str:
    value = re.sub(r"\s+", " ", (text or "").strip())
    if len(value) <= max_chars:
        return value
    return value[: max_chars - 1].rstrip() + "…"


def _build_web_reference(read_result: dict, fallback_url: str, index: int) -> Optional[dict]:
    final_url = str(read_result.get("final_url") or fallback_url or "").strip()
    source_url = str(read_result.get("url") or fallback_url or "").strip()
    title = str(read_result.get("title") or "").strip()
    content = str(read_result.get("content") or "").strip()
    error = str(read_result.get("error") or "").strip() or None
    if not final_url and not source_url:
        return None

    display = title or final_url or source_url
    return {
        "label": f"W{index}",
        "category": "web_source",
        "source_name": title or final_url or source_url,
        "source_type": "web",
        "title": title,
        "url": source_url or final_url,
        "final_url": final_url or source_url,
        "snippet": _snippet_from_text(content),
        "display": display,
        "error": error,
    }


def _merge_references(memory_references: List[dict], web_references: List[dict]) -> List[dict]:
    merged = _dedupe_references([*memory_references, *web_references])
    memory_index = 1
    web_index = 1
    for ref in merged:
        source_type = str(ref.get("source_type") or "").strip().lower()
        if source_type == "web" or ref.get("final_url") or ref.get("url"):
            ref["label"] = f"W{web_index}"
            web_index += 1
        else:
            ref["label"] = f"R{memory_index}"
            memory_index += 1
    return merged


def _dedupe_tool_calls(tool_calls: List[dict]) -> List[dict]:
    deduped: List[dict] = []
    seen: set[str] = set()
    for call in tool_calls:
        try:
            key = json.dumps(call, ensure_ascii=False, sort_keys=True)
        except Exception:
            key = str(call)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(call)
    return deduped


def _coerce_tool_calls(raw: object) -> List[dict]:
    if not isinstance(raw, list):
        return []
    parsed: List[dict] = []
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
        args_dict: dict[str, Any]
        if isinstance(args_raw, dict):
            args_dict = args_raw
        elif isinstance(args_raw, str):
            text = args_raw.strip()
            if not text:
                args_dict = {}
            else:
                try:
                    decoded = json.loads(text)
                    args_dict = decoded if isinstance(decoded, dict) else {"input": decoded}
                except json.JSONDecodeError:
                    args_dict = {"input": text}
        else:
            args_dict = {}

        parsed.append(
            {
                "id": str(item.get("id") or str(uuid.uuid4())),
                "type": str(item.get("type") or "function"),
                "function": {
                    "name": name,
                    "arguments": args_dict,
                },
            }
        )
    return _dedupe_tool_calls(parsed)


def _tool_event_type(tool_name: str) -> str:
    normalized = (tool_name or "").strip().lower()
    if normalized == WEB_READ_TOOL_NAME:
        return "browser"
    return "web_search"


_KNOWN_TOOL_NAMES = {WEB_SEARCH_TOOL_NAME, WEB_READ_TOOL_NAME}


def _try_parse_embedded_tool_calls(content: str) -> List[dict]:
    """Detect tool call JSON embedded as plain text content.

    Some models declare `tools` capability but emit the call as a JSON object
    in the content field rather than in the structured `tool_calls` field.
    This function tries to recover those calls so they can be executed normally.
    """
    text = content.strip()
    if not text:
        return []

    # Strip optional markdown code fences.
    text = re.sub(r"^```(?:json)?\s*\n?", "", text)
    text = re.sub(r"\n?```\s*$", "", text).strip()

    candidates: List[str] = [text]
    # Also try largest JSON object found inside the text.
    for m in re.finditer(r"\{[\s\S]*\}", text):
        candidates.append(m.group())

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue

        tool_calls: List[dict] = []

        if isinstance(parsed, dict):
            name = str(parsed.get("name") or "").strip()
            # {"type":"function","name":"web_search","parameters":{...}}
            if name in _KNOWN_TOOL_NAMES:
                args = parsed.get("parameters") or parsed.get("arguments") or {}
                tool_calls = _coerce_tool_calls([
                    {
                        "id": str(uuid.uuid4()),
                        "type": "function",
                        "function": {
                            "name": name,
                            "arguments": args if isinstance(args, dict) else {},
                        },
                    }
                ])
            # {"function":{"name":"web_search","arguments":{...}}}
            elif isinstance(parsed.get("function"), dict):
                fn_name = str(parsed["function"].get("name") or "").strip()
                if fn_name in _KNOWN_TOOL_NAMES:
                    tool_calls = _coerce_tool_calls([parsed])

        elif isinstance(parsed, list):
            has_known = any(
                isinstance(item, dict)
                and (
                    str(item.get("name") or "").strip() in _KNOWN_TOOL_NAMES
                    or (
                        isinstance(item.get("function"), dict)
                        and str(item["function"].get("name") or "").strip() in _KNOWN_TOOL_NAMES
                    )
                )
                for item in parsed
            )
            if has_known:
                tool_calls = _coerce_tool_calls(parsed)

        if tool_calls:
            return tool_calls

    return []


def _build_title_transcript(messages: List[dict], max_messages: int = 8) -> str:
    tail = [m for m in messages if isinstance(m, dict)][-max_messages:]
    lines: List[str] = []
    for msg in tail:
        role_raw = str(msg.get("role") or "").strip().lower()
        if role_raw not in {"user", "assistant", "system"}:
            continue
        role = "user" if role_raw == "user" else ("assistant" if role_raw == "assistant" else "system")
        content = str(msg.get("content") or "").strip()
        if not content:
            continue
        content = re.sub(r"\s+", " ", content)
        lines.append(f"{role}: {content[:240]}")
    return "\n".join(lines).strip()


def _sanitize_generated_title(raw: str) -> str:
    title = (raw or "").strip()
    if not title:
        return ""
    title = re.sub(r"^```[a-zA-Z0-9_-]*\n?", "", title)
    title = re.sub(r"```$", "", title).strip()
    title = title.strip().strip('"').strip("'").strip("`")
    title = title.replace("标题：", "").replace("Title:", "").replace("title:", "").strip()
    title = title.split("\n", 1)[0].strip()
    title = re.sub(r"^[\-\*\d\.\)\(]+\s*", "", title)
    title = re.sub(r"\s+", " ", title).strip()
    if len(title) > 42:
        title = title[:42].rstrip()
    return title


async def _generate_title_with_model(messages_dict: List[dict], model: str) -> str:
    transcript = _build_title_transcript(messages_dict)
    if not transcript:
        return ""

    prompt = (
        "You generate concise chat titles.\n"
        "Rules:\n"
        "- Use the same language as the user.\n"
        "- Capture user goal + object, not a sentence.\n"
        "- Chinese title: 6-16 chars. English title: 3-7 words.\n"
        "- No quotes, no trailing punctuation, no markdown.\n"
        "Return title only.\n\n"
        f"Conversation:\n{transcript}\n\nTitle:"
    )

    title_response = ""
    async for chunk in ollama_service.generate(
        model=model,
        prompt=prompt,
        options={"temperature": 0.2, "num_predict": 32},
    ):
        if "response" in chunk:
            title_response += str(chunk.get("response") or "")

    return _sanitize_generated_title(title_response)


@router.get("/conversations")
async def list_conversations():
    """List all conversations"""
    try:
        conversations = await execute_query(
            "SELECT * FROM conversations ORDER BY updated_at DESC"
        )
        return {"conversations": conversations}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/conversations")
async def create_conversation(request: ConversationCreate):
    """Create a new conversation"""
    try:
        conversation_id = str(uuid.uuid4())
        now = time.time()
        
        await execute_insert(
            """INSERT INTO conversations (id, title, model, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?)""",
            (conversation_id, request.title, request.model, now, now)
        )
        
        return {
            "id": conversation_id,
            "title": request.title,
            "model": request.model,
            "created_at": now,
            "updated_at": now,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/conversations/auto-title")
async def auto_generate_title(request: TitleGenerateRequest):
    """Auto-generate conversation title using short conversation summary."""
    try:
        messages_dict = [{"role": m.role, "content": m.content} for m in request.messages]

        title = ""
        try:
            title = await _generate_title_with_model(messages_dict, request.model)
        except Exception:
            title = ""

        if not title or len(title) < 2:
            title = ChatService.generate_conversation_title(messages_dict)
            title = _sanitize_generated_title(title)

        if not title:
            title = "新对话"

        if request.conversation_id and title:
            try:
                await execute_update(
                    "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?",
                    (title, time.time(), request.conversation_id),
                )
            except Exception:
                pass

        return {"title": title}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/conversations/{conversation_id}")
async def get_conversation(conversation_id: str):
    """Get conversation details with messages"""
    try:
        conversations = await execute_query(
            "SELECT * FROM conversations WHERE id = ?",
            (conversation_id,)
        )
        if not conversations:
            raise HTTPException(status_code=404, detail="Conversation not found")
        
        messages = await execute_query(
            "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at",
            (conversation_id,)
        )

        sanitized_messages = []
        for raw in messages:
            msg = dict(raw)
            content = msg.get("content")
            if isinstance(content, str) and content:
                msg["content"] = ChatService.sanitize_math_markdown(content)
            thinking = msg.get("thinking")
            if isinstance(thinking, str) and thinking:
                msg["thinking"] = ChatService.sanitize_math_markdown(thinking)
            msg["tool_calls"] = _parse_tool_calls(msg.get("tool_calls"))
            msg["rag_references"] = _parse_rag_references(msg.get("rag_references"))
            sanitized_messages.append(msg)
        
        conversation = dict(conversations[0])
        conversation["messages"] = sanitized_messages
        return conversation
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/conversations/{conversation_id}/title")
async def update_conversation_title(conversation_id: str, request: TitleUpdateRequest):
    """Update conversation title"""
    try:
        now = time.time()
        await execute_update(
            "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?",
            (request.title, now, conversation_id)
        )
        return {"message": "Title updated", "title": request.title}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/conversations/{conversation_id}/model")
async def update_conversation_model(conversation_id: str, request: ModelUpdateRequest):
    """Update conversation model"""
    try:
        next_model = (request.model or "").strip()
        if not next_model:
            raise HTTPException(status_code=400, detail="Model is required")

        existing = await execute_query(
            "SELECT id FROM conversations WHERE id = ?",
            (conversation_id,),
        )
        if not existing:
            raise HTTPException(status_code=404, detail="Conversation not found")

        now = time.time()
        await execute_update(
            "UPDATE conversations SET model = ?, updated_at = ? WHERE id = ?",
            (next_model, now, conversation_id),
        )
        return {"message": "Model updated", "model": next_model}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str):
    """Delete a conversation"""
    try:
        await execute_update(
            "DELETE FROM conversations WHERE id = ?",
            (conversation_id,)
        )
        return {"message": "Conversation deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/conversations")
async def delete_all_conversations():
    """Delete all conversations"""
    try:
        await execute_update("DELETE FROM conversations")
        return {"message": "All conversations deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/completions")
async def chat_completion(request: ChatRequest):
    """Chat completion with streaming and reasoning support"""
    async def generate():
        conversation_id = request.conversation_id or str(uuid.uuid4())
        settings = get_settings()

        # Prepare messages for Ollama and ensure conversation exists
        messages = [{"role": m.role, "content": m.content} for m in request.messages]
        await _ensure_conversation_exists(conversation_id, request.model, messages)
        latest_user_content = request.messages[-1].content.strip() if request.messages else ""

        # Memory retrieval: add relevant long-term context if embedding model is available.
        prepend_system_messages: List[dict] = []
        if settings.inject_runtime_time:
            prepend_system_messages.append(
                {"role": "system", "content": _build_runtime_time_system_message()}
            )
        prepend_system_messages.append(
            {"role": "system", "content": _build_markdown_math_output_system_message()}
        )
        if request.system and request.system.strip():
            prepend_system_messages.append(
                {"role": "system", "content": request.system.strip()}
            )

        extra_context_messages: List[dict] = []
        memory_payload: dict = {"context": None, "references": []}
        if latest_user_content:
            memory_payload = await memory_service.build_chat_memory_payload(
                query=latest_user_content,
                limit=3,
                only_when_relevant=True,
            )
            memory_context = memory_payload.get("context")
            if memory_context:
                extra_context_messages.append(
                    {"role": "system", "content": str(memory_context)}
                )

        # Check if model supports reasoning
        is_reasoning_model = ChatService.is_reasoning_model(request.model)

        # Save user message unless this is a refresh-resume request.
        now = time.time()
        if request.persist_user_message is not False:
            user_message_id = str(uuid.uuid4())
            await execute_insert(
                """INSERT INTO messages (id, conversation_id, role, content, created_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (
                    user_message_id,
                    conversation_id,
                    "user",
                    request.messages[-1].content if request.messages else "",
                    now,
                ),
            )
        await execute_update(
            "UPDATE conversations SET updated_at = ? WHERE id = ?",
            (now, conversation_id),
        )

        options = {}
        if request.temperature is not None:
            options["temperature"] = request.temperature
        if request.top_p is not None:
            options["top_p"] = request.top_p
        if request.max_tokens is not None:
            options["num_predict"] = request.max_tokens
        elif settings.max_output_tokens > 0:
            options["num_predict"] = settings.max_output_tokens
        if request.max_context_tokens is not None:
            options["num_ctx"] = request.max_context_tokens
        elif settings.max_context_tokens > 0:
            options["num_ctx"] = settings.max_context_tokens

        keep_alive = None
        if model_residency_service.is_resident(request.model):
            keep_alive = -1
        elif settings.auto_unload_after_response:
            keep_alive = 0

        try:
            official_caps = await ollama_service.get_model_capabilities(request.model)
            supports_tools = "tools" in official_caps

            official_thinking_support = await ollama_service.supports_thinking(request.model)
            fallback_reasoning_model = ChatService.is_reasoning_model(request.model)

            think_mode: Optional[Union[bool, str]]
            if request.think is not None:
                think_mode = request.think
            elif official_thinking_support is True:
                think_mode = _default_think_mode(request.model)
            elif official_thinking_support is False:
                # Non-thinking models should not receive `think` param at all.
                think_mode = None
            elif fallback_reasoning_model:
                # Fallback only when official capabilities are unavailable.
                think_mode = _default_think_mode(request.model)
            else:
                think_mode = None

            # If user explicitly disables thinking, suppress thinking stream/output,
            # even for models that may still emit internal reasoning chunks.
            can_stream_thinking = (
                official_thinking_support is True
                or (official_thinking_support is None and fallback_reasoning_model)
                or request.think is not None
            )
            reveal_thinking = (think_mode is not False) and can_stream_thinking

            web_search_requested = bool(request.web_search) and bool(latest_user_content)
            tools_enabled = web_search_requested and supports_tools

            executed_tool_calls: List[dict] = []
            web_references: List[dict] = []
            if web_search_requested and not supports_tools:
                skipped_event = {
                    "id": str(uuid.uuid4()),
                    "type": "web_search",
                    "name": WEB_SEARCH_TOOL_NAME,
                    "input": {"query": latest_user_content},
                    "output": "Current model does not declare `tools` capability in /api/show.",
                    "status": "error",
                    "started_at": datetime.now(timezone.utc).isoformat(),
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                }
                executed_tool_calls.append(skipped_event)
                yield f"data: {json.dumps({'tool_event': skipped_event}, ensure_ascii=False)}\n\n"

            if tools_enabled:
                prepend_system_messages.append(
                    {"role": "system", "content": _build_web_search_tool_system_message()}
                )

            model_messages = [*prepend_system_messages, *extra_context_messages, *messages]

            assistant_visible_content = ""
            thinking_visible_content = ""
            final_thinking: Optional[str] = None
            tool_round = 0

            while True:
                round_assistant_raw = ""
                round_thinking_raw = ""
                round_streamed_main_length = 0
                round_tool_calls: List[dict] = []
                round_done = False

                used_think_fallback = False
                while True:
                    retry_without_think = False
                    async for chunk in ollama_service.chat(
                        request.model,
                        model_messages,
                        options,
                        think=think_mode,
                        keep_alive=keep_alive,
                        tools=TOOL_SCHEMAS if tools_enabled else None,
                    ):
                        if "error" in chunk:
                            error_text = str(chunk.get("error") or "")
                            # Backward compatibility: some Ollama versions reject unknown fields like `think`.
                            # Retry once without think to avoid breaking non-thinking model flows.
                            if (
                                think_mode is not None
                                and not used_think_fallback
                                and ("unknown field" in error_text.lower() and "think" in error_text.lower())
                            ):
                                used_think_fallback = True
                                think_mode = None
                                retry_without_think = True
                                break

                            yield f"data: {json.dumps({'error': error_text}, ensure_ascii=False)}\n\n"
                            return

                        message = chunk.get("message") or {}
                        content_delta = message.get("content") or ""
                        thinking_delta = message.get("thinking") or ""
                        tool_calls_delta = _coerce_tool_calls(message.get("tool_calls"))
                        if tool_calls_delta:
                            round_tool_calls = _dedupe_tool_calls([*round_tool_calls, *tool_calls_delta])

                        # Some reasoning models now stream thinking in a separate field.
                        if thinking_delta:
                            if not is_reasoning_model:
                                is_reasoning_model = True
                            ModelCapabilityService.mark_reasoning_model(request.model)
                            if reveal_thinking:
                                round_thinking_raw += thinking_delta
                                thinking_visible_content += thinking_delta
                                yield f"data: {json.dumps({'thinking': thinking_delta}, ensure_ascii=False)}\n\n"

                        if content_delta:
                            round_assistant_raw += content_delta
                            if reveal_thinking and is_reasoning_model and not thinking_delta:
                                # Fallback for models that still embed reasoning tags in content.
                                parsed_main, parsed_thinking = ChatService.parse_thinking_content(round_assistant_raw)

                                if parsed_thinking and len(parsed_thinking) > len(round_thinking_raw):
                                    new_thinking = parsed_thinking[len(round_thinking_raw):]
                                    round_thinking_raw = parsed_thinking
                                    if reveal_thinking and new_thinking:
                                        thinking_visible_content += new_thinking
                                        yield f"data: {json.dumps({'thinking': new_thinking}, ensure_ascii=False)}\n\n"

                                if len(parsed_main) > round_streamed_main_length:
                                    new_main = parsed_main[round_streamed_main_length:]
                                    round_streamed_main_length = len(parsed_main)
                                    if new_main:
                                        assistant_visible_content += new_main
                                        yield f"data: {json.dumps({'content': new_main, 'done': chunk.get('done', False)}, ensure_ascii=False)}\n\n"
                            elif tools_enabled:
                                # Buffer content when tools are enabled; do not stream yet.
                                # After streaming completes we either parse it as an embedded
                                # tool call or flush it as regular content.
                                pass
                            else:
                                round_streamed_main_length += len(content_delta)
                                assistant_visible_content += content_delta
                                yield f"data: {json.dumps({'content': content_delta, 'done': chunk.get('done', False)}, ensure_ascii=False)}\n\n"

                        if chunk.get("done"):
                            round_done = True
                            break

                    if retry_without_think:
                        continue
                    break

                # When tools are enabled but the model emitted the tool call as plain-text
                # JSON (instead of structured tool_calls), detect and recover it.
                if round_done and tools_enabled and not round_tool_calls and round_assistant_raw.strip():
                    embedded_calls = _try_parse_embedded_tool_calls(round_assistant_raw)
                    if embedded_calls:
                        round_tool_calls = embedded_calls
                    else:
                        # Regular content response — flush the buffered text now.
                        unstreamed = round_assistant_raw[round_streamed_main_length:]
                        if unstreamed:
                            assistant_visible_content += unstreamed
                            round_streamed_main_length = len(round_assistant_raw)
                            yield f"data: {json.dumps({'content': unstreamed, 'done': False}, ensure_ascii=False)}\n\n"

                if not round_done:
                    break

                round_final_main = round_assistant_raw.strip()
                round_final_thinking = (round_thinking_raw.strip() or None) if reveal_thinking else None
                if reveal_thinking and is_reasoning_model:
                    parsed_main, parsed_thinking = ChatService.parse_thinking_content(round_assistant_raw)
                    if parsed_thinking:
                        if round_final_thinking and parsed_thinking not in round_final_thinking:
                            round_final_thinking = f"{round_final_thinking}\n\n{parsed_thinking}".strip()
                        elif not round_final_thinking:
                            round_final_thinking = parsed_thinking
                        round_final_main = parsed_main.strip()

                if round_final_thinking and len(round_final_thinking) > len(thinking_visible_content):
                    missing_thinking = round_final_thinking[len(thinking_visible_content):]
                    if missing_thinking:
                        thinking_visible_content += missing_thinking
                        yield f"data: {json.dumps({'thinking': missing_thinking}, ensure_ascii=False)}\n\n"

                should_execute_tools = (
                    tools_enabled
                    and bool(round_tool_calls)
                    and tool_round < MAX_TOOL_CALL_ROUNDS
                )
                if should_execute_tools:
                    model_messages.append(
                        {
                            "role": "assistant",
                            "content": round_final_main or "",
                            "tool_calls": round_tool_calls,
                        }
                    )

                    for tool_call in round_tool_calls:
                        function = tool_call.get("function") if isinstance(tool_call, dict) else {}
                        function = function if isinstance(function, dict) else {}
                        tool_name = str(function.get("name") or "").strip()
                        tool_args = function.get("arguments")
                        if not isinstance(tool_args, dict):
                            tool_args = {}

                        event_id = str(tool_call.get("id") or uuid.uuid4())
                        started_at = datetime.now(timezone.utc).isoformat()
                        event_type = _tool_event_type(tool_name)
                        running_event = {
                            "id": event_id,
                            "type": event_type,
                            "name": tool_name or WEB_SEARCH_TOOL_NAME,
                            "input": tool_args,
                            "status": "running",
                            "started_at": started_at,
                        }
                        yield f"data: {json.dumps({'tool_event': running_event}, ensure_ascii=False)}\n\n"

                        completed_at = datetime.now(timezone.utc).isoformat()
                        tool_output_payload: dict[str, Any]
                        tool_output_payload_for_model: dict[str, Any]
                        status = "completed"

                        if tool_name == WEB_SEARCH_TOOL_NAME:
                            query = str(tool_args.get("query") or latest_user_content).strip()
                            max_results = tool_args.get("max_results", 8)
                            try:
                                max_results_int = int(max_results)
                            except (TypeError, ValueError):
                                max_results_int = 8
                            max_results_int = max(1, min(20, max_results_int))

                            if not query:
                                status = "error"
                                tool_output_payload = {"error": "Empty query for web_search"}
                                tool_output_payload_for_model = dict(tool_output_payload)
                            else:
                                results = await web_search_service.search(query, limit=max_results_int)
                                tool_output_payload = {
                                    "query": query,
                                    "result_count": len(results),
                                    "results": results,
                                }
                                tool_output_payload_for_model = dict(tool_output_payload)
                        elif tool_name == WEB_READ_TOOL_NAME:
                            url = str(tool_args.get("url") or "").strip()
                            max_chars = tool_args.get("max_chars", 12000)
                            try:
                                max_chars_int = int(max_chars)
                            except (TypeError, ValueError):
                                max_chars_int = 12000
                            max_chars_int = max(1000, min(50000, max_chars_int))

                            if not url:
                                status = "error"
                                tool_output_payload = {"error": "Empty url for web_read"}
                                tool_output_payload_for_model = dict(tool_output_payload)
                            else:
                                read_result = await web_search_service.read_url(url, max_chars=max_chars_int)
                                content_text = str(read_result.get("content") or "")
                                tool_output_payload_for_model = {
                                    "url": read_result.get("url") or url,
                                    "final_url": read_result.get("final_url") or url,
                                    "title": read_result.get("title") or "",
                                    "content": content_text,
                                    "error": read_result.get("error"),
                                }
                                tool_output_payload = {
                                    "url": read_result.get("url") or url,
                                    "final_url": read_result.get("final_url") or url,
                                    "title": read_result.get("title") or "",
                                    "content_preview": content_text[:600],
                                    "content_length": len(content_text),
                                    "error": read_result.get("error"),
                                }
                                web_reference = _build_web_reference(
                                    read_result=read_result,
                                    fallback_url=url,
                                    index=len(web_references) + 1,
                                )
                                if web_reference and not web_reference.get("error"):
                                    web_references.append(web_reference)
                                if tool_output_payload_for_model.get("error"):
                                    status = "error"
                        else:
                            status = "error"
                            tool_output_payload = {"error": f"Unsupported tool: {tool_name}"}
                            tool_output_payload_for_model = dict(tool_output_payload)

                        tool_output_text = json.dumps(tool_output_payload, ensure_ascii=False)
                        tool_output_text_for_model = json.dumps(tool_output_payload_for_model, ensure_ascii=False)
                        completed_event = {
                            "id": event_id,
                            "type": event_type,
                            "name": tool_name or WEB_SEARCH_TOOL_NAME,
                            "input": tool_args,
                            "output": tool_output_text,
                            "status": status,
                            "started_at": started_at,
                            "completed_at": completed_at,
                        }
                        executed_tool_calls.append(completed_event)
                        yield f"data: {json.dumps({'tool_event': completed_event}, ensure_ascii=False)}\n\n"

                        model_messages.append(
                            {
                                "role": "tool",
                                "name": tool_name or WEB_SEARCH_TOOL_NAME,
                                "tool_name": tool_name or WEB_SEARCH_TOOL_NAME,
                                "content": tool_output_text_for_model,
                            }
                        )

                    tool_round += 1
                    continue

                if tools_enabled and round_tool_calls and tool_round >= MAX_TOOL_CALL_ROUNDS:
                    limit_event = {
                        "id": str(uuid.uuid4()),
                        "type": "web_search",
                        "name": WEB_SEARCH_TOOL_NAME,
                        "input": {},
                        "output": f"Tool call rounds exceeded {MAX_TOOL_CALL_ROUNDS}.",
                        "status": "error",
                        "started_at": datetime.now(timezone.utc).isoformat(),
                        "completed_at": datetime.now(timezone.utc).isoformat(),
                    }
                    executed_tool_calls.append(limit_event)
                    yield f"data: {json.dumps({'tool_event': limit_event}, ensure_ascii=False)}\n\n"

                # Some thinking-enabled models may end after reasoning without final answer.
                # Fallback: retry once with think=False and stream recovered answer text.
                if not round_final_main and round_final_thinking and not round_tool_calls:
                    recovered_main = ""
                    async for retry_chunk in ollama_service.chat(
                        request.model,
                        model_messages,
                        options,
                        think=False,
                        keep_alive=keep_alive,
                    ):
                        if "error" in retry_chunk:
                            break

                        retry_message = retry_chunk.get("message") or {}
                        retry_delta = retry_message.get("content") or ""
                        if retry_delta:
                            recovered_main += retry_delta
                            assistant_visible_content += retry_delta
                            yield f"data: {json.dumps({'content': retry_delta, 'done': False}, ensure_ascii=False)}\n\n"

                        if retry_chunk.get("done"):
                            break

                    round_final_main = recovered_main.strip()

                final_main = assistant_visible_content.strip() or round_final_main
                if reveal_thinking:
                    final_thinking = thinking_visible_content.strip() or round_final_thinking
                else:
                    final_thinking = None

                if not final_main and executed_tool_calls:
                    # Force one final answer turn with tools disabled, to avoid ending at reasoning-only output.
                    force_final_think: Optional[Union[bool, str]] = (
                        False
                        if (
                            request.think is not None
                            or official_thinking_support is True
                            or (official_thinking_support is None and fallback_reasoning_model)
                        )
                        else None
                    )
                    force_messages = [
                        *model_messages,
                        {
                            "role": "system",
                            "content": (
                                "Stop calling tools now. Based on the gathered tool results, "
                                "provide a direct final answer in the user's language. "
                                "Do not include internal planning text. "
                                "Do not add a sources/references section or raw URLs in the answer body; "
                                "the application will render references separately."
                            ),
                        },
                    ]
                    recovered_main = ""
                    async for retry_chunk in ollama_service.chat(
                        request.model,
                        force_messages,
                        options,
                        think=force_final_think,
                        keep_alive=keep_alive,
                        tools=None,
                    ):
                        if "error" in retry_chunk:
                            break

                        retry_message = retry_chunk.get("message") or {}
                        retry_delta = retry_message.get("content") or ""
                        if retry_delta:
                            recovered_main += retry_delta
                            assistant_visible_content += retry_delta
                            yield f"data: {json.dumps({'content': retry_delta, 'done': False}, ensure_ascii=False)}\n\n"

                        if retry_chunk.get("done"):
                            break

                    if recovered_main.strip():
                        final_main = assistant_visible_content.strip() or recovered_main.strip()

                if not final_main and final_thinking:
                    final_main = "模型仅返回了思考过程，未给出最终回答；已尝试强制收敛但仍失败。请重试或切换模型。"
                if not final_main and executed_tool_calls:
                    final_main = "工具调用已完成，但模型未返回最终答案。请重试。"

                if final_main:
                    final_main = ChatService.sanitize_math_markdown(final_main)
                if final_thinking:
                    final_thinking = ChatService.sanitize_math_markdown(final_thinking)

                rag_references = _merge_references(
                    memory_payload.get("references") or [],
                    web_references,
                )

                # Save assistant message
                assistant_message_id = str(uuid.uuid4())
                await execute_insert(
                    """INSERT INTO messages (id, conversation_id, role, content, thinking, tool_calls, rag_references, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        assistant_message_id,
                        conversation_id,
                        "assistant",
                        final_main or "",
                        final_thinking,
                        json.dumps(executed_tool_calls, ensure_ascii=False) if executed_tool_calls else None,
                        json.dumps(rag_references, ensure_ascii=False) if rag_references else None,
                        time.time(),
                    ),
                )

                # Update conversation timestamp
                await execute_update(
                    "UPDATE conversations SET updated_at = ? WHERE id = ?",
                    (time.time(), conversation_id),
                )

                # Persist user memory only when explicitly requested by user.
                if latest_user_content and bool(request.remember):
                    await memory_service.remember_user_message(
                        conversation_id=conversation_id,
                        model=request.model,
                        user_content=latest_user_content,
                    )

                yield f"data: {json.dumps({'done': True, 'conversation_id': conversation_id, 'thinking_complete': True, 'final_content': final_main, 'final_thinking': final_thinking, 'rag_references': rag_references, 'tool_calls': executed_tool_calls}, ensure_ascii=False)}\n\n"
                return

        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
    
    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )
