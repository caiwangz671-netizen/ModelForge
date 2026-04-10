import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

interface ShellHeaderProps {
  eyebrow?: string;
  title: string;
  subtitle: string;
  statusLabel?: string;
  statusTone?: StatusTone;
  detail?: string;
  compact?: boolean;
  action?: {
    label: string;
    to: string;
  };
}

const STATUS_CLASSNAME: Record<StatusTone, string> = {
  neutral: 'border-border/70 bg-card/70 text-muted-foreground',
  info: 'border-sky-400/20 bg-sky-500/8 text-sky-200 dark:text-sky-100',
  success: 'border-emerald-400/20 bg-emerald-500/8 text-emerald-200 dark:text-emerald-100',
  warning: 'border-amber-400/20 bg-amber-500/10 text-amber-200 dark:text-amber-100',
  danger: 'border-rose-400/20 bg-rose-500/10 text-rose-200 dark:text-rose-100',
};

export function ShellHeader({
  eyebrow,
  title,
  subtitle,
  statusLabel,
  statusTone = 'neutral',
  detail,
  compact = false,
  action,
}: ShellHeaderProps) {
  return (
    <div
      className={cn(
        'rounded-[28px] border border-border/70 bg-card/78 shadow-[0_22px_60px_-52px_rgba(15,23,42,0.5)] backdrop-blur-xl dark:bg-[linear-gradient(180deg,rgba(10,16,28,0.84),rgba(7,12,22,0.92))]',
        compact
          ? 'flex items-center justify-between gap-4 px-5 py-2.5'
          : 'flex flex-col gap-4 px-5 py-5 lg:flex-row lg:items-end lg:justify-between',
      )}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <div className={cn('text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground', compact ? 'mb-1' : 'mb-2')}>
            {eyebrow}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className={cn('font-semibold tracking-tight text-foreground', compact ? 'text-[1.7rem] leading-none' : 'text-3xl')}>{title}</h1>
          {statusLabel ? (
            <Badge variant="outline" className={cn('rounded-full px-3 py-1 text-[11px] font-medium', STATUS_CLASSNAME[statusTone])}>
              {statusLabel}
            </Badge>
          ) : null}
        </div>
        <p className={cn('max-w-3xl text-sm leading-6 text-muted-foreground', compact ? 'mt-1 line-clamp-1' : 'mt-2')}>
          {subtitle}
        </p>
        {detail && !compact ? (
          <div className="mt-3 text-xs text-muted-foreground/90">
            {detail}
          </div>
        ) : null}
      </div>

      {action ? (
        <div className="shrink-0">
          <Button asChild className={cn('rounded-full', compact ? 'h-11 px-4' : 'px-4')}>
            <Link to={action.to}>{action.label}</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
