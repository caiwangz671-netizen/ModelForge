import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useChat } from '@/hooks/useChat';
import { useAutoModelManager } from '@/hooks/useAutoModelManager';
import { useTranslation } from 'react-i18next';

export type OfficialModelDetails = {
  parent_model: string;
  format: string;
  family: string;
  families: string[];
  parameter_size: string;
  quantization_level: string;
};

export type OfficialModel = {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details: OfficialModelDetails;
  ollama_capabilities?: string[];
  capabilities?: {
    supports_reasoning?: boolean;
    supports_video?: boolean;
    supports_vision?: boolean;
    supports_ocr?: boolean;
    supports_tools?: boolean;
    supports_embedding?: boolean;
  };
};
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MarkdownRenderer, StreamingMarkdownRenderer } from '@/components/MarkdownRenderer';
import { ThinkingProcess } from '@/components/ThinkingProcess';
import {
  Plus, MessageSquare, Bot, User, Loader2, BookmarkPlus, ExternalLink, FileText, Image as ImageIcon
} from 'lucide-react';
import type { ChatAttachment, Message, RagReference } from '@/types';
import { cn } from '@/lib/utils';
import { ChatSidebar } from '@/components/chat/ChatSidebar';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { ChatInput } from '@/components/chat/ChatInput';

// Extended Message with thinking support
interface ExtendedMessage extends Message {
  thinking?: string;
}

function buildReferenceJumpQuery(message: ExtendedMessage): string {
  const refs = Array.isArray(message.rag_references) ? message.rag_references : [];
  const primary = refs.find((ref) => !isWebReference(ref)) || refs[0];
  if (!primary) return '';
  const snippet = typeof primary?.snippet === 'string' ? primary.snippet.trim() : '';
  if (snippet) return snippet.slice(0, 80);
  const source = typeof primary?.source_name === 'string' ? primary.source_name.trim() : '';
  if (source) return source;
  return '';
}

function isWebReference(reference: RagReference): boolean {
  return Boolean(
    (reference?.source_type || '').toLowerCase() === 'web'
    || reference?.final_url
    || reference?.url
  );
}

function getReferenceDisplay(reference: RagReference): string {
  return (
    (typeof reference.display === 'string' && reference.display.trim())
    || (typeof reference.title === 'string' && reference.title.trim())
    || (typeof reference.source_name === 'string' && reference.source_name.trim())
    || (typeof reference.label === 'string' && reference.label.trim())
    || 'Reference'
  );
}

