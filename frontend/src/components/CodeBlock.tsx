import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

interface CodeBlockProps {
  code: string;
  language?: string;
  className?: string;
}

const languageMap: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  rb: 'ruby',
  sh: 'bash',
  shell: 'bash',
  yml: 'yaml',
  json: 'json',
  md: 'markdown',
  html: 'html',
  css: 'css',
  sql: 'sql',
  rust: 'rust',
  go: 'go',
  cpp: 'cpp',
  c: 'c',
  java: 'java',
};

// Language labels displayed in the header
const languageDisplayNames: Record<string, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  ruby: 'Ruby',
  bash: 'Bash',
  yaml: 'YAML',
  json: 'JSON',
  markdown: 'Markdown',
  html: 'HTML',
  css: 'CSS',
  sql: 'SQL',
  rust: 'Rust',
  go: 'Go',
  cpp: 'C++',
  c: 'C',
  java: 'Java',
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Code Block Component with Syntax Highlighting.
 * Clean header with language label + copy button; no line-number gutter.
 */
export function CodeBlock({ code, language = 'text', className }: CodeBlockProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const normalizedLang = languageMap[language.toLowerCase()] || language.toLowerCase();
  const isPlainText = normalizedLang === 'text' || normalizedLang === 'plaintext';
  const headerLabel = isPlainText ? null : (languageDisplayNames[normalizedLang] || normalizedLang);

  const [highlightedHtml, setHighlightedHtml] = useState<string>(() => escapeHtml(code));

  useEffect(() => {
    if (isPlainText) {
      setHighlightedHtml(escapeHtml(code));
      return;
    }
    let active = true;
    import('highlight.js').then((hljs) => {
      if (!active) return;
      try {
        const supported = hljs.default.getLanguage(normalizedLang);
        const result = supported
          ? hljs.default.highlight(code, { language: normalizedLang, ignoreIllegals: true })
          : hljs.default.highlightAuto(code);
        setHighlightedHtml(result.value);
      } catch {
        setHighlightedHtml(escapeHtml(code));
      }
    });
    return () => { active = false; };
  }, [code, normalizedLang, isPlainText]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={cn(
      'group relative my-4 rounded-xl overflow-hidden',
      'border border-zinc-800/80 bg-zinc-950',
      'shadow-sm',
      className,
    )}>
      {/* Header: language label (left) + copy button (right) */}
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-900/90 border-b border-zinc-800/80">
        <span className="text-[11px] font-medium text-zinc-400 select-none tracking-wide">
          {headerLabel ?? 'text'}
        </span>
        <Button
          variant="secondary"
          size="sm"
          className="h-7 gap-1.5 px-2.5 text-[10px] font-medium text-zinc-300 bg-zinc-800/60 hover:text-zinc-100 hover:bg-zinc-700/80 border border-zinc-700/50 transition-all active:scale-95"
          onClick={handleCopy}
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" />
              <span className="text-emerald-400/90">{t('code.copied')}</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              {t('code.copy')}
            </>
          )}
        </Button>
      </div>

      {/* Code content — no line-number gutter */}
      <pre className="overflow-x-auto px-4 py-3.5 bg-zinc-950 m-0">
        <code
          className={cn(
            'text-sm font-mono leading-6',
            !isPlainText && `hljs language-${normalizedLang}`,
          )}
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      </pre>
    </div>
  );
}

/**
 * Inline code component
 */
export function InlineCode({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <code className={cn('px-1.5 py-0.5 rounded text-sm font-mono bg-muted text-muted-foreground', className)}>
      {children}
    </code>
  );
}
