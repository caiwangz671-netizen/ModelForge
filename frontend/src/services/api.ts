import axios from 'axios';
import type { ChatAttachment } from '@/types';

export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Models API
export const modelsApi = {
  list: () => api.get('/models'),
  listLibrary: (refresh = false) => api.get('/models/library', { params: { refresh } }),
  listLibraryTags: (name: string, refresh = false) =>
    api.get(`/models/library/${encodeURIComponent(name)}/tags`, { params: { refresh } }),
  listRunning: () => api.get('/models/running'),
  load: (name: string, keepAlive: number | string = '10m') =>
    api.post('/models/load', { model: name, keep_alive: keepAlive }),
  unload: (name: string) => api.post('/models/unload', { model: name }),
  getResidency: () => api.get('/models/residency'),
  setResident: (name: string, resident: boolean) =>
    api.put('/models/residency', { model: name, resident }),
  getInfo: (name: string) => api.get(`/models/${encodeURIComponent(name)}`),
  delete: (name: string) => api.delete(`/models/${encodeURIComponent(name)}`),
};

// Downloads API
export const downloadsApi = {
  list: () => api.get('/downloads/'),
  start: (modelName: string, modelVersion = 'latest') =>
    api.post('/downloads/', { model_name: modelName, model_version: modelVersion }),
  getStatus: (taskId: string) => api.get(`/downloads/${taskId}`),
  cancel: (taskId: string) => api.delete(`/downloads/${taskId}`),
  clearHistory: () => api.delete('/downloads/history'),
};

// Chat API
export const chatApi = {
  listConversations: () => api.get('/chat/conversations'),
  createConversation: (title: string, model: string) =>
    api.post('/chat/conversations', { title, model }),
  getConversation: (id: string) => api.get(`/chat/conversations/${id}`),
  deleteConversation: (id: string) => api.delete(`/chat/conversations/${id}`),
  deleteAllConversations: () => api.delete('/chat/conversations'),
  updateConversationTitle: (id: string, title: string) =>
    api.put(`/chat/conversations/${id}/title`, { title }),
  updateConversationModel: (id: string, model: string) =>
    api.put(`/chat/conversations/${id}/model`, { model }),
  autoGenerateTitle: (messages: { role: string; content: string }[], model: string, conversationId?: string) =>
    api.post('/chat/conversations/auto-title', { messages, model, conversation_id: conversationId }),
  chat: (data: {
    model: string;
    messages: { role: string; content: string }[];
    attachments?: ChatAttachment[];
    system?: string;
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
    max_context_tokens?: number;
    conversation_id?: string;
    think?: boolean | 'low' | 'medium' | 'high';
    remember?: boolean;
    web_search?: boolean;
    persist_user_message?: boolean;
  }, signal?: AbortSignal) => fetch(`${API_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify(data),
  }),
};

// Memory API
export const memoryApi = {
  list: (params?: { type?: string; limit?: number; offset?: number }) =>
    api.get('/memory/', { params }),
  create: (data: { type: string; content: string; tags?: string[]; importance?: number }) =>
    api.post('/memory/', data),
  importFile: (file: File, options?: { tags?: string[]; memory_type?: string; chunk_size?: number; overlap?: number }) => {
    const form = new FormData();
    form.append('file', file);
    form.append('memory_type', options?.memory_type || 'semantic');
    if (options?.tags && options.tags.length > 0) {
      form.append('tags', options.tags.join(','));
    }
    if (typeof options?.chunk_size === 'number') {
      form.append('chunk_size', String(options.chunk_size));
    }
    if (typeof options?.overlap === 'number') {
      form.append('overlap', String(options.overlap));
    }
    return api.post('/memory/import', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  get: (id: string) => api.get(`/memory/${id}`),
  update: (id: string, data: Partial<{ content: string; tags: string[]; importance: number }>) =>
    api.put(`/memory/${id}`, data),
  delete: (id: string) => api.delete(`/memory/${id}`),
  search: (query: string, limit?: number) =>
    api.post('/memory/search', { query, limit }),
  status: () => api.get('/memory/status'),
  embeddingSetup: () => api.get('/memory/embedding-setup'),
};

// System API
export const systemApi = {
  health: () => api.get('/system/health'),
  version: () => api.get('/system/version'),
  hardware: () => api.get<HardwareInfo>('/system/hardware'),
  getSettings: () => api.get('/system/settings'),
  updateSettings: (data: {
    ollama_host?: string;
    memory_enabled?: boolean;
    memory_embedding_model?: string;
    max_output_tokens?: number;
    max_context_tokens?: number;
    auto_unload_after_response?: boolean;
  }) =>
    api.put('/system/settings', data),
  getInstallStatus: () => api.get('/system/install/status'),
  startInstall: () => api.post('/system/install/start'),
};

export const computerUseApi = {
  status: () => api.get('/computer-use/status'),
  listSessions: () => api.get('/computer-use/sessions'),
  createSession: (data: {
    model: string;
    goal: string;
    approval_mode?: 'review_all' | 'hands_free';
    parent_session_id?: string;
    cwd?: string;
    allowed_paths?: string[];
  }) => api.post('/computer-use/sessions', data),
  getSession: (sessionId: string) => api.get(`/computer-use/sessions/${encodeURIComponent(sessionId)}`),
  deleteAllSessions: () => api.delete('/computer-use/sessions'),
  runSession: (sessionId: string) => api.post(`/computer-use/sessions/${encodeURIComponent(sessionId)}/run`),
  approve: (sessionId: string, data: { approval_id: string; edited_input?: Record<string, unknown> }) =>
    api.post(`/computer-use/sessions/${encodeURIComponent(sessionId)}/approve`, data),
  reject: (sessionId: string, data: { approval_id: string; reason?: string }) =>
    api.post(`/computer-use/sessions/${encodeURIComponent(sessionId)}/reject`, data),
  pause: (sessionId: string) => api.post(`/computer-use/sessions/${encodeURIComponent(sessionId)}/pause`),
  resume: (sessionId: string) => api.post(`/computer-use/sessions/${encodeURIComponent(sessionId)}/resume`),
  cancel: (sessionId: string) => api.post(`/computer-use/sessions/${encodeURIComponent(sessionId)}/cancel`),
  requestPermissions: () => api.post('/computer-use/request-permissions'),
};

// Uploads API
export const uploadsApi = {
  upload: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/uploads', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  getMetadata: (id: string) => api.get(`/uploads/${id}`),
  getFileUrl: (id: string) => `${API_BASE_URL}/uploads/${id}/file`,
};

// Hardware info type
export interface HardwareInfo {
  ram_total: number;
  ram_available: number;
  ram_used: number;
  ram_percent: number;
  cpu_cores_logical: number;
  cpu_cores_physical: number;
  cpu_arch: string;
  os: string;
  gpu_name: string | null;
  gpu_vram_bytes: number | null;
  gpu_vram_used: number | null;
}
