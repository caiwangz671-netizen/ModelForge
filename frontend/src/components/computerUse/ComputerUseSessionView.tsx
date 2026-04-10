import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, CheckCircle2, Clock3, Loader2, ShieldAlert, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ComputerUseSession } from '@/types/computerUse';
import {
  formatSessionDuration,
  formatStatusLabel,
  getDarkStatusPillClasses,
} from '@/components/computerUse/presentation';

interface ComputerUseSessionViewProps {
  session: ComputerUseSession | null;
  actionCount: number;
  approvalCount: number;
  isStreaming?: boolean;
  selectedModel?: string;
}

export function ComputerUseSessionView({
  session,
  actionCount,
  approvalCount,
  isStreaming = false,
  selectedModel,
}: ComputerUseSessionViewProps) {
  const { t } = useTranslation();

  if (!session) {
    return (
      <Card className="rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,#0c1525,#09111d)] text-slate-100 shadow-[0_24px_80px_-60px_rgba(2,6,23,0.9)]">
        <CardContent className="flex flex-col gap-5 p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-200">
              <Clock3 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-white">{t('computerUse.sessionStatus')}</div>
              <div className="text-sm text-slate-400">{t('computerUse.overviewNoSession')}</div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard label={t('computerUse.sessionModel')} value={selectedModel || '-'} />
            <MetricCard label={t('computerUse.actionCount')} value="0" />
            <MetricCard label={t('computerUse.approvalCount')} value="0" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const startedAt = session.started_at || session.created_at;
  const statusLabel = session.status
    ? t(`computerUse.status${formatStatusLabel(session.status).replace(/\s+/g, '')}`, { defaultValue: formatStatusLabel(session.status) })
    : t('computerUse.overviewNoSession');

  return (
    <Card className="rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,#0c1525,#09111d)] text-slate-100 shadow-[0_24px_80px_-60px_rgba(2,6,23,0.9)]">
      <CardHeader className="border-b border-white/10 pb-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <CardTitle className="text-lg text-white">{t('computerUse.sessionStatus')}</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={cn('rounded-full border px-3 py-1 text-[11px] shadow-none', getDarkStatusPillClasses(session.status))}>
                {session.status === 'running' && isStreaming ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                {statusLabel}
              </Badge>
              {approvalCount > 0 ? (
                <Badge className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-[11px] text-amber-100 shadow-none">
                  <ShieldAlert className="mr-1 h-3.5 w-3.5" />
                  {t('computerUse.approvalPendingBadge', { count: approvalCount })}
                </Badge>
              ) : null}
            </div>
          </div>

          <div className="text-right text-xs leading-5 text-slate-400">
            <div>{t('computerUse.startedAtLabel')}: {startedAt ? new Date(startedAt * 1000).toLocaleTimeString() : '-'}</div>
            <div>{t('computerUse.durationLabel')}: {formatSessionDuration(session)}</div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 p-6">
        <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            {t('computerUse.goal')}
          </div>
          <div className="mt-2 text-sm leading-7 text-slate-100">
            {session.goal || t('computerUse.overviewNoGoal')}
          </div>
        </div>

        {session.error ? (
          <div className="rounded-[20px] border border-rose-400/20 bg-rose-500/10 p-4 text-sm leading-6 text-rose-100">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{session.error}</span>
            </div>
          </div>
        ) : session.status === 'completed' ? (
          <div className="rounded-[20px] border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm leading-6 text-emerald-100">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t('computerUse.sessionCompletedSummary')}</span>
            </div>
          </div>
        ) : (
          <div className="rounded-[20px] border border-cyan-400/20 bg-cyan-400/10 p-4 text-sm leading-6 text-cyan-100">
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t('computerUse.sessionLiveSummary')}</span>
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-4">
          <MetricCard label={t('computerUse.sessionModel')} value={session.model || selectedModel || '-'} />
          <MetricCard label={t('computerUse.actionCount')} value={String(actionCount)} />
          <MetricCard label={t('computerUse.approvalCount')} value={String(approvalCount)} tone={approvalCount > 0 ? 'amber' : 'neutral'} />
          <MetricCard label={t('computerUse.durationLabel')} value={formatSessionDuration(session)} />
        </div>
      </CardContent>
    </Card>
  );
}

function MetricCard({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'amber';
}) {
  return (
    <div className={cn(
      'rounded-[18px] border px-4 py-3',
      tone === 'amber'
        ? 'border-amber-400/20 bg-amber-400/10'
        : 'border-white/10 bg-white/[0.03]',
    )}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </div>
      <div className={cn('mt-2 text-lg font-semibold', tone === 'amber' ? 'text-amber-100' : 'text-slate-100')}>
        {value}
      </div>
    </div>
  );
}
