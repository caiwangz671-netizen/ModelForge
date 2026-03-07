import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { CurrentTimeContext } from '@/components/ToolUse';
import { Loader2, Brain, Wand2, Cpu, Globe } from 'lucide-react';
import { useHardwareMonitor } from '@/hooks/useHardwareMonitor';
import { formatBytes } from '@/lib/utils';
import type { Conversation, Message } from '@/types';
import type { OfficialModel, OfficialModelDetails } from '@/pages/Chat'; // We will export these types later or move them to types
import { useTranslation } from 'react-i18next';

interface ChatHeaderProps {
    currentConversation: Conversation;
    currentConversationTitle: string;
    editingTitle: string | null;
    editTitleValue: string;
    setEditTitleValue: Dispatch<SetStateAction<string>>;
    setEditingTitle: Dispatch<SetStateAction<string | null>>;
    handleSaveTitle: (convId: string) => void;
    llmModels: OfficialModel[];
    handleSwitchConversationModel: (nextModel: string) => void;
    isSwitchingModel: boolean;
    isStreaming: boolean;
    currentDetails: OfficialModelDetails | null;
    isReasoningModel: (modelName: string) => boolean;
    isThinkingEnabled: (modelName: string) => boolean;
    toggleThinking: (modelName: string) => void;
    isGptOssModel: (modelName: string) => boolean;
    gptOssThinkingLevel: 'low' | 'medium' | 'high';
    setGptOssThinkingLevel: Dispatch<SetStateAction<'low' | 'medium' | 'high'>>;
    webSearchEnabled: boolean;
    currentModelSupportsTools: boolean;
    setWebSearchEnabled: Dispatch<SetStateAction<boolean>>;
    messages: Message[];
    isGeneratingTitle: boolean;
    handleAutoGenerateTitle: (conversationId: string, msgs: Message[]) => void;
}

