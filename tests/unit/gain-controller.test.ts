import { describe, expect, it } from 'vitest';
import { TICK_MS } from '../../src/dsp/constants';
import { GainController, type GainControllerConfig } from '../../src/dsp/gain-controller';

const config: GainControllerConfig = {
  targetLufs: -14,
  maxBoostDb: 6,
  maxReductionDb: 24,
  attackMs: 150,
  releaseMs: 1800,
};

/** Runs the controller for `seconds` at a constant source loudness; returns the last update. */
function run(controller: GainController, sourceLufs: number, seconds: number) {
  let update = controller.update(sourceLufs, TICK_MS);
  for (let t = TICK_MS; t < seconds * 1000; t += TICK_MS) {
    update = controller.update(sourceLufs, TICK_MS);
  }
  return update;
}

describe('GainController', () => {
  it('pulls a loud scene down to the target quickly', () => {
    const controller = new GainController(config);
    run(controller, -19, 6); // dialogue settles first
    const update = run(controller, -8, 1); // action scene starts
    expect(-8 + update.gainDb).toBeGreaterThan(-14 - 2);
    expect(-8 + update.gainDb).toBeLessThan(-14 + 2);
    expect(update.status).toBe('lowering');
  });

  it('lifts a quiet scene to the target, more slowly', () => {
    const controller = new GainController(config);
    run(controller, -8, 3);
    const early = run(controller, -19, 0.5);
    const settled = run(controller, -19, 6);
    expect(-19 + early.gainDb).toBeLessThan(-14 - 2); // not there yet: slow release
    expect(Math.abs(-19 + settled.gainDb - -14)).toBeLessThanOrEqual(1.5);
    expect(settled.status).toBe('raising');
  });

  it('never exceeds the boost and reduction limits', () => {
    const quiet = run(new GainController(config), -50, 30);
    expect(quiet.gainDb).toBeLessThanOrEqual(6 + 1e-9);
    const loud = run(new GainController(config), 0, 30);
    expect(loud.gainDb).toBeGreaterThanOrEqual(-24 - 1e-9);
  });

  it('never boosts silence below the gate and holds the current gain', () => {
    const controller = new GainController(config);
    const before = run(controller, -8, 3).gainDb;
    const update = controller.update(-80, TICK_MS);
    expect(update.status).toBe('silent');
    expect(update.gainDb).toBe(before);
    expect(controller.update(Number.NEGATIVE_INFINITY, TICK_MS).gainDb).toBe(before);
    expect(controller.update(Number.NaN, TICK_MS).gainDb).toBe(before);
  });

  it('ignores errors inside the dead band', () => {
    const controller = new GainController(config);
    const update = run(controller, -14.5, 5); // desired +0.5 dB: below hysteresis
    expect(update.gainDb).toBe(0);
    expect(update.status).toBe('stable');
  });

  it('does not oscillate on a steady source', () => {
    const controller = new GainController(config);
    run(controller, -20, 10);
    const gains = Array.from({ length: 100 }, () => controller.update(-20, TICK_MS).gainDb);
    expect(Math.max(...gains) - Math.min(...gains)).toBeLessThan(0.5);
  });

  it('limits how fast the gain can rise (no sudden jumps up)', () => {
    const controller = new GainController(config);
    const first = controller.update(-20, TICK_MS);
    expect(first.gainDb).toBeLessThanOrEqual((8 * TICK_MS) / 1000 + 1e-9);
  });

  it('returns to unity on reset and applies new config', () => {
    const controller = new GainController(config);
    run(controller, -8, 3);
    controller.reset();
    expect(controller.currentGainDb).toBe(0);
    controller.setConfig({ ...config, maxReductionDb: 0 });
    expect(run(controller, 0, 5).gainDb).toBe(0);
  });
});
