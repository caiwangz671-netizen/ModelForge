import { useState, useEffect } from 'react';
import { systemApi, type HardwareInfo } from '@/services/api';

export function useHardwareMonitor(pollingIntervalMs = 5000) {
    const [hardwareInfo, setHardwareInfo] = useState<HardwareInfo | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let mounted = true;

        const fetchHardware = async () => {
            try {
                const response = await systemApi.hardware();
                if (mounted) {
                    setHardwareInfo(response.data);
                    setError(null);
                }
            } catch (err) {
                if (mounted) {
                    setError(err instanceof Error ? err.message : 'Failed to fetch hardware');
                }
            }
        };

        // Initial fetch
        fetchHardware();

        // Setup polling
        const intervalId = setInterval(fetchHardware, pollingIntervalMs);

        return () => {
            mounted = false;
            clearInterval(intervalId);
        };
    }, [pollingIntervalMs]);

    return { hardwareInfo, error };
}
