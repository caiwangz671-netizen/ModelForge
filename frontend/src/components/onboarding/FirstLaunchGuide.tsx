import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle2,
  Download,
  Loader2,
  Sparkles,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { systemApi } from '@/services/api';
import {
  FIRST_LAUNCH_GUIDE_OPEN_EVENT,
  hasCompletedFirstLaunchGuide,
  markFirstLaunchGuideCompleted,
} from '@/lib/onboarding';

type StepKey = 'welcome' | 'ollama' | 'features' | 'finish';

interface StepMeta {
  key: StepKey;
  icon: any;
  accentClass: string;
}

interface InstallStatus {
  status: 'idle' | 'downloading' | 'extracting' | 'installing' | 'completed' | 'failed';
  progress: number;
  speed_kbps: number;
  error: string | null;
}

const STEPS: StepMeta[] = [
  {
    key: 'welcome',
    icon: Sparkles,
    accentClass: 'border-cyan-400/20 bg-cyan-400/10 text-cyan-100',
  },
  {
    key: 'ollama',
    icon: Download,
    accentClass: 'border-sky-400/20 bg-sky-400/10 text-sky-100',
  },
  {
    key: 'features',
    icon: Zap,
    accentClass: 'border-violet-400/20 bg-violet-400/10 text-violet-100',
  },
  {
    key: 'finish',
    icon: ShieldCheck,
    accentClass: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100',
  },
];

