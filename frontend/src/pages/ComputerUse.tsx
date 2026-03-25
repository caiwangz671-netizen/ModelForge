import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpDown,
  Bot,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock3,
  ExternalLink,
  Eye,
  FileSearch,
  FileText,
  FolderOpen,
  Globe,
  Keyboard,
  Loader2,
  MonitorSmartphone,
  MousePointer2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  ShieldAlert,
  Square,
  Terminal,
  Timer,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import type { Model } from '@/types';
import type { ComputerUseApprovalMode, ComputerUseSession, ComputerUseSessionListItem } from '@/types/computerUse';
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
import { Label } from '@/components/ui/label';
import { MarkdownRenderer, StreamingMarkdownRenderer } from '@/components/MarkdownRenderer';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { loadComputerUsePreferences, normalizeComputerUsePaths } from '@/lib/computerUsePreferences';
import { computerUseApi, API_BASE_URL } from '@/services/api';
import { useComputerUseStore } from '@/store/computerUseStore';
import { useModelStore } from '@/store/modelStore';

const BACKEND_ORIGIN = API_BASE_URL.replace(/\/api$/, '');
const COMPUTER_USE_HISTORY_COLLAPSED_STORAGE_KEY = 'computer-use:historyCollapsed';
const CONVERSATION_PANEL_CLASS = 'rounded-[30px] border border-slate-800 bg-[linear-gradient(180deg,#08101d,#040914)] shadow-[0_30px_90px_-60px_rgba(2,6,23,0.9)]';
const HERO_PANEL_CLASS = 'overflow-hidden rounded-[30px] border border-border/70 bg-card/82 shadow-[0_32px_110px_-78px_rgba(15,23,42,0.38)] backdrop-blur-xl dark:border-border dark:bg-[linear-gradient(180deg,rgba(10,16,30,0.86),rgba(7,12,22,0.94))] dark:shadow-[0_36px_120px_-78px_rgba(2,6,23,0.9)]';
const SURFACE_CARD_CLASS = 'rounded-[24px] border border-border/70 bg-card/86 px-4 py-4 shadow-sm backdrop-blur dark:border-border dark:bg-card/80';
const SOFT_PANEL_CLASS = 'rounded-[24px] border border-border/70 bg-muted/45 p-4 shadow-inner dark:border-border dark:bg-muted/25';
const SOFT_BUTTON_CLASS = 'rounded-full border-border/70 bg-card/86 px-4 shadow-sm hover:bg-muted/70 dark:border-border dark:bg-card/80 dark:text-foreground dark:hover:bg-muted/40';
const SOFT_PILL_CLASS = 'rounded-full border border-border/70 bg-card/82 px-3 py-1 text-[11px] font-medium text-foreground shadow-sm dark:border-border dark:bg-card/76';
const EMERALD_TINT_CLASS = 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-500/12 dark:text-emerald-100';
const AMBER_TINT_CLASS = 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/25 dark:bg-amber-500/12 dark:text-amber-100';
const ROSE_TINT_CLASS = 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/25 dark:bg-rose-500/12 dark:text-rose-100';
const SKY_TINT_CLASS = 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/25 dark:bg-sky-500/12 dark:text-sky-100';

function supportsTools(model: Model): boolean {
  return Boolean(model.capabilities?.supports_tools);
}

function supportsVideo(model: Model): boolean {
  return Boolean(model.capabilities?.supports_video);
}

function supportsVision(model: Model): boolean {
  return Boolean(model.capabilities?.supports_vision);
}

function getApprovalModeLabelKey(mode: ComputerUseApprovalMode): string {
  return mode === 'hands_free'
    ? 'computerUse.approvalModeHandsFree'
    : 'computerUse.approvalModeReviewAll';
}

