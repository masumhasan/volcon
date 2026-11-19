import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, isActiveOnHost, parseSettings } from '../../src/shared/settings';

describe('parseSettings', () => {
  it('returns defaults for garbage', () => {
    for (const raw of [undefined, null, 5, 'x', [], true]) {
      expect(parseSettings(raw)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('clamps numbers and rejects bad enums', () => {
    const parsed = parseSettings({
      targetPercent: 9999,
      maxBoostDb: -3,
      maxReductionDb: 'loud',
      reactionSpeed: 7,
      limiter: 'extreme',
      preset: 'party',
      theme: 'neon',
    });
    expect(parsed.targetPercent).toBe(100);
    expect(parsed.maxBoostDb).toBe(0);
    expect(parsed.maxReductionDb).toBe(DEFAULT_SETTINGS.maxReductionDb);
    expect(parsed.reactionSpeed).toBe(1);
    expect(parsed.limiter).toBe(DEFAULT_SETTINGS.limiter);
    expect(parsed.preset).toBe(DEFAULT_SETTINGS.preset);
    expect(parsed.theme).toBe(DEFAULT_SETTINGS.theme);
  });

  it('drops unknown fields and unsafe site keys', () => {
    const parsed = parseSettings({
      evil: 1,
      sites: { 'example.com': false, __proto__: true, 'bad host': true, 'a.b': 'yes' },
    });
    expect(parsed).not.toHaveProperty('evil');
    expect(parsed.sites).toEqual({ 'example.com': false });
  });

  it('is idempotent', () => {
    const once = parseSettings({ targetPercent: 55, sites: { 'x.com': true } });
    expect(parseSettings(once)).toEqual(once);
  });
});

describe('isActiveOnHost', () => {
  const now = 1_000_000;
  it('follows the master switch, per-site rule and pause', () => {
    expect(isActiveOnHost(DEFAULT_SETTINGS, 'a.com', 0, now)).toBe(true);
    expect(isActiveOnHost({ ...DEFAULT_SETTINGS, enabled: false }, 'a.com', 0, now)).toBe(false);
    expect(
      isActiveOnHost({ ...DEFAULT_SETTINGS, sites: { 'a.com': false } }, 'a.com', 0, now),
    ).toBe(false);
    expect(isActiveOnHost(DEFAULT_SETTINGS, 'b.com', now + 1, now)).toBe(false);
    expect(isActiveOnHost(DEFAULT_SETTINGS, 'b.com', now, now)).toBe(true);
  });
});
