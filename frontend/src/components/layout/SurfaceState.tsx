import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

type SurfaceStateTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

interface SurfaceStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  tone?: SurfaceStateTone;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

const TONE_CLASSNAME: Record<SurfaceStateTone, string> = {
  neutral: 'border-border/70 bg-card/72 text-foreground',
  info: 'border-sky-400/20 bg-sky-500/8 text-sky-100',
  success: 'border-emerald-400/20 bg-emerald-500/8 text-emerald-100',
  warning: 'border-amber-400/20 bg-amber-500/10 text-amber-100',
  danger: 'border-rose-400/20 bg-rose-500/10 text-rose-100',
};

export function SurfaceState({
  icon: Icon,
  title,
  description,
  tone = 'neutral',
  action,
  className,
}: SurfaceStateProps) {
  return (
    <div className={cn('rounded-[22px] border px-4 py-5 shadow-sm', TONE_CLASSNAME[tone], className)}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-full bg-black/10 p-2 dark:bg-white/5">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{title}</div>
          <div className="mt-1 text-sm leading-6 text-current/80">{description}</div>
          {action ? (
            <Button variant="outline" size="sm" className="mt-4 rounded-full" onClick={action.onClick}>
              {action.label}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
