import { describe, expect, it } from 'vitest';
import { LIMITER_PARAMS, toGainControllerConfig } from '../../src/dsp/presets';
import {
  parseBackgroundRequest,
  parseCaptureConfig,
  parseOffscreenCommand,
  parseResponse,
  toOffscreenMessage,
  type CaptureConfig,
} from '../../src/shared/messages';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';

const config: CaptureConfig = {
  engine: {
    gain: toGainControllerConfig(DEFAULT_SETTINGS),
    limiter: LIMITER_PARAMS[DEFAULT_SETTINGS.limiter],
  },
  enabled: true,
  pausedUntil: 0,
};

describe('capture requests to the service worker', () => {
  it('accepts well-formed capture requests', () => {
    for (const type of ['capture-start', 'capture-stop', 'capture-state'] as const) {
      expect(parseBackgroundRequest({ type, tabId: 7 })).toEqual({ type, tabId: 7 });
    }
  });

  it('rejects bad tab ids', () => {
    for (const tabId of [-1, 1.5, '3', null, undefined, Number.NaN]) {
      expect(parseBackgroundRequest({ type: 'capture-start', tabId })).toBeNull();
    }
  });
});

describe('offscreen commands', () => {
  it('round-trips every command through toOffscreenMessage', () => {
    const commands = [
      { type: 'capture-start', tabId: 3, streamId: 'abc', config },
      { type: 'capture-config', config },
      { type: 'capture-stop', tabId: 3 },
      { type: 'capture-query', tabId: 3 },
    ] as const;
    for (const command of commands) {
      expect(parseOffscreenCommand(toOffscreenMessage(command))).toEqual(command);
    }
  });

  it('ignores messages not addressed to the offscreen document', () => {
    expect(parseOffscreenCommand({ type: 'capture-stop', tabId: 3 })).toBeNull();
    expect(
      parseOffscreenCommand({ target: 'background', type: 'capture-stop', tabId: 3 }),
    ).toBeNull();
    expect(parseOffscreenCommand(null)).toBeNull();
  });

  it('rejects malformed commands', () => {
    const base = { target: 'offscreen', type: 'capture-start', tabId: 1, config };
    expect(parseOffscreenCommand({ ...base, streamId: '' })).toBeNull();
    expect(parseOffscreenCommand({ ...base, streamId: 'x'.repeat(513) })).toBeNull();
    expect(parseOffscreenCommand({ ...base, streamId: 5 })).toBeNull();
    expect(parseOffscreenCommand({ ...base, streamId: 'ok', tabId: -2 })).toBeNull();
    expect(parseOffscreenCommand({ ...base, streamId: 'ok', config: {} })).toBeNull();
    expect(parseOffscreenCommand({ target: 'offscreen', type: 'self-destruct' })).toBeNull();
  });

  it('clamps out-of-range config values instead of trusting them', () => {
    const wild = {
      ...config,
      engine: {
        gain: { ...config.engine.gain, maxBoostDb: 999, maxReductionDb: -4, attackMs: 0 },
        limiter: { ...config.engine.limiter, ratio: 500, thresholdDb: 40 },
      },
    };
    const parsed = parseCaptureConfig(wild);
    expect(parsed?.engine.gain.maxBoostDb).toBe(12);
    expect(parsed?.engine.gain.maxReductionDb).toBe(0);
    expect(parsed?.engine.gain.attackMs).toBe(10);
    expect(parsed?.engine.limiter.ratio).toBe(20);
    expect(parsed?.engine.limiter.thresholdDb).toBe(0);
  });

  it('rejects configs with missing or non-finite fields', () => {
    expect(parseCaptureConfig({ ...config, enabled: 'yes' })).toBeNull();
    expect(parseCaptureConfig({ ...config, pausedUntil: Number.NaN })).toBeNull();
    expect(
      parseCaptureConfig({ ...config, engine: { gain: config.engine.gain, limiter: {} } }),
    ).toBeNull();
  });
});

describe('parseResponse', () => {
  it('normalises responses and never throws', () => {
    expect(parseResponse({ ok: true })).toEqual({ ok: true });
    expect(parseResponse({ ok: true, active: false })).toEqual({ ok: true, active: false });
    expect(parseResponse({ ok: false, reason: 'nope' })).toEqual({ ok: false, reason: 'nope' });
    expect(parseResponse(undefined)).toEqual({ ok: false, reason: 'no-response' });
    expect(parseResponse('garbage')).toEqual({ ok: false, reason: 'no-response' });
  });
});
