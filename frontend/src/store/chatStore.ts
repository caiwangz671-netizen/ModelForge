import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { chatApi } from '@/services/api';
import { buildAttachmentDisplayContent } from '@/lib/chatAttachments';
import type { ChatAttachment, Conversation, Message, RagReference, ToolCall, ToolCallType, UsageStats } from '@/types';

function normalizeToolType(rawType: unknown): ToolCallType {
  const value = String(rawType ?? '').trim();
  if (value === 'browser' || value === 'python' || value === 'calculator' || value === 'terminal') {
    return value;
  }
  return 'web_search';
}

function normalizeToolCall(raw: unknown): ToolCall | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = String(r.id ?? '').trim();
  if (!id) return null;

  const statusRaw = String(r.status ?? '').trim();
  const status: ToolCall['status'] =
    statusRaw === 'pending' || statusRaw === 'running' || statusRaw === 'completed' || statusRaw === 'error'
      ? statusRaw
      : 'pending';

  const inputValue = r.input;
  const input = (inputValue && typeof inputValue === 'object' && !Array.isArray(inputValue))
    ? inputValue as Record<string, unknown>
    : {};

  return {
    id,
    type: normalizeToolType(r.type),
    name: String(r.name ?? 'web_search'),
    input,
    output: typeof r.output === 'string' ? r.output : undefined,
    status,
    started_at: typeof r.started_at === 'string' ? r.started_at : undefined,
    completed_at: typeof r.completed_at === 'string' ? r.completed_at : undefined,
  };
}

function normalizeMessage(raw: unknown): Message | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const role = r.role === 'system' || r.role === 'user' || r.role === 'assistant' ? r.role : null;
  if (!role) return null;
  const content = typeof r.content === 'string' ? r.content : String(r.content ?? '');
  const ragReferences = Array.isArray(r.rag_references)
    ? (r.rag_references as unknown[])
      .filter((item): item is RagReference => Boolean(item) && typeof item === 'object')
    : [];
  const toolCalls = Array.isArray(r.tool_calls)
    ? (r.tool_calls as unknown[])
      .map((item) => normalizeToolCall(item))
      .filter((item: ToolCall | null): item is ToolCall => Boolean(item))
    : [];
  const attachments = Array.isArray(r.attachments)
    ? (r.attachments as unknown[])
      .filter((item): item is ChatAttachment => Boolean(item) && typeof item === 'object')
    : undefined;
  return {
    id: r.id ? String(r.id) : undefined,
    role,
    content,
    thinking: typeof r.thinking === 'string' ? r.thinking : undefined,
    attachments,
    tool_calls: toolCalls,
    rag_references: ragReferences,
    created_at: typeof r.created_at === 'number' ? r.created_at : undefined,
  };
}

function mergeAttachmentsIntoMessages(
  targetMessages: Message[],
  sourceMessages: Message[],
): Message[] {
  if (!targetMessages.length || !sourceMessages.length) return targetMessages;

  const sourceUsersWithAttachments = sourceMessages
    .filter((message) => message.role === 'user' && Array.isArray(message.attachments) && message.attachments.length > 0);
  if (sourceUsersWithAttachments.length === 0) {
    return targetMessages;
  }

  const merged = [...targetMessages];
  let sourcePointer = sourceUsersWithAttachments.length - 1;

  for (let index = merged.length - 1; index >= 0 && sourcePointer >= 0; index -= 1) {
    if (merged[index].role !== 'user') continue;
    const attachments = sourceUsersWithAttachments[sourcePointer]?.attachments;
    if (!attachments || attachments.length === 0) continue;
    merged[index] = {
      ...merged[index],
      attachments,
    };
    sourcePointer -= 1;
  }

  return merged;
}

function normalizeConversation(raw: unknown): Conversation | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = String(r.id ?? '').trim();
  if (!id) return null;

  const titleRaw = typeof r.title === 'string' ? r.title : String(r.title ?? '');
  const modelRaw = typeof r.model === 'string' ? r.model : String(r.model ?? '');

  const messages = Array.isArray(r.messages)
    ? (r.messages as unknown[])
      .map((item) => normalizeMessage(item))
      .filter((m: Message | null): m is Message => Boolean(m))
    : undefined;

  return {
    id,
    title: titleRaw.trim() || '新对话',
    model: modelRaw.trim(),
    created_at: typeof r.created_at === 'number' ? r.created_at : Date.now() / 1000,
    updated_at: typeof r.updated_at === 'number' ? r.updated_at : Date.now() / 1000,
    messages,
  };
}

