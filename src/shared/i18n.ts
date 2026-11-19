/** Thin wrapper over `chrome.i18n`. Every user-visible string goes through here. */
export function t(key: string, ...substitutions: string[]): string {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

/**
 * Fills static markup from message keys:
 * `data-i18n` → textContent, `data-i18n-aria` → aria-label, `data-i18n-title` → title.
 */
export function applyI18n(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    el.textContent = t(el.dataset['i18n'] ?? '');
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-aria]')) {
    el.setAttribute('aria-label', t(el.dataset['i18nAria'] ?? ''));
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    el.title = t(el.dataset['i18nTitle'] ?? '');
  }
}
