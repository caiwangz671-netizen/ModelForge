export function normalizeModelName(name: string): string {
  return (name || '').trim().toLowerCase();
}

export function baseModelName(name: string): string {
  return normalizeModelName(name).split(':')[0];
}

export function resolveModelRef(name: string, version?: string | null): string {
  const normalizedName = normalizeModelName(name);
  const normalizedVersion = normalizeModelName(version || '');
  if (!normalizedName) return '';
  if (normalizedName.includes(':')) return normalizedName;
  if (normalizedVersion && normalizedVersion !== 'latest') {
    return `${normalizedName}:${normalizedVersion}`;
  }
  return normalizedName;
}

export function modelsShareBase(a: string, b: string): boolean {
  const aBase = baseModelName(a);
  const bBase = baseModelName(b);
  return Boolean(aBase && bBase && aBase === bBase);
}

export function matchesRunningModel(runningName: string, targetName: string): boolean {
  const running = normalizeModelName(runningName);
  const target = normalizeModelName(targetName);
  if (!running || !target) return false;
  if (running === target) return true;
  // Only fall back to base-name comparison when one side has no explicit tag.
  // e.g. "qwen3" matches "qwen3:latest", but "qwen3:1.7b" must NOT match "qwen3:8b".
  if (!target.includes(':') || !running.includes(':')) {
    return modelsShareBase(running, target);
  }
  return false;
}

export function matchesResidentEntry(modelName: string, residentEntry: string): boolean {
  const model = normalizeModelName(modelName);
  const resident = normalizeModelName(residentEntry);
  if (!model || !resident) return false;
  if (model === resident) return true;
  return !resident.includes(':') && modelsShareBase(model, resident);
}

export function matchesDownloadTask(
  taskModelName: string,
  taskModelVersion: string | null | undefined,
  targetName: string,
): boolean {
  const task = resolveModelRef(taskModelName, taskModelVersion);
  const target = normalizeModelName(targetName);
  if (!task || !target) return false;
  if (task === target) return true;
  if (!target.includes(':') || !task.includes(':')) {
    return modelsShareBase(task, target);
  }
  return false;
}
