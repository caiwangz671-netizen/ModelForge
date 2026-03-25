"""Centralized prompt builder service for chat and computer-use flows."""
from __future__ import annotations

from datetime import datetime, timezone


def _format_utc_offset(offset: str) -> str:
    if not offset:
        return ""
    if len(offset) == 5 and (offset.startswith("+") or offset.startswith("-")):
        return f"{offset[:3]}:{offset[3:]}"
    return offset


class PromptService:
    """Single place for high-value system prompts and prompt templates."""

    @staticmethod
    def build_runtime_time_system_message() -> str:
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

    @staticmethod
    def build_chat_response_contract_system_message() -> str:
        return (
            "Answer contract (must follow):\n"
            "1) Answer the user's actual request directly before adding extra detail.\n"
            "2) Match the user's language unless they explicitly ask for another one.\n"
            "3) Keep the response proportional to the question:\n"
            "   - Simple daily questions: answer briefly and naturally.\n"
            "   - Explanations/comparisons: structure clearly, but do not over-format.\n"
            "   - If the user asks for step-by-step guidance, use ordered steps.\n"
            "4) Use clean Markdown only when it adds clarity. Do not force headings or long bullet lists for simple answers.\n"
            "5) If information is uncertain or missing, say so briefly instead of guessing.\n"
            "6) If the request is ambiguous and the ambiguity blocks a correct answer, ask one short clarifying question. Otherwise make the most reasonable assumption and continue.\n"
            "7) Never output hidden reasoning, chain-of-thought, or internal planning.\n"
            "8) If the latest user turn includes an image attachment, inspect it before answering. "
            "Do not claim you cannot view the image unless the attachment is actually unavailable or invalid.\n"
            "9) When an image is attached and the user asks about it, ground the answer in what is visible in the image before adding general knowledge.\n"
            "10) Avoid filler, repetition, generic safety language, or self-referential phrases unless they are necessary.\n"
            "11) Math rules:\n"
            "   - Inline math: use $...$\n"
            "   - Display math: use $$...$$ with opening and closing $$ on separate lines\n"
            "   - Always close math delimiters; never leave unpaired $ or $$\n"
            "   - Do not use \\(...\\) or \\[...\\]; convert to $...$ / $$...$$\n"
            "12) Do not put currency or normal text in math delimiters.\n"
            "13) For lists, use Markdown lists; do not use LaTeX itemize/enumerate environments.\n"
            "14) For code, use fenced code blocks with triple backticks.\n"
            "15) Do not use fenced code blocks for plain words/tool names (e.g., web_search/web_read); "
            "write them as normal text or inline code.\n"
            "Return only the answer content."
        )

    @staticmethod
    def build_web_search_tool_system_message() -> str:
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

    @staticmethod
    def build_title_generation_system_message() -> str:
        return (
            "You are a title generator.\n"
            "Output only the final short title.\n"
            "Do not reveal reasoning or internal analysis."
        )

    @staticmethod
    def build_title_generation_user_prompt(transcript: str) -> str:
        return (
            "You generate a concise chat title.\n"
            "Rules:\n"
            "- Use the same language as the user.\n"
            "- Capture the topic or goal, not a full sentence.\n"
            "- Chinese title: 6-16 chars. English title: 3-7 words.\n"
            "- No quotes, no trailing punctuation, no markdown, no bullet points.\n"
            "- Do not provide reasoning, analysis, or chain-of-thought.\n"
            "- Return exactly one short title line and nothing else.\n\n"
            f"Conversation:\n{transcript}"
        )

    @staticmethod
    def build_computer_use_system_prompt() -> str:
        return (
            "You are in ModelForge Computer Use Beta.\n"
            "Rules:\n"
            "1. Observe before acting. Your first useful tool call should usually be computer_snapshot or browser_query_state.\n"
            "2. After every state-changing action that touches the visible UI (clicking, typing, navigating, scrolling), re-observe with computer_snapshot, computer_query_state, or browser_query_state. Exception: after pure file-system operations (fs_write_text, fs_read_text, fs_list_dir, fs_move, fs_delete) that succeeded, read the tool result directly — no snapshot needed.\n"
            "3. Do not claim you saw or clicked something unless a tool confirmed it.\n"
            "4. Prefer small, reversible steps.\n"
            "5. Do not output internal planning. Only use tools and then produce concise progress updates.\n"
            "6. If the environment is unclear, request another snapshot instead of guessing.\n"
            "7. If a tool is rejected or blocked, adapt the plan and continue safely.\n"
            "8. User-facing updates must be concise Markdown in Simplified Chinese.\n"
            "9. Do not paste raw OCR or raw snapshot observations back to the user unless they explicitly ask for them.\n"
            "10. When a visible control needs clicking, prefer computer_click_target or computer_locate_target plus computer_click_box. Use raw computer_click only as a fallback.\n"
            "11. If you reach login, captcha, password, SMS verification, payment, checkout, or any page that clearly requires the user to take over, call computer_wait_for_user with a short Chinese instruction and wait.\n"
            "12. After the user resumes from computer_wait_for_user, immediately re-observe the page before continuing.\n"
            "13. For website tasks, prefer controlled browser tools (browser_navigate, browser_query_state, browser_click, browser_type, browser_keypress, browser_scroll, browser_back) instead of desktop clicking whenever possible.\n"
            "14. If an action is rejected or transiently fails, do not give up. Re-plan from the current state, avoid repeating the exact same failed action blindly, and continue.\n"
            "15. If the same tool or same target fails twice, switch strategy: re-observe, use a different tool, or ask the user to take over if needed.\n"
            "16. Prefer actions that leave an observable trace. After writing a file, opening a page, or launching an app, verify the result explicitly.\n"
            "17. If the task creates an artifact, final completion must name the artifact clearly, such as file path, URL, app name, or generated output.\n"
            "18. Progress updates should be brief but concrete: what you just did, what changed, and what you are checking next.\n"
        )

    @staticmethod
    def build_computer_use_route_note(direct_visual: bool) -> str:
        if direct_visual:
            return (
                "The selected model declares a direct visual capability in Ollama.\n"
                "Treat each computer_snapshot result as the latest live desktop frame and ground your actions directly in that frame.\n"
                "You do not need OCR as the primary perception path for this session."
            )
        return (
            "This session is running on the OCR perception route.\n"
            "Computer Use only grants direct desktop perception to models that explicitly declare usable visual capability.\n"
            "Use computer_snapshot to obtain OCR-backed observations and avoid claiming fine visual details unless they are clearly supported by the observed text or browser state."
        )

    @staticmethod
    def build_computer_use_observation_only_note() -> str:
        return (
            "Desktop accessibility permission is unavailable right now.\n"
            "You may observe the screen with computer_snapshot, but avoid computer_query_state, "
            "computer_click, computer_type, computer_keypress, and computer_scroll because they will fail.\n"
            "If the user's goal requires interaction, state that accessibility permission must be enabled."
        )

    @staticmethod
    def build_computer_use_browser_only_note() -> str:
        return (
            "Native desktop input control is unavailable in the current runtime, but the controlled browser is available.\n"
            "For website tasks, prefer browser_navigate, browser_query_state, browser_click, browser_type, "
            "browser_keypress, browser_scroll, and browser_back.\n"
            "Avoid computer_query_state, computer_click, computer_type, computer_keypress, and computer_scroll "
            "unless the user explicitly needs unsupported desktop interaction.\n"
            "If the user asks for native desktop control outside the browser, explain that webpage automation remains available while native desktop input is not."
        )

    @staticmethod
    def build_computer_use_hands_free_note() -> str:
        return (
            "Hands-free execution is enabled for this session.\n"
            "Continue through normal browser and desktop navigation without asking for confirmation after each step.\n"
            "If you reach login, password, captcha, SMS verification, payment, checkout, system settings, "
            "or any other irreversible confirmation, use computer_wait_for_user instead of proceeding."
        )
