import type { BlockReason } from '../shared/messages';

/** The only facts about a media element the safety check needs. */
export interface MediaFacts {
  readonly hasMediaKeys: boolean;
  readonly currentSrc: string;
  /** `null` when the element has no `crossorigin` attribute. */
  readonly crossOrigin: string | null;
}

export type Preflight =
  | { readonly kind: 'ok' }
  /** Not enough information yet (no source loaded). Try again later. */
  | { readonly kind: 'wait' }
  | { readonly kind: 'blocked'; readonly reason: BlockReason };

export function factsOf(element: HTMLMediaElement): MediaFacts {
  return {
    hasMediaKeys: element.mediaKeys !== null,
    currentSrc: element.currentSrc,
    crossOrigin: element.crossOrigin,
  };
}

/**
 * Decides whether routing an element through Web Audio is safe.
 *
 * `createMediaElementSource` cannot be undone, and for DRM-protected or cross-origin media
 * (without CORS) it outputs silence. Attaching in those cases would mute the video, so we
 * refuse up front and leave the page's audio completely untouched.
 */
export function assessMedia(facts: MediaFacts, pageOrigin: string): Preflight {
  if (facts.hasMediaKeys) return { kind: 'blocked', reason: 'drm' };
  if (facts.currentSrc === '') return { kind: 'wait' };
  if (/^(blob|data):/i.test(facts.currentSrc)) return { kind: 'ok' };

  let url: URL;
  try {
    url = new URL(facts.currentSrc);
  } catch {
    return { kind: 'blocked', reason: 'unsupported' };
  }
  if (url.protocol === 'file:') return { kind: 'blocked', reason: 'unsupported' };
  if (url.origin === pageOrigin) return { kind: 'ok' };
  // With a `crossorigin` attribute the browser enforces CORS, so the audio is readable.
  if (facts.crossOrigin !== null) return { kind: 'ok' };
  return { kind: 'blocked', reason: 'cors' };
}
