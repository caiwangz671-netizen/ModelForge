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
import { Loader2, Brain, Wand2, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Conversation, Message } from '@/types';
import type { OfficialModel, OfficialModelDetails } from '@/pages/Chat'; // We will export these types later or move them to types
import { useTranslation } from 'react-i18next';
import { formatBytes } from '@/hooks/useModels';

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
    runningModelsDetail: Record<string, { size: number; size_vram: number }>;
    systemHardware: any | null;
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
    runningModelsDetail,
    systemHardware,
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
    const { t } = useTranslation();

    return (
        <div className="flex items-start md:items-center justify-between gap-3 border-b px-3 md:px-5 py-2.5">
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
                        <h2 className="font-semibold text-base tracking-tight mb-1 text-foreground truncate max-w-[280px] md:max-w-[420px]">{currentConversationTitle}</h2>
                    )}
                    <div className="flex items-center gap-1.5 flex-wrap">
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
                        {currentDetails?.parameter_size && (
                            <Badge variant="secondary" className="hidden sm:flex text-[10px] h-5 px-1.5 font-normal rounded-md bg-muted/50 text-muted-foreground hover:bg-muted/80 transition-colors">
                                {currentDetails.parameter_size} {currentDetails.quantization_level ? `· ${currentDetails.quantization_level}` : ''}
                            </Badge>
                        )}

                        {/* VRAM / SIZE indicator */}
                        {runningModelsDetail[currentConversation.model] ? (
                             <Badge variant="outline" className="hidden sm:flex text-[10px] h-5 px-1.5 font-medium rounded-md border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/10 gap-1 animate-in fade-in zoom-in duration-300">
                                <span className="relative flex h-1.5 w-1.5 mr-0.5">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500"></span>
                                </span>
                                {formatBytes(runningModelsDetail[currentConversation.model].size_vram)} VRAM
                             </Badge>
                        ) : currentDetails?.parameter_size ? (
                            <Badge variant="secondary" className="hidden sm:flex text-[10px] h-5 px-1.5 font-normal rounded-md bg-muted/40 text-muted-foreground/70">
                                {t('models.notLoaded')}
                            </Badge>
                        ) : systemHardware ? (
                            // SYSTEM TELEMETRY (show even if no model loaded)
                            <Badge variant="outline" className="hidden sm:flex text-[10px] h-5 px-1.5 font-normal rounded-md border-muted-foreground/20 text-muted-foreground bg-muted/20 gap-1.5 transition-all">
                                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
                                {t('chat.system')} {systemHardware.gpu_vram_bytes ? 'VRAM' : 'RAM'}: {systemHardware.gpu_vram_used !== null ? formatBytes(systemHardware.gpu_vram_used) : formatBytes(systemHardware.ram_used)}
                                <span className="opacity-40">/</span>
                                {systemHardware.gpu_vram_bytes ? formatBytes(systemHardware.gpu_vram_bytes) : formatBytes(systemHardware.ram_total)}
                            </Badge>
                        ) : null}

                        {/* Reasoning indicator */}
                        {isReasoningModel(currentConversation.model) && (
                            <Button
                                size="sm"
                                variant={currentThinkingEnabled ? 'secondary' : 'ghost'}
                                className={cn(
                                    "h-6 px-2 text-[10px] rounded-md transition-all active:scale-95 gap-1.5",
                                    currentThinkingEnabled 
                                        ? "bg-amber-500/15 text-amber-600 hover:bg-amber-500/25 border border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400" 
                                        : "text-muted-foreground hover:text-foreground"
                                )}
                                onClick={() => toggleThinking(currentConversation.model)}
                                title={t('chat.toggleThinkingTitle')}
                            >
                                <Brain className={cn("h-3 w-3", currentThinkingEnabled && "animate-pulse")} />
                                <span className="hidden sm:inline">{t('chat.thinkingLabel')}</span>
                                <span className="sm:hidden">Think</span>
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
                                <span className="text-muted-foreground">GPT-OSS:</span> {gptOssThinkingLevel}
                            </Button>
                        )}
                        <Button
                            size="sm"
                            variant={webSearchEnabled ? 'secondary' : 'ghost'}
                            className={cn(
                                "h-6 px-2 text-[10px] rounded-md transition-all active:scale-95 gap-1.5",
                                webSearchEnabled 
                                    ? "bg-blue-500/15 text-blue-600 hover:bg-blue-500/25 border border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-400" 
                                    : "text-muted-foreground hover:text-foreground"
                            )}
                            disabled={!currentModelSupportsTools}
                            onClick={() => setWebSearchEnabled((prev) => !prev)}
                            title={currentModelSupportsTools ? t('chat.webSearchTitle') : t('chat.webSearchUnsupportedTitle')}
                        >
                            <Globe className="h-3 w-3" />
                            <span className="hidden sm:inline">{t('chat.webSearch')}</span>
                            <span className="sm:hidden">Web</span>
                        </Button>
                    </div>
                </div>

                {messages.length >= 2 && !isGeneratingTitle && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 rounded-full border bg-background hover:bg-primary/10 hover:text-primary transition-colors"
                        onClick={() => handleAutoGenerateTitle(currentConversation.id, messages)}
                        title={t('chat.autoGenerateTitle')}
                    >
                        <Wand2 className="h-4 w-4" />
                    </Button>
                )}
                {isGeneratingTitle && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
            </div>
        </div>
    );
}
