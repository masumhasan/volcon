import { MOMENTARY_WINDOW_MS, TICK_MS } from './constants';

/** Mean of the squared samples (linear power). Returns 0 for an empty buffer. */
export function meanSquare(samples: ArrayLike<number>): number {
  const length = samples.length;
  if (length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < length; i += 1) {
    const sample = samples[i] ?? 0;
    sum += sample * sample;
  }
  return sum / length;
}

/**
 * Converts K-weighted mean-square power to LUFS-like units (ITU-R BS.1770 formula).
 * Returns -Infinity for silence.
 */
export function meanSquareToLufs(meanSquarePower: number): number {
  if (!(meanSquarePower > 0)) return Number.NEGATIVE_INFINITY;
  return -0.691 + 10 * Math.log10(meanSquarePower);
}

/** Decibels → linear amplitude ratio. */
export function dbToLinear(db: number): number {
  return 10 ** (db / 20);
}

/** Linear amplitude ratio → decibels. Returns -Infinity for 0. */
export function linearToDb(linear: number): number {
  if (!(linear > 0)) return Number.NEGATIVE_INFINITY;
  return 20 * Math.log10(linear);
}

/** Clamps `value` into `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Momentary loudness: average power over the last `windowMs`, sampled once per tick.
 * Feed it one mean-square value per tick; it returns the loudness of the window.
 */
export class MomentaryLoudness {
  private readonly values: number[];
  private index = 0;
  private filled = 0;

  constructor(windowMs: number = MOMENTARY_WINDOW_MS, tickMs: number = TICK_MS) {
    this.values = new Array<number>(Math.max(1, Math.round(windowMs / tickMs))).fill(0);
  }

  /** Adds one mean-square measurement and returns the window loudness (LUFS-like). */
  push(meanSquarePower: number): number {
    this.values[this.index] = meanSquarePower;
    this.index = (this.index + 1) % this.values.length;
    this.filled = Math.min(this.filled + 1, this.values.length);

    let sum = 0;
    for (let i = 0; i < this.filled; i += 1) sum += this.values[i] ?? 0;
    return meanSquareToLufs(sum / this.filled);
  }

  /** Forgets all history (e.g. after a pause). */
  reset(): void {
    this.values.fill(0);
    this.index = 0;
    this.filled = 0;
  }
}
