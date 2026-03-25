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
  Power,
  Sparkles,
  Cpu,
  HardDrive,
  Monitor,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { ModelCard } from '@/components/models/ModelCard';
import { LibraryModelCard } from '@/components/models/LibraryModelCard';
import { useModels, stripEmojis } from '@/hooks/useModels';
import { useModelRecommendation } from '@/hooks/useModelRecommendation';
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

export function Models() {
  const { t } = useTranslation();
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
    availableCount,
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
  } = actions;

  const { models, fetchLibraryModels, isLoading, libraryModels } = modelStore;

  // Smart recommendation engine
  const { hardware, loading: hwLoading, memoryLabel, perfectModels, goodModels, possibleModels } = useModelRecommendation(libraryModels);
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{t('models.title')}</h2>
          <p className="text-muted-foreground mt-1">{t('models.subtitle')}</p>
          {libraryMeta?.count ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {t('models.liveCatalog', {
                count: libraryMeta.count,
                source: liveCatalogSourceLabel,
                syncedAt: liveCatalogSyncedAt || '--:--',
              })}
            </p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button
            variant={activeTab === 'recommended' ? 'default' : 'outline'}
            onClick={() => setActiveTab('recommended')}
            className="gap-1.5"
          >
            <Sparkles className="h-4 w-4" />
            {t('models.tabRecommended')}
          </Button>
          <Button variant={activeTab === 'all' ? 'default' : 'outline'} onClick={() => setActiveTab('all')}>
            {t('models.tabAll')}
          </Button>
          <Button
            variant={activeTab === 'downloaded' ? 'default' : 'outline'}
            onClick={() => setActiveTab('downloaded')}
          >
            {t('models.tabDownloaded')} ({models.length})
          </Button>
          <Button
            variant={activeTab === 'available' ? 'default' : 'outline'}
            onClick={() => setActiveTab('available')}
          >
            {t('models.tabAvailable')} ({filteredAvailable.length})
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">{t('models.metrics.downloaded')}</p>
              <p className="text-2xl font-semibold">{downloadedCount}</p>
            </div>
            <Brain className="h-5 w-5 text-primary" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">{t('models.metrics.loaded')}</p>
              <p className="text-2xl font-semibold">{runningCount}</p>
            </div>
            <Power className="h-5 w-5 text-blue-600" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">{t('models.metrics.library')}</p>
              <p className="text-2xl font-semibold">{availableCount}</p>
            </div>
            <Globe2 className="h-5 w-5 text-emerald-600" />
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('models.searchAllPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button variant="outline" onClick={handleOpenOfficialSearch}>
          <Globe2 className="h-4 w-4 mr-2" />
          {t('models.officialSearch')}
        </Button>
        <Button variant="outline" onClick={() => fetchLibraryModels(true)}>
          <RefreshCw className="h-4 w-4 mr-2" />
          {t('models.refreshLibrary')}
        </Button>
        <Button
          variant="outline"
          onClick={() => setShowFilters(!showFilters)}
          className={cn(showFilters && 'bg-muted')}
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
