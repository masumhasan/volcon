import type { EngineConfig } from '../audio/engine';
import type { GainStatus } from '../dsp/gain-controller';
import { clamp } from '../dsp/loudness';

/** Name of the long-lived port a popup opens to a tab to stream live status. */
export const STATUS_PORT = 'vg-status';

/** Prefix of the port a popup opens to the offscreen document (suffix: the tab id). */
export const CAPTURE_PORT_PREFIX = 'vg-capture:';

/** `target` value that marks a message as meant for the offscreen document. */
export const OFFSCREEN_TARGET = 'offscreen';

/** Why audio could not be processed on a page. */
export type BlockReason = 'drm' | 'cors' | 'unsupported' | 'in-use';

export type MediaState = 'none' | 'idle' | 'armed' | 'running' | 'blocked' | 'error';

/** Live status one frame (or a tab capture session) reports to the popup. */
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
  | { readonly type: 'unregister-site'; readonly pattern: string }
  | { readonly type: 'capture-start'; readonly tabId: number }
  | { readonly type: 'capture-stop'; readonly tabId: number }
  | { readonly type: 'capture-state'; readonly tabId: number };

export type BackgroundResponse =
  | { readonly ok: true; readonly active?: boolean }
  | { readonly ok: false; readonly reason: string };

/** Everything the offscreen document needs to level a captured tab (it has no storage access). */
export interface CaptureConfig {
  readonly engine: EngineConfig;
  readonly enabled: boolean;
  /** Epoch ms until which correction is paused (0 = not paused). */
  readonly pausedUntil: number;
}

/** Commands the service worker (or popup) sends to the offscreen document. */
export type OffscreenCommand =
  | {
      readonly type: 'capture-start';
      readonly tabId: number;
      readonly streamId: string;
      readonly config: CaptureConfig;
    }
  | { readonly type: 'capture-config'; readonly config: CaptureConfig }
  | { readonly type: 'capture-stop'; readonly tabId: number }
  | { readonly type: 'capture-query'; readonly tabId: number };

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
const MAX_STREAM_ID_LENGTH = 512;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTabId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** A finite number from `source[key]` clamped to `[min, max]`, or undefined if absent/invalid. */
function boundedNumber(
  source: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): number | undefined {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : undefined;
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
  if (
    type === 'inject-tab' ||
    type === 'capture-start' ||
    type === 'capture-stop' ||
    type === 'capture-state'
  ) {
    const tabId = raw['tabId'];
    return isTabId(tabId) ? { type, tabId } : null;
  }
  if (type === 'register-site' || type === 'unregister-site') {
    const pattern = raw['pattern'];
    return typeof pattern === 'string' && SITE_PATTERN.test(pattern) ? { type, pattern } : null;
  }
  return null;
}

/** Validates a response from the service worker or offscreen document. */
export function parseResponse(raw: unknown): BackgroundResponse {
  if (isRecord(raw) && raw['ok'] === true) {
    return typeof raw['active'] === 'boolean' ? { ok: true, active: raw['active'] } : { ok: true };
  }
  const reason = isRecord(raw) ? raw['reason'] : undefined;
  return { ok: false, reason: typeof reason === 'string' ? reason : 'no-response' };
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

/** Validates and clamps an engine configuration received over a message. */
export function parseEngineConfig(raw: unknown): EngineConfig | null {
  if (!isRecord(raw)) return null;
  const gain = raw['gain'];
  const limiter = raw['limiter'];
  if (!isRecord(gain) || !isRecord(limiter)) return null;

  const targetLufs = boundedNumber(gain, 'targetLufs', -60, 0);
  const maxBoostDb = boundedNumber(gain, 'maxBoostDb', 0, 12);
  const maxReductionDb = boundedNumber(gain, 'maxReductionDb', 0, 30);
  const attackMs = boundedNumber(gain, 'attackMs', 10, 10_000);
  const releaseMs = boundedNumber(gain, 'releaseMs', 10, 10_000);
  const thresholdDb = boundedNumber(limiter, 'thresholdDb', -100, 0);
  const ratio = boundedNumber(limiter, 'ratio', 1, 20);
  const attackSeconds = boundedNumber(limiter, 'attackSeconds', 0, 1);
  const releaseSeconds = boundedNumber(limiter, 'releaseSeconds', 0, 1);
  if (
    targetLufs === undefined ||
    maxBoostDb === undefined ||
    maxReductionDb === undefined ||
    attackMs === undefined ||
    releaseMs === undefined ||
    thresholdDb === undefined ||
    ratio === undefined ||
    attackSeconds === undefined ||
    releaseSeconds === undefined
  ) {
    return null;
  }
  return {
    gain: { targetLufs, maxBoostDb, maxReductionDb, attackMs, releaseMs },
    limiter: { thresholdDb, ratio, attackSeconds, releaseSeconds },
  };
}

export function parseCaptureConfig(raw: unknown): CaptureConfig | null {
  if (!isRecord(raw)) return null;
  const engine = parseEngineConfig(raw['engine']);
  const pausedUntil = raw['pausedUntil'];
  if (!engine || typeof raw['enabled'] !== 'boolean') return null;
  if (typeof pausedUntil !== 'number' || !Number.isFinite(pausedUntil)) return null;
  return { engine, enabled: raw['enabled'], pausedUntil };
}

/** Wraps a command so only the offscreen document acts on it. */
export function toOffscreenMessage(command: OffscreenCommand): Record<string, unknown> {
  return { target: OFFSCREEN_TARGET, ...command };
}

/** Parses a message meant for the offscreen document; null if it is not one or is malformed. */
export function parseOffscreenCommand(raw: unknown): OffscreenCommand | null {
  if (!isRecord(raw) || raw['target'] !== OFFSCREEN_TARGET) return null;
  const type = raw['type'];
  if (type === 'capture-stop' || type === 'capture-query') {
    const tabId = raw['tabId'];
    return isTabId(tabId) ? { type, tabId } : null;
  }
  if (type === 'capture-config') {
    const config = parseCaptureConfig(raw['config']);
    return config ? { type, config } : null;
  }
  if (type === 'capture-start') {
    const tabId = raw['tabId'];
    const streamId = raw['streamId'];
    const config = parseCaptureConfig(raw['config']);
    if (!isTabId(tabId) || !config) return null;
    if (typeof streamId !== 'string' || streamId.length === 0) return null;
    if (streamId.length > MAX_STREAM_ID_LENGTH) return null;
    return { type, tabId, streamId, config };
  }
  return null;
}
