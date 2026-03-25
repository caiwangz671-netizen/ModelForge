export const FIRST_LAUNCH_GUIDE_VERSION = '2026-03-25';
export const FIRST_LAUNCH_GUIDE_STORAGE_KEY = 'modelforge:first-launch-guide';
export const FIRST_LAUNCH_GUIDE_OPEN_EVENT = 'modelforge:first-launch-guide:open';

export function hasCompletedFirstLaunchGuide(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(FIRST_LAUNCH_GUIDE_STORAGE_KEY) === FIRST_LAUNCH_GUIDE_VERSION;
  } catch {
    return true;
  }
}

export function markFirstLaunchGuideCompleted(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FIRST_LAUNCH_GUIDE_STORAGE_KEY, FIRST_LAUNCH_GUIDE_VERSION);
  } catch {
    // Storage can fail in restricted environments; onboarding should remain non-blocking.
  }
}

export function openFirstLaunchGuide(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(FIRST_LAUNCH_GUIDE_OPEN_EVENT));
}
