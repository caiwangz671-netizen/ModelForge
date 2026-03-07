import { useState, useEffect, useMemo } from 'react';
import { systemApi } from '@/services/api';
import type { HardwareInfo } from '@/services/api';
import type { LibraryModel } from '@/types';
import { useTranslation } from 'react-i18next';

export interface RecommendedModel {
    model: LibraryModel;
    bestSize: string;           // e.g. "7b" — the best-fit size variant for this hardware
    estimatedRamGB: number;     // estimated RAM consumption in GB
    score: number;              // 0-100
    reason: string;
    tier: 'perfect' | 'good' | 'possible' | 'too_large';
}

// ────────────────────────────────────────────────────────────────────
// Core memory estimation model:
//   RAM needed ≈ params_B × bytes_per_param(quant) + overhead
//
// For Q4_K_M (most common default): ~0.55 bytes per parameter
// For Q5_K_M: ~0.65 bytes per parameter
// For FP16: ~2.0 bytes per parameter
// We use 0.6 as a practical average for default ollama quantization.
//
// Additional overhead for KV-cache, runtime, OS etc: ~1.5 GB
// ────────────────────────────────────────────────────────────────────

const BYTES_PER_PARAM = 0.6;         // Q4_K_M average
const OVERHEAD_BYTES = 1.5 * 1e9;    // ~1.5 GB runtime overhead
const OS_RESERVED_BYTES = 2 * 1e9;   // ~2 GB reserved for OS

/** Parse a human-readable pull count like "2.5M", "113.2K", "500" → number */
function parsePullCount(s: string | null | undefined): number {
    if (!s) return 0;
    const trimmed = s.trim().toUpperCase();
    const match = trimmed.match(/^([\d.]+)\s*([KMB]?)$/);
    if (!match) return 0;
    const num = parseFloat(match[1]);
    switch (match[2]) {
        case 'K': return num * 1_000;
        case 'M': return num * 1_000_000;
        case 'B': return num * 1_000_000_000;
        default: return num;
    }
}

/** Parse size strings like "7b", "1.5b", "70b" → billions */
function parseSizeBillions(sizeStr: string): number | null {
    const match = sizeStr.trim().toLowerCase().match(/^([\d.]+)\s*b$/);
    if (!match) return null;
    return parseFloat(match[1]);
}

/** Estimate total RAM needed to run a model of given parameter count (in billions) */
function estimateRamBytes(paramBillions: number): number {
    return paramBillions * 1e9 * BYTES_PER_PARAM + OVERHEAD_BYTES;
}

/**
 * Compute available memory for model loading.
 * - If we have GPU VRAM (NVIDIA): use VRAM as primary (models run on GPU)
 * - If Apple Silicon (unified memory): use total RAM (shared)
 * - Fallback: use system RAM minus OS reserved
 */
function computeAvailableMemory(
    hw: HardwareInfo,
    t: (key: string, options?: Record<string, unknown>) => string,
): {
    totalForModel: number;   // bytes available for model
    isGpu: boolean;          // whether we're using GPU memory
    label: string;           // human-readable label
} {
    // NVIDIA GPU with dedicated VRAM
    if (hw.gpu_vram_bytes && hw.gpu_name && !hw.gpu_name.includes('Apple')) {
        return {
            totalForModel: hw.gpu_vram_bytes - OVERHEAD_BYTES,
            isGpu: true,
            label: t('models.recommendation.memoryLabelDedicatedVram', {
                name: hw.gpu_name,
                size: (hw.gpu_vram_bytes / 1e9).toFixed(0),
            }),
        };
    }
    // Apple Silicon unified memory — model uses unified RAM
    if (hw.gpu_name && (hw.gpu_name.includes('Apple') || /M[1-9]/.test(hw.gpu_name))) {
        const usable = hw.ram_total - OS_RESERVED_BYTES;
        return {
            totalForModel: usable,
            isGpu: false,
            label: t('models.recommendation.memoryLabelUnified', {
                name: hw.gpu_name,
                size: (hw.ram_total / 1e9).toFixed(0),
            }),
        };
    }
    // CPU-only or unknown GPU — use system RAM
    return {
        totalForModel: hw.ram_total - OS_RESERVED_BYTES,
        isGpu: false,
        label: t('models.recommendation.memoryLabelRam', {
            size: (hw.ram_total / 1e9).toFixed(0),
        }),
    };
}

/**
 * For a given model with multiple size variants (e.g. "1.5b", "7b", "14b", "32b"),
 * find the largest variant that fits in available memory.
 */
