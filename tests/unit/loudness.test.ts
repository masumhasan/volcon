import { describe, expect, it } from 'vitest';
import {
  clamp,
  dbToLinear,
  linearToDb,
  meanSquare,
  meanSquareToLufs,
  MomentaryLoudness,
} from '../../src/dsp/loudness';

describe('meanSquare', () => {
  it('is 0 for empty and silent buffers', () => {
    expect(meanSquare(new Float32Array(0))).toBe(0);
    expect(meanSquare(new Float32Array(128))).toBe(0);
  });

  it('is 0.5 for a full-scale sine and 1 for a full-scale square', () => {
    const sine = Float32Array.from({ length: 4800 }, (_, i) => Math.sin((2 * Math.PI * i) / 48));
    expect(meanSquare(sine)).toBeCloseTo(0.5, 3);
    expect(meanSquare(new Float32Array(100).fill(1))).toBe(1);
  });
});

describe('meanSquareToLufs', () => {
  it('maps silence to -Infinity', () => {
    expect(meanSquareToLufs(0)).toBe(Number.NEGATIVE_INFINITY);
    expect(meanSquareToLufs(-1)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('matches the BS.1770 offset: power 1 → -0.691 LUFS', () => {
    expect(meanSquareToLufs(1)).toBeCloseTo(-0.691, 6);
  });

  it('drops 20 dB for a 10x amplitude drop', () => {
    expect(meanSquareToLufs(1) - meanSquareToLufs(0.01)).toBeCloseTo(20, 6);
  });
});

describe('db helpers', () => {
  it('round-trips', () => {
    expect(linearToDb(dbToLinear(-6))).toBeCloseTo(-6, 9);
    expect(dbToLinear(0)).toBe(1);
    expect(linearToDb(0)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('clamps', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });
});

describe('MomentaryLoudness', () => {
  it('averages over the window and forgets old values', () => {
    const meter = new MomentaryLoudness(200, 50); // 4 ticks
    for (let i = 0; i < 4; i += 1) meter.push(1);
    expect(meter.push(1)).toBeCloseTo(-0.691, 6);
    for (let i = 0; i < 4; i += 1) meter.push(0.01);
    expect(meter.push(0.01)).toBeCloseTo(-20.691, 6);
  });

  it('reports silence after reset', () => {
    const meter = new MomentaryLoudness(200, 50);
    meter.push(1);
    meter.reset();
    expect(meter.push(0)).toBe(Number.NEGATIVE_INFINITY);
  });
});
