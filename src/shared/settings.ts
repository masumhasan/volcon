import {
  MAX_BOOST_DB_LIMIT,
  MAX_REDUCTION_DB_LIMIT,
  TARGET_PERCENT_MAX,
  TARGET_PERCENT_MIN,
} from '../dsp/constants';
import { clamp } from '../dsp/loudness';
import {
  PRESET_VALUES,
  type LimiterStrength,
  type PresetName,
  type TuningValues,
} from '../dsp/presets';

export const SETTINGS_SCHEMA_VERSION = 1;
export const MAX_SITE_RULES = 150;

export type ThemeMode = 'system' | 'dark' | 'light';

export interface Settings extends TuningValues {
  readonly schemaVersion: typeof SETTINGS_SCHEMA_VERSION;
  /** Master switch. */
  readonly enabled: boolean;
  readonly preset: PresetName;
  readonly theme: ThemeMode;
  /** Per-site switch keyed by hostname. A missing key means "follow the master switch". */
  readonly sites: Readonly<Record<string, boolean>>;
}

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  enabled: true,
  preset: 'normal',
  theme: 'system',
  sites: {},
  ...PRESET_VALUES.normal,
};

const PRESETS: readonly PresetName[] = ['night', 'normal', 'cinema', 'custom'];
const LIMITERS: readonly LimiterStrength[] = ['low', 'medium', 'high'];
const THEMES: readonly ThemeMode[] = ['system', 'dark', 'light'];
const HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberIn(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.find((candidate) => candidate === value) ?? fallback;
}

function parseSites(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) return {};
  const entries = Object.entries(value)
    .filter(
      (entry): entry is [string, boolean] =>
        HOSTNAME_PATTERN.test(entry[0]) && typeof entry[1] === 'boolean',
    )
    .slice(0, MAX_SITE_RULES);
  return Object.fromEntries(entries);
}

/**
 * Validates stored data. Unknown fields are dropped, out-of-range numbers are clamped and
 * anything invalid falls back to the default, so corrupt storage can never crash the extension.
 */
export function parseSettings(raw: unknown): Settings {
  if (!isRecord(raw)) return DEFAULT_SETTINGS;
  const d = DEFAULT_SETTINGS;
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    enabled: typeof raw['enabled'] === 'boolean' ? raw['enabled'] : d.enabled,
    preset: oneOf(raw['preset'], PRESETS, d.preset),
    theme: oneOf(raw['theme'], THEMES, d.theme),
    sites: parseSites(raw['sites']),
    targetPercent: numberIn(
      raw['targetPercent'],
      TARGET_PERCENT_MIN,
      TARGET_PERCENT_MAX,
      d.targetPercent,
    ),
    maxBoostDb: numberIn(raw['maxBoostDb'], 0, MAX_BOOST_DB_LIMIT, d.maxBoostDb),
    maxReductionDb: numberIn(raw['maxReductionDb'], 0, MAX_REDUCTION_DB_LIMIT, d.maxReductionDb),
    reactionSpeed: numberIn(raw['reactionSpeed'], 0, 1, d.reactionSpeed),
    limiter: oneOf(raw['limiter'], LIMITERS, d.limiter),
  };
}

/** Returns `sites` without the rule for `hostname`. */
export function withoutSite(
  sites: Readonly<Record<string, boolean>>,
  hostname: string,
): Record<string, boolean> {
  return Object.fromEntries(Object.entries(sites).filter(([host]) => host !== hostname));
}

/** Whether correction should run on `hostname` right now. */
export function isActiveOnHost(
  settings: Settings,
  hostname: string,
  pausedUntil: number,
  now: number,
): boolean {
  return settings.enabled && settings.sites[hostname] !== false && now >= pausedUntil;
}
