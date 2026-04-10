import { useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Search,
  Download,
  Brain,
  Loader2,
  CheckCircle2,
  Filter,
  Tag,
  Globe2,
  RefreshCw,
  Sparkles,
  Cpu,
  HardDrive,
  Monitor,
  Trash2,
  Clock3,
  ArrowUpRight,
  PackageCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ModelCard } from '@/components/models/ModelCard';
import { LibraryModelCard } from '@/components/models/LibraryModelCard';
import { useModels, stripEmojis } from '@/hooks/useModels';
import { useModelRecommendation } from '@/hooks/useModelRecommendation';
import { SurfaceState } from '@/components/layout/SurfaceState';
import type { Model } from '@/types';

type OfficialModelDetails = {
  parent_model: string;
  format: string;
  family: string;
  families: string[];
  parameter_size: string;
  quantization_level: string;
};

export type OfficialModel = Model & {
  model: string;
  details?: OfficialModelDetails;
};

function formatBytesShort(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

function formatTransferSpeed(bytesPerSecond: number): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return '—';
  return `${formatBytesShort(bytesPerSecond)}/s`;
}

function formatTransferEta(seconds: number): string {
  if (!seconds || seconds <= 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

export function Models() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { state, actions } = useModels();

  const {
    searchQuery,
    activeTab,
    selectedFamilies,
    selectedCapabilities,
    hideDownloadedInLibrary,
    librarySearchQuery,
    showFilters,
    downloadDialogModel,
    downloadDialogOpen,
    isLoadingTags,
    libraryMeta,
    allFamilies,
    allCapabilities,
    filteredDownloaded,
    filteredAvailable,
    tagsToDisplay,
    runningCount,
    downloadedCount,
    downloadTasks,
    modelStore,
  } = state;

  const {
    setSearchQuery,
    setActiveTab,
    setSelectedFamilies,
    setSelectedCapabilities,
    setHideDownloadedInLibrary,
    setLibrarySearchQuery,
    setShowFilters,
    setDownloadDialogOpen,
    handleDownload,
    handleDelete,
    handleUnload,
    handleLoad,
    handleToggleResident,
    handleOpenLibraryModel,
    handleOpenOfficialSearch,
    isModelRunning,
    isModelResident,
    isModelDownloaded,
    isModelDownloading,
    cancelDownload,
    clearHistory,
  } = actions;

  const { models, fetchLibraryModels, isLoading, libraryModels } = modelStore;

  // Smart recommendation engine
  const { hardware, loading: hwLoading, memoryLabel, perfectModels, goodModels, possibleModels } = useModelRecommendation(libraryModels);
  const currentTabFromUrl = searchParams.get('tab');

  useEffect(() => {
    const allowedTabs = new Set(['recommended', 'all', 'downloaded', 'available', 'transfers']);
    if (currentTabFromUrl && allowedTabs.has(currentTabFromUrl) && currentTabFromUrl !== activeTab) {
      setActiveTab(currentTabFromUrl as 'recommended' | 'all' | 'downloaded' | 'available' | 'transfers');
    }
  }, [activeTab, currentTabFromUrl, setActiveTab]);

  const handleTabChange = (nextTab: 'recommended' | 'all' | 'downloaded' | 'available' | 'transfers') => {
    setActiveTab(nextTab);
    const next = new URLSearchParams(searchParams);
    if (nextTab === 'recommended') next.delete('tab');
    else next.set('tab', nextTab);
    setSearchParams(next, { replace: true });
  };

  const activeTransferTasks = useMemo(
    () => downloadTasks.filter((task) => task.status === 'queued' || task.status === 'downloading'),
    [downloadTasks],
  );
  const transferHistoryTasks = useMemo(
    () => downloadTasks.filter((task) => task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled'),
    [downloadTasks],
  );
  const liveCatalogSourceLabel = (() => {
    switch (libraryMeta?.source) {
      case 'official-api+search+library':
        return 'ollama.com/api/tags + search + library';
      case 'official-api+search':
        return 'ollama.com/api/tags + search';
      case 'official-search':
        return 'ollama.com/search';
      case 'official-library':
        return 'ollama.com/library';
      case 'official-api':
      default:
        return 'ollama.com/api/tags';
    }
  })();
  const liveCatalogSyncedAt = libraryMeta?.fetched_at
    ? new Date(libraryMeta.fetched_at * 1000).toLocaleTimeString()
    : null;

  // Search within recommended tab
  const filterRec = (list: typeof perfectModels) => {
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(r =>
      r.model.name.toLowerCase().includes(q) ||
      r.model.description.toLowerCase().includes(q) ||
      r.model.capabilities.some(c => c.toLowerCase().includes(q))
    );
  };
  const filteredPerfect = filterRec(perfectModels);
  const filteredGood = filterRec(goodModels);
  const filteredPossible = filterRec(possibleModels);

  return (
    <div className="space-y-5">
      <Card className="border-border/70 bg-card/82 shadow-[0_22px_60px_-54px_rgba(15,23,42,0.45)]">
        <CardContent className="space-y-5 p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {t('models.catalogOverview')}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-border/70 bg-background/60 p-4">
                  <div className="text-xs text-muted-foreground">{t('models.metrics.downloaded')}</div>
                  <div className="mt-2 text-2xl font-semibold">{downloadedCount}</div>
                </div>
                <div className="rounded-2xl border border-border/70 bg-background/60 p-4">
                  <div className="text-xs text-muted-foreground">{t('models.metrics.loaded')}</div>
                  <div className="mt-2 text-2xl font-semibold">{runningCount}</div>
                </div>
                <div className="rounded-2xl border border-border/70 bg-background/60 p-4">
                  <div className="text-xs text-muted-foreground">{t('models.metrics.transfers')}</div>
                  <div className="mt-2 text-2xl font-semibold">{activeTransferTasks.length}</div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 xl:max-w-[420px] xl:justify-end">
              <Button variant="outline" onClick={() => fetchLibraryModels(true)} className="rounded-2xl">
                <RefreshCw className="mr-2 h-4 w-4" />
                {t('models.refreshLibrary')}
              </Button>
              <Button variant="outline" onClick={() => handleTabChange('transfers')} className="rounded-2xl">
                <ArrowUpRight className="mr-2 h-4 w-4" />
                {t('models.tabTransfers')}
              </Button>
              <Button variant="outline" onClick={handleOpenOfficialSearch} className="rounded-2xl">
                <Globe2 className="mr-2 h-4 w-4" />
                {t('models.officialSearch')}
              </Button>
            </div>
          </div>

          {libraryMeta?.count ? (
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <Badge variant="outline" className="rounded-full px-3 py-1">
                {t('models.liveCatalogBadge', { count: libraryMeta.count })}
              </Badge>
              <span>
                {t('models.liveCatalog', {
                  count: libraryMeta.count,
                  source: liveCatalogSourceLabel,
                  syncedAt: liveCatalogSyncedAt || '--:--',
                })}
              </span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="rounded-2xl border border-border/70 bg-card/76 p-2 shadow-sm">
        <div className="flex flex-wrap gap-2">
          <Button
            variant={activeTab === 'recommended' ? 'default' : 'outline'}
            onClick={() => handleTabChange('recommended')}
            className="gap-1.5"
          >
            <Sparkles className="h-4 w-4" />
            {t('models.tabRecommended')}
          </Button>
          <Button variant={activeTab === 'all' ? 'default' : 'outline'} onClick={() => handleTabChange('all')}>
            {t('models.tabAll')}
          </Button>
          <Button
            variant={activeTab === 'downloaded' ? 'default' : 'outline'}
            onClick={() => handleTabChange('downloaded')}
          >
            {t('models.tabDownloaded')} ({models.length})
          </Button>
          <Button
            variant={activeTab === 'available' ? 'default' : 'outline'}
            onClick={() => handleTabChange('available')}
          >
            {t('models.tabAvailable')} ({filteredAvailable.length})
          </Button>
          <Button
            variant={activeTab === 'transfers' ? 'default' : 'outline'}
            onClick={() => handleTabChange('transfers')}
          >
            {t('models.tabTransfers')} ({downloadTasks.length})
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('models.searchAllPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-11 rounded-2xl pl-10"
          />
        </div>
        <Button
          variant="outline"
          onClick={() => setShowFilters(!showFilters)}
          className={cn('rounded-2xl', showFilters && 'bg-muted')}
        >
          <Filter className="h-4 w-4 mr-2" />
          {t('models.filters')}
          {selectedFamilies.length > 0 && <Badge variant="secondary" className="ml-2">{selectedFamilies.length}</Badge>}
        </Button>
      </div>

      {showFilters && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Tag className="h-4 w-4" />
                {t('models.filterConditions')}
              </h4>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedFamilies([]);
                  setSelectedCapabilities([]);
                }}
                disabled={selectedFamilies.length === 0 && selectedCapabilities.length === 0}
              >
                {t('models.clearFilters')}
              </Button>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-xs text-muted-foreground mb-2">{t('models.filterByFamily')}</p>
                <div className="flex flex-wrap gap-2">
                  {allFamilies.map((family) => (
                    <button
                      key={family}
                      onClick={() => {
                        setSelectedFamilies((prev) =>
                          prev.includes(family) ? prev.filter((f) => f !== family) : [...prev, family],
                        );
                      }}
                      className={cn(
                        'transition-all',
                        selectedFamilies.includes(family)
                          ? 'ring-2 ring-primary ring-offset-2'
                          : 'opacity-70 hover:opacity-100',
                      )}
                    >
                      <Badge variant={selectedFamilies.includes(family) ? 'default' : 'secondary'}>{family}</Badge>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs text-muted-foreground mb-2">{t('models.filterByCapability')}</p>
                <div className="flex flex-wrap gap-2">
                  {allCapabilities.slice(0, 20).map((cap) => (
                    <button
                      key={cap}
                      onClick={() => {
                        setSelectedCapabilities((prev) =>
                          prev.includes(cap) ? prev.filter((item) => item !== cap) : [...prev, cap],
                        );
                      }}
                      className={cn(
                        'transition-all',
                        selectedCapabilities.includes(cap)
                          ? 'ring-2 ring-primary ring-offset-2'
                          : 'opacity-70 hover:opacity-100',
                      )}
                    >
                      <Badge variant={selectedCapabilities.includes(cap) ? 'default' : 'secondary'}>{cap}</Badge>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between rounded-md border p-3">
                <div className="text-sm">
                  <p className="font-medium">{t('models.hideDownloadedTitle')}</p>
                  <p className="text-xs text-muted-foreground">{t('models.hideDownloadedDesc')}</p>
                </div>
                <Button
                  variant={hideDownloadedInLibrary ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setHideDownloadedInLibrary((prev) => !prev)}
                >
                  {hideDownloadedInLibrary ? t('common.enabled') : t('common.disabled')}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recommended Tab */}
      {activeTab === 'recommended' && (
        <div className="space-y-6">
          {/* Hardware Info Banner */}
          {hardware && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <Card className="bg-gradient-to-r from-primary/5 via-primary/3 to-transparent border-primary/20">
                <CardContent className="p-4">
                  <div className="flex items-center gap-6 flex-wrap">
                    <div className="flex items-center gap-2 text-sm">
                      <HardDrive className="h-4 w-4 text-primary" />
                      <span className="text-muted-foreground">{t('settings.ram')}:</span>
                      <span className="font-semibold">{formatBytesShort(hardware.ram_total)}</span>
                      <span className="text-xs text-muted-foreground">
                        ({formatBytesShort(hardware.ram_available)} {t('common.available')})
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Cpu className="h-4 w-4 text-blue-500" />
                      <span className="text-muted-foreground">{t('settings.cpu')}:</span>
                      <span className="font-semibold">{hardware.cpu_cores_physical}C / {hardware.cpu_cores_logical}T</span>
                      <span className="text-xs text-muted-foreground">({hardware.cpu_arch})</span>
                    </div>
                    {hardware.gpu_name && (
                      <div className="flex items-center gap-2 text-sm">
                        <Monitor className="h-4 w-4 text-emerald-500" />
                        <span className="text-muted-foreground">{t('settings.gpu')}:</span>
                        <span className="font-semibold">{hardware.gpu_name}</span>
                        {hardware.gpu_vram_bytes && (
                          <span className="text-xs text-muted-foreground">({formatBytesShort(hardware.gpu_vram_bytes)})</span>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {hwLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <>
              {/* Memory context banner when no hardware detected */}
              {!hardware && memoryLabel && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <Card className="border-dashed border-muted-foreground/30">
                    <CardContent className="p-3 flex items-center gap-2 text-sm text-muted-foreground">
                      <HardDrive className="h-4 w-4" />
                      <span>{memoryLabel}</span>
                    </CardContent>
                  </Card>
                </motion.div>
              )}



              {/* Perfect Fit Models */}
              {filteredPerfect.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-amber-500" />
                    {t('models.recommended')} ({filteredPerfect.length})
                  </h3>
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {filteredPerfect.map((rec, index) => (
                      <motion.div
                        key={rec.model.slug}
                        className="h-full"
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: Math.min(index * 0.03, 0.3) }}
                      >
                        <Card className="hover:border-primary/50 transition-all duration-300 hover:shadow-md md:rounded-xl group bg-card relative overflow-hidden h-full flex flex-col">
                          <div className="absolute top-0 right-0 bg-gradient-to-bl from-amber-500/20 to-transparent w-20 h-20" />
                          <CardContent className="p-4 md:p-5 flex flex-col h-full">
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <h4 className="font-bold text-lg tracking-tight truncate group-hover:text-primary transition-colors">
                                {rec.model.name}
                              </h4>
                              <div className="flex items-center gap-2 shrink-0">
                                <Badge variant="outline" className="text-[10px] font-mono border-primary/20 bg-primary/5">
                                  {rec.score}
                                </Badge>
                                <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 shrink-0 text-[10px]">
                                  <Sparkles className="h-3 w-3 mr-1" />
                                  {t('models.suitableHardware')}
                                </Badge>
                              </div>
                            </div>
                            <p className="text-[13px] text-muted-foreground line-clamp-2 mb-2">{stripEmojis(rec.model.description)}</p>
                            <div className="flex items-center gap-2 mb-3">
                              <Badge variant="outline" className="text-[10px] font-mono">{rec.bestSize}</Badge>
                              <span className="text-xs text-muted-foreground">
                                {t('models.approxRam', { value: rec.estimatedRamGB.toFixed(1) })}
                              </span>
                            </div>
                            {rec.highlights.length > 0 && (
                              <div className="mb-3 flex flex-wrap gap-1.5">
                                {rec.highlights.map((highlight) => (
                                  <Badge key={highlight} variant="secondary" className="text-[10px] h-5 px-1.5">
                                    {highlight}
                                  </Badge>
                                ))}
                              </div>
                            )}
                            <p className="text-xs text-muted-foreground mb-3">{rec.reason}</p>
                            <div className="mt-auto pt-2">
                              <div className="flex flex-wrap gap-1.5 mb-3">
                                {rec.model.capabilities.slice(0, 3).map(cap => (
                                  <Badge key={cap} variant="secondary" className="text-[10px] h-5 px-1.5">{cap}</Badge>
                                ))}
                              </div>
                              <Button
                                size="sm"
                                className="w-full rounded-lg text-[13px] font-medium h-9 shadow-sm transition-transform active:scale-95"
                                onClick={() => handleOpenLibraryModel(rec.model)}
                              >
                                <Download className="h-3.5 w-3.5 mr-1.5" />
                                {t('models.download')}
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}

              {/* Good Fit Models */}
              {filteredGood.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    {t('models.runnable')} ({filteredGood.length})
                  </h3>
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {filteredGood.map((rec, index) => (
                      <motion.div
                        key={rec.model.slug}
                        className="h-full"
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: Math.min(index * 0.03, 0.3) }}
                      >
                        <Card className="hover:border-primary/50 transition-all duration-300 hover:shadow-md md:rounded-xl group bg-card h-full flex flex-col">
                          <CardContent className="p-4 md:p-5 flex flex-col h-full">
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <h4 className="font-bold text-lg tracking-tight truncate group-hover:text-primary transition-colors">
                                {rec.model.name}
                              </h4>
                              <Badge variant="outline" className="text-[10px] font-mono border-primary/20 bg-primary/5 shrink-0">
                                {rec.score}
                              </Badge>
                            </div>
                            <p className="text-[13px] text-muted-foreground line-clamp-2 mb-2">{stripEmojis(rec.model.description)}</p>
                            <div className="flex items-center gap-2 mb-3">
                              <Badge variant="outline" className="text-[10px] font-mono">{rec.bestSize}</Badge>
                              <span className="text-xs text-muted-foreground">
                                {t('models.approxRam', { value: rec.estimatedRamGB.toFixed(1) })}
                              </span>
                            </div>
                            {rec.highlights.length > 0 && (
                              <div className="mb-3 flex flex-wrap gap-1.5">
                                {rec.highlights.map((highlight) => (
                                  <Badge key={highlight} variant="secondary" className="text-[10px] h-5 px-1.5">
                                    {highlight}
                                  </Badge>
                                ))}
                              </div>
                            )}
                            <p className="text-xs text-muted-foreground mb-3">{rec.reason}</p>
                            <div className="mt-auto pt-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="w-full rounded-lg text-[13px] font-medium h-9"
                                onClick={() => handleOpenLibraryModel(rec.model)}
                              >
                                <Download className="h-3.5 w-3.5 mr-1.5" />
                                {t('models.download')}
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}

              {filteredPossible.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-sky-500" />
                    {t('models.worthTrying')} ({filteredPossible.length})
                  </h3>
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {filteredPossible.map((rec, index) => (
                      <motion.div
                        key={rec.model.slug}
                        className="h-full"
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: Math.min(index * 0.03, 0.3) }}
                      >
                        <Card className="hover:border-primary/40 transition-all duration-300 hover:shadow-md md:rounded-xl group bg-card h-full flex flex-col">
                          <CardContent className="p-4 md:p-5 flex flex-col h-full">
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <h4 className="font-bold text-lg tracking-tight truncate group-hover:text-primary transition-colors">
                                {rec.model.name}
                              </h4>
                              <Badge variant="outline" className="text-[10px] font-mono border-primary/20 bg-primary/5 shrink-0">
                                {rec.score}
                              </Badge>
                            </div>
                            <p className="text-[13px] text-muted-foreground line-clamp-2 mb-2">{stripEmojis(rec.model.description)}</p>
                            <div className="flex items-center gap-2 mb-3">
                              <Badge variant="outline" className="text-[10px] font-mono">{rec.bestSize}</Badge>
                              <span className="text-xs text-muted-foreground">
                                {t('models.approxRam', { value: rec.estimatedRamGB.toFixed(1) })}
                              </span>
                            </div>
                            {rec.highlights.length > 0 && (
                              <div className="mb-3 flex flex-wrap gap-1.5">
                                {rec.highlights.map((highlight) => (
                                  <Badge key={highlight} variant="secondary" className="text-[10px] h-5 px-1.5">
                                    {highlight}
                                  </Badge>
                                ))}
                              </div>
                            )}
                            <p className="text-xs text-muted-foreground mb-3">{rec.reason}</p>
                            <div className="mt-auto pt-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="w-full rounded-lg text-[13px] font-medium h-9"
                                onClick={() => handleOpenLibraryModel(rec.model)}
                              >
                                <Download className="h-3.5 w-3.5 mr-1.5" />
                                {t('models.download')}
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}

              {perfectModels.length === 0 && goodModels.length === 0 && possibleModels.length === 0 && (
                <Card>
                  <CardContent className="p-8 text-center text-muted-foreground">
                    <Sparkles className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>{t('models.noRecommendation')}</p>
                    <p className="text-sm mt-1">{t('models.noRecommendationHint')}</p>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      )}

      {(activeTab === 'all' || activeTab === 'transfers') && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <PackageCheck className="h-5 w-5" />
              {t('models.tabTransfers')} ({downloadTasks.length})
            </h3>
            {transferHistoryTasks.length > 0 ? (
              <Button variant="outline" size="sm" className="rounded-full" onClick={() => void clearHistory()}>
                <Trash2 className="mr-2 h-4 w-4" />
                {t('downloads.clearHistory')}
              </Button>
            ) : null}
          </div>

          {downloadTasks.length === 0 ? (
            <SurfaceState
              icon={PackageCheck}
              title={t('models.transfersEmptyTitle')}
              description={t('models.transfersEmptyDescription')}
              tone="neutral"
            />
          ) : (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
              <Card className="border-border/70 bg-card/82">
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold">{t('downloads.active')}</div>
                      <div className="text-xs text-muted-foreground">{t('models.transfersActiveDescription')}</div>
                    </div>
                    <Badge variant="outline">{activeTransferTasks.length}</Badge>
                  </div>
                  {activeTransferTasks.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border/70 bg-muted/22 px-4 py-5 text-sm text-muted-foreground">
                      {t('models.transfersNoActive')}
                    </div>
                  ) : (
                    activeTransferTasks.map((task) => (
                      <div key={task.id} className="rounded-2xl border border-border/70 bg-background/60 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-medium">{task.model_name}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{task.status_text || task.status}</div>
                          </div>
                          <Badge variant="outline">{task.progress.toFixed(1)}%</Badge>
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted/50">
                          <motion.div
                            className="h-full rounded-full bg-primary"
                            animate={{ width: `${Math.max(3, task.progress)}%` }}
                            transition={{ duration: 0.28, ease: 'easeOut' }}
                          />
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                          <span>{formatBytesShort(task.downloaded_size)} / {formatBytesShort(task.total_size)}</span>
                          <span>{formatTransferSpeed(task.speed)}</span>
                          <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> {formatTransferEta(task.eta)}</span>
                        </div>
                        <div className="mt-3">
                          <Button variant="outline" size="sm" className="rounded-full" onClick={() => void cancelDownload(task.id)}>
                            {t('common.cancel')}
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card className="border-border/70 bg-card/82">
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold">{t('models.transferHistoryTitle')}</div>
                      <div className="text-xs text-muted-foreground">{t('models.transferHistoryDescription')}</div>
                    </div>
                    <Badge variant="outline">{transferHistoryTasks.length}</Badge>
                  </div>
                  {transferHistoryTasks.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border/70 bg-muted/22 px-4 py-5 text-sm text-muted-foreground">
                      {t('models.transferHistoryEmpty')}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {transferHistoryTasks.slice(0, 8).map((task) => (
                        <div key={task.id} className="rounded-2xl border border-border/70 bg-background/60 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-medium">{task.model_name}</div>
                              <div className="mt-1 text-xs text-muted-foreground">{task.status_text || task.status}</div>
                            </div>
                            <Badge variant={task.status === 'completed' ? 'default' : task.status === 'failed' ? 'destructive' : 'outline'}>
                              {task.status === 'completed'
                                ? t('downloads.statusCompleted')
                                : task.status === 'cancelled'
                                  ? t('downloads.statusCancelled')
                                  : t('downloads.statusFailed')}
                            </Badge>
                          </div>
                          {task.error ? (
                            <div className="mt-2 text-xs text-rose-400">{task.error}</div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}


      {(activeTab === 'all' || activeTab === 'downloaded') && (
        <div>
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Brain className="h-5 w-5" />
            {t('models.downloadedSection')} ({filteredDownloaded.length})
          </h3>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : filteredDownloaded.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <Brain className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>{t('models.noDownloaded')}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredDownloaded.map((model, index) => (
                <ModelCard
                  key={model.name}
                  model={model as unknown as OfficialModel}
                  isRunning={isModelRunning(model.name)}
                  isResident={isModelResident(model.name)}
                  onLoad={handleLoad}
                  onUnload={handleUnload}
                  onToggleResident={handleToggleResident}
                  onDelete={handleDelete}
                  index={index}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {(activeTab === 'all' || activeTab === 'available') && (
        <div>
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Download className="h-5 w-5" />
              {t('models.availableSection')} ({filteredAvailable.length})
            </h3>
            <div className="relative w-full md:w-[340px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={librarySearchQuery}
                onChange={(e) => setLibrarySearchQuery(e.target.value)}
                placeholder={t('models.searchLibraryPlaceholder')}
                className="pl-9"
              />
            </div>
          </div>
          {filteredAvailable.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <Download className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>{librarySearchQuery.trim() ? t('models.noLibraryMatch') : t('models.noAvailable')}</p>
                <Button className="mt-4" variant="outline" onClick={() => fetchLibraryModels(true)}>
                  {t('models.retryFetchLibrary')}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredAvailable.map((model, index) => (
                <LibraryModelCard
                  key={model.slug}
                  model={model}
                  isModelDownloaded={isModelDownloaded}
                  isModelDownloading={isModelDownloading}
                  handleOpenLibraryModel={handleOpenLibraryModel}
                  index={index}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <Dialog open={downloadDialogOpen} onOpenChange={setDownloadDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{downloadDialogModel?.name || t('models.selectVersion')}</DialogTitle>
            <DialogDescription>{downloadDialogModel?.description || t('models.selectVersionDesc')}</DialogDescription>
          </DialogHeader>
          {isLoadingTags ? (
            <div className="py-10 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <div className="grid gap-2 py-2 max-h-[420px] overflow-auto">
              {tagsToDisplay.map((tag) => (
                <div key={tag.full_name} className="flex items-center justify-between p-3 rounded-lg border">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm">{tag.full_name}</span>
                    {tag.is_latest && <Badge variant="secondary">{t('models.latest')}</Badge>}
                  </div>
                  {isModelDownloaded(tag.full_name) ? (
                    <Badge className="bg-green-500">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      {t('models.downloaded')}
                    </Badge>
                  ) : isModelDownloading(tag.full_name) ? (
                    <Button size="sm" variant="outline" disabled>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      {t('models.downloadInProgress')}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={async () => {
                        await handleDownload(tag.full_name);
                      }}
                    >
                      <Download className="h-4 w-4 mr-1" />
                      {t('models.downloadAction')}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
