import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { useTranslation } from 'react-i18next';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
    Trash2,
    CheckCircle2,
    HardDrive,
    Power,
    Pin,
    PinOff,
    Play,
} from 'lucide-react';

import type { OfficialModel } from '@/pages/Models';

interface ModelCardProps {
    model: OfficialModel;
    isRunning: boolean;
    isResident: boolean;
    onLoad: (modelName: string) => void;
    onUnload: (modelName: string) => void;
    onToggleResident: (modelName: string, isResident: boolean) => void;
    onDelete: (modelName: string) => void;
    index?: number;
}

export function ModelCard({
    model,
    isRunning,
    isResident,
    onLoad,
    onUnload,
    onToggleResident,
    onDelete,
    index = 0,
}: ModelCardProps) {
    const { t } = useTranslation();
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

    const formatSize = (bytes?: number) => {
        if (bytes === undefined) return t('models.na');
        const gb = bytes / (1024 * 1024 * 1024);
        const mb = bytes / (1024 * 1024);
        return gb >= 1 ? `${gb.toFixed(2)} GB` : `${mb.toFixed(0)} MB`;
    };

    const handleDelete = (modelName: string) => {
        onDelete(modelName);
        setIsDeleteDialogOpen(false);
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: Math.min(index * 0.05, 0.5), ease: "easeOut" }}
        >
            <Card className="hover:border-primary/50 transition-all duration-300 hover:shadow-md md:rounded-xl group bg-card">
                <CardContent className="p-4 md:p-5">
                    <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0 pr-4">
                            <div className="flex items-center gap-2.5 mb-2">
                                <h3 className="font-bold text-lg tracking-tight truncate group-hover:text-primary transition-colors">
                                    {model.name}
                                </h3>
                                <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                                {isRunning && (
                                    <Badge variant="secondary" className="text-[10px] h-5 px-1.5 bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200 border-blue-200/50">
                                        {t('models.loaded')}
                                    </Badge>
                                )}
                                {isResident && (
                                    <Badge variant="secondary" className="text-[10px] h-5 px-1.5 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 border-amber-200/50">
                                        {t('models.resident')}
                                    </Badge>
                                )}
                            </div>

                            <div className="flex flex-wrap gap-1.5 mt-2.5">
                                {model.details?.family && (
                                    <Badge variant="secondary" className="text-[10px] h-5 px-2 bg-muted/60">{model.details.family}</Badge>
                                )}
                                {model.details?.parameter_size && (
                                    <Badge variant="outline" className="text-[10px] h-5 px-2 border-muted-foreground/20">{model.details.parameter_size}</Badge>
                                )}
                                {model.details?.quantization_level && (
                                    <Badge variant="outline" className="text-[10px] h-5 px-2 border-muted-foreground/20">{model.details.quantization_level}</Badge>
                                )}
                                {model.details?.format && (
                                    <Badge variant="outline" className="text-[10px] h-5 px-2 border-muted-foreground/20">{model.details.format}</Badge>
                                )}
                                {model.capabilities?.supports_reasoning && (
                                    <Badge variant="secondary" className="text-[10px] h-5 px-2 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                                        Reasoning
                                    </Badge>
                                )}
                                {model.capabilities?.supports_video && (
                                    <Badge variant="secondary" className="text-[10px] h-5 px-2 bg-sky-500/10 text-sky-700 dark:text-sky-300">
                                        Video
                                    </Badge>
                                )}
                                {model.capabilities?.supports_vision && (
                                    <Badge variant="secondary" className="text-[10px] h-5 px-2 bg-violet-500/10 text-violet-700 dark:text-violet-300">
                                        Vision
                                    </Badge>
                                )}
                                {model.capabilities?.supports_ocr && (
                                    <Badge variant="secondary" className="text-[10px] h-5 px-2 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
                                        OCR
                                    </Badge>
                                )}
                                {model.capabilities?.supports_tools && (
                                    <Badge variant="secondary" className="text-[10px] h-5 px-2 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300">
                                        Tools
                                    </Badge>
                                )}
                            </div>

                            <div className="mt-4">
                                {model.size && (
                                    <Badge variant="outline" className="flex w-fit items-center gap-1.5 text-[11px] h-6 px-2.5 py-0 border-muted-foreground/20 bg-muted/20 text-muted-foreground font-normal">
                                        <HardDrive className="h-3 w-3" />
                                        {formatSize(model.size)}
                                    </Badge>
                                )}
                            </div>
                        </div>

                        {/* Actions Column */}
                        <div className="flex flex-col gap-2 shrink-0">
                            <Button
                                size="icon"
                                variant={isRunning ? "secondary" : "outline"}
                                className="h-8 w-8 rounded-lg transition-transform active:scale-95"
                                onClick={() => onLoad(model.name)}
                                disabled={isRunning}
                                title={isRunning ? t('models.alreadyLoaded') : t('models.load')}
                            >
                                <Play className="h-4 w-4" />
                            </Button>
                            <Button
                                size="icon"
                                variant="outline"
                                className="h-8 w-8 rounded-lg transition-transform active:scale-95"
                                onClick={() => onUnload(model.name)}
                                disabled={!isRunning}
                                title={isRunning ? t('models.unload') : t('models.notLoaded')}
                            >
                                <Power className="h-4 w-4" />
                            </Button>
                            <Button
                                size="icon"
                                variant={isResident ? 'default' : 'outline'}
                                className="h-8 w-8 rounded-lg transition-transform active:scale-95"
                                onClick={() => onToggleResident(model.name, !isResident)}
                                title={isResident ? t('models.cancelResident') : t('models.setResident')}
                            >
                                {isResident ? (
                                    <Pin className="h-4 w-4" />
                                ) : (
                                    <PinOff className="h-4 w-4" />
                                )}
                            </Button>
                            <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                                <AlertDialogTrigger asChild>
                                    <Button size="icon" variant="destructive" className="h-8 w-8 rounded-lg shadow-sm hover:bg-destructive/90 transition-transform active:scale-95">
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent className="rounded-xl">
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>{t('models.confirmDelete')}</AlertDialogTitle>
                                        <AlertDialogDescription>
                                            {t('models.deleteDesc', { name: model.name })}{' '}
                                            {model.size && `(${t('models.deleteRelease', { size: formatSize(model.size) })})`}
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel className="rounded-lg">{t('common.cancel')}</AlertDialogCancel>
                                        <AlertDialogAction
                                            onClick={() => handleDelete(model.name)}
                                            className="bg-destructive hover:bg-destructive/90 rounded-lg shadow-sm"
                                        >
                                            {t('common.delete')}
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </motion.div>
    );
}
