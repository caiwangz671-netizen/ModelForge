import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { API_BASE_URL, computerUseApi } from '@/services/api';
import type {
  ComputerUseApprovalMode,
  ComputerUseSession,
  ComputerUseSessionListItem,
  ComputerUseStatusPayload,
  ComputerUseStreamEvent,
} from '@/types/computerUse';

function isTerminalStatus(status?: string | null): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object') {
    const maybeAxios = error as {
      response?: { data?: { detail?: string } };
      message?: string;
    };
    if (typeof maybeAxios.response?.data?.detail === 'string' && maybeAxios.response.data.detail.trim()) {
      return maybeAxios.response.data.detail;
    }
    if (typeof maybeAxios.message === 'string' && maybeAxios.message.trim()) {
      return maybeAxios.message;
    }
  }
  return fallback;
}

function toSessionListItem(session: ComputerUseSession): ComputerUseSessionListItem {
  return {
    id: session.id,
    model: session.model,
    goal: session.goal,
    approval_mode: session.approval_mode,
    parent_session_id: session.parent_session_id,
    status: session.status,
    latest_artifact_id: session.latest_artifact_id,
    latest_artifact_url: session.latest_artifact_url,
    error: session.error,
    created_at: session.created_at,
    updated_at: session.updated_at,
    started_at: session.started_at,
    completed_at: session.completed_at,
  };
}

function upsertSessionListItem(
  items: ComputerUseSessionListItem[],
  nextItem: ComputerUseSessionListItem,
): ComputerUseSessionListItem[] {
  return [...items.filter((item) => item.id !== nextItem.id), nextItem].sort(
    (left, right) => (right.updated_at || 0) - (left.updated_at || 0),
  );
}

interface ComputerUseState {
  statusPayload: ComputerUseStatusPayload | null;
  sessions: ComputerUseSessionListItem[];
  currentSession: ComputerUseSession | null;
  activeSessionId: string | null;
  isLoading: boolean;
  isStreaming: boolean;
  error: string | null;
  lastEvent: ComputerUseStreamEvent | null;
  loadStatus: () => Promise<void>;
  loadSessions: () => Promise<void>;
  fetchSession: (sessionId: string) => Promise<void>;
  deleteAllSessions: () => Promise<void>;
  createAndRun: (payload: {
    model: string;
    goal: string;
    approval_mode?: ComputerUseApprovalMode;
    parent_session_id?: string;
    cwd?: string;
    allowed_paths?: string[];
  }) => Promise<void>;
  connectEvents: (sessionId: string) => void;
  reconnectActiveSession: () => Promise<void>;
  selectSession: (sessionId: string) => Promise<void>;
  approve: (approvalId: string, editedInput?: Record<string, unknown>) => Promise<void>;
  reject: (approvalId: string, reason?: string) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  cancel: () => Promise<void>;
  clearSession: () => void;
}

