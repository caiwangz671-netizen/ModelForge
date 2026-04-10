import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MarkdownRenderer, StreamingMarkdownRenderer } from '@/components/MarkdownRenderer';
import { cn } from '@/lib/utils';
import {
  ArrowUpDown,
  Bot,
  Camera,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Eye,
  FileSearch,
  FileText,
  FolderOpen,
  Globe,
  Keyboard,
  MousePointer2,
  ShieldAlert,
  Terminal,
  Timer,
  type LucideIcon,
} from 'lucide-react';
import type { ComputerUseSession } from '@/types/computerUse';
import {
  formatActionTimestamp,
  formatStatusLabel,
  getDarkRiskPillClasses,
  getDarkStatusPillClasses,
  getToolDisplayName,
  getToolInputSummary,
  getToolOutputSummary,
  sortActionsChronologically,
} from '@/components/computerUse/presentation';

interface ComputerUseTimelineProps {
  session: ComputerUseSession | null;
  isStreaming: boolean;
  pendingApprovalReason?: string | null;
}

export function ComputerUseTimeline({
  session,
  isStreaming,
  pendingApprovalReason,
}: ComputerUseTimelineProps) {
  const { t } = useTranslation();
  const [expandedActions, setExpandedActions] = useState<Set<string>>(new Set());

  const actions = useMemo(
    () => sortActionsChronologically(session?.actions || []),
    [session?.actions],
  );

  const getStatusLabel = (status?: string | null) => {
    if (!status) return t('computerUse.statusIdle');
    const fallback = formatStatusLabel(status);
    const key = `computerUse.status${fallback.replace(/\s+/g, '')}`;
    return t(key, { defaultValue: fallback });
  };

  return (
    <Card className="rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,#08101d,#050b16)] text-slate-100 shadow-[0_24px_90px_-62px_rgba(2,6,23,0.92)]">
      <CardHeader className="border-b border-white/10 pb-4">
        <CardTitle className="text-lg text-white">{t('computerUse.timelineTitle')}</CardTitle>
        <CardDescription className="text-slate-400">{t('computerUse.timelineDescription')}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4 p-5">
        {!session ? (
          <div className="rounded-[22px] border border-dashed border-white/10 bg-white/[0.02] px-5 py-8 text-center text-sm leading-6 text-slate-400">
            {t('computerUse.noTimeline')}
          </div>
        ) : (
          <>
            <div className="flex justify-end">
              <div className="max-w-[86%] rounded-[24px] rounded-br-md bg-cyan-300 px-4 py-3 text-sm leading-6 text-slate-950 shadow-[0_18px_40px_-30px_rgba(34,211,238,0.6)]">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700">
                  {t('computerUse.goal')}
                </div>
                <div className="mt-2 whitespace-pre-wrap">
                  {session.goal || t('computerUse.overviewNoGoal')}
                </div>
              </div>
            </div>

            {pendingApprovalReason ? (
              <div className="rounded-[22px] border border-amber-400/20 bg-amber-400/10 p-4 text-amber-100">
                <div className="flex items-start gap-3">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="text-sm leading-6">
                    <div className="font-semibold">{t('computerUse.pendingApproval')}</div>
                    <div className="mt-1 text-amber-100/80">{pendingApprovalReason}</div>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="flex justify-start">
              <div className="max-w-[92%] rounded-[24px] rounded-bl-md border border-white/10 bg-white/[0.04] px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                  {t('computerUse.assistantStream')}
                </div>
                <div className="mt-3 text-slate-100">
                  {session.assistant_text ? (
                    isStreaming ? (
                      <StreamingMarkdownRenderer
                        content={session.assistant_text}
                        enableMath={false}
                        enableCodeHighlight={false}
                        className="text-[15px] leading-7 text-slate-100 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                      />
                    ) : (
                      <MarkdownRenderer
                        content={session.assistant_text}
                        enableMath={false}
                        enableCodeHighlight={false}
                        className="text-[15px] leading-7 text-slate-100 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                      />
                    )
                  ) : (
                    <div className="text-[15px] leading-7 text-slate-400">
                      {isStreaming ? t('computerUse.waitingAssistant') : t('computerUse.noAssistantYet')}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {actions.length === 0 ? (
              <div className="rounded-[22px] border border-dashed border-white/10 bg-white/[0.02] px-5 py-8 text-center text-sm leading-6 text-slate-400">
                {t('computerUse.noTimeline')}
              </div>
            ) : (
              <div className="space-y-4">
                {actions.map((action) => {
                  const ToolIcon = getToolIcon(action.tool_name);
                  const inputSummary = getToolInputSummary(action.tool_name, action.input_payload);
                  const outputSummary = getToolOutputSummary(action.output_payload);
                  const isExpanded = expandedActions.has(action.id);
                  const hasDetails = Object.keys(action.input_payload || {}).length > 0 || Object.keys(action.output_payload || {}).length > 0;

                  return (
                    <div key={action.id} className="rounded-[24px] border border-white/10 bg-slate-900/55 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                      <div className="flex items-start gap-3">
                        <div className={cn('mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-slate-950/80', getToolIconAccent(action.tool_name))}>
                          <ToolIcon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-white">
                                {getToolDisplayName(action.tool_name)}
                              </div>
                              {inputSummary ? (
                                <div className="mt-1 font-mono text-[12px] leading-5 text-slate-400">
                                  {inputSummary}
                                </div>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-2">
                              {action.created_at ? (
                                <span className="text-[11px] text-slate-500">
                                  {formatActionTimestamp(action.created_at)}
                                </span>
                              ) : null}
                              {hasDetails ? (
                                <button
                                  type="button"
                                  onClick={() => setExpandedActions((previous) => {
                                    const next = new Set(previous);
                                    if (next.has(action.id)) next.delete(action.id); else next.add(action.id);
                                    return next;
                                  })}
                                  className="rounded-lg p-1 text-slate-400 transition hover:bg-white/[0.08] hover:text-slate-200"
                                >
                                  {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                </button>
                              ) : null}
                            </div>
                          </div>

                          <div className="mt-3 flex flex-wrap gap-1.5">
                            <Badge className={cn('rounded-full border px-2.5 py-0.5 text-[11px] shadow-none', getDarkStatusPillClasses(action.status))}>
                              {getStatusLabel(action.status)}
                            </Badge>
                            <Badge className={cn('rounded-full border px-2.5 py-0.5 text-[11px] shadow-none', getDarkRiskPillClasses(action.risk_level))}>
                              {t('computerUse.riskLevel')}: {formatStatusLabel(action.risk_level)}
                            </Badge>
                            {action.requires_approval ? (
                              <Badge className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-0.5 text-[11px] text-amber-100 shadow-none">
                                {t('computerUse.pendingApproval')}
                              </Badge>
                            ) : null}
                          </div>

                          {outputSummary ? (
                            <div className="mt-3 rounded-[14px] border border-emerald-400/15 bg-emerald-400/10 px-3 py-2 text-[12px] leading-5 text-emerald-100">
                              {outputSummary}
                            </div>
                          ) : null}

                          {action.error ? (
                            <div className="mt-3 rounded-[14px] border border-rose-400/15 bg-rose-500/10 px-3 py-2 text-[12px] leading-5 text-rose-100">
                              {action.error}
                            </div>
                          ) : null}

                          {isExpanded ? (
                            <div className="mt-3 space-y-2">
                              {Object.keys(action.input_payload || {}).length > 0 ? (
                                <JsonBlock title={t('computerUse.toolInput')} value={action.input_payload} />
                              ) : null}
                              {Object.keys(action.output_payload || {}).length > 0 ? (
                                <JsonBlock title={t('computerUse.toolOutput')} value={action.output_payload} />
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function JsonBlock({ title, value }: { title: string; value: Record<string, unknown> }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{title}</div>
      <pre className="overflow-x-auto rounded-[16px] border border-white/10 bg-black/25 px-3 py-2 font-mono text-[11px] leading-5 text-slate-200">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function getToolIcon(toolName: string): LucideIcon {
  if (toolName.includes('click')) return MousePointer2;
  if (toolName.includes('type') || toolName.includes('keypress')) return Keyboard;
  if (toolName.includes('snapshot')) return Camera;
  if (toolName.includes('scroll')) return ArrowUpDown;
  if (toolName.includes('query_state') || toolName.includes('locate_target')) return Eye;
  if (toolName.includes('wait_for_user')) return Timer;
  if (toolName.includes('open_url') || toolName.includes('open_app') || toolName === 'browser_back') return ExternalLink;
  if (toolName.startsWith('browser_')) return Globe;
  if (toolName.startsWith('fs_write')) return FileText;
  if (toolName.startsWith('fs_read')) return FileSearch;
  if (toolName.startsWith('fs_')) return FolderOpen;
  if (toolName.startsWith('shell_') || toolName.startsWith('terminal_')) return Terminal;
  return Bot;
}

function getToolIconAccent(toolName: string): string {
  if (toolName.includes('click') || toolName.includes('type') || toolName.includes('keypress') || toolName.includes('scroll')) {
    return 'text-violet-200';
  }
  if (toolName.includes('snapshot') || toolName.includes('query_state') || toolName.includes('locate_target')) {
    return 'text-cyan-200';
  }
  if (toolName.startsWith('browser_')) {
    return 'text-blue-200';
  }
  if (toolName.startsWith('fs_')) {
    return 'text-emerald-200';
  }
  if (toolName.startsWith('terminal_') || toolName.startsWith('shell_')) {
    return 'text-amber-200';
  }
  return 'text-slate-100';
}
