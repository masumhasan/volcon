import { describe, expect, it } from 'vitest';
import type { FrameStatus } from '../../src/shared/messages';
import {
  describeStatus,
  formatDb,
  meterFraction,
  pickFrame,
  type StatusInput,
} from '../../src/ui/popup/view-model';

const frame = (patch: Partial<FrameStatus> = {}): FrameStatus => ({
  type: 'status',
  frame: 'f1',
  mediaState: 'running',
  blockReason: null,
  gain: 'stable',
  sourceLufs: -14,
  gainDb: 0,
  active: true,
  ...patch,
});

const input = (patch: Partial<StatusInput> = {}): StatusInput => ({
  restricted: false,
  noAccess: false,
  enabled: true,
  paused: false,
  siteEnabled: true,
  frame: frame(),
  ...patch,
});

describe('describeStatus', () => {
  it('reports each running gain state', () => {
    expect(describeStatus(input()).kind).toBe('stable');
    expect(describeStatus(input({ frame: frame({ gain: 'lowering', gainDb: -7.2 }) }))).toEqual({
      kind: 'lowering',
      messageKey: 'statusLowering',
      gainDb: -7.2,
    });
    expect(describeStatus(input({ frame: frame({ gain: 'raising', gainDb: 3 }) })).kind).toBe(
      'raising',
    );
    expect(describeStatus(input({ frame: frame({ gain: 'silent' }) })).messageKey).toBe(
      'statusSilent',
    );
  });

  it('puts restrictions and switches ahead of media state', () => {
    expect(describeStatus(input({ restricted: true })).messageKey).toBe('statusRestricted');
    expect(describeStatus(input({ noAccess: true })).messageKey).toBe('statusNoAccess');
    expect(describeStatus(input({ enabled: false })).messageKey).toBe('statusOff');
    expect(describeStatus(input({ paused: true })).messageKey).toBe('statusPaused');
    expect(describeStatus(input({ siteEnabled: false })).messageKey).toBe('statusSiteOff');
  });

  it('explains blocked media honestly, per reason', () => {
    const blocked = (reason: FrameStatus['blockReason']) =>
      describeStatus(input({ frame: frame({ mediaState: 'blocked', blockReason: reason }) }));
    expect(blocked('drm').messageKey).toBe('statusBlockedDrm');
    expect(blocked('cors').messageKey).toBe('statusBlockedCors');
    expect(blocked('in-use').messageKey).toBe('statusBlockedInUse');
    expect(blocked(null).kind).toBe('warning');
  });

  it('handles pages without media or not yet playing', () => {
    expect(describeStatus(input({ frame: null })).messageKey).toBe('statusNoMedia');
    expect(describeStatus(input({ frame: frame({ mediaState: 'none' }) })).messageKey).toBe(
      'statusNoMedia',
    );
    expect(describeStatus(input({ frame: frame({ mediaState: 'armed' }) })).messageKey).toBe(
      'statusArmed',
    );
  });
});

describe('meterFraction', () => {
  it('maps the meter range to 0–1 and clamps', () => {
    expect(meterFraction(null)).toBe(0);
    expect(meterFraction(-50)).toBe(0);
    expect(meterFraction(0)).toBe(1);
    expect(meterFraction(-25)).toBeCloseTo(0.5, 9);
    expect(meterFraction(-90)).toBe(0);
    expect(meterFraction(12)).toBe(1);
  });
});

describe('formatDb', () => {
  it('uses one decimal and an explicit sign', () => {
    expect(formatDb(-7.24)).toBe('-7.2');
    expect(formatDb(3)).toBe('+3.0');
    expect(formatDb(0)).toBe('0.0');
    expect(formatDb(-0.04)).toBe('0.0');
  });
});

describe('pickFrame', () => {
  it('prefers a running frame over idle ones', () => {
    const picked = pickFrame([
      frame({ frame: 'a', mediaState: 'none' }),
      frame({ frame: 'b', mediaState: 'running' }),
      frame({ frame: 'c', mediaState: 'blocked' }),
    ]);
    expect(picked?.frame).toBe('b');
    expect(pickFrame([])).toBeNull();
  });
});
