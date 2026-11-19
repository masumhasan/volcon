import type { BackgroundRequest, BackgroundResponse } from '../shared/messages';
import type { ThemeMode } from '../shared/settings';

/** Returns the element with `id` or throws, so a markup typo fails loudly during development. */
export function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element;
}

export function inputById(id: string): HTMLInputElement {
  const element = byId(id);
  if (!(element instanceof HTMLInputElement)) throw new Error(`#${id} is not an <input>`);
  return element;
}

export function selectById(id: string): HTMLSelectElement {
  const element = byId(id);
  if (!(element instanceof HTMLSelectElement)) throw new Error(`#${id} is not a <select>`);
  return element;
}

export function applyTheme(theme: ThemeMode): void {
  document.documentElement.dataset['theme'] = theme;
}

/** Asks the service worker to do something only it can. Never throws. */
export async function sendToBackground(request: BackgroundRequest): Promise<BackgroundResponse> {
  try {
    const response: unknown = await chrome.runtime.sendMessage(request);
    if (typeof response === 'object' && response !== null && 'ok' in response) {
      return response.ok === true
        ? { ok: true }
        : { ok: false, reason: String('reason' in response ? response.reason : 'unknown') };
    }
  } catch {
    // fall through: the worker may be restarting
  }
  return { ok: false, reason: 'no-response' };
}
