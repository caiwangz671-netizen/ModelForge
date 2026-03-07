import { useEffect, useState } from 'react';
import { computerUseApi, systemApi } from '@/services/api';
import type { HardwareInfo } from '@/services/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Check, X, Server, Globe, Database, RefreshCw, Brain, Cpu, HardDrive, Monitor, Languages, Sparkles, FolderOpen, Plus, Workflow } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ComputerUseApprovalMode } from '@/types/computerUse';
import { loadComputerUsePreferences, normalizeComputerUsePaths, saveComputerUsePreferences } from '@/lib/computerUsePreferences';

const MAX_OUTPUT_TOKEN_PRESETS = [512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144];
const MAX_CONTEXT_TOKEN_PRESETS = [2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144, 524288, 1048576];
const IDLE_TIMEOUT_PRESETS = [0, 5, 10, 15, 30, 60];
const LOCAL_MAX_OUTPUT_TOKENS_KEY = 'settings:maxOutputTokens';
const LOCAL_MAX_CONTEXT_TOKENS_KEY = 'settings:maxContextTokens';

function readNumberLocalStorage(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function formatBytesShort(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

export function Settings() {
  const { t, i18n } = useTranslation();

  const [health, setHealth] = useState<{
    status: string;
    ollama: { status: string; version?: string };
    memory?: {
      enabled: boolean;
      reason: string;
      embedding_model?: string | null;
      configured_embedding_model?: string | null;
    };
  } | null>(null);
  const [ollamaHost, setOllamaHost] = useState('http://localhost:11434');
  const [isLoading, setIsLoading] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [memoryStatus, setMemoryStatus] = useState<{
    enabled: boolean;
    reason: string;
    embedding_model?: string | null;
    configured_embedding_model?: string | null;
  } | null>(null);
  const [memoryEmbeddingModel, setMemoryEmbeddingModel] = useState('');
  const [maxOutputTokens, setMaxOutputTokens] = useState(() =>
    readNumberLocalStorage(LOCAL_MAX_OUTPUT_TOKENS_KEY, 8192),
  );
  const [maxContextTokens, setMaxContextTokens] = useState(() =>
    readNumberLocalStorage(LOCAL_MAX_CONTEXT_TOKENS_KEY, 8192),
  );
  const [autoUnloadAfterResponse, setAutoUnloadAfterResponse] = useState(true);

  // Model management settings (persisted in localStorage)
  const [smartRecommendEnabled, setSmartRecommendEnabled] = useState(() =>
    localStorage.getItem('smartRecommendEnabled') !== 'false'
  );
  const [autoLoadModel, setAutoLoadModel] = useState(() =>
    localStorage.getItem('autoLoadModel') === 'true'
  );
  const [idleTimeoutMinutes, setIdleTimeoutMinutes] = useState(() =>
    parseInt(localStorage.getItem('idleTimeoutMinutes') || '10', 10)
  );

  // Hardware info
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [computerUseApprovalMode, setComputerUseApprovalMode] = useState<ComputerUseApprovalMode>(
    () => loadComputerUsePreferences().approvalMode,
  );
  const [computerUseCustomScope, setComputerUseCustomScope] = useState(
    () => loadComputerUsePreferences().useCustomScope,
  );
  const [computerUseCwd, setComputerUseCwd] = useState(() => loadComputerUsePreferences().cwd);
  const [computerUseAllowedPaths, setComputerUseAllowedPaths] = useState<string[]>(
    () => loadComputerUsePreferences().allowedPaths,
  );
  const [computerUseDefaults, setComputerUseDefaults] = useState<{
    default_cwd: string;
    default_allowed_paths: string[];
  } | null>(null);
  const [computerUsePickerError, setComputerUsePickerError] = useState<string | null>(null);
  const supportsDirectoryPicker = Boolean(
    window.desktopInfo?.isDesktop && typeof window.desktopInfo.pickDirectories === 'function',
  );

  useEffect(() => {
    checkHealth();
    loadSettings();
    fetchHardware();
    loadComputerUseDefaults();
    // Restore dark mode from localStorage (main.tsx applies it before render,
    // but we still need the `darkMode` React state to match)
    const saved = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setDarkMode(saved === 'dark' || (saved === null && prefersDark));
  }, []);

  // Persist model management settings
  useEffect(() => {
    localStorage.setItem('smartRecommendEnabled', String(smartRecommendEnabled));
  }, [smartRecommendEnabled]);
  useEffect(() => {
    localStorage.setItem('autoLoadModel', String(autoLoadModel));
  }, [autoLoadModel]);
  useEffect(() => {
    localStorage.setItem('idleTimeoutMinutes', String(idleTimeoutMinutes));
  }, [idleTimeoutMinutes]);
  useEffect(() => {
    localStorage.setItem(LOCAL_MAX_OUTPUT_TOKENS_KEY, String(maxOutputTokens));
  }, [maxOutputTokens]);
  useEffect(() => {
    localStorage.setItem(LOCAL_MAX_CONTEXT_TOKENS_KEY, String(maxContextTokens));
  }, [maxContextTokens]);
  useEffect(() => {
    saveComputerUsePreferences({
      approvalMode: computerUseApprovalMode,
      useCustomScope: computerUseCustomScope,
      cwd: computerUseCwd,
      allowedPaths: computerUseAllowedPaths,
    });
  }, [computerUseAllowedPaths, computerUseApprovalMode, computerUseCustomScope, computerUseCwd]);

  const fetchHardware = async () => {
    try {
      const res = await systemApi.hardware();
      setHardware(res.data);
    } catch {
      // ignore
    }
  };

  const loadComputerUseDefaults = async () => {
    try {
      const response = await computerUseApi.status();
      setComputerUseDefaults({
        default_cwd: String(response.data.default_cwd || ''),
        default_allowed_paths: normalizeComputerUsePaths(
          Array.isArray(response.data.default_allowed_paths) ? response.data.default_allowed_paths : [],
        ),
      });
    } catch {
      setComputerUseDefaults(null);
    }
  };

  const checkHealth = async () => {
    try {
      const response = await systemApi.health();
      setHealth(response.data);
      if (response.data.memory) {
        setMemoryStatus(response.data.memory);
      }
    } catch (error) {
      console.error('Failed to check health:', error);
    }
  };

  const loadSettings = async () => {
    try {
      const response = await systemApi.getSettings();
      setOllamaHost(response.data.ollama_host);
      setMemoryEnabled(response.data.memory_enabled ?? true);
      setMemoryEmbeddingModel(response.data.memory_embedding_model || '');
      setMaxOutputTokens(response.data.max_output_tokens ?? readNumberLocalStorage(LOCAL_MAX_OUTPUT_TOKENS_KEY, 8192));
      setMaxContextTokens(response.data.max_context_tokens ?? readNumberLocalStorage(LOCAL_MAX_CONTEXT_TOKENS_KEY, 8192));
      setAutoUnloadAfterResponse(response.data.auto_unload_after_response ?? true);
      if (response.data.memory_status) {
        setMemoryStatus(response.data.memory_status);
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const saveSettings = async () => {
    setIsLoading(true);
    try {
      await systemApi.updateSettings({
        ollama_host: ollamaHost,
        memory_enabled: memoryEnabled,
        memory_embedding_model: memoryEmbeddingModel,
        max_output_tokens: Math.max(128, Math.min(262144, Number(maxOutputTokens) || 8192)),
        max_context_tokens: Math.max(512, Math.min(1048576, Number(maxContextTokens) || 8192)),
        auto_unload_after_response: autoUnloadAfterResponse,
      });
      await checkHealth();
    } catch (error) {
      console.error('Failed to save settings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleDarkMode = () => {
    const newDarkMode = !darkMode;
    setDarkMode(newDarkMode);
    localStorage.setItem('theme', newDarkMode ? 'dark' : 'light');
    if (newDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
  };

  const handlePickDirectories = async (multiple = false): Promise<string[]> => {
    if (!supportsDirectoryPicker || !window.desktopInfo?.pickDirectories) {
      setComputerUsePickerError(t('computerUse.pickerUnavailable'));
      return [];
    }
    try {
      setComputerUsePickerError(null);
      const selected = await window.desktopInfo.pickDirectories({ multiple });
      return normalizeComputerUsePaths(Array.isArray(selected) ? selected : []);
    } catch (error) {
      const message = error instanceof Error && error.message.trim()
        ? error.message
        : t('computerUse.pickerUnavailable');
      setComputerUsePickerError(message);
      return [];
    }
  };

  const handlePickComputerUseCwd = async () => {
    const [selected] = await handlePickDirectories(false);
    if (!selected) return;
    setComputerUseCwd(selected);
    setComputerUseAllowedPaths((prev) => normalizeComputerUsePaths([selected, ...prev]));
  };

  const handleAddComputerUseAllowedPaths = async () => {
    const selected = await handlePickDirectories(true);
    if (selected.length === 0) return;
    setComputerUseAllowedPaths((prev) => normalizeComputerUsePaths([...prev, ...selected]));
  };

  const handleResetComputerUseScope = () => {
    setComputerUseCustomScope(false);
    setComputerUseCwd('');
    setComputerUseAllowedPaths([]);
    setComputerUsePickerError(null);
  };

  const isOllamaHealthy = health?.ollama?.status === 'healthy';
  const effectiveComputerUseCwd = computerUseCustomScope
    ? (computerUseCwd || computerUseDefaults?.default_cwd || '')
    : (computerUseDefaults?.default_cwd || '');
  const effectiveComputerUseAllowedPaths = computerUseCustomScope
    ? normalizeComputerUsePaths(
        computerUseAllowedPaths.length > 0
          ? computerUseAllowedPaths
          : (computerUseDefaults?.default_allowed_paths || []),
      )
    : (computerUseDefaults?.default_allowed_paths || []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">{t('settings.title')}</h2>
        <p className="text-muted-foreground mt-1">
          {t('settings.subtitle')}
        </p>
      </div>

      <div className="grid gap-6">
        {/* Hardware Info */}
        {hardware && (
          <Card className="bg-gradient-to-r from-primary/5 via-primary/3 to-transparent border-primary/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="h-5 w-5" />
                {t('settings.hardware')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="flex items-center gap-3 p-3 rounded-lg bg-background/50">
                  <HardDrive className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-xs text-muted-foreground">{t('settings.ram')}</p>
                    <p className="font-semibold">{formatBytesShort(hardware.ram_total)}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('settings.availableMemory', { value: formatBytesShort(hardware.ram_available) })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-lg bg-background/50">
                  <Cpu className="h-5 w-5 text-blue-500" />
                  <div>
                    <p className="text-xs text-muted-foreground">{t('settings.cpu')}</p>
                    <p className="font-semibold">{hardware.cpu_cores_physical}C / {hardware.cpu_cores_logical}T</p>
                    <p className="text-xs text-muted-foreground">{hardware.cpu_arch} · {hardware.os}</p>
                  </div>
                </div>
                {hardware.gpu_name && (
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-background/50">
                    <Monitor className="h-5 w-5 text-emerald-500" />
                    <div>
                      <p className="text-xs text-muted-foreground">{t('settings.gpu')}</p>
                      <p className="font-semibold">{hardware.gpu_name}</p>
                      {hardware.gpu_vram_bytes && (
                        <p className="text-xs text-muted-foreground">{t('settings.gpuVram')}: {formatBytesShort(hardware.gpu_vram_bytes)}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Model Management Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              {t('settings.modelManagement')}
            </CardTitle>
            <CardDescription>{t('settings.modelManagementDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between py-2">
              <div className="space-y-0.5">
                <Label>{t('settings.smartRecommend')}</Label>
                <p className="text-sm text-muted-foreground">
                  {t('settings.smartRecommendDesc')}
                </p>
              </div>
              <Switch checked={smartRecommendEnabled} onCheckedChange={setSmartRecommendEnabled} />
            </div>
            <div className="flex items-center justify-between py-2 border-t">
              <div className="space-y-0.5">
                <Label>{t('settings.autoLoadModel')}</Label>
                <p className="text-sm text-muted-foreground">
                  {t('settings.autoLoadModelDesc')}
                </p>
              </div>
              <Switch checked={autoLoadModel} onCheckedChange={setAutoLoadModel} />
            </div>
            <div className="space-y-2 pt-2 border-t">
              <Label>{t('settings.idleTimeout')}</Label>
              <p className="text-sm text-muted-foreground mb-2">
                {t('settings.idleTimeoutDesc')}
              </p>
              <div className="flex flex-wrap gap-2">
                {IDLE_TIMEOUT_PRESETS.map((preset) => (
                  <Button
                    key={preset}
                    size="sm"
                    type="button"
                    variant={idleTimeoutMinutes === preset ? 'default' : 'outline'}
                    onClick={() => setIdleTimeoutMinutes(preset)}
                  >
                    {preset === 0 ? t('common.disable') : `${preset}min`}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Workflow className="h-5 w-5" />
              {t('settings.computerUse')}
            </CardTitle>
            <CardDescription>{t('settings.computerUseDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <Label>{t('computerUse.approvalMode')}</Label>
              <p className="text-sm text-muted-foreground">
                {t('settings.computerUseExecutionModeDesc')}
              </p>
              <div className="grid gap-2 md:grid-cols-2">
                {([
                  {
                    key: 'hands_free',
                    title: t('computerUse.approvalModeHandsFree'),
                    hint: t('computerUse.approvalModeHandsFreeHint'),
                  },
                  {
                    key: 'review_all',
                    title: t('computerUse.approvalModeReviewAll'),
                    hint: t('computerUse.approvalModeReviewAllHint'),
                  },
                ] as Array<{ key: ComputerUseApprovalMode; title: string; hint: string }>).map((option) => {
                  const active = computerUseApprovalMode === option.key;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      className={`rounded-xl border px-4 py-3 text-left transition ${
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background hover:border-primary/40'
                      }`}
                      onClick={() => setComputerUseApprovalMode(option.key)}
                    >
                      <div className="text-sm font-semibold">{option.title}</div>
                      <div className={`mt-1 text-xs leading-5 ${active ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                        {option.hint}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between border-t pt-4">
              <div className="space-y-0.5">
                <Label>{t('settings.computerUseCustomScope')}</Label>
                <p className="text-sm text-muted-foreground">
                  {t('settings.computerUseCustomScopeDesc')}
                </p>
              </div>
              <Switch checked={computerUseCustomScope} onCheckedChange={setComputerUseCustomScope} />
            </div>

            <div className="rounded-xl border bg-muted/30 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {t('settings.computerUseEffectiveScope')}
              </div>
              <div className="mt-3 space-y-3">
                <div>
                  <div className="text-xs text-muted-foreground">{t('computerUse.cwd')}</div>
                  <div className="mt-1 break-all text-sm font-medium">
                    {effectiveComputerUseCwd || '-'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t('computerUse.allowedPaths')}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {effectiveComputerUseAllowedPaths.length > 0 ? effectiveComputerUseAllowedPaths.map((path) => (
                      <div
                        key={path}
                        className="inline-flex max-w-full items-center rounded-full border bg-background px-3 py-1.5 text-xs"
                      >
                        <span className="truncate">{path}</span>
                      </div>
                    )) : (
                      <div className="text-sm text-muted-foreground">
                        {t('computerUse.noAllowedPaths')}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {computerUseCustomScope && (
              <div className="space-y-4 rounded-xl border border-dashed p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    {t('computerUse.scopeCustomHint')}
                  </p>
                  <Button variant="ghost" size="sm" type="button" onClick={handleResetComputerUseScope}>
                    {t('computerUse.resetScope')}
                  </Button>
                </div>

                {supportsDirectoryPicker ? (
                  <>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <Label>{t('computerUse.cwd')}</Label>
                        <Button variant="outline" size="sm" type="button" onClick={() => void handlePickComputerUseCwd()}>
                          <FolderOpen className="mr-2 h-4 w-4" />
                          {t('computerUse.selectFolder')}
                        </Button>
                      </div>
                      <div className="min-h-[52px] rounded-lg border bg-background px-4 py-3 text-sm">
                        {computerUseCwd || computerUseDefaults?.default_cwd || '-'}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <Label>{t('computerUse.allowedPaths')}</Label>
                        <Button variant="outline" size="sm" type="button" onClick={() => void handleAddComputerUseAllowedPaths()}>
                          <Plus className="mr-2 h-4 w-4" />
                          {t('computerUse.addFolder')}
                        </Button>
                      </div>
                      <div className="flex min-h-[72px] flex-wrap gap-2 rounded-lg border bg-background p-3">
                        {computerUseAllowedPaths.length > 0 ? computerUseAllowedPaths.map((path) => (
                          <button
                            key={path}
                            type="button"
                            className="inline-flex max-w-full items-center gap-2 rounded-full border bg-muted/50 px-3 py-1.5 text-xs"
                            onClick={() => setComputerUseAllowedPaths((prev) => prev.filter((item) => item !== path))}
                          >
                            <span className="truncate">{path}</span>
                            <X className="h-3 w-3 shrink-0" />
                          </button>
                        )) : (
                          <div className="text-sm text-muted-foreground">
                            {t('computerUse.noAllowedPaths')}
                          </div>
                        )}
                      </div>
                    </div>

                    {computerUsePickerError && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                        {computerUsePickerError}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="computer-use-cwd">{t('computerUse.cwd')}</Label>
                      <Input
                        id="computer-use-cwd"
                        value={computerUseCwd}
                        onChange={(event) => setComputerUseCwd(event.target.value)}
                        placeholder={computerUseDefaults?.default_cwd || ''}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="computer-use-allowed-paths">{t('computerUse.allowedPaths')}</Label>
                      <textarea
                        id="computer-use-allowed-paths"
                        value={computerUseAllowedPaths.join('\n')}
                        onChange={(event) => setComputerUseAllowedPaths(normalizeComputerUsePaths(event.target.value.split('\n')))}
                        rows={4}
                        className="w-full rounded-lg border bg-background px-3 py-2 text-sm leading-6 outline-none focus:ring-2 focus:ring-primary/20"
                      />
                      <p className="text-sm text-muted-foreground">
                        {t('computerUse.pickerUnavailable')}
                      </p>
                    </div>
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Health Status */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              {t('settings.systemStatus')}
            </CardTitle>
            <CardDescription>{t('settings.systemStatusDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-3">
                <Database className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">{t('settings.ollamaService')}</p>
                  <p className="text-sm text-muted-foreground">
                    {health?.ollama?.version ? `${t('settings.version')}: ${health.ollama.version}` : t('settings.notConnected')}
                  </p>
                </div>
              </div>
              <Badge variant={isOllamaHealthy ? 'default' : 'destructive'}>
                {isOllamaHealthy ? (
                  <Check className="h-3 w-3 mr-1" />
                ) : (
                  <X className="h-3 w-3 mr-1" />
                )}
                {isOllamaHealthy ? t('settings.healthy') : t('settings.unhealthy')}
              </Badge>
            </div>
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-3">
                <Globe className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">{t('settings.backendApi')}</p>
                  <p className="text-sm text-muted-foreground">
                    {t('settings.connectedTo', { endpoint: 'localhost:8000' })}
                  </p>
                </div>
              </div>
              <Badge variant="default">
                <Check className="h-3 w-3 mr-1" />
                {t('settings.healthy')}
              </Badge>
            </div>
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-3">
                <Brain className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">{t('settings.memoryService')}</p>
                  <p className="text-sm text-muted-foreground">
                    {memoryStatus?.enabled
                      ? t('settings.embeddingActive', {
                          model: memoryStatus.embedding_model || t('settings.unknownValue'),
                        })
                      : memoryStatus?.reason === 'configured_embedding_model_not_found'
                        ? t('settings.embeddingConfiguredMissing', {
                            model: memoryStatus.configured_embedding_model || t('settings.unknownValue'),
                          })
                        : memoryStatus?.reason === 'no_embedding_model'
                          ? t('settings.embeddingAutoDisabled')
                          : t('common.disabled')}
                  </p>
                </div>
              </div>
              <Badge variant={memoryStatus?.enabled ? 'default' : 'secondary'}>
                {memoryStatus?.enabled ? (
                  <Check className="h-3 w-3 mr-1" />
                ) : (
                  <X className="h-3 w-3 mr-1" />
                )}
                {memoryStatus?.enabled ? t('common.enabled') : t('common.disabled')}
              </Badge>
            </div>
            <Button variant="outline" className="w-full" onClick={checkHealth}>
              <RefreshCw className="h-4 w-4 mr-2" />
              {t('settings.refreshStatus')}
            </Button>
          </CardContent>
        </Card>

        {/* Ollama Settings */}
        <Card>
          <CardHeader>
            <CardTitle>{t('settings.ollamaConfig')}</CardTitle>
            <CardDescription>{t('settings.ollamaConfigDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ollama-host">{t('settings.ollamaHost')}</Label>
              <Input
                id="ollama-host"
                value={ollamaHost}
                onChange={(e) => setOllamaHost(e.target.value)}
                placeholder="http://localhost:11434"
              />
              <p className="text-sm text-muted-foreground">
                {t('settings.ollamaHostDefault')}
              </p>
            </div>
            <div className="flex items-center justify-between pt-2 border-t">
              <div className="space-y-0.5">
                <Label>{t('settings.enableMemory')}</Label>
                <p className="text-sm text-muted-foreground">
                  {t('settings.enableMemoryDesc')}
                </p>
              </div>
              <Switch checked={memoryEnabled} onCheckedChange={setMemoryEnabled} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="memory-embedding-model">{t('settings.embeddingModel')}</Label>
              <Input
                id="memory-embedding-model"
                value={memoryEmbeddingModel}
                onChange={(e) => setMemoryEmbeddingModel(e.target.value)}
                placeholder={t('settings.embeddingModelPlaceholder')}
              />
              <p className="text-sm text-muted-foreground">
                {t('settings.embeddingModelDesc')}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="max-output-tokens">{t('settings.maxOutputTokens')}</Label>
              <Input
                id="max-output-tokens"
                type="number"
                min={128}
                max={262144}
                step={128}
                value={maxOutputTokens}
                onChange={(e) => setMaxOutputTokens(Number(e.target.value) || 8192)}
                placeholder="8192"
              />
              <input
                type="range"
                min={128}
                max={262144}
                step={128}
                value={Math.max(128, Math.min(262144, Number(maxOutputTokens) || 8192))}
                onChange={(e) => setMaxOutputTokens(Number(e.target.value) || 8192)}
                className="w-full accent-primary"
              />
              <div className="flex flex-wrap gap-2 pt-1">
                {MAX_OUTPUT_TOKEN_PRESETS.map((preset) => (
                  <Button
                    key={preset}
                    size="sm"
                    type="button"
                    variant={maxOutputTokens === preset ? 'default' : 'outline'}
                    onClick={() => setMaxOutputTokens(preset)}
                  >
                    {preset}
                  </Button>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">
                {t('settings.maxOutputTokensDesc')}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="max-context-tokens">{t('settings.maxContextTokens')}</Label>
              <Input
                id="max-context-tokens"
                type="number"
                min={512}
                max={1048576}
                step={512}
                value={maxContextTokens}
                onChange={(e) => setMaxContextTokens(Number(e.target.value) || 8192)}
                placeholder="8192"
              />
              <input
                type="range"
                min={512}
                max={1048576}
                step={512}
                value={Math.max(512, Math.min(1048576, Number(maxContextTokens) || 8192))}
                onChange={(e) => setMaxContextTokens(Number(e.target.value) || 8192)}
                className="w-full accent-primary"
              />
              <div className="flex flex-wrap gap-2 pt-1">
                {MAX_CONTEXT_TOKEN_PRESETS.map((preset) => (
                  <Button
                    key={preset}
                    size="sm"
                    type="button"
                    variant={maxContextTokens === preset ? 'default' : 'outline'}
                    onClick={() => setMaxContextTokens(preset)}
                  >
                    {preset}
                  </Button>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">
                {t('settings.maxContextTokensDesc')}
              </p>
            </div>
            <div className="flex items-center justify-between pt-2 border-t">
              <div className="space-y-0.5">
                <Label>{t('settings.autoUnload')}</Label>
                <p className="text-sm text-muted-foreground">
                  {t('settings.autoUnloadDesc')}
                </p>
              </div>
              <Switch
                checked={autoUnloadAfterResponse}
                onCheckedChange={setAutoUnloadAfterResponse}
              />
            </div>
            <Button onClick={saveSettings} disabled={isLoading}>
              {isLoading ? t('common.saving') : t('common.save')}
            </Button>
          </CardContent>
        </Card>

        {/* Language & Appearance */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Languages className="h-5 w-5" />
              {t('settings.language')}
            </CardTitle>
            <CardDescription>{t('settings.languageDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{t('settings.languageLabel')}</Label>
              <div className="flex gap-2">
                <Button
                  variant={i18n.language.startsWith('zh') ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => changeLanguage('zh-CN')}
                >
                  {t('settings.languageZh')}
                </Button>
                <Button
                  variant={i18n.language === 'en' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => changeLanguage('en')}
                >
                  {t('settings.languageEn')}
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-between pt-2 border-t">
              <div className="space-y-0.5">
                <Label>{t('settings.darkMode')}</Label>
                <p className="text-sm text-muted-foreground">
                  {t('settings.darkModeDesc')}
                </p>
              </div>
              <Switch checked={darkMode} onCheckedChange={toggleDarkMode} />
            </div>
          </CardContent>
        </Card>

        {/* About */}
        <Card>
          <CardHeader>
            <CardTitle>{t('settings.about')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('settings.version')}</span>
              <span>1.0.0</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('settings.frontend')}</span>
              <span>React + TypeScript + shadcn/ui</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('settings.backend')}</span>
              <span>FastAPI + Python</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
