import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import katex from 'katex';
import { CodeBlock } from './CodeBlock';
import { cn } from '@/lib/utils';
import { debugMarkdownMathPipeline, preprocessMarkdownContent } from '@/lib/markdownMath';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github-dark.css';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function remarkDisableIndentedCode(this: any) {
  const data = this.data();
  data.micromarkExtensions = data.micromarkExtensions || [];
  data.micromarkExtensions.push({
    disable: { null: ['codeIndented'] },
  });
}

interface MarkdownRendererProps {
  content: string;
  className?: string;
  enableMath?: boolean;
  enableCodeHighlight?: boolean;
  isStreaming?: boolean;
}

const LATEX_FENCE_LANGS = new Set(['latex', 'tex', 'katex', 'math']);
const NON_MATH_LATEX_HINTS = [
  '\\documentclass',
  '\\usepackage',
  '\\begin{document}',
  '\\end{document}',
  '\\section{',
  '\\subsection{',
  '\\chapter{',
  '\\item',
  '\\begin{itemize}',
  '\\begin{enumerate}',
  '\\begin{tabular}',
  '\\begin{verbatim}',
  '\\begin{figure}',
  '\\includegraphics',
  '\\label{',
  '\\ref{',
  '\\footnote',
  '\\thanks',
  '\\author{',
  '\\title{',
  '\\maketitle',
];
const MATH_ENV_PATTERN =
  /\\begin\{(aligned|align\*?|equation\*?|gather\*?|cases|pmatrix|bmatrix|matrix|vmatrix|Vmatrix|smallmatrix|split)\}/i;
const MATH_TOKEN_PATTERN =
  /\\(frac|sqrt|sum|int|lim|alpha|beta|gamma|delta|theta|lambda|pi|sin|cos|tan|log|ln|rightarrow|leftarrow|Rightarrow|cdot|times|leq|geq|neq|infty|partial|nabla|det|vec|hat|bar|overline|underline|text|mathrm|mathbf|mathbb|mathcal)\b|[_^{}]/;

function shouldRenderLatexFenceAsMath(language: string, code: string): boolean {
  const lang = (language || '').toLowerCase();
  if (!LATEX_FENCE_LANGS.has(lang)) return false;

  const trimmed = code.trim();
  if (!trimmed || trimmed.length > 1500) return false;

  for (const hint of NON_MATH_LATEX_HINTS) {
    if (trimmed.includes(hint)) {
      return false;
    }
  }

  return MATH_ENV_PATTERN.test(trimmed) || MATH_TOKEN_PATTERN.test(trimmed);
}

function renderLatexFenceAsMath(code: string): string | null {
  const latex = code.trim();
  if (!latex) return null;
  try {
    return katex.renderToString(latex, {
      displayMode: true,
      throwOnError: false,
      strict: 'ignore',
    });
  } catch {
    return null;
  }
}

