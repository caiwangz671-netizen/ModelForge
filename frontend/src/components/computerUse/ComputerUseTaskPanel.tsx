import { useTranslation } from 'react-i18next';
import { Bot, CheckCircle2, Loader2, Pause, Play, RefreshCw, Settings2, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { Model } from '@/types';
import type { ComputerUseApprovalMode, ComputerUseSessionStatus } from '@/types/computerUse';

interface TaskTemplate {
  id: string;
  title: string;
  goal: string;
}

interface ComputerUseTaskPanelProps {
  models: Model[];
  selectedModel: string;
  goal: string;
  approvalMode: ComputerUseApprovalMode;
  sessionStatus?: ComputerUseSessionStatus | null;
  isLoading: boolean;
  canStart: boolean;
  contextText?: string | null;
  templates: TaskTemplate[];
  onSelectModel: (model: string) => void;
  onGoalChange: (goal: string) => void;
  onApprovalModeChange: (mode: ComputerUseApprovalMode) => void;
  onTemplateSelect: (goal: string) => void;
  onOpenSettings: () => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

const PANEL_CLASS = 'rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,#0c1525,#09111d)] text-slate-100 shadow-[0_24px_80px_-60px_rgba(2,6,23,0.9)]';

export function ComputerUseTaskPanel({
  models,
  selectedModel,
  goal,
  approvalMode,
  sessionStatus,
  isLoading,
  canStart,
  contextText,
  templates,
  onSelectModel,
  onGoalChange,
  onApprovalModeChange,
  onTemplateSelect,
  onOpenSettings,
  onStart,
  onPause,
  onResume,
  onStop,
}: ComputerUseTaskPanelProps) {
  const { t } = useTranslation();

  const isRunning = sessionStatus === 'running';
  const isPaused = sessionStatus === 'paused' || sessionStatus === 'waiting_approval';
  const hasActiveSession = Boolean(sessionStatus && sessionStatus !== 'completed' && sessionStatus !== 'failed' && sessionStatus !== 'cancelled');

  return (
    <Card className={PANEL_CLASS}>
      <CardHeader className="border-b border-white/10 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg text-white">{t('computerUse.setupTitle')}</CardTitle>
            <CardDescription className="mt-2 text-sm leading-6 text-slate-400">
              {t('computerUse.setupDescription')}
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onOpenSettings}
            className="rounded-full border-white/10 bg-white/[0.04] px-3 text-slate-200 hover:bg-white/[0.08] hover:text-white"
          >
            <Settings2 className="h-3.5 w-3.5" />
            {t('computerUse.openSettings')}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 p-5">
        <div className="space-y-2.5">
          <Label htmlFor="computer-use-model" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            {t('computerUse.model')}
          </Label>
          <Select value={selectedModel} onValueChange={onSelectModel}>
            <SelectTrigger
              id="computer-use-model"
              className="h-12 rounded-2xl border-white/10 bg-white/[0.04] px-4 text-sm text-slate-100 shadow-inner shadow-black/20"
            >
              <SelectValue placeholder={t('computerUse.selectModel')} />
            </SelectTrigger>
            <SelectContent>
              {models.map((model) => (
                <SelectItem key={model.name} value={model.name}>
                  {model.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {models.length === 0 ? (
            <p className="text-xs leading-5 text-slate-500">{t('computerUse.noToolModel')}</p>
          ) : null}
        </div>

        <div className="space-y-2.5">
          <Label htmlFor="computer-use-goal" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            {t('computerUse.goal')}
          </Label>
          <textarea
            id="computer-use-goal"
            value={goal}
            onChange={(event) => onGoalChange(event.target.value)}
            rows={7}
            className="min-h-[176px] w-full resize-none rounded-[24px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-6 text-slate-100 shadow-inner shadow-black/20 outline-none transition placeholder:text-slate-500 focus:border-cyan-400/30 focus:ring-2 focus:ring-cyan-400/10"
            placeholder={t('computerUse.goalPlaceholder')}
          />
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{goal.trim().length > 0 ? `${goal.trim().length} chars` : t('computerUse.readyStepGoal')}</span>
            {contextText ? (
              <Badge className="rounded-full border border-sky-400/20 bg-sky-400/10 px-2.5 py-0.5 text-[11px] text-sky-100 shadow-none">
                {t('computerUse.nextTaskContext')}
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              {t('computerUse.templateTitle')}
            </div>
            <div className="text-[11px] text-slate-500">{t('computerUse.templateHint')}</div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => onTemplateSelect(template.goal)}
                className="rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3 text-left transition hover:border-cyan-400/20 hover:bg-white/[0.06]"
              >
                <div className="text-sm font-semibold text-white">{template.title}</div>
                <div className="mt-1 text-xs leading-5 text-slate-400 line-clamp-3">{template.goal}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3 rounded-[24px] border border-white/10 bg-black/20 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            {t('computerUse.approvalMode')}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(['hands_free', 'review_all'] as const).map((mode) => {
              const active = approvalMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onApprovalModeChange(mode)}
                  className={cn(
                    'rounded-[18px] border px-3 py-3 text-left transition',
                    active
                      ? 'border-cyan-400/25 bg-cyan-400/10 text-cyan-100'
                      : 'border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.06]',
                  )}
                >
                  <div className="text-sm font-semibold">
                    {t(mode === 'hands_free' ? 'computerUse.approvalModeHandsFree' : 'computerUse.approvalModeReviewAll')}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-slate-400">
                    {t(mode === 'hands_free' ? 'computerUse.approvalModeHandsFreeHint' : 'computerUse.approvalModeReviewAllHint')}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-[24px] bg-white/[0.03] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          {!hasActiveSession ? (
            <Button
              onClick={onStart}
              disabled={!canStart || isLoading}
              className="h-11 w-full rounded-2xl bg-cyan-300 text-slate-950 hover:bg-cyan-200"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {t('computerUse.start')}
            </Button>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={isPaused ? onResume : onPause}
                disabled={!isRunning && !isPaused}
                className="h-10 rounded-2xl border-white/10 bg-white/[0.06] text-white hover:bg-white/[0.1] hover:text-white"
              >
                {isPaused ? <RefreshCw className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                {t(isPaused ? 'computerUse.resume' : 'computerUse.pause')}
              </Button>
              <Button
                variant="destructive"
                onClick={onStop}
                className="h-10 rounded-2xl bg-rose-500/90 text-white hover:bg-rose-500"
              >
                <Square className="h-4 w-4" />
                {t('computerUse.stop')}
              </Button>
            </div>
          )}
        </div>

        <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-cyan-400/15 bg-cyan-400/10 text-cyan-100">
              {hasActiveSession ? <CheckCircle2 className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white">
                {hasActiveSession ? t('computerUse.sessionLiveSummary') : t('computerUse.readyTitle')}
              </div>
              <div className="mt-1 text-sm leading-6 text-slate-400">
                {hasActiveSession
                  ? t('computerUse.conversationDescription')
                  : t('computerUse.readyDescription')}
              </div>
              {contextText ? (
                <div className="mt-2 rounded-2xl border border-sky-400/15 bg-sky-400/10 px-3 py-2 text-xs leading-5 text-sky-100/85">
                  {contextText}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