export function FirstLaunchGuide() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(() => !hasCompletedFirstLaunchGuide());
  const [currentStep, setCurrentStep] = useState(0);
  const [ollamaReady, setOllamaReady] = useState<boolean | null>(null);
  const [installStatus, setInstallStatus] = useState<InstallStatus>({
    status: 'idle',
    progress: 0,
    speed_kbps: 0,
    error: null,
  });
  
  const autoInstallTriggered = useRef(false);

  // Check Ollama Health
  const checkHealth = useCallback(async () => {
    try {
      const response = await systemApi.health();
      const isHealthy = response.data?.ollama?.status === 'healthy';
      setOllamaReady(isHealthy);
      return isHealthy;
    } catch {
      setOllamaReady(false);
      return false;
    }
  }, []);

  // Poll Install Status
  useEffect(() => {
    if (!open || ollamaReady === true) return;

    const timer = setInterval(async () => {
      try {
        const response = await systemApi.getInstallStatus();
        const status = response.data as InstallStatus;
        setInstallStatus(status);
        
        if (status.status === 'completed') {
          void checkHealth();
        }
      } catch (e) {
        console.error('Failed to poll install status', e);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [open, ollamaReady, checkHealth]);

  // Initial Health Check
  useEffect(() => {
    if (open) {
      void checkHealth();
    }
  }, [open, checkHealth]);

  // Handle Automatic Install Trigger
  useEffect(() => {
    const activeStep = STEPS[currentStep]?.key;
    if (open && activeStep === 'ollama' && ollamaReady === false && !autoInstallTriggered.current) {
      autoInstallTriggered.current = true;
      void systemApi.startInstall();
    }
  }, [open, currentStep, ollamaReady]);

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      closeGuide();
    }
  };

  const closeGuide = () => {
    markFirstLaunchGuideCompleted();
    setOpen(false);
  };

  useEffect(() => {
    const handleOpen = () => {
      setCurrentStep(0);
      setOpen(true);
      void checkHealth();
    };
    window.addEventListener(FIRST_LAUNCH_GUIDE_OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(FIRST_LAUNCH_GUIDE_OPEN_EVENT, handleOpen);
  }, [checkHealth]);

  const activeStep = STEPS[currentStep];

  const renderOllamaPanel = () => {
    if (ollamaReady === true) {
      return (
        <div className="mt-8 flex flex-col items-center justify-center rounded-[32px] border border-emerald-500/20 bg-emerald-500/5 p-12 text-center animate-in fade-in zoom-in duration-500">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400">
            <CheckCircle2 className="h-10 w-10" />
          </div>
          <h4 className="mt-6 text-2xl font-semibold text-white">
            {t('onboarding.ollama.completed')}
          </h4>
          <p className="mt-2 text-slate-400">
            {t('onboarding.steps.ollama.points.0')}
          </p>
          <Button 
            className="mt-8 rounded-full px-8 py-6 h-auto text-lg"
            onClick={handleNext}
          >
            {t('common.next')}
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      );
    }

    if (installStatus.status === 'failed') {
      return (
        <div className="mt-8 rounded-[32px] border border-rose-500/20 bg-rose-500/5 p-8">
          <div className="flex items-center gap-4 text-rose-400">
            <AlertCircle className="h-8 w-8" />
            <h4 className="text-xl font-semibold">{t('onboarding.ollama.failed', { error: installStatus.error || 'Unknown error' })}</h4>
          </div>
          <Button 
            variant="outline" 
            className="mt-6 border-rose-500/30 text-rose-200 hover:bg-rose-500/20"
            onClick={() => {
              autoInstallTriggered.current = false;
              void systemApi.startInstall();
            }}
          >
            {t('common.retry')}
          </Button>
        </div>
      );
    }

    return (
      <div className="mt-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="grid gap-4 md:grid-cols-2">
          {(t('onboarding.steps.ollama.points', { returnObjects: true }) as string[]).slice(0, 2).map((point: string, i: number) => (
            <div key={i} className="flex items-start gap-3 rounded-2xl bg-white/[0.03] p-4 text-sm text-slate-300">
              <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-sky-400" />
              {point}
            </div>
          ))}
        </div>

        <div className="rounded-[32px] border border-white/10 bg-white/[0.02] p-8">
          <div className="flex items-center justify-between mb-6">
            <div className="space-y-1">
              <h4 className="text-lg font-medium text-white">
                {installStatus.status === 'downloading' ? t('onboarding.ollama.downloading') :
                 installStatus.status === 'extracting' ? t('onboarding.ollama.extracting') :
                 installStatus.status === 'installing' ? t('onboarding.ollama.installing') :
                 t('onboarding.ollama.checking')}
              </h4>
              <p className="text-sm text-slate-400">
                {installStatus.status === 'downloading' && t('onboarding.ollama.downloadSpeed', { speed: installStatus.speed_kbps.toFixed(1) })}
              </p>
            </div>
            <Loader2 className="h-6 w-6 animate-spin text-sky-400" />
          </div>

          <Progress value={installStatus.progress * 100} className="h-3 bg-white/5" />
          
          <div className="mt-6 flex justify-between items-center">
            <span className="text-sm font-medium text-slate-400">
              {Math.round(installStatus.progress * 100)}%
            </span>
            <Button variant="ghost" className="text-xs text-sky-400 hover:text-sky-300" onClick={handleNext}>
              {t('onboarding.ollama.continueInBackground')}
            </Button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && closeGuide()}>
      <DialogContent className="max-w-6xl overflow-hidden border-border/70 bg-background/96 p-0 backdrop-blur-3xl shadow-2xl">
        <div className="grid min-h-[750px] md:grid-cols-[340px_1fr]">
          <aside className="relative border-r border-white/5 bg-[#09111f] p-8 overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.1),transparent_50%)]" />
            
            <Badge className="relative z-10 rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium text-slate-300 shadow-none border-none">
              {t('onboarding.badge')}
            </Badge>

            <div className="relative z-10 mt-6">
              <h2 className="text-3xl font-bold tracking-tight text-white leading-tight">
                {t('onboarding.title')}
              </h2>
            </div>

            <nav className="relative z-10 mt-12 space-y-3">
              {STEPS.map((step, i) => {
                const Icon = step.icon;
                const active = i === currentStep;
                const done = i < currentStep;
                return (
                  <button
                    key={step.key}
                    className={cn(
                      "flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition-all duration-300",
                      active ? "border-white/20 bg-white/10 shadow-xl" : "border-transparent bg-white/[0.02] hover:bg-white/[0.05]"
                    )}
                    onClick={() => setCurrentStep(i)}
                  >
                    <div className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-colors",
                      active ? step.accentClass : "border-white/10 text-slate-500",
                      done && "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    )}>
                      {done ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0">
                       <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                         {t('onboarding.stepLabel', { current: i + 1, total: STEPS.length })}
                       </div>
                       <div className={cn("mt-0.5 font-semibold text-sm truncate", active ? "text-white" : "text-slate-400")}>
                         {t(`onboarding.steps.${step.key}.title`)}
                       </div>
                    </div>
                  </button>
                );
              })}
            </nav>

            <div className="mt-auto pt-12 relative z-10">
              <div className="rounded-2xl bg-white/[0.03] p-5 border border-white/5">
                <p className="text-xs leading-relaxed text-slate-400">
                  {t('onboarding.skipHint')}
                </p>
              </div>
            </div>
          </aside>

          <main className="flex flex-col p-10 bg-[radial-gradient(circle_at_bottom_right,rgba(139,92,246,0.05),transparent_40%)]">
            <header className="flex items-start justify-between">
              <div className="max-w-2xl">
                <Badge variant="outline" className="mb-4 border-primary/30 text-primary uppercase tracking-widest text-[10px]">
                  {t(`onboarding.steps.${activeStep.key}.eyebrow`)}
                </Badge>
                <h3 className="text-4xl font-bold tracking-tight text-white">
                  {t(`onboarding.steps.${activeStep.key}.title`)}
                </h3>
                <p className="mt-4 text-lg text-slate-400 leading-relaxed">
                  {t(`onboarding.steps.${activeStep.key}.description`)}
                </p>
              </div>
            </header>

            <div className="mt-12 overflow-y-auto">
              {activeStep.key === 'ollama' ? renderOllamaPanel() : (
                <div className="grid gap-4 md:grid-cols-2 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  {(t(`onboarding.steps.${activeStep.key}.points`, { returnObjects: true }) as string[]).map((point: string, i: number) => (
                    <div key={i} className="group flex items-start gap-4 rounded-3xl border border-white/5 bg-white/[0.02] p-6 transition-all hover:bg-white/[0.05] hover:border-white/10">
                      <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </div>
                      <p className="text-slate-300 leading-relaxed">
                        {point}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <footer className="mt-auto pt-12 flex items-center justify-between">
              <Button variant="ghost" onClick={closeGuide} className="text-slate-400 hover:text-white">
                {t('common.skip')}
              </Button>

              <div className="flex items-center gap-4">
                <Button 
                  variant="outline" 
                  onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
                  disabled={currentStep === 0}
                  className="rounded-full px-6"
                >
                  {t('common.back')}
                </Button>
                <Button 
                  onClick={handleNext}
                  className="rounded-full px-8 shadow-xl shadow-primary/20"
                  disabled={activeStep.key === 'ollama' && !ollamaReady && installStatus.status !== 'completed'}
                >
                  {currentStep === STEPS.length - 1 ? t('common.finish') : t('common.next')}
                </Button>
              </div>
            </footer>
          </main>
        </div>
      </DialogContent>
    </Dialog>
  );
}
