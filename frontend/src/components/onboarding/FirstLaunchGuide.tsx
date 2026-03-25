import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  MessageSquare,
  MonitorSmartphone,
  Settings,
  Sparkles,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { downloadsApi, modelsApi, systemApi } from '@/services/api';
import {
  FIRST_LAUNCH_GUIDE_OPEN_EVENT,
  hasCompletedFirstLaunchGuide,
  markFirstLaunchGuideCompleted,
} from '@/lib/onboarding';

type StepKey = 'welcome' | 'ollama' | 'chat' | 'computerUse' | 'settings';
type OllamaHealthState = 'unknown' | 'healthy' | 'unhealthy';
type RecommendedDownloadState = 'idle' | 'starting' | 'started' | 'installed' | 'error';

interface StepMeta {
  key: StepKey;
  icon: LucideIcon;
  accentClass: string;
}

interface DesktopOllamaStatus {
  platform: string;
  installed: boolean;
  running: boolean;
  host?: string;
  install_state?: string;
  install_started_at?: number | null;
  install_completed_at?: number | null;
  install_command?: string;
  download_url?: string;
  recommended_model?: string;
  background?: boolean;
  last_error?: string | null;
}

const BASE_STEP_META: StepMeta[] = [
  {
    key: 'welcome',
    icon: Sparkles,
    accentClass: 'border-cyan-400/20 bg-cyan-400/10 text-cyan-100',
  },
  {
    key: 'chat',
    icon: MessageSquare,
    accentClass: 'border-violet-400/20 bg-violet-400/10 text-violet-100',
  },
  {
    key: 'computerUse',
    icon: MonitorSmartphone,
    accentClass: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100',
  },
  {
    key: 'settings',
    icon: Settings,
    accentClass: 'border-amber-400/20 bg-amber-400/10 text-amber-100',
  },
];

const OLLAMA_STEP_META: StepMeta = {
  key: 'ollama',
  icon: Download,
  accentClass: 'border-sky-400/20 bg-sky-400/10 text-sky-100',
};

