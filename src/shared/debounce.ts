export interface Debounced<Args extends unknown[]> {
  (...args: Args): void;
  /** Drops a pending call (use when a newer, authoritative write supersedes it). */
  cancel: () => void;
  /** Runs a pending call right now (use before the page closes). */
  flush: () => void;
}

/** Delays `fn` until `waitMs` after the last call. Used to batch rapid setting changes. */
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  waitMs: number,
): Debounced<Args> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Args | undefined;

  const cancel = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  };
  const flush = (): void => {
    const args = pending;
    cancel();
    if (args) fn(...args);
  };
  const debounced = (...args: Args): void => {
    pending = args;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(flush, waitMs);
  };
  return Object.assign(debounced, { cancel, flush });
}
