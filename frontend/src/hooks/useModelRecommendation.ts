import { useState, useEffect, useMemo } from 'react';
import { systemApi } from '@/services/api';
import type { HardwareInfo } from '@/services/api';
import type { LibraryModel } from '@/types';
import { useTranslation } from 'react-i18next';

export interface RecommendedModel {
    model: LibraryModel;
    bestSize: string;
    estimatedRamGB: number;
    score: number;
    reason: string;
    tier: 'perfect' | 'good' | 'possible' | 'too_large';
    fitRatio: number;
    highlights: string[];
}

const BYTES_PER_PARAM = 0.6;
const OVERHEAD_BYTES = 1.5 * 1e9;
const OS_RESERVED_BYTES = 2 * 1e9;
const IDEAL_MEMORY_RATIO = 0.72;

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

function parseSizeBillions(sizeStr: string): number | null {
    const match = sizeStr.trim().toLowerCase().match(/^([\d.]+)\s*b$/);
    if (!match) return null;
    return parseFloat(match[1]);
}

function parseRelativeAgeDays(value?: string | null): number | null {
    if (!value) return null;
    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;
    if (normalized === 'today') return 0;
    if (normalized === 'yesterday') return 1;

    const match = normalized.match(/^(\d+)\s+(minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)\s+ago$/);
    if (!match) return null;

    const amount = Number(match[1]);
    const unit = match[2];

    if (unit.startsWith('minute')) return Math.max(0, amount / 1440);
    if (unit.startsWith('hour')) return amount / 24;
    if (unit.startsWith('day')) return amount;
    if (unit.startsWith('week')) return amount * 7;
    if (unit.startsWith('month')) return amount * 30;
    if (unit.startsWith('year')) return amount * 365;
    return null;
}

function estimateRamBytes(paramBillions: number): number {
    return paramBillions * 1e9 * BYTES_PER_PARAM + OVERHEAD_BYTES;
}

function computeAvailableMemory(
    hw: HardwareInfo,
    t: (key: string, options?: Record<string, unknown>) => string,
): {
    totalForModel: number;
    isGpu: boolean;
    label: string;
} {
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

    return {
        totalForModel: hw.ram_total - OS_RESERVED_BYTES,
        isGpu: false,
        label: t('models.recommendation.memoryLabelRam', {
            size: (hw.ram_total / 1e9).toFixed(0),
        }),
    };
}

interface BrowserHardwareEstimate {
    ramBytes: number;
    label: string;
}

