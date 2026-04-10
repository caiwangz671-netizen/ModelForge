type MarkdownSegment = {
  text: string;
  isCode: boolean;
};

export interface MarkdownMathTraceStep {
  stage: string;
  value: string;
}

function splitMarkdownByCode(content: string): MarkdownSegment[] {
  if (!content) return [];

  const segments: MarkdownSegment[] = [];
  let cursor = 0;

  while (cursor < content.length) {
    const fenceStart = content.indexOf("```", cursor);
    const inlineStart = content.indexOf("`", cursor);

    let nextStart = -1;
    let nextType: "fence" | "inline" | null = null;

    if (fenceStart !== -1) {
      nextStart = fenceStart;
      nextType = "fence";
    }
    if (inlineStart !== -1 && (nextStart === -1 || inlineStart < nextStart)) {
      nextStart = inlineStart;
      nextType = "inline";
    }

    if (nextStart === -1 || nextType === null) {
      segments.push({ text: content.slice(cursor), isCode: false });
      break;
    }

    if (nextStart > cursor) {
      segments.push({ text: content.slice(cursor, nextStart), isCode: false });
    }

    if (nextType === "fence") {
      const fenceEnd = content.indexOf("```", nextStart + 3);
      if (fenceEnd === -1) {
        segments.push({ text: content.slice(nextStart), isCode: true });
        break;
      }
      segments.push({
        text: content.slice(nextStart, fenceEnd + 3),
        isCode: true,
      });
      cursor = fenceEnd + 3;
      continue;
    }

    const lineEnd = content.indexOf("\n", nextStart + 1);
    const inlineEnd = content.indexOf("`", nextStart + 1);
    if (inlineEnd !== -1 && (lineEnd === -1 || inlineEnd < lineEnd)) {
      segments.push({ text: content.slice(nextStart, inlineEnd + 1), isCode: true });
      cursor = inlineEnd + 1;
      continue;
    }

    // Lone backtick: keep as plain text.
    segments.push({ text: content.slice(nextStart, nextStart + 1), isCode: false });
    cursor = nextStart + 1;
  }

  return segments;
}

function normalizeCommonMarkdownInput(content: string): string {
  return content
    .replace(/\r\n?/g, "\n")
    // Decode escaped newlines in model text for markdown blocks/headings.
    .replace(/\\n(?=[^A-Za-z])/g, "\n")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/&nbsp;/gi, " ")
    .replace(/^[ \t]*\\\$\$[ \t]*$/gm, "$$")
    .replace(/---(?=#{1,6}\s)/g, "---\n")
    .replace(/\u200B/g, "");
}

const SIMPLE_FENCE_LANGS = new Set(["", "text", "txt", "plaintext", "plain", "shell", "sh", "bash", "zsh", "console", "cmd"]);

function shouldCollapseSimpleFence(lang: string, body: string): boolean {
  const normalizedLang = lang.trim().toLowerCase();
  if (!SIMPLE_FENCE_LANGS.has(normalizedLang)) return false;

  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length !== 1) return false;

  const value = lines[0];
  if (!value || value.length > 72) return false;
  if (value.includes("`")) return false;
  if (/^\s*[-*]\s+/.test(value)) return false;
  if (/[{};]/.test(value)) return false;

  return true;
}

function collapseSimpleCodeFences(content: string): string {
  if (!content.includes("```")) return content;

  return content.replace(/```([^\n`]*)\n([\s\S]*?)\n```/g, (match, lang: string, body: string) => {
    if (!shouldCollapseSimpleFence(lang || "", body || "")) {
      return match;
    }

    const line = body.trim().split("\n").map((item) => item.trim()).filter(Boolean)[0];
    return `\`${line}\``;
  });
}

function countUnescapedTokenOccurrences(text: string, token: string): number {
  if (!text || !token) return 0;
  let count = 0;
  let cursor = 0;

  while (cursor < text.length) {
    const idx = text.indexOf(token, cursor);
    if (idx === -1) break;
    if (!isEscaped(text, idx)) count += 1;
    cursor = idx + token.length;
  }

  return count;
}

