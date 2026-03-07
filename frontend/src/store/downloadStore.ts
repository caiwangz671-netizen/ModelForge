import { create } from 'zustand';
import { downloadsApi } from '@/services/api';
import type { DownloadTask } from '@/types';

function toFiniteNumber(value: unknown, fallback = 0): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeDownloadTask(rawTask: Partial<DownloadTask> & Record<string, unknown>): DownloadTask {
  const downloadedSize = Math.max(0, toFiniteNumber(rawTask.downloaded_size));
  let totalSize = Math.max(0, toFiniteNumber(rawTask.total_size));
  const status = typeof rawTask.status === 'string' ? rawTask.status : 'queued';

  if (status === 'completed' && totalSize === 0 && downloadedSize > 0) {
    totalSize = downloadedSize;
  }

  const statusText = typeof rawTask.status_text === 'string' && rawTask.status_text.trim()
    ? rawTask.status_text
    : status;

  return {
    id: String(rawTask.id || ''),
    model_name: String(rawTask.model_name || ''),
    model_version: String(rawTask.model_version || 'latest'),
    status: status as DownloadTask['status'],
    progress: Math.max(0, toFiniteNumber(rawTask.progress)),
    downloaded_size: downloadedSize,
    total_size: totalSize,
    speed: Math.max(0, toFiniteNumber(rawTask.speed)),
    eta: Math.max(0, Math.round(toFiniteNumber(rawTask.eta))),
    status_text: statusText,
    retry_count: Math.max(0, Math.round(toFiniteNumber(rawTask.retry_count))),
    error: typeof rawTask.error === 'string' ? rawTask.error : null,
    created_at: toFiniteNumber(rawTask.created_at, Date.now() / 1000),
    updated_at: toFiniteNumber(rawTask.updated_at, Date.now() / 1000),
  };
}

export interface StartDownloadResult {
  taskId: string;
  duplicate: boolean;
}

interface DownloadState {
  tasks: DownloadTask[];
  isLoading: boolean;
  error: string | null;
  
  // Actions
  fetchTasks: () => Promise<void>;
  startDownload: (modelName: string, modelVersion?: string) => Promise<StartDownloadResult>;
  cancelDownload: (taskId: string) => Promise<void>;
  pollTasks: () => void;
}

export const useDownloadStore = create<DownloadState>()((set, get) => ({
  tasks: [],
  isLoading: false,
  error: null,

  fetchTasks: async () => {
    try {
      const response = await downloadsApi.list();
      const tasks = Array.isArray(response.data.tasks)
        ? response.data.tasks.map((task: Partial<DownloadTask> & Record<string, unknown>) => normalizeDownloadTask(task))
        : [];
      set({ tasks, error: null });
    } catch (error) {
      set({ error: 'Failed to fetch download tasks' });
    }
  },

  startDownload: async (modelName: string, modelVersion = 'latest') => {
    set({ isLoading: true, error: null });
    try {
      const response = await downloadsApi.start(modelName, modelVersion);
      const taskId = String(response.data.id || '');
      const duplicate = Boolean(response.data.duplicate);
      await get().fetchTasks();
      set({ isLoading: false });
      return { taskId, duplicate };
    } catch (error) {
      set({ error: 'Failed to start download', isLoading: false });
      throw error;
    }
  },

  cancelDownload: async (taskId: string) => {
    try {
      await downloadsApi.cancel(taskId);
      await get().fetchTasks();
    } catch (error) {
      set({ error: 'Failed to cancel download' });
    }
  },

  pollTasks: () => {
    // Poll for active downloads
    const interval = setInterval(async () => {
      const { tasks } = get();
      const hasActiveDownloads = tasks.some(
        (t) => t.status === 'downloading' || t.status === 'queued'
      );
      
      if (hasActiveDownloads) {
        await get().fetchTasks();
      }
    }, 2000);

    // Return cleanup function
    return () => clearInterval(interval);
  },
}));
