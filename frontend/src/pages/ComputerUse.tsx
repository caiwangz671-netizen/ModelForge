import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  FileSearch,
  Loader2,
  MonitorSmartphone,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  ShieldAlert,
  Square,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import type { Model } from '@/types';
import type { ComputerUseApprovalMode, ComputerUseSessionListItem } from '@/types/computerUse';
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

function supportsTools(model: Model): boolean {
  return Boolean(model.capabilities?.supports_tools);
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
  const [isHistoryCollapsed, setIsHistoryCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(COMPUTER_USE_HISTORY_COLLAPSED_STORAGE_KEY) === 'true';
  });

  const toolModels = useMemo(() => models.filter((model) => supportsTools(model)), [models]);
  const selectedModelMeta = useMemo(
    () => toolModels.find((model) => model.name === selectedModel) || null,
    [selectedModel, toolModels],
  );
  const selectedModelSupportsVision = Boolean(selectedModelMeta && supportsVision(selectedModelMeta));
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

  const canStart = Boolean(
    statusPayload?.desktop_available
      && (selectedModelSupportsVision || statusPayload?.ocr?.available)
      && selectedModel
      && goal.trim()
      && !hasActiveSession,
  );

  const permissions = statusPayload?.helper?.permissions;
  const permissionReady = Boolean(permissions?.accessibility && permissions?.screen_recording);
  const perceptionReady = Boolean(statusPayload?.ocr?.available || selectedModelSupportsVision);
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
  const timeline = useMemo(() => (currentSession?.actions || []).slice().reverse(), [currentSession?.actions]);
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
      value: statusPayload?.desktop_mode ? 'Desktop' : 'Browser',
      hint: statusPayload?.desktop_mode ? activeScopeCwd : t('computerUse.desktopOnlyDescription'),
      tone: statusPayload?.desktop_mode ? 'emerald' : 'amber',
    },
    {
      key: 'perception',
      icon: FileSearch,
      title: t('computerUse.overviewPerception'),
      value: selectedModelSupportsVision ? 'Vision' : statusPayload?.ocr.available ? 'OCR' : 'Unavailable',
      hint: selectedModelSupportsVision
        ? (selectedModel || t('computerUse.selectModel'))
        : (statusPayload?.ocr.local_engine_name || statusPayload?.recommended_ocr.name || t('computerUse.ocrRequiredTitle')),
      tone: perceptionReady ? 'emerald' : 'amber',
    },
    {
      key: 'permissions',
      icon: ShieldAlert,
      title: t('computerUse.overviewPermissions'),
      value: permissionReady ? t('computerUse.permissionsGranted') : t('computerUse.permissionsMissing'),
      hint: `${t('computerUse.screenRecording')} ${permissions?.screen_recording ? '✓' : '✗'} · ${t('computerUse.accessibility')} ${permissions?.accessibility ? '✓' : '✗'}`,
      tone: permissionReady ? 'emerald' : 'rose',
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
    <div className="flex min-h-0 flex-col gap-5" style={{ minHeight: 'calc(100svh - 96px)' }}>
      <section className="overflow-hidden rounded-[30px] border border-slate-200/80 bg-slate-50/90 shadow-[0_32px_110px_-78px_rgba(15,23,42,0.38)]">
        <div className="grid gap-6 px-6 py-6 lg:grid-cols-[minmax(0,1.15fr)_460px] lg:px-8 lg:py-7">
          <div className="space-y-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="secondary"
                    className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-700 shadow-sm"
                  >
                    {t('computerUse.beta')}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={cn(
                      'gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium shadow-sm',
                      statusPayload?.desktop_mode
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-amber-200 bg-amber-50 text-amber-700',
                    )}
                  >
                    <MonitorSmartphone className="h-3.5 w-3.5" />
                    {statusPayload?.desktop_mode ? 'Desktop' : 'Browser'}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={cn(
                      'gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium shadow-sm',
                      perceptionReady
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-amber-200 bg-amber-50 text-amber-700',
                    )}
                  >
                    {perceptionReady ? <CheckCircle2 className="h-3.5 w-3.5" /> : <FileSearch className="h-3.5 w-3.5" />}
                    {selectedModelSupportsVision ? 'Vision' : statusPayload?.ocr.available ? 'OCR' : 'No OCR'}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={cn(
                      'gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium shadow-sm',
                      permissionReady
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-rose-200 bg-rose-50 text-rose-700',
                    )}
                  >
                    <ShieldAlert className="h-3.5 w-3.5" />
                    {permissionReady ? t('computerUse.permissionsGranted') : t('computerUse.permissionsMissing')}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={cn(
                      'rounded-full border px-3 py-1 text-[11px] font-medium shadow-sm',
                      activeApprovalMode === 'hands_free'
                        ? 'border-sky-200 bg-sky-50 text-sky-700'
                        : 'border-slate-200 bg-white text-slate-700',
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
                    <h1 className="text-3xl font-semibold tracking-tight text-slate-950 lg:text-[2.3rem]">
                      {t('computerUse.title')}
                    </h1>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 lg:text-[15px]">
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
                  className="rounded-full border-slate-200 bg-white px-4 shadow-sm hover:bg-slate-50"
                >
                  <Plus className="h-4 w-4" />
                  {t('computerUse.newTask')}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void Promise.all([loadStatus(), loadSessions(), reconnectActiveSession()])}
                  className="rounded-full border-slate-200 bg-white px-4 shadow-sm hover:bg-slate-50"
                >
                  <RefreshCw className="h-4 w-4" />
                  {t('computerUse.refresh')}
                </Button>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-[240px_minmax(0,1fr)]">
              <div className="rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {t('computerUse.model')}
                </div>
                <div className="mt-3 truncate text-base font-semibold text-slate-950">
                  {selectedModel || t('computerUse.selectModel')}
                </div>
              </div>

              <div className="rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {t('computerUse.goal')}
                </div>
                <div className="mt-3 line-clamp-2 text-sm leading-6 text-slate-700">
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
                  className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        {card.title}
                      </div>
                      <div className="text-lg font-semibold tracking-tight text-slate-950">
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
                  <div className="mt-4 line-clamp-2 text-xs leading-5 text-slate-600">
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
          <div className="rounded-[24px] border border-amber-200/80 bg-amber-50/70 px-4 py-4 shadow-sm">
            <div className="flex items-start gap-3">
              <MonitorSmartphone className="mt-0.5 h-[18px] w-[18px] shrink-0 text-amber-600" />
              <div>
                <div className="text-sm font-semibold text-amber-900">{t('computerUse.desktopOnlyTitle')}</div>
                <div className="mt-1 text-sm leading-6 text-amber-800/90">
                  {t('computerUse.desktopOnlyDescription')}
                </div>
              </div>
            </div>
          </div>
        )}

        {statusPayload && !selectedModelSupportsVision && !statusPayload.ocr.available && (
          <div className="rounded-[24px] border border-amber-200/80 bg-amber-50/70 px-4 py-4 shadow-sm">
            <div className="flex items-start gap-3">
              <FileSearch className="mt-0.5 h-[18px] w-[18px] shrink-0 text-amber-600" />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-amber-900">{t('computerUse.ocrRequiredTitle')}</div>
                <div className="mt-1 text-sm leading-6 text-amber-800/90">
                  {t('computerUse.ocrRecommendation', { name: statusPayload.recommended_ocr.name })}
                </div>
                {statusPayload.recommended_ocr.install_hint && (
                  <pre className="mt-3 overflow-x-auto rounded-2xl border border-amber-200/80 bg-white/80 px-3 py-2 text-[11px] leading-5 text-slate-700">
                    {statusPayload.recommended_ocr.install_hint}
                  </pre>
                )}
              </div>
            </div>
          </div>
        )}

        {statusPayload && permissions && !permissionReady && (
          <div className="rounded-[24px] border border-rose-200/80 bg-rose-50/70 px-4 py-4 shadow-sm">
            <div className="flex h-full flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 h-[18px] w-[18px] shrink-0 text-rose-600" />
                <div>
                  <div className="text-sm font-semibold text-rose-900">{t('computerUse.permissionTitle')}</div>
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
                className="rounded-full border-rose-200 bg-white/80 px-4 hover:bg-white"
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

      <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[340px_minmax(0,0.92fr)_minmax(420px,1.08fr)]">
        <Card className="flex min-h-0 flex-col overflow-hidden rounded-[28px] border-slate-200/80 bg-white/90 shadow-[0_28px_80px_-56px_rgba(15,23,42,0.4)] backdrop-blur">
          <CardHeader className="border-b border-slate-200/70 pb-4">
            <CardTitle className="text-lg font-semibold tracking-tight text-slate-950">
              {t('computerUse.taskPanelTitle')}
            </CardTitle>
            <CardDescription className="leading-6">
              {t('computerUse.taskPanelDescription')}
            </CardDescription>
          </CardHeader>

          <CardContent className="flex-1 overflow-y-auto p-5">
            <div className="space-y-5">
              <div className="space-y-2.5">
                <Label htmlFor="computer-use-model" className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {t('computerUse.model')}
                </Label>
                <Select value={selectedModel} onValueChange={setSelectedModel}>
                  <SelectTrigger
                    id="computer-use-model"
                    className="h-12 rounded-2xl border-slate-200 bg-slate-50/80 px-4 text-sm shadow-inner"
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
                <Label htmlFor="computer-use-goal" className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {t('computerUse.goal')}
                </Label>
                <textarea
                  id="computer-use-goal"
                  value={goal}
                  onChange={(event) => setGoal(event.target.value)}
                  rows={7}
                  className="min-h-[176px] w-full rounded-[24px] border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm leading-6 shadow-inner outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:bg-white focus:ring-2 focus:ring-slate-200 resize-none"
                  placeholder={t('computerUse.goalPlaceholder')}
                />
              </div>

              <div className="rounded-[24px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.95),rgba(241,245,249,0.78))] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      {t('computerUse.settingsCardTitle')}
                    </div>
                    <div className="mt-2 text-sm leading-6 text-slate-600">
                      {t('computerUse.settingsCardDescription')}
                    </div>
                  </div>
                  <Button asChild variant="outline" size="sm" className="rounded-full px-3 text-xs">
                    <Link to="/settings">
                      <Settings2 className="h-3.5 w-3.5" />
                      {t('computerUse.openSettings')}
                    </Link>
                  </Button>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[18px] border border-white/80 bg-white/85 px-4 py-3 shadow-sm">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                      {t('computerUse.approvalMode')}
                    </div>
                    <div className="mt-2 text-sm font-semibold text-slate-950">
                      {t(getApprovalModeLabelKey(approvalMode))}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-slate-500">
                      {approvalMode === 'hands_free'
                        ? t('computerUse.approvalModeHandsFreeHint')
                        : t('computerUse.approvalModeReviewAllHint')}
                    </div>
                  </div>

                  <div className="rounded-[18px] border border-white/80 bg-white/85 px-4 py-3 shadow-sm">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                      {t('computerUse.scopeAutoTitle')}
                    </div>
                    <div className="mt-2 text-sm font-semibold text-slate-950">
                      {useCustomScope ? t('computerUse.scopeCustomize') : t('computerUse.scopeAutoTitle')}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-slate-500">
                      {useCustomScope ? (cwd || statusPayload?.default_cwd || '-') : t('computerUse.allowedPathsHint')}
                    </div>
                  </div>
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
                <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    {t('computerUse.sessionModel')}
                  </div>
                  <div className="mt-2 truncate text-sm font-semibold text-slate-950">
                    {currentSession?.model || selectedModel || '-'}
                  </div>
                </div>
                <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    {t('computerUse.actionCount')}
                  </div>
                  <div className="mt-2 text-sm font-semibold text-slate-950">{actionCount}</div>
                </div>
                <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    {t('computerUse.approvalCount')}
                  </div>
                  <div className="mt-2 text-sm font-semibold text-slate-950">{pendingApprovalCount}</div>
                </div>
                <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    {t('computerUse.approvalMode')}
                  </div>
                  <div className="mt-2 text-sm font-semibold text-slate-950">
                    {t(getApprovalModeLabelKey(activeApprovalMode))}
                  </div>
                </div>
              </div>

              {sessionError && (
                <div className="rounded-[22px] border border-rose-200/80 bg-rose-50/70 px-4 py-3 text-sm leading-6 text-rose-700">
                  {sessionError}
                </div>
              )}

              {(contextSourceSession || draftParentSessionId) && (
                <div className="rounded-[24px] border border-sky-200/80 bg-sky-50/70 p-4">
                  <div className="flex items-start gap-3">
                    <Clock3 className="mt-0.5 h-[18px] w-[18px] shrink-0 text-sky-700" />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-sky-900">
                        {currentSession?.parent_session_id
                          ? t('computerUse.contextFromPrevious')
                          : t('computerUse.nextTaskContext')}
                      </div>
                      <div className="mt-1 text-sm leading-6 text-sky-800/90">
                        {contextSourceSession?.goal || t('computerUse.contextUnavailable')}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="rounded-[24px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.95),rgba(241,245,249,0.78))] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      {t('computerUse.historyTitle')}
                    </div>
                    <div className="mt-2 text-sm leading-6 text-slate-600">
                      {t('computerUse.historyDescription')}
                    </div>
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
                      className="h-8 rounded-full px-3 text-xs text-rose-700 hover:bg-rose-50"
                      disabled={!canDeleteAllHistory}
                      onClick={() => setIsDeleteAllOpen(true)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {t('computerUse.deleteAll')}
                    </Button>
                    <Badge variant="outline" className="rounded-full border-slate-200 bg-white px-3 py-1 text-[11px] text-slate-700">
                      {sessions.length}
                    </Badge>
                  </div>
                </div>

                {!isHistoryCollapsed && (
                  <div className="mt-4 space-y-2">
                  {sessions.length === 0 ? (
                    <div className="rounded-[20px] border border-dashed border-slate-300 bg-white/70 px-4 py-5 text-sm leading-6 text-slate-500">
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
                            : 'border-slate-200 bg-white/85 text-slate-800 hover:border-slate-300 hover:bg-white',
                          disabled && 'cursor-not-allowed opacity-55',
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">
                              {item.goal || t('computerUse.overviewNoGoal')}
                            </div>
                            <div className={cn('mt-1 text-xs leading-5', active ? 'text-slate-300' : 'text-slate-500')}>
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
                              <span className={cn('text-[11px]', active ? 'text-slate-300' : 'text-sky-700')}>
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
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex min-h-0 flex-col gap-5">
          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[30px] border-slate-200/80 bg-white/90 shadow-[0_30px_90px_-60px_rgba(15,23,42,0.42)] backdrop-blur">
            <CardHeader className="border-b border-slate-200/70 pb-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle className="text-lg font-semibold tracking-tight text-slate-950">
                    {t('computerUse.screenPanelTitle')}
                  </CardTitle>
                  <CardDescription className="mt-2 leading-6">
                    {t('computerUse.screenPanelDescription')}
                  </CardDescription>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {currentSession?.model && (
                    <Badge variant="outline" className="rounded-full border-slate-200 bg-white px-3 py-1 text-[11px] text-slate-700">
                      {currentSession.model}
                    </Badge>
                  )}
                  <Badge
                    variant="outline"
                    className={cn(
                      'rounded-full border px-3 py-1 text-[11px] font-medium',
                      currentSession ? getSessionPillClasses(currentSession.status) : 'border-slate-200 bg-slate-50 text-slate-600',
                    )}
                  >
                    {currentSession ? formatStatusLabel(currentSession.status) : t('computerUse.overviewNoSession')}
                  </Badge>
                </div>
              </div>
            </CardHeader>

            <CardContent className="flex min-h-0 flex-1 flex-col gap-4 p-5">
              <div className="relative aspect-[16/9] min-h-[300px] max-h-[52vh] w-full overflow-hidden rounded-[28px] border border-slate-200 bg-[#081120] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between border-b border-white/10 bg-[#09182d]/90 px-4 py-3 backdrop-blur">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  </div>
                  <div className="max-w-[65%] truncate text-xs font-medium text-slate-300">
                    {currentSession?.goal || goal.trim() || t('computerUse.goal')}
                  </div>
                </div>

                {currentSession?.latest_artifact_url ? (
                  <img
                    src={BACKEND_ORIGIN + currentSession.latest_artifact_url}
                    alt={t('computerUse.latestScreenshot')}
                    className="h-full w-full object-contain pt-14"
                  />
                ) : (
                  <div className="flex flex-1 items-center justify-center px-6 pt-14">
                    <div className="rounded-[28px] border border-dashed border-white/10 bg-white/[0.03] px-8 py-10 text-center">
                      <MonitorSmartphone className="mx-auto h-8 w-8 text-slate-500" />
                      <div className="mt-4 text-sm font-medium text-slate-300">
                        {t('computerUse.noScreenshot')}
                      </div>
                      <div className="mt-2 text-xs leading-6 text-slate-500">
                        {t('computerUse.screenPanelDescription')}
                      </div>
                    </div>
                  </div>
                )}

              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
                <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {t('computerUse.goal')}
                  </div>
                  <div className="mt-3 text-sm leading-6 text-slate-700">
                    {currentSession?.goal || goal.trim() || t('computerUse.overviewNoGoal')}
                  </div>
                </div>

                <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
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
                        className="inline-flex max-w-full items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
                      >
                        <span className="truncate">{path}</span>
                      </div>
                    )) : (
                      <div className="text-sm leading-6 text-slate-600">
                        {t('computerUse.overviewScopeEmpty')}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex min-h-0 flex-col gap-5">
          <Card className="flex min-h-[360px] flex-col overflow-hidden rounded-[28px] border-slate-200/80 bg-white/90 shadow-[0_28px_80px_-56px_rgba(15,23,42,0.38)] backdrop-blur xl:min-h-[420px]">
            <CardHeader className="border-b border-slate-200/70 pb-4">
              <CardTitle className="text-lg font-semibold tracking-tight text-slate-950">
                {t('computerUse.assistantStream')}
              </CardTitle>
              <CardDescription className="leading-6">
                {t('computerUse.screenPanelDescription')}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-5">
              {currentSession?.assistant_text ? (
                isStreaming ? (
                  <StreamingMarkdownRenderer
                    content={currentSession.assistant_text}
                    enableMath={false}
                    enableCodeHighlight={false}
                    className="text-[15px] leading-7 text-slate-700 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                  />
                ) : (
                  <MarkdownRenderer
                    content={currentSession.assistant_text}
                    enableMath={false}
                    enableCodeHighlight={false}
                    className="text-[15px] leading-7 text-slate-700 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                  />
                )
              ) : (
                <div className="text-[15px] leading-7 text-slate-500">
                  {isStreaming ? t('computerUse.waitingAssistant') : t('computerUse.noAssistantYet')}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] border-slate-200/80 bg-white/90 shadow-[0_28px_80px_-56px_rgba(15,23,42,0.38)] backdrop-blur">
            <CardHeader className="border-b border-slate-200/70 pb-4">
              <CardTitle className="text-lg font-semibold tracking-tight text-slate-950">
                {t('computerUse.timelineTitle')}
              </CardTitle>
              <CardDescription className="leading-6">
                {t('computerUse.timelineDescription')}
              </CardDescription>
            </CardHeader>

            <CardContent className="flex-1 overflow-y-auto p-5">
              <div className="space-y-3">
                {pendingApproval && (
                  <div className="rounded-[22px] border border-amber-200/80 bg-amber-50/75 p-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="mt-0.5 h-[18px] w-[18px] shrink-0 text-amber-600" />
                      <div>
                        <div className="text-sm font-semibold text-amber-900">
                          {t('computerUse.pendingApproval')}
                        </div>
                        <div className="mt-1 text-sm leading-6 text-amber-800/90">
                          {pendingApproval.tool_name}
                        </div>
                        {pendingApproval.reason && (
                          <div className="mt-1 text-xs leading-5 text-amber-700">
                            {pendingApproval.reason}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {timeline.length === 0 && (
                  <div className="rounded-[24px] border border-dashed border-slate-300 p-8 text-center text-sm leading-6 text-slate-500">
                    {t('computerUse.noTimeline')}
                  </div>
                )}

                {timeline.map((action) => (
                  <div key={action.id} className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600">
                            <Bot className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-slate-950">
                              {action.tool_name}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-2">
                              <Badge
                                variant="outline"
                                className={cn('rounded-full border px-2.5 py-0.5 text-[11px]', getActionStatusClasses(action.status))}
                              >
                                {formatStatusLabel(action.status)}
                              </Badge>
                              <Badge
                                variant="outline"
                                className={cn('rounded-full border px-2.5 py-0.5 text-[11px]', getRiskPillClasses(action.risk_level))}
                              >
                                {t('computerUse.riskLevel')}: {formatStatusLabel(action.risk_level)}
                              </Badge>
                              {action.requires_approval && (
                                <Badge variant="outline" className="rounded-full border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] text-amber-700">
                                  {t('computerUse.pendingApproval')}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {action.error && (
                      <div className="mt-3 rounded-[18px] border border-rose-200/80 bg-rose-50/70 px-3 py-2 text-xs leading-5 text-rose-700">
                        {action.error}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
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
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'completed':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'paused':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    case 'waiting_approval':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    case 'failed':
    case 'cancelled':
      return 'border-rose-200 bg-rose-50 text-rose-700';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-600';
  }
}

function getOverviewToneClasses(tone: 'neutral' | 'emerald' | 'amber' | 'rose'): string {
  switch (tone) {
    case 'emerald':
      return 'border-emerald-200/80 bg-emerald-50 text-emerald-700';
    case 'amber':
      return 'border-amber-200/80 bg-amber-50 text-amber-700';
    case 'rose':
      return 'border-rose-200/80 bg-rose-50 text-rose-700';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-600';
  }
}

function getActionStatusClasses(status?: string): string {
  switch (status) {
    case 'completed':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'running':
    case 'started':
      return 'border-sky-200 bg-sky-50 text-sky-700';
    case 'error':
    case 'failed':
      return 'border-rose-200 bg-rose-50 text-rose-700';
    default:
      return 'border-slate-200 bg-white text-slate-600';
  }
}

function getRiskPillClasses(risk?: string): string {
  const normalized = risk?.toLowerCase() || '';
  if (normalized.includes('high')) {
    return 'border-rose-200 bg-rose-50 text-rose-700';
  }
  if (normalized.includes('medium')) {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }
  if (normalized.includes('low')) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  return 'border-slate-200 bg-white text-slate-600';
}
