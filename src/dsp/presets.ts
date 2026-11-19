import {
  MAX_BOOST_DB_LIMIT,
  MAX_REDUCTION_DB_LIMIT,
  TARGET_ANCHOR_LUFS,
  TARGET_ANCHOR_PERCENT,
  TARGET_LUFS_PER_PERCENT,
  TARGET_PERCENT_MAX,
  TARGET_PERCENT_MIN,
} from './constants';
import type { GainControllerConfig } from './gain-controller';
import { clamp } from './loudness';

export type PresetName = 'night' | 'normal' | 'cinema' | 'custom';
export type LimiterStrength = 'low' | 'medium' | 'high';

/** The user-tunable values a preset controls. */
export interface TuningValues {
  readonly targetPercent: number;
  readonly maxBoostDb: number;
  readonly maxReductionDb: number;
  /** 0 = smooth/slow … 1 = instant. */
  readonly reactionSpeed: number;
  readonly limiter: LimiterStrength;
}

export const PRESET_VALUES: Readonly<Record<Exclude<PresetName, 'custom'>, TuningValues>> = {
  night: {
    targetPercent: 52,
    maxBoostDb: 9,
    maxReductionDb: 30,
    reactionSpeed: 0.7,
    limiter: 'high',
  },
  normal: {
    targetPercent: 68,
    maxBoostDb: 6,
    maxReductionDb: 24,
    reactionSpeed: 0.5,
    limiter: 'medium',
  },
  cinema: {
    targetPercent: 82,
    maxBoostDb: 4,
    maxReductionDb: 12,
    reactionSpeed: 0.35,
    limiter: 'low',
  },
};

/** Parameters for the output safety limiter (a `DynamicsCompressorNode`). */
export interface LimiterParams {
  readonly thresholdDb: number;
  readonly ratio: number;
  readonly attackSeconds: number;
  readonly releaseSeconds: number;
}

export const LIMITER_PARAMS: Readonly<Record<LimiterStrength, LimiterParams>> = {
  low: { thresholdDb: -1, ratio: 20, attackSeconds: 0.003, releaseSeconds: 0.12 },
  medium: { thresholdDb: -3, ratio: 20, attackSeconds: 0.003, releaseSeconds: 0.12 },
  high: { thresholdDb: -6, ratio: 20, attackSeconds: 0.003, releaseSeconds: 0.12 },
};

/** Maps the 20–100 % target slider to a loudness target (LUFS-like). 68 % → −14. */
export function targetPercentToLufs(percent: number): number {
  const p = clamp(percent, TARGET_PERCENT_MIN, TARGET_PERCENT_MAX);
  return TARGET_ANCHOR_LUFS + (p - TARGET_ANCHOR_PERCENT) * TARGET_LUFS_PER_PERCENT;
}

/** Maps reaction speed (0 smooth … 1 instant) to attack/release time constants (ms). */
export function reactionSpeedToTimes(speed: number): { attackMs: number; releaseMs: number } {
  const s = clamp(speed, 0, 1);
  return {
    attackMs: 250 - 200 * s, // 250 ms … 50 ms
    releaseMs: 3000 - 2400 * s, // 3000 ms … 600 ms
  };
}

/** Builds the controller configuration from user-facing tuning values. */
export function toGainControllerConfig(values: TuningValues): GainControllerConfig {
  const { attackMs, releaseMs } = reactionSpeedToTimes(values.reactionSpeed);
  return {
    targetLufs: targetPercentToLufs(values.targetPercent),
    maxBoostDb: clamp(values.maxBoostDb, 0, MAX_BOOST_DB_LIMIT),
    maxReductionDb: clamp(values.maxReductionDb, 0, MAX_REDUCTION_DB_LIMIT),
    attackMs,
    releaseMs,
  };
}
