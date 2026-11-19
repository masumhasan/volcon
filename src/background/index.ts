import { LIMITER_PARAMS, toGainControllerConfig } from '../dsp/presets';
import { logger } from '../shared/logger';
import {
  parseBackgroundRequest,
  parseResponse,
  toOffscreenMessage,
  toSitePattern,
  type BackgroundRequest,
  type BackgroundResponse,
  type CaptureConfig,
  type OffscreenCommand,
} from '../shared/messages';
import {
  getPausedUntil,
  loadSettings,
  onPausedUntilChanged,
  onSettingsChanged,
  updateSettings,
} from '../shared/settings-service';

const CONTENT_FILE = 'content.js';
const OFFSCREEN_FILE = 'offscreen.html';
const TOGGLE_COMMAND = 'toggle-enabled';
const BADGE_COLOR = '#484555';
const OFFSCREEN_SEND_ATTEMPTS = 5;
const OFFSCREEN_RETRY_MS = 100;

/** Stable, valid id for a registered content script (ids may not contain `*` or `/`). */
function scriptIdFor(pattern: string): string {
  let hash = 5381;
  for (const char of pattern) hash = ((hash << 5) + hash + char.charCodeAt(0)) >>> 0;
  return `vg-${hash.toString(16)}`;
}

async function updateBadge(enabled: boolean): Promise<void> {
  await chrome.action.setBadgeText({ text: enabled ? '' : 'OFF' });
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
}

/** Only our own extension pages (popup, options) may talk to the worker, never page scripts. */
function isFromExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return (
    sender.id === chrome.runtime.id && (sender.url ?? '').startsWith(chrome.runtime.getURL(''))
  );
}

// ---------- content-script injection ----------

async function injectIntoTab(tabId: number): Promise<BackgroundResponse> {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || toSitePattern(tab.url) === null) return { ok: false, reason: 'restricted' };
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: [CONTENT_FILE],
    });
    return { ok: true };
  } catch (error) {
    logger.warn('inject failed', error);
    return { ok: false, reason: 'no-access' };
  }
}

async function registerSite(pattern: string): Promise<BackgroundResponse> {
  // The popup must have obtained the permission from a user gesture first.
  if (!(await chrome.permissions.contains({ origins: [pattern] }))) {
    return { ok: false, reason: 'no-permission' };
  }
  const id = scriptIdFor(pattern);
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (existing.length === 0) {
    await chrome.scripting.registerContentScripts([
      {
        id,
        matches: [pattern],
        js: [CONTENT_FILE],
        allFrames: true,
        runAt: 'document_idle',
        persistAcrossSessions: true,
      },
    ]);
  }
  return { ok: true };
}

async function unregisterSite(pattern: string): Promise<BackgroundResponse> {
  const id = scriptIdFor(pattern);
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (existing.length > 0) await chrome.scripting.unregisterContentScripts({ ids: [id] });
  await chrome.permissions.remove({ origins: [pattern] }).catch(() => false);
  return { ok: true };
}

// ---------- compatibility mode (tab capture via the offscreen document) ----------

/** The capture APIs only exist after the user grants the optional permissions. */
function captureApisAvailable(): boolean {
  return 'tabCapture' in chrome && 'offscreen' in chrome;
}

async function hasOffscreenDocument(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  return contexts.length > 0;
}

async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_FILE,
    reasons: ['USER_MEDIA'],
    justification: 'Level the audio of a tab the user asked Volume Guard to process.',
  });
}

async function buildCaptureConfig(): Promise<CaptureConfig> {
  const [settings, pausedUntil] = await Promise.all([loadSettings(), getPausedUntil()]);
  return {
    engine: { gain: toGainControllerConfig(settings), limiter: LIMITER_PARAMS[settings.limiter] },
    enabled: settings.enabled,
    pausedUntil,
  };
}

/** Sends a command to the offscreen document, retrying while its script is still starting. */
async function sendToOffscreen(command: OffscreenCommand): Promise<BackgroundResponse> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const raw: unknown = await chrome.runtime.sendMessage(toOffscreenMessage(command));
      return parseResponse(raw);
    } catch (error) {
      if (attempt >= OFFSCREEN_SEND_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, OFFSCREEN_RETRY_MS));
    }
  }
}

async function startCapture(tabId: number): Promise<BackgroundResponse> {
  if (!captureApisAvailable()) return { ok: false, reason: 'no-permission' };
  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    await ensureOffscreenDocument();
    const config = await buildCaptureConfig();
    return await sendToOffscreen({ type: 'capture-start', tabId, streamId, config });
  } catch (error) {
    logger.warn('capture start failed', error);
    return { ok: false, reason: 'capture-failed' };
  }
}

async function stopCapture(tabId: number): Promise<BackgroundResponse> {
  if (!captureApisAvailable() || !(await hasOffscreenDocument())) return { ok: true };
  return sendToOffscreen({ type: 'capture-stop', tabId });
}

async function captureState(tabId: number): Promise<BackgroundResponse> {
  if (!captureApisAvailable() || !(await hasOffscreenDocument())) {
    return { ok: true, active: false };
  }
  return sendToOffscreen({ type: 'capture-query', tabId });
}

/** Keeps running capture sessions in sync with settings (the offscreen page has no storage). */
async function pushCaptureConfig(): Promise<void> {
  if (!captureApisAvailable() || !(await hasOffscreenDocument())) return;
  await sendToOffscreen({ type: 'capture-config', config: await buildCaptureConfig() });
}

// ---------- wiring ----------

function handle(request: BackgroundRequest): Promise<BackgroundResponse> {
  switch (request.type) {
    case 'inject-tab':
      return injectIntoTab(request.tabId);
    case 'register-site':
      return registerSite(request.pattern);
    case 'unregister-site':
      return unregisterSite(request.pattern);
    case 'capture-start':
      return startCapture(request.tabId);
    case 'capture-stop':
      return stopCapture(request.tabId);
    case 'capture-state':
      return captureState(request.tabId);
  }
}

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  if (!isFromExtensionPage(sender)) return false;
  const request = parseBackgroundRequest(raw);
  if (!request) return false; // may be meant for another extension page (e.g. offscreen)
  handle(request).then(sendResponse, (error: unknown) => {
    logger.warn('request failed', error);
    sendResponse({ ok: false, reason: 'internal-error' } satisfies BackgroundResponse);
  });
  return true; // keep the channel open for the async response
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== TOGGLE_COMMAND) return;
  void loadSettings()
    .then((settings) => updateSettings({ enabled: !settings.enabled }))
    .catch((error: unknown) => {
      logger.warn('toggle failed', error);
    });
});

const pushConfigSafely = (): void => {
  void pushCaptureConfig().catch((error: unknown) => {
    logger.warn('capture config push failed', error);
  });
};

onSettingsChanged((settings) => {
  void updateBadge(settings.enabled);
  pushConfigSafely();
});
onPausedUntilChanged(pushConfigSafely);

chrome.runtime.onInstalled.addListener(() => {
  // Persist normalised defaults on first install and after updates.
  void updateSettings({}).then((settings) => updateBadge(settings.enabled));
});

chrome.runtime.onStartup.addListener(() => {
  void loadSettings().then((settings) => updateBadge(settings.enabled));
});
