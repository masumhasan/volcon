import { parseSettings, type Settings } from './settings';

/**
 * The only module that touches `chrome.storage`. Settings live in `sync` (small, validated on
 * every read). The temporary pause lives in `local` because it must not roam between devices.
 */
const SETTINGS_KEY = 'settings';
const PAUSED_KEY = 'pausedUntil';

let writeQueue: Promise<unknown> = Promise.resolve();

export async function loadSettings(): Promise<Settings> {
  const stored: Record<string, unknown> = await chrome.storage.sync.get(SETTINGS_KEY);
  return parseSettings(stored[SETTINGS_KEY]);
}

/** Merges `patch` into the stored settings. Writes are serialised so rapid updates cannot race. */
export function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const run = async (): Promise<Settings> => {
    const merged = parseSettings({ ...(await loadSettings()), ...patch });
    await chrome.storage.sync.set({ [SETTINGS_KEY]: merged });
    return merged;
  };
  const next = writeQueue.then(run, run);
  writeQueue = next.catch(() => undefined);
  return next;
}

export function onSettingsChanged(listener: (settings: Settings) => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    const change = changes[SETTINGS_KEY];
    if (area === 'sync' && change) listener(parseSettings(change.newValue));
  };
  chrome.storage.onChanged.addListener(handler);
  return () => {
    chrome.storage.onChanged.removeListener(handler);
  };
}

export async function getPausedUntil(): Promise<number> {
  const stored: Record<string, unknown> = await chrome.storage.local.get(PAUSED_KEY);
  const value = stored[PAUSED_KEY];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export async function setPausedUntil(timestampMs: number): Promise<void> {
  await chrome.storage.local.set({ [PAUSED_KEY]: timestampMs });
}

export function onPausedUntilChanged(listener: (pausedUntil: number) => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    const change = changes[PAUSED_KEY];
    if (area !== 'local' || !change) return;
    const value: unknown = change.newValue;
    listener(typeof value === 'number' && Number.isFinite(value) ? value : 0);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => {
    chrome.storage.onChanged.removeListener(handler);
  };
}