function findBestSize(
    sizes: string[],
    availableBytes: number,
): { bestSize: string; paramB: number; ramNeeded: number } | null {
    // Parse all sizes to numbers and sort ascending
    const parsed = sizes
        .map(s => ({ raw: s, billions: parseSizeBillions(s) }))
        .filter((x): x is { raw: string; billions: number } => x.billions !== null)
        .sort((a, b) => a.billions - b.billions);

    if (parsed.length === 0) return null;

    // Find the largest model that fits
    let best = parsed[0]; // start with smallest as fallback
    for (const p of parsed) {
        const needed = estimateRamBytes(p.billions);
        if (needed <= availableBytes) {
            best = p; // keep upgrading as long as it fits
        }
    }

    return {
        bestSize: best.raw,
        paramB: best.billions,
        ramNeeded: estimateRamBytes(best.billions),
    };
}

// ────────────────────────────────────────────────────────────────────
// Browser-side hardware detection fallback (when backend API unavailable)
// ────────────────────────────────────────────────────────────────────

interface BrowserHardwareEstimate {
    ramBytes: number;
    label: string;
}

function detectBrowserHardware(
    t: (key: string, options?: Record<string, unknown>) => string,
): BrowserHardwareEstimate {
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';

    // Detect Apple Silicon Mac
    const isMac = /Mac/.test(platform) || /Macintosh/.test(ua);
    const isARM = /ARM/.test(ua) || (isMac && typeof navigator.hardwareConcurrency === 'number');

    // navigator.deviceMemory is available in some Chromium-based browsers (in GB, powers of 2, capped at 8)
    const deviceMemoryGB = (navigator as unknown as { deviceMemory?: number }).deviceMemory;

    // navigator.hardwareConcurrency gives us logical CPU threads
    const cpuThreads = navigator.hardwareConcurrency || 0;

    if (isMac) {
        // Apple Silicon Macs: estimate from CPU thread count (unified memory architecture)
        // M1: 8 threads → 8/16 GB, M1 Pro/Max: 10 threads → 16-64 GB
        // M2: 8 threads → 8-24 GB, M2 Pro/Max: 12 threads → 16-96 GB
        // M3: 8 threads → 8-24 GB, M3 Pro: 12 threads → 18-36 GB, M3 Max: 16 threads → 36-128 GB
        // M4: 10 threads → 16-32 GB, M4 Pro: 14 threads → 24-48 GB, M4 Max: 16 threads → 36-128 GB
        let estimatedRamGB: number;

        if (deviceMemoryGB && deviceMemoryGB > 0) {
            // deviceMemory is capped at 8 in most browsers, so treat it as a floor
            // If we see 8 GB and high thread count, likely has more
            if (deviceMemoryGB >= 8 && cpuThreads >= 14) {
                estimatedRamGB = 48; // Likely Pro/Max with ≥48GB
            } else if (deviceMemoryGB >= 8 && cpuThreads >= 10) {
                estimatedRamGB = 32; // Likely Pro or high-end base
            } else if (deviceMemoryGB >= 8) {
                estimatedRamGB = 16; // Standard config
            } else {
                estimatedRamGB = deviceMemoryGB;
            }
        } else {
            // No deviceMemory API — estimate from CPU threads
            if (cpuThreads >= 16) {
                estimatedRamGB = 64; // M3/M4 Max
            } else if (cpuThreads >= 14) {
                estimatedRamGB = 48; // M4 Pro
            } else if (cpuThreads >= 12) {
                estimatedRamGB = 36; // M2/M3 Pro
            } else if (cpuThreads >= 10) {
                estimatedRamGB = 24; // M1 Pro or M4 base
            } else if (cpuThreads >= 8) {
                estimatedRamGB = 16; // M1/M2/M3 base
            } else {
                estimatedRamGB = 8;  // Older or low-end
            }
        }

        const chipGuess = cpuThreads >= 16 ? 'Apple Silicon Max'
            : cpuThreads >= 12 ? 'Apple Silicon Pro'
                : cpuThreads >= 10 ? 'Apple Silicon Pro'
                    : 'Apple Silicon';

        return {
            ramBytes: estimatedRamGB * 1e9,
            label: isARM
                ? t('models.recommendation.memoryLabelEstimateUnified', {
                    chip: chipGuess,
                    size: estimatedRamGB,
                    threads: cpuThreads,
                })
                : t('models.recommendation.memoryLabelEstimateRam', {
                    device: 'Mac',
                    size: estimatedRamGB,
                    threads: cpuThreads,
                }),
        };
    }

    // Non-Mac: use deviceMemory if available
    if (deviceMemoryGB && deviceMemoryGB > 0) {
        // deviceMemory is capped at 8 for privacy, but still useful
        const effectiveGB = deviceMemoryGB >= 8 ? 16 : deviceMemoryGB; // assume at least 16 if maxed
        return {
            ramBytes: effectiveGB * 1e9,
            label: t('models.recommendation.memoryLabelEstimateBrowser', {
                size: effectiveGB,
            }),
        };
    }

    // Complete fallback: assume 16GB
    return {
        ramBytes: 16 * 1e9,
        label: t('models.recommendation.memoryLabelFallback', { size: 16 }),
    };
}

