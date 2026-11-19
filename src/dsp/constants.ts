/**
 * Tunable DSP constants. Every value states its unit and why it was chosen.
 * Nothing in `src/dsp` may touch the DOM, Web Audio or the clock.
 */

/** Analysis tick period (ms). ~20 Hz keeps CPU low while reacting inside the 150 ms budget. */
export const TICK_MS = 50;

/** Momentary loudness window (ms), as in EBU R128 / ITU-R BS.1770. */
export const MOMENTARY_WINDOW_MS = 400;

/** Windows quieter than this (LUFS-like units) count as silence and are never boosted. */
export const ABSOLUTE_GATE_LUFS = -60;

/** Dead band (dB): corrections smaller than this are ignored so the gain does not jitter. */
export const HYSTERESIS_DB = 1;

/** Max rate gain may rise (dB/s). Slow, so quiet moments do not "pump" up. */
export const MAX_RISE_DB_PER_SECOND = 8;

/** Max rate gain may fall (dB/s). Fast, so loud scenes are pulled down quickly. */
export const MAX_FALL_DB_PER_SECOND = 60;

/** |gain| (dB) at or above which the UI reports "lowering"/"raising" instead of "stable". */
export const STATUS_GAIN_THRESHOLD_DB = 1;

/** Fastest/slowest allowed smoothing time constants (ms). */
export const MIN_TIME_CONSTANT_MS = 10;

/** Target volume slider range (percent). */
export const TARGET_PERCENT_MIN = 20;
export const TARGET_PERCENT_MAX = 100;

/** Anchor for the slider → loudness mapping: 68 % equals -14 LUFS (matches the design). */
export const TARGET_ANCHOR_PERCENT = 68;
export const TARGET_ANCHOR_LUFS = -14;

/** Loudness change (LUFS) per slider percent. */
export const TARGET_LUFS_PER_PERCENT = 0.25;

/** Hearing-safety ranges (dB). */
export const MAX_BOOST_DB_LIMIT = 12;
export const MAX_REDUCTION_DB_LIMIT = 30;

/** Range the UI meters display (LUFS). */
export const METER_FLOOR_LUFS = -50;
export const METER_CEILING_LUFS = 0;
