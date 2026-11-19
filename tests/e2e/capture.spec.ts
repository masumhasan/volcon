import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { join } from 'node:path';
import { buildWav, startServer, type TestServer } from './fixtures';
import { captureLimiter, startOutputSampler, type HarnessWindow } from './harness';

test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });

/**
 * Compatibility mode feeds the *tab's output stream* into the same engine. Real tab capture
 * cannot be driven from automation, so this exercises the real `CaptureSession` code with a
 * real MediaStream taken from the audio element: everything except Chrome's capture handoff.
 */
const QUIET = 0.16;
const LOUD = 0.8;
const SEGMENTS = [
  { seconds: 6, amplitude: QUIET },
  { seconds: 5, amplitude: LOUD },
  { seconds: 6, amplitude: QUIET },
] as const;

let server: TestServer;
let sessionBundle = '';

test.beforeAll(async () => {
  server = await startServer(buildWav(SEGMENTS), {
    '/': '<!doctype html><title>fixture</title><audio id="a" src="/tone.wav"></audio>',
  });
  const result = await build({
    stdin: {
      contents: `import { CaptureSession } from './src/offscreen/capture-session';
        (window as unknown as Record<string, unknown>)['CaptureSession'] = CaptureSession;`,
      resolveDir: join(import.meta.dirname, '../..'),
      loader: 'ts',
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    write: false,
    logLevel: 'silent',
  });
  sessionBundle = result.outputFiles[0]?.text ?? '';
  expect(sessionBundle.length).toBeGreaterThan(0);
});

test.afterAll(async () => {
  await server.close();
});

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

test('a captured stream is levelled the same way as a media element', async ({ page }) => {
  await captureLimiter(page);
  await page.goto(server.origin);
  await page.addScriptTag({ content: sessionBundle });

  await page.evaluate(async () => {
    const audio = document.querySelector('audio');
    if (!audio) throw new Error('no audio element');
    audio.muted = true; // we only listen to the levelled copy
    await audio.play();
    const stream = (
      audio as HTMLMediaElement & { captureStream: () => MediaStream }
    ).captureStream();
    const config = {
      engine: {
        gain: {
          targetLufs: -14,
          maxBoostDb: 6,
          maxReductionDb: 24,
          attackMs: 150,
          releaseMs: 1800,
        },
        limiter: { thresholdDb: -3, ratio: 20, attackSeconds: 0.003, releaseSeconds: 0.12 },
      },
      enabled: true,
      pausedUntil: 0,
    };
    const Session = (window as unknown as Record<string, new (...a: unknown[]) => unknown>)[
      'CaptureSession'
    ];
    if (!Session) throw new Error('CaptureSession missing');
    (window as unknown as Record<string, unknown>)['__session'] = new Session(
      1,
      stream,
      config,
      () => undefined,
    );
  });

  await startOutputSampler(page);
  await page.waitForFunction(
    () => (document.querySelector('audio')?.currentTime ?? 0) > 16.5,
    null,
    {
      timeout: 40_000,
      polling: 250,
    },
  );

  const quietOut = await outputLevel(page, 4.5, 5.8);
  const loudOut = await outputLevel(page, 9.0, 10.8);
  const quietAgain = await outputLevel(page, 15.0, 16.4);

  // Sources were -18.9 / -4.9 dBFS (14 dB apart). After levelling they sit within a few dB.
  expect(Math.abs(loudOut - quietOut)).toBeLessThan(4);
  expect(Math.abs(loudOut - quietAgain)).toBeLessThan(4);
  expect(loudOut).toBeLessThan(-4.9 - 5);
  expect(quietOut).toBeGreaterThan(-18.9 + 3);

  // The session also reports what it is doing, and stops cleanly.
  const status = await page.evaluate(
    () =>
      (window as unknown as { __session: { status: { gainDb: number } } }).__session.status.gainDb,
  );
  expect(status).toBeGreaterThan(3);
  await page.evaluate(() => {
    (window as unknown as { __session: { stop: () => void } }).__session.stop();
  });
});
