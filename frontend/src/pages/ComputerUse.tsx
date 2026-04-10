import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileSearch,
  Loader2,
  MonitorSmartphone,
  RefreshCw,
  ShieldAlert,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import type { Model } from '@/types';
import type { ComputerUseApprovalMode } from '@/types/computerUse';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ComputerUseOutputView, ComputerUseSessionView, ComputerUseTaskPanel, ComputerUseTimeline } from '@/components/computerUse';
import { cn } from '@/lib/utils';
import {
  loadComputerUsePreferences,
  normalizeComputerUsePaths,
  saveComputerUsePreferences,
} from '@/lib/computerUsePreferences';
import { computerUseApi, API_BASE_URL } from '@/services/api';
import { useComputerUseStore } from '@/store/computerUseStore';
import { useModelStore } from '@/store/modelStore';
import { buildResultItems, formatHistoryTimestamp, formatStatusLabel, getDarkStatusPillClasses, isTerminalStatus } from '@/components/computerUse/presentation';

const BACKEND_ORIGIN = API_BASE_URL.replace(/\/api$/, '');
const HISTORY_COLLAPSED_KEY = 'computer-use:historyCollapsed';
const SURFACE_CARD_CLASS = 'rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,#0c1525,#09111d)] text-slate-100 shadow-[0_24px_80px_-60px_rgba(2,6,23,0.9)]';
const INNER_CARD_CLASS = 'rounded-[24px] border border-white/10 bg-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]';
const SOFT_BUTTON_CLASS = 'rounded-full border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08] hover:text-white';
const HEADER_BADGE_CLASS = 'rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-slate-200 shadow-none';
const HEADER_BADGE_ACCENT_CLASS = 'rounded-full border border-amber-400/12 bg-amber-400/[0.08] px-3 py-1 text-[11px] text-amber-50 shadow-none';

function supportsTools(model: Model): boolean {
  return Boolean(model.capabilities?.supports_tools);
}

function supportsVideo(model: Model): boolean {
  return Boolean(model.capabilities?.supports_video);
}

function supportsVision(model: Model): boolean {
  return Boolean(model.capabilities?.supports_vision);
}

