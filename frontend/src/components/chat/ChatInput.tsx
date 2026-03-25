import type { Dispatch, SetStateAction, RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Send, Loader2, Pause, Paperclip, FileText, Image as ImageIcon, X, UploadCloud } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
    getAttachmentAcceptString,
    isImageAttachmentFile,
    isTextAttachmentFile,
    readImageAttachment,
    readTextAttachment,
} from '@/lib/chatAttachments';
import type { ChatAttachment } from '@/types';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui/use-toast';

interface ChatInputProps {
    inputMessage: string;
    setInputMessage: Dispatch<SetStateAction<string>>;
    isStreaming: boolean;
    rememberThisMessage: boolean;
    setRememberThisMessage: Dispatch<SetStateAction<boolean>>;
    handleSendMessage: (attachments?: ChatAttachment[]) => void | Promise<void>;
    handleRetryLastMessage: () => void;
    handleStopStreaming: () => void;
    handleKeyDown: (e: React.KeyboardEvent, attachments?: ChatAttachment[]) => void;
    inputRef: RefObject<HTMLInputElement | null>;
    isPromptPanelOpen: boolean;
    setIsPromptPanelOpen: Dispatch<SetStateAction<boolean>>;
    promptSuggestions: string[];
    selectedPromptIndex: number;
    applyPromptSuggestion: (suggestion: string) => void;
    modelSupportsImageUpload: boolean;
    canRetryLastMessage: boolean;
}

