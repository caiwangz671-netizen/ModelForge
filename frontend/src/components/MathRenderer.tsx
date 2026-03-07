import { useEffect, useRef } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

interface MathRendererProps {
  content: string;
  className?: string;
}

/**
 * Math Renderer Component
 * 
 * Renders LaTeX math expressions using KaTeX
 * Supports both inline ($...$) and display ($$...$$) math
 */
export function MathRenderer({ content, className = '' }: MathRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    
    // Process display math first: $$...$$
    let processed = content.replace(/\$\$([\s\S]*?)\$\$/g, (_, latex) => {
      try {
        return katex.renderToString(latex.trim(), {
          displayMode: true,
          throwOnError: false,
        });
      } catch (e) {
        return `<div class="text-red-500">Math Error</div>`;
      }
    });

    // Process inline math: $...$
    processed = processed.replace(/\$([^\$\s][^\$]*?)\$/g, (_, latex) => {
      try {
        return katex.renderToString(latex.trim(), {
          displayMode: false,
          throwOnError: false,
        });
      } catch (e) {
        return `<span class="text-red-500">$${latex}$</span>`;
      }
    });

    // Alternative LaTeX delimiters
    // \( ... \) for inline
    processed = processed.replace(/\\\(([\s\S]*?)\\\)/g, (_, latex) => {
      try {
        return katex.renderToString(latex.trim(), {
          displayMode: false,
          throwOnError: false,
        });
      } catch (e) {
        return `<span class="text-red-500">\\(${latex}\\)</span>`;
      }
    });

    // \[ ... \] for display
    processed = processed.replace(/\\\[([\s\S]*?)\\\]/g, (_, latex) => {
      try {
        return katex.renderToString(latex.trim(), {
          displayMode: true,
          throwOnError: false,
        });
      } catch (e) {
        return `<div class="text-red-500">\\[${latex}\\]</div>`;
      }
    });

    container.innerHTML = processed;
  }, [content]);

  return <div ref={containerRef} className={className} />;
}

/**
 * Extract and render math from markdown content
 * Returns { textWithoutMath, mathBlocks }
 */
export function extractMath(content: string): {
  text: string;
  mathBlocks: Array<{ type: 'inline' | 'display'; content: string }>;
} {
  const mathBlocks: Array<{ type: 'inline' | 'display'; content: string }> = [];
  let text = content;

  // Extract display math
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_, latex) => {
    mathBlocks.push({ type: 'display', content: latex.trim() });
    return `[[MATH_${mathBlocks.length - 1}]]`;
  });

  // Extract inline math
  text = text.replace(/\$([^\$\s][^\$]*?)\$/g, (_, latex) => {
    mathBlocks.push({ type: 'inline', content: latex.trim() });
    return `[[MATH_${mathBlocks.length - 1}]]`;
  });

  return { text, mathBlocks };
}

/**
 * Check if content contains math expressions
 */
export function hasMath(content: string): boolean {
  return /\$[^\$]+\$|\$\$[\s\S]*?\$\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/.test(content);
}
