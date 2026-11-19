import { describe, expect, it } from 'vitest';
import {
  hostnameOfPattern,
  parseBackgroundRequest,
  parseFrameStatus,
  toSitePattern,
} from '../../src/shared/messages';

describe('toSitePattern', () => {
  it('builds host-only patterns for web pages', () => {
    expect(toSitePattern('https://www.youtube.com/watch?v=1')).toBe('https://www.youtube.com/*');
    expect(toSitePattern('http://localhost:3000/a')).toBe('http://localhost/*');
  });

  it('rejects non-web pages and garbage', () => {
    for (const url of ['chrome://extensions', 'file:///c:/a.mp4', 'about:blank', 'nope', '']) {
      expect(toSitePattern(url)).toBeNull();
    }
  });

  it('round-trips with hostnameOfPattern', () => {
    expect(hostnameOfPattern('https://example.com/*')).toBe('example.com');
  });
});

describe('parseBackgroundRequest', () => {
  it('accepts well-formed requests', () => {
    expect(parseBackgroundRequest({ type: 'inject-tab', tabId: 4 })).toEqual({
      type: 'inject-tab',
      tabId: 4,
    });
    expect(parseBackgroundRequest({ type: 'register-site', pattern: 'https://a.com/*' })).toEqual({
      type: 'register-site',
      pattern: 'https://a.com/*',
    });
  });

  it('rejects wildcards, bad ids, unknown types and extra shapes', () => {
    const bad: unknown[] = [
      null,
      'x',
      [],
      { type: 'inject-tab', tabId: -1 },
      { type: 'inject-tab', tabId: 1.5 },
      { type: 'inject-tab', tabId: '1' },
      { type: 'register-site', pattern: '*://*/*' },
      { type: 'register-site', pattern: '<all_urls>' },
      { type: 'register-site', pattern: 'https://*.a.com/*' },
      { type: 'register-site', pattern: 'ftp://a.com/*' },
      { type: 'eval', code: '1' },
    ];
    for (const raw of bad) expect(parseBackgroundRequest(raw)).toBeNull();
  });
});

describe('parseFrameStatus', () => {
  const valid = {
    type: 'status',
    frame: 'abc123',
    mediaState: 'running',
    blockReason: null,
    gain: 'lowering',
    sourceLufs: -9.5,
    gainDb: -4.5,
    active: true,
  };

  it('accepts a valid status', () => {
    expect(parseFrameStatus(valid)).toEqual(valid);
    expect(parseFrameStatus({ ...valid, sourceLufs: null })?.sourceLufs).toBeNull();
  });

  it('rejects malformed statuses', () => {
    for (const patch of [
      { mediaState: 'exploding' },
      { gain: 'loud' },
      { gainDb: Number.NaN },
      { sourceLufs: '5' },
      { active: 'yes' },
      { frame: '' },
      { frame: 5 },
    ]) {
      expect(parseFrameStatus({ ...valid, ...patch })).toBeNull();
    }
    expect(parseFrameStatus(null)).toBeNull();
  });
});