function detectBrowserHardware(
    t: (key: string, options?: Record<string, unknown>) => string,
): BrowserHardwareEstimate {
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';
    const isMac = /Mac/.test(platform) || /Macintosh/.test(ua);
    const isARM = /ARM/.test(ua) || (isMac && typeof navigator.hardwareConcurrency === 'number');
    const deviceMemoryGB = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
    const cpuThreads = navigator.hardwareConcurrency || 0;

    if (isMac) {
        let estimatedRamGB: number;

        if (deviceMemoryGB && deviceMemoryGB > 0) {
            if (deviceMemoryGB >= 8 && cpuThreads >= 14) {
                estimatedRamGB = 48;
            } else if (deviceMemoryGB >= 8 && cpuThreads >= 10) {
                estimatedRamGB = 32;
            } else if (deviceMemoryGB >= 8) {
                estimatedRamGB = 16;
            } else {
                estimatedRamGB = deviceMemoryGB;
            }
        } else {
            if (cpuThreads >= 16) {
                estimatedRamGB = 64;
            } else if (cpuThreads >= 14) {
                estimatedRamGB = 48;
            } else if (cpuThreads >= 12) {
                estimatedRamGB = 36;
            } else if (cpuThreads >= 10) {
                estimatedRamGB = 24;
            } else if (cpuThreads >= 8) {
                estimatedRamGB = 16;
            } else {
                estimatedRamGB = 8;
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

    if (deviceMemoryGB && deviceMemoryGB > 0) {
        const effectiveGB = deviceMemoryGB >= 8 ? 16 : deviceMemoryGB;
        return {
            ramBytes: effectiveGB * 1e9,
            label: t('models.recommendation.memoryLabelEstimateBrowser', {
                size: effectiveGB,
            }),
        };
    }

    return {
        ramBytes: 16 * 1e9,
        label: t('models.recommendation.memoryLabelFallback', { size: 16 }),
    };
}

interface SizeCandidate {
    bestSize: string;
    paramB: number;
    ramNeeded: number;
    fitRatio: number;
    fitScore: number;
}

function getPracticalityScore(paramB: number): number {
    if (paramB <= 0.5) return 0.45;
    if (paramB <= 3) return 0.72;
    if (paramB <= 8) return 0.96;
    if (paramB <= 20) return 1.0;
    if (paramB <= 40) return 0.9;
    if (paramB <= 72) return 0.78;
    if (paramB <= 120) return 0.58;
    return 0.42;
}

function findBestSize(
    sizes: string[],
    availableBytes: number,
): SizeCandidate | null {
    const parsed = sizes
        .map((s) => ({ raw: s, billions: parseSizeBillions(s) }))
        .filter((x): x is { raw: string; billions: number } => x.billions !== null)
        .sort((a, b) => a.billions - b.billions);

    if (parsed.length === 0) return null;

    let bestCandidate: SizeCandidate | null = null;

    for (const candidate of parsed) {
        const ramNeeded = estimateRamBytes(candidate.billions);
        const fitRatio = ramNeeded / availableBytes;
        const qualityScore = Math.min(1, Math.log2(candidate.billions + 1) / Math.log2(128 + 1));
        const pressureScore = fitRatio <= 1
            ? Math.max(0, 1 - Math.abs(fitRatio - IDEAL_MEMORY_RATIO) / 0.48)
            : Math.max(0, 1 - (fitRatio - 1) * 3.5);
        const fitScore = (qualityScore * 0.58) + (pressureScore * 0.42);

        if (!bestCandidate || fitScore > bestCandidate.fitScore) {
            bestCandidate = {
                bestSize: candidate.raw,
                paramB: candidate.billions,
                ramNeeded,
                fitRatio,
                fitScore,
            };
        }
    }

    return bestCandidate;
}

function percentileRank(value: number | null, values: number[]): number {
    if (value === null || values.length === 0) return 0.5;
    if (values.length === 1) return 1;
    const sorted = [...values].sort((a, b) => a - b);
    let rank = 0;
    while (rank < sorted.length && sorted[rank] <= value) {
        rank += 1;
    }
    return rank / sorted.length;
}

function hasAnyKeyword(text: string, keywords: string[]): boolean {
    return keywords.some((keyword) => text.includes(keyword));
}

function analyzeModelTraits(
    model: LibraryModel,
    t: (key: string, options?: Record<string, unknown>) => string,
): { traitScore: number; highlights: string[] } {
    const description = `${model.name} ${model.description}`.toLowerCase();
    const caps = new Set((model.capabilities || []).map((item) => item.toLowerCase()));
    const weightedHighlights: Array<{ weight: number; label: string }> = [];
    let score = 0.2;

    const addHighlight = (weight: number, labelKey: string) => {
        score += weight;
        weightedHighlights.push({ weight, label: t(labelKey) });
    };

    if (caps.has('tools')) addHighlight(0.18, 'models.recommendation.highlightTools');
    if (caps.has('thinking')) addHighlight(0.14, 'models.recommendation.highlightThinking');
    if (caps.has('vision')) addHighlight(0.08, 'models.recommendation.highlightVision');

    if (hasAnyKeyword(description, ['assistant', 'general', 'chat', 'helpful', 'everyday'])) {
        addHighlight(0.14, 'models.recommendation.highlightGeneral');
    }

    if (hasAnyKeyword(description, ['coding', 'code', 'programming', 'agentic', 'developer'])) {
        addHighlight(0.12, 'models.recommendation.highlightCode');
    }

    if (hasAnyKeyword(description, ['multilingual', 'translation', 'bilingual', '中文', 'english'])) {
        addHighlight(0.08, 'models.recommendation.highlightMultilingual');
    }

    if ((model.tag_count || 0) >= 8) {
        addHighlight(0.06, 'models.recommendation.highlightVariants');
    }

    const highlights = weightedHighlights
        .sort((a, b) => b.weight - a.weight)
        .map((item) => item.label)
        .filter((label, index, array) => array.indexOf(label) === index)
        .slice(0, 3);

    return {
        traitScore: Math.min(1, score),
        highlights,
    };
}

function buildReason(
    fit: SizeCandidate,
    availableBytes: number,
    highlights: string[],
    popularityPercentile: number,
    freshnessPercentile: number,
    t: (key: string, options?: Record<string, unknown>) => string,
): string {
    const reasonParts: string[] = [];
    const ramGB = fit.ramNeeded / 1e9;
    const freeGB = Math.max(0, (availableBytes - fit.ramNeeded) / 1e9);

    if (fit.fitRatio <= 0.62) {
        reasonParts.push(t('models.recommendation.reasonComfortableFit', {
            size: fit.bestSize,
            ram: ramGB.toFixed(1),
            free: freeGB.toFixed(1),
        }));
    } else if (fit.fitRatio <= 0.84) {
        reasonParts.push(t('models.recommendation.reasonBalancedFit', {
            size: fit.bestSize,
            ram: ramGB.toFixed(1),
            ratio: (fit.fitRatio * 100).toFixed(0),
        }));
    } else if (fit.fitRatio <= 1) {
        reasonParts.push(t('models.recommendation.reasonNearLimit', {
            size: fit.bestSize,
            ram: ramGB.toFixed(1),
        }));
    } else {
        reasonParts.push(t('models.recommendation.reasonTooLarge', {
            size: fit.bestSize,
            ram: ramGB.toFixed(1),
        }));
    }

    if (highlights.length > 0) {
        reasonParts.push(...highlights.slice(0, 2));
    }

    if (popularityPercentile >= 0.82) {
        reasonParts.push(t('models.recommendation.highlightPopular'));
    }

    if (freshnessPercentile >= 0.8) {
        reasonParts.push(t('models.recommendation.highlightFresh'));
    }

    return reasonParts.join(' · ');
}

export function useModelRecommendation(libraryModels: LibraryModel[], enabled = true) {
    const { t } = useTranslation();
    const [hardware, setHardware] = useState<HardwareInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [memoryLabel, setMemoryLabel] = useState<string>('');

    useEffect(() => {
        if (!enabled) {
            const timer = setTimeout(() => setLoading(false), 0);
            return () => clearTimeout(timer);
        }
        let cancelled = false;

        systemApi.hardware()
            .then((res) => {
                if (!cancelled) setHardware(res.data);
            })
            .catch((err) => console.warn('Hardware API unavailable, using fallback:', err))
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => { cancelled = true; };
    }, [enabled]);

    useEffect(() => {
        if (!libraryModels.length) return;
        if (hardware) {
            const mem = computeAvailableMemory(hardware, t);
            const timer = setTimeout(() => setMemoryLabel(mem.label), 0);
            return () => clearTimeout(timer);
        } else {
            const detected = detectBrowserHardware(t);
            const timer = setTimeout(() => setMemoryLabel(detected.label), 0);
            return () => clearTimeout(timer);
        }
    }, [hardware, libraryModels.length, t]);

    const recommendations = useMemo<RecommendedModel[]>(() => {
        if (!libraryModels.length) return [];

        let availableBytes: number;
        if (hardware) {
            const mem = computeAvailableMemory(hardware, t);
            availableBytes = mem.totalForModel;
        } else {
            const detected = detectBrowserHardware(t);
            availableBytes = detected.ramBytes - OS_RESERVED_BYTES;
        }

        const pullValues = libraryModels
            .map((model) => parsePullCount(model.pull_count))
            .filter((value) => value > 0);
        const freshnessValues = libraryModels
            .map((model) => parseRelativeAgeDays(model.updated))
            .filter((value): value is number => value !== null);
        const tagValues = libraryModels
            .map((model) => model.tag_count || 0)
            .filter((value) => value > 0);

        const scored: RecommendedModel[] = [];

        for (const model of libraryModels) {
            const fit = findBestSize(model.sizes, availableBytes);
            if (!fit) continue;

            const popularity = parsePullCount(model.pull_count);
            const popularityPercentile = percentileRank(popularity, pullValues);
            const updatedDays = parseRelativeAgeDays(model.updated);
            const freshnessPercentile = updatedDays === null
                ? 0.45
                : 1 - percentileRank(updatedDays, freshnessValues);
            const richnessPercentile = percentileRank(model.tag_count || 0, tagValues);
            const { traitScore, highlights } = analyzeModelTraits(model, t);

            const practicalityScore = getPracticalityScore(fit.paramB);
            const composite = (
                fit.fitScore * 0.42
                + practicalityScore * 0.18
                + traitScore * 0.18
                + popularityPercentile * 0.14
                + freshnessPercentile * 0.05
                + richnessPercentile * 0.03
            );
            const score = Math.round(composite * 100);

            let tier: RecommendedModel['tier'];
            if (fit.fitRatio <= 0.88 && score >= 58) {
                tier = 'perfect';
            } else if (fit.fitRatio <= 1.02 && score >= 44) {
                tier = 'good';
            } else if (fit.fitRatio <= 1.18) {
                tier = 'possible';
            } else {
                tier = 'too_large';
            }

            scored.push({
                model,
                bestSize: fit.bestSize,
                estimatedRamGB: fit.ramNeeded / 1e9,
                score,
                reason: buildReason(
                    fit,
                    availableBytes,
                    highlights,
                    popularityPercentile,
                    freshnessPercentile,
                    t,
                ),
                tier,
                fitRatio: fit.fitRatio,
                highlights,
            });
        }

        scored.sort((a, b) => b.score - a.score);

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

    const perfectModels = useMemo(
        () => recommendations.filter((r) => r.tier === 'perfect').slice(0, 12),
        [recommendations],
    );
    const goodModels = useMemo(
        () => recommendations.filter((r) => r.tier === 'good').slice(0, 18),
        [recommendations],
    );
    const possibleModels = useMemo(
        () => recommendations.filter((r) => r.tier === 'possible').slice(0, 24),
        [recommendations],
    );

    return {
        hardware,
        loading,
        memoryLabel,
        recommendations,
        perfectModels,
        goodModels,
        possibleModels,
    };
}