// ────────────────────────────────────────────────────────────────────

export function useModelRecommendation(libraryModels: LibraryModel[], enabled = true) {
    const { t } = useTranslation();
    const [hardware, setHardware] = useState<HardwareInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [memoryLabel, setMemoryLabel] = useState<string>('');

    useEffect(() => {
        if (!enabled) {
            setLoading(false);
            return;
        }
        let cancelled = false;

        systemApi.hardware()
            .then(res => {
                if (!cancelled) setHardware(res.data);
            })
            .catch(err => console.warn('Hardware API unavailable, using fallback:', err))
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => { cancelled = true; };
    }, [enabled]);

    const recommendations = useMemo<RecommendedModel[]>(() => {
        if (!libraryModels.length) return [];

        // Determine available memory for model loading
        let availableBytes: number;
        let memLabel: string;

        if (hardware) {
            const mem = computeAvailableMemory(hardware, t);
            availableBytes = mem.totalForModel;
            memLabel = mem.label;
        } else {
            // Backend unavailable — try browser-side detection
            const detected = detectBrowserHardware(t);
            availableBytes = detected.ramBytes - OS_RESERVED_BYTES;
            memLabel = detected.label;
        }

        setMemoryLabel(memLabel);

        const scored: RecommendedModel[] = [];

        for (const model of libraryModels) {
            const fit = findBestSize(model.sizes, availableBytes);
            if (!fit) continue; // No parseable sizes, skip

            const { bestSize, paramB, ramNeeded } = fit;
            const ratio = ramNeeded / availableBytes; // how much of available memory it uses
            const ramGB = ramNeeded / 1e9;

            let score = 0;
            let tier: RecommendedModel['tier'] = 'too_large';
            let reason = '';

            if (ratio <= 0.6) {
                // Uses ≤60% of available memory — very comfortable
                tier = 'perfect';
                // Higher params → higher quality → higher score, but within safe zone
                score = 85 + (paramB / 100) * 5; // slight boost for larger models
                reason = hardware
                    ? t('models.recommendation.reasonPerfectHardware', {
                        size: bestSize,
                        ram: ramGB.toFixed(1),
                        free: ((availableBytes - ramNeeded) / 1e9).toFixed(1),
                    })
                    : t('models.recommendation.reasonPerfectNoHardware', {
                        size: bestSize,
                        ram: ramGB.toFixed(1),
                    });
            } else if (ratio <= 0.8) {
                // Uses 60-80% — runs well but tighter
                tier = 'good';
                score = 65 + (paramB / 100) * 3;
                reason = hardware
                    ? t('models.recommendation.reasonGoodHardware', {
                        size: bestSize,
                        ram: ramGB.toFixed(1),
                        ratio: (ratio * 100).toFixed(0),
                    })
                    : t('models.recommendation.reasonGoodNoHardware', {
                        size: bestSize,
                        ram: ramGB.toFixed(1),
                    });
            } else if (ratio <= 1.0) {
                // Uses 80-100% — might work but tight
                tier = 'possible';
                score = 35;
                reason = t('models.recommendation.reasonPossible', {
                    size: bestSize,
                    ram: ramGB.toFixed(1),
                });
            } else {
                // Exceeds available memory
                tier = 'too_large';
                score = 5;
                reason = t('models.recommendation.reasonTooLarge', {
                    size: bestSize,
                    ram: ramGB.toFixed(1),
                });
            }

            // Popularity boost (normalized log scale, max +8 points)
            const pulls = parsePullCount(model.pull_count);
            if (pulls > 0) {
                score += Math.min(8, Math.log10(pulls) * 1.2);
            }

            scored.push({ model, bestSize, estimatedRamGB: ramGB, score, reason, tier });
        }

        // Sort by score descending
        scored.sort((a, b) => b.score - a.score);

        // Deduplicate by model name
        const seen = new Set<string>();
        const deduped: RecommendedModel[] = [];
        for (const item of scored) {
            if (!seen.has(item.model.name)) {
                seen.add(item.model.name);
                deduped.push(item);
            }
        }

        return deduped;
    }, [hardware, libraryModels, t]);

    const perfectModels = useMemo(() => recommendations.filter(r => r.tier === 'perfect'), [recommendations]);
    const goodModels = useMemo(() => recommendations.filter(r => r.tier === 'good'), [recommendations]);

    return {
        hardware,
        loading,
        memoryLabel,
        recommendations,
        perfectModels,
        goodModels,
    };
}
