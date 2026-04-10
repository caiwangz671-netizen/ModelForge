import type { ComputerUseAction, ComputerUseSession, ComputerUseSessionListItem } from '@/types/computerUse';

export interface ComputerUseResultItem {
  key: string;
  labelKey: string;
  value: string;
  href?: string;
  meta?: string;
}

export function isTerminalStatus(status?: string | null): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

export function formatStatusLabel(status?: string | null): string {
  if (!status) return '';
  return status
    .split('_')
    .filter(Boolean)
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
    .join(' ');
}

export function formatHistoryTimestamp(session: ComputerUseSessionListItem): string {
  const timestamp = session.updated_at || session.completed_at || session.started_at || session.created_at;
  if (!timestamp) return '-';
  try {
    return new Date(timestamp * 1000).toLocaleString([], {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '-';
  }
}

export function formatActionTimestamp(ts?: number | null): string {
  if (!ts) return '';
  try {
    return new Date(ts * 1000).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '';
  }
}

export function formatSessionDuration(session: ComputerUseSession | null): string {
  if (!session?.created_at) return '0m';
  const end = session.completed_at || Math.floor(Date.now() / 1000);
  const totalSeconds = Math.max(0, end - session.created_at);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function getToolDisplayName(toolName: string): string {
  return toolName
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getToolInputSummary(toolName: string, payload: Record<string, unknown>): string | null {
  if (!payload) return null;
  try {
    if (toolName === 'computer_click' || toolName === 'computer_click_box' || toolName === 'computer_click_target') {
      if ('x' in payload && 'y' in payload) return `(${payload.x}, ${payload.y})`;
      if ('x1' in payload) return `(${payload.x1}, ${payload.y1}) → (${payload.x2}, ${payload.y2})`;
      if ('target_description' in payload) {
        const description = String(payload.target_description);
        return `"${description.slice(0, 60)}${description.length > 60 ? '…' : ''}"`;
      }
    }
    if (toolName === 'computer_type' || toolName === 'browser_type') {
      const text = String(payload.text ?? payload.value ?? '');
      return text ? `"${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"` : null;
    }
    if (toolName === 'computer_keypress' || toolName === 'browser_keypress') {
      return String(payload.key ?? payload.keys ?? '');
    }
    if (toolName === 'computer_scroll' || toolName === 'browser_scroll') {
      const direction = String(payload.direction ?? '');
      const coords = payload.x !== undefined ? ` at (${payload.x}, ${payload.y})` : '';
      return `${direction}${coords}`.trim() || null;
    }
    if (toolName === 'computer_open_url' || toolName === 'browser_navigate') {
      return String(payload.url ?? '');
    }
    if (toolName === 'computer_open_app') {
      return String(payload.app_name ?? payload.name ?? '');
    }
    if (toolName === 'computer_locate_target') {
      const description = String(payload.description ?? payload.target ?? '');
      return description ? `"${description.slice(0, 60)}${description.length > 60 ? '…' : ''}"` : null;
    }
    if (toolName === 'computer_wait_for_user') {
      const message = String(payload.message ?? '');
      return message ? `"${message.slice(0, 60)}${message.length > 60 ? '…' : ''}"` : null;
    }
    if (toolName === 'fs_read_text' || toolName === 'fs_write_text' || toolName === 'fs_list') {
      return String(payload.path ?? '');
    }
    if (toolName === 'shell_exec' || toolName === 'terminal_exec') {
      const command = String(payload.command ?? payload.cmd ?? '');
      return command ? `${command.slice(0, 80)}${command.length > 80 ? '…' : ''}` : null;
    }
    if (toolName === 'browser_click') {
      return String(payload.selector ?? payload.description ?? '');
    }
  } catch {
    return null;
  }
  return null;
}

export function getToolOutputSummary(payload: Record<string, unknown>): string | null {
  if (!payload) return null;
  try {
    const value = payload.summary
      ?? payload.message
      ?? payload.hint
      ?? payload.reason
      ?? payload.path
      ?? payload.url
      ?? payload.text
      ?? payload.content
      ?? payload.result
      ?? payload.output;
    if (typeof value === 'string' && value.trim()) {
      return `${value.slice(0, 160)}${value.length > 160 ? '…' : ''}`;
    }
  } catch {
    return null;
  }
  return null;
}

export function getDarkStatusPillClasses(status?: string | null): string {
  switch (status) {
    case 'running':
      return 'border-cyan-400/20 bg-cyan-400/10 text-cyan-100';
    case 'completed':
      return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100';
    case 'paused':
    case 'waiting_approval':
      return 'border-amber-400/20 bg-amber-400/10 text-amber-100';
    case 'failed':
    case 'cancelled':
    case 'error':
      return 'border-rose-400/20 bg-rose-500/10 text-rose-100';
    default:
      return 'border-white/10 bg-white/[0.05] text-slate-200';
  }
}

export function getDarkRiskPillClasses(risk?: string | null): string {
  const normalized = String(risk || '').toLowerCase();
  if (normalized.includes('critical') || normalized.includes('high')) {
    return 'border-rose-400/20 bg-rose-500/10 text-rose-100';
  }
  if (normalized.includes('medium')) {
    return 'border-amber-400/20 bg-amber-400/10 text-amber-100';
  }
  if (normalized.includes('low')) {
    return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100';
  }
  return 'border-white/10 bg-white/[0.05] text-slate-200';
}

export function buildResultItems(session: ComputerUseSession | null, backendOrigin: string): ComputerUseResultItem[] {
  if (!session) return [];

  const items: ComputerUseResultItem[] = [];

  if (session.latest_artifact_url) {
    items.push({
      key: `artifact:${session.latest_artifact_id || 'latest'}`,
      labelKey: 'computerUse.resultLabels.screenshot',
      value: session.latest_artifact_url,
      href: backendOrigin + session.latest_artifact_url,
      meta: session.latest_screen_summary || undefined,
    });
  }

  for (const action of session.actions) {
    const output = action.output_payload || {};
    const input = action.input_payload || {};

    if (action.tool_name === 'fs_write_text') {
      const pathValue = String(output.path ?? input.path ?? '').trim();
      if (pathValue) {
        items.push({
          key: `${action.id}:file`,
          labelKey: 'computerUse.resultLabels.file',
          value: pathValue,
          meta: getToolOutputSummary(output) || undefined,
        });
      }
    }

    if (action.tool_name === 'computer_open_url' || action.tool_name === 'browser_navigate') {
      const urlValue = String(output.url ?? input.url ?? '').trim();
      if (urlValue) {
        items.push({
          key: `${action.id}:url`,
          labelKey: 'computerUse.resultLabels.url',
          value: urlValue,
          href: urlValue,
          meta: getToolOutputSummary(output) || undefined,
        });
      }
    }

    if (action.tool_name === 'computer_open_app') {
      const appName = String(output.app_name ?? input.app_name ?? input.name ?? '').trim();
      if (appName) {
        items.push({
          key: `${action.id}:app`,
          labelKey: 'computerUse.resultLabels.app',
          value: appName,
          meta: getToolOutputSummary(output) || undefined,
        });
      }
    }
  }

  const deduped = new Map<string, ComputerUseResultItem>();
  for (const item of items) {
    const key = `${item.labelKey}:${item.value}`;
    if (!deduped.has(key)) {
      deduped.set(key, item);
    }
  }

  return Array.from(deduped.values()).slice(-8).reverse();
}

export function sortActionsChronologically(actions: ComputerUseAction[]): ComputerUseAction[] {
  return [...actions].sort((left, right) => (left.created_at || 0) - (right.created_at || 0));
}
