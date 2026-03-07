import type { Dispatch, SetStateAction, RefObject } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Send, Loader2, Pause } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

interface ChatInputProps {
    inputMessage: string;
    setInputMessage: Dispatch<SetStateAction<string>>;
    isStreaming: boolean;
    rememberThisMessage: boolean;
    setRememberThisMessage: Dispatch<SetStateAction<boolean>>;
    handleSendMessage: () => void;
    handleRetryLastMessage: () => void;
    handleStopStreaming: () => void;
    handleKeyDown: (e: React.KeyboardEvent) => void;
    inputRef: RefObject<HTMLInputElement | null>;
    isPromptPanelOpen: boolean;
    setIsPromptPanelOpen: Dispatch<SetStateAction<boolean>>;
    promptSuggestions: string[];
    selectedPromptIndex: number;
    applyPromptSuggestion: (suggestion: string) => void;
    currentConversationModel: string | undefined;
    canRetryLastMessage: boolean;
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
    canRetryLastMessage,
}: ChatInputProps) {
    const { t } = useTranslation();

    return (
        <div className="pt-3.5 border-t space-y-3 bg-background/90 backdrop-blur-sm relative z-30 px-3 md:px-5 pb-3">
            <div className="flex gap-2.5 relative">
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
                                            "w-full text-left px-4 py-3 text-sm transition-colors",
                                            idx === selectedPromptIndex
                                                ? "bg-primary/10 text-primary font-medium"
                                                : "hover:bg-muted text-foreground/85"
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
                            onKeyDown={handleKeyDown}
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
                    onClick={isStreaming ? handleStopStreaming : handleSendMessage}
                    disabled={!isStreaming && !inputMessage.trim()}
                    className="h-12 w-14 shrink-0 rounded-2xl shadow-sm transition-all active:scale-95 disabled:opacity-50"
                    title={isStreaming ? t('chat.pauseGeneration') : t('chat.sendMessage')}
                >
                    {isStreaming ? (
                        <Pause className="h-4 w-4 opacity-100" />
                    ) : (
                        <Send className={cn("h-4 w-4", !inputMessage.trim() ? "opacity-50" : "opacity-100")} />
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
        </div>
    );
}
