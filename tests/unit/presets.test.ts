import { describe, expect, it } from 'vitest';
import {
  PRESET_VALUES,
  reactionSpeedToTimes,
  targetPercentToLufs,
  toGainControllerConfig,
} from '../../src/dsp/presets';

describe('targetPercentToLufs', () => {
  it('maps the design anchor 68 % to -14 LUFS', () => {
    expect(targetPercentToLufs(68)).toBe(-14);
  });

  it('is monotonic and clamped to the slider range', () => {
    expect(targetPercentToLufs(90)).toBeGreaterThan(targetPercentToLufs(40));
    expect(targetPercentToLufs(0)).toBe(targetPercentToLufs(20));
    expect(targetPercentToLufs(500)).toBe(targetPercentToLufs(100));
  });
});

describe('reactionSpeedToTimes', () => {
  it('is smooth at 0 and instant at 1', () => {
    expect(reactionSpeedToTimes(0)).toEqual({ attackMs: 250, releaseMs: 3000 });
    expect(reactionSpeedToTimes(1)).toEqual({ attackMs: 50, releaseMs: 600 });
  });

  it('always reacts faster to loud scenes than it recovers', () => {
    for (const speed of [0, 0.25, 0.5, 0.75, 1]) {
      const { attackMs, releaseMs } = reactionSpeedToTimes(speed);
      expect(attackMs).toBeLessThan(releaseMs);
    }
  });
});

describe('toGainControllerConfig', () => {
  it('keeps hearing-safety limits even for absurd input', () => {
    const config = toGainControllerConfig({
      ...PRESET_VALUES.normal,
      maxBoostDb: 999,
      maxReductionDb: -5,
    });
    expect(config.maxBoostDb).toBe(12);
    expect(config.maxReductionDb).toBe(0);
  });
});
