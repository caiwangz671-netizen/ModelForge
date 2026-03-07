import { useEffect, useRef, useCallback } from 'react';
import { matchesResidentEntry, normalizeModelName } from '@/lib/modelNames';
import { useModelStore } from '@/store/modelStore';

interface AutoModelManagerOptions {
    enabled: boolean;
    autoLoadEnabled: boolean;
    idleTimeoutMinutes: number;
    currentModel?: string;
}

/**
 * Manages model lifecycle automatically:
 * - Auto-loads the current conversation's model when entering chat
 * - Auto-unloads idle models after timeout
 */
export function useAutoModelManager({
    enabled,
    autoLoadEnabled,
    idleTimeoutMinutes,
    currentModel,
}: AutoModelManagerOptions) {
    const { runningModels, residentModels, loadModel, unloadModel, fetchRunningModels, fetchResidencyStatus } = useModelStore();
    const lastActivityRef = useRef<number>(Date.now());
    const idleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const isResidentModel = useCallback((modelName: string, residents: string[]) => {
        return residents.some((item) => matchesResidentEntry(modelName, item));
    }, []);

    useEffect(() => {
        if (!enabled) return;
        void Promise.all([fetchRunningModels(), fetchResidencyStatus()]);
    }, [enabled, fetchRunningModels, fetchResidencyStatus]);

    // Track user activity
    const markActivity = useCallback(() => {
        lastActivityRef.current = Date.now();
    }, []);

    useEffect(() => {
        if (!enabled) return;
        const events: Array<keyof WindowEventMap> = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
        const listener = () => markActivity();
        events.forEach((eventName) => window.addEventListener(eventName, listener, { passive: true }));
        return () => {
            events.forEach((eventName) => window.removeEventListener(eventName, listener));
        };
    }, [enabled, markActivity]);

    // Auto-load current model
    useEffect(() => {
        if (!enabled || !autoLoadEnabled || !currentModel) return;

        const isRunning = runningModels.some(
            (modelName) => normalizeModelName(modelName) === normalizeModelName(currentModel)
        );

        if (!isRunning) {
            const keepAlive = isResidentModel(currentModel, residentModels) ? -1 : '10m';
            loadModel(currentModel, keepAlive).catch(err => {
                console.warn('Auto-load model failed:', err);
            });
        }
    }, [enabled, autoLoadEnabled, currentModel, runningModels, residentModels, loadModel, normalizeModelName, isResidentModel]);

    // Idle timeout unload
    useEffect(() => {
        if (!enabled || idleTimeoutMinutes <= 0) return;

        idleTimerRef.current = setInterval(async () => {
            const idleMs = Date.now() - lastActivityRef.current;
            const timeoutMs = idleTimeoutMinutes * 60 * 1000;

            if (idleMs >= timeoutMs) {
                await fetchRunningModels();
                await fetchResidencyStatus();
                const { runningModels: currentRunning, residentModels: residents } = useModelStore.getState();
                let unloadedAny = false;

                for (const modelName of currentRunning) {
                    const isResident = isResidentModel(modelName, residents);
                    if (!isResident) {
                        try {
                            await unloadModel(modelName);
                            unloadedAny = true;
                        } catch {
                            // ignore
                        }
                    }
                }

                if (unloadedAny) {
                    lastActivityRef.current = Date.now();
                }
            }
        }, 60_000); // check every minute

        return () => {
            if (idleTimerRef.current) {
                clearInterval(idleTimerRef.current);
            }
        };
    }, [enabled, idleTimeoutMinutes, fetchRunningModels, fetchResidencyStatus, unloadModel, isResidentModel]);

    return { markActivity };
}
