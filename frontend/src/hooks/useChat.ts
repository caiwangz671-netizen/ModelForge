import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChatStore } from '@/store/chatStore';
import { useModelStore } from '@/store/modelStore';
import { chatApi, memoryApi } from '@/services/api';
import { toast } from '@/components/ui/use-toast';
import type { Message } from '@/types';
import type { OfficialModel, OfficialModelDetails } from '@/pages/Chat';
import { useTranslation } from 'react-i18next';

const PROMPT_COMPLETION_TEMPLATE_KEYS = [
    'chat.promptTemplates.conclusionFirst',
    'chat.promptTemplates.runnableExample',
    'chat.promptTemplates.compareTable',
    'chat.promptTemplates.reproSteps',
    'chat.promptTemplates.threeOptions',
    'chat.promptTemplates.shortAnswer',
    'chat.promptTemplates.chineseWithEnglishTerms',
];
const PREFERRED_MODEL_STORAGE_KEY = 'chat:preferredModel';

interface ExtendedMessage extends Message {
    thinking?: string;
}

export function useChat() {
    const chatStore = useChatStore();
    const modelStore = useModelStore();
    const { t } = useTranslation();

    const {
        conversations,
        currentConversation,
        messages,
        isStreaming,
        streamingThinking,
        fetchConversations,
        createConversation,
        loadConversation,
        deleteConversation,
        deleteAllConversations,
        sendMessage,
        stopStreaming,
        restoreCurrentConversation,
    } = chatStore;

    const { models, fetchModels } = modelStore;

    const isChatLlmModel = (model: OfficialModel): boolean => {
        const nameLower = (model.name || '').toLowerCase();
        const familyLower = (model.details?.family || '').toLowerCase();
        if (nameLower.includes('ocr') || familyLower.includes('ocr')) return false;

        const caps = new Set((model.ollama_capabilities || []).map((c) => c.toLowerCase()));
        if (caps.size > 0) {
            if (!caps.has('completion')) return false;
            if (caps.has('embedding') || caps.has('embeddings')) return false;
        }

        if (model.capabilities?.supports_embedding) return false;
        if (nameLower.includes('embed') || familyLower.includes('embed')) return false;
        return true;
    };

    const llmModels = useMemo(
        () => (models as OfficialModel[]).filter((m) => isChatLlmModel(m)),
        [models],
    );

    const llmModelNames = useMemo(
        () => new Set(llmModels.map((m) => m.name)),
        [llmModels],
    );

    const [inputMessage, setInputMessage] = useState('');
    const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);
    const [isCreatingConversation, setIsCreatingConversation] = useState(false);
    const [editingTitle, setEditingTitle] = useState<string | null>(null);
    const [editTitleValue, setEditTitleValue] = useState('');
    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const [isPromptPanelOpen, setIsPromptPanelOpen] = useState(false);
    const [selectedPromptIndex, setSelectedPromptIndex] = useState(0);
    const [rememberThisMessage, setRememberThisMessage] = useState(false);
    const [savingMemoryIndex, setSavingMemoryIndex] = useState<number | null>(null);
    const [isSwitchingModel, setIsSwitchingModel] = useState(false);
    const [gptOssThinkingLevel, setGptOssThinkingLevel] = useState<'low' | 'medium' | 'high'>('medium');
    const [thinkingEnabledByModel, setThinkingEnabledByModel] = useState<Record<string, boolean>>({});
    const [webSearchEnabled, setWebSearchEnabled] = useState<boolean>(() => {
        if (typeof window === 'undefined') return false;
        return window.localStorage.getItem('chat:webSearchEnabled') === 'true';
    });
    const [preferredModel, setPreferredModel] = useState<string>(() => {
        if (typeof window === 'undefined') return '';
        return window.localStorage.getItem(PREFERRED_MODEL_STORAGE_KEY) || '';
    });
    const promptCompletionTemplates = useMemo(
        () => PROMPT_COMPLETION_TEMPLATE_KEYS.map((key) => t(key)),
        [t],
    );

    useEffect(() => {
        const init = async () => {
            await fetchConversations();
            await fetchModels();
            await restoreCurrentConversation();
        };
        init();
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem('chat:webSearchEnabled', String(webSearchEnabled));
    }, [webSearchEnabled]);

    const persistPreferredModel = useCallback((modelName: string) => {
        const normalized = (modelName || '').trim();
        if (!normalized) return;
        setPreferredModel(normalized);
        if (typeof window !== 'undefined') {
            window.localStorage.setItem(PREFERRED_MODEL_STORAGE_KEY, normalized);
        }
    }, []);

    useEffect(() => {
        const modelName = (currentConversation?.model || '').trim();
        if (!modelName) return;
        if (!llmModelNames.has(modelName)) return;
        if (modelName === preferredModel) return;
        persistPreferredModel(modelName);
    }, [currentConversation?.model, llmModelNames, preferredModel, persistPreferredModel]);

    useEffect(() => {
        if (!preferredModel) return;
        if (llmModelNames.has(preferredModel)) return;
        const fallback = llmModels[0]?.name || '';
        if (!fallback) return;
        persistPreferredModel(fallback);
    }, [preferredModel, llmModelNames, llmModels, persistPreferredModel]);

    const userPromptHistory = useMemo(() => {
        const seen = new Set<string>();
        const prompts: string[] = [];

        for (let i = messages.length - 1; i >= 0; i -= 1) {
            const msg = messages[i];
            if (msg.role !== 'user') continue;
            const text = msg.content.trim();
            if (!text || text.length < 6) continue;
            if (seen.has(text)) continue;
            seen.add(text);
            prompts.push(text);
            if (prompts.length >= 20) break;
        }
        return prompts;
    }, [messages]);

    const promptSuggestions = useMemo(() => {
        const query = inputMessage.trim().toLowerCase();
        const merged = [...userPromptHistory, ...promptCompletionTemplates];
        const deduped: string[] = [];
        const seen = new Set<string>();
        for (const item of merged) {
            const key = item.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push(item);
        }

        if (!query) {
            return deduped.slice(0, 6);
        }

        return deduped
            .filter((item) => {
                const lower = item.toLowerCase();
                return lower.includes(query) && lower !== query;
            })
            .slice(0, 6);
    }, [inputMessage, userPromptHistory, promptCompletionTemplates]);

    useEffect(() => {
        if (isStreaming) {
            setIsPromptPanelOpen(false);
            return;
        }

        const hasInput = inputMessage.trim().length > 0;
        const hasSuggestions = promptSuggestions.length > 0;
        const shouldOpen = hasInput && hasSuggestions;
        setIsPromptPanelOpen(shouldOpen);

        if (shouldOpen) {
            setSelectedPromptIndex(0);
        }
    }, [inputMessage, isStreaming, promptSuggestions]);

    const getCurrentModelDetails = (): OfficialModelDetails | null => {
        if (!currentConversation) return null;
        const model = (models as OfficialModel[]).find(m => m.name === currentConversation.model);
        return model?.details || null;
    };

    const isReasoningModel = (modelName: string): boolean => {
        const model = (models as OfficialModel[]).find((m) => m.name === modelName);
        if (typeof model?.capabilities?.supports_reasoning === 'boolean') {
            return model.capabilities.supports_reasoning;
        }
        if (currentConversation?.model === modelName) {
            if (streamingThinking.trim().length > 0) return true;
            if ((messages as ExtendedMessage[]).some((m) => Boolean(m.thinking))) return true;
        }
        return false;
    };

    const isGptOssModel = (modelName: string): boolean => modelName.toLowerCase().replace('-', '').includes('gptoss');

    const isThinkingEnabled = (modelName: string): boolean => {
        return thinkingEnabledByModel[modelName] ?? true;
    };

    const supportsTools = (modelName: string): boolean => {
        const model = (models as OfficialModel[]).find((m) => m.name === modelName);
        if (!model) return false;
        if (typeof model.capabilities?.supports_tools === 'boolean') {
            return model.capabilities.supports_tools;
        }
        const caps = new Set((model.ollama_capabilities || []).map((c) => c.toLowerCase()));
        return caps.has('tools');
    };

    useEffect(() => {
        if (!currentConversation || !webSearchEnabled) return;
        if (!supportsTools(currentConversation.model)) {
            setWebSearchEnabled(false);
        }
    }, [currentConversation?.model, webSearchEnabled, models]);

    const toggleThinking = (modelName: string) => {
        setThinkingEnabledByModel((prev) => ({
            ...prev,
            [modelName]: !(prev[modelName] ?? true),
        }));
    };

    const resolvePreferredModel = (): string => {
        if (currentConversation?.model && llmModelNames.has(currentConversation.model)) return currentConversation.model;

        if (preferredModel && llmModelNames.has(preferredModel)) {
            return preferredModel;
        }

        const recentLlmConversation = conversations.find((c) => llmModelNames.has(c.model));
        if (recentLlmConversation?.model) return recentLlmConversation.model;

        const firstModel = llmModels[0]?.name;
        return firstModel || '';
    };

    const resolveSendModelOrToast = (): string | null => {
        const model = currentConversation?.model || resolvePreferredModel();
        if (!model) {
            toast({
                title: t('chat.toast.noModel.title'),
                description: t('chat.toast.noModelBeforeSend'),
                variant: 'destructive',
            });
            return null;
        }
        if (!llmModelNames.has(model)) {
            toast({
                title: t('chat.toast.modelNotChatCapable.title'),
                description: t('chat.toast.modelNotChatCapable.description'),
                variant: 'destructive',
            });
            return null;
        }
        return model;
    };

    const buildSendOptions = (
        targetModel: string,
        remember: boolean,
        persistUserMessage?: boolean,
    ): {
        remember: boolean;
        think?: boolean | 'low' | 'medium' | 'high';
        web_search?: boolean;
        persist_user_message?: boolean;
    } => {
        const options: {
            remember: boolean;
            think?: boolean | 'low' | 'medium' | 'high';
            web_search?: boolean;
            persist_user_message?: boolean;
        } = {
            remember,
            web_search: false,
        };

        const toolsSupported = supportsTools(targetModel);
        if (webSearchEnabled && !toolsSupported) {
            toast({
                title: t('chat.toast.webSearchUnavailable.title'),
                description: t('chat.toast.webSearchUnavailable.description'),
                variant: 'destructive',
            });
            setWebSearchEnabled(false);
        }
        options.web_search = webSearchEnabled && toolsSupported;

        const reasoningSupported = isReasoningModel(targetModel);
        const thinkingEnabled = isThinkingEnabled(targetModel);
        if (reasoningSupported) {
            if (!thinkingEnabled) {
                options.think = false;
            } else if (isGptOssModel(targetModel)) {
                options.think = gptOssThinkingLevel;
            } else {
                options.think = true;
            }
        }

        if (typeof persistUserMessage === 'boolean') {
            options.persist_user_message = persistUserMessage;
        }
        return options;
    };

    const handleQuickCreateConversation = async () => {
        if (isCreatingConversation) return;

        const model = resolvePreferredModel();
        if (!model) {
            toast({
                title: t('chat.toast.noModel.title'),
                description: t('chat.toast.noModel.description'),
                variant: 'destructive',
            });
            return;
        }

        // Keep exactly one blank conversation to avoid accidental unlimited empty chats.
        if (currentConversation && messages.length === 0) {
            requestAnimationFrame(() => inputRef.current?.focus());
            return;
        }

        setIsCreatingConversation(true);
        try {
            await createConversation(t('chat.newConversation'), model);
            persistPreferredModel(model);
        } finally {
            setIsCreatingConversation(false);
        }
    };

    const handleSwitchConversationModel = async (nextModel: string) => {
        if (!currentConversation) return;
        if (!nextModel || nextModel === currentConversation.model) return;

        setIsSwitchingModel(true);
        try {
            await chatApi.updateConversationModel(currentConversation.id, nextModel);
            await fetchConversations();
            await loadConversation(currentConversation.id);
            persistPreferredModel(nextModel);
            toast({
                title: t('chat.toast.modelSwitched.title'),
                description: t('chat.toast.modelSwitched.description', { model: nextModel }),
            });
        } catch (error) {
            toast({
                title: t('chat.toast.switchModelFailed.title'),
                description: error instanceof Error ? error.message : t('common.unknownError'),
                variant: 'destructive',
            });
        } finally {
            setIsSwitchingModel(false);
        }
    };

    const handleAutoGenerateTitle = async (conversationId: string, msgs: Message[]) => {
        if (msgs.length < 2 || isGeneratingTitle) return;

        setIsGeneratingTitle(true);
        try {
            const response = await chatApi.autoGenerateTitle(
                msgs.slice(0, 3),
                currentConversation?.model || resolvePreferredModel() || 'llama3.2',
            );

            const data = response.data;
            if (data.title && data.title !== t('chat.newConversation')) {
                await chatApi.updateConversationTitle(conversationId, data.title);
                fetchConversations();
                toast({
                    title: t('chat.toast.autoTitleDone.title'),
                    description: t('chat.toast.autoTitleDone.description', { title: data.title }),
                });
            }
        } catch (error) {
            console.error('Failed to generate title:', error);
        } finally {
            setIsGeneratingTitle(false);
        }
    };

    const handleStartTitleEdit = (conv: { id: string; title?: string }) => {
        setEditingTitle(conv.id);
        setEditTitleValue((conv.title || '').trim() || t('chat.newConversation'));
    };

    const handleSaveTitle = async (convId: string) => {
        try {
            const nextTitle = editTitleValue.trim();
            if (!nextTitle) {
                toast({ title: t('chat.toast.titleEmpty'), variant: "destructive" });
                return;
            }
            await chatApi.updateConversationTitle(convId, nextTitle);
            await fetchConversations();
            setEditingTitle(null);
            toast({ title: t('chat.toast.titleUpdated') });
        } catch (error) {
            toast({ title: t('chat.toast.updateFailed'), variant: "destructive" });
        }
    };

    const handleDeleteConversation = async (conversationId: string) => {
        if (!conversationId) return;
        try {
            await deleteConversation(conversationId);
            toast({ title: t('chat.toast.chatDeleted') });
        } catch {
            toast({ title: t('chat.toast.deleteFailed'), variant: 'destructive' });
        }
    };

    const handleDeleteAllConversations = async () => {
        try {
            await deleteAllConversations();
            toast({ title: t('chat.toast.allChatsDeleted') });
        } catch {
            toast({ title: t('chat.toast.deleteFailed'), variant: 'destructive' });
        }
    };

    const applyPromptSuggestion = (suggestion: string) => {
        setInputMessage(suggestion);
        setIsPromptPanelOpen(false);
        setSelectedPromptIndex(0);
        requestAnimationFrame(() => {
            const input = inputRef.current;
            if (input) {
                input.focus();
                input.setSelectionRange(suggestion.length, suggestion.length);
            }
        });
    };

    const handleSendMessage = async () => {
        if (!inputMessage.trim() || isStreaming) return;

        const message = inputMessage.trim();
        const shouldRemember = rememberThisMessage;
        setInputMessage('');
        setRememberThisMessage(false);
        setIsPromptPanelOpen(false);

        const model = resolveSendModelOrToast();
        if (!model) return;

        if (!currentConversation) {
            await createConversation(t('chat.newConversation'), model);
        }
        persistPreferredModel(model);

        const sendOptions = buildSendOptions(model, shouldRemember);

        await sendMessage(message, model, sendOptions);
    };

    const canRetryLastMessage = useMemo(
        () => messages.some((m) => m.role === 'user'),
        [messages],
    );

    const handleRetryLastMessage = async () => {
        if (isStreaming) return;

        const lastUser = [...messages].reverse().find((m) => m.role === 'user');
        const retryContent = lastUser?.content?.trim() || '';
        if (!retryContent) return;

        const model = resolveSendModelOrToast();
        if (!model) return;
        const sendOptions = buildSendOptions(model, false, false);
        await sendMessage(retryContent, model, sendOptions);
    };

    const handleStopStreaming = async () => {
        await stopStreaming();
    };

    const handleRememberMessage = async (messageContent: string, index: number) => {
        const content = messageContent.trim();
        if (!content) return;

        setSavingMemoryIndex(index);
        try {
            await memoryApi.create({
                type: 'episodic',
                content,
                tags: ['manual_selected'],
                importance: 0.8,
            });
            toast({ title: t('chat.toast.memoryAdded') });
        } catch {
            toast({ title: t('chat.toast.memoryAddFailed'), variant: 'destructive' });
        } finally {
            setSavingMemoryIndex(null);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (isPromptPanelOpen && promptSuggestions.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedPromptIndex((prev) => (prev + 1) % promptSuggestions.length);
                return;
            }

            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedPromptIndex((prev) => (prev - 1 + promptSuggestions.length) % promptSuggestions.length);
                return;
            }

            if (e.key === 'Tab') {
                e.preventDefault();
                const target = promptSuggestions[selectedPromptIndex] || promptSuggestions[0];
                if (target) applyPromptSuggestion(target);
                return;
            }

            if (e.key === 'Escape') {
                e.preventDefault();
                setIsPromptPanelOpen(false);
                return;
            }
        }

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    const currentDetails = getCurrentModelDetails();
    const currentConversationTitle = (currentConversation?.title || '').trim() || t('chat.newConversation');
    const currentModelSupportsTools = currentConversation ? supportsTools(currentConversation.model) : false;

    return {
        state: {
            inputMessage,
            editingTitle,
            editTitleValue,
            isPromptPanelOpen,
            selectedPromptIndex,
            rememberThisMessage,
            savingMemoryIndex,
            isSwitchingModel,
            isGeneratingTitle,
            isCreatingConversation,
            scrollRef,
            inputRef,
            currentDetails,
            currentConversationTitle,
            promptSuggestions,
            llmModels,
            gptOssThinkingLevel,
            webSearchEnabled,
            currentModelSupportsTools,
            canRetryLastMessage,
            chatStore,
        },
        actions: {
            setInputMessage,
            setEditTitleValue,
            setEditingTitle,
            setRememberThisMessage,
            setIsPromptPanelOpen,
            setGptOssThinkingLevel,
            setWebSearchEnabled,
            applyPromptSuggestion,
            handleSendMessage,
            handleRetryLastMessage,
            handleStopStreaming,
            handleKeyDown,
            handleRememberMessage,
            handleQuickCreateConversation,
            handleStartTitleEdit,
            handleSaveTitle,
            handleDeleteConversation,
            handleDeleteAllConversations,
            handleSwitchConversationModel,
            handleAutoGenerateTitle,
            isThinkingEnabled,
            isReasoningModel,
            isGptOssModel,
            toggleThinking,
        },
    };
}
