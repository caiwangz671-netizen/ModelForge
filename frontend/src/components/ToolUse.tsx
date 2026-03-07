import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Globe, 
  Code2, 
  Calculator, 
  Terminal,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  CheckCircle2,
  Clock
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import type { ToolCall, ToolCallType } from '@/types';

interface ToolUsePanelProps {
  tools: ToolCall[];
  className?: string;
}

const toolIcons: Record<ToolCallType, typeof Globe> = {
  web_search: Globe,
  browser: ExternalLink,
  python: Code2,
  calculator: Calculator,
  terminal: Terminal,
};

const toolLabelKeys: Record<ToolCallType, string> = {
  web_search: 'tools.labels.web_search',
  browser: 'tools.labels.browser',
  python: 'tools.labels.python',
  calculator: 'tools.labels.calculator',
  terminal: 'tools.labels.terminal',
};

const toolColors: Record<ToolCallType, string> = {
  web_search: 'text-blue-500 bg-blue-500/10',
  browser: 'text-purple-500 bg-purple-500/10',
  python: 'text-yellow-500 bg-yellow-500/10',
  calculator: 'text-green-500 bg-green-500/10',
  terminal: 'text-gray-500 bg-gray-500/10',
};

function ToolCallCard({ tool }: { tool: ToolCall }) {
  const [isExpanded, setIsExpanded] = useState(true);
  const { t } = useTranslation();
  const Icon = toolIcons[tool.type];

  return (
    <Card className="overflow-hidden">
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={cn("p-1.5 rounded", toolColors[tool.type])}>
              <Icon className="h-4 w-4" />
            </div>
            <span>{t(toolLabelKeys[tool.type])}</span>
            <Badge variant={
              tool.status === 'completed' ? 'default' :
              tool.status === 'error' ? 'destructive' :
              tool.status === 'running' ? 'secondary' :
              'outline'
            } className="text-xs">
              {tool.status === 'completed' && <CheckCircle2 className="h-3 w-3 mr-1" />}
              {tool.status === 'running' && <Clock className="h-3 w-3 mr-1 animate-spin" />}
              {tool.status === 'completed' ? t('tools.status.completed') :
               tool.status === 'error' ? t('tools.status.error') :
               tool.status === 'running' ? t('tools.status.running') : t('tools.status.pending')}
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </CardTitle>
      </CardHeader>
      
      {isExpanded && (
        <CardContent className="pt-0 pb-4 px-4 space-y-3">
          {/* Tool Input */}
          <div>
            <div className="text-xs text-muted-foreground mb-1">{t('tools.input')}</div>
            <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
              {JSON.stringify(tool.input, null, 2)}
            </pre>
          </div>

          {/* Tool Output */}
          {tool.output && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">{t('tools.output')}</div>
              <pre className="text-xs bg-muted p-2 rounded overflow-x-auto max-h-40">
                {tool.output}
              </pre>
            </div>
          )}

          {/* Timing */}
          {(tool.started_at || tool.completed_at) && (
            <div className="flex gap-4 text-xs text-muted-foreground">
              {tool.started_at && (
                <span>{t('tools.startedAt')}: {new Date(tool.started_at).toLocaleTimeString()}</span>
              )}
              {tool.completed_at && (
                <span>{t('tools.completedAt')}: {new Date(tool.completed_at).toLocaleTimeString()}</span>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export function ToolUsePanel({ tools, className }: ToolUsePanelProps) {
  if (!tools || tools.length === 0) {
    return null;
  }
  const { t } = useTranslation();

  const runningCount = tools.filter(t => t.status === 'running').length;
  const completedCount = tools.filter(t => t.status === 'completed').length;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium flex items-center gap-2">
          <Terminal className="h-4 w-4" />
          {t('tools.panelTitle')}
          {runningCount > 0 && (
            <Badge variant="secondary" className="animate-pulse">
              {t('tools.runningCount', { count: runningCount })}
            </Badge>
          )}
          {completedCount > 0 && completedCount === tools.length && (
            <Badge variant="default">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              {t('tools.allCompleted')}
            </Badge>
          )}
        </h4>
        <span className="text-xs text-muted-foreground">
          {t('tools.totalCount', { count: tools.length })}
        </span>
      </div>

      <div className="space-y-2">
        {tools.map((tool) => (
          <ToolCallCard key={tool.id} tool={tool} />
        ))}
      </div>
    </div>
  );
}

function tryParseJson(text?: string): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function getCompactSubtitle(tool: ToolCall): string {
  if (tool.type === 'web_search') {
    const query = typeof tool.input?.query === 'string' ? tool.input.query : '';
    const parsed = tryParseJson(tool.output);
    const count = typeof parsed?.result_count === 'number' ? parsed.result_count : undefined;
    if (query && typeof count === 'number') return `"${query}" · ${count}`;
    if (query) return `"${query}"`;
  }
  if (tool.type === 'browser') {
    const parsed = tryParseJson(tool.output);
    const title = typeof parsed?.title === 'string' ? parsed.title : '';
    const url = typeof parsed?.final_url === 'string' ? parsed.final_url : '';
    if (title) return title;
    if (url) {
      try {
        return new URL(url).hostname;
      } catch {
        return url;
      }
    }
  }
  return '';
}

export function ToolUseCompactCards({
  tools,
  className,
}: {
  tools: ToolCall[];
  className?: string;
}) {
  const { t } = useTranslation();
  if (!tools || tools.length === 0) return null;

  const visibleTools = tools.slice(-4);

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {visibleTools.map((tool) => {
        const Icon = toolIcons[tool.type] || Terminal;
        const subtitle = getCompactSubtitle(tool);
        const statusClass =
          tool.status === 'completed'
            ? 'border-emerald-400/40 bg-emerald-500/10'
            : tool.status === 'error'
              ? 'border-rose-400/40 bg-rose-500/10'
              : 'border-amber-400/40 bg-amber-500/10';
        return (
          <div
            key={tool.id}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] text-muted-foreground",
              statusClass,
            )}
            title={`${t(toolLabelKeys[tool.type])} · ${t(`tools.status.${tool.status}`)}`}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="font-medium">{t(toolLabelKeys[tool.type])}</span>
            {subtitle && <span className="max-w-[240px] truncate opacity-90">{subtitle}</span>}
          </div>
        );
      })}
      {tools.length > visibleTools.length && (
        <div className="inline-flex items-center rounded-md border px-2 py-1 text-[11px] text-muted-foreground">
          +{tools.length - visibleTools.length}
        </div>
      )}
    </div>
  );
}

/**
 * Web Search Results Component
 */
interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  date?: string;
}

export function WebSearchResults({ 
  results, 
  query,
  className 
}: { 
  results: SearchResult[]; 
  query: string;
  className?: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { t } = useTranslation();

  if (!results || results.length === 0) {
    return null;
  }

  const displayResults = isExpanded ? results : results.slice(0, 3);

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-blue-500" />
            <span>{t('tools.searchResults')}</span>
            <Badge variant="secondary" className="text-xs">
              {t('tools.searchCount', { count: results.length })}
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 pb-4 px-4">
        <div className="text-xs text-muted-foreground mb-3">
          {t('tools.searchQuery')}: <span className="font-mono bg-muted px-1 rounded">{query}</span>
        </div>
        <div className="space-y-3">
          {displayResults.map((result, index) => (
            <div key={index} className="border-b last:border-0 pb-2 last:pb-0">
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-primary hover:underline flex items-center gap-1"
              >
                {result.title}
                <ExternalLink className="h-3 w-3" />
              </a>
              <div className="text-xs text-muted-foreground truncate">
                {result.url}
              </div>
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                {result.snippet}
              </p>
              {result.date && (
                <div className="text-xs text-muted-foreground mt-1">
                  {result.date}
                </div>
              )}
            </div>
          ))}
        </div>
        {results.length > 3 && !isExpanded && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full mt-3"
            onClick={() => setIsExpanded(true)}
          >
            {t('tools.showMoreResults', { count: results.length - 3 })}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Current Time Context Component
 * Shows that model is aware of current time
 */
export function CurrentTimeContext({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const now = new Date();
  const locale = i18n.resolvedLanguage || i18n.language || 'zh-CN';
  
  return (
    <div className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}>
      <Clock className="h-3 w-3" />
      <span>
        {t('tools.currentTime')}: {now.toLocaleString(locale, {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </span>
    </div>
  );
}
