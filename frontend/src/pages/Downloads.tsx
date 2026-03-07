import { useEffect, useRef } from 'react';
import { useDownloadStore } from '@/store/downloadStore';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Download, X, Clock, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import type { DownloadTask, DownloadStatus } from '@/types';

function formatBytes(bytes: number | null | undefined, fallback = '-'): string {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return fallback;
  if (value === 0) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(value) / Math.log(1024)), sizes.length - 1);
  return `${(value / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

function formatSpeed(bytesPerSecond: number | null | undefined): string {
  const value = Number(bytesPerSecond);
  if (!Number.isFinite(value) || value <= 0) return '-';
  return `${formatBytes(bytesPerSecond)}/s`;
}

function formatETA(seconds: number | null | undefined): string {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return '-';
  if (value < 60) return `${Math.round(value)}s`;
  if (value < 3600) return `${Math.round(value / 60)}m`;
  return `${Math.round(value / 3600)}h`;
}

function getCompletedSize(task: DownloadTask): number | null {
  if (task.total_size > 0) return task.total_size;
  if (task.downloaded_size > 0) return task.downloaded_size;
  return null;
}

function getStatusBadge(
  status: DownloadStatus,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  const statusMap: Record<
    DownloadStatus,
    { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
  > = {
    idle: { label: t('downloads.statusIdle'), variant: 'secondary' },
    queued: { label: t('downloads.statusQueued'), variant: 'secondary' },
    downloading: { label: t('downloads.statusDownloading'), variant: 'default' },
    paused: { label: t('downloads.statusPaused'), variant: 'outline' },
    completed: { label: t('downloads.statusCompleted'), variant: 'default' },
    failed: { label: t('downloads.statusFailed'), variant: 'destructive' },
    cancelled: { label: t('downloads.statusCancelled'), variant: 'outline' },
  };

  const config = statusMap[status];
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

export function Downloads() {
  const { t } = useTranslation();
  const { tasks, fetchTasks, cancelDownload } = useDownloadStore();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchTasks();

    // Start polling
    intervalRef.current = setInterval(() => {
      fetchTasks();
    }, 2000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  const activeTasks = tasks.filter(
    (t) => t.status === 'downloading' || t.status === 'queued'
  );
  const completedTasks = tasks.filter((t) => t.status === 'completed');
  const failedTasks = tasks.filter((t) => t.status === 'failed' || t.status === 'cancelled');

  const DownloadCard = ({ task }: { task: DownloadTask }) => (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h4 className="font-semibold">{task.model_name}</h4>
            <p className="text-sm text-muted-foreground">
              {t('downloads.version')}: {task.model_version}
            </p>
            {task.status_text && (
              <p className="text-xs text-muted-foreground mt-1">
                {t('downloads.status')}: {task.status_text}
                {task.retry_count && task.retry_count > 0
                  ? ` · ${t('downloads.retryCount', { count: task.retry_count })}`
                  : ''}
              </p>
            )}
          </div>
          {getStatusBadge(task.status, t)}
        </div>

        {task.status === 'downloading' && (
          <div className="space-y-2">
            <Progress value={task.progress} className="h-2" />
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>{task.progress.toFixed(1)}%</span>
              <span>
                {formatBytes(task.downloaded_size)} / {formatBytes(task.total_size, '-')}
              </span>
            </div>
            <div className="flex gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                {formatSpeed(task.speed)}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                ETA: {formatETA(task.eta)}
              </span>
            </div>
          </div>
        )}

        {task.status === 'completed' && (
          <div className="text-sm text-green-600">
            {(() => {
              const completedSize = getCompletedSize(task);
              return completedSize
                ? `${t('downloads.downloadComplete')} - ${formatBytes(completedSize)}`
                : t('downloads.downloadComplete');
            })()}
          </div>
        )}

        {task.error && (
          <div className="text-sm text-destructive mt-2">
            {t('downloads.error')}: {task.error}
          </div>
        )}

        {(task.status === 'downloading' || task.status === 'queued') && (
          <div className="mt-3 flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => cancelDownload(task.id)}
            >
              <X className="h-4 w-4 mr-1" />
              {t('common.cancel')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">{t('downloads.title')}</h2>
        <p className="text-muted-foreground mt-1">
          {t('downloads.subtitle')}
        </p>
      </div>

      {/* Active Downloads */}
      {activeTasks.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Download className="h-5 w-5" />
            {t('downloads.active')} ({activeTasks.length})
          </h3>
          <div className="grid gap-4 md:grid-cols-2">
            <AnimatePresence>
              {activeTasks.map((task) => (
                <motion.div
                  key={task.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.25 }}
                >
                  <DownloadCard task={task} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Completed Downloads */}
      {completedTasks.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-4">{t('downloads.completed')} ({completedTasks.length})</h3>
          <ScrollArea className="h-[300px]">
            <div className="grid gap-4 md:grid-cols-2 pr-4">
              {completedTasks.map((task) => (
                <DownloadCard key={task.id} task={task} />
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Failed/Cancelled Downloads */}
      {failedTasks.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-4">{t('downloads.failed')} ({failedTasks.length})</h3>
          <div className="grid gap-4 md:grid-cols-2">
            {failedTasks.map((task) => (
              <DownloadCard key={task.id} task={task} />
            ))}
          </div>
        </div>
      )}

      {tasks.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <Download className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>{t('downloads.noTasks')}</p>
            <p className="text-sm mt-1">{t('downloads.noTasksHint')}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
