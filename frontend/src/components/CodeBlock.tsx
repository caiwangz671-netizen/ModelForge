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
 * Uses hljs.highlight() + dangerouslySetInnerHTML for React-safe, streaming-compatible highlighting.
 * Code is highlighted on every code/language change, including during streaming.
 */
export function CodeBlock({ code, language = 'text', className }: CodeBlockProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const displayLanguage = languageMap[language.toLowerCase()] || language;

  // Start with escaped plain text; update to highlighted HTML async.
  const [highlightedHtml, setHighlightedHtml] = useState<string>(() => escapeHtml(code));

  useEffect(() => {
    let active = true;
    import('highlight.js').then((hljs) => {
      if (!active) return;
      try {
        const supported = hljs.default.getLanguage(displayLanguage);
        const result = supported
          ? hljs.default.highlight(code, { language: displayLanguage, ignoreIllegals: true })
          : hljs.default.highlightAuto(code);
        setHighlightedHtml(result.value);
      } catch {
        setHighlightedHtml(escapeHtml(code));
      }
    });
    return () => {
      active = false;
    };
  }, [code, displayLanguage]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={cn('relative group rounded-lg overflow-hidden border border-zinc-800 bg-zinc-950 text-zinc-100', className)}>
      {/* Header with language and copy button */}
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-900 border-b border-zinc-800">
        <span className="text-xs font-mono text-zinc-400 uppercase">{displayLanguage}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-zinc-300 hover:text-white hover:bg-zinc-800 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={handleCopy}
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 mr-1" />
              {t('code.copied')}
            </>
          ) : (
            <>
              <Copy className="h-3 w-3 mr-1" />
              {t('code.copy')}
            </>
          )}
        </Button>
      </div>

      {/* Code content with line numbers */}
      <div className="flex">
        {/* Line numbers */}
        <div className="hidden sm:block px-3 py-4 text-right bg-zinc-900/80 border-r border-zinc-800 select-none">
          {code.split('\n').map((_, i) => (
            <div key={i} className="text-xs text-zinc-500 font-mono leading-5">
              {i + 1}
            </div>
          ))}
        </div>

        {/* Code: dangerouslySetInnerHTML so React never clobbers hljs output */}
        <pre className="flex-1 p-4 overflow-x-auto bg-zinc-950">
          <code
            className={`hljs language-${displayLanguage} text-sm font-mono leading-5`}
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        </pre>
      </div>
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
