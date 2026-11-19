const MEDIA_SELECTOR = 'video, audio';
const MAX_SHADOW_DEPTH = 4;
/** Minimum gap between full scans (ms). Scans may walk shadow roots, so keep them rare. */
const SCAN_THROTTLE_MS = 1000;

export interface DiscoveryHandlers {
  onFound(element: HTMLMediaElement): void;
  onLost(element: HTMLMediaElement): void;
}

function collect(root: ParentNode, found: Set<HTMLMediaElement>, depth: number): void {
  for (const element of root.querySelectorAll<HTMLMediaElement>(MEDIA_SELECTOR)) {
    found.add(element);
  }
  if (depth >= MAX_SHADOW_DEPTH) return;
  for (const element of root.querySelectorAll('*')) {
    if (element.shadowRoot) collect(element.shadowRoot, found, depth + 1);
  }
}

/**
 * Finds media elements without polling: an initial scan, a throttled scan after DOM changes
 * that add nodes, and an immediate hook on `play` (captured, so it sees light-DOM players
 * before the page does anything with them).
 */
export class MediaDiscovery {
  private readonly known = new Set<HTMLMediaElement>();
  private observer: MutationObserver | undefined;
  private scanTimer: ReturnType<typeof setTimeout> | undefined;
  private lastScanMs = Number.NEGATIVE_INFINITY;

  constructor(private readonly handlers: DiscoveryHandlers) {}

  start(): void {
    this.scan();
    this.observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.addedNodes.length > 0)) this.scheduleScan();
    });
    this.observer.observe(document, { childList: true, subtree: true });
    document.addEventListener('play', this.onPlay, true);
  }

  stop(): void {
    this.observer?.disconnect();
    document.removeEventListener('play', this.onPlay, true);
    if (this.scanTimer !== undefined) clearTimeout(this.scanTimer);
    for (const element of this.known) this.handlers.onLost(element);
    this.known.clear();
  }

  private readonly onPlay = (event: Event): void => {
    const target = event.target;
    if (target instanceof HTMLMediaElement) this.add(target);
  };

  private scheduleScan(): void {
    if (this.scanTimer !== undefined) return;
    const wait = Math.max(0, this.lastScanMs + SCAN_THROTTLE_MS - performance.now());
    this.scanTimer = setTimeout(() => {
      this.scanTimer = undefined;
      this.scan();
    }, wait);
  }

  private scan(): void {
    this.lastScanMs = performance.now();
    const found = new Set<HTMLMediaElement>();
    collect(document, found, 0);
    for (const element of found) this.add(element);
    for (const element of this.known) {
      if (!element.isConnected) {
        this.known.delete(element);
        this.handlers.onLost(element);
      }
    }
  }

  private add(element: HTMLMediaElement): void {
    if (this.known.has(element)) return;
    this.known.add(element);
    this.handlers.onFound(element);
  }
}
