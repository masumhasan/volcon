import { chromium, expect, test, type BrowserContext } from '@playwright/test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EXTENSION_PATH = join(import.meta.dirname, '../../dist');
const SHOTS = process.env['VG_SCREENSHOT_DIR'];

let context: BrowserContext;
let extensionId = '';

test.beforeAll(async () => {
  const profile = mkdtempSync(join(tmpdir(), 'vg-profile-'));
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', // the full Chromium build (supports extensions in new headless mode)
    headless: true,
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});

test.afterAll(async () => {
  await context.close();
});

test('service worker boots and the popup renders without errors', async () => {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize({ width: 360, height: 600 });
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  await expect(page.locator('#target-value')).toHaveText('68');
  await expect(page.locator('#target-lufs')).toHaveText('-14.0 LUFS');
  await expect(page.locator('.brand-name')).toHaveText('Volume Guard');
  await expect(page.locator('.preset[aria-pressed="true"]')).toHaveAttribute(
    'data-preset',
    'normal',
  );
  // The popup is itself an extension page, so the extension correctly says it cannot run here.
  await expect(page.locator('#status-text')).toHaveText("Volume Guard can't run on this page.");

  // Steppers and presets work and persist.
  await page.click('#btn-increase');
  await expect(page.locator('#target-value')).toHaveText('70');
  await expect(page.locator('.preset[aria-pressed="true"]')).toHaveAttribute(
    'data-preset',
    'custom',
  );
  await page.click('.preset[data-preset="night"]');
  await expect(page.locator('#target-value')).toHaveText('52');

  await page.waitForTimeout(400); // let the debounced save land
  await page.reload();
  await expect(page.locator('#target-value')).toHaveText('52');
  await expect(page.locator('.preset[aria-pressed="true"]')).toHaveAttribute(
    'data-preset',
    'night',
  );

  await page.emulateMedia({ colorScheme: 'dark' });
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'popup-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'popup-light.png') });
  expect(errors).toEqual([]);
});

test('options page renders, saves and lists no sites by default', async () => {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto(`chrome-extension://${extensionId}/options.html`);

  await expect(page.locator('h1')).toHaveText('Volume Guard settings');
  await expect(page.locator('#sites-empty')).toBeVisible();
  await page.locator('#boost-range').fill('11');
  await expect(page.locator('#boost-value')).toHaveText('+11 dB');
  await expect(page.locator('#boost-warning')).toBeVisible();
  await expect(page.locator('#save-status')).toHaveText('Saved');

  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'options-dark.png'), fullPage: true });
  expect(errors).toEqual([]);
});
