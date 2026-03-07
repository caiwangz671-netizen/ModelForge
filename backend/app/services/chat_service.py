"""Chat service with reasoning support"""
import re
from typing import Optional, Tuple

from app.services.model_capabilities import ModelCapabilityService

try:
    from pylatexenc.latexwalker import LatexWalker, LatexWalkerParseError
except Exception:  # pragma: no cover - graceful fallback when dependency is missing
    LatexWalker = None
    LatexWalkerParseError = Exception


class ChatService:
    """Service for handling chat messages with reasoning support"""
    
    # Models that support reasoning/thinking
    REASONING_MODELS = [
        'deepseek-r1',
        'deepseek-reasoner',
        'qwq',
        'qwq-32b',
        'o1',
        'o1-mini',
        'o3',
        'o3-mini',
    ]
    
    @staticmethod
    def is_reasoning_model(model_name: str) -> bool:
        """Check if model supports reasoning/thinking"""
        return ModelCapabilityService.analyze_model(model_name).supports_reasoning
    
    @staticmethod
    def parse_thinking_content(content: str) -> Tuple[str, Optional[str]]:
        """
        Parse thinking content from model response.
        Returns: (main_content, thinking_content)
        """
        if not content:
            return content, None
        
        # Pattern 1: <think>...</think> tags (DeepSeek-R1, QwQ style)
        think_patterns = [
            r'<think>(.*?)</think>',
            r'<thinking>(.*?)</thinking>',
            r'<\|reasoning\|>(.*?)<\|/reasoning\|>',
            r'<\|analysis\|>(.*?)<\|/analysis\|>',
        ]

        for think_pattern in think_patterns:
            think_match = re.search(think_pattern, content, re.DOTALL)
            if think_match:
                thinking = think_match.group(1).strip()
                # Remove think tags from main content
                main_content = re.sub(think_pattern, '', content, flags=re.DOTALL).strip()
                return main_content, thinking
        
        # Pattern 2: ### Thinking or **Thinking** section
        thinking_headers = [
            r'###\s*Thinking\s*\n(.*?)(?=###|$)',
            r'\*\*Thinking:\*\*\s*\n(.*?)(?=\*\*|\n\n|$)',
            r'###\s*推理过程\s*\n(.*?)(?=###|$)',
            r'###\s*思考过程\s*\n(.*?)(?=###|$)',
        ]
        
        for pattern in thinking_headers:
            match = re.search(pattern, content, re.DOTALL | re.IGNORECASE)
            if match:
                thinking = match.group(1).strip()
                main_content = re.sub(pattern, '', content, flags=re.DOTALL | re.IGNORECASE).strip()
                return main_content, thinking
        
        # Pattern 3: "Let me think..." or "I need to analyze..." at the start
        reasoning_prefixes = [
            r'^(Let me think about this[.\n]*)(.*?)(?=\n\n|\Z)',
            r'^(I need to analyze this[.\n]*)(.*?)(?=\n\n|\Z)',
            r'^(Let me break this down[.\n]*)(.*?)(?=\n\n|\Z)',
        ]
        
        for pattern in reasoning_prefixes:
            match = re.search(pattern, content, re.DOTALL | re.IGNORECASE)
            if match and len(match.group(2)) > 50:  # Ensure substantial thinking content
                thinking = match.group(1) + match.group(2)
                main_content = content[len(thinking):].strip()
                return main_content, thinking
        
        return content, None

    @staticmethod
    def _split_markdown_by_code(content: str) -> list[tuple[str, bool]]:
        """
        Split markdown into plain/code segments.
        Returns list[(text, is_code)] where code includes fenced and inline code.
        """
        if not content:
            return []

        segments: list[tuple[str, bool]] = []
        cursor = 0
        length = len(content)

        while cursor < length:
            fence_start = content.find("```", cursor)
            inline_start = content.find("`", cursor)

            next_start = -1
            next_type = None

            if fence_start != -1:
                next_start = fence_start
                next_type = "fence"
            if inline_start != -1 and (next_start == -1 or inline_start < next_start):
                next_start = inline_start
                next_type = "inline"

            if next_start == -1 or next_type is None:
                segments.append((content[cursor:], False))
                break

            if next_start > cursor:
                segments.append((content[cursor:next_start], False))

            if next_type == "fence":
                fence_end = content.find("```", next_start + 3)
                if fence_end == -1:
                    segments.append((content[next_start:], True))
                    break
                segments.append((content[next_start:fence_end + 3], True))
                cursor = fence_end + 3
                continue

            line_end = content.find("\n", next_start + 1)
            inline_end = content.find("`", next_start + 1)
            if inline_end != -1 and (line_end == -1 or inline_end < line_end):
                segments.append((content[next_start:inline_end + 1], True))
                cursor = inline_end + 1
                continue

            # Lone backtick, treat as plain text.
            segments.append((content[next_start:next_start + 1], False))
            cursor = next_start + 1

        return segments

    @staticmethod
    def _is_escaped(text: str, index: int) -> bool:
        backslashes = 0
        cursor = index - 1
        while cursor >= 0 and text[cursor] == "\\":
            backslashes += 1
            cursor -= 1
        return backslashes % 2 == 1

    @classmethod
    def _find_unescaped_double_dollars(cls, line: str) -> list[int]:
        indices: list[int] = []
        i = 0
        while i < len(line) - 1:
            if line[i] == "$" and line[i + 1] == "$" and not cls._is_escaped(line, i):
                indices.append(i)
                i += 2
                continue
            i += 1
        return indices

    @staticmethod
    def _escape_double_dollars(line: str, token_indices: list[int]) -> str:
        if not token_indices:
            return line
        escape_positions = set()
        for index in token_indices:
            escape_positions.add(index)
            escape_positions.add(index + 1)
        parts = []
        for idx, char in enumerate(line):
            if idx in escape_positions:
                parts.append("\\")
            parts.append(char)
        return "".join(parts)

    @classmethod
    def _sanitize_display_dollars(cls, text: str) -> str:
        lines = text.split("\n")
        in_display_block = False
        sanitized: list[str] = []

        for line in lines:
            trimmed = line.strip()
            if trimmed == "$$":
                in_display_block = not in_display_block
                sanitized.append(line)
                continue
            if in_display_block:
                sanitized.append(line)
                continue

            tokens = cls._find_unescaped_double_dollars(line)
            if tokens and len(tokens) % 2 == 1:
                sanitized.append(cls._escape_double_dollars(line, tokens))
                continue
            sanitized.append(line)

        return "\n".join(sanitized)

    @classmethod
    def _is_single_dollar(cls, line: str, index: int) -> bool:
        if line[index] != "$":
            return False
        if cls._is_escaped(line, index):
            return False
        if index > 0 and line[index - 1] == "$":
            return False
        if index < len(line) - 1 and line[index + 1] == "$":
            return False
        return True

    @classmethod
    def _looks_like_inline_math_payload(cls, payload: str) -> bool:
        trimmed = payload.strip()
        if not trimmed:
            return False

        # Currency / pure numeric text should not be treated as math.
        if re.fullmatch(r"[\d\s,._%+-]+", trimmed):
            return False

        # Strong math indicators.
        if re.search(r"\\[A-Za-z]+|[_^{}=+\-*/<>≤≥≠]", trimmed):
            return True

        # Variable-like short tokens, e.g. x, x_1, abc.
        if re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,7}", trimmed):
            return True

        # Equation-like patterns.
        if re.fullmatch(r"[A-Za-z0-9]+(?:\s*[=+\-*/<>]\s*[A-Za-z0-9]+)+", trimmed):
            return True

        return False

    @classmethod
    def _escape_unpaired_inline_dollars(cls, line: str) -> str:
        indices = [i for i, char in enumerate(line) if char == "$" and cls._is_single_dollar(line, i)]
        if not indices:
            return line

        escape_indices = set()
        open_index: Optional[int] = None

        for idx in indices:
            if open_index is None:
                open_index = idx
                continue

            payload = line[open_index + 1:idx]
            if cls._looks_like_inline_math_payload(payload):
                open_index = None
                continue

            # Current pair doesn't look like math; treat previous '$' as literal
            # and use current '$' as a fresh candidate opening delimiter.
            escape_indices.add(open_index)
            open_index = idx

        if open_index is not None:
            escape_indices.add(open_index)

        if not escape_indices:
            return line

        parts = []
        for idx, char in enumerate(line):
            if idx in escape_indices:
                parts.append("\\")
            parts.append(char)
        return "".join(parts)

    @classmethod
    def _sanitize_inline_dollars(cls, text: str) -> str:
        return "\n".join(cls._escape_unpaired_inline_dollars(line) for line in text.split("\n"))

    @staticmethod
    def _normalize_display_fence_lines(text: str) -> str:
        lines = []
        for line in text.split("\n"):
            if line.strip() in ("$$", r"\$\$"):
                lines.append("$$")
            else:
                lines.append(line)
        return "\n".join(lines)

    @classmethod
    def _restore_escaped_inline_math(cls, text: str) -> str:
        pattern = re.compile(r"\\\$(?!\$)([^$\n]{1,400}?)(?<!\\)\\\$(?!\$)")

        def repl(match: re.Match[str]) -> str:
            body = match.group(1)
            if cls._looks_like_inline_math_payload(body):
                return f"${body}$"
            return match.group(0)

        return pattern.sub(repl, text)

    @staticmethod
    def _normalize_inline_display_math(text: str) -> str:
        normalized_lines: list[str] = []
        for line in text.split("\n"):
            trimmed = line.strip()
            if trimmed.startswith("$$") and trimmed.endswith("$$") and len(trimmed) > 4:
                body = trimmed[2:-2].strip()
                if body:
                    normalized_lines.extend(["$$", body, "$$"])
                    continue

            inline_match = re.match(r"^(?P<prefix>.*?)\$\$(?P<body>.+?)\$\$(?P<suffix>.*)$", line)
            if inline_match:
                prefix = inline_match.group("prefix").strip()
                body = inline_match.group("body").strip()
                suffix = inline_match.group("suffix").strip()
                if body and "$$" not in prefix and "$$" not in suffix:
                    if prefix:
                        normalized_lines.append(prefix)
                    normalized_lines.extend(["$$", body, "$$"])
                    if suffix:
                        normalized_lines.append(suffix)
                    continue

            normalized_lines.append(line)
        return "\n".join(normalized_lines)

    @staticmethod
    def _repair_markdown_fence_conflicts(text: str) -> str:
        """
        Repair common malformed mixed markdown output:
        - odd number of ``` fences
        - display math opened by $$ but accidentally closed by ``` line
        """
        lines = text.split("\n")
        repaired: list[str] = []
        in_code_fence = False
        in_display_math = False

        for line in lines:
            stripped = line.strip()

            if stripped.startswith("```"):
                if not in_code_fence and in_display_math and stripped == "```":
                    repaired.append("$$")
                    in_display_math = False
                    continue

                in_code_fence = not in_code_fence
                repaired.append(line)
                continue

            if not in_code_fence and stripped == "$$":
                in_display_math = not in_display_math

            repaired.append(line)

        if in_display_math:
            repaired.append("$$")
        if in_code_fence:
            repaired.append("```")

        return "\n".join(repaired)

    @staticmethod
    def _collapse_trivial_code_fences(text: str) -> str:
        """
        Collapse low-information fenced blocks like:
        ```text
        web_search
        ```
        into plain text, to reduce noisy formatting.
        """
        fence_pattern = re.compile(r"```(?:text|plaintext|txt)?\s*\n([^\n`]{1,80})\n```", re.IGNORECASE)

        def repl(match: re.Match[str]) -> str:
            body = match.group(1).strip()
            if not body:
                return match.group(0)
            if re.fullmatch(r"[A-Za-z0-9_\-./: ]{1,80}", body):
                return body
            return match.group(0)

        return fence_pattern.sub(repl, text)

    @staticmethod
    def _replace_delimited_math(
        text: str,
        open_token: str,
        close_token: str,
        wrapper,
    ) -> str:
        if open_token not in text:
            return text

        cursor = 0
        parts: list[str] = []
        length = len(text)
        open_len = len(open_token)
        close_len = len(close_token)

        while cursor < length:
            start = text.find(open_token, cursor)
            if start == -1:
                parts.append(text[cursor:])
                break

            parts.append(text[cursor:start])
            end = text.find(close_token, start + open_len)
            if end == -1:
                parts.append(text[start:])
                break

            body = text[start + open_len:end].strip()
            parts.append(wrapper(body))
            cursor = end + close_len

        return "".join(parts)

    @classmethod
    def _convert_latex_delimiters(cls, text: str) -> str:
        converted = cls._replace_delimited_math(
            text,
            r"\[",
            r"\]",
            lambda body: f"\n$$\n{body}\n$$\n" if body else r"\[\]",
        )
        converted = cls._replace_delimited_math(
            converted,
            r"\(",
            r"\)",
            lambda body: f"${body}$" if body else r"\(\)",
        )

        env_pattern = re.compile(
            r"\\begin\{(equation\*?|align\*?|gather\*?|multline\*?)\}([\s\S]*?)\\end\{\1\}"
        )
        converted = env_pattern.sub(
            lambda m: f"\n$$\n{m.group(2).strip()}\n$$\n" if m.group(2).strip() else "$$",
            converted,
        )
        return converted

    @staticmethod
    def _is_valid_latex_math(expr: str) -> bool:
        """Validation is skipped — KaTeX itself handles invalid formulas gracefully.
        
        pylatexenc produced too many false-negatives for valid KaTeX expressions,
        causing correct formulas to be incorrectly escaped on the backend.
        KaTeX is configured with throwOnError: false / strict: 'ignore', so it
        renders partial/invalid formulas as error text rather than crashing.
        """
        return True

    @staticmethod
    def _convert_latex_list_block_to_markdown(body: str) -> Optional[str]:
        """
        Convert LaTeX list environments in display blocks to markdown lists.
        Supported:
          \\begin{itemize} ... \\end{itemize}
          \\begin{enumerate} ... \\end{enumerate}
        """
        env_match = re.match(
            r"^\s*\\begin\{(itemize|enumerate)\}\s*([\s\S]*?)\s*\\end\{\1\}\s*$",
            body,
            flags=re.IGNORECASE,
        )
        if not env_match:
            return None

        env = env_match.group(1).lower()
        payload = env_match.group(2)
        lines = payload.split("\n")

        items: list[str] = []
        current_item: Optional[str] = None

        for raw_line in lines:
            stripped = raw_line.strip()
            if not stripped:
                continue

            if stripped.startswith(r"\item"):
                if current_item:
                    items.append(current_item.strip())
                current_item = stripped[len(r"\item"):].strip()
                continue

            if stripped.startswith(r"\subitem"):
                sub = stripped[len(r"\subitem"):].strip()
                if current_item:
                    current_item = f"{current_item}\n  - {sub}"
                else:
                    current_item = f"- {sub}"
                continue

            if current_item:
                current_item = f"{current_item} {stripped}"
            else:
                current_item = stripped

        if current_item:
            items.append(current_item.strip())

        if not items:
            return None

        if env == "itemize":
            return "\n".join(f"- {item}" for item in items)

        numbered = []
        for idx, item in enumerate(items, start=1):
            numbered.append(f"{idx}. {item}")
        return "\n".join(numbered)

    @classmethod
    def _convert_escaped_latex_list_block_to_markdown(cls, text: str) -> str:
        pattern = re.compile(r'\\\$\\\$([\s\S]*?)\\\$\\\$')

        def repl(match: re.Match[str]) -> str:
            body = match.group(1)
            converted = cls._convert_latex_list_block_to_markdown(body)
            if converted:
                return f"\n{converted}\n"
            return match.group(0)

        return pattern.sub(repl, text)

    @classmethod
    def _escape_invalid_display_math(cls, text: str) -> str:
        pattern = re.compile(r'(?<!\\)\$\$([\s\S]*?)(?<!\\)\$\$')
        unsupported_env_pattern = re.compile(
            r"\\begin\{(itemize|enumerate|description|table|figure|tabular|theorem|proof)\}",
            re.IGNORECASE,
        )

        def repl(match: re.Match[str]) -> str:
            body = match.group(1)
            if unsupported_env_pattern.search(body):
                list_markdown = cls._convert_latex_list_block_to_markdown(body)
                if list_markdown:
                    return f"\n{list_markdown}\n"
                return f"\\$\\${body}\\$\\$"
            if cls._is_valid_latex_math(body):
                return match.group(0)
            return f"\\$\\${body}\\$\\$"

        return pattern.sub(repl, text)

    @classmethod
    def _escape_invalid_inline_math(cls, text: str) -> str:
        lines = []
        pattern = re.compile(r'(?<!\\)\$(?!\$)(.*?)(?<!\\)\$(?!\$)')

        for line in text.split("\n"):
            def repl(match: re.Match[str]) -> str:
                body = match.group(1)
                if cls._is_valid_latex_math(body):
                    return match.group(0)
                return f"\\${body}\\$"

            lines.append(pattern.sub(repl, line))
        return "\n".join(lines)

    @classmethod
    def sanitize_math_markdown(cls, content: str) -> str:
        """
        Python-side normalization for markdown/math mixed output.
        Goal: prevent malformed $/$$ from swallowing large text regions in frontend math renderers.
        """
        if not content:
            return content

        normalized = (
            content
            .replace("\r\n", "\n")
            .replace("\r", "\n")
        )
        normalized = re.sub(r"\\n(?=[^A-Za-z])", "\n", normalized)
        normalized = re.sub(r"---(?=#{1,6}\s)", "---\n", normalized)
        normalized = cls._collapse_trivial_code_fences(normalized)
        normalized = cls._repair_markdown_fence_conflicts(normalized)

        processed: list[str] = []
        for segment_text, is_code in cls._split_markdown_by_code(normalized):
            if not segment_text or is_code:
                processed.append(segment_text)
                continue
            fixed = cls._normalize_inline_display_math(segment_text)
            fixed = cls._normalize_display_fence_lines(fixed)
            fixed = cls._restore_escaped_inline_math(fixed)
            fixed = cls._convert_latex_delimiters(fixed)
            fixed = cls._sanitize_display_dollars(fixed)
            fixed = cls._sanitize_inline_dollars(fixed)
            fixed = cls._escape_invalid_display_math(fixed)
            fixed = cls._convert_escaped_latex_list_block_to_markdown(fixed)
            fixed = cls._escape_invalid_inline_math(fixed)
            processed.append(fixed)

        return "".join(processed)
    
    @staticmethod
    def generate_conversation_title(messages: list) -> str:
        """Generate a title for the conversation based on first user message"""
        if not messages:
            return "新对话"
        
        # Find first user message
        first_message = None
        for msg in messages:
            if msg.get('role') == 'user':
                first_message = msg.get('content', '')
                break
        
        if not first_message:
            return "新对话"
        
        # Clean up the message for title
        title = first_message.strip()
        
        # Remove code blocks
        title = re.sub(r'```[\s\S]*?```', '[代码]', title)
        title = re.sub(r'`[^`]*`', '[代码]', title)
        
        # Remove URLs
        title = re.sub(r'https?://\S+', '[链接]', title)
        
        # Remove excessive whitespace
        title = re.sub(r'\s+', ' ', title)
        
        # Truncate to reasonable length
        if len(title) > 30:
            title = title[:27] + "..."
        
        return title if title else "新对话"
    
    @staticmethod
    def summarize_conversation(messages: list, max_length: int = 100) -> str:
        """Generate a summary of the conversation"""
        if not messages:
            return ""
        
        # Get last few exchanges for context
        recent_messages = messages[-6:]  # Last 3 exchanges
        
        summary_parts = []
        for msg in recent_messages:
            role = "用户" if msg.get('role') == 'user' else "助手"
            content = msg.get('content', '')[:50]
            if len(msg.get('content', '')) > 50:
                content += "..."
            summary_parts.append(f"{role}: {content}")
        
        summary = " | ".join(summary_parts)
        if len(summary) > max_length:
            summary = summary[:max_length-3] + "..."
        
        return summary
