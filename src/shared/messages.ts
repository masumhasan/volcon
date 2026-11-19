import type { GainStatus } from '../dsp/gain-controller';

/** Name of the long-lived port a popup opens to a tab to stream live status. */
export const STATUS_PORT = 'vg-status';

/** Why audio could not be processed on a page. */
export type BlockReason = 'drm' | 'cors' | 'unsupported' | 'in-use';

export type MediaState = 'none' | 'idle' | 'armed' | 'running' | 'blocked' | 'error';

/** Live status one frame reports to the popup. */
export interface FrameStatus {
  readonly type: 'status';
  /** Random id of the reporting frame; the popup receives all frames on one port. */
  readonly frame: string;
  readonly mediaState: MediaState;
  readonly blockReason: BlockReason | null;
  readonly gain: GainStatus;
  /** Source loudness (LUFS-like) or null when unknown/silent. */
  readonly sourceLufs: number | null;
  /** Gain currently applied (dB). */
  readonly gainDb: number;
  /** Whether correction is switched on for this page right now. */
  readonly active: boolean;
}

/** Requests the popup/options pages may send to the service worker. */
export type BackgroundRequest =
  | { readonly type: 'inject-tab'; readonly tabId: number }
  | { readonly type: 'register-site'; readonly pattern: string }
  | { readonly type: 'unregister-site'; readonly pattern: string };

export type BackgroundResponse =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

const MEDIA_STATES: readonly MediaState[] = [
  'none',
  'idle',
  'armed',
  'running',
  'blocked',
  'error',
];
const BLOCK_REASONS: readonly BlockReason[] = ['drm', 'cors', 'unsupported', 'in-use'];
const GAIN_STATUSES: readonly GainStatus[] = ['stable', 'lowering', 'raising', 'silent'];
const SITE_PATTERN = /^https?:\/\/[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?\/\*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Returns the Chrome match pattern for a page URL, or null for non-web pages. */
export function toSitePattern(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return `${parsed.protocol}//${parsed.hostname}/*`;
  } catch {
    return null;
  }
}

/** Extracts the hostname from a match pattern produced by {@link toSitePattern}. */
export function hostnameOfPattern(pattern: string): string {
  return pattern.replace(/^https?:\/\//, '').replace(/\/\*$/, '');
}

export function parseBackgroundRequest(raw: unknown): BackgroundRequest | null {
  if (!isRecord(raw)) return null;
  const type = raw['type'];
  if (type === 'inject-tab') {
    const tabId = raw['tabId'];
    return typeof tabId === 'number' && Number.isInteger(tabId) && tabId >= 0
      ? { type, tabId }
      : null;
  }
  if (type === 'register-site' || type === 'unregister-site') {
    const pattern = raw['pattern'];
    return typeof pattern === 'string' && SITE_PATTERN.test(pattern) ? { type, pattern } : null;
  }
  return null;
}

export function parseFrameStatus(raw: unknown): FrameStatus | null {
  if (!isRecord(raw) || raw['type'] !== 'status') return null;
  const mediaState = MEDIA_STATES.find((s) => s === raw['mediaState']);
  const gain = GAIN_STATUSES.find((s) => s === raw['gain']);
  if (!mediaState || !gain) return null;
  const reason = raw['blockReason'];
  const sourceLufs = raw['sourceLufs'];
  const gainDb = raw['gainDb'];
  if (typeof gainDb !== 'number' || !Number.isFinite(gainDb)) return null;
  if (sourceLufs !== null && (typeof sourceLufs !== 'number' || !Number.isFinite(sourceLufs))) {
    return null;
  }
  if (typeof raw['active'] !== 'boolean') return null;
  const frame = raw['frame'];
  if (typeof frame !== 'string' || frame.length === 0 || frame.length > 64) return null;
  return {
    type: 'status',
    frame,
    mediaState,
    blockReason: BLOCK_REASONS.find((r) => r === reason) ?? null,
    gain,
    sourceLufs,
    gainDb,
    active: raw['active'],
  };
}
