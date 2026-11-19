import { describe, expect, it } from 'vitest';
import { assessMedia, type MediaFacts } from '../../src/content/media-preflight';

const origin = 'https://watch.example.com';
const facts = (patch: Partial<MediaFacts> = {}): MediaFacts => ({
  hasMediaKeys: false,
  currentSrc: 'https://watch.example.com/video.mp4',
  crossOrigin: null,
  ...patch,
});

describe('assessMedia', () => {
  it('allows same-origin and blob media', () => {
    expect(assessMedia(facts(), origin).kind).toBe('ok');
    expect(
      assessMedia(facts({ currentSrc: 'blob:https://watch.example.com/1-2' }), origin).kind,
    ).toBe('ok');
  });

  it('waits when no source is loaded yet', () => {
    expect(assessMedia(facts({ currentSrc: '' }), origin).kind).toBe('wait');
  });

  it('refuses DRM-protected media before anything else', () => {
    expect(assessMedia(facts({ hasMediaKeys: true, currentSrc: '' }), origin)).toEqual({
      kind: 'blocked',
      reason: 'drm',
    });
  });

  it('refuses cross-origin media without CORS (it would play silence)', () => {
    const cross = facts({ currentSrc: 'https://cdn.other.net/a.mp4' });
    expect(assessMedia(cross, origin)).toEqual({ kind: 'blocked', reason: 'cors' });
  });

  it('allows cross-origin media that opted into CORS', () => {
    const cross = facts({ currentSrc: 'https://cdn.other.net/a.mp4', crossOrigin: 'anonymous' });
    expect(assessMedia(cross, origin).kind).toBe('ok');
  });

  it('refuses file URLs and garbage', () => {
    expect(assessMedia(facts({ currentSrc: 'file:///c:/a.mp4' }), origin)).toEqual({
      kind: 'blocked',
      reason: 'unsupported',
    });
    expect(assessMedia(facts({ currentSrc: 'not a url' }), origin).kind).toBe('blocked');
  });
});