export function FirstLaunchGuide() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [ollamaStatus, setOllamaStatus] = useState<DesktopOllamaStatus | null>(null);
  const [ollamaHealth, setOllamaHealth] = useState<OllamaHealthState>('unknown');
  const [recommendedDownloadState, setRecommendedDownloadState] = useState<RecommendedDownloadState>('idle');
  const [recommendedDownloadError, setRecommendedDownloadError] = useState<string | null>(null);
  const autoInstallTriggeredRef = useRef(false);

  const isDesktop = Boolean(window.desktopInfo?.isDesktop);
  const recommendedModelName = ollamaStatus?.recommended_model || 'qwen3.5:4b';
  const canInspectDesktopOllama = isDesktop && typeof window.desktopInfo?.getOllamaStatus === 'function';
  const canInstallDesktopOllama = isDesktop && typeof window.desktopInfo?.installOllama === 'function';
  const shouldShowOllamaStep = Boolean(
    isDesktop
      && (
        !ollamaStatus
        || !ollamaStatus.installed
        || !ollamaStatus.running
        || ollamaHealth !== 'healthy'
        || ollamaStatus.install_state === 'installing'
      ),
  );

  const refreshOllamaHealth = useCallback(async () => {
    try {
      const response = await systemApi.health();
      const nextHealth = response.data?.ollama?.status === 'healthy' ? 'healthy' : 'unhealthy';
      setOllamaHealth(nextHealth);
      return nextHealth;
    } catch {
      setOllamaHealth('unhealthy');
      return 'unhealthy' as const;
    }
  }, []);

  const refreshDesktopOllamaStatus = useCallback(async () => {
    if (!canInspectDesktopOllama) return null;
    try {
      const nextStatus = await window.desktopInfo!.getOllamaStatus!();
      setOllamaStatus(nextStatus);
      return nextStatus;
    } catch (error) {
      console.warn('Failed to query desktop Ollama status:', error);
      return null;
    }
  }, [canInspectDesktopOllama]);

  const refreshRecommendedModelState = useCallback(async () => {
    if (ollamaHealth !== 'healthy') {
      setRecommendedDownloadState((current) => (current === 'installed' ? current : 'idle'));
      return;
    }

    try {
      const response = await modelsApi.list();
      const installed = Array.isArray(response.data?.models)
        && response.data.models.some((model: { name?: string }) => model.name === recommendedModelName);
      if (installed) {
        setRecommendedDownloadState('installed');
        setRecommendedDownloadError(null);
        return;
      }
      setRecommendedDownloadState((current) => (current === 'started' ? current : 'idle'));
    } catch {
      // Leave the current state as-is; the guide remains usable even if the model list call fails.
    }
  }, [ollamaHealth, recommendedModelName]);

  const syncOllamaState = useCallback(async () => {
    const [desktopStatus, healthState] = await Promise.all([
      refreshDesktopOllamaStatus(),
      refreshOllamaHealth(),
    ]);

    if (healthState === 'healthy' || desktopStatus?.running) {
      await refreshRecommendedModelState();
    }

    return { desktopStatus, healthState };
  }, [refreshDesktopOllamaStatus, refreshOllamaHealth, refreshRecommendedModelState]);

  const stepMeta = useMemo(() => {
    const steps = [...BASE_STEP_META];
    if (shouldShowOllamaStep) {
      steps.splice(1, 0, OLLAMA_STEP_META);
    }
    return steps;
  }, [shouldShowOllamaStep]);

  const steps = useMemo(() => (
    stepMeta.map((step) => ({
      ...step,
      eyebrow: t(`onboarding.steps.${step.key}.eyebrow`),
      title: t(`onboarding.steps.${step.key}.title`),
      description: t(`onboarding.steps.${step.key}.description`),
      points: t(`onboarding.steps.${step.key}.points`, { returnObjects: true }) as string[],
    }))
  ), [stepMeta, t]);

  const quickActions = useMemo(() => ([
    {
      key: 'models',
      label: t('onboarding.quickActions.models'),
      icon: Download,
      onClick: () => {
        markFirstLaunchGuideCompleted();
        setOpen(false);
        navigate('/models');
      },
    },
    {
      key: 'chat',
      label: t('onboarding.quickActions.chat'),
      icon: MessageSquare,
      onClick: () => {
        markFirstLaunchGuideCompleted();
        setOpen(false);
        navigate('/chat');
      },
    },
    {
      key: 'computerUse',
      label: t('onboarding.quickActions.computerUse'),
      icon: MonitorSmartphone,
      onClick: () => {
        markFirstLaunchGuideCompleted();
        setOpen(false);
        navigate('/computer-use');
      },
    },
    {
      key: 'settings',
      label: t('onboarding.quickActions.settings'),
      icon: Settings,
      onClick: () => {
        markFirstLaunchGuideCompleted();
        setOpen(false);
        navigate('/settings');
      },
    },
  ]), [navigate, t]);

  useEffect(() => {
    if (!hasCompletedFirstLaunchGuide()) {
      setOpen(true);
    }

    const handleOpen = () => {
      setCurrentStep(0);
      setOpen(true);
      void syncOllamaState();
    };

    window.addEventListener(FIRST_LAUNCH_GUIDE_OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(FIRST_LAUNCH_GUIDE_OPEN_EVENT, handleOpen);
  }, [syncOllamaState]);

  useEffect(() => {
    if (!open) return;
    void syncOllamaState();
  }, [open, syncOllamaState]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => {
      void syncOllamaState();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [open, syncOllamaState]);

  useEffect(() => {
    const nextIndex = steps.findIndex((step) => step.key === 'chat');
    if (currentStep >= steps.length) {
      setCurrentStep(Math.max(0, steps.length - 1));
      return;
    }
    if (!shouldShowOllamaStep && steps[currentStep]?.key === 'ollama' && nextIndex >= 0) {
      setCurrentStep(nextIndex);
    }
  }, [currentStep, shouldShowOllamaStep, steps]);

  const handleInstallOllama = useCallback(async (background = true) => {
    if (!canInstallDesktopOllama) return;
    try {
      const nextStatus = await window.desktopInfo!.installOllama!({ background });
      setOllamaStatus(nextStatus);
      toast({
        title: t('onboarding.ollama.installStartedTitle'),
        description: background
          ? t('onboarding.ollama.installStartedBackground')
          : t('onboarding.ollama.installStartedForeground'),
      });
    } catch (error) {
      const message = error instanceof Error && error.message.trim()
        ? error.message
        : t('onboarding.ollama.installFailedDescription');
      toast({
        title: t('onboarding.ollama.installFailedTitle'),
        description: message,
        variant: 'destructive',
      });
    }
  }, [canInstallDesktopOllama, t, toast]);

  useEffect(() => {
    const activeStepKey = steps[currentStep]?.key;
    if (!open || activeStepKey !== 'ollama' || !canInstallDesktopOllama || !ollamaStatus) {
      return;
    }

    if (ollamaStatus.installed || ollamaStatus.running || ollamaStatus.install_state === 'installing') {
      return;
    }

    if (autoInstallTriggeredRef.current) {
      return;
    }

    autoInstallTriggeredRef.current = true;
    void handleInstallOllama(true);
  }, [canInstallDesktopOllama, currentStep, handleInstallOllama, ollamaStatus, open, steps]);

  const closeGuide = () => {
    markFirstLaunchGuideCompleted();
    setOpen(false);
  };

  const handleDownloadRecommendedModel = useCallback(async () => {
    setRecommendedDownloadState('starting');
    setRecommendedDownloadError(null);
    try {
      await downloadsApi.start('qwen3.5', '4b');
      setRecommendedDownloadState('started');
      toast({
        title: t('onboarding.recommend.downloadStartedTitle'),
        description: t('onboarding.recommend.downloadStartedDescription', { model: recommendedModelName }),
      });
    } catch (error) {
      const message = error instanceof Error && error.message.trim()
        ? error.message
        : t('onboarding.recommend.downloadFailedDescription');
      setRecommendedDownloadState('error');
      setRecommendedDownloadError(message);
      toast({
        title: t('onboarding.recommend.downloadFailedTitle'),
        description: message,
        variant: 'destructive',
      });
    }
  }, [recommendedModelName, t, toast]);

  const activeStep = steps[currentStep];
  if (!activeStep) return null;
  const ActiveIcon = activeStep.icon;
  const ollamaReady = ollamaHealth === 'healthy' || Boolean(ollamaStatus?.running);
  const installFinished = Boolean(ollamaStatus?.installed || ollamaStatus?.running || ollamaStatus?.install_state === 'completed');
  const shouldShowRecommendedPanel = ollamaReady && (activeStep.key === 'ollama' || currentStep === steps.length - 1);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          closeGuide();
          return;
        }
        setOpen(true);
      }}
    >
      <DialogContent className="max-w-5xl overflow-hidden border-border/70 bg-background/96 p-0 backdrop-blur-2xl">
        <div className="grid min-h-[700px] md:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="relative overflow-hidden border-b border-border/70 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_40%),radial-gradient(circle_at_85%_10%,rgba(99,102,241,0.16),transparent_34%),linear-gradient(180deg,#09111f_0%,#050b16_100%)] p-6 text-slate-50 md:border-b-0 md:border-r md:p-7">
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),transparent_28%)]" />
            <div className="relative z-10">
              <Badge className="rounded-full border border-white/10 bg-white/[0.08] px-3 py-1 text-[11px] font-medium text-white shadow-none">
                {t('onboarding.badge')}
              </Badge>

              <div className="mt-5">
                <h2 className="text-[2rem] font-semibold tracking-tight">
                  {t('onboarding.title')}
                </h2>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  {t('onboarding.subtitle')}
                </p>
              </div>

              <div className="mt-8 space-y-2">
                {steps.map((step, index) => {
                  const StepIcon = step.icon;
                  const active = index === currentStep;
                  return (
                    <button
                      key={step.key}
                      type="button"
                      onClick={() => setCurrentStep(index)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition',
                        active
                          ? 'border-white/14 bg-white/[0.08] shadow-[0_18px_40px_-30px_rgba(15,23,42,0.9)]'
                          : 'border-white/8 bg-white/[0.03] hover:border-white/12 hover:bg-white/[0.05]',
                      )}
                    >
                      <div className={cn('flex h-10 w-10 items-center justify-center rounded-2xl border', step.accentClass)}>
                        <StepIcon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                          {t('onboarding.stepLabel', { current: index + 1, total: steps.length })}
                        </div>
                        <div className="mt-1 truncate text-sm font-semibold text-white">
                          {step.title}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 text-sm leading-6 text-slate-300">
                {t('onboarding.skipHint')}
              </div>
            </div>
          </aside>

          <div className="flex min-h-full flex-col p-6 md:p-8">
            <div className="flex items-start justify-between gap-4">
              <div className="max-w-2xl">
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  {activeStep.eyebrow}
                </div>
                <h3 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
                  {activeStep.title}
                </h3>
                <p className="mt-3 text-sm leading-7 text-muted-foreground">
                  {activeStep.description}
                </p>
              </div>
              <div className={cn('hidden h-14 w-14 shrink-0 items-center justify-center rounded-[18px] border sm:flex', activeStep.accentClass)}>
                <ActiveIcon className="h-5 w-5" />
              </div>
            </div>

            {activeStep.key === 'ollama' ? (
              <div className="mt-8 space-y-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-[22px] border border-border/70 bg-card/82 px-4 py-4 shadow-sm dark:bg-card/78">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      {t('onboarding.ollama.installStatus')}
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                      {ollamaStatus?.install_state === 'installing' && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                      {ollamaStatus?.install_state === 'completed' || installFinished
                        ? t('onboarding.ollama.installComplete')
                        : ollamaStatus?.install_state === 'failed'
                          ? t('onboarding.ollama.installFailed')
                          : t('onboarding.ollama.installing')}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-muted-foreground">
                      {ollamaStatus?.install_state === 'installing'
                        ? t('onboarding.ollama.installInBackground')
                        : t('onboarding.ollama.installStatusHint')}
                    </div>
                  </div>

                  <div className="rounded-[22px] border border-border/70 bg-card/82 px-4 py-4 shadow-sm dark:bg-card/78">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      {t('onboarding.ollama.desktopStatus')}
                    </div>
                    <div className="mt-2 text-sm font-semibold text-foreground">
                      {ollamaStatus?.installed
                        ? t('onboarding.ollama.installed')
                        : t('onboarding.ollama.notInstalled')}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-muted-foreground">
                      {ollamaStatus?.running
                        ? t('onboarding.ollama.serviceRunning')
                        : t('onboarding.ollama.serviceNotRunning')}
                    </div>
                  </div>

                  <div className="rounded-[22px] border border-border/70 bg-card/82 px-4 py-4 shadow-sm dark:bg-card/78">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      {t('onboarding.ollama.healthStatus')}
                    </div>
                    <div className="mt-2 text-sm font-semibold text-foreground">
                      {ollamaReady ? t('onboarding.ollama.healthReady') : t('onboarding.ollama.healthWaiting')}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-muted-foreground">
                      {ollamaStatus?.host || t('onboarding.ollama.healthHostUnknown')}
                    </div>
                  </div>
                </div>

                <div className="rounded-[24px] border border-border/70 bg-muted/35 p-5 dark:bg-muted/20">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="max-w-2xl">
                      <div className="text-sm font-semibold text-foreground">
                        {t('onboarding.ollama.installCommandTitle')}
                      </div>
                      <div className="mt-1 text-sm leading-6 text-muted-foreground">
                        {t('onboarding.ollama.installCommandDescription')}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void syncOllamaState()}
                      >
                        <Sparkles className="h-4 w-4" />
                        {t('common.refresh')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void handleInstallOllama(true)}
                        disabled={!canInstallDesktopOllama || ollamaStatus?.install_state === 'installing'}
                      >
                        {ollamaStatus?.install_state === 'installing'
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <Terminal className="h-4 w-4" />}
                        {t('onboarding.ollama.retryInstall')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void window.desktopInfo?.openExternal?.(ollamaStatus?.download_url || 'https://ollama.com/download')}
                      >
                        <ExternalLink className="h-4 w-4" />
                        {t('onboarding.ollama.openDownloadPage')}
                      </Button>
                    </div>
                  </div>

                  {ollamaStatus?.install_command && (
                    <pre className="mt-4 overflow-x-auto rounded-[18px] border border-border/70 bg-slate-950/90 px-4 py-3 text-[12px] leading-6 text-slate-100">
                      {ollamaStatus.install_command}
                    </pre>
                  )}

                  {ollamaStatus?.last_error && (
                    <div className="mt-4 rounded-[18px] border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm leading-6 text-rose-100">
                      {ollamaStatus.last_error}
                    </div>
                  )}
                </div>

                {shouldShowRecommendedPanel && (
                  <div className="rounded-[24px] border border-border/70 bg-card/82 p-5 shadow-sm dark:bg-card/78">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="max-w-2xl">
                        <Badge className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] text-emerald-100 shadow-none">
                          {t('onboarding.recommend.badge')}
                        </Badge>
                        <div className="mt-3 text-lg font-semibold text-foreground">
                          {recommendedModelName}
                        </div>
                        <div className="mt-2 text-sm leading-6 text-muted-foreground">
                          {t('onboarding.recommend.description')}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          onClick={() => void handleDownloadRecommendedModel()}
                          disabled={recommendedDownloadState === 'starting' || recommendedDownloadState === 'started' || recommendedDownloadState === 'installed'}
                        >
                          {recommendedDownloadState === 'starting'
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <Download className="h-4 w-4" />}
                          {recommendedDownloadState === 'installed'
                            ? t('onboarding.recommend.installed')
                            : recommendedDownloadState === 'started'
                              ? t('onboarding.recommend.started')
                              : t('onboarding.recommend.download')}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            markFirstLaunchGuideCompleted();
                            setOpen(false);
                            navigate('/models');
                          }}
                        >
                          {t('onboarding.recommend.openModels')}
                        </Button>
                      </div>
                    </div>
                    {recommendedDownloadError && (
                      <div className="mt-4 rounded-[18px] border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm leading-6 text-rose-100">
                        {recommendedDownloadError}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-8 space-y-6">
                <div className="grid gap-3 md:grid-cols-2">
                  {activeStep.points.map((point, index) => (
                    <div
                      key={`${activeStep.key}-${index}`}
                      className="rounded-[22px] border border-border/70 bg-card/82 px-4 py-4 shadow-sm dark:bg-card/78"
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-primary">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </div>
                        <div className="text-sm leading-6 text-foreground/88">
                          {point}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {shouldShowRecommendedPanel && (
                  <div className="rounded-[24px] border border-border/70 bg-muted/35 p-5 dark:bg-muted/20">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-foreground">
                          {t('onboarding.recommend.title')}
                        </div>
                        <div className="mt-1 text-sm leading-6 text-muted-foreground">
                          {t('onboarding.recommend.description')}
                        </div>
                      </div>
                      <Badge className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] text-emerald-100 shadow-none">
                        {recommendedModelName}
                      </Badge>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        onClick={() => void handleDownloadRecommendedModel()}
                        disabled={recommendedDownloadState === 'starting' || recommendedDownloadState === 'started' || recommendedDownloadState === 'installed'}
                      >
                        {recommendedDownloadState === 'starting'
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <Download className="h-4 w-4" />}
                        {recommendedDownloadState === 'installed'
                          ? t('onboarding.recommend.installed')
                          : recommendedDownloadState === 'started'
                            ? t('onboarding.recommend.started')
                            : t('onboarding.recommend.download')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          markFirstLaunchGuideCompleted();
                          setOpen(false);
                          navigate('/models');
                        }}
                      >
                        {t('onboarding.recommend.openModels')}
                      </Button>
                    </div>
                  </div>
                )}

                {currentStep === steps.length - 1 && (
                  <div className="rounded-[24px] border border-border/70 bg-muted/35 p-5 dark:bg-muted/20">
                    <div className="text-sm font-semibold text-foreground">
                      {t('onboarding.quickActionsTitle')}
                    </div>
                    <div className="mt-1 text-sm leading-6 text-muted-foreground">
                      {t('onboarding.quickActionsDescription')}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {quickActions.map((action) => {
                        const Icon = action.icon;
                        return (
                          <Button
                            key={action.key}
                            type="button"
                            variant="outline"
                            className="rounded-full"
                            onClick={action.onClick}
                          >
                            <Icon className="h-4 w-4" />
                            {action.label}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="mt-auto flex flex-col-reverse gap-3 pt-8 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="justify-start"
                  onClick={closeGuide}
                >
                  {t('common.skip')}
                </Button>
                {activeStep.key === 'ollama' && ollamaStatus?.install_state === 'installing' && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={closeGuide}
                  >
                    {t('onboarding.ollama.continueInBackground')}
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-2 self-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCurrentStep((step) => Math.max(0, step - 1))}
                  disabled={currentStep === 0}
                >
                  {t('common.back')}
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    if (currentStep === steps.length - 1) {
                      closeGuide();
                      return;
                    }
                    setCurrentStep((step) => Math.min(steps.length - 1, step + 1));
                  }}
                  disabled={activeStep.key === 'ollama' && !installFinished}
                >
                  {currentStep === steps.length - 1 ? t('common.finish') : t('common.next')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
