import type { ComputerUseApprovalMode } from '@/types/computerUse';

const STORAGE_KEY = 'computer-use:preferences';

export interface ComputerUsePreferences {
  approvalMode: ComputerUseApprovalMode;
  useCustomScope: boolean;
  cwd: string;
  allowedPaths: string[];
}

export function normalizeComputerUsePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of paths) {
    const next = item.trim();
    if (!next || seen.has(next)) continue;
    seen.add(next);
    normalized.push(next);
  }
  return normalized;
}

function defaultPreferences(): ComputerUsePreferences {
  return {
    approvalMode: 'hands_free',
    useCustomScope: false,
    cwd: '',
    allowedPaths: [],
  };
}

export function loadComputerUsePreferences(): ComputerUsePreferences {
  if (typeof window === 'undefined') return defaultPreferences();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPreferences();
    const parsed = JSON.parse(raw) as Partial<ComputerUsePreferences>;
    return {
      approvalMode: parsed.approvalMode === 'review_all' ? 'review_all' : 'hands_free',
      useCustomScope: parsed.useCustomScope === true,
      cwd: typeof parsed.cwd === 'string' ? parsed.cwd.trim() : '',
      allowedPaths: normalizeComputerUsePaths(Array.isArray(parsed.allowedPaths) ? parsed.allowedPaths : []),
    };
  } catch {
    return defaultPreferences();
  }
}

export function saveComputerUsePreferences(preferences: ComputerUsePreferences): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      approvalMode: preferences.approvalMode === 'review_all' ? 'review_all' : 'hands_free',
      useCustomScope: Boolean(preferences.useCustomScope),
      cwd: preferences.cwd.trim(),
      allowedPaths: normalizeComputerUsePaths(preferences.allowedPaths),
    }),
  );
}
