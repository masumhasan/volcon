import { logger } from '../shared/logger';
import {
  CAPTURE_PORT_PREFIX,
  parseOffscreenCommand,
  type BackgroundResponse,
  type CaptureConfig,
  type FrameStatus,
} from '../shared/messages';
import { CaptureSession } from './capture-session';

const STATUS_INTERVAL_MS = 100;
const CAPTURE_FRAME_ID = 'capture';

const sessions = new Map<number, CaptureSession>();

/** Messages and ports are only accepted from this extension's own pages. */
function isOwnPage(sender: { id?: string | undefined; url?: string | undefined }): boolean {
  return (
    sender.id === chrome.runtime.id && (sender.url ?? '').startsWith(chrome.runtime.getURL(''))
  );
}

function closeIfIdle(): void {
  if (sessions.size === 0) window.close(); // release the offscreen document when unused
}

function endSession(tabId: number): void {
  sessions.get(tabId)?.stop();
  sessions.delete(tabId);
}

function stopSession(tabId: number): void {
  endSession(tabId);
  closeIfIdle();
}

async function startSession(
  tabId: number,
  streamId: string,
  config: CaptureConfig,
): Promise<BackgroundResponse> {
  endSession(tabId); // replace any previous session for this tab, without closing the page
  try {
    // `mandatory` is how Chrome's tab-capture stream ids are redeemed; it is not in lib.dom.
    const constraints = {
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
      video: false,
    } as unknown as MediaStreamConstraints;
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    sessions.set(
      tabId,
      new CaptureSession(tabId, stream, config, () => {
        stopSession(tabId);
      }),
    );
    return { ok: true };
  } catch (error) {
    logger.warn('capture failed', error);
    closeIfIdle();
    return { ok: false, reason: 'capture-failed' };
  }
}

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  const command = parseOffscreenCommand(raw);
  if (!command) return false; // not for us (or malformed): let other listeners see it
  if (!isOwnPage(sender)) return false;

  switch (command.type) {
    case 'capture-start':
      void startSession(command.tabId, command.streamId, command.config).then(sendResponse);
      return true; // async response
    case 'capture-stop':
      stopSession(command.tabId);
      sendResponse({ ok: true } satisfies BackgroundResponse);
      return false;
    case 'capture-config':
      for (const session of sessions.values()) session.setConfig(command.config);
      sendResponse({ ok: true } satisfies BackgroundResponse);
      return false;
    case 'capture-query':
      sendResponse({ ok: true, active: sessions.has(command.tabId) } satisfies BackgroundResponse);
      return false;
  }
});

/** Popup status stream: same shape the content script sends, so the popup reuses its code. */
chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith(CAPTURE_PORT_PREFIX) || !isOwnPage(port.sender ?? {})) return;
  const tabId = Number(port.name.slice(CAPTURE_PORT_PREFIX.length));
  let previous = '';
  const post = (): void => {
    const session = sessions.get(tabId);
    if (!session) return;
    const { sourceLufs, gainDb, status } = session.status;
    const message: FrameStatus = {
      type: 'status',
      frame: CAPTURE_FRAME_ID,
      mediaState: 'running',
      blockReason: null,
      gain: status,
      sourceLufs,
      gainDb,
      active: session.active,
    };
    const serialized = JSON.stringify(message);
    if (serialized === previous) return;
    previous = serialized;
    port.postMessage(message);
  };
  post();
  const timer = setInterval(post, STATUS_INTERVAL_MS);
  port.onDisconnect.addListener(() => {
    clearInterval(timer);
  });
});
