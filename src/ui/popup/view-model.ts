import { METER_CEILING_LUFS, METER_FLOOR_LUFS } from '../../dsp/constants';
import { clamp } from '../../dsp/loudness';
import type { BlockReason, FrameStatus } from '../../shared/messages';

export type StatusKind = 'stable' | 'lowering' | 'raising' | 'idle' | 'warning' | 'off';

export interface StatusView {
  readonly kind: StatusKind;
  /** i18n message key for the status sentence. */
  readonly messageKey: string;
  /** Gain to display next to the sentence, or null to hide it. */
  readonly gainDb: number | null;
}

export interface StatusInput {
  /** The tab is a page the extension cannot run on (chrome://, store, etc.). */
  readonly restricted: boolean;
  /** Injecting into the tab failed (no access). */
  readonly noAccess: boolean;
  readonly enabled: boolean;
  readonly paused: boolean;
  readonly siteEnabled: boolean;
  /** Best status across the tab's frames, or null if none reported. */
  readonly frame: FrameStatus | null;
}

const BLOCK_MESSAGES: Readonly<Record<BlockReason, string>> = {
  drm: 'statusBlockedDrm',
  cors: 'statusBlockedCors',
  'in-use': 'statusBlockedInUse',
  unsupported: 'statusBlockedUnsupported',
};

/** Turns raw state into the single sentence + style the popup shows. Pure, so it is tested. */
export function describeStatus(input: StatusInput): StatusView {
  if (input.restricted) return { kind: 'warning', messageKey: 'statusRestricted', gainDb: null };
  if (input.noAccess) return { kind: 'warning', messageKey: 'statusNoAccess', gainDb: null };
  if (!input.enabled) return { kind: 'off', messageKey: 'statusOff', gainDb: null };
  if (input.paused) return { kind: 'off', messageKey: 'statusPaused', gainDb: null };
  if (!input.siteEnabled) return { kind: 'off', messageKey: 'statusSiteOff', gainDb: null };

  const frame = input.frame;
  if (!frame || frame.mediaState === 'none') {
    return { kind: 'idle', messageKey: 'statusNoMedia', gainDb: null };
  }
  switch (frame.mediaState) {
    case 'blocked':
      return {
        kind: 'warning',
        messageKey: BLOCK_MESSAGES[frame.blockReason ?? 'unsupported'],
        gainDb: null,
      };
    case 'error':
      return { kind: 'warning', messageKey: 'statusError', gainDb: null };
    case 'idle':
    case 'armed':
      return { kind: 'idle', messageKey: 'statusArmed', gainDb: null };
    case 'running':
      break;
  }
  switch (frame.gain) {
    case 'lowering':
      return { kind: 'lowering', messageKey: 'statusLowering', gainDb: frame.gainDb };
    case 'raising':
      return { kind: 'raising', messageKey: 'statusRaising', gainDb: frame.gainDb };
    case 'silent':
      return { kind: 'idle', messageKey: 'statusSilent', gainDb: null };
    case 'stable':
      return { kind: 'stable', messageKey: 'statusStable', gainDb: frame.gainDb };
  }
}

/** Position (0–1) of a loudness value on the meter scale. Unknown/silent maps to 0. */
export function meterFraction(lufs: number | null): number {
  if (lufs === null) return 0;
  return clamp((lufs - METER_FLOOR_LUFS) / (METER_CEILING_LUFS - METER_FLOOR_LUFS), 0, 1);
}

/** Formats decibels with one decimal and an explicit sign, e.g. `-7.2` or `+3.0`. */
export function formatDb(db: number): string {
  const rounded = Math.round(db * 10) / 10;
  const text = Math.abs(rounded).toFixed(1);
  if (rounded > 0) return `+${text}`;
  if (rounded < 0) return `-${text}`;
  return text;
}

/** Ranks frame statuses so the popup shows the most relevant one. */
export function pickFrame(frames: Iterable<FrameStatus>): FrameStatus | null {
  const rank = { running: 5, armed: 4, blocked: 3, error: 2, idle: 1, none: 0 } as const;
  let best: FrameStatus | null = null;
  for (const frame of frames) {
    if (!best || rank[frame.mediaState] > rank[best.mediaState]) best = frame;
  }
  return best;
}
