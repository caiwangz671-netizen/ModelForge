import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { useTranslation } from 'react-i18next';
import {
    ExternalLink,
    CheckCircle2,
    Sparkles,
    Loader2,
} from 'lucide-react';
import { stripEmojis } from '@/hooks/useModels';
import type { LibraryModel } from '@/types';

interface LibraryModelCardProps {
    model: LibraryModel;
    isModelDownloaded: (name: string) => boolean;
    isModelDownloading: (name: string) => boolean;
    handleOpenLibraryModel: (model: LibraryModel) => void;
    index?: number;
}

export function LibraryModelCard({
    model,
    isModelDownloaded,
    isModelDownloading,
    handleOpenLibraryModel,
    index = 0,
}: LibraryModelCardProps) {
    const { t } = useTranslation();
    const hasBaseVersion = isModelDownloaded(model.name) || isModelDownloaded(`${model.name}:latest`);
    const isDownloading = isModelDownloading(model.name) || isModelDownloading(`${model.name}:latest`);

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, delay: Math.min(index * 0.05, 0.5), ease: "easeOut" }}
            className="flex"
        >
            <Card className="hover:border-primary/50 transition-all duration-300 hover:shadow-md md:rounded-xl group bg-card w-full">
                <CardContent className="p-4 md:p-5 flex flex-col h-full gap-3">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-3 min-h-[28px]">
                        <h3 className="font-bold text-lg tracking-tight truncate group-hover:text-primary transition-colors flex-1">
                            {model.name}
                        </h3>
                        <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 rounded-md shrink-0 opacity-50 hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-muted"
                            onClick={() => window.open(model.library_url, '_blank', 'noopener,noreferrer')}
                            title={t('models.openLibrary')}
                        >
                            <ExternalLink className="h-4 w-4" />
                        </Button>
                    </div>

                    {/* Description */}
                    <p className="text-[13px] leading-snug text-muted-foreground line-clamp-2 min-h-[36px]">
                        {stripEmojis(model.description)}
                    </p>

                    {/* Tags */}
                    <div className="flex flex-wrap gap-1.5 min-h-[24px]">
                        {model.capabilities.slice(0, 3).map((cap) => (
                            <Badge key={cap} variant="secondary" className="text-[10px] h-5 px-1.5 bg-muted/60 font-medium">
                                {cap}
                            </Badge>
                        ))}
                        {model.sizes.slice(0, 4).map((size) => (
                            <Badge key={size} variant="outline" className="text-[10px] h-5 px-1.5 border-muted-foreground/20 font-medium">
                                {size}
                            </Badge>
                        ))}
                    </div>

                    {/* Status indicator */}
                    <div className="h-6 flex items-center">
                        {isDownloading ? (
                            <Badge className="bg-sky-500/10 text-sky-700 dark:text-sky-300 hover:bg-sky-500/15 border-transparent shadow-none w-fit text-[11px] h-6 px-2 py-0 font-normal transition-colors">
                                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                {t('models.downloadInProgress')}
                            </Badge>
                        ) : hasBaseVersion ? (
                            <Badge className="bg-green-600/10 text-green-700 dark:text-green-400 hover:bg-green-600/20 border-transparent shadow-none w-fit text-[11px] h-6 px-2 py-0 font-normal transition-colors">
                                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                                {t('models.hasBaseVersion')}
                            </Badge>
                        ) : null}
                    </div>

                    <div className="mt-auto pt-2">
                        {/* Stats */}
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-3 font-medium px-0.5">
                            <span className="flex items-center">
                                <span className="mr-1.5 opacity-70">{t('models.pulls')}:</span>
                                <span className="text-foreground/80">{model.pull_count || '-'}</span>
                            </span>
                            <span className="flex items-center">
                                <span className="mr-1.5 opacity-70">{t('models.tags')}:</span>
                                <span className="text-foreground/80">{model.tag_count ?? '-'}</span>
                            </span>
                        </div>

                        {/* Action buttons */}
                        <div className="flex gap-2.5">
                            <Button
                                size="sm"
                                className="flex-1 rounded-lg text-[13px] font-medium h-9 shadow-sm transition-transform active:scale-95"
                                disabled={isDownloading}
                                onClick={() => handleOpenLibraryModel(model)}
                            >
                                {isDownloading ? (
                                    <>
                                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                        {t('models.downloadInProgress')}
                                    </>
                                ) : (
                                    <>
                                        <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                                        {t('models.download')}
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </motion.div>
    );
}
