import { useEffect, useMemo, useRef } from 'react';
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

  const components = useMemo(() => ({
    code({ inline, className: codeClassName, children, ...props }: any) {
      const match = /language-(\w+)/.exec(codeClassName || '');
      const language = match ? match[1] : 'text';
      const code = String(children).replace(/\n$/, '');

      if (!inline) {
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
          className={cn('px-1.5 py-0.5 rounded text-sm font-mono bg-muted', codeClassName)}
          {...props}
        >
          {children}
        </code>
      );
    },
    pre({ children }: any) {
      return <>{children}</>;
    },
    table({ children }: any) {
      return (
        <div className="overflow-x-auto my-4">
          <table className="w-full border-collapse">{children}</table>
        </div>
      );
    },
    th({ children }: any) {
      return <th className="border px-4 py-2 text-left font-semibold bg-muted">{children}</th>;
    },
    td({ children }: any) {
      return <td className="border px-4 py-2">{children}</td>;
    },
    blockquote({ children }: any) {
      return (
        <blockquote className="border-l-4 border-primary pl-4 my-4 italic text-muted-foreground">
          {children}
        </blockquote>
      );
    },
    a({ children, href }: any) {
      return (
        <a href={href} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    },
    h1({ children }: any) {
      return <h1 className="text-2xl font-bold mt-8 mb-4">{children}</h1>;
    },
    h2({ children }: any) {
      return <h2 className="text-xl font-semibold mt-6 mb-3">{children}</h2>;
    },
    h3({ children }: any) {
      return <h3 className="text-lg font-medium mt-4 mb-2">{children}</h3>;
    },
    ul({ children }: any) {
      return <ul className="list-disc list-inside my-2 space-y-1">{children}</ul>;
    },
    ol({ children }: any) {
      return <ol className="list-decimal list-inside my-2 space-y-1">{children}</ol>;
    },
    li({ children }: any) {
      return <li className="ml-4">{children}</li>;
    },
    p({ children }: any) {
      return <p className="my-2 leading-relaxed break-words">{children}</p>;
    },
    hr() {
      return <hr className="my-6 border-muted" />;
    },
  }), [enableMath]);

  const remarkPlugins = useMemo(() => {
    const plugins: any[] = [remarkDisableIndentedCode];
    if (enableMath) {
      plugins.push([remarkMath, { singleDollarTextMath: true }]);
    }
    plugins.push(remarkGfm);
    return plugins;
  }, [enableMath]);

  const rehypePlugins = useMemo(() => {
    if (!enableMath) return [];
    return [[rehypeKatex, { throwOnError: false, strict: 'ignore' }]] as any[];
  }, [enableMath]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'prose prose-sm dark:prose-invert max-w-none',
        'prose-headings:font-semibold',
        'prose-a:text-primary',
        'prose-code:before:content-none prose-code:after:content-none',
        'prose-pre:overflow-x-auto',
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
