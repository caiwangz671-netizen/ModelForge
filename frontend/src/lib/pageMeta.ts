export type ShellDensity = 'standard' | 'wide' | 'immersive';

export interface ShellPageAction {
  labelKey: string;
  to: string;
}

export interface ShellPageMeta {
  titleKey: string;
  subtitleKey: string;
  density: ShellDensity;
  action?: ShellPageAction;
}

export const LAST_PRIMARY_PATH_KEY = 'shell:lastPrimaryPath';

const PRIMARY_PATHS = ['/', '/chat', '/computer-use', '/models'] as const;

export const PAGE_META: Record<string, ShellPageMeta> = {
  '/': {
    titleKey: 'shell.workspace.title',
    subtitleKey: 'shell.workspace.subtitle',
    density: 'wide',
    action: {
      labelKey: 'shell.workspace.action',
      to: '/chat',
    },
  },
  '/chat': {
    titleKey: 'shell.chat.title',
    subtitleKey: 'shell.chat.subtitle',
    density: 'immersive',
    action: {
      labelKey: 'shell.chat.action',
      to: '/models',
    },
  },
  '/computer-use': {
    titleKey: 'shell.computerUse.title',
    subtitleKey: 'shell.computerUse.subtitle',
    density: 'wide',
  },
  '/models': {
    titleKey: 'shell.models.title',
    subtitleKey: 'shell.models.subtitle',
    density: 'wide',
    action: {
      labelKey: 'shell.models.action',
      to: '/models?tab=transfers',
    },
  },
  '/memory': {
    titleKey: 'shell.memory.title',
    subtitleKey: 'shell.memory.subtitle',
    density: 'standard',
  },
  '/settings': {
    titleKey: 'shell.settings.title',
    subtitleKey: 'shell.settings.subtitle',
    density: 'standard',
  },
};

export function normalizeShellPath(pathname: string): string {
  if (pathname === '/downloads') return '/models';
  return pathname in PAGE_META ? pathname : '/';
}

export function getShellMeta(pathname: string): ShellPageMeta {
  return PAGE_META[normalizeShellPath(pathname)] || PAGE_META['/'];
}

export function isPrimaryShellPath(pathname: string): boolean {
  return PRIMARY_PATHS.includes(normalizeShellPath(pathname) as (typeof PRIMARY_PATHS)[number]);
}

export function persistLastPrimaryPath(pathname: string): void {
  if (typeof window === 'undefined') return;
  const normalized = normalizeShellPath(pathname);
  if (!isPrimaryShellPath(normalized) || normalized === '/') return;
  window.localStorage.setItem(LAST_PRIMARY_PATH_KEY, normalized);
}

export function readLastPrimaryPath(): string | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(LAST_PRIMARY_PATH_KEY);
  if (!raw) return null;
  const normalized = normalizeShellPath(raw);
  return isPrimaryShellPath(normalized) && normalized !== '/' ? normalized : null;
}
