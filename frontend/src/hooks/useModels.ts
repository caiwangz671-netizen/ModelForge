import { useEffect, useMemo, useState } from 'react';
import { useModelStore } from '@/store/modelStore';
import { useDownloadStore } from '@/store/downloadStore';
import { toast } from '@/components/ui/use-toast';
import { baseModelName, matchesDownloadTask, matchesResidentEntry, matchesRunningModel, normalizeModelName } from '@/lib/modelNames';
import { useTranslation } from 'react-i18next';
import type { LibraryModel, LibraryModelTag } from '@/types';
import type { OfficialModel } from '@/pages/Models';

export function parsePullCount(value?: string | null): number {
    if (!value) return 0;
    const normalized = value.replace(/,/g, '').trim().toUpperCase();
    const match = normalized.match(/^([\d.]+)\s*([KMB])?/);
    if (!match) return 0;
    const amount = Number(match[1]);
    if (Number.isNaN(amount)) return 0;

    const unit = match[2];
    if (unit === 'K') return amount * 1_000;
    if (unit === 'M') return amount * 1_000_000;
    if (unit === 'B') return amount * 1_000_000_000;
    return amount;
}

export function formatBytes(bytes?: number): string {
    if (!bytes) return 'Unknown';
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

export function stripEmojis(text?: string | null): string {
    if (!text) return '';
    // Regex matches common emoji ranges
    return text.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F1E6}-\u{1F1FF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]/gu, '').trim();
}

