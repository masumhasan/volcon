import {
  parseBackgroundRequest,
  toSitePattern,
  type BackgroundRequest,
  type BackgroundResponse,
} from '../shared/messages';
import { loadSettings, onSettingsChanged, updateSettings } from '../shared/settings-service';
import { logger } from '../shared/logger';

const CONTENT_FILE = 'content.js';
const TOGGLE_COMMAND = 'toggle-enabled';
const BADGE_COLOR = '#484555';

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

function handle(request: BackgroundRequest): Promise<BackgroundResponse> {
  switch (request.type) {
    case 'inject-tab':
      return injectIntoTab(request.tabId);
    case 'register-site':
      return registerSite(request.pattern);
    case 'unregister-site':
      return unregisterSite(request.pattern);
  }
}

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  if (!isFromExtensionPage(sender)) return false;
  const request = parseBackgroundRequest(raw);
  if (!request) {
    sendResponse({ ok: false, reason: 'invalid-request' } satisfies BackgroundResponse);
    return false;
  }
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

onSettingsChanged((settings) => {
  void updateBadge(settings.enabled);
});

chrome.runtime.onInstalled.addListener(() => {
  // Persist normalised defaults on first install and after updates.
  void updateSettings({}).then((settings) => updateBadge(settings.enabled));
});

chrome.runtime.onStartup.addListener(() => {
  void loadSettings().then((settings) => updateBadge(settings.enabled));
});