export function MarkdownRenderer({
  content,
  className,
  enableMath = true,
  isStreaming = false,
}: MarkdownRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const processedContent = useMemo(
    () => preprocessMarkdownContent(content, enableMath, isStreaming),
    [content, enableMath, isStreaming],
  );

  useEffect(() => {
    if (!import.meta.env.DEV || !enableMath) return;
    const debugEnabled =
      typeof window !== 'undefined' && window.localStorage.getItem('debug:markdown-math') === '1';
    if (!debugEnabled) return;

    const trace = debugMarkdownMathPipeline(content);
    // Dev-only verbose trace to locate markdown/math corruption quickly.
    console.groupCollapsed('[markdown-math] preprocess trace');
    trace.forEach((step) => {
      console.log(step.stage, step.value);
    });
    console.groupEnd();
  }, [content, enableMath]);

  type ChildProps = { children?: ReactNode };
  type CodeProps = ChildProps & { inline?: boolean; className?: string } & React.HTMLAttributes<HTMLElement>;
  type AnchorProps = ChildProps & { href?: string };

  const components = useMemo(() => ({
    code({ inline, className: codeClassName, children, ...props }: CodeProps) {
      const match = /language-(\w+)/.exec(codeClassName || '');
      const language = match ? match[1] : 'text';
      const code = String(children).replace(/\n$/, '');

      // Detect whether this is truly inline:
      // 1. Explicitly marked inline by react-markdown
      // 2. Single-line, short code without a real language → render as inline pill
      const isPlainLang = !match || language === 'text' || language === 'plaintext';
      const isSingleLine = !code.includes('\n');
      const isShort = code.length <= 80;
      const treatAsInline = inline || (isPlainLang && isSingleLine && isShort);

      if (!treatAsInline) {
        if (enableMath && shouldRenderLatexFenceAsMath(language, code)) {
          const html = renderLatexFenceAsMath(code);
          if (html) {
            return (
              <div className="my-4 overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />
            );
          }
        }
        return <CodeBlock code={code} language={language} className="my-4" />;
      }

      return (
        <code
          className={cn(
            'inline-code rounded-md bg-muted/70 px-1.5 py-0.5 text-[0.85em] font-mono text-foreground/90 mx-0.5 border border-border/40',
            codeClassName,
          )}
          {...props}
        >
          {children}
        </code>
      );
    },
    pre({ children }: ChildProps) {
      return <>{children}</>;
    },
    table({ children }: ChildProps) {
      return (
        <div className="my-5 overflow-x-auto rounded-2xl border border-border/70 bg-card/55 shadow-sm">
          <table className="w-full border-collapse text-sm">{children}</table>
        </div>
      );
    },
    th({ children }: ChildProps) {
      return <th className="border-b border-border/70 bg-muted/55 px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{children}</th>;
    },
    td({ children }: ChildProps) {
      return <td className="border-b border-border/60 px-4 py-3 align-top last:border-b-0">{children}</td>;
    },
    blockquote({ children }: ChildProps) {
      return (
        <blockquote className="my-5 rounded-r-2xl border-l-[3px] border-primary/70 bg-muted/28 px-4 py-3 text-[0.96rem] italic leading-7 text-muted-foreground">
          {children}
        </blockquote>
      );
    },
    a({ children, href }: AnchorProps) {
      return (
        <a
          href={href}
          className="font-medium text-primary underline-offset-4 transition-colors hover:text-primary/80 hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          {children}
        </a>
      );
    },
    h1({ children }: ChildProps) {
      return <h1 className="mt-8 mb-4 text-2xl font-semibold tracking-tight text-foreground">{children}</h1>;
    },
    h2({ children }: ChildProps) {
      return <h2 className="mt-7 mb-3 text-xl font-semibold tracking-tight text-foreground">{children}</h2>;
    },
    h3({ children }: ChildProps) {
      return <h3 className="mt-6 mb-2 text-lg font-semibold text-foreground">{children}</h3>;
    },
    ul({ children }: ChildProps) {
      return <ul className="my-3 list-disc space-y-1.5 pl-6">{children}</ul>;
    },
    ol({ children }: ChildProps) {
      return <ol className="my-3 list-decimal space-y-1.5 pl-6">{children}</ol>;
    },
    li({ children }: ChildProps) {
      return <li className="pl-1 leading-7 marker:text-muted-foreground">{children}</li>;
    },
    p({ children }: ChildProps) {
      return <p className="my-3 break-words leading-7 text-[0.98rem] text-foreground/92">{children}</p>;
    },
    hr() {
      return <hr className="my-6 border-border/70" />;
    },
    img({ src, alt }: React.ImgHTMLAttributes<HTMLImageElement>) {
      return (
        <figure className="my-5 overflow-hidden rounded-2xl border border-border/70 bg-card/50 shadow-sm">
          <img src={src} alt={alt} className="max-h-[520px] w-full object-contain bg-black/10" />
          {alt ? (
            <figcaption className="border-t border-border/70 px-4 py-2 text-xs text-muted-foreground">
              {alt}
            </figcaption>
          ) : null}
        </figure>
      );
    },
  }), [enableMath]);

  const remarkPlugins = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plugins: any[] = [remarkDisableIndentedCode];
    if (enableMath) {
      plugins.push([remarkMath, { singleDollarTextMath: true }]);
    }
    plugins.push(remarkGfm);
    return plugins;
  }, [enableMath]);

  const rehypePlugins = useMemo(() => {
    if (!enableMath) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return [[rehypeKatex, { throwOnError: false, strict: 'ignore' }]] as any[];
  }, [enableMath]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'prose prose-sm max-w-none dark:prose-invert',
        'prose-headings:font-semibold prose-headings:text-foreground',
        'prose-strong:text-foreground prose-em:text-foreground/90',
        'prose-a:text-primary',
        'prose-code:before:content-none prose-code:after:content-none prose-code:font-semibold',
        'prose-pre:overflow-x-auto prose-pre:border prose-pre:border-border/70 prose-pre:bg-card/70 prose-pre:shadow-sm',
        'prose-p:my-3 prose-p:leading-7 prose-ul:my-3 prose-ol:my-3 prose-li:my-1.5',
        '[&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden',
        '[&_.katex-error]:text-muted-foreground [&_.katex-error]:border-none',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {processedContent}
      </ReactMarkdown>
    </div>
  );
}

export function StreamingMarkdownRenderer({
  content,
  className,
  enableMath = false,
  enableCodeHighlight = false,
}: MarkdownRendererProps) {
  return (
    <MarkdownRenderer
      content={content}
      className={className}
      enableMath={enableMath}
      enableCodeHighlight={enableCodeHighlight}
      isStreaming={true}
    />
  );
}
