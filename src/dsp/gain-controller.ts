import {
  ABSOLUTE_GATE_LUFS,
  HYSTERESIS_DB,
  MAX_FALL_DB_PER_SECOND,
  MAX_RISE_DB_PER_SECOND,
  MIN_TIME_CONSTANT_MS,
  STATUS_GAIN_THRESHOLD_DB,
} from './constants';
import { clamp } from './loudness';

export interface GainControllerConfig {
  /** Loudness the user wants every scene to sit at (LUFS-like). */
  readonly targetLufs: number;
  /** Largest boost allowed (dB, ≥ 0). */
  readonly maxBoostDb: number;
  /** Largest reduction allowed (dB, ≥ 0). */
  readonly maxReductionDb: number;
  /** Smoothing time constant when the gain must fall, i.e. the scene got louder (ms). */
  readonly attackMs: number;
  /** Smoothing time constant when the gain may rise, i.e. the scene got quieter (ms). */
  readonly releaseMs: number;
}

/** What the UI should tell the user. `silent` means the source is below the gate. */
export type GainStatus = 'stable' | 'lowering' | 'raising' | 'silent';

export interface GainUpdate {
  /** Gain to apply now (dB). */
  readonly gainDb: number;
  /** Gain the controller is heading for (dB). */
  readonly desiredDb: number;
  readonly status: GainStatus;
}

/**
 * Decides how much gain to apply so the *source* loudness lands on the target.
 *
 * The meter taps the signal before the gain stage, so there is no feedback loop:
 * `desired = target − sourceLoudness`, then smoothed with asymmetric ballistics
 * (fast attack, slow release), a dead band and a slew limit.
 */
export class GainController {
  private gainDb = 0;
  private config: GainControllerConfig;

  constructor(config: GainControllerConfig) {
    this.config = config;
  }

  setConfig(config: GainControllerConfig): void {
    this.config = config;
  }

  /** Returns to unity gain (used when correction is bypassed). */
  reset(): void {
    this.gainDb = 0;
  }

  get currentGainDb(): number {
    return this.gainDb;
  }

  /**
   * Advances the controller by `dtMs` given the latest source loudness.
   * Silence (below the gate, or not finite) holds the current gain and never boosts.
   */
  update(sourceLufs: number, dtMs: number): GainUpdate {
    if (!Number.isFinite(sourceLufs) || sourceLufs < ABSOLUTE_GATE_LUFS || dtMs <= 0) {
      return { gainDb: this.gainDb, desiredDb: this.gainDb, status: 'silent' };
    }

    const { targetLufs, maxBoostDb, maxReductionDb, attackMs, releaseMs } = this.config;
    const desiredDb = clamp(
      targetLufs - sourceLufs,
      -Math.max(0, maxReductionDb),
      Math.max(0, maxBoostDb),
    );
    const delta = desiredDb - this.gainDb;

    if (Math.abs(delta) >= HYSTERESIS_DB) {
      const timeConstantMs = Math.max(MIN_TIME_CONSTANT_MS, delta < 0 ? attackMs : releaseMs);
      const smoothed = delta * (1 - Math.exp(-dtMs / timeConstantMs));
      const maxStep = ((delta < 0 ? MAX_FALL_DB_PER_SECOND : MAX_RISE_DB_PER_SECOND) * dtMs) / 1000;
      this.gainDb += clamp(smoothed, -maxStep, maxStep);
    }

    return { gainDb: this.gainDb, desiredDb, status: this.classify() };
  }

  private classify(): GainStatus {
    if (this.gainDb <= -STATUS_GAIN_THRESHOLD_DB) return 'lowering';
    if (this.gainDb >= STATUS_GAIN_THRESHOLD_DB) return 'raising';
    return 'stable';
  }
}