function formatAttachmentSize(size?: number): string {
  if (!size || size <= 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function Chat() {
  const { t } = useTranslation();
  const layoutRef = useRef<HTMLDivElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);

  useEffect(() => {
    if (!isResizingSidebar) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (event: MouseEvent) => {
      const container = layoutRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const minWidth = 260;
      const maxWidth = Math.max(minWidth, Math.min(560, rect.width - 420));
      const nextWidth = Math.min(maxWidth, Math.max(minWidth, event.clientX - rect.left));
      setSidebarWidth(nextWidth);
    };

    const onMouseUp = () => {
      setIsResizingSidebar(false);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isResizingSidebar]);

  const { state, actions } = useChat();
  const {
    inputMessage,
    editingTitle,
    editTitleValue,
    isPromptPanelOpen,
    selectedPromptIndex,
    rememberThisMessage,
    savingMemoryIndex,
    isSwitchingModel,
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
    isGeneratingTitle,
    chatStore,
  } = state;

  const {
    setInputMessage,
    setEditTitleValue,
    setEditingTitle,
    setRememberThisMessage,
    setIsPromptPanelOpen,
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
    setGptOssThinkingLevel,
    setWebSearchEnabled,
    toggleThinking,
  } = actions;

  const {
    conversations,
    currentConversation,
    messages,
    isStreaming,
    streamingMessage,
    streamingThinking,
    streamingTools,
    loadConversation,
  } = chatStore;

  const currentConversationModelInfo = llmModels.find((model) => model.name === currentConversation?.model);
  const currentModelSupportsImageUpload = Boolean(
    currentConversationModelInfo?.capabilities?.supports_video
    || currentConversationModelInfo?.capabilities?.supports_vision
    || currentConversationModelInfo?.capabilities?.supports_ocr
  );

  const autoLoadEnabled = typeof window !== 'undefined' && window.localStorage.getItem('autoLoadModel') === 'true';
  const idleTimeoutMinutes = typeof window !== 'undefined'
    ? Number.parseInt(window.localStorage.getItem('idleTimeoutMinutes') || '10', 10) || 10
    : 10;

  useAutoModelManager({
    enabled: Boolean(currentConversation),
    autoLoadEnabled,
    idleTimeoutMinutes,
    currentModel: currentConversation?.model,
  });

  return (
    <div
      ref={layoutRef}
      className="h-[calc(100vh-4rem)] flex gap-4 overflow-hidden bg-background/50 p-2 md:p-3"
    >
      <div className="relative shrink-0 min-w-0" style={{ width: `${sidebarWidth}px` }}>
        <ChatSidebar
          conversations={conversations}
          currentConversation={currentConversation}
          isCreatingConversation={isCreatingConversation}
          editingTitle={editingTitle}
          editTitleValue={editTitleValue}
          setEditTitleValue={setEditTitleValue}
          setEditingTitle={setEditingTitle}
          handleQuickCreateConversation={handleQuickCreateConversation}
          handleStartTitleEdit={handleStartTitleEdit}
          handleSaveTitle={handleSaveTitle}
          handleDeleteConversation={handleDeleteConversation}
          handleDeleteAllConversations={handleDeleteAllConversations}
          isStreaming={isStreaming}
          loadConversation={loadConversation}
        />
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('chat.resizeSidebar')}
          className="absolute -right-2 top-0 z-30 hidden h-full w-4 cursor-col-resize md:block"
          onMouseDown={(event) => {
            event.preventDefault();
            setIsResizingSidebar(true);
          }}
        >
          <div
            className={cn(
              'mx-auto h-full w-px transition-colors',
              isResizingSidebar ? 'bg-primary/70' : 'bg-border/70 hover:bg-primary/40',
            )}
          />
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col min-h-0 rounded-2xl border border-border/70 bg-card/90 backdrop-blur-xl shadow-lg shadow-black/10 dark:bg-card/82 dark:shadow-black/30 overflow-hidden relative transition-all duration-300">
        {currentConversation ? (
          <>
            <ChatHeader
              currentConversation={currentConversation}
              currentConversationTitle={currentConversationTitle}
              editingTitle={editingTitle}
              editTitleValue={editTitleValue}
              setEditTitleValue={setEditTitleValue}
              setEditingTitle={setEditingTitle}
              handleSaveTitle={handleSaveTitle}
              llmModels={llmModels as OfficialModel[]}
              handleSwitchConversationModel={handleSwitchConversationModel}
              isSwitchingModel={isSwitchingModel}
              isStreaming={isStreaming}
              currentDetails={currentDetails}
              isReasoningModel={isReasoningModel}
              isThinkingEnabled={isThinkingEnabled}
              toggleThinking={toggleThinking}
              isGptOssModel={isGptOssModel}
              gptOssThinkingLevel={gptOssThinkingLevel}
              setGptOssThinkingLevel={setGptOssThinkingLevel}
              webSearchEnabled={webSearchEnabled}
              currentModelSupportsTools={currentModelSupportsTools}
              setWebSearchEnabled={setWebSearchEnabled}
              messages={messages}
              isGeneratingTitle={isGeneratingTitle}
              handleAutoGenerateTitle={handleAutoGenerateTitle}
            />

            {/* Messages - USE messages FROM STORE DIRECTLY */}
            <ScrollArea className="flex-1 min-h-0 py-5 px-3 md:px-6" ref={scrollRef}>
              <div className="space-y-7 max-w-5xl mx-auto w-full">
                <AnimatePresence initial={false}>
                  {(messages as ExtendedMessage[]).map((message, index) => (
                    <motion.div
                      key={index}
                      className="space-y-3.5"
                      initial={{ opacity: 0, y: 15, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ duration: 0.3, ease: 'easeOut' }}
                    >
                      {/* Thinking Process */}
                      {(message.thinking || (Array.isArray(message.tool_calls) && message.tool_calls.length > 0)) && (
                        <div className="ml-12">
                          <ThinkingProcess
                            thinking={message.thinking || ''}
                            tools={message.tool_calls || []}
                            modelName={currentConversation.model}
                            defaultExpanded={false}
                          />
                        </div>
                      )}

                      {/* Main Message */}
                      <div className={cn("flex gap-3.5", message.role === 'user' ? 'flex-row-reverse' : '')}>
                        <div
                          className={cn(
                            "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ring-1",
                            message.role === 'user'
                              ? "bg-primary/15 text-primary ring-primary/25"
                              : "bg-card/90 text-muted-foreground ring-border/80 dark:bg-muted/35"
                          )}
                        >
                          {message.role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                        </div>
                        <div
                          className={cn(
                            "max-w-[85%] rounded-2xl px-4 py-3.5 overflow-x-auto border shadow-sm",
                            message.role === 'user'
                              ? 'bg-gradient-to-br from-primary to-primary/85 text-primary-foreground border-primary/40'
                              : 'bg-card/78 text-foreground border-border/70 dark:bg-card/72'
                          )}
                        >
                          <MarkdownRenderer content={message.content} enableMath={true} enableCodeHighlight={true} />
                          {Array.isArray(message.attachments) && message.attachments.length > 0 && (
                            <div className="mt-3 space-y-2 border-t border-current/10 pt-3">
                              <div className={cn(
                                'text-[11px] font-medium uppercase tracking-[0.18em]',
                                message.role === 'user' ? 'text-primary-foreground/75' : 'text-muted-foreground',
                              )}>
                                {t('chat.uploadAttachment')}
                              </div>
                              <div className="grid gap-2 sm:grid-cols-2">
                                {message.attachments.map((attachment: ChatAttachment) => (
                                  <div
                                    key={`${attachment.id}-${attachment.name}`}
                                    className={cn(
                                      'overflow-hidden rounded-2xl border shadow-sm',
                                      message.role === 'user'
                                        ? 'border-primary-foreground/15 bg-primary-foreground/10 text-primary-foreground'
                                        : 'border-border/70 bg-background/75 text-foreground dark:bg-muted/25',
                                    )}
                                  >
                                    {attachment.kind === 'image' && attachment.data && (
                                      <div className="relative aspect-[16/10] w-full overflow-hidden bg-muted">
                                        <img
                                          src={`data:${attachment.mime_type && !attachment.mime_type.endsWith('/*') ? attachment.mime_type : 'image/png'};base64,${attachment.data}`}
                                          alt={attachment.name}
                                          className="h-full w-full object-cover"
                                        />
                                      </div>
                                    )}
                                    <div className="flex items-start gap-2 px-3 py-2">
                                      <div className={cn(
                                        'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl',
                                        message.role === 'user' ? 'bg-primary-foreground/12' : 'bg-primary/12 text-primary',
                                      )}>
                                        {attachment.kind === 'image' ? (
                                          <ImageIcon className="h-4 w-4" />
                                        ) : (
                                          <FileText className="h-4 w-4" />
                                        )}
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <div className="truncate text-xs font-medium">{attachment.name}</div>
                                        <div className={cn(
                                          'mt-0.5 text-[11px]',
                                          message.role === 'user' ? 'text-primary-foreground/70' : 'text-muted-foreground',
                                        )}>
                                          {attachment.kind === 'image'
                                            ? t('chat.attachmentHintVisual')
                                            : formatAttachmentSize(attachment.size) || attachment.mime_type || 'text/plain'}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {message.role === 'assistant' &&
                            Array.isArray(message.rag_references) &&
                            message.rag_references.length > 0 && (
                              <div className="mt-3 border-t border-border/50 pt-2.5">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-[11px] text-primary/90">
                                    {t('chat.referenceCount', { count: message.rag_references.length })}
                                  </span>
                                  {message.rag_references.map((reference, refIndex) => {
                                    const labelText = `${reference.label ? `${reference.label} · ` : ''}${getReferenceDisplay(reference)}`;
                                    if (isWebReference(reference)) {
                                      const href = reference.final_url || reference.url;
                                      if (!href) return null;
                                      return (
                                        <a
                                          key={`${reference.label || 'web'}-${refIndex}`}
                                          href={href}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="inline-flex max-w-full items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-500/5 px-2.5 py-1 text-[11px] text-emerald-700 transition-colors hover:bg-emerald-500/10 dark:text-emerald-300"
                                          title={href}
                                        >
                                          <ExternalLink className="h-3 w-3 shrink-0" />
                                          <span className="max-w-[260px] truncate">{labelText}</span>
                                        </a>
                                      );
                                    }

                                    const query = (
                                      (typeof reference.snippet === 'string' && reference.snippet.trim())
                                      || (typeof reference.source_name === 'string' && reference.source_name.trim())
                                      || buildReferenceJumpQuery(message)
                                    );
                                    return (
                                      <Link
                                        key={`${reference.label || 'memory'}-${refIndex}`}
                                        to={`/memory${query ? `?query=${encodeURIComponent(query)}` : ''}`}
                                        className="inline-flex max-w-full items-center rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-[11px] text-primary/90 transition-colors hover:bg-primary/10"
                                        title={getReferenceDisplay(reference)}
                                      >
                                        <span className="max-w-[260px] truncate">{labelText}</span>
                                      </Link>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                        </div>
                      </div>
                      {message.role === 'user' && (
                        <div className="flex justify-end pr-12">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs rounded-full border bg-background/60 hover:bg-muted/70"
                            onClick={() => handleRememberMessage(message.content, index)}
                            disabled={savingMemoryIndex === index}
                          >
                            {savingMemoryIndex === index ? (
                              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                            ) : (
                              <BookmarkPlus className="h-3.5 w-3.5 mr-1" />
                            )}
                            {t('chat.rememberMessage')}
                          </Button>
                        </div>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>

                {/* Streaming thinking */}
                {(streamingThinking || streamingTools.length > 0) && (
                  <div className="ml-12">
                    <ThinkingProcess
                      thinking={streamingThinking}
                      tools={streamingTools}
                      modelName={currentConversation.model}
                      defaultExpanded={true}
                      isStreaming={true}
                    />
                  </div>
                )}

                {/* Streaming message */}
                {isStreaming && streamingMessage && (
                  <div className="flex gap-3.5">
                    <div className="w-8 h-8 rounded-full bg-card/90 text-muted-foreground ring-1 ring-border/80 dark:bg-muted/35 flex items-center justify-center flex-shrink-0">
                      <Bot className="h-4 w-4" />
                    </div>
                    <div className="max-w-[85%] rounded-2xl px-4 py-3.5 bg-card/78 border border-border/70 shadow-sm overflow-x-auto dark:bg-card/72">
                      <StreamingMarkdownRenderer
                        content={streamingMessage}
                        enableMath={true}
                        enableCodeHighlight={false}
                      />
                      <span className="inline-block w-2 h-4 bg-current animate-pulse ml-1" />
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>

            <ChatInput
              inputMessage={inputMessage}
              setInputMessage={setInputMessage}
              isStreaming={isStreaming}
              rememberThisMessage={rememberThisMessage}
              setRememberThisMessage={setRememberThisMessage}
              handleSendMessage={handleSendMessage}
              handleRetryLastMessage={handleRetryLastMessage}
              handleStopStreaming={handleStopStreaming}
              handleKeyDown={handleKeyDown}
              inputRef={inputRef}
              isPromptPanelOpen={isPromptPanelOpen}
              setIsPromptPanelOpen={setIsPromptPanelOpen}
              promptSuggestions={promptSuggestions}
              selectedPromptIndex={selectedPromptIndex}
              applyPromptSuggestion={applyPromptSuggestion}
              modelSupportsImageUpload={currentModelSupportsImageUpload}
              canRetryLastMessage={canRetryLastMessage}
            />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-muted-foreground border border-border/70 rounded-2xl px-8 py-10 bg-card/82 shadow-sm dark:bg-card/78">
              <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-base font-medium text-foreground">{t('chat.emptyTitle')}</p>
              <p className="text-sm mt-1">{t('chat.emptyDescription')}</p>
              <Button
                className="mt-5 rounded-full px-5"
                onClick={handleQuickCreateConversation}
                disabled={isCreatingConversation}
              >
                <Plus className="h-4 w-4 mr-1" />{t('chat.createNew')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
