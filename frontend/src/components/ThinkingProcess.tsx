import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Brain, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MarkdownRenderer, StreamingMarkdownRenderer } from '@/components/MarkdownRenderer';
import { ToolUseCompactCards } from '@/components/ToolUse';
import { useTranslation } from 'react-i18next';
import type { ToolCall } from '@/types';

interface ThinkingProcessProps {
  thinking: string;
  tools?: ToolCall[];
  modelName?: string;
  className?: string;
  defaultExpanded?: boolean;
  isStreaming?: boolean;
}

export function ThinkingProcess({
  thinking,
  tools = [],
  modelName,
  className,
  defaultExpanded = false,
  isStreaming = false,
}: ThinkingProcessProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const { t } = useTranslation();
  
  const hasThinking = Boolean(thinking && thinking.trim().length > 0);
  const hasTools = Array.isArray(tools) && tools.length > 0;

  if (!hasThinking && !hasTools) {
    return null;
  }
  
  // Detect model type for styling
  const isDeepSeek = modelName?.toLowerCase().includes('deepseek');
  const isQwQ = modelName?.toLowerCase().includes('qwq');
  const isOpenAIReasoning = modelName?.toLowerCase().match(/o1|o3/);
  
  const getModelLabel = () => {
    if (isDeepSeek) return t('thinking.deepseek');
    if (isQwQ) return t('thinking.qwq');
    if (isOpenAIReasoning) return t('thinking.openai');
    return t('thinking.generic');
  };
  
  const getIconColor = () => {
    if (isDeepSeek) return 'text-blue-500';
    if (isQwQ) return 'text-purple-500';
    if (isOpenAIReasoning) return 'text-green-500';
    return 'text-amber-500';
  };

  return (
    <Card className={cn("border-dashed bg-muted/30", className)}>
      <CardHeader className="py-2.5 px-3">
        <CardTitle className="text-[13px] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className={cn("h-4 w-4", getIconColor())} />
            <span className="text-muted-foreground font-medium">{getModelLabel()}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </CardTitle>
      </CardHeader>
      {isExpanded && (
        <CardContent className="pt-0 pb-3 px-3">
          {hasTools && (
            <ToolUseCompactCards
              tools={tools}
              className="mb-3"
            />
          )}

          <div className="relative">
            {/* Left border indicator */}
            <div className={cn(
              "absolute left-0 top-0 bottom-0 w-1 rounded-full",
              isDeepSeek ? "bg-blue-400" : 
              isQwQ ? "bg-purple-400" : 
              isOpenAIReasoning ? "bg-green-400" : "bg-amber-400"
            )} />
            
            {/* Thinking content */}
            <div className="pl-4 text-sm text-muted-foreground leading-relaxed">
              {hasThinking ? (
                isStreaming ? (
                  <StreamingMarkdownRenderer
                    content={thinking}
                    enableMath={true}
                    enableCodeHighlight={false}
                    className="prose-sm text-muted-foreground"
                  />
                ) : (
                  <MarkdownRenderer
                    content={thinking}
                    enableMath={true}
                    enableCodeHighlight={true}
                    className="prose-sm text-muted-foreground"
                  />
                )
              ) : (
                <span className="text-xs text-muted-foreground/80">{t('thinking.noThinkingText')}</span>
              )}
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// Hook to detect if model supports thinking/reasoning
// eslint-disable-next-line react-refresh/only-export-components
export function useReasoningSupport(modelName: string): boolean {
  const lowerModel = modelName.toLowerCase();
  const keywordMatched = ['reason', 'reasoning', 'think', 'thinking', 'cot'].some((k) =>
    lowerModel.includes(k)
  );
  const rSeriesMatched = /(^|[-_:])r\d+($|[-_:])/.test(lowerModel);
  return keywordMatched || rSeriesMatched;
}