function replaceDelimitedMath(
  text: string,
  openToken: string,
  closeToken: string,
  wrapper: (body: string) => string,
): string {
  if (!text || !openToken || !closeToken || openToken === closeToken) return text;
  if (!text.includes(openToken)) return text;

  const parts: string[] = [];
  const openLen = openToken.length;
  const closeLen = closeToken.length;
  let cursor = 0;

  while (cursor < text.length) {
    const start = text.indexOf(openToken, cursor);
    if (start === -1) {
      parts.push(text.slice(cursor));
      break;
    }

    if (isEscaped(text, start)) {
      parts.push(text.slice(cursor, start + openLen));
      cursor = start + openLen;
      continue;
    }

    parts.push(text.slice(cursor, start));

    let end = text.indexOf(closeToken, start + openLen);
    while (end !== -1 && isEscaped(text, end)) {
      end = text.indexOf(closeToken, end + closeLen);
    }

    if (end === -1) {
      parts.push(text.slice(start));
      break;
    }

    const body = text.slice(start + openLen, end).trim();
    parts.push(wrapper(body));
    cursor = end + closeLen;
  }

  return parts.join("");
}

function normalizeLatexDelimitersInPlainSegment(content: string): string {
  if (!content) return content;

  let converted = replaceDelimitedMath(
    content,
    "\\[",
    "\\]",
    (body) => (body ? `\n$$\n${body}\n$$\n` : "\\[\\]"),
  );

  converted = replaceDelimitedMath(
    converted,
    "\\(",
    "\\)",
    (body) => (body ? `$${body}$` : "\\(\\)"),
  );

  converted = converted.replace(
    /\\begin\{(equation\*?|align\*?|gather\*?|multline\*?)\}([\s\S]*?)\\end\{\1\}/g,
    (_, _env: string, body: string) => {
      const trimmed = (body || "").trim();
      return trimmed ? `\n$$\n${trimmed}\n$$\n` : "$$";
    },
  );

  const normalizedLines: string[] = [];
  for (const line of converted.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("$$") && trimmed.endsWith("$$") && trimmed.length > 4) {
      const body = trimmed.slice(2, -2).trim();
      if (body) {
        normalizedLines.push("$$", body, "$$");
        continue;
      }
    }

    const inlineMatch = line.match(/^(?<prefix>.*?)\$\$(?<body>.+?)\$\$(?<suffix>.*)$/);
    if (inlineMatch?.groups) {
      const prefix = inlineMatch.groups.prefix.trim();
      const body = inlineMatch.groups.body.trim();
      const suffix = inlineMatch.groups.suffix.trim();
      if (body && !prefix.includes("$$") && !suffix.includes("$$")) {
        if (prefix) normalizedLines.push(prefix);
        normalizedLines.push("$$", body, "$$");
        if (suffix) normalizedLines.push(suffix);
        continue;
      }
    }

    normalizedLines.push(line);
  }

  converted = normalizedLines.join("\n");
  return converted;
}

function normalizeLatexMathDelimiters(content: string): string {
  if (!content) return content;
  return splitMarkdownByCode(content)
    .map((segment) => {
      if (!segment.text || segment.isCode) return segment.text;
      return normalizeLatexDelimitersInPlainSegment(segment.text);
    })
    .join("");
}

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function hasOddFencedCodeBlocks(content: string): boolean {
  let count = 0;
  let cursor = 0;
  while (cursor < content.length) {
    const idx = content.indexOf("```", cursor);
    if (idx === -1) break;
    if (!isEscaped(content, idx)) count += 1;
    cursor = idx + 3;
  }
  return count % 2 === 1;
}

function countUnescapedDisplayDollars(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length - 1; i += 1) {
    if (text[i] !== "$" || text[i + 1] !== "$") continue;
    if (isEscaped(text, i)) continue;
    count += 1;
    i += 1;
  }
  return count;
}

function shouldAutoCloseInlineMathPayload(payload: string): boolean {
  const trimmed = payload.trim();
  if (!trimmed) return false;

  // Avoid interpreting plain currency-like text as math.
  if (/^\d[\d\s,._%+-]*$/.test(trimmed)) {
    return false;
  }

  // Typical LaTeX / math tokens.
  if (/[\\^_=+\-*/{}()[\]]/.test(trimmed)) {
    return true;
  }

  // Variables like $x or $abc in partial stream should render early.
  return /[A-Za-z]/.test(trimmed);
}

function restoreEscapedInlineMathDelimiters(content: string): string {
  if (!content) return content;
  return content.replace(/\\\$(?!\$)([^$\n]{1,400}?)(?<!\\)\\\$(?!\$)/g, (match, body: string) => {
    if (!shouldAutoCloseInlineMathPayload(body)) return match;
    return `$${body}$`;
  });
}

