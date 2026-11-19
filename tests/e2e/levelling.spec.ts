import { expect, test, type Page } from '@playwright/test';
import { buildWav, startServer, type TestServer } from './fixtures';
import {
  connectStatusPort,
  installContentScript,
  startOutputSampler,
  type HarnessWindow,
} from './harness';

test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });

/** Quiet dialogue, a loud action scene, then quiet dialogue again. */
const QUIET = 0.16; // ≈ -18.9 dBFS RMS
const LOUD = 0.8; // ≈ -5.0 dBFS RMS
const SEGMENTS = [
  { seconds: 6, amplitude: QUIET },
  { seconds: 5, amplitude: LOUD },
  { seconds: 6, amplitude: QUIET },
] as const;
const rmsDb = (amplitude: number): number => 10 * Math.log10((amplitude * amplitude) / 2);

let server: TestServer;

test.beforeAll(async () => {
  server = await startServer(buildWav(SEGMENTS), {
    '/': '<!doctype html><title>fixture</title><audio id="a" src="/tone.wav"></audio>',
  });
});

test.afterAll(async () => {
  await server.close();
});

async function statuses(page: Page): Promise<Record<string, unknown>[]> {
  return page.evaluate(() => (window as unknown as HarnessWindow).__statuses);
}

/** Median output level (dBFS) of samples whose playback time falls in [from, to] seconds. */
async function outputLevel(page: Page, from: number, to: number): Promise<number> {
  const values = await page.evaluate(
    ([a, b]) =>
      (window as unknown as HarnessWindow).__out
        .filter((s) => s.t >= (a ?? 0) && s.t <= (b ?? 0))
        .map((s) => s.db),
    [from, to],
  );
  expect(values.length, `no output samples between ${from}s and ${to}s`).toBeGreaterThan(5);
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

test('levels a loud scene down and a quiet scene up toward the target', async ({ page }) => {
  await installContentScript(page);
  await page.goto(server.origin);
  await connectStatusPort(page);

  await page.evaluate(() => document.querySelector('audio')?.play());
  await page.waitForFunction(
    () => {
      const list = (window as unknown as HarnessWindow).__statuses;
      return list.at(-1)?.['mediaState'] === 'running';
    },
    null,
    { timeout: 10_000 },
  );
  await startOutputSampler(page);
  await page.waitForFunction(
    () => (document.querySelector('audio')?.currentTime ?? 0) > 16.5,
    null,
    {
      timeout: 40_000,
      polling: 250,
    },
  );

  const quietIn = rmsDb(QUIET);
  const loudIn = rmsDb(LOUD);
  const quietOut = await outputLevel(page, 4.5, 5.8); // end of the first quiet scene
  const loudOut = await outputLevel(page, 9.0, 10.8); // late in the loud scene
  const quietAgain = await outputLevel(page, 15.0, 16.4);

  // The loud scene is pulled well below its original level …
  expect(loudOut).toBeLessThan(loudIn - 5);
  // … quiet dialogue is lifted above its original level …
  expect(quietOut).toBeGreaterThan(quietIn + 3);
  expect(quietAgain).toBeGreaterThan(quietIn + 3);
  // … and after levelling, loud and quiet scenes sit close together (they began 14 dB apart).
  expect(Math.abs(loudOut - quietOut)).toBeLessThan(4);
  expect(Math.abs(loudOut - quietAgain)).toBeLessThan(4);
  expect(loudIn - quietIn).toBeGreaterThan(13);

  // The reported status tells the same story and never exceeds the safety limits.
  const reported = await statuses(page);
  const gains = reported.map((s) => s['gainDb'] as number);
  expect(Math.min(...gains)).toBeLessThan(-4);
  expect(Math.max(...gains)).toBeGreaterThan(3);
  expect(Math.max(...gains)).toBeLessThanOrEqual(6.0001);
  expect(Math.min(...gains)).toBeGreaterThanOrEqual(-24.0001);
  test.info().annotations.push({
    type: 'levels',
    description:
      `source ${quietIn.toFixed(1)}/${loudIn.toFixed(1)} dBFS → output ` +
      `${quietOut.toFixed(1)}/${loudOut.toFixed(1)}/${quietAgain.toFixed(1)} dBFS`,
  });
});

test.describe('safety: media that cannot be processed is left untouched', () => {
  test('cross-origin audio without CORS is never attached', async ({ page }) => {
    const other = await startServer(buildWav(SEGMENTS), {});
    const host = await startServer(buildWav(SEGMENTS), {
      '/': `<!doctype html><audio id="a" src="${other.origin}/tone.wav"></audio>`,
    });
    try {
      await installContentScript(page);
      await page.goto(host.origin);
      await connectStatusPort(page);
      await page.evaluate(() => document.querySelector('audio')?.play());
      await page.waitForFunction(
        () => (window as unknown as HarnessWindow).__statuses.at(-1)?.['mediaState'] === 'blocked',
        null,
        { timeout: 10_000 },
      );
      const last = (await statuses(page)).at(-1);
      expect(last?.['blockReason']).toBe('cors');

      // No Web Audio graph was built, and playback continues normally.
      const state = await page.evaluate(() => {
        const audio = document.querySelector('audio');
        return {
          graph: (window as unknown as HarnessWindow).__limiter !== undefined,
          playing: audio ? !audio.paused && audio.currentTime > 0 : false,
        };
      });
      expect(state.graph).toBe(false);
      expect(state.playing).toBe(true);
    } finally {
      await host.close();
      await other.close();
    }
  });

  test('DRM-protected media is never attached', async ({ page }) => {
    await installContentScript(page);
    await page.goto(server.origin);
    await connectStatusPort(page);
    await page.evaluate(() => {
      const audio = document.querySelector('audio');
      if (!audio) return;
      // What a real EME player ends up with: a MediaKeys object set on the element.
      Object.defineProperty(audio, 'mediaKeys', { value: {} });
      void audio.play();
    });
    await page.waitForFunction(
      () => (window as unknown as HarnessWindow).__statuses.at(-1)?.['mediaState'] === 'blocked',
      null,
      { timeout: 10_000 },
    );
    expect((await statuses(page)).at(-1)?.['blockReason']).toBe('drm');
    expect(
      await page.evaluate(() => (window as unknown as HarnessWindow).__limiter),
    ).toBeUndefined();
  });
});
