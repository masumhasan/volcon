import { AudioEngine, type EngineStatus } from '../audio/engine';
import type { CaptureConfig } from '../shared/messages';

/**
 * Levels the audio of one captured tab. This is the compatibility path for media the
 * content script cannot touch (DRM, cross-origin without CORS): instead of tapping a media
 * element, we receive the tab's *output* as a MediaStream and play it back after levelling.
 *
 * Chrome mutes the original tab output while it is captured, so stopping the session (which
 * ends the stream) hands the audio back to the tab untouched.
 */
export class CaptureSession {
  private readonly context: AudioContext;
  private readonly engine: AudioEngine;
  private readonly source: MediaStreamAudioSourceNode;
  private readonly reconcileTimer: ReturnType<typeof setInterval>;
  private config: CaptureConfig;
  private stopped = false;

  constructor(
    readonly tabId: number,
    private readonly stream: MediaStream,
    config: CaptureConfig,
    onEnded: () => void,
  ) {
    this.config = config;
    this.context = new AudioContext();
    this.source = this.context.createMediaStreamSource(stream);
    this.engine = new AudioEngine(this.context, this.source, config.engine);
    void this.context.resume();

    // The stream ends when the tab closes or capture is revoked.
    for (const track of stream.getAudioTracks()) {
      track.addEventListener('ended', onEnded, { once: true });
    }

    this.reconcile();
    // Re-check the pause timer so correction resumes by itself when the pause expires.
    this.reconcileTimer = setInterval(() => {
      this.reconcile();
    }, 250);
  }

  get status(): EngineStatus {
    return this.engine.status;
  }

  /** Whether correction should be applied right now. */
  get active(): boolean {
    return this.config.enabled && Date.now() >= this.config.pausedUntil;
  }

  setConfig(config: CaptureConfig): void {
    this.config = config;
    this.engine.setConfig(config.engine);
    this.reconcile();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.reconcileTimer);
    this.engine.destroy();
    for (const track of this.stream.getTracks()) track.stop();
    void this.context.close();
  }

  private reconcile(): void {
    if (this.stopped) return;
    const active = this.active;
    this.engine.setBypass(!active);
    if (active) this.engine.start();
    else this.engine.stop();
  }
}