function autoCloseUnpairedInlineDollars(line: string): string {
  let openPos: number | null = null;

  for (let i = 0; i < line.length; i += 1) {
    if (line[i] !== "$") continue;
    if (isEscaped(line, i)) continue;
    if ((i > 0 && line[i - 1] === "$") || (i < line.length - 1 && line[i + 1] === "$")) continue;

    const prev = i > 0 ? line[i - 1] : "";
    const next = i < line.length - 1 ? line[i + 1] : "";
    const canOpen = Boolean(next) && !/\s/.test(next);
    const canClose = Boolean(prev) && !/\s/.test(prev);

    if (openPos === null) {
      if (canOpen) {
        openPos = i;
      }
      continue;
    }

    if (canClose) {
      openPos = null;
    }
  }

  if (openPos !== null) {
    const payload = line.slice(openPos + 1);
    if (shouldAutoCloseInlineMathPayload(payload)) {
      return `${line}$`;
    }
  }

  return line;
}

function applyStreamingMathStabilizer(content: string): string {
  if (!content) return content;

  let next = content;

  // Ensure display math fences are balanced in non-code segments.
  const segments = splitMarkdownByCode(next);
  let displayDollarCount = 0;
  let displayBracketOpenCount = 0;
  let displayBracketCloseCount = 0;
  let inlineParenOpenCount = 0;
  let inlineParenCloseCount = 0;
  for (const segment of segments) {
    if (segment.isCode) continue;
    displayDollarCount += countUnescapedDisplayDollars(segment.text);
    displayBracketOpenCount += countUnescapedTokenOccurrences(segment.text, "\\[");
    displayBracketCloseCount += countUnescapedTokenOccurrences(segment.text, "\\]");
    inlineParenOpenCount += countUnescapedTokenOccurrences(segment.text, "\\(");
    inlineParenCloseCount += countUnescapedTokenOccurrences(segment.text, "\\)");
  }
  if (displayDollarCount % 2 === 1) {
    next += "\n$$";
  }
  if (displayBracketOpenCount > displayBracketCloseCount) {
    next += "\n\\]".repeat(displayBracketOpenCount - displayBracketCloseCount);
  }
  if (inlineParenOpenCount > inlineParenCloseCount) {
    next += "\\)".repeat(inlineParenOpenCount - inlineParenCloseCount);
  }

  // Auto-close incomplete inline math markers in non-code text.
  return splitMarkdownByCode(next)
    .map((segment) => {
      if (segment.isCode || !segment.text) return segment.text;
      return segment.text
        .split("\n")
        .map((line) => autoCloseUnpairedInlineDollars(line))
        .join("\n");
    })
    .join("");
}

export function debugMarkdownMathPipeline(content: string): MarkdownMathTraceStep[] {
  const normalized = normalizeCommonMarkdownInput(collapseSimpleCodeFences(content));
  const escapedRepaired = restoreEscapedInlineMathDelimiters(normalized);
  const latexNormalized = normalizeLatexMathDelimiters(escapedRepaired);
  const stabilized = applyStreamingMathStabilizer(latexNormalized);
  const postLatexNormalized = normalizeLatexMathDelimiters(stabilized);
  return [
    { stage: "input", value: content },
    { stage: "normalizeCommonMarkdownInput", value: normalized },
    { stage: "restoreEscapedInlineMathDelimiters", value: escapedRepaired },
    { stage: "normalizeLatexMathDelimiters", value: latexNormalized },
    { stage: "applyStreamingMathStabilizer", value: stabilized },
    { stage: "normalizeLatexMathDelimiters(post)", value: postLatexNormalized },
  ];
}

export function preprocessMarkdownContent(
  content: string,
  enableMath: boolean,
  isStreaming = false,
): string {
  const collapsed = collapseSimpleCodeFences(content);
  const normalized = splitMarkdownByCode(collapsed)
    .map((segment) => {
      if (!segment.text || segment.isCode) return segment.text;
      return restoreEscapedInlineMathDelimiters(normalizeCommonMarkdownInput(segment.text));
    })
    .join("");

  // Keep streaming and final rendering logic consistent for math stability.
  let output = normalized;
  if (isStreaming && hasOddFencedCodeBlocks(output)) {
    output += "\n```";
  }

  if (!enableMath) return output;
  output = normalizeLatexMathDelimiters(output);
  output = applyStreamingMathStabilizer(output);
  return normalizeLatexMathDelimiters(output);
}
