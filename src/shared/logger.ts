/**
 * The only place that may print. Silent in production builds.
 * Never pass page URLs, titles or any page content to the logger.
 */
declare const __DEV__: boolean | undefined;

const enabled = typeof __DEV__ !== 'undefined' && __DEV__;

export const logger = {
  debug(message: string, ...details: unknown[]): void {
    // eslint-disable-next-line no-console
    if (enabled) console.debug(`[volume-guard] ${message}`, ...details);
  },
  warn(message: string, ...details: unknown[]): void {
    // eslint-disable-next-line no-console
    if (enabled) console.warn(`[volume-guard] ${message}`, ...details);
  },
};