export function ChatHeader({
    currentConversation,
    currentConversationTitle,
    editingTitle,
    editTitleValue,
    setEditTitleValue,
    setEditingTitle,
    handleSaveTitle,
    llmModels,
    handleSwitchConversationModel,
    isSwitchingModel,
    isStreaming,
    currentDetails,
    isReasoningModel,
    isThinkingEnabled,
    toggleThinking,
    isGptOssModel,
    gptOssThinkingLevel,
    setGptOssThinkingLevel,
    webSearchEnabled,
    currentModelSupportsTools,
    setWebSearchEnabled,
    messages,
    isGeneratingTitle,
    handleAutoGenerateTitle,
}: ChatHeaderProps) {
    const currentThinkingEnabled = isThinkingEnabled(currentConversation.model);
    const { hardwareInfo } = useHardwareMonitor(5000);
    const { t } = useTranslation();

    return (
        <div className="flex items-start md:items-center justify-between gap-3 pb-3.5 border-b px-3 md:px-5 pt-3">
            <div className="flex items-start md:items-center gap-3 flex-wrap">
                <div className="min-w-0">
                    {editingTitle === currentConversation.id ? (
                        <div className="flex items-center gap-2 mb-1.5 focus-within:ring-2 ring-primary/20 rounded-lg transition-all">
                            <Input
                                value={editTitleValue}
                                onChange={(e) => setEditTitleValue(e.target.value)}
                                className="h-8 w-56 text-sm font-medium border-primary/30"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSaveTitle(currentConversation.id);
                                    if (e.key === 'Escape') setEditingTitle(null);
                                }}
                                autoFocus
                            />
                            <Button size="sm" className="h-8 px-3 rounded-md shadow-sm transition-transform active:scale-95" onClick={() => handleSaveTitle(currentConversation.id)}>
                                {t('common.save')}
                            </Button>
                            <Button size="sm" variant="ghost" className="h-8 px-3 rounded-md" onClick={() => setEditingTitle(null)}>
                                {t('common.cancel')}
                            </Button>
                        </div>
                    ) : (
                        <h2 className="font-semibold text-lg tracking-tight mb-1.5 text-foreground truncate max-w-[280px] md:max-w-[420px]">{currentConversationTitle}</h2>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                        <Select
                            value={currentConversation.model}
                            onValueChange={handleSwitchConversationModel}
                            disabled={isSwitchingModel || isStreaming}
                        >
                            <SelectTrigger className="h-7 min-w-[180px] max-w-[260px] text-xs font-medium bg-background border-border/80 hover:border-primary/50 transition-colors rounded-lg">
                                <SelectValue placeholder={t('chat.selectModel')} />
                            </SelectTrigger>
                            <SelectContent className="max-h-[300px]">
                                {llmModels.map((model) => (
                                    <SelectItem key={model.name} value={model.name} className="text-xs">
                                        {model.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {isSwitchingModel && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}

                        {/* OFFICIAL OLLAMA TAGS FROM API */}
                        {currentDetails && (
                            <div className="hidden sm:flex items-center gap-1.5">
                                {currentDetails.family && (
                                    <Badge variant="secondary" className="text-[10px] h-5 px-1.5 font-normal rounded-md bg-muted/75">{currentDetails.family}</Badge>
                                )}
                                {currentDetails.parameter_size && (
                                    <Badge variant="secondary" className="text-[10px] h-5 px-1.5 font-normal rounded-md bg-muted/75">{currentDetails.parameter_size}</Badge>
                                )}
                                {currentDetails.quantization_level && (
                                    <Badge variant="secondary" className="text-[10px] h-5 px-1.5 font-normal rounded-md bg-muted/75">{currentDetails.quantization_level}</Badge>
                                )}
                            </div>
                        )}

                        {/* Reasoning indicator */}
                        {isReasoningModel(currentConversation.model) && (
                            <Badge variant="outline" className="text-[10px] h-5 px-1.5 font-medium bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800 rounded-md">
                                <Brain className="h-3 w-3 mr-1" />
                                {t('chat.reasoningBadge')}
                            </Badge>
                        )}
                        {isReasoningModel(currentConversation.model) && (
                            <Button
                                size="sm"
                                variant={currentThinkingEnabled ? 'default' : 'outline'}
                                className="h-6 px-2 text-[10px] rounded-md shadow-sm transition-transform active:scale-95"
                                onClick={() => toggleThinking(currentConversation.model)}
                                title={t('chat.toggleThinkingTitle')}
                            >
                                {t('chat.thinkingLabel')}: {currentThinkingEnabled ? t('common.enabled') : t('common.disabled')}
                            </Button>
                        )}
                        {isGptOssModel(currentConversation.model) && currentThinkingEnabled && (
                            <Button
                                size="sm"
                                variant="outline"
                                className="h-6 px-2 text-[10px] rounded-md transition-colors hover:bg-muted"
                                onClick={() => {
                                    const order: Array<'low' | 'medium' | 'high'> = ['low', 'medium', 'high'];
                                    const idx = order.indexOf(gptOssThinkingLevel);
                                    const next = order[(idx + 1) % order.length];
                                    setGptOssThinkingLevel(next);
                                }}
                                title={t('chat.gptOssThinkingTitle')}
                            >
                                GPT-OSS: {gptOssThinkingLevel}
                            </Button>
                        )}
                        <Button
                            size="sm"
                            variant={webSearchEnabled ? 'default' : 'outline'}
                            className="h-6 px-2 text-[10px] rounded-md shadow-sm transition-transform active:scale-95"
                            disabled={!currentModelSupportsTools}
                            onClick={() => setWebSearchEnabled((prev) => !prev)}
                            title={currentModelSupportsTools ? t('chat.webSearchTitle') : t('chat.webSearchUnsupportedTitle')}
                        >
                            <Globe className="h-3 w-3 mr-1" />
                            {t('chat.webSearch')}:
                            {' '}
                            {currentModelSupportsTools
                                ? (webSearchEnabled ? t('common.enabled') : t('common.disabled'))
                                : t('chat.webSearchUnsupportedShort')}
                        </Button>
                    </div>
                </div>

                {messages.length >= 2 && !isGeneratingTitle && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 rounded-full border bg-background hover:bg-primary/10 hover:text-primary transition-colors"
                        onClick={() => handleAutoGenerateTitle(currentConversation.id, messages)}
                        title={t('chat.autoGenerateTitle')}
                    >
                        <Wand2 className="h-4 w-4" />
                    </Button>
                )}
                {isGeneratingTitle && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
            </div>

            <div className="hidden md:flex items-center gap-3">
                {hardwareInfo && (
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-medium bg-muted/45 px-2 py-1.5 rounded-lg border">
                        <Cpu className="h-3 w-3 text-primary/70" />
                        <span>{t('settings.ram')}: {Math.round(hardwareInfo.ram_percent)}% ({formatBytes(hardwareInfo.ram_used)} / {formatBytes(hardwareInfo.ram_total)})</span>
                        {hardwareInfo.gpu_vram_bytes !== null && (
                            <>
                                <span className="opacity-50">|</span>
                                <span>{t('chat.vramAvailable')}</span>
                            </>
                        )}
                    </div>
                )}
                <CurrentTimeContext />
            </div>
        </div>
    );
}
