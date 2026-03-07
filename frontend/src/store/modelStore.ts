import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { modelsApi, downloadsApi } from '@/services/api';
import { matchesRunningModel } from '@/lib/modelNames';
import type { Model, DownloadTask, LibraryModel, LibraryModelTag } from '@/types';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ModelState {
  models: Model[];
  libraryModels: LibraryModel[];
  libraryTags: Record<string, LibraryModelTag[]>;
  runningModels: string[];
  residentModels: string[];
  autoUnloadAfterResponse: boolean;
  downloadTasks: DownloadTask[];
  isLoading: boolean;
  error: string | null;
  
  // Actions
  fetchModels: () => Promise<void>;
  fetchLibraryModels: (refresh?: boolean) => Promise<void>;
  fetchLibraryTags: (modelName: string, refresh?: boolean) => Promise<LibraryModelTag[]>;
  deleteModel: (name: string) => Promise<void>;
  fetchRunningModels: () => Promise<void>;
  fetchResidencyStatus: () => Promise<void>;
  loadModel: (name: string, keepAlive?: number | string) => Promise<void>;
  unloadModel: (name: string) => Promise<void>;
  setModelResident: (name: string, resident: boolean) => Promise<void>;
  startDownload: (modelName: string) => Promise<void>;
  fetchDownloadTasks: () => Promise<void>;
  cancelDownload: (taskId: string) => Promise<void>;
}

export const useModelStore = create<ModelState>()(
  persist(
    (set, get) => ({
      models: [],
      libraryModels: [],
      libraryTags: {},
      runningModels: [],
      residentModels: [],
      autoUnloadAfterResponse: true,
      downloadTasks: [],
      isLoading: false,
      error: null,

      fetchModels: async () => {
        set({ isLoading: true, error: null });
        try {
          const response = await modelsApi.list();
          set({ models: response.data.models || [], isLoading: false });
        } catch (error) {
          set({ error: 'Failed to fetch models', isLoading: false });
        }
      },

      fetchLibraryModels: async (refresh = false) => {
        const previous = get().libraryModels;
        const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const shouldRefresh = refresh || attempt > 0;
            const response = await modelsApi.listLibrary(shouldRefresh);
            const incoming: LibraryModel[] = response.data.models || [];

            if (incoming.length > 0) {
              set({ libraryModels: incoming, error: null });
              return;
            }
          } catch {
            // retry below
          }

          if (attempt < 2) {
            await sleep(500 * (attempt + 1));
          }
        }

        if (previous.length > 0) {
          // Keep stale data to avoid user-facing "connection failed" flicker.
          set({ libraryModels: previous, error: null });
          return;
        }

        set({ error: 'Failed to fetch library models' });
      },

      fetchLibraryTags: async (modelName: string, refresh = false) => {
        const cached = get().libraryTags[modelName];
        if (!refresh && cached && cached.length > 0) {
          return cached;
        }
        const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const response = await modelsApi.listLibraryTags(modelName, refresh || attempt > 0);
            const tags: LibraryModelTag[] = response.data.tags || [];
            if (tags.length > 0) {
              set((state) => ({
                libraryTags: {
                  ...state.libraryTags,
                  [modelName]: tags,
                },
                error: null,
              }));
              return tags;
            }
          } catch {
            // retry below
          }
          if (attempt < 2) {
            await sleep(400 * (attempt + 1));
          }
        }

        if (cached && cached.length > 0) {
          return cached;
        }

        set({ error: 'Failed to fetch library model tags' });
        return [];
      },

      deleteModel: async (name: string) => {
        try {
          await modelsApi.delete(name);
          await get().fetchModels();
          await get().fetchRunningModels();
        } catch (error) {
          set({ error: 'Failed to delete model' });
          throw error;
        }
      },

      fetchRunningModels: async () => {
        try {
          const response = await modelsApi.listRunning();
          const running = (response.data.models || []).map((m: any) => m.name).filter(Boolean);
          set({ runningModels: running });
        } catch (error) {
          set({ error: 'Failed to fetch running models' });
        }
      },

      fetchResidencyStatus: async () => {
        try {
          const response = await modelsApi.getResidency();
          set({
            residentModels: response.data.resident_models || [],
            autoUnloadAfterResponse: Boolean(response.data.auto_unload_after_response ?? true),
          });
        } catch (error) {
          set({ error: 'Failed to fetch residency status' });
        }
      },

      loadModel: async (name: string, keepAlive: number | string = '10m') => {
        try {
          await modelsApi.load(name, keepAlive);
          await get().fetchRunningModels();
        } catch (error) {
          set({ error: 'Failed to load model' });
          throw error;
        }
      },

      unloadModel: async (name: string) => {
        try {
          await modelsApi.unload(name);
          let unloaded = false;
          for (let attempt = 0; attempt < 6; attempt += 1) {
            const response = await modelsApi.listRunning();
            const running = (response.data.models || []).map((m: any) => m.name).filter(Boolean);
            set({ runningModels: running });

            const stillRunning = running.some((runningName: string) =>
              matchesRunningModel(runningName, name),
            );
            if (!stillRunning) {
              unloaded = true;
              break;
            }
            await sleep(250 * (attempt + 1));
          }

          if (!unloaded) {
            throw new Error(`Model ${name} is still running after unload request`);
          }
        } catch (error) {
          set({ error: 'Failed to unload model' });
          throw error;
        }
      },

      setModelResident: async (name: string, resident: boolean) => {
        try {
          const response = await modelsApi.setResident(name, resident);
          set({
            residentModels: response.data.resident_models || [],
          });
        } catch (error) {
          set({ error: 'Failed to update resident model status' });
          throw error;
        }
      },

      startDownload: async (modelName: string) => {
        try {
          await downloadsApi.start(modelName);
          await get().fetchDownloadTasks();
        } catch (error) {
          set({ error: 'Failed to start download' });
        }
      },

      fetchDownloadTasks: async () => {
        try {
          const response = await downloadsApi.list();
          set({ downloadTasks: response.data.tasks || [] });
        } catch (error) {
          console.error('Failed to fetch download tasks');
        }
      },

      cancelDownload: async (taskId: string) => {
        try {
          await downloadsApi.cancel(taskId);
          await get().fetchDownloadTasks();
        } catch (error) {
          set({ error: 'Failed to cancel download' });
        }
      },
    }),
    {
      name: 'model-store',
      partialize: (state) => ({ downloadTasks: state.downloadTasks }),
    }
  )
);
