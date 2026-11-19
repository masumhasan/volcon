import type { EngineConfig } from '../audio/engine';
import { LIMITER_PARAMS, toGainControllerConfig } from '../dsp/presets';
import { logger } from '../shared/logger';
import { STATUS_PORT, type FrameStatus } from '../shared/messages';
import { DEFAULT_SETTINGS, isActiveOnHost, type Settings } from '../shared/settings';
import {
  getPausedUntil,
  loadSettings,
  onPausedUntilChanged,
  onSettingsChanged,
} from '../shared/settings-service';
import { MediaController, type ControllerSnapshot } from './media-controller';
import { MediaDiscovery } from './media-discovery';

const LOADED_MARKER = '__volumeGuardLoaded';
const STATUS_INTERVAL_MS = 100;
const MEDIA_STATE_RANK = { running: 4, armed: 3, blocked: 2, error: 1, idle: 0, none: 0 } as const;

/** Picks the most relevant controller: a playing one first, then the most advanced state. */
function pickSnapshot(snapshots: readonly ControllerSnapshot[]): ControllerSnapshot | undefined {
  return [...snapshots].sort(
    (a, b) =>
      Number(b.playing) - Number(a.playing) ||
      MEDIA_STATE_RANK[b.mediaState] - MEDIA_STATE_RANK[a.mediaState],
  )[0];
}

async function main(): Promise<void> {
  const hostname = location.hostname;
  const frame = Math.random().toString(36).slice(2, 12);
  let settings: Settings = DEFAULT_SETTINGS;
  let pausedUntil = 0;
  let pauseTimer: ReturnType<typeof setTimeout> | undefined;
  const controllers = new Map<HTMLMediaElement, MediaController>();

  const isActive = (): boolean => isActiveOnHost(settings, hostname, pausedUntil, Date.now());
  const engineConfig = (): EngineConfig => ({
    gain: toGainControllerConfig(settings),
    limiter: LIMITER_PARAMS[settings.limiter],
  });

  const buildStatus = (): FrameStatus => {
    const snapshot = pickSnapshot([...controllers.values()].map((c) => c.snapshot()));
    return {
      type: 'status',
      frame,
      mediaState: snapshot?.mediaState ?? 'none',
      blockReason: snapshot?.blockReason ?? null,
      gain: snapshot?.gain ?? 'silent',
      sourceLufs: snapshot?.sourceLufs ?? null,
      gainDb: snapshot?.gainDb ?? 0,
      active: isActive(),
    };
  };

  // Registered before any await so the popup can connect the moment injection finishes.
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== STATUS_PORT || port.sender?.id !== chrome.runtime.id) return;
    let previous = '';
    const post = (): void => {
      const status = buildStatus();
      const serialized = JSON.stringify(status);
      if (serialized === previous) return;
      previous = serialized;
      port.postMessage(status);
    };
    post();
    const timer = setInterval(post, STATUS_INTERVAL_MS);
    port.onDisconnect.addListener(() => {
      clearInterval(timer);
    });
  });

  settings = await loadSettings();
  pausedUntil = await getPausedUntil();

  const syncAll = (): void => {
    for (const controller of controllers.values()) void controller.sync();
    if (pauseTimer !== undefined) clearTimeout(pauseTimer);
    const remaining = pausedUntil - Date.now();
    if (remaining > 0) pauseTimer = setTimeout(syncAll, remaining + 50);
  };

  const discovery = new MediaDiscovery({
    onFound(element) {
      if (controllers.has(element)) return;
      const controller = new MediaController(element, {
        getEngineConfig: engineConfig,
        isActive,
      });
      controllers.set(element, controller);
      void controller.sync();
    },
    onLost(element) {
      controllers.get(element)?.destroy();
      controllers.delete(element);
    },
  });
  discovery.start();

  onSettingsChanged((next) => {
    settings = next;
    syncAll();
  });
  onPausedUntilChanged((next) => {
    pausedUntil = next;
    syncAll();
  });
  syncAll();

  // Browsers refuse to start audio without a user gesture; retry once the user interacts.
  const retry = (event: Event): void => {
    if (!event.isTrusted) return;
    for (const controller of controllers.values()) controller.retryAfterGesture();
  };
  for (const type of ['pointerdown', 'keydown'] as const) {
    document.addEventListener(type, retry, { capture: true, passive: true });
  }
}

const scope = globalThis as unknown as Record<string, unknown>;
if (!scope[LOADED_MARKER]) {
  scope[LOADED_MARKER] = true;
  main().catch((error: unknown) => {
    logger.warn('content script failed to start', error);
  });
}
