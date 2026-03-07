import type { Dispatch, SetStateAction } from 'react';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent } from '@/components/ui/card';
import { ChevronDown, ChevronRight, Plus, Trash2, MessageSquare, Edit2 } from 'lucide-react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { Conversation } from '@/types';
import { useTranslation } from 'react-i18next';

const CHAT_HISTORY_COLLAPSED_STORAGE_KEY = 'chat:historyCollapsed';

interface ChatSidebarProps {
    conversations: Conversation[];
    currentConversation: Conversation | null;
    isCreatingConversation: boolean;
    isStreaming: boolean;
    editingTitle: string | null;
    editTitleValue: string;
    setEditTitleValue: Dispatch<SetStateAction<string>>;
    setEditingTitle: Dispatch<SetStateAction<string | null>>;
    handleQuickCreateConversation: () => void;
    handleStartTitleEdit: (conv: { id: string; title?: string }) => void;
    handleSaveTitle: (convId: string) => void;
    handleDeleteConversation: (convId: string) => void;
    handleDeleteAllConversations: () => void;
    loadConversation: (id: string) => void;
}

function formatConversationMeta(conv: Conversation, locale: string): string {
    const rawTs = conv.updated_at || conv.created_at;
    const ts = rawTs > 1e12 ? rawTs : rawTs * 1000;
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return conv.model;

    const timeText = new Intl.DateTimeFormat(locale, {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
    return `${conv.model} · ${timeText}`;
}

export function ChatSidebar({
    conversations,
    currentConversation,
    isCreatingConversation,
    isStreaming,
    editingTitle,
    editTitleValue,
    setEditTitleValue,
    setEditingTitle,
    handleQuickCreateConversation,
    handleStartTitleEdit,
    handleSaveTitle,
    handleDeleteConversation,
    handleDeleteAllConversations,
    loadConversation,
}: ChatSidebarProps) {
    const [chatToDelete, setChatToDelete] = useState<string | null>(null);
    const [deleteAllOpen, setDeleteAllOpen] = useState(false);
    const [isHistoryCollapsed, setIsHistoryCollapsed] = useState(() => {
        if (typeof window === 'undefined') return false;
        return window.localStorage.getItem(CHAT_HISTORY_COLLAPSED_STORAGE_KEY) === 'true';
    });
    const { t, i18n } = useTranslation();
    const dateLocale = i18n.resolvedLanguage || i18n.language || 'zh-CN';
    const HistoryIcon = isHistoryCollapsed ? ChevronRight : ChevronDown;

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem(CHAT_HISTORY_COLLAPSED_STORAGE_KEY, String(isHistoryCollapsed));
    }, [isHistoryCollapsed]);

    return (
        <Card className="w-full flex flex-col min-h-0 border-r rounded-none shadow-none md:rounded-2xl md:border md:shadow-lg md:shadow-black/5 bg-card/95 backdrop-blur-sm">
            <CardContent className="p-3 flex flex-col h-full">
                <div className="flex items-center justify-between mb-3 px-1">
                    <div className="min-w-0">
                        <h3 className="font-semibold text-base tracking-tight">{t('chat.title')}</h3>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                            {t('chat.conversationCount', { count: conversations.length })}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="icon"
                            title={isHistoryCollapsed ? t('common.expand') : t('common.collapse')}
                            className="h-9 w-9 rounded-full"
                            onClick={() => setIsHistoryCollapsed((prev) => !prev)}
                        >
                            <HistoryIcon className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="outline"
                            size="icon"
                            title={t('chat.deleteAll')}
                            disabled={conversations.length === 0 || isStreaming}
                            className="h-9 w-9 rounded-full border-destructive/20 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => setDeleteAllOpen(true)}
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                        <Button
                            size="sm"
                            onClick={handleQuickCreateConversation}
                            title={t('chat.createNew')}
                            disabled={isCreatingConversation}
                            className="rounded-full shadow-sm transition-all active:scale-95 h-9 px-3"
                        >
                            <Plus className="h-4 w-4 mr-1" />
                            {t('chat.newChat')}
                        </Button>
                    </div>
                </div>

                {!isHistoryCollapsed && (
                    <ScrollArea className="flex-1 min-h-0 -mx-1">
                        <div className="space-y-2 px-1 pb-1">
                            <AnimatePresence initial={false}>
                                {conversations.map((conv) => (
                                    <motion.div
                                        key={conv.id}
                                        layout
                                        initial={{ opacity: 0, x: -16 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: 16, transition: { duration: 0.16 } }}
                                        transition={{ duration: 0.18 }}
                                        className={cn(
                                            'group flex items-start justify-between gap-2 rounded-xl border px-3 py-2.5 cursor-pointer transition-all duration-200',
                                            currentConversation?.id === conv.id
                                                ? 'bg-primary/10 border-primary/40 shadow-sm'
                                                : 'border-transparent hover:border-border hover:bg-muted/55',
                                        )}
                                        onClick={() => loadConversation(conv.id)}
                                    >
                                        {editingTitle === conv.id ? (
                                            <div className="flex items-center gap-2 flex-1">
                                                <Input
                                                    value={editTitleValue}
                                                    onChange={(e) => setEditTitleValue(e.target.value)}
                                                    className="h-8 text-sm rounded-md"
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') handleSaveTitle(conv.id);
                                                        if (e.key === 'Escape') setEditingTitle(null);
                                                    }}
                                                    onClick={(e) => e.stopPropagation()}
                                                    autoFocus
                                                />
                                                <Button
                                                    size="sm"
                                                    className="h-8 px-2.5 rounded-md"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleSaveTitle(conv.id);
                                                    }}
                                                >
                                                    {t('common.save')}
                                                </Button>
                                            </div>
                                        ) : (
                                            <>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <div
                                                            className={cn(
                                                                'h-7 w-7 rounded-md flex items-center justify-center shrink-0 transition-colors',
                                                                currentConversation?.id === conv.id
                                                                    ? 'bg-primary/20 text-primary'
                                                                    : 'bg-muted text-muted-foreground group-hover:text-foreground',
                                                            )}
                                                        >
                                                            <MessageSquare className="h-3.5 w-3.5" />
                                                        </div>
                                                        <span className="text-sm font-medium truncate">
                                                            {(conv.title || '').trim() || t('chat.newConversation')}
                                                        </span>
                                                    </div>
                                                    <p className="text-[11px] text-muted-foreground truncate mt-1 pl-9">
                                                        {formatConversationMeta(conv, dateLocale)}
                                                    </p>
                                                </div>
                                                <div
                                                    className={cn(
                                                        'flex items-center gap-1 shrink-0 transition-opacity',
                                                        currentConversation?.id === conv.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                                                    )}
                                                >
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                                                        title={t('chat.editTitle')}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleStartTitleEdit(conv);
                                                        }}
                                                    >
                                                        <Edit2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-7 w-7 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                                        title={t('chat.deleteChat')}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setChatToDelete(conv.id);
                                                        }}
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </div>
                                            </>
                                        )}
                                    </motion.div>
                                ))}
                            </AnimatePresence>
                        </div>
                    </ScrollArea>
                )}
            </CardContent>

            <AlertDialog open={!!chatToDelete} onOpenChange={(open) => !open && setChatToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('chat.deleteConfirmTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('chat.deleteConfirmDescription')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => {
                                if (chatToDelete) {
                                    handleDeleteConversation(chatToDelete);
                                    setChatToDelete(null);
                                }
                            }}
                        >
                            {t('common.confirm')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={deleteAllOpen} onOpenChange={setDeleteAllOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('chat.deleteAllConfirmTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('chat.deleteAllConfirmDescription')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => {
                                handleDeleteAllConversations();
                                setDeleteAllOpen(false);
                            }}
                        >
                            {t('chat.deleteAll')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Card>
    );
}