export const useComputerUseStore = create<ComputerUseState>()(
  persist(
    (set, get) => {
      let eventSource: EventSource | null = null;
      let reconnectTimer: number | null = null;
      let reconnectAttempts = 0;
      let reconnectSessionId: string | null = null;
      let manualClose = false;

      const clearReconnectTimer = () => {
        if (reconnectTimer !== null) {
          window.clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
      };

      const closeEventSource = (preserveReconnect = false, isManual = true) => {
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
        manualClose = isManual;
        if (!preserveReconnect) {
          reconnectAttempts = 0;
          reconnectSessionId = null;
          clearReconnectTimer();
        }
      };

      const updateSession = (updater: (session: ComputerUseSession) => ComputerUseSession) => {
        set((state) => ({
          currentSession: state.currentSession ? updater(state.currentSession) : state.currentSession,
        }));
      };

      const scheduleReconnect = (sessionId: string) => {
        if (reconnectTimer !== null || reconnectSessionId !== sessionId) {
          clearReconnectTimer();
        }
        reconnectSessionId = sessionId;
        const delayMs = Math.min(5000, 1000 * (2 ** reconnectAttempts));
        reconnectAttempts += 1;
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = null;
          void (async () => {
            try {
              await get().fetchSession(sessionId);
              const session = get().currentSession;
              if (session && !isTerminalStatus(session.status)) {
                get().connectEvents(sessionId);
              }
            } catch (error) {
              set({ error: getErrorMessage(error, 'Failed to reconnect computer use stream') });
            }
          })();
        }, delayMs);
      };

      return {
        statusPayload: null,
        sessions: [],
        currentSession: null,
        activeSessionId: null,
        isLoading: false,
        isStreaming: false,
        error: null,
        lastEvent: null,

        loadStatus: async () => {
          try {
            const response = await computerUseApi.status();
            set({ statusPayload: response.data, error: null });
          } catch (error) {
            set({ error: getErrorMessage(error, 'Failed to load computer use status') });
          }
        },

        loadSessions: async () => {
          try {
            const response = await computerUseApi.listSessions();
            set({
              sessions: Array.isArray(response.data) ? response.data : [],
              error: null,
            });
          } catch (error) {
            set({ error: getErrorMessage(error, 'Failed to load computer use sessions') });
          }
        },

        fetchSession: async (sessionId: string) => {
          try {
            const response = await computerUseApi.getSession(sessionId);
            const session = response.data as ComputerUseSession;
            set({
              currentSession: session,
              activeSessionId: session.id,
              sessions: upsertSessionListItem(get().sessions, toSessionListItem(session)),
              error: null,
            });
          } catch (error) {
            const message = getErrorMessage(error, 'Failed to load computer use session');
            set({
              currentSession: null,
              activeSessionId: null,
              isStreaming: false,
              error: message,
            });
            closeEventSource();
            throw error;
          }
        },

        deleteAllSessions: async () => {
          try {
            closeEventSource();
            await computerUseApi.deleteAllSessions();
            set({
              sessions: [],
              currentSession: null,
              activeSessionId: null,
              isStreaming: false,
              error: null,
              lastEvent: null,
            });
          } catch (error) {
            set({ error: getErrorMessage(error, 'Failed to delete computer use history') });
            throw error;
          }
        },

        createAndRun: async (payload) => {
          set({ isLoading: true, error: null });
          const existingSession = get().currentSession;
          if (existingSession && !isTerminalStatus(existingSession.status)) {
            set({
              isLoading: false,
              error: 'Another computer use session is still active. Stop it before starting a new one.',
            });
            return;
          }
          try {
            closeEventSource();
            const created = await computerUseApi.createSession(payload);
            const session = created.data as ComputerUseSession;
            set({
              currentSession: session,
              activeSessionId: session.id,
              sessions: upsertSessionListItem(get().sessions, toSessionListItem(session)),
            });
            await computerUseApi.runSession(session.id);
            get().connectEvents(session.id);
            await get().fetchSession(session.id);
          } catch (error) {
            set({ error: getErrorMessage(error, 'Failed to start session') });
          } finally {
            set({ isLoading: false });
          }
        },

        connectEvents: (sessionId: string) => {
          closeEventSource(true, true);
          clearReconnectTimer();
          reconnectSessionId = sessionId;
          manualClose = false;
          const streamUrl = `${API_BASE_URL}/computer-use/sessions/${encodeURIComponent(sessionId)}/events`;
          eventSource = new EventSource(streamUrl);
          set({ isStreaming: true, activeSessionId: sessionId });

          eventSource.onopen = () => {
            reconnectAttempts = 0;
            set({ error: null });
          };

          eventSource.onmessage = (messageEvent) => {
            try {
              const payload = JSON.parse(messageEvent.data) as ComputerUseStreamEvent;
              set({ lastEvent: payload });

              if (payload.type === 'session_state' && payload.session) {
                set({
                  currentSession: payload.session,
                  activeSessionId: payload.session.id,
                  sessions: upsertSessionListItem(get().sessions, toSessionListItem(payload.session)),
                });
                if (isTerminalStatus(payload.session.status)) {
                  set({ isStreaming: false });
                  closeEventSource();
                }
                return;
              }

              if (payload.type === 'thinking_delta' && payload.delta) {
                updateSession((session) => ({
                  ...session,
                  thinking_text: `${session.thinking_text || ''}${payload.delta || ''}`,
                }));
                return;
              }

              if (payload.type === 'assistant_delta' && payload.delta) {
                updateSession((session) => ({
                  ...session,
                  assistant_text: `${session.assistant_text || ''}${payload.delta || ''}`,
                }));
                return;
              }

              if (payload.type === 'action_started' && payload.action) {
                const action = payload.action;
                updateSession((session) => ({
                  ...session,
                  actions: [...session.actions.filter((item) => item.id !== action.id), action],
                }));
                return;
              }

              if (payload.type === 'action_completed' && payload.action) {
                const action = payload.action;
                updateSession((session) => ({
                  ...session,
                  actions: [...session.actions.filter((item) => item.id !== action.id), action],
                }));
                void get().fetchSession(sessionId);
                return;
              }

              if (payload.type === 'approval_required') {
                void get().fetchSession(sessionId);
                return;
              }

              if (payload.type === 'approval_resolved') {
                void get().fetchSession(sessionId);
                return;
              }

              if (payload.type === 'done') {
                set({ isStreaming: false });
                closeEventSource();
                void get().fetchSession(sessionId);
                return;
              }

              if (payload.type === 'error') {
                set({ error: payload.error || 'Computer Use failed', isStreaming: false });
                closeEventSource();
                void get().fetchSession(sessionId).catch(() => undefined);
              }
            } catch (error) {
              set({ error: getErrorMessage(error, 'Failed to parse event stream') });
            }
          };

          eventSource.onerror = () => {
            set({ isStreaming: false });
            const currentSession = get().currentSession;
            const shouldReconnect = !manualClose;
            closeEventSource(true, false);
            if (!shouldReconnect) return;
            if (currentSession && isTerminalStatus(currentSession.status)) {
              return;
            }
            scheduleReconnect(sessionId);
          };
        },

        reconnectActiveSession: async () => {
          const sessionId = get().activeSessionId;
          await get().loadSessions();
          if (!sessionId) return;
          try {
            await get().fetchSession(sessionId);
            const session = get().currentSession;
            if (session && !isTerminalStatus(session.status)) {
              get().connectEvents(session.id);
            }
          } catch {
            // fetchSession already normalized store state and error
          }
        },

        selectSession: async (sessionId: string) => {
          await get().fetchSession(sessionId);
          const session = get().currentSession;
          if (session && !isTerminalStatus(session.status)) {
            get().connectEvents(session.id);
            return;
          }
          closeEventSource();
          set({ isStreaming: false });
        },

        approve: async (approvalId, editedInput) => {
          const sessionId = get().currentSession?.id;
          if (!sessionId) return;
          try {
            await computerUseApi.approve(sessionId, {
              approval_id: approvalId,
              edited_input: editedInput,
            });
            await get().fetchSession(sessionId);
            get().connectEvents(sessionId);
          } catch (error) {
            set({ error: getErrorMessage(error, 'Failed to approve action') });
          }
        },

        reject: async (approvalId, reason) => {
          const sessionId = get().currentSession?.id;
          if (!sessionId) return;
          try {
            await computerUseApi.reject(sessionId, {
              approval_id: approvalId,
              reason,
            });
            await get().fetchSession(sessionId);
            get().connectEvents(sessionId);
          } catch (error) {
            set({ error: getErrorMessage(error, 'Failed to reject action') });
          }
        },

        pause: async () => {
          const sessionId = get().currentSession?.id;
          if (!sessionId) return;
          try {
            await computerUseApi.pause(sessionId);
            await get().fetchSession(sessionId);
          } catch (error) {
            set({ error: getErrorMessage(error, 'Failed to pause session') });
          }
        },

        resume: async () => {
          const sessionId = get().currentSession?.id;
          if (!sessionId) return;
          try {
            await computerUseApi.resume(sessionId);
            await get().fetchSession(sessionId);
            get().connectEvents(sessionId);
          } catch (error) {
            set({ error: getErrorMessage(error, 'Failed to resume session') });
          }
        },

        cancel: async () => {
          const sessionId = get().currentSession?.id;
          if (!sessionId) return;
          try {
            await computerUseApi.cancel(sessionId);
            await get().fetchSession(sessionId);
            closeEventSource();
            set({ isStreaming: false });
          } catch (error) {
            set({ error: getErrorMessage(error, 'Failed to cancel session') });
          }
        },

        clearSession: () => {
          closeEventSource();
          set({
            currentSession: null,
            activeSessionId: null,
            isStreaming: false,
            error: null,
            lastEvent: null,
          });
        },
      };
    },
    {
      name: 'computer-use-store',
      partialize: (state) => ({
        activeSessionId: state.activeSessionId,
      }),
    },
  ),
);
