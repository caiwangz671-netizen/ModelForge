import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useModelStore } from '@/store/modelStore';
import { useChatStore } from '@/store/chatStore';
import { useDownloadStore } from '@/store/downloadStore';
import { computerUseApi, systemApi } from '@/services/api';
import type { HardwareInfo } from '@/services/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  ArrowRight,
  Brain,
  Clock3,
  Cpu,
  Download,
  Gauge,
  HardDrive,
  MessageSquare,
  RefreshCw,
  Sparkles,
  Zap,
  FileSearch,
  ShieldAlert,
} from 'lucide-react';

type SystemHealthPayload = {
  status?: string;
  ollama?: {
    status?: string;
    version?: string;
  };
  memory?: {
    enabled?: boolean;
  };
};

type ComputerUseStatusPayload = {
  desktop_mode?: boolean;
  desktop_available?: boolean;
  controlled_browser_available?: boolean;
  ocr?: {
    available?: boolean;
    recommended?: string;
    install_hint?: string;
  };
  helper?: {
    permissions?: {
      accessibility?: boolean;
      screen_recording?: boolean;
    };
  };
};

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '-';
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
}

function statusVariant(isHealthy: boolean): 'default' | 'destructive' {
  return isHealthy ? 'default' : 'destructive';
}

export function Home() {
  const { t, i18n } = useTranslation();
  const { models, runningModels, fetchModels, fetchRunningModels } = useModelStore();
  const { conversations, fetchConversations } = useChatStore();
  const { tasks, fetchTasks } = useDownloadStore();

  const [health, setHealth] = useState<SystemHealthPayload | null>(null);
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [computerUseStatus, setComputerUseStatus] = useState<ComputerUseStatusPayload | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshInFlightRef = useRef(false);

  const refreshDashboard = useCallback(async () => {
    if (refreshInFlightRef.current) return;

    refreshInFlightRef.current = true;
    setIsRefreshing(true);

    try {
      const [healthResult, hardwareResult] = await Promise.allSettled([
        systemApi.health(),
        systemApi.hardware(),
      ]);
      const computerUseResult = await Promise.allSettled([computerUseApi.status()]);

      if (healthResult.status === 'fulfilled') {
        setHealth(healthResult.value.data as SystemHealthPayload);
      } else {
        setHealth({
          status: 'degraded',
          ollama: { status: 'unhealthy: backend health endpoint unreachable' },
        });
      }

      if (hardwareResult.status === 'fulfilled') {
        setHardware(hardwareResult.value.data ?? null);
      } else {
        setHardware(null);
      }

      const computerUseStatusResult = computerUseResult[0];
      if (computerUseStatusResult.status === 'fulfilled') {
        setComputerUseStatus(computerUseStatusResult.value.data as ComputerUseStatusPayload);
      } else {
        setComputerUseStatus(null);
      }

      await Promise.allSettled([
        fetchModels(),
        fetchRunningModels(),
        fetchConversations(),
        fetchTasks(),
      ]);

      setLastRefreshAt(Date.now());
    } finally {
      refreshInFlightRef.current = false;
      setIsRefreshing(false);
    }
  }, [fetchConversations, fetchModels, fetchRunningModels, fetchTasks]);

  useEffect(() => {
    void refreshDashboard();
  }, [refreshDashboard]);

  const activeDownloads = tasks.filter((t) => t.status === 'downloading' || t.status === 'queued').length;
  const completedDownloads = tasks.filter((t) => t.status === 'completed').length;
  const topActiveDownloads = tasks
    .filter((t) => t.status === 'downloading' || t.status === 'queued')
    .slice(0, 3);

  const recentConversations = useMemo(
    () => [...conversations].sort((a, b) => b.updated_at - a.updated_at).slice(0, 5),
    [conversations],
  );
  const hasVisionToolModel = useMemo(
    () => models.some((model) => model.capabilities?.supports_tools && model.capabilities?.supports_vision),
    [models],
  );

  const ollamaStatus = String(health?.ollama?.status || '').toLowerCase();
  const ollamaHealthy = ollamaStatus.startsWith('healthy');
  const backendHealthy = Boolean(health?.status) && String(health?.status).toLowerCase() === 'healthy';
  const ocrMissing = Boolean(computerUseStatus?.desktop_mode)
    && !computerUseStatus?.controlled_browser_available
    && computerUseStatus?.ocr?.available === false
    && !hasVisionToolModel;
  const permissions = computerUseStatus?.helper?.permissions;
  const desktopPermissionMissing = Boolean(computerUseStatus?.desktop_available) && Boolean(
    permissions && (!permissions.accessibility || !permissions.screen_recording),
  );

  const formatRelativeTime = (unixSeconds: number): string => {
    if (!unixSeconds || unixSeconds <= 0) return '-';
    const diff = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds));
    if (diff < 60) return t('home.time.justNow');
    if (diff < 3600) return t('home.time.minutesAgo', { count: Math.floor(diff / 60) });
    if (diff < 86400) return t('home.time.hoursAgo', { count: Math.floor(diff / 3600) });
    return t('home.time.daysAgo', { count: Math.floor(diff / 86400) });
  };

  const stats = [
    {
      title: t('home.stats.localModels'),
      value: models.length,
      detail: t('home.stats.localModelsDetail', { count: runningModels.length }),
      icon: Brain,
      link: '/models',
    },
    {
      title: t('home.stats.conversations'),
      value: conversations.length,
      detail: recentConversations[0]
        ? t('home.stats.conversationsDetailRecent', {
            time: formatRelativeTime(recentConversations[0].updated_at),
          })
        : t('home.stats.conversationsDetailEmpty'),
      icon: MessageSquare,
      link: '/chat',
    },
    {
      title: t('home.stats.activeDownloads'),
      value: activeDownloads,
      detail: t('home.stats.activeDownloadsDetail', { count: completedDownloads }),
      icon: Download,
      link: '/downloads',
    },
    {
      title: t('home.stats.systemLoad'),
      value: hardware ? `${Math.round(hardware.ram_percent)}%` : '-',
      detail: hardware
        ? `${formatBytes(hardware.ram_used)} / ${formatBytes(hardware.ram_total)}`
        : t('home.stats.systemLoadWaiting'),
      icon: Gauge,
      link: '/settings',
    },
  ];

  const quickActions = [
    {
      title: t('home.quickActions.chat.title'),
      description: t('home.quickActions.chat.description'),
      link: '/chat',
      icon: Sparkles,
    },
    {
      title: t('home.quickActions.models.title'),
      description: t('home.quickActions.models.description'),
      link: '/models',
      icon: Brain,
    },
    {
      title: t('home.quickActions.downloads.title'),
      description: t('home.quickActions.downloads.description'),
      icon: Download,
      link: '/downloads',
    },
    {
      title: t('home.quickActions.settings.title'),
      description: t('home.quickActions.settings.description'),
      icon: Activity,
      link: '/settings',
    },
  ];

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border bg-gradient-to-br from-blue-500/10 via-background to-emerald-500/10 p-5 md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">{t('home.title')}</h2>
            <p className="mt-2 text-muted-foreground">
              {t('home.subtitle')}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Badge variant={statusVariant(backendHealthy)}>
                {t('home.backend')} {backendHealthy ? t('home.healthy') : t('home.unhealthy')}
              </Badge>
              <Badge variant={statusVariant(ollamaHealthy)}>
                Ollama {ollamaHealthy ? t('home.online') : t('home.notReady')}
              </Badge>
              {health?.ollama?.version ? (
                <Badge variant="secondary">Ollama {health.ollama.version}</Badge>
              ) : null}
              {lastRefreshAt ? (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock3 className="h-3.5 w-3.5" />
                  {t('home.refreshedAt', { time: new Date(lastRefreshAt).toLocaleTimeString(i18n.language) })}
                </span>
              ) : null}
            </div>
          </div>

          <Button variant="outline" onClick={() => void refreshDashboard()} disabled={isRefreshing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            {t('home.refreshData')}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Link key={stat.title} to={stat.link}>
              <Card className="h-full transition-colors hover:bg-muted/50">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stat.value}</div>
                  <p className="mt-1 text-xs text-muted-foreground">{stat.detail}</p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {(ocrMissing || desktopPermissionMissing) && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {ocrMissing ? <FileSearch className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
              {ocrMissing ? t('home.ocrBanner.title') : t('home.permissionBanner.title')}
            </CardTitle>
            <CardDescription>
              {ocrMissing ? t('home.ocrBanner.description') : t('home.permissionBanner.description')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            {ocrMissing && (
              <>
                <div>{t('home.ocrBanner.recommendation', { name: computerUseStatus?.ocr?.recommended || 'Tesseract OCR' })}</div>
                <pre className="rounded-lg border bg-background p-3 text-xs text-foreground">
                  {computerUseStatus?.ocr?.install_hint || 'brew install tesseract'}
                </pre>
              </>
            )}
            {desktopPermissionMissing && (
              <div className="flex flex-wrap gap-2">
                <Badge variant={permissions?.screen_recording ? 'default' : 'destructive'}>
                  {t('computerUse.screenRecording')}: {permissions?.screen_recording ? t('common.enabled') : t('common.disabled')}
                </Badge>
                <Badge variant={permissions?.accessibility ? 'default' : 'destructive'}>
                  {t('computerUse.accessibility')}: {permissions?.accessibility ? t('common.enabled') : t('common.disabled')}
                </Badge>
              </div>
            )}
            <Button asChild variant="outline">
              <Link to="/computer-use">{t('home.ocrBanner.openComputerUse')}</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              {t('home.realtime.title')}
            </CardTitle>
            <CardDescription>{t('home.realtime.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border p-3">
                <div className="mb-1 text-xs text-muted-foreground">{t('home.realtime.ollamaService')}</div>
                <div className="font-medium">{ollamaHealthy ? t('home.online') : t('home.notReady')}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {health?.ollama?.status || t('home.realtime.noStatus')}
                </div>
              </div>
              <div className="rounded-xl border p-3">
                <div className="mb-1 text-xs text-muted-foreground">{t('home.realtime.backendApi')}</div>
                <div className="font-medium">{backendHealthy ? t('home.healthy') : t('home.unhealthy')}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {backendHealthy ? t('home.realtime.backendOk') : t('home.realtime.backendFailed')}
                </div>
              </div>
            </div>

            <div className="space-y-2 rounded-xl border p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="inline-flex items-center gap-1">
                  <HardDrive className="h-4 w-4 text-muted-foreground" />
                  {t('home.realtime.memoryUsage')}
                </span>
                <span className="text-muted-foreground">
                  {hardware ? `${Math.round(hardware.ram_percent)}%` : '-'}
                </span>
              </div>
              <Progress value={hardware ? Math.min(Math.max(hardware.ram_percent, 0), 100) : 0} className="h-2" />
              <div className="text-xs text-muted-foreground">
                {hardware
                  ? `${formatBytes(hardware.ram_used)} / ${formatBytes(hardware.ram_total)}`
                  : t('home.stats.systemLoadWaiting')}
              </div>
            </div>

            <div className="space-y-2 rounded-xl border p-3">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1 text-sm">
                  <Cpu className="h-4 w-4 text-muted-foreground" />
                  {t('home.realtime.hardwareInfo')}
                </span>
                <span className="text-xs text-muted-foreground">
                  {hardware
                    ? t('home.realtime.cpuCores', {
                        physical: hardware.cpu_cores_physical,
                        logical: hardware.cpu_cores_logical,
                      })
                    : '-'}
                </span>
              </div>
              <div className="text-sm">{hardware?.gpu_name || t('home.realtime.noGpu')}</div>
              {hardware?.gpu_vram_bytes ? (
                <div className="text-xs text-muted-foreground">
                  {t('home.realtime.gpuMemory', { value: formatBytes(hardware.gpu_vram_bytes) })}
                </div>
              ) : null}
            </div>

            <div className="space-y-2 rounded-xl border p-3">
              <div className="flex items-center justify-between text-sm">
                <span>{t('home.realtime.activeDownloads')}</span>
                <span className="text-muted-foreground">{t('home.realtime.itemsCount', { count: activeDownloads })}</span>
              </div>
              {topActiveDownloads.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('home.realtime.noActiveDownloads')}</p>
              ) : (
                <div className="space-y-2">
                  {topActiveDownloads.map((task) => (
                    <div key={task.id} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="truncate pr-3">{task.model_name}</span>
                        <span className="text-muted-foreground">{task.progress.toFixed(1)}%</span>
                      </div>
                      <Progress value={task.progress} className="h-1.5" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('home.quickEntry')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {quickActions.map((action) => {
                const Icon = action.icon;
                return (
                  <Link
                    key={action.title}
                    to={action.link}
                    className="group flex items-start justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50"
                  >
                    <div className="pr-3">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        {action.title}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{action.description}</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </Link>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('home.recentConversations')}</CardTitle>
            </CardHeader>
            <CardContent>
              {recentConversations.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('home.noConversationHint')}</p>
              ) : (
                <div className="space-y-2">
                  {recentConversations.map((conversation) => (
                    <Link
                      key={conversation.id}
                      to="/chat"
                      className="block rounded-lg border p-3 transition-colors hover:bg-muted/50"
                    >
                      <div className="line-clamp-1 text-sm font-medium">{conversation.title || t('chat.newConversation')}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {conversation.model || t('home.unspecifiedModel')} · {formatRelativeTime(conversation.updated_at)}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
