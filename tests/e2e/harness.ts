import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Shapes of the globals the harness adds to the page (all browser-side). */
export interface HarnessWindow {
  __statuses: Record<string, unknown>[];
  __limiter?: AudioNode;
  __out: { t: number; db: number }[];
}

const CONTENT_SCRIPT = readFileSync(join(import.meta.dirname, '../../dist/content.js'), 'utf8');

/**
 * Records the safety limiter the engine creates, so a test can measure what actually
 * reaches the output (`startOutputSampler`). Must run before the page's scripts.
 */
export async function captureLimiter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as HarnessWindow;
    w.__statuses = [];
    w.__out = [];
    const proto = BaseAudioContext.prototype;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- invoked with .call(this) below
    const original = proto.createDynamicsCompressor;
    proto.createDynamicsCompressor = function (this: BaseAudioContext) {
      const node = original.call(this);
      w.__limiter = node;
      return node;
    };
  });
}

/**
 * Runs the *real built* content script inside a normal page by faking the few `chrome.*`
 * APIs it touches (default settings, a status port we can read). This exercises the real
 * Web Audio graph in real Chromium without needing extension permissions.
 */
export async function installContentScript(page: Page): Promise<void> {
  await captureLimiter(page);
  await page.addInitScript(() => {
    const w = window as unknown as HarnessWindow & Record<string, unknown>;
    const noop = (): void => undefined;
    (window as unknown as { chrome: unknown }).chrome = {
      runtime: {
        id: 'harness',
        onConnect: {
          addListener: (listener: (port: unknown) => void) => {
            w['__connect'] = () => {
              listener({
                name: 'vg-status',
                sender: { id: 'harness' },
                postMessage: (message: Record<string, unknown>) => w.__statuses.push(message),
                onDisconnect: { addListener: noop },
              });
            };
          },
        },
      },
      storage: {
        sync: { get: () => Promise.resolve({}) },
        local: { get: () => Promise.resolve({}) },
        onChanged: { addListener: noop, removeListener: noop },
      },
    };
  });
  await page.addInitScript({ content: CONTENT_SCRIPT });
}

/** Connects the fake status port after the page has loaded. */
export async function connectStatusPort(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __connect: () => void }).__connect();
  });
}

/** Starts sampling the RMS level (dBFS) of the sound leaving the limiter, once per 50 ms. */
export async function startOutputSampler(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as HarnessWindow;
    const limiter = w.__limiter;
    if (!limiter) throw new Error('No audio graph was created');
    const audio = document.querySelector('audio');
    if (!audio) throw new Error('No <audio> element');
    const analyser = limiter.context.createAnalyser();
    analyser.fftSize = 2048;
    limiter.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      w.__out.push({ t: audio.currentTime, db: 10 * Math.log10(sum / samples.length + 1e-12) });
    }, 50);
  });
}
