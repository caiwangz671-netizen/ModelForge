import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { memoryApi } from '@/services/api';
import { useDownloadStore } from '@/store/downloadStore';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/use-toast';
import { Brain, Search, Plus, Trash2, Database, AlertCircle, Upload } from 'lucide-react';
import type { MemoryItem, MemoryType } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';

const MEMORY_TYPE_KEYS: { value: MemoryType; labelKey: string }[] = [
  { value: 'short_term', labelKey: 'memory.types.short_term' },
  { value: 'long_term', labelKey: 'memory.types.long_term' },
  { value: 'semantic', labelKey: 'memory.types.semantic' },
  { value: 'episodic', labelKey: 'memory.types.episodic' },
];

export function Memory() {
  const { t } = useTranslation();
  const { startDownload } = useDownloadStore();
  const [searchParams] = useSearchParams();
  const queryFromUrl = (searchParams.get('query') || '').trim();
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState(queryFromUrl);
  const [selectedType, setSelectedType] = useState<MemoryType | 'all'>('all');
  const [memoryStatus, setMemoryStatus] = useState<{
    enabled: boolean;
    reason: string;
    embedding_model?: string | null;
  } | null>(null);
  const [embeddingSetup, setEmbeddingSetup] = useState<{
    need_download: boolean;
    recommended_download_model?: string | null;
    local_embedding_models?: string[];
    status?: {
      reason?: string;
      embedding_model?: string | null;
      configured_embedding_model?: string | null;
    };
  } | null>(null);
  const [showEmbeddingSetupDialog, setShowEmbeddingSetupDialog] = useState(false);
  const [isStartingEmbeddingDownload, setIsStartingEmbeddingDownload] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newMemory, setNewMemory] = useState({
    type: 'short_term' as MemoryType,
    content: '',
    tags: [] as string[],
    importance: 0.5,
  });
  const lastAppliedQueryRef = useRef<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importTags, setImportTags] = useState('rag,external');
  const [tagInput, setTagInput] = useState('');

  useEffect(() => {
    fetchMemoryStatus();
    fetchEmbeddingSetup();
  }, []);

  useEffect(() => {
    if (!queryFromUrl) return;
    if (lastAppliedQueryRef.current === queryFromUrl) return;
    lastAppliedQueryRef.current = queryFromUrl;
    if (queryFromUrl !== searchQuery) {
      setSearchQuery(queryFromUrl);
    }
  }, [queryFromUrl, searchQuery]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchMemories();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchQuery, selectedType]);

  const fetchMemoryStatus = async () => {
    try {
      const response = await memoryApi.status();
      setMemoryStatus(response.data || null);
    } catch (error) {
      console.error('Failed to fetch memory status:', error);
    }
  };

  const fetchEmbeddingSetup = async () => {
    try {
      const response = await memoryApi.embeddingSetup();
      const setup = response.data || null;
      setEmbeddingSetup(setup);
      if (setup?.need_download && setup?.recommended_download_model) {
        setShowEmbeddingSetupDialog(true);
      }
    } catch (error) {
      console.error('Failed to fetch embedding setup:', error);
    }
  };

  const fetchMemories = async () => {
    setIsLoading(true);
    try {
      const query = searchQuery.trim();
      const response = query
        ? await memoryApi.search(query, 50)
        : await memoryApi.list({
            type: selectedType === 'all' ? undefined : selectedType,
            limit: 100,
            offset: 0,
          });

      const items: MemoryItem[] = (response.data.items || []).filter((item: MemoryItem) =>
        selectedType === 'all' ? true : item.type === selectedType
      );
      setMemories(items);
    } catch (error) {
      console.error('Failed to fetch memories:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateMemory = async () => {
    try {
      await memoryApi.create(newMemory);
      setIsDialogOpen(false);
      setNewMemory({
        type: 'short_term',
        content: '',
        tags: [],
        importance: 0.5,
      });
      await fetchMemories();
      await fetchMemoryStatus();
    } catch (error) {
      console.error('Failed to create memory:', error);
    }
  };

  const handleDeleteMemory = async (id: string) => {
    try {
      await memoryApi.delete(id);
      await fetchMemories();
    } catch (error) {
      console.error('Failed to delete memory:', error);
    }
  };

  const handleAddTag = () => {
    if (tagInput.trim() && !newMemory.tags.includes(tagInput.trim())) {
      setNewMemory({
        ...newMemory,
        tags: [...newMemory.tags, tagInput.trim()],
      });
      setTagInput('');
    }
  };

  const handleRemoveTag = (tag: string) => {
    setNewMemory({
      ...newMemory,
      tags: newMemory.tags.filter((t) => t !== tag),
    });
  };

  const handleImportDocument = async (file?: File | null) => {
    if (!file) return;
    setIsImporting(true);
    try {
      const tagList = importTags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);

      const response = await memoryApi.importFile(file, {
        tags: tagList,
        memory_type: 'semantic',
      });
      const importedCount = Number(response.data?.imported_count || 0);
      toast({
        title: t('memory.toast.importSuccessTitle'),
        description: t('memory.toast.importSuccessDesc', { file: file.name, count: importedCount }),
      });
      await fetchMemories();
      await fetchMemoryStatus();
    } catch (error) {
      toast({
        title: t('memory.toast.importFailedTitle'),
        description: error instanceof Error ? error.message : t('common.unknownError'),
        variant: 'destructive',
      });
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const filteredMemories = memories;

  const memoryTypes = MEMORY_TYPE_KEYS.map((item) => ({
    value: item.value,
    label: t(item.labelKey),
  }));

  const getTypeLabel = (type: MemoryType) => {
    return memoryTypes.find((item) => item.value === type)?.label || type;
  };

  const getCategoryLabel = (category?: string) => {
    const map: Record<string, string> = {
      external_knowledge: t('memory.categories.external_knowledge'),
      user_profile: t('memory.categories.user_profile'),
      user_preference: t('memory.categories.user_preference'),
      project_context: t('memory.categories.project_context'),
      conversation_memory: t('memory.categories.conversation_memory'),
      knowledge_snippet: t('memory.categories.knowledge_snippet'),
      long_term_note: t('memory.categories.long_term_note'),
      general_note: t('memory.categories.general_note'),
    };
    return map[category || ''] || category || '';
  };

  const getMemoryImportance = (memory: MemoryItem) => {
    const raw = memory.metadata?.importance;
    if (typeof raw === 'number') return raw;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0.5;
  };

  const getMemorySourceName = (memory: MemoryItem) => {
    const raw = memory.metadata?.source_name;
    if (typeof raw !== 'string') return '';
    return raw.trim();
  };

  const handleStartEmbeddingDownload = async () => {
    const modelName = embeddingSetup?.recommended_download_model?.trim();
    if (!modelName) return;
    setIsStartingEmbeddingDownload(true);
    try {
      await startDownload(modelName);
      setShowEmbeddingSetupDialog(false);
      toast({
        title: t('memory.toast.embeddingDownloadStartedTitle'),
        description: modelName,
      });
    } catch (error) {
      toast({
        title: t('memory.toast.embeddingDownloadFailedTitle'),
        description: error instanceof Error ? error.message : t('common.unknownError'),
        variant: 'destructive',
      });
    } finally {
      setIsStartingEmbeddingDownload(false);
    }
  };

  return (
    <div className="space-y-6">
      <Dialog open={showEmbeddingSetupDialog} onOpenChange={setShowEmbeddingSetupDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('memory.embeddingDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('memory.embeddingDialog.description')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border p-3 text-sm">
              <p className="font-medium">{t('memory.embeddingDialog.recommendedModel')}</p>
              <p className="text-muted-foreground mt-1">
                {embeddingSetup?.recommended_download_model || 'nomic-embed-text:latest'}
              </p>
            </div>
            {embeddingSetup?.local_embedding_models && embeddingSetup.local_embedding_models.length > 0 && (
              <div className="rounded-md border p-3 text-sm">
                <p className="font-medium">{t('memory.embeddingDialog.localModels')}</p>
                <p className="text-muted-foreground mt-1">
                  {embeddingSetup.local_embedding_models.join(', ')}
                </p>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowEmbeddingSetupDialog(false)}
                disabled={isStartingEmbeddingDownload}
              >
                {t('memory.embeddingDialog.later')}
              </Button>
              <Button onClick={handleStartEmbeddingDownload} disabled={isStartingEmbeddingDownload}>
                {isStartingEmbeddingDownload ? t('memory.embeddingDialog.starting') : t('memory.embeddingDialog.downloadNow')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Premium Header Banner */}
      <div className="rounded-2xl border bg-gradient-to-br from-indigo-500/10 via-background to-purple-500/10 p-5 md:p-6 mb-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">{t('memory.title')}</h2>
            <p className="text-muted-foreground mt-2">
              {t('memory.subtitle')}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {memoryStatus?.enabled ? (
                <Badge variant="default" className="bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/20 border-indigo-500/20">
                  <Database className="h-3 w-3 mr-1" />
                  {t('common.enabled')}
                </Badge>
              ) : (
                <Badge variant="destructive">
                  <AlertCircle className="h-3 w-3 mr-1" />
                  {t('common.disabled')}
                </Badge>
              )}
              {memoryStatus?.enabled && memoryStatus.embedding_model && (
                <Badge variant="outline" className="text-xs">
                  {t('memory.modelLabel', { model: memoryStatus.embedding_model })}
                </Badge>
              )}
              {!memoryStatus?.enabled && memoryStatus?.reason && (
                <span className="text-xs text-muted-foreground">
                  {t('memory.reasonPrefix')} {
                    memoryStatus.reason === 'no_embedding_model' ? t('memory.reasons.no_embedding_model') :
                    memoryStatus.reason === 'disabled_by_settings' ? t('memory.reasons.disabled_by_settings') :
                    memoryStatus.reason
                  }
                </span>
              )}
            </div>
          </div>
          
          <div className="flex flex-col gap-2 sm:items-end">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".txt,.md,.markdown,.json,.csv,.log"
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                void handleImportDocument(e.target.files?.[0] || null);
              }}
            />
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <Input
                value={importTags}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setImportTags(e.target.value)}
                className="h-9 w-[220px]"
                placeholder={t('memory.importTagsPlaceholder')}
              />
              <Button
                variant="outline"
                className="shadow-sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isImporting}
              >
                <Upload className={`h-4 w-4 mr-1.5 ${isImporting ? 'animate-pulse' : ''}`} />
                {isImporting ? t('memory.importing') : t('memory.importData')}
              </Button>
            </div>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button className="shadow-sm">
                  <Plus className="h-4 w-4 mr-1.5" />
                  {t('memory.addMemory')}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{t('memory.addDialog.title')}</DialogTitle>
                <DialogDescription>
                  {t('memory.addDialog.description')}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">{t('memory.addDialog.typeLabel')}</label>
                  <Select
                    value={newMemory.type}
                    onValueChange={(v: string) =>
                      setNewMemory({ ...newMemory, type: v as MemoryType })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {memoryTypes.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">{t('memory.addDialog.contentLabel')}</label>
                  <textarea
                    className="w-full min-h-[120px] p-3 rounded-md border bg-background resize-y text-sm transition-colors focus:ring-2 focus:ring-primary/20 outline-none"
                    placeholder={t('memory.addDialog.contentPlaceholder')}
                    value={newMemory.content}
                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                      setNewMemory({ ...newMemory, content: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">{t('memory.addDialog.tagsLabel')}</label>
                  <div className="flex gap-2 mb-2">
                    <Input
                      placeholder={t('memory.addDialog.tagsPlaceholder')}
                      value={tagInput}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => setTagInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
                    />
                    <Button type="button" variant="secondary" onClick={handleAddTag}>
                      {t('memory.addDialog.addTag')}
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2 min-h-[24px]">
                    {newMemory.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="gap-1 px-2 py-0.5 animate-in fade-in zoom-in duration-200">
                        {tag}
                        <button
                          onClick={() => handleRemoveTag(tag)}
                          onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => {
                            if (e.key === 'Enter') handleRemoveTag(tag);
                          }}
                          className="ml-1 opacity-50 hover:opacity-100 hover:text-destructive transition-all"
                        >
                          ×
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
                <Button className="w-full mt-2" onClick={handleCreateMemory} disabled={!newMemory.content.trim()}>
                  {t('memory.addDialog.save')}
                </Button>
              </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      {/* Tool Bar & Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('memory.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-background shadow-sm"
          />
        </div>
        <Select
          value={selectedType}
          onValueChange={(v: string) => setSelectedType(v as MemoryType | 'all')}
        >
          <SelectTrigger className="w-full sm:w-[180px] bg-background shadow-sm">
            <SelectValue placeholder={t('memory.filterTypePlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('memory.filterAll')}</SelectItem>
            {memoryTypes.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Memory Grid */}
      {filteredMemories.length === 0 ? (
        <Card className="border-dashed shadow-sm">
          <CardContent className="p-12 text-center text-muted-foreground flex flex-col items-center justify-center">
            <Brain className={`h-12 w-12 mb-4 opacity-50 ${isLoading ? 'animate-pulse text-primary' : ''}`} />
            <p className="text-lg font-medium">{isLoading ? t('memory.loadingSearch') : t('memory.emptyTitle')}</p>
            <p className="text-sm mt-2 max-w-sm mx-auto">
              {searchQuery.trim() 
                ? t('memory.emptySearchHint')
                : t('memory.emptyHint')}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 pb-8">
          <AnimatePresence mode="popLayout">
            {filteredMemories.map((memory, index) => (
              <motion.div
                key={memory.id}
                initial={{ opacity: 0, y: 15, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
                transition={{ duration: 0.3, delay: Math.min(index * 0.05, 0.5) }}
                layoutId={memory.id}
                className="h-full"
              >
                <Card className="h-full flex flex-col hover:border-primary/40 transition-all duration-300 hover:shadow-md group">
                  <CardContent className="p-4 flex flex-col h-full">
                    <div className="flex items-start justify-between mb-3 gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="bg-background/50 text-[10px] shrink-0">
                          {getTypeLabel(memory.type)}
                        </Badge>
                        {getCategoryLabel(
                          typeof memory.metadata?.category === 'string'
                            ? memory.metadata.category
                            : undefined
                        ) && (
                          <Badge variant="secondary" className="text-[10px] font-normal">
                            {getCategoryLabel(
                              typeof memory.metadata?.category === 'string'
                                ? memory.metadata.category
                                : undefined
                            )}
                          </Badge>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive focus:opacity-100"
                        onClick={() => handleDeleteMemory(memory.id)}
                        onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => {
                          if (e.key === 'Enter') handleDeleteMemory(memory.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    
                    <p className="text-sm text-foreground/90 leading-relaxed mb-4 break-words">
                      {memory.content}
                    </p>

                    {getMemorySourceName(memory) && (
                      <p className="mb-3 line-clamp-1 text-[11px] text-muted-foreground">
                        {t('memory.source', { name: getMemorySourceName(memory) })}
                      </p>
                    )}
                    
                    <div className="mt-auto space-y-3 pt-2">
                      {Array.isArray(memory.metadata?.tags) && memory.metadata.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {memory.metadata.tags
                            .filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
                            .map((tag) => (
                              <Badge key={tag} variant="secondary" className="text-[10px] bg-secondary/50 font-normal px-1.5">
                                {tag}
                              </Badge>
                            ))}
                        </div>
                      )}
                      
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-3 border-t">
                        <span className="flex items-center gap-1.5" title={t('memory.weightTitle')}>
                          <Brain className="h-3 w-3" />
                          Wt: {getMemoryImportance(memory).toFixed(2)}
                        </span>
                        {typeof memory.score === 'number' && (
                          <span className={memory.score > 0.8 ? "text-primary font-medium" : ""} title={t('memory.scoreTitle')}>
                            Score: {(memory.score * 100).toFixed(1)}%
                          </span>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