function normalizeConversationList(rawList: unknown): Conversation[] {
  if (!Array.isArray(rawList)) return [];
  return (rawList as unknown[])
    .map((item) => normalizeConversation(item))
    .filter((c: Conversation | null): c is Conversation => Boolean(c));
}

const PENDING_GENERATION_STORAGE_KEY = 'chat:pendingGeneration';

type PendingGenerationPayload = {
  conversation_id: string;
  model: string;
  started_at: number;
};

interface ChatState {
  conversations: Conversation[];
  currentConversation: Conversation | null;
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  streamingMessage: string;
  streamingThinking: string;
  streamingTools: ToolCall[];
  isStreaming: boolean;

  // Actions
  fetchConversations: () => Promise<void>;
  createConversation: (title: string, model: string) => Promise<string>;
  loadConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  deleteAllConversations: () => Promise<void>;
  sendMessage: (content: string, model: string, options?: {
    system?: string;
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
    max_context_tokens?: number;
    think?: boolean | 'low' | 'medium' | 'high';
    remember?: boolean;
    web_search?: boolean;
    persist_user_message?: boolean;
    attachments?: ChatAttachment[];
  }) => Promise<void>;
  stopStreaming: () => Promise<void>;
  clearStreaming: () => void;
  restoreCurrentConversation: () => Promise<void>;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => {
      let streamAbortController: AbortController | null = null;

      const readPendingGeneration = (): PendingGenerationPayload | null => {
        if (typeof window === 'undefined') return null;
        try {
          const raw = window.sessionStorage.getItem(PENDING_GENERATION_STORAGE_KEY);
          if (!raw) return null;
          const parsed = JSON.parse(raw) as Partial<PendingGenerationPayload>;
          const conversationId = String(parsed.conversation_id || '').trim();
          const model = String(parsed.model || '').trim();
          const startedAt = Number(parsed.started_at || 0);
          if (!conversationId || !model || !Number.isFinite(startedAt)) return null;
          return {
            conversation_id: conversationId,
            model,
            started_at: startedAt,
          };
        } catch {
          return null;
        }
      };

      const writePendingGeneration = (payload: PendingGenerationPayload) => {
        if (typeof window === 'undefined') return;
        window.sessionStorage.setItem(PENDING_GENERATION_STORAGE_KEY, JSON.stringify(payload));
      };

      const clearPendingGeneration = () => {
        if (typeof window === 'undefined') return;
        window.sessionStorage.removeItem(PENDING_GENERATION_STORAGE_KEY);
      };

      return ({
      conversations: [],
      currentConversation: null,
      messages: [],
      isLoading: false,
      error: null,
      streamingMessage: '',
      streamingThinking: '',
      streamingTools: [],
      isStreaming: false,

      fetchConversations: async () => {
        try {
          const response = await chatApi.listConversations();
          const normalized = normalizeConversationList(response.data.conversations || []);
          set((state) => {
            const currentId = state.currentConversation?.id;
            const nextCurrent = currentId ? normalized.find((c) => c.id === currentId) || null : null;
            return {
              conversations: normalized,
              currentConversation: nextCurrent ?? state.currentConversation,
            };
          });
        } catch {
          set({ error: 'Failed to fetch conversations' });
        }
      },

      createConversation: async (title: string, model: string) => {
        try {
          const response = await chatApi.createConversation(title, model);
          const conversation = normalizeConversation(response.data);
          if (!conversation) {
            throw new Error('Invalid conversation payload');
          }
          set((state) => ({
            conversations: [conversation, ...state.conversations],
            currentConversation: conversation,
            messages: [],
          }));
          return conversation.id;
        } catch (error) {
          set({ error: 'Failed to create conversation' });
          throw error;
        }
      },

      loadConversation: async (id: string) => {
        set({ isLoading: true });
        try {
          const response = await chatApi.getConversation(id);
          const conversation = normalizeConversation(response.data);
          if (!conversation) {
            throw new Error('Invalid conversation payload');
          }
          set({
            currentConversation: conversation,
            messages: conversation.messages || [],
            isLoading: false,
          });
        } catch {
          set({ error: 'Failed to load conversation', isLoading: false });
        }
      },

      // Restore current conversation after page refresh
      restoreCurrentConversation: async () => {
        const { currentConversation, conversations } = get();

        // If we have a current conversation ID but no messages, reload it
        if (currentConversation?.id) {
          try {
            set({ isLoading: true });
            const response = await chatApi.getConversation(currentConversation.id);
            const conversation = normalizeConversation(response.data);
            if (!conversation) {
              throw new Error('Invalid conversation payload');
            }
            set({
              currentConversation: conversation,
              messages: conversation.messages || [],
              isLoading: false,
            });

            const pending = readPendingGeneration();
            const lastMessage = (conversation.messages || [])[conversation.messages?.length ? conversation.messages.length - 1 : -1];
            if (
              pending
              && pending.conversation_id === conversation.id
              && !get().isStreaming
              && lastMessage?.role === 'user'
            ) {
              await get().sendMessage(lastMessage.content, pending.model, {
                persist_user_message: false,
                remember: false,
              });
            } else if (pending && pending.conversation_id === conversation.id && lastMessage?.role !== 'user') {
              clearPendingGeneration();
            }
          } catch {
            // If failed to load (e.g., conversation was deleted), clear it
            set({
              currentConversation: null,
              messages: [],
              isLoading: false
            });
          }
        } else if (conversations.length > 0 && !currentConversation) {
          // If no current conversation but we have conversations, load the most recent one
          const mostRecent = conversations[0];
          await get().loadConversation(mostRecent.id);

          const pending = readPendingGeneration();
          if (pending && pending.conversation_id === mostRecent.id) {
            const state = get();
            const lastMessage = state.messages[state.messages.length - 1];
            if (lastMessage?.role === 'user' && !state.isStreaming) {
              await get().sendMessage(lastMessage.content, pending.model, {
                persist_user_message: false,
                remember: false,
              });
            } else if (lastMessage?.role !== 'user') {
              clearPendingGeneration();
            }
          }
        }
      },

      deleteConversation: async (id: string) => {
        if (!id) return;
        try {
          await chatApi.deleteConversation(id);
          const pending = readPendingGeneration();
          if (pending?.conversation_id === id) {
            clearPendingGeneration();
          }
          set((state) => ({
            conversations: state.conversations.filter((c) => c.id !== id),
            currentConversation: state.currentConversation?.id === id ? null : state.currentConversation,
            messages: state.currentConversation?.id === id ? [] : state.messages,
          }));
        } catch (error) {
          set({ error: 'Failed to delete conversation' });
          throw error;
        }
      },

      deleteAllConversations: async () => {
        try {
          if (streamAbortController) {
            streamAbortController.abort();
            streamAbortController = null;
          }
          clearPendingGeneration();
          await chatApi.deleteAllConversations();
          set({
            conversations: [],
            currentConversation: null,
            messages: [],
            isStreaming: false,
            streamingMessage: '',
            streamingThinking: '',
            streamingTools: [],
            error: null,
          });
        } catch (error) {
          set({ error: 'Failed to delete all conversations' });
          throw error;
        }
      },

      sendMessage: async (content: string, model: string, options = {}) => {
        const { currentConversation, messages } = get();
        const shouldPersistUserMessage = options.persist_user_message !== false;
        const attachments = Array.isArray(options.attachments) ? options.attachments : [];
        const userMessageContent = buildAttachmentDisplayContent(content, attachments);
        const userMessage: Message = {
          role: 'user',
          content: userMessageContent,
          attachments: attachments.length > 0 ? attachments : undefined,
        };
        const nextMessages = shouldPersistUserMessage ? [...messages, userMessage] : [...messages];
        const lastMessage = nextMessages[nextMessages.length - 1];
        const needsVirtualUserForApi = (
          !shouldPersistUserMessage
          && (
            !lastMessage
            || lastMessage.role !== 'user'
            || lastMessage.content.trim() !== content.trim()
          )
        );
        const apiSourceMessages = needsVirtualUserForApi
          ? [...nextMessages, userMessage]
          : nextMessages;
        const conversationId = currentConversation?.id || '';

        set({
          messages: nextMessages,
          isStreaming: true,
          streamingMessage: '',
          streamingThinking: '',
          streamingTools: [],
          error: null,
        });

        if (conversationId) {
          writePendingGeneration({
            conversation_id: conversationId,
            model,
            started_at: Date.now(),
          });
        }

        try {
          const apiMessages = apiSourceMessages.map((m) => ({ role: m.role, content: m.content }));

          if (streamAbortController) {
            streamAbortController.abort();
          }
          streamAbortController = new AbortController();

          const response = await chatApi.chat({
            model,
            messages: apiMessages,
            conversation_id: currentConversation?.id,
            ...options,
            attachments,
          }, streamAbortController.signal);

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || `Request failed with status ${response.status}`);
          }

          if (!response.body) {
            throw new Error('No response body');
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let assistantContent = '';
          let thinkingContent = '';
          let buffer = '';
          let doneReceived = false;
          let finalized = false;
          let resolvedConversationId = currentConversation?.id || '';
          let ragReferences: RagReference[] = [];
          let toolCalls: ToolCall[] = [];
          let usageStats: UsageStats | undefined;

          let rafPending = false;
          let latestMessage = '';
          let latestThinking = '';

          function scheduleStreamingFlush() {
            if (rafPending) return;
            rafPending = true;
            requestAnimationFrame(() => {
              rafPending = false;
              if (finalized) return;
              set({
                streamingMessage: latestMessage,
                streamingThinking: latestThinking,
              });
            });
          }

          const finalizeAssistantMessage = () => {
            if (finalized) return;
            finalized = true;
            streamAbortController = null;
            clearPendingGeneration();

            if (assistantContent || thinkingContent || toolCalls.length > 0) {
              const assistantMessage: Message = {
                role: 'assistant',
                content: assistantContent,
                thinking: thinkingContent || undefined,
                tool_calls: toolCalls,
                rag_references: ragReferences,
                usage_stats: usageStats,
              };
              set((state) => ({
                messages: [...state.messages, assistantMessage],
                isStreaming: false,
                streamingMessage: '',
                streamingThinking: '',
                streamingTools: [],
              }));
            } else {
              set({
                isStreaming: false,
                streamingMessage: '',
                streamingThinking: '',
                streamingTools: [],
              });
            }
          };

          const processSseEvent = (eventText: string) => {
            const dataLines = eventText
              .split('\n')
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trimStart());

            if (dataLines.length === 0) return;
            const payload = dataLines.join('\n');
            if (!payload) return;

            const data = JSON.parse(payload);
            if (data.error) throw new Error(data.error);

            if (typeof data.conversation_id === 'string' && data.conversation_id.trim()) {
              resolvedConversationId = data.conversation_id.trim();
              writePendingGeneration({
                conversation_id: resolvedConversationId,
                model,
                started_at: Date.now(),
              });
            }

            if (data.tool_event && typeof data.tool_event === 'object') {
              const normalizedEvent = normalizeToolCall(data.tool_event);
              if (normalizedEvent) {
                set((state) => {
                  const existing = state.streamingTools;
                  const idx = existing.findIndex((item) => item.id === normalizedEvent.id);
                  const merged = idx >= 0
                    ? existing.map((item, i) => (i === idx ? { ...item, ...normalizedEvent } : item))
                    : [...existing, normalizedEvent];
                  return { streamingTools: merged };
                });
              }
            }

            if (data.thinking) {
              thinkingContent += data.thinking;
              latestThinking = thinkingContent;
              scheduleStreamingFlush();
            }

            if (data.content) {
              assistantContent += data.content;
              latestMessage = assistantContent;
              scheduleStreamingFlush();
            }

            if (typeof data.final_content === 'string') {
              assistantContent = data.final_content;
              latestMessage = assistantContent;
              scheduleStreamingFlush();
            }

            if (typeof data.final_thinking === 'string') {
              thinkingContent = data.final_thinking;
              latestThinking = thinkingContent;
              scheduleStreamingFlush();
            }

            if (Array.isArray(data.rag_references)) {
              ragReferences = data.rag_references
                .filter((item: unknown): item is RagReference => Boolean(item) && typeof item === 'object');
            }

            if (Array.isArray(data.tool_calls)) {
              toolCalls = data.tool_calls
                .map((item: unknown) => normalizeToolCall(item))
                .filter((item: ToolCall | null): item is ToolCall => Boolean(item));
            }

            if (data.usage_stats && typeof data.usage_stats === 'object') {
              usageStats = data.usage_stats as UsageStats;
            }

            if (data.done) {
              doneReceived = true;
              finalizeAssistantMessage();
            }
          };

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            while (true) {
              const eventEnd = buffer.indexOf('\n\n');
              if (eventEnd === -1) break;
              const eventText = buffer.slice(0, eventEnd);
              buffer = buffer.slice(eventEnd + 2);
              if (eventText.trim().length > 0) {
                processSseEvent(eventText);
              }
            }
          }

          buffer += decoder.decode();
          if (buffer.trim().length > 0) {
            processSseEvent(buffer);
          }

          if (!doneReceived) {
            finalizeAssistantMessage();
          }

          await get().fetchConversations();

          if (resolvedConversationId) {
            try {
              const latest = await chatApi.getConversation(resolvedConversationId);
              const normalized = normalizeConversation(latest.data);
              if (normalized) {
                const mergedMessages = mergeAttachmentsIntoMessages(
                  normalized.messages || [],
                  nextMessages,
                );
                // DB doesn't store usage_stats — carry it over from the in-memory
                // assistant message so the verbose stats row keeps showing.
                if (usageStats) {
                  const lastAssistantIdx = mergedMessages.map((m) => m.role).lastIndexOf('assistant');
                  if (lastAssistantIdx >= 0) {
                    mergedMessages[lastAssistantIdx] = {
                      ...mergedMessages[lastAssistantIdx],
                      usage_stats: usageStats,
                    };
                  }
                }
                set((state) => ({
                  currentConversation: normalized,
                  messages: normalized.messages && normalized.messages.length > 0
                    ? mergedMessages
                    : state.messages,
                }));
                if (normalized.messages && normalized.messages.length === 2 && !get().error) {
                  chatApi.autoGenerateTitle(
                    normalized.messages.map(m => ({ role: m.role, content: m.content })),
                    model,
                    resolvedConversationId,
                  ).then(() => {
                    get().fetchConversations();
                  }).catch(console.error);
                }
              }
            } catch {
              // Keep local optimistic state when sync fails.
            }
          }
        } catch (error) {
          const aborted = (
            (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError')
            || (error instanceof Error && /abort|aborted/i.test(error.message))
          );

          streamAbortController = null;
          clearPendingGeneration();

          if (aborted) {
            set({
              isStreaming: false,
              streamingMessage: '',
              streamingThinking: '',
              streamingTools: [],
            });
            return;
          }

          set({
            error: error instanceof Error ? error.message : 'Failed to send message',
            isStreaming: false,
            streamingMessage: '',
            streamingThinking: '',
            streamingTools: [],
          });
        }
      },

      stopStreaming: async () => {
        if (streamAbortController) {
          streamAbortController.abort();
          streamAbortController = null;
        }
        clearPendingGeneration();
        set({
          isStreaming: false,
          streamingMessage: '',
          streamingThinking: '',
          streamingTools: [],
        });
      },

      clearStreaming: () => {
        if (streamAbortController) {
          streamAbortController.abort();
          streamAbortController = null;
        }
        clearPendingGeneration();
        set({ isStreaming: false, streamingMessage: '', streamingThinking: '', streamingTools: [] });
      },
      });
    },
    {
      name: 'chat-store',
      merge: (persistedState, currentState) => {
        const persisted = (persistedState || {}) as Partial<ChatState>;
        return {
          ...currentState,
          ...persisted,
          conversations: normalizeConversationList(persisted.conversations),
          currentConversation: normalizeConversation(persisted.currentConversation),
        } as ChatState;
      },
      partialize: (state) => ({
        conversations: normalizeConversationList(state.conversations),
        currentConversation: normalizeConversation(state.currentConversation),
        // Don't persist messages, they will be reloaded from backend
      }),
    }
  )
);