export function ComputerUse() {
  const { t } = useTranslation();
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

  const [selectedModel, setSelectedModel] = useState('');
  const [isRequestingPermissions, setIsRequestingPermissions] = useState(false);
  const [goal, setGoal] = useState('');
  const [approvalMode, setApprovalMode] = useState<ComputerUseApprovalMode>(() => loadComputerUsePreferences().approvalMode);
  const [cwd, setCwd] = useState(() => loadComputerUsePreferences().cwd);
  const [allowedPaths, setAllowedPaths] = useState<string[]>(() => loadComputerUsePreferences().allowedPaths);
  const [useCustomScope] = useState(() => loadComputerUsePreferences().useCustomScope);
  const [draftParentSessionId, setDraftParentSessionId] = useState<string | null>(null);
  const [isDeleteAllOpen, setIsDeleteAllOpen] = useState(false);
  const [expandedActions, setExpandedActions] = useState<Set<string>>(new Set());
  const [isHistoryCollapsed, setIsHistoryCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(COMPUTER_USE_HISTORY_COLLAPSED_STORAGE_KEY) === 'true';
  });

  const toolModels = useMemo(() => models.filter((model) => supportsTools(model)), [models]);
  const adaptiveScale = useAdaptiveComputerUseScale();
  const adaptiveScaleStyle = useMemo<CSSProperties | undefined>(() => {
    if (adaptiveScale >= 0.999) return undefined;
    return { zoom: adaptiveScale };
  }, [adaptiveScale]);
  const effectiveModelName = currentSession?.model || selectedModel;
  const effectiveModelMeta = useMemo(
    () => toolModels.find((model) => model.name === effectiveModelName) || null,
    [effectiveModelName, toolModels],
  );
  const selectedModelMeta = useMemo(
    () => toolModels.find((model) => model.name === selectedModel) || null,
    [selectedModel, toolModels],
  );
  const effectiveModelSupportsVideo = Boolean(effectiveModelMeta && supportsVideo(effectiveModelMeta));
  const effectiveModelSupportsVision = Boolean(effectiveModelMeta && supportsVision(effectiveModelMeta));
  const selectedModelSupportsVideo = Boolean(selectedModelMeta && supportsVideo(selectedModelMeta));
  const effectiveModelSupportsDirectVision = effectiveModelSupportsVideo || effectiveModelSupportsVision;
  const selectedModelSupportsDirectVision = selectedModelSupportsVideo || Boolean(selectedModelMeta && supportsVision(selectedModelMeta));
  const hasActiveSession = Boolean(currentSession && !isTerminalStatus(currentSession.status));
  const pendingApproval = useMemo(
    () => (currentSession?.approvals || []).filter((item) => item.status === 'pending').at(-1) || null,
    [currentSession?.approvals],
  );
  const pendingApprovalCount = useMemo(
    () => (currentSession?.approvals || []).filter((item) => item.status === 'pending').length,
    [currentSession?.approvals],
  );
  useEffect(() => {
    void Promise.all([fetchModels(), loadStatus(), loadSessions(), reconnectActiveSession()]);
  }, []);

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
  }, [statusPayload, cwd, allowedPaths.length]);

  useEffect(() => {
    if (currentSession?.approval_mode) {
      setApprovalMode(currentSession.approval_mode);
    }
  }, [currentSession?.approval_mode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(COMPUTER_USE_HISTORY_COLLAPSED_STORAGE_KEY, String(isHistoryCollapsed));
  }, [isHistoryCollapsed]);

  const permissions = statusPayload?.helper?.permissions;
  const desktopInputReady = Boolean(statusPayload?.desktop_available);
  const browserAutomationReady = Boolean(statusPayload?.controlled_browser_available);
  const visualObservationReady = Boolean(selectedModelSupportsDirectVision || statusPayload?.ocr?.available);
  const perceptionReady = Boolean(visualObservationReady || browserAutomationReady);
  const permissionReady = !desktopInputReady || Boolean(permissions?.accessibility && permissions?.screen_recording);
  const canStart = Boolean(
    (desktopInputReady || browserAutomationReady)
      && perceptionReady
      && selectedModel
      && goal.trim()
      && !hasActiveSession,
  );
  const actionCount = currentSession?.actions.length || 0;
  const sessionError = currentSession?.error || error;
  const activeApprovalMode = currentSession?.approval_mode || approvalMode;
  const draftScopeCwd = useCustomScope
    ? (cwd || statusPayload?.default_cwd || '-')
    : (statusPayload?.default_cwd || '-');
  const activeScopeCwd = currentSession?.cwd || draftScopeCwd;
  const previewAllowedPaths = useMemo(
    () => normalizeComputerUsePaths(
      currentSession?.allowed_paths
        || (useCustomScope
          ? [cwd, ...allowedPaths]
          : (statusPayload?.default_allowed_paths || [])),
    ),
    [allowedPaths, currentSession?.allowed_paths, cwd, statusPayload?.default_allowed_paths, useCustomScope],
  );
  const currentScreenshotUrl = currentSession?.latest_artifact_url
    ? BACKEND_ORIGIN + currentSession.latest_artifact_url
    : null;
  const taskTemplates = useMemo(() => ([
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
  const resultItems = useMemo(() => buildResultItems(currentSession), [currentSession]);
  const contextSourceSession = useMemo(() => {
    const sourceId = currentSession?.parent_session_id || draftParentSessionId;
    if (!sourceId) return null;
    return sessions.find((item) => item.id === sourceId) || null;
  }, [currentSession?.parent_session_id, draftParentSessionId, sessions]);

  const overviewCards: Array<{
    key: string;
    icon: LucideIcon;
    title: string;
    value: string;
    hint: string;
    tone: 'neutral' | 'emerald' | 'amber' | 'rose';
  }> = [
    {
      key: 'desktop',
      icon: MonitorSmartphone,
      title: t('computerUse.overviewDesktop'),
      value: desktopInputReady
        ? t('computerUse.desktopAutomation')
        : browserAutomationReady
          ? t('computerUse.webAutomation')
          : statusPayload?.desktop_mode
            ? t('computerUse.capabilityUnavailable')
            : t('computerUse.automationUnavailable'),
      hint: desktopInputReady
        ? activeScopeCwd
        : browserAutomationReady
          ? t('computerUse.browserOnlyDescription')
          : t('computerUse.desktopOnlyDescription'),
      tone: desktopInputReady || browserAutomationReady ? 'emerald' : 'amber',
    },
    {
      key: 'perception',
      icon: FileSearch,
      title: t('computerUse.overviewPerception'),
      value: effectiveModelSupportsDirectVision
        ? t('computerUse.routeVideoShort')
        : statusPayload?.ocr.available
          ? t('computerUse.routeOcrShort')
          : browserAutomationReady
            ? t('computerUse.browserStateReady')
            : t('computerUse.capabilityUnavailable'),
      hint: effectiveModelSupportsDirectVision
        ? t('computerUse.videoRouteDescription', { model: effectiveModelName || t('computerUse.selectModel') })
        : statusPayload?.ocr.available
          ? (statusPayload?.ocr.selected_model || statusPayload?.ocr.local_engine_name || statusPayload?.recommended_ocr.name || t('computerUse.ocrRequiredTitle'))
          : browserAutomationReady
            ? t('computerUse.browserStateDescription')
            : (statusPayload?.recommended_ocr.name || t('computerUse.ocrRequiredTitle')),
      tone: perceptionReady ? 'emerald' : 'amber',
    },
    {
      key: 'permissions',
      icon: ShieldAlert,
      title: t('computerUse.overviewPermissions'),
      value: desktopInputReady
        ? (permissionReady ? t('computerUse.permissionsGranted') : t('computerUse.permissionsMissing'))
        : t('computerUse.permissionsNotRequired'),
      hint: desktopInputReady
        ? `${t('computerUse.screenRecording')} ${permissions?.screen_recording ? '✓' : '✗'} · ${t('computerUse.accessibility')} ${permissions?.accessibility ? '✓' : '✗'}`
        : t('computerUse.permissionsBrowserOnlyHint'),
      tone: desktopInputReady ? (permissionReady ? 'emerald' : 'rose') : 'neutral',
    },
    {
      key: 'session',
      icon: Bot,
      title: t('computerUse.overviewSession'),
      value: currentSession ? formatStatusLabel(currentSession.status) : t('computerUse.overviewNoSession'),
      hint: `${t('computerUse.actionCount')} ${actionCount} · ${t('computerUse.approvalCount')} ${pendingApprovalCount}`,
      tone: !currentSession
        ? 'neutral'
        : currentSession.status === 'failed' || currentSession.status === 'cancelled'
          ? 'rose'
          : currentSession.status === 'completed'
            ? 'emerald'
            : currentSession.status === 'running'
              ? 'emerald'
              : 'neutral',
    },
  ];

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
    if (parentSessionId) {
      payload.parent_session_id = parentSessionId;
    }
    if (useCustomScope) {
      if (cwd.trim()) payload.cwd = cwd.trim();
      if (allowedPaths.length > 0) payload.allowed_paths = allowedPaths;
    }
    await createAndRun(payload);
  };

  const handleApprove = async () => {
    if (!pendingApproval) return;
    await approve(pendingApproval.id);
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
    setApprovalMode(currentSession?.approval_mode || 'hands_free');
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
      // Store state already captures the error for inline display.
    }
  };

  const canCreateNewTask = !hasActiveSession && Boolean(currentSession || goal.trim() || error);
  const canDeleteAllHistory = sessions.length > 0;
  const HistoryToggleIcon = isHistoryCollapsed ? ChevronRight : ChevronDown;

  return (
    <div className="flex min-h-0 flex-col gap-5" style={{ minHeight: 'calc(100svh - 96px)', ...adaptiveScaleStyle }}>
      <section className={HERO_PANEL_CLASS}>
        <div className="grid gap-6 px-6 py-6 lg:grid-cols-[minmax(0,1.15fr)_460px] lg:px-8 lg:py-7">
          <div className="space-y-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="secondary"
                    className={SOFT_PILL_CLASS}
                  >
                    {t('computerUse.beta')}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={cn(
                      'gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium shadow-sm',
                      statusPayload?.desktop_mode
                        ? EMERALD_TINT_CLASS
                        : AMBER_TINT_CLASS,
                    )}
                  >
                    <MonitorSmartphone className="h-3.5 w-3.5" />
                    {desktopInputReady
                      ? t('computerUse.desktopAutomation')
                      : browserAutomationReady
                        ? t('computerUse.webAutomation')
                        : t('computerUse.automationUnavailable')}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={cn(
                      'gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium shadow-sm',
                      perceptionReady
                        ? EMERALD_TINT_CLASS
                        : AMBER_TINT_CLASS,
                    )}
                  >
                    {perceptionReady ? <CheckCircle2 className="h-3.5 w-3.5" /> : <FileSearch className="h-3.5 w-3.5" />}
                    {effectiveModelSupportsDirectVision
                      ? t('computerUse.routeVideoShort')
                      : statusPayload?.ocr.available
                        ? t('computerUse.routeOcrShort')
                        : browserAutomationReady
                          ? t('computerUse.browserStateReady')
                          : t('computerUse.noPerception')}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={cn(
                      'gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium shadow-sm',
                      desktopInputReady
                        ? (
                          permissionReady
                            ? EMERALD_TINT_CLASS
                            : ROSE_TINT_CLASS
                        )
                        : 'border-border/70 bg-muted/60 text-foreground dark:border-border dark:bg-muted/35 dark:text-foreground',
                    )}
                  >
                    <ShieldAlert className="h-3.5 w-3.5" />
                    {desktopInputReady
                      ? (permissionReady ? t('computerUse.permissionsGranted') : t('computerUse.permissionsMissing'))
                      : t('computerUse.permissionsNotRequired')}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={cn(
                      'rounded-full border px-3 py-1 text-[11px] font-medium shadow-sm',
                      activeApprovalMode === 'hands_free'
                        ? SKY_TINT_CLASS
                        : 'border-border/70 bg-card/82 text-foreground dark:border-border dark:bg-card/74 dark:text-foreground',
                    )}
                  >
                    {t(getApprovalModeLabelKey(activeApprovalMode))}
                  </Badge>
                  {currentSession && (
                    <Badge
                      variant="outline"
                      className={cn(
                        'rounded-full border px-3 py-1 text-[11px] font-medium shadow-sm',
                        getSessionPillClasses(currentSession.status),
                      )}
                    >
                      {formatStatusLabel(currentSession.status)}
                    </Badge>
                  )}
                </div>

                <div className="space-y-3">
                  <div>
                    <h1 className="text-3xl font-semibold tracking-tight text-foreground lg:text-[2.3rem]">
                      {t('computerUse.title')}
                    </h1>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground lg:text-[15px]">
                      {t('computerUse.subtitle')}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  onClick={handleNewTask}
                  disabled={!canCreateNewTask}
                  className={SOFT_BUTTON_CLASS}
                >
                  <Plus className="h-4 w-4" />
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

            <div className="grid gap-3 lg:grid-cols-[240px_minmax(0,1fr)]">
              <div className={SURFACE_CARD_CLASS}>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {t('computerUse.model')}
                </div>
                <div className="mt-3 truncate text-base font-semibold text-foreground">
                  {selectedModel || t('computerUse.selectModel')}
                </div>
              </div>

              <div className={SURFACE_CARD_CLASS}>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {t('computerUse.goal')}
                </div>
                <div className="mt-3 line-clamp-2 text-sm leading-6 text-foreground/88">
                  {goal.trim() || currentSession?.goal || t('computerUse.overviewNoGoal')}
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {overviewCards.map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.key}
                  className={SURFACE_CARD_CLASS}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        {card.title}
                      </div>
                      <div className="text-lg font-semibold tracking-tight text-foreground">
                        {card.value}
                      </div>
                    </div>
                    <div
                      className={cn(
                        'flex h-10 w-10 items-center justify-center rounded-2xl border',
                        getOverviewToneClasses(card.tone),
                      )}
                    >
                      <Icon className="h-[18px] w-[18px]" />
                    </div>
                  </div>
                  <div className="mt-4 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {card.hint}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <div className="grid shrink-0 gap-3 lg:grid-cols-3">
        {!statusPayload?.desktop_mode && (
          <div className="rounded-[24px] border border-amber-200/80 bg-amber-50/70 px-4 py-4 shadow-sm dark:border-amber-400/25 dark:bg-amber-500/10">
            <div className="flex items-start gap-3">
              <MonitorSmartphone className="mt-0.5 h-[18px] w-[18px] shrink-0 text-amber-600 dark:text-amber-200" />
              <div>
                <div className="text-sm font-semibold text-amber-900 dark:text-amber-100">{t('computerUse.desktopOnlyTitle')}</div>
                <div className="mt-1 text-sm leading-6 text-amber-800/90 dark:text-amber-100/80">
                  {t('computerUse.desktopOnlyDescription')}
                </div>
              </div>
            </div>
          </div>
        )}

        {statusPayload && effectiveModelSupportsDirectVision && (
          <div className="rounded-[24px] border border-sky-200/80 bg-sky-50/70 px-4 py-4 shadow-sm dark:border-sky-400/25 dark:bg-sky-500/10">
            <div className="flex items-start gap-3">
              <FileSearch className="mt-0.5 h-[18px] w-[18px] shrink-0 text-sky-600 dark:text-sky-200" />
              <div>
                <div className="text-sm font-semibold text-sky-900 dark:text-sky-100">{t('computerUse.videoRouteTitle')}</div>
                <div className="mt-1 text-sm leading-6 text-sky-800/90 dark:text-sky-100/80">
                  {t('computerUse.videoRouteDescription', { model: effectiveModelName || t('computerUse.selectModel') })}
                </div>
              </div>
            </div>
          </div>
        )}

        {statusPayload && !selectedModelSupportsDirectVision && !statusPayload.ocr.available && !browserAutomationReady && (
          <div className="rounded-[24px] border border-amber-200/80 bg-amber-50/70 px-4 py-4 shadow-sm dark:border-amber-400/25 dark:bg-amber-500/10">
            <div className="flex items-start gap-3">
              <FileSearch className="mt-0.5 h-[18px] w-[18px] shrink-0 text-amber-600 dark:text-amber-200" />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-amber-900 dark:text-amber-100">{t('computerUse.ocrRequiredTitle')}</div>
                <div className="mt-1 text-sm leading-6 text-amber-800/90 dark:text-amber-100/80">
                  {t('computerUse.ocrRecommendation', { name: statusPayload.recommended_ocr.name })}
                </div>
                {statusPayload.recommended_ocr.install_hint && (
                  <pre className="mt-3 overflow-x-auto rounded-2xl border border-amber-200/80 bg-white/80 px-3 py-2 text-[11px] leading-5 text-slate-700 dark:border-amber-400/20 dark:bg-slate-950/45 dark:text-amber-50/90">
                    {statusPayload.recommended_ocr.install_hint}
                  </pre>
                )}
              </div>
            </div>
          </div>
        )}

        {statusPayload && permissions && desktopInputReady && !permissionReady && (
          <div className="rounded-[24px] border border-rose-200/80 bg-rose-50/70 px-4 py-4 shadow-sm dark:border-rose-400/25 dark:bg-rose-500/10">
            <div className="flex h-full flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 h-[18px] w-[18px] shrink-0 text-rose-600 dark:text-rose-200" />
                <div>
                  <div className="text-sm font-semibold text-rose-900 dark:text-rose-100">{t('computerUse.permissionTitle')}</div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs">
                    <Badge variant={permissions.screen_recording ? 'outline' : 'destructive'} className="text-[11px]">
                      {t('computerUse.screenRecording')}: {permissions.screen_recording ? '✓' : '✗'}
                    </Badge>
                    <Badge variant={permissions.accessibility ? 'outline' : 'destructive'} className="text-[11px]">
                      {t('computerUse.accessibility')}: {permissions.accessibility ? '✓' : '✗'}
                    </Badge>
                  </div>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleRequestPermissions()}
                disabled={isRequestingPermissions}
                className="rounded-full border-rose-200 bg-white/80 px-4 hover:bg-white dark:border-rose-400/25 dark:bg-rose-500/12 dark:text-rose-50 dark:hover:bg-rose-500/18"
              >
                {isRequestingPermissions ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldAlert className="h-4 w-4" />
                )}
                {t('computerUse.requestPermissions')}
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col gap-5">
          <Card className="flex min-h-0 flex-col overflow-hidden rounded-[28px] border-border/70 bg-card/86 shadow-[0_28px_80px_-56px_rgba(15,23,42,0.4)] backdrop-blur dark:border-border dark:bg-card/80 dark:shadow-[0_30px_90px_-58px_rgba(2,6,23,0.88)]">
            <CardHeader className="border-b border-border/70 pb-4">
              <CardTitle className="text-lg font-semibold tracking-tight text-foreground">
                {t('computerUse.taskPanelTitle')}
              </CardTitle>
              <CardDescription className="leading-6">
                {t('computerUse.taskPanelDescription')}
              </CardDescription>
            </CardHeader>

            <CardContent className="flex-1 space-y-5 overflow-y-auto p-5">
              <div className="space-y-2.5">
                <Label htmlFor="computer-use-model" className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {t('computerUse.model')}
                </Label>
                <Select value={selectedModel} onValueChange={setSelectedModel}>
                  <SelectTrigger
                    id="computer-use-model"
                    className="h-12 rounded-2xl border-border/70 bg-muted/50 px-4 text-sm shadow-inner dark:border-border dark:bg-muted/30 dark:text-foreground"
                  >
                    <SelectValue placeholder={t('computerUse.selectModel')} />
                  </SelectTrigger>
                  <SelectContent>
                    {toolModels.map((model) => (
                      <SelectItem key={model.name} value={model.name}>
                        {model.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {toolModels.length === 0 && (
                  <p className="text-xs leading-5 text-muted-foreground">{t('computerUse.noToolModel')}</p>
                )}
              </div>

              <div className="space-y-2.5">
                <Label htmlFor="computer-use-goal" className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {t('computerUse.goal')}
                </Label>
                <textarea
                  id="computer-use-goal"
                  value={goal}
                  onChange={(event) => setGoal(event.target.value)}
                  rows={8}
                  className="min-h-[188px] w-full resize-none rounded-[24px] border border-border/70 bg-muted/50 px-4 py-3 text-sm leading-6 text-foreground shadow-inner outline-none transition placeholder:text-muted-foreground focus:border-primary/35 focus:bg-background/80 focus:ring-2 focus:ring-primary/15 dark:border-border dark:bg-muted/30 dark:text-foreground dark:placeholder:text-muted-foreground dark:focus:border-primary/40 dark:focus:bg-card/85 dark:focus:ring-primary/20"
                  placeholder={t('computerUse.goalPlaceholder')}
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    {t('computerUse.templateTitle')}
                  </div>
                  <div className="text-[11px] text-muted-foreground/80">
                    {t('computerUse.templateHint')}
                  </div>
                </div>
                <div className="grid gap-2">
                  {taskTemplates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => setGoal(template.goal)}
                      className="rounded-[18px] border border-border/70 bg-muted/45 px-4 py-3 text-left transition hover:border-primary/25 hover:bg-card/78 dark:border-border dark:bg-muted/22 dark:hover:border-primary/30 dark:hover:bg-card/72"
                    >
                      <div className="text-sm font-semibold text-foreground">
                        {template.title}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-muted-foreground">
                        {template.goal}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-[24px] bg-slate-950 p-3 text-white shadow-[0_24px_64px_-48px_rgba(15,23,42,0.95)]">
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    onClick={() => void handleStart()}
                    disabled={!canStart || isLoading}
                    className="col-span-2 h-11 rounded-2xl bg-white text-slate-950 hover:bg-slate-100"
                  >
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    {t('computerUse.start')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void pause()}
                    disabled={!currentSession || currentSession.status !== 'running'}
                    className="h-10 rounded-2xl border-white/15 bg-white/10 text-white hover:bg-white/15 hover:text-white"
                  >
                    <Pause className="h-4 w-4" />
                    {t('computerUse.pause')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void resume()}
                    disabled={!currentSession || (currentSession.status !== 'paused' && currentSession.status !== 'waiting_approval')}
                    className="h-10 rounded-2xl border-white/15 bg-white/10 text-white hover:bg-white/15 hover:text-white"
                  >
                    <RefreshCw className="h-4 w-4" />
                    {t('computerUse.resume')}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="col-span-2 h-10 rounded-2xl bg-rose-500 text-white hover:bg-rose-500/90"
                    onClick={() => void cancel()}
                    disabled={!currentSession || isTerminalStatus(currentSession.status)}
                  >
                    <Square className="h-4 w-4" />
                    {t('computerUse.stop')}
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <StatSummaryCard label={t('computerUse.sessionModel')} value={currentSession?.model || selectedModel || '-'} />
                <StatSummaryCard label={t('computerUse.actionCount')} value={String(actionCount)} />
                <StatSummaryCard label={t('computerUse.approvalCount')} value={String(pendingApprovalCount)} />
                <StatSummaryCard label={t('computerUse.approvalMode')} value={t(getApprovalModeLabelKey(activeApprovalMode))} />
              </div>

              <div className={SOFT_PANEL_CLASS}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      {t('computerUse.settingsCardTitle')}
                    </div>
                    <div className="mt-2 text-sm leading-6 text-muted-foreground">
                      {t('computerUse.settingsCardDescription')}
                    </div>
                  </div>
                  <Button asChild variant="outline" size="sm" className="rounded-full px-3 text-xs dark:border-border dark:bg-card/70 dark:text-foreground dark:hover:bg-muted/40">
                    <Link to="/settings">
                      <Settings2 className="h-3.5 w-3.5" />
                      {t('computerUse.openSettings')}
                    </Link>
                  </Button>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <StatSummaryCard
                    label={t('computerUse.approvalMode')}
                    value={t(getApprovalModeLabelKey(activeApprovalMode))}
                    hint={activeApprovalMode === 'hands_free'
                      ? t('computerUse.approvalModeHandsFreeHint')
                      : t('computerUse.approvalModeReviewAllHint')}
                  />
                  <StatSummaryCard
                    label={t('computerUse.scopeAutoTitle')}
                    value={useCustomScope ? t('computerUse.scopeCustomize') : t('computerUse.scopeAutoTitle')}
                    hint={useCustomScope ? (cwd || statusPayload?.default_cwd || '-') : t('computerUse.allowedPathsHint')}
                  />
                </div>
              </div>

              {(contextSourceSession || draftParentSessionId) && (
                <div className="rounded-[24px] border border-sky-200/80 bg-sky-50/70 p-4 dark:border-sky-400/25 dark:bg-sky-500/10">
                  <div className="flex items-start gap-3">
                    <Clock3 className="mt-0.5 h-[18px] w-[18px] shrink-0 text-sky-700 dark:text-sky-200" />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-sky-900 dark:text-sky-100">
                        {currentSession?.parent_session_id
                          ? t('computerUse.contextFromPrevious')
                          : t('computerUse.nextTaskContext')}
                      </div>
                      <div className="mt-1 text-sm leading-6 text-sky-800/90 dark:text-sky-100/80">
                        {contextSourceSession?.goal || t('computerUse.contextUnavailable')}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="flex min-h-0 flex-col overflow-hidden rounded-[28px] border-border/70 bg-card/86 shadow-[0_28px_80px_-56px_rgba(15,23,42,0.4)] backdrop-blur dark:border-border dark:bg-card/80 dark:shadow-[0_30px_90px_-58px_rgba(2,6,23,0.88)]">
            <CardHeader className="border-b border-border/70 pb-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-lg font-semibold tracking-tight text-foreground">
                    {t('computerUse.historyTitle')}
                  </CardTitle>
                  <CardDescription className="leading-6">
                    {t('computerUse.historyDescription')}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-full"
                    onClick={() => setIsHistoryCollapsed((prev) => !prev)}
                    title={isHistoryCollapsed ? t('common.expand') : t('common.collapse')}
                  >
                    <HistoryToggleIcon className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-full px-3 text-xs text-rose-700 hover:bg-rose-500/10 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-200 dark:hover:bg-rose-500/20"
                    disabled={!canDeleteAllHistory}
                    onClick={() => setIsDeleteAllOpen(true)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t('computerUse.deleteAll')}
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="flex-1 overflow-y-auto p-5">
              {!isHistoryCollapsed && (
                <div className="space-y-2">
                  {sessions.length === 0 ? (
                    <div className="rounded-[20px] border border-dashed border-border/70 bg-muted/35 px-4 py-5 text-sm leading-6 text-muted-foreground dark:border-border dark:bg-muted/20 dark:text-muted-foreground">
                      {t('computerUse.noHistory')}
                    </div>
                  ) : sessions.map((item) => {
                    const active = currentSession?.id === item.id;
                    const isDraftParent = draftParentSessionId === item.id && !currentSession;
                    const disabled = hasActiveSession && currentSession?.id !== item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => void handleSelectSession(item.id)}
                        disabled={disabled}
                        className={cn(
                          'w-full rounded-[20px] border px-4 py-3 text-left transition',
                          active
                            ? 'border-slate-950 bg-slate-950 text-white shadow-[0_18px_40px_-30px_rgba(15,23,42,0.9)]'
                            : 'border-border/70 bg-card/75 text-foreground hover:border-primary/25 hover:bg-card dark:border-border dark:bg-card/70 dark:text-foreground dark:hover:border-primary/30 dark:hover:bg-card/82',
                          disabled && 'cursor-not-allowed opacity-55',
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">
                              {item.goal || t('computerUse.overviewNoGoal')}
                            </div>
                            <div className={cn('mt-1 text-xs leading-5', active ? 'text-slate-300' : 'text-muted-foreground')}>
                              {item.model} · {formatHistoryTimestamp(item)}
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1.5">
                            <Badge
                              variant="outline"
                              className={cn(
                                'rounded-full border px-2.5 py-0.5 text-[11px]',
                                active ? 'border-white/20 bg-white/10 text-white' : getSessionPillClasses(item.status),
                              )}
                            >
                              {formatStatusLabel(item.status)}
                            </Badge>
                            {isDraftParent && (
                              <span className={cn('text-[11px]', active ? 'text-slate-300' : 'text-sky-600 dark:text-sky-300')}>
                                {t('computerUse.nextTaskContext')}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <section className={cn(CONVERSATION_PANEL_CLASS, 'flex min-h-0 flex-col overflow-hidden')}>
          <div className="border-b border-white/10 px-6 py-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                  {t('computerUse.conversationTitle')}
                </div>
                <div className="mt-2 text-2xl font-semibold text-white">
                  {currentSession?.goal || goal.trim() || t('computerUse.overviewNoGoal')}
                </div>
                <div className="mt-2 text-sm leading-6 text-slate-300">
                  {t('computerUse.conversationDescription')}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] text-slate-100 shadow-none">
                  {currentSession?.model || selectedModel || t('computerUse.selectModel')}
                </Badge>
                <Badge className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] text-cyan-100 shadow-none">
                  {effectiveModelSupportsDirectVision ? t('computerUse.routeVideoShort') : (statusPayload?.ocr.available ? t('computerUse.routeOcrShort') : t('computerUse.routeUnavailableShort'))}
                </Badge>
                <Badge className={cn('rounded-full border px-3 py-1 text-[11px] shadow-none', currentSession ? getDarkStatusPillClasses(currentSession.status) : 'border-white/10 bg-white/[0.05] text-slate-200')}>
                  {currentSession ? formatStatusLabel(currentSession.status) : t('computerUse.overviewNoSession')}
                </Badge>
              </div>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 gap-5 p-5 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="flex min-h-0 flex-col gap-4">
              {pendingApproval && (
                <div className="rounded-[22px] border border-amber-400/15 bg-amber-400/10 p-4 text-amber-50">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-[18px] w-[18px] shrink-0 text-amber-200" />
                    <div>
                      <div className="text-sm font-semibold">{t('computerUse.pendingApproval')}</div>
                      <div className="mt-1 text-sm leading-6 text-amber-100/90">{pendingApproval.tool_name}</div>
                      {pendingApproval.reason && (
                        <div className="mt-1 text-xs leading-5 text-amber-100/75">{pendingApproval.reason}</div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {sessionError && (
                <div className="rounded-[22px] border border-rose-400/15 bg-rose-500/10 px-4 py-3 text-sm leading-6 text-rose-100">
                  {sessionError}
                </div>
              )}

              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <div className="space-y-4">
                  <div className="flex justify-end">
                    <div className="max-w-[82%] rounded-[24px] rounded-br-md bg-cyan-300 px-4 py-3 text-sm leading-6 text-slate-950 shadow-[0_18px_40px_-30px_rgba(34,211,238,0.6)]">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700">
                        {t('computerUse.goal')}
                      </div>
                      <div className="mt-2 whitespace-pre-wrap">
                        {goal.trim() || currentSession?.goal || t('computerUse.overviewNoGoal')}
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-start">
                    <div className="max-w-[90%] rounded-[24px] rounded-bl-md border border-white/10 bg-white/[0.05] px-4 py-4 text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                        {t('computerUse.assistantStream')}
                      </div>
                      <div className="mt-3">
                        {currentSession?.assistant_text ? (
                          isStreaming ? (
                            <StreamingMarkdownRenderer
                              content={currentSession.assistant_text}
                              enableMath={false}
                              enableCodeHighlight={false}
                              className="text-[15px] leading-7 text-slate-100 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                            />
                          ) : (
                            <MarkdownRenderer
                              content={currentSession.assistant_text}
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

                  {currentSession?.actions.length ? currentSession.actions.map((action) => {
                    const ToolIcon = getToolIcon(action.tool_name);
                    const inputSummary = getToolInputSummary(action.tool_name, action.input_payload);
                    const outputSummary = getToolOutputSummary(action.output_payload);
                    const isExpanded = expandedActions.has(action.id);
                    const hasDetails = Object.keys(action.input_payload || {}).length > 0 || Object.keys(action.output_payload || {}).length > 0;
                    return (
                      <div key={action.id} className="flex justify-start">
                        <div className="max-w-[92%] rounded-[24px] rounded-bl-md border border-white/10 bg-slate-900/60 px-4 py-4 text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                          <div className="flex items-start gap-3">
                            <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-slate-950 text-slate-100', getDarkToolIconAccent(action.tool_name))}>
                              <ToolIcon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <div className="truncate text-sm font-semibold text-white">
                                    {getToolDisplayName(action.tool_name)}
                                  </div>
                                  {inputSummary && (
                                    <div className="mt-1 font-mono text-[12px] leading-5 text-slate-400">
                                      {inputSummary}
                                    </div>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  {action.created_at && (
                                    <span className="text-[11px] text-slate-500">
                                      {formatActionTimestamp(action.created_at)}
                                    </span>
                                  )}
                                  {hasDetails && (
                                    <button
                                      type="button"
                                      onClick={() => setExpandedActions((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(action.id)) next.delete(action.id); else next.add(action.id);
                                        return next;
                                      })}
                                      className="rounded-lg p-0.5 text-slate-400 hover:bg-white/[0.08] hover:text-slate-200"
                                    >
                                      {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                    </button>
                                  )}
                                </div>
                              </div>

                              <div className="mt-2 flex flex-wrap gap-1.5">
                                <Badge className={cn('rounded-full border px-2.5 py-0.5 text-[11px] shadow-none', getDarkStatusPillClasses(action.status))}>
                                  {formatStatusLabel(action.status)}
                                </Badge>
                                <Badge className={cn('rounded-full border px-2.5 py-0.5 text-[11px] shadow-none', getDarkRiskPillClasses(action.risk_level))}>
                                  {t('computerUse.riskLevel')}: {formatStatusLabel(action.risk_level)}
                                </Badge>
                                {action.requires_approval && (
                                  <Badge className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-0.5 text-[11px] text-amber-100 shadow-none">
                                    {t('computerUse.pendingApproval')}
                                  </Badge>
                                )}
                              </div>

                              {outputSummary && (
                                <div className="mt-3 rounded-[14px] border border-emerald-400/15 bg-emerald-400/10 px-3 py-2 text-[12px] leading-5 text-emerald-100">
                                  {outputSummary}
                                </div>
                              )}

                              {action.error && (
                                <div className="mt-3 rounded-[14px] border border-rose-400/15 bg-rose-500/10 px-3 py-2 text-[12px] leading-5 text-rose-100">
                                  {action.error}
                                </div>
                              )}

                              {isExpanded && (
                                <div className="mt-3 space-y-2">
                                  {Object.keys(action.input_payload || {}).length > 0 && (
                                    <div>
                                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Input</div>
                                      <pre className="overflow-x-auto rounded-[16px] border border-white/10 bg-black/25 px-3 py-2 font-mono text-[11px] leading-5 text-slate-200">
                                        {JSON.stringify(action.input_payload, null, 2)}
                                      </pre>
                                    </div>
                                  )}
                                  {Object.keys(action.output_payload || {}).length > 0 && (
                                    <div>
                                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Output</div>
                                      <pre className="overflow-x-auto rounded-[16px] border border-white/10 bg-black/25 px-3 py-2 font-mono text-[11px] leading-5 text-slate-200">
                                        {JSON.stringify(action.output_payload, null, 2)}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  }) : (
                    <div className="rounded-[24px] border border-dashed border-white/10 p-8 text-center text-sm leading-6 text-slate-400">
                      {t('computerUse.noTimeline')}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex min-h-0 flex-col gap-4">
              <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    {t('computerUse.screenPanelTitle')}
                  </div>
                  <Badge className="rounded-full border border-white/10 bg-slate-950/70 px-2.5 py-0.5 text-[11px] text-slate-200 shadow-none">
                    {currentSession?.model || selectedModel || '-'}
                  </Badge>
                </div>
                <div className="mt-4 relative aspect-[4/3] overflow-hidden rounded-[20px] border border-white/10 bg-[#081120]">
                  {currentScreenshotUrl ? (
                    <img
                      src={currentScreenshotUrl}
                      alt={t('computerUse.latestScreenshot')}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center px-4 text-center text-sm leading-6 text-slate-500">
                      {t('computerUse.noScreenshot')}
                    </div>
                  )}
                </div>
                <div className="mt-3 text-xs leading-6 text-slate-400">
                  {currentSession?.latest_screen_summary || t('computerUse.noSummary')}
                </div>
              </div>

              <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    {t('computerUse.resultsTitle')}
                  </div>
                  <Badge className="rounded-full border border-white/10 bg-slate-950/70 px-2.5 py-0.5 text-[11px] text-slate-200 shadow-none">
                    {resultItems.length}
                  </Badge>
                </div>
                <div className="mt-3 space-y-2">
                  {resultItems.length > 0 ? resultItems.map((item) => (
                    <div key={item.key} className="rounded-[18px] border border-white/10 bg-black/20 px-3 py-3">
                      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                        {t(item.labelKey)}
                      </div>
                      {item.href ? (
                        <a
                          href={item.href}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 block break-all text-sm leading-6 text-cyan-200 hover:text-cyan-100"
                        >
                          {item.value}
                        </a>
                      ) : (
                        <div className="mt-2 break-all text-sm leading-6 text-slate-200">
                          {item.value}
                        </div>
                      )}
                      {item.meta && (
                        <div className="mt-1 text-xs leading-5 text-slate-500">
                          {item.meta}
                        </div>
                      )}
                    </div>
                  )) : (
                    <div className="rounded-[18px] border border-dashed border-white/10 px-3 py-4 text-sm leading-6 text-slate-400">
                      {t('computerUse.resultsEmpty')}
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    {t('computerUse.allowedPaths')}
                  </div>
                  <div className="max-w-[55%] truncate text-xs text-slate-500">
                    {activeScopeCwd}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {previewAllowedPaths.length > 0 ? previewAllowedPaths.map((path) => (
                    <div
                      key={path}
                      className="inline-flex max-w-full items-center rounded-full border border-white/10 bg-slate-950/55 px-3 py-1.5 text-xs text-slate-200"
                    >
                      <span className="truncate">{path}</span>
                    </div>
                  )) : (
                    <div className="text-sm leading-6 text-slate-400">
                      {t('computerUse.overviewScopeEmpty')}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <Dialog open={isDeleteAllOpen} onOpenChange={setIsDeleteAllOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('computerUse.deleteAllConfirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('computerUse.deleteAllConfirmDescription')}
            </DialogDescription>
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
            <Button className="flex-1" onClick={() => void handleApprove()}>
              <CheckCircle2 className="h-4 w-4" />
              {t('computerUse.approve')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function isTerminalStatus(status?: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function formatHistoryTimestamp(session: ComputerUseSessionListItem): string {
  const timestamp = session.updated_at || session.completed_at || session.started_at || session.created_at;
  if (!timestamp) {
    return '-';
  }
  try {
    return new Date(timestamp * 1000).toLocaleString([], {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '-';
  }
}

function formatStatusLabel(status?: string | null): string {
  if (!status) return '';
  return status
    .split('_')
    .filter(Boolean)
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
    .join(' ');
}

function getSessionPillClasses(status?: string): string {
  switch (status) {
    case 'running':
      return EMERALD_TINT_CLASS;
    case 'completed':
      return EMERALD_TINT_CLASS;
    case 'paused':
      return AMBER_TINT_CLASS;
    case 'waiting_approval':
      return AMBER_TINT_CLASS;
    case 'failed':
    case 'cancelled':
      return ROSE_TINT_CLASS;
    default:
      return 'border-border/70 bg-muted/55 text-muted-foreground dark:border-border dark:bg-muted/30 dark:text-muted-foreground';
  }
}

function getOverviewToneClasses(tone: 'neutral' | 'emerald' | 'amber' | 'rose'): string {
  switch (tone) {
    case 'emerald':
      return EMERALD_TINT_CLASS;
    case 'amber':
      return AMBER_TINT_CLASS;
    case 'rose':
      return ROSE_TINT_CLASS;
    default:
      return 'border-border/70 bg-muted/55 text-muted-foreground dark:border-border dark:bg-muted/30 dark:text-muted-foreground';
  }
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

function getToolDisplayName(toolName: string): string {
  return toolName
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function getToolInputSummary(toolName: string, payload: Record<string, unknown>): string | null {
  if (!payload) return null;
  try {
    if (toolName === 'computer_click' || toolName === 'computer_click_box' || toolName === 'computer_click_target') {
      if ('x' in payload && 'y' in payload) return `(${payload.x}, ${payload.y})`;
      if ('x1' in payload) return `(${payload.x1}, ${payload.y1}) → (${payload.x2}, ${payload.y2})`;
      if ('target_description' in payload) {
        const d = String(payload.target_description);
        return `"${d.slice(0, 60)}${d.length > 60 ? '…' : ''}"`;
      }
    }
    if (toolName === 'computer_type' || toolName === 'browser_type') {
      const text = String(payload.text ?? payload.value ?? '');
      return text ? `"${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"` : null;
    }
    if (toolName === 'computer_keypress' || toolName === 'browser_keypress') {
      return String(payload.key ?? payload.keys ?? '');
    }
    if (toolName === 'computer_scroll' || toolName === 'browser_scroll') {
      const dir = String(payload.direction ?? '');
      const coords = payload.x !== undefined ? ` at (${payload.x}, ${payload.y})` : '';
      return `${dir}${coords}`.trim() || null;
    }
    if (toolName === 'computer_open_url' || toolName === 'browser_navigate') {
      return String(payload.url ?? '');
    }
    if (toolName === 'computer_open_app') {
      return String(payload.app_name ?? payload.name ?? '');
    }
    if (toolName === 'computer_locate_target') {
      const desc = String(payload.description ?? payload.target ?? '');
      return desc ? `"${desc.slice(0, 60)}${desc.length > 60 ? '…' : ''}"` : null;
    }
    if (toolName === 'computer_wait_for_user') {
      const msg = String(payload.message ?? '');
      return msg ? `"${msg.slice(0, 60)}${msg.length > 60 ? '…' : ''}"` : null;
    }
    if (toolName === 'fs_read_text' || toolName === 'fs_write_text' || toolName === 'fs_list') {
      return String(payload.path ?? '');
    }
    if (toolName === 'shell_exec' || toolName === 'terminal_exec') {
      const cmd = String(payload.command ?? payload.cmd ?? '');
      return cmd ? `${cmd.slice(0, 80)}${cmd.length > 80 ? '…' : ''}` : null;
    }
    if (toolName === 'browser_click') {
      return String(payload.selector ?? payload.description ?? '');
    }
  } catch { /* ignore */ }
  return null;
}

function getToolOutputSummary(payload: Record<string, unknown>): string | null {
  if (!payload) return null;
  try {
    const text = payload.summary
      ?? payload.message
      ?? payload.hint
      ?? payload.reason
      ?? payload.path
      ?? payload.url
      ?? payload.text
      ?? payload.content
      ?? payload.result
      ?? payload.output;
    if (typeof text === 'string' && text.trim()) {
      return `${text.slice(0, 120)}${text.length > 120 ? '…' : ''}`;
    }
  } catch { /* ignore */ }
  return null;
}

function formatActionTimestamp(ts: number): string {
  try {
    return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

function useAdaptiveComputerUseScale(): number {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const recompute = () => {
      const viewportWidth = window.visualViewport?.width || window.innerWidth;
      const viewportHeight = window.visualViewport?.height || window.innerHeight;
      const designWidth = 1560 + 64;
      const designHeight = 980;

      if (viewportWidth < 1280 || viewportHeight < 760) {
        setScale(1);
        return;
      }

      const widthScale = viewportWidth / designWidth;
      const heightScale = viewportHeight / designHeight;
      const nextScale = Math.min(1, widthScale, heightScale);
      setScale(nextScale >= 0.999 ? 1 : Math.max(0.78, Number(nextScale.toFixed(3))));
    };

    recompute();
    window.addEventListener('resize', recompute);
    window.visualViewport?.addEventListener('resize', recompute);

    return () => {
      window.removeEventListener('resize', recompute);
      window.visualViewport?.removeEventListener('resize', recompute);
    };
  }, []);

  return scale;
}

function StatSummaryCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[22px] border border-border/70 bg-muted/40 px-4 py-4 dark:border-border dark:bg-muted/24">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-sm font-semibold text-foreground">
        {value}
      </div>
      {hint && (
        <div className="mt-1 text-xs leading-5 text-muted-foreground">
          {hint}
        </div>
      )}
    </div>
  );
}

function getDarkStatusPillClasses(status?: string | null): string {
  switch (status) {
    case 'running':
      return 'border-cyan-400/20 bg-cyan-400/10 text-cyan-100';
    case 'completed':
      return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100';
    case 'paused':
    case 'waiting_approval':
      return 'border-amber-400/20 bg-amber-400/10 text-amber-100';
    case 'failed':
    case 'cancelled':
    case 'error':
      return 'border-rose-400/20 bg-rose-500/10 text-rose-100';
    default:
      return 'border-white/10 bg-white/[0.05] text-slate-200';
  }
}

function getDarkRiskPillClasses(risk?: string | null): string {
  const normalized = String(risk || '').toLowerCase();
  if (normalized.includes('critical') || normalized.includes('high')) {
    return 'border-rose-400/20 bg-rose-500/10 text-rose-100';
  }
  if (normalized.includes('medium')) {
    return 'border-amber-400/20 bg-amber-400/10 text-amber-100';
  }
  if (normalized.includes('low')) {
    return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100';
  }
  return 'border-white/10 bg-white/[0.05] text-slate-200';
}

function getDarkToolIconAccent(toolName: string): string {
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

function buildResultItems(session: ComputerUseSession | null): Array<{ key: string; labelKey: string; value: string; href?: string; meta?: string }> {
  if (!session) return [];

  const items: Array<{ key: string; labelKey: string; value: string; href?: string; meta?: string }> = [];

  if (session.latest_artifact_url) {
      items.push({
        key: `artifact:${session.latest_artifact_id || 'latest'}`,
        labelKey: 'computerUse.resultLabels.screenshot',
        value: session.latest_artifact_url,
        href: BACKEND_ORIGIN + session.latest_artifact_url,
        meta: session.latest_screen_summary || undefined,
    });
  }

  for (const action of session.actions) {
    const output = action.output_payload || {};
    const input = action.input_payload || {};

    if (action.tool_name === 'fs_write_text') {
      const pathValue = String(output.path ?? input.path ?? '').trim();
      if (pathValue) {
        items.push({
          key: `${action.id}:file`,
          labelKey: 'computerUse.resultLabels.file',
          value: pathValue,
          meta: getToolOutputSummary(output) || undefined,
        });
      }
    }

    if (action.tool_name === 'computer_open_url' || action.tool_name === 'browser_navigate') {
      const urlValue = String(output.url ?? input.url ?? '').trim();
      if (urlValue) {
        items.push({
          key: `${action.id}:url`,
          labelKey: 'computerUse.resultLabels.url',
          value: urlValue,
          href: urlValue,
          meta: getToolOutputSummary(output) || undefined,
        });
      }
    }

    if (action.tool_name === 'computer_open_app') {
      const appName = String(output.app_name ?? input.app_name ?? input.name ?? '').trim();
      if (appName) {
        items.push({
          key: `${action.id}:app`,
          labelKey: 'computerUse.resultLabels.app',
          value: appName,
          meta: getToolOutputSummary(output) || undefined,
        });
      }
    }
  }

  const deduped = new Map<string, { key: string; labelKey: string; value: string; href?: string; meta?: string }>();
  for (const item of items) {
    const dedupeKey = `${item.labelKey}:${item.value}`;
    if (!deduped.has(dedupeKey)) {
      deduped.set(dedupeKey, item);
    }
  }
  return Array.from(deduped.values()).slice(-8).reverse();
}