export function useModels() {
    const { t } = useTranslation();
    const modelStore = useModelStore();
    const { startDownload, tasks: downloadTasks, fetchTasks } = useDownloadStore();

    const [searchQuery, setSearchQuery] = useState('');
    const [activeTab, setActiveTab] = useState<'all' | 'downloaded' | 'available' | 'recommended'>('recommended');
    const [selectedFamilies, setSelectedFamilies] = useState<string[]>([]);
    const [selectedCapabilities, setSelectedCapabilities] = useState<string[]>([]);
    const [hideDownloadedInLibrary, setHideDownloadedInLibrary] = useState(true);
    const [librarySearchQuery, setLibrarySearchQuery] = useState('');
    const [showFilters, setShowFilters] = useState(false);
    const [downloadDialogModel, setDownloadDialogModel] = useState<LibraryModel | null>(null);
    const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
    const [isLoadingTags, setIsLoadingTags] = useState(false);

    useEffect(() => {
        modelStore.fetchModels();
        modelStore.fetchLibraryModels(true);
        modelStore.fetchRunningModels();
        modelStore.fetchResidencyStatus();
        fetchTasks();

        const timer = setInterval(() => {
            modelStore.fetchRunningModels();
            fetchTasks();
        }, 5000);

        const libraryRefreshTimer = setInterval(() => {
            modelStore.fetchLibraryModels(true);
        }, 60000);

        return () => {
            clearInterval(timer);
            clearInterval(libraryRefreshTimer);
        };
    }, []);

    const handleDownload = async (modelName: string) => {
        try {
            const result = await startDownload(modelName);
            toast({
                title: result.duplicate
                    ? t('models.toast.downloadAlreadyQueuedTitle')
                    : t('models.toast.downloadStartedTitle'),
                description: result.duplicate
                    ? t('models.toast.downloadAlreadyQueuedDesc', { name: modelName })
                    : t('models.toast.downloadStartedDesc', { name: modelName }),
            });
        } catch (error) {
            toast({
                title: t('models.toast.downloadFailedTitle'),
                description: error instanceof Error ? error.message : t('common.unknownError'),
                variant: 'destructive',
            });
        }
    };

    const handleDelete = async (modelName: string) => {
        try {
            await modelStore.deleteModel(modelName);
            toast({
                title: t('models.toast.deleteSuccessTitle'),
                description: t('models.toast.deleteSuccessDesc', { name: modelName }),
            });
        } catch (error) {
            toast({
                title: t('models.toast.deleteFailedTitle'),
                description: error instanceof Error ? error.message : t('common.unknownError'),
                variant: 'destructive',
            });
        }
    };

    const handleUnload = async (modelName: string) => {
        try {
            await modelStore.unloadModel(modelName);
            toast({
                title: t('models.toast.unloadSuccessTitle'),
                description: t('models.toast.unloadSuccessDesc', { name: modelName }),
            });
        } catch (error) {
            toast({
                title: t('models.toast.unloadFailedTitle'),
                description: error instanceof Error ? error.message : t('common.unknownError'),
                variant: 'destructive',
            });
        }
    };

    const handleLoad = async (modelName: string) => {
        try {
            await modelStore.loadModel(modelName, '10m');
            toast({
                title: t('models.toast.loadSuccessTitle'),
                description: t('models.toast.loadSuccessDesc', { name: modelName }),
            });
        } catch (error) {
            toast({
                title: t('models.toast.loadFailedTitle'),
                description: error instanceof Error ? error.message : t('common.unknownError'),
                variant: 'destructive',
            });
        }
    };

    const handleToggleResident = async (modelName: string, nextResident: boolean) => {
        try {
            await modelStore.setModelResident(modelName, nextResident);
            if (nextResident) {
                await modelStore.loadModel(modelName, -1);
            }
            toast({
                title: nextResident ? t('models.toast.residentEnabledTitle') : t('models.toast.residentDisabledTitle'),
                description: nextResident
                    ? t('models.toast.residentEnabledDesc', { name: modelName })
                    : t('models.toast.residentDisabledDesc', { name: modelName }),
            });
        } catch (error) {
            toast({
                title: t('models.toast.residentFailedTitle'),
                description: error instanceof Error ? error.message : t('common.unknownError'),
                variant: 'destructive',
            });
        }
    };

    const handleOpenLibraryModel = async (model: LibraryModel) => {
        setDownloadDialogModel(model);
        setDownloadDialogOpen(true);
        try {
            setIsLoadingTags(true);
            await modelStore.fetchLibraryTags(model.name, true);
        } finally {
            setIsLoadingTags(false);
        }
    };

    const handleOpenOfficialSearch = () => {
        const query = searchQuery.trim();
        const url = query
            ? `https://ollama.com/search?q=${encodeURIComponent(query)}`
            : 'https://ollama.com/search';
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    const isModelRunning = (modelName: string): boolean => {
        return modelStore.runningModels.some((running) => matchesRunningModel(running, modelName));
    };

    const isModelResident = (modelName: string): boolean => {
        return modelStore.residentModels.some((item) => matchesResidentEntry(modelName, item));
    };

    const downloadedModelSet = useMemo(() => {
        const set = new Set<string>();
        for (const model of modelStore.models) {
            const name = normalizeModelName(model.name || '');
            if (!name) continue;
            set.add(name);
            set.add(baseModelName(name));
        }
        return set;
    }, [modelStore.models]);

    const isModelDownloaded = (fullName: string): boolean => {
        const lower = normalizeModelName(fullName);
        return downloadedModelSet.has(lower);
    };

    const isModelDownloading = (fullName: string): boolean => {
        return downloadTasks.some((task) =>
            (task.status === 'queued' || task.status === 'downloading' || task.status === 'paused')
            && matchesDownloadTask(task.model_name, task.model_version, fullName),
        );
    };

    const allFamilies = Array.from(
        new Set(
            (modelStore.models as OfficialModel[])
                .map((m) => m.details?.family)
                .filter((family): family is string => Boolean(family)),
        ),
    ).sort();

    const allCapabilities = Array.from(
        new Set(
            modelStore.libraryModels
                .flatMap((model) => model.capabilities || [])
                .map((cap) => cap.trim())
                .filter(Boolean),
        ),
    ).sort((a, b) => a.localeCompare(b));

    const query = searchQuery.trim().toLowerCase();
    const libraryQuery = librarySearchQuery.trim().toLowerCase();

    const filterBySearch = (m: { name: string; description?: string; slug?: string }) => {
        if (!query) return true;
        return (
            m.name.toLowerCase().includes(query) ||
            (m.description || '').toLowerCase().includes(query) ||
            (m.slug || '').toLowerCase().includes(query)
        );
    };

    const filterByLibrarySearch = (m: { name: string; description?: string; slug?: string }) => {
        if (!libraryQuery) return true;
        return (
            m.name.toLowerCase().includes(libraryQuery) ||
            (m.description || '').toLowerCase().includes(libraryQuery) ||
            (m.slug || '').toLowerCase().includes(libraryQuery)
        );
    };

    const filterByFamilies = (m: OfficialModel) => {
        if (selectedFamilies.length === 0) return true;
        return selectedFamilies.includes(m.details?.family || '');
    };

    const filterByCapabilities = (m: LibraryModel) => {
        if (selectedCapabilities.length === 0) return true;
        return selectedCapabilities.some((cap) => m.capabilities.includes(cap));
    };

    const filteredDownloaded = (modelStore.models as OfficialModel[])
        .filter(filterBySearch)
        .filter(filterByFamilies);

    const filteredAvailable = modelStore.libraryModels
        .filter(filterBySearch)
        .filter(filterByLibrarySearch)
        .filter(filterByCapabilities)
        .filter((model) => {
            if (!hideDownloadedInLibrary) return true;
            return !isModelDownloaded(model.name) && !isModelDownloaded(`${model.name}:latest`);
        })
        .sort((a, b) => parsePullCount(b.pull_count) - parsePullCount(a.pull_count));

    const currentTags: LibraryModelTag[] = downloadDialogModel
        ? modelStore.libraryTags[downloadDialogModel.name] || []
        : [];

    const tagsToDisplay: LibraryModelTag[] = useMemo(() => {
        if (!downloadDialogModel) return [];
        if (currentTags.length > 0) return currentTags;
        return [
            {
                full_name: downloadDialogModel.name,
                tag: 'latest',
                is_latest: true,
                library_url: downloadDialogModel.library_url,
            },
        ];
    }, [downloadDialogModel, currentTags]);

    const runningCount = modelStore.runningModels.length;
    const downloadedCount = modelStore.models.length;
    const availableCount = modelStore.libraryModels.length;

    return {
        state: {
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
            libraryMeta: modelStore.libraryMeta,
            allFamilies,
            allCapabilities,
            filteredDownloaded,
            filteredAvailable,
            tagsToDisplay,
            runningCount,
            downloadedCount,
            availableCount,
            modelStore,
        },
        actions: {
            setSearchQuery,
            setActiveTab,
            setSelectedFamilies,
            setSelectedCapabilities,
            setHideDownloadedInLibrary,
            setLibrarySearchQuery,
            setShowFilters,
            setDownloadDialogModel,
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
            formatBytes,
        },
    };
}