export function ComputerUse() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { models, fetchModels } = useModelStore();
  const {
    statusPayload,
    sessions,
    currentSession,
    isLoading,
    isStreaming,
    error,
    loadStatus,
    loadSessions,
    createAndRun,
    deleteAllSessions,
    reconnectActiveSession,
    selectSession,
    approve,
    reject,
    pause,
    resume,
    cancel,
    clearSession,
  } = useComputerUseStore();

  const initialPreferences = useMemo(() => loadComputerUsePreferences(), []);
  const [selectedModel, setSelectedModel] = useState('');
  const [goal, setGoal] = useState('');
  const [approvalMode, setApprovalMode] = useState<ComputerUseApprovalMode>(initialPreferences.approvalMode);
  const [cwd, setCwd] = useState(initialPreferences.cwd);
  const [allowedPaths, setAllowedPaths] = useState<string[]>(initialPreferences.allowedPaths);
  const [useCustomScope] = useState(initialPreferences.useCustomScope);
  const [draftParentSessionId, setDraftParentSessionId] = useState<string | null>(null);
  const [isDeleteAllOpen, setIsDeleteAllOpen] = useState(false);
  const [isHistoryCollapsed, setIsHistoryCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(HISTORY_COLLAPSED_KEY) === 'true';
  });
  const [isRequestingPermissions, setIsRequestingPermissions] = useState(false);

  const toolModels = useMemo(() => models.filter((model) => supportsTools(model)), [models]);
  const effectiveModelName = currentSession?.model || selectedModel;
  const effectiveModelMeta = useMemo(
    () => toolModels.find((model) => model.name === effectiveModelName) || null,
    [effectiveModelName, toolModels],
  );
  const selectedModelMeta = useMemo(
    () => toolModels.find((model) => model.name === selectedModel) || null,
    [selectedModel, toolModels],
  );
  const effectiveModelSupportsDirectVision = Boolean(
    effectiveModelMeta && (supportsVideo(effectiveModelMeta) || supportsVision(effectiveModelMeta)),
  );
  const selectedModelSupportsDirectVision = Boolean(
    selectedModelMeta && (supportsVideo(selectedModelMeta) || supportsVision(selectedModelMeta)),
  );

  useEffect(() => {
    void Promise.all([fetchModels(), loadStatus(), loadSessions(), reconnectActiveSession()]);
  }, [fetchModels, loadSessions, loadStatus, reconnectActiveSession]);

  useEffect(() => {
    if (!selectedModel && toolModels[0]?.name) {
      setSelectedModel(toolModels[0].name);
    }
  }, [selectedModel, toolModels]);

  useEffect(() => {
    if (!cwd && statusPayload?.default_cwd) {
      setCwd(statusPayload.default_cwd);
    }
    if (allowedPaths.length === 0 && statusPayload?.default_allowed_paths?.length) {
      setAllowedPaths(normalizeComputerUsePaths(statusPayload.default_allowed_paths));
    }
  }, [allowedPaths.length, cwd, statusPayload]);

  useEffect(() => {
    if (currentSession?.approval_mode) {
      setApprovalMode(currentSession.approval_mode);
    }
  }, [currentSession?.approval_mode]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(HISTORY_COLLAPSED_KEY, String(isHistoryCollapsed));
    }
  }, [isHistoryCollapsed]);

  useEffect(() => {
    saveComputerUsePreferences({
      approvalMode,
      useCustomScope,
      cwd,
      allowedPaths,
    });
  }, [allowedPaths, approvalMode, cwd, useCustomScope]);

  const permissions = statusPayload?.helper.permissions;
  const desktopInputReady = Boolean(statusPayload?.desktop_available);
  const browserAutomationReady = Boolean(statusPayload?.controlled_browser_available);
  const visualObservationReady = Boolean(selectedModelSupportsDirectVision || statusPayload?.ocr?.available);
  const perceptionReady = Boolean(visualObservationReady || browserAutomationReady);
  const permissionReady = !desktopInputReady || Boolean(permissions?.accessibility && permissions?.screen_recording);
  const hasActiveSession = Boolean(currentSession && !isTerminalStatus(currentSession.status));
  const canStart = Boolean(
    (desktopInputReady || browserAutomationReady)
      && perceptionReady
      && selectedModel
      && goal.trim()
      && !hasActiveSession,
  );

  const pendingApproval = useMemo(
    () => (currentSession?.approvals || []).filter((item) => item.status === 'pending').at(-1) || null,
    [currentSession?.approvals],
  );
  const pendingApprovalCount = useMemo(
    () => (currentSession?.approvals || []).filter((item) => item.status === 'pending').length,
    [currentSession?.approvals],
  );
  const actionCount = currentSession?.actions.length || 0;
  const currentScreenshotUrl = currentSession?.latest_artifact_url
    ? BACKEND_ORIGIN + currentSession.latest_artifact_url
    : null;
  const resultItems = useMemo(() => buildResultItems(currentSession, BACKEND_ORIGIN), [currentSession]);
  const sessionError = currentSession?.error || error;
  const activeScopeCwd = currentSession?.cwd || cwd || statusPayload?.default_cwd || '-';
  const previewAllowedPaths = useMemo(
    () => normalizeComputerUsePaths(
      currentSession?.allowed_paths
        || (useCustomScope
          ? [cwd, ...allowedPaths]
          : (statusPayload?.default_allowed_paths || [])),
    ),
    [allowedPaths, currentSession?.allowed_paths, cwd, statusPayload?.default_allowed_paths, useCustomScope],
  );
  const contextSourceSession = useMemo(() => {
    const sourceId = currentSession?.parent_session_id || draftParentSessionId;
    if (!sourceId) return null;
    return sessions.find((item) => item.id === sourceId) || null;
  }, [currentSession?.parent_session_id, draftParentSessionId, sessions]);
  const templates = useMemo(() => ([
    {
      id: 'landing-page',
      title: t('computerUse.templates.landingPageTitle'),
      goal: t('computerUse.templates.landingPageGoal'),
    },
    {
      id: 'docs-summary',
      title: t('computerUse.templates.docsSummaryTitle'),
      goal: t('computerUse.templates.docsSummaryGoal'),
    },
    {
      id: 'file-organize',
      title: t('computerUse.templates.fileOrganizeTitle'),
      goal: t('computerUse.templates.fileOrganizeGoal'),
    },
    {
      id: 'browser-research',
      title: t('computerUse.templates.browserResearchTitle'),
      goal: t('computerUse.templates.browserResearchGoal'),
    },
  ]), [t]);

  const notices = [
    !statusPayload?.desktop_mode
      ? {
          key: 'desktop-only',
          icon: MonitorSmartphone,
          tone: 'amber' as const,
          title: t('computerUse.desktopOnlyTitle'),
          description: t('computerUse.desktopOnlyDescription'),
        }
      : null,
    statusPayload && effectiveModelSupportsDirectVision
      ? {
          key: 'vision-route',
          icon: FileSearch,
          tone: 'sky' as const,
          title: t('computerUse.videoRouteTitle'),
          description: t('computerUse.videoRouteDescription', { model: effectiveModelName || t('computerUse.selectModel') }),
        }
      : null,
    statusPayload && !selectedModelSupportsDirectVision && !statusPayload.ocr.available && !browserAutomationReady
      ? {
          key: 'ocr-required',
          icon: FileSearch,
          tone: 'amber' as const,
          title: t('computerUse.ocrRequiredTitle'),
          description: t('computerUse.ocrRecommendation', { name: statusPayload.recommended_ocr.name }),
          detail: statusPayload.recommended_ocr.install_hint || '',
        }
      : null,
    statusPayload && permissions && desktopInputReady && !permissionReady
      ? {
          key: 'permissions',
          icon: ShieldAlert,
          tone: 'rose' as const,
          title: t('computerUse.permissionTitle'),
          description: `${t('computerUse.screenRecording')}: ${permissions.screen_recording ? '✓' : '✗'} · ${t('computerUse.accessibility')}: ${permissions.accessibility ? '✓' : '✗'}`,
          action: {
            label: t('computerUse.requestPermissions'),
            onClick: () => void handleRequestPermissions(),
            loading: isRequestingPermissions,
          },
        }
      : null,
  ].filter(Boolean) as Array<{
    key: string;
    icon: LucideIcon;
    tone: 'sky' | 'amber' | 'rose';
    title: string;
    description: string;
    detail?: string;
    action?: {
      label: string;
      onClick: () => void;
      loading?: boolean;
    };
  }>;

  const handleRequestPermissions = async () => {
    setIsRequestingPermissions(true);
    try {
      await computerUseApi.requestPermissions();
      await loadStatus();
    } finally {
      setIsRequestingPermissions(false);
    }
  };

  const handleStart = async () => {
    const parentSessionId = draftParentSessionId
      || (currentSession && isTerminalStatus(currentSession.status) ? currentSession.id : null);
    const payload: {
      model: string;
      goal: string;
      approval_mode: ComputerUseApprovalMode;
      parent_session_id?: string;
      cwd?: string;
      allowed_paths?: string[];
    } = {
      model: selectedModel,
      goal: goal.trim(),
      approval_mode: approvalMode,
    };
    if (parentSessionId) payload.parent_session_id = parentSessionId;
    if (useCustomScope) {
      if (cwd.trim()) payload.cwd = cwd.trim();
      if (allowedPaths.length > 0) payload.allowed_paths = allowedPaths;
    }
    await createAndRun(payload);
  };

  const handleNewTask = () => {
    if (hasActiveSession) return;
    if (currentSession?.id) {
      setDraftParentSessionId(currentSession.id);
      if (currentSession.model) {
        setSelectedModel(currentSession.model);
      }
    }
    clearSession();
    setGoal('');
    setApprovalMode(currentSession?.approval_mode || approvalMode);
  };

  const handleSelectSession = async (sessionId: string) => {
    setDraftParentSessionId(null);
    await selectSession(sessionId);
  };

  const handleDeleteAllHistory = async () => {
    try {
      await deleteAllSessions();
      setDraftParentSessionId(null);
      setIsDeleteAllOpen(false);
    } catch {
      // Store state already captures the error.
    }
  };

  const canCreateNewTask = !hasActiveSession && Boolean(currentSession || goal.trim() || error);
  const canDeleteAllHistory = sessions.length > 0;
  const HistoryToggleIcon = isHistoryCollapsed ? ChevronRight : ChevronDown;

  return (
    <div className="space-y-5 pb-10 pr-1">
      <section className={SURFACE_CARD_CLASS}>
        <div className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={HEADER_BADGE_CLASS}>
                {currentSession ? formatStatusLabel(currentSession.status) : t('computerUse.overviewNoSession')}
              </Badge>
              <Badge className={HEADER_BADGE_CLASS}>
                {effectiveModelName || t('computerUse.selectModel')}
              </Badge>
              {pendingApprovalCount > 0 ? (
                <Badge className={HEADER_BADGE_ACCENT_CLASS}>
                  {t('computerUse.approvalPendingBadge', { count: pendingApprovalCount })}
                </Badge>
              ) : null}
            </div>
            <div className="text-sm leading-6 text-slate-300">
              {currentSession?.goal || goal.trim() || t('computerUse.readyDescription')}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={handleNewTask}
              disabled={!canCreateNewTask}
              className={SOFT_BUTTON_CLASS}
            >
              {t('computerUse.newTask')}
            </Button>
            <Button
              variant="outline"
              onClick={() => void Promise.all([loadStatus(), loadSessions(), reconnectActiveSession()])}
              className={SOFT_BUTTON_CLASS}
            >
              <RefreshCw className="h-4 w-4" />
              {t('computerUse.refresh')}
            </Button>
          </div>
        </div>
      </section>

      {notices.length > 0 ? (
        <div className="grid gap-3 xl:grid-cols-2">
          {notices.map(({ key, ...notice }) => (
            <StatusNotice key={key} {...notice} />
          ))}
        </div>
      ) : null}

      <div className="grid items-start gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-5 xl:sticky xl:top-4">
          <ComputerUseTaskPanel
            models={toolModels}
            selectedModel={selectedModel}
            goal={goal}
            approvalMode={approvalMode}
            sessionStatus={currentSession?.status}
            isLoading={isLoading}
            canStart={canStart}
            contextText={contextSourceSession?.goal || null}
            templates={templates}
            onSelectModel={setSelectedModel}
            onGoalChange={setGoal}
            onApprovalModeChange={setApprovalMode}
            onTemplateSelect={setGoal}
            onOpenSettings={() => navigate('/settings')}
            onStart={() => void handleStart()}
            onPause={() => void pause()}
            onResume={() => void resume()}
            onStop={() => void cancel()}
          />

          <Card className={SURFACE_CARD_CLASS}>
            <CardHeader className="border-b border-white/10 pb-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-lg text-white">{t('computerUse.historyTitle')}</CardTitle>
                  <CardDescription className="mt-2 text-sm leading-6 text-slate-400">
                    {t('computerUse.historyDescription')}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-full text-slate-400 hover:bg-white/[0.06] hover:text-white"
                    onClick={() => setIsHistoryCollapsed((prev) => !prev)}
                    title={isHistoryCollapsed ? t('common.expand') : t('common.collapse')}
                  >
                    <HistoryToggleIcon className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-full border-rose-400/20 bg-rose-500/10 px-3 text-xs text-rose-200 hover:bg-rose-500/20 hover:text-rose-100"
                    disabled={!canDeleteAllHistory}
                    onClick={() => setIsDeleteAllOpen(true)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t('computerUse.deleteAll')}
                  </Button>
                </div>
              </div>
            </CardHeader>

            {!isHistoryCollapsed ? (
              <CardContent className="space-y-2 p-5">
                {sessions.length === 0 ? (
                  <div className="rounded-[20px] border border-dashed border-white/10 bg-white/[0.02] px-4 py-5 text-sm leading-6 text-slate-400">
                    {t('computerUse.noHistory')}
                  </div>
                ) : (
                  sessions.map((item) => {
                    const active = currentSession?.id === item.id;
                    const disabled = hasActiveSession && currentSession?.id !== item.id;
                    const isDraftParent = draftParentSessionId === item.id && !currentSession;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => void handleSelectSession(item.id)}
                        disabled={disabled}
                        className={cn(
                          'w-full rounded-[20px] border px-4 py-3 text-left transition',
                          active
                            ? 'border-cyan-400/25 bg-cyan-400/10 text-white'
                            : 'border-white/10 bg-white/[0.03] text-slate-200 hover:bg-white/[0.06]',
                          disabled && 'cursor-not-allowed opacity-50',
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">
                              {item.goal || t('computerUse.overviewNoGoal')}
                            </div>
                            <div className={cn('mt-1 text-xs leading-5', active ? 'text-cyan-100/80' : 'text-slate-500')}>
                              {item.model} · {formatHistoryTimestamp(item)}
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1.5">
                            <Badge className={cn('rounded-full border px-2.5 py-0.5 text-[11px] shadow-none', active ? 'border-cyan-400/25 bg-cyan-400/15 text-cyan-100' : getDarkStatusPillClasses(item.status))}>
                              {formatStatusLabel(item.status)}
                            </Badge>
                            {isDraftParent ? (
                              <span className="text-[11px] text-sky-300">{t('computerUse.nextTaskContext')}</span>
                            ) : null}
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </CardContent>
            ) : null}
          </Card>
        </div>

        <div className="space-y-5">
          <ComputerUseSessionView
            session={currentSession}
            actionCount={actionCount}
            approvalCount={pendingApprovalCount}
            isStreaming={isStreaming}
            selectedModel={selectedModel}
          />

          {sessionError ? (
            <div className="rounded-[22px] border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm leading-6 text-rose-100">
              {sessionError}
            </div>
          ) : null}

          <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_320px]">
            <ComputerUseTimeline
              session={currentSession}
              isStreaming={isStreaming}
              pendingApprovalReason={pendingApproval?.reason || null}
            />

            <div className="space-y-5">
              <ComputerUseOutputView
                latestScreenshot={currentScreenshotUrl}
                screenSummary={currentSession?.latest_screen_summary || ''}
                modelOutput={currentSession?.assistant_text || ''}
                isStreaming={isStreaming}
              />

              <Card className={SURFACE_CARD_CLASS}>
                <CardHeader className="border-b border-white/10 pb-4">
                  <CardTitle className="text-lg text-white">{t('computerUse.resultsTitle')}</CardTitle>
                  <CardDescription className="mt-2 text-sm leading-6 text-slate-400">
                    {t('computerUse.resultsEmpty')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 p-5">
                  {resultItems.length > 0 ? resultItems.map((item) => (
                    <div key={item.key} className={cn(INNER_CARD_CLASS, 'px-4 py-3')}>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        {t(item.labelKey)}
                      </div>
                      {item.href ? (
                        <a
                          href={item.href}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 flex items-start gap-2 break-all text-sm leading-6 text-cyan-200 hover:text-cyan-100"
                        >
                          <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0" />
                          <span>{item.value}</span>
                        </a>
                      ) : (
                        <div className="mt-2 break-all text-sm leading-6 text-slate-200">{item.value}</div>
                      )}
                      {item.meta ? (
                        <div className="mt-1 text-xs leading-5 text-slate-500">{item.meta}</div>
                      ) : null}
                    </div>
                  )) : (
                    <div className="rounded-[20px] border border-dashed border-white/10 bg-white/[0.02] px-4 py-5 text-sm leading-6 text-slate-400">
                      {t('computerUse.resultsEmpty')}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className={SURFACE_CARD_CLASS}>
                <CardHeader className="border-b border-white/10 pb-4">
                  <CardTitle className="text-lg text-white">{t('computerUse.allowedPaths')}</CardTitle>
                  <CardDescription className="mt-2 text-sm leading-6 text-slate-400">
                    {activeScopeCwd}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 p-5">
                  {previewAllowedPaths.length > 0 ? previewAllowedPaths.map((path) => (
                    <div key={path} className="inline-flex max-w-full items-center rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-slate-200">
                      <span className="truncate">{path}</span>
                    </div>
                  )) : (
                    <div className="rounded-[20px] border border-dashed border-white/10 bg-white/[0.02] px-4 py-5 text-sm leading-6 text-slate-400">
                      {t('computerUse.overviewScopeEmpty')}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={isDeleteAllOpen} onOpenChange={setIsDeleteAllOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('computerUse.deleteAllConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('computerUse.deleteAllConfirmDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setIsDeleteAllOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={() => void handleDeleteAllHistory()}>
              {t('computerUse.deleteAll')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(pendingApproval)} onOpenChange={() => undefined}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('computerUse.approvalDialogTitle')}</DialogTitle>
            <DialogDescription>
              {pendingApproval?.reason || t('computerUse.approvalDialogDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-4 py-3 text-sm">
            <ShieldAlert className="h-4 w-4 shrink-0 text-amber-500" />
            <span className="font-medium">{pendingApproval?.tool_name}</span>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => void reject(pendingApproval?.id || '', t('computerUse.rejectedByUser'))}
            >
              {t('computerUse.reject')}
            </Button>
            <Button className="flex-1" onClick={() => void approve(pendingApproval?.id || '')}>
              <CheckCircle2 className="h-4 w-4" />
              {t('computerUse.approve')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusNotice({
  icon: Icon,
  tone,
  title,
  description,
  detail,
  action,
}: {
  icon: LucideIcon;
  tone: 'sky' | 'amber' | 'rose';
  title: string;
  description: string;
  detail?: string;
  action?: {
    label: string;
    onClick: () => void;
    loading?: boolean;
  };
}) {
  const toneClass = tone === 'sky'
    ? 'border-sky-400/20 bg-sky-500/10 text-sky-100'
    : tone === 'rose'
      ? 'border-rose-400/20 bg-rose-500/10 text-rose-100'
      : 'border-amber-400/20 bg-amber-500/10 text-amber-100';

  return (
    <div className={cn('rounded-[24px] border px-4 py-4 shadow-sm', toneClass)}>
      <div className="flex h-full flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <Icon className="mt-0.5 h-[18px] w-[18px] shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold">{title}</div>
            <div className="mt-1 text-sm leading-6 opacity-90">{description}</div>
            {detail ? (
              <pre className="mt-3 overflow-x-auto rounded-2xl border border-current/10 bg-black/10 px-3 py-2 text-[11px] leading-5 opacity-90">
                {detail}
              </pre>
            ) : null}
          </div>
        </div>
        {action ? (
          <Button
            size="sm"
            variant="outline"
            onClick={action.onClick}
            disabled={action.loading}
            className="rounded-full border-current/15 bg-black/10 px-4 hover:bg-black/15"
          >
            {action.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
            {action.label}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