function createAttachmentId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatAttachmentSize(size?: number): string {
    if (!size || size <= 0) return '';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function ChatInput({
    inputMessage,
    setInputMessage,
    isStreaming,
    rememberThisMessage,
    setRememberThisMessage,
    handleSendMessage,
    handleRetryLastMessage,
    handleStopStreaming,
    handleKeyDown,
    inputRef,
    isPromptPanelOpen,
    setIsPromptPanelOpen,
    promptSuggestions,
    selectedPromptIndex,
    applyPromptSuggestion,
    modelSupportsImageUpload,
    canRetryLastMessage,
}: ChatInputProps) {
    const { t } = useTranslation();
    const { toast } = useToast();
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const dragDepthRef = useRef(0);
    const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const [isDragActive, setIsDragActive] = useState(false);

    useEffect(() => {
        if (modelSupportsImageUpload) return;
        setAttachments((current) => current.filter((attachment) => attachment.kind !== 'image'));
    }, [modelSupportsImageUpload]);

    const clearDragState = () => {
        dragDepthRef.current = 0;
        setIsDragActive(false);
    };

    const handleOpenFilePicker = () => {
        if (isStreaming || isUploading) return;
        fileInputRef.current?.click();
    };

    const handleRemoveAttachment = (attachmentId: string) => {
        setAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
    };

    const processFiles = async (files: File[]) => {
        if (!files.length || isStreaming) return;

        setIsUploading(true);
        try {
            const nextAttachments: ChatAttachment[] = [];

            for (const file of files) {
                try {
                    const isImage = isImageAttachmentFile(file);
                    const isText = isTextAttachmentFile(file);

                    if (isImage && !modelSupportsImageUpload) {
                        toast({
                            title: t('chat.toast.attachmentImageNotSupported.title'),
                            description: t('chat.toast.attachmentImageNotSupported.description'),
                            variant: 'destructive',
                        });
                        continue;
                    }

                    if (!isImage && !isText) {
                        toast({
                            title: t('chat.toast.attachmentUnsupported.title'),
                            description: t('chat.toast.attachmentUnsupported.description', { name: file.name }),
                            variant: 'destructive',
                        });
                        continue;
                    }

                    if (isImage) {
                        const data = await readImageAttachment(file);
                        nextAttachments.push({
                            id: createAttachmentId(),
                            kind: 'image',
                            name: file.name,
                            mime_type: file.type || 'image/png',
                            data,
                            size: file.size,
                        });
                        continue;
                    }

                    const text = await readTextAttachment(file);
                    nextAttachments.push({
                        id: createAttachmentId(),
                        kind: 'text',
                        name: file.name,
                        mime_type: file.type || 'text/plain',
                        text,
                        size: file.size,
                    });
                } catch (error) {
                    toast({
                        title: t('chat.toast.attachmentReadFailed.title'),
                        description: error instanceof Error ? error.message : t('common.unknownError'),
                        variant: 'destructive',
                    });
                }
            }

            if (nextAttachments.length > 0) {
                setAttachments((current) => [...current, ...nextAttachments]);
            }
        } finally {
            setIsUploading(false);
        }
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.currentTarget.files || []);
        event.currentTarget.value = '';
        await processFiles(files);
    };

    const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
        if (isStreaming || isUploading) return;
        if (!Array.from(event.dataTransfer.types || []).includes('Files')) return;
        event.preventDefault();
        dragDepthRef.current += 1;
        setIsDragActive(true);
    };

    const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
        if (isStreaming || isUploading) return;
        if (!Array.from(event.dataTransfer.types || []).includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setIsDragActive(true);
    };

    const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
        if (isStreaming || isUploading) return;
        if (!Array.from(event.dataTransfer.types || []).includes('Files')) return;
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) {
            setIsDragActive(false);
        }
    };

    const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
        if (isStreaming || isUploading) return;
        if (!Array.from(event.dataTransfer.types || []).includes('Files')) return;
        event.preventDefault();
        clearDragState();
        const files = Array.from(event.dataTransfer.files || []);
        await processFiles(files);
    };

    const handleSendWithAttachments = async () => {
        const currentAttachments = attachments;
        setAttachments([]);
        await handleSendMessage(currentAttachments);
    };

    const attachmentAccept = getAttachmentAcceptString(modelSupportsImageUpload);
    const hasAttachments = attachments.length > 0;

    return (
        <div
            className={cn(
                'pt-3.5 border-t space-y-3 bg-background/90 backdrop-blur-sm relative z-30 px-3 md:px-5 pb-3 transition-colors',
                isDragActive && 'bg-primary/5 border-primary/40',
            )}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            <AnimatePresence>
                {isDragActive && (
                    <motion.div
                        initial={{ opacity: 0, y: 6, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 4, scale: 0.98 }}
                        className="pointer-events-none absolute inset-3 rounded-3xl border border-dashed border-primary/50 bg-primary/5 backdrop-blur-sm flex items-center justify-center z-40"
                    >
                        <div className="flex flex-col items-center gap-2 rounded-2xl bg-background/90 px-5 py-4 shadow-lg border border-primary/20">
                            <UploadCloud className="h-5 w-5 text-primary" />
                            <div className="text-sm font-semibold text-foreground">
                                {t('chat.uploadAttachment')}
                            </div>
                            <div className="text-xs text-muted-foreground">
                                {modelSupportsImageUpload
                                    ? t('chat.attachmentHintVisual')
                                    : t('chat.attachmentHintTextOnly')}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={attachmentAccept}
                className="hidden"
                onChange={handleFileChange}
            />

            {hasAttachments && (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {attachments.map((attachment) => (
                        <div
                            key={attachment.id}
                            className="overflow-hidden rounded-3xl border border-border/70 bg-card/80 shadow-sm"
                        >
                            {attachment.kind === 'image' && attachment.data ? (
                                <div className="relative aspect-[16/10] w-full overflow-hidden bg-muted">
                                    <img
                                        src={`data:${attachment.mime_type && !attachment.mime_type.endsWith('/*') ? attachment.mime_type : 'image/png'};base64,${attachment.data}`}
                                        alt={attachment.name}
                                        className="h-full w-full object-cover"
                                    />
                                    <button
                                        type="button"
                                        className="absolute right-2 top-2 rounded-full border border-background/50 bg-background/80 p-1 text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-background"
                                        onClick={() => handleRemoveAttachment(attachment.id)}
                                        aria-label={t('chat.removeAttachment')}
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background/90 via-background/55 to-transparent px-3 py-2">
                                        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                                            <ImageIcon className="h-3.5 w-3.5 text-primary" />
                                            <span className="truncate">{attachment.name}</span>
                                        </div>
                                        <div className="mt-1 text-[11px] text-muted-foreground">
                                            {formatAttachmentSize(attachment.size)}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex items-start gap-3 px-3 py-3">
                                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                                        <FileText className="h-4 w-4" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <div className="truncate text-sm font-medium text-foreground">
                                                    {attachment.name}
                                                </div>
                                                <div className="mt-0.5 text-[11px] text-muted-foreground">
                                                    {formatAttachmentSize(attachment.size) || t('chat.uploadAttachment')}
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                                onClick={() => handleRemoveAttachment(attachment.id)}
                                                aria-label={t('chat.removeAttachment')}
                                            >
                                                <X className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                        <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-muted/70 px-2 py-1 text-[11px] text-muted-foreground">
                                            <FileText className="h-3 w-3" />
                                            <span>{attachment.mime_type || 'text/plain'}</span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            <div className="flex gap-2.5 relative">
                <Button
                    type="button"
                    variant="outline"
                    onClick={handleOpenFilePicker}
                    disabled={isStreaming || isUploading}
                    className="h-12 w-12 shrink-0 rounded-2xl shadow-sm transition-all active:scale-95"
                    title={t('chat.uploadAttachment')}
                >
                    {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                </Button>

                <div className="flex-1 relative">
                    <AnimatePresence>
                        {isPromptPanelOpen && promptSuggestions.length > 0 && (
                            <motion.div
                                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 5, scale: 0.98 }}
                                transition={{ duration: 0.15, ease: 'easeOut' }}
                                className="absolute left-0 right-0 bottom-full mb-2 border rounded-2xl bg-card shadow-lg z-20 max-h-56 overflow-auto"
                            >
                                {promptSuggestions.map((suggestion, idx) => (
                                    <button
                                        key={`${suggestion}-${idx}`}
                                        type="button"
                                        className={cn(
                                            'w-full text-left px-4 py-3 text-sm transition-colors',
                                            idx === selectedPromptIndex
                                                ? 'bg-primary/10 text-primary font-medium'
                                                : 'hover:bg-muted text-foreground/85',
                                        )}
                                        onMouseDown={(e) => {
                                            e.preventDefault();
                                            applyPromptSuggestion(suggestion);
                                        }}
                                    >
                                        {suggestion}
                                    </button>
                                ))}
                                <div className="px-4 py-2 text-[11px] text-muted-foreground border-t bg-muted/30 sticky bottom-0 backdrop-blur-sm">
                                    {t('chat.promptPanelHint')}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                    <div className="relative group">
                        <Input
                            ref={inputRef}
                            placeholder={t('chat.inputPlaceholder')}
                            value={inputMessage}
                            onChange={(e) => setInputMessage(e.target.value)}
                            onKeyDown={(e) => {
                                if (isUploading) return;
                                handleKeyDown(e, attachments);
                            }}
                            onFocus={() => {
                                if (!isStreaming && inputMessage.trim() && promptSuggestions.length > 0) {
                                    setIsPromptPanelOpen(true);
                                }
                            }}
                            onBlur={() => {
                                // Delay hiding to allow clicks on panel items to register
                                setTimeout(() => setIsPromptPanelOpen(false), 200);
                            }}
                            disabled={isStreaming}
                            className="pr-12 h-12 rounded-2xl border-border/70 focus-visible:ring-primary/20 focus-visible:border-primary/50 shadow-sm transition-all text-[15px] group-hover:border-primary/40 bg-background/65 focus:bg-background"
                        />
                        {isStreaming && (
                            <div className="absolute right-4 top-1/2 -translate-y-1/2">
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            </div>
                        )}
                    </div>
                </div>

                {!isStreaming && canRetryLastMessage && (
                    <Button
                        variant="outline"
                        onClick={handleRetryLastMessage}
                        className="h-12 w-14 shrink-0 rounded-2xl shadow-sm transition-all active:scale-95"
                        title={t('chat.retryLastMessage')}
                    >
                        <span className="text-xs font-medium">{t('common.retry')}</span>
                    </Button>
                )}

                <Button
                    onClick={isStreaming ? handleStopStreaming : handleSendWithAttachments}
                    disabled={isUploading || (!isStreaming && !inputMessage.trim() && !hasAttachments)}
                    className="h-12 w-14 shrink-0 rounded-2xl shadow-sm transition-all active:scale-95 disabled:opacity-50"
                    title={isStreaming ? t('chat.pauseGeneration') : t('chat.sendMessage')}
                >
                    {isStreaming ? (
                        <Pause className="h-4 w-4 opacity-100" />
                    ) : (
                        <Send className={cn('h-4 w-4', !inputMessage.trim() && !hasAttachments ? 'opacity-50' : 'opacity-100')} />
                    )}
                </Button>
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground pl-1">
                <Switch
                    id="remember-switch"
                    checked={rememberThisMessage}
                    onCheckedChange={setRememberThisMessage}
                    className="scale-75 origin-left data-[state=checked]:bg-primary/80"
                />
                <label htmlFor="remember-switch" className="cursor-pointer select-none hover:text-foreground transition-colors">
                    {t('chat.rememberSwitch')}
                </label>
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground pl-1">
                <span>
                    {modelSupportsImageUpload
                        ? t('chat.attachmentHintVisual')
                        : t('chat.attachmentHintTextOnly')}
                </span>
            </div>
        </div>
    );
}
