import { useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Download, PackageCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SurfaceState } from '@/components/layout/SurfaceState';
import { useDownloadStore } from '@/store/downloadStore';

export function Downloads() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tasks, fetchTasks } = useDownloadStore();

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  const activeTasks = useMemo(
    () => tasks.filter((task) => task.status === 'queued' || task.status === 'downloading'),
    [tasks],
  );
  const historyTasks = useMemo(
    () => tasks.filter((task) => task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled'),
    [tasks],
  );

  return (
    <div className="space-y-5">
      <SurfaceState
        icon={Download}
        title={t('downloads.title')}
        description={t('downloads.convergedDescription')}
        tone="neutral"
        action={{
          label: t('downloads.openTransfers'),
          onClick: () => navigate('/models?tab=transfers'),
        }}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="border-border/70 bg-card/82">
          <CardContent className="p-5">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {t('downloads.active')}
            </div>
            <div className="mt-3 flex items-end justify-between gap-3">
              <div className="text-3xl font-semibold">{activeTasks.length}</div>
              <Badge variant="outline">{t('models.tabTransfers')}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/82">
          <CardContent className="p-5">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {t('downloads.completed')}
            </div>
            <div className="mt-3 flex items-end justify-between gap-3">
              <div className="text-3xl font-semibold">{historyTasks.length}</div>
              <PackageCheck className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/70 bg-card/82">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold">{t('downloads.transferCenterTitle')}</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {t('downloads.transferCenterDescription')}
            </div>
          </div>
          <Button asChild variant="outline" className="rounded-full">
            <Link to="/models?tab=transfers">
              {t('downloads.openTransfers')}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
