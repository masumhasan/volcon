import { AudioEngine, type EngineConfig } from '../audio/engine';
import type { GainStatus } from '../dsp/gain-controller';
import { logger } from '../shared/logger';
import type { BlockReason, MediaState } from '../shared/messages';
import { ensureRunning, getAudioContext } from './audio-context';
import { assessMedia, factsOf } from './media-preflight';

export interface ControllerDeps {
  getEngineConfig(): EngineConfig;
  /** Whether correction should be applied right now (master switch, site rule, pause). */
  isActive(): boolean;
}

export interface ControllerSnapshot {
  readonly mediaState: MediaState;
  readonly blockReason: BlockReason | null;
  readonly gain: GainStatus;
  readonly sourceLufs: number | null;
  readonly gainDb: number;
  readonly playing: boolean;
}

/**
 * Owns the audio graph of one `<video>`/`<audio>` element.
 *
 * States: idle → armed → running, or blocked / error. Attaching is irreversible, so it only
 * happens once the element is playing, the page is allowed to start audio and the safety
 * pre-check passes. After that, turning correction off only switches the graph to bypass.
 */
export class MediaController {
  private state: MediaState = 'idle';
  private blockReason: BlockReason | null = null;
  private engine: AudioEngine | undefined;
  private attaching = false;
  private needsGesture = false;
  private readonly abort = new AbortController();

  constructor(
    private readonly element: HTMLMediaElement,
    private readonly deps: ControllerDeps,
  ) {
    const options = { signal: this.abort.signal };
    const resync = (): void => {
      void this.sync();
    };
    element.addEventListener('play', resync, options);
    element.addEventListener('playing', resync, options);
    element.addEventListener('canplay', resync, options);
    element.addEventListener('pause', resync, options);
    element.addEventListener('ended', resync, options);
    element.addEventListener(
      'encrypted',
      () => {
        if (!this.engine) this.block('drm');
      },
      options,
    );
    element.addEventListener(
      'loadstart',
      () => {
        // A new source may be fine even if the previous one was not.
        if (!this.engine && this.state === 'blocked') this.state = 'idle';
      },
      options,
    );
  }

  /** Brings the graph in line with the element's state and the current settings. */
  async sync(): Promise<void> {
    if (this.abort.signal.aborted) return;
    if (this.engine) {
      this.reconcile(this.engine);
      return;
    }
    if (this.state === 'blocked' || this.state === 'error') return;
    if (!this.deps.isActive()) {
      this.state = 'idle';
      return;
    }
    await this.attach();
  }

  /** Called after a trusted user gesture: retries an attach the browser had refused. */
  retryAfterGesture(): void {
    if (this.needsGesture) void this.sync();
  }

  snapshot(): ControllerSnapshot {
    const status = this.engine?.status;
    return {
      mediaState: this.state,
      blockReason: this.blockReason,
      gain: status?.status ?? 'silent',
      sourceLufs: status?.sourceLufs ?? null,
      gainDb: status?.gainDb ?? 0,
      playing: !this.element.paused && !this.element.ended,
    };
  }

  destroy(): void {
    this.abort.abort();
    this.engine?.destroy();
    this.engine = undefined;
  }

  private async attach(): Promise<void> {
    if (this.attaching) return;
    this.attaching = true;
    try {
      // Wait until the element is genuinely playing with data. A player may call play() before
      // it has attached its DRM keys; by the time data is playable, `mediaKeys` is final.
      if (this.element.paused || this.element.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
        this.state = 'armed';
        return;
      }
      if (!this.preflightPasses()) return;

      this.needsGesture = !(await ensureRunning());
      if (this.needsGesture) {
        this.state = 'armed';
        return;
      }
      // The world may have changed while we awaited.
      if (this.abort.signal.aborted || this.engine || !this.deps.isActive()) return;
      if (!this.preflightPasses()) return;

      const context = getAudioContext();
      let source: MediaElementAudioSourceNode;
      try {
        source = context.createMediaElementSource(this.element);
      } catch {
        this.block('in-use'); // the page (or another tool) already owns this element's audio
        return;
      }
      const engine = new AudioEngine(context, source, this.deps.getEngineConfig());
      this.engine = engine;
      this.state = 'running';
      this.reconcile(engine);
    } catch (error) {
      this.state = 'error';
      logger.warn('attach failed', error);
    } finally {
      this.attaching = false;
    }
  }

  /** Returns false (and updates state) when the element must not be attached. */
  private preflightPasses(): boolean {
    const result = assessMedia(factsOf(this.element), location.origin);
    if (result.kind === 'blocked') {
      this.block(result.reason);
      return false;
    }
    if (result.kind === 'wait') {
      this.state = 'armed';
      return false;
    }
    return true;
  }

  private reconcile(engine: AudioEngine): void {
    const active = this.deps.isActive();
    engine.setConfig(this.deps.getEngineConfig());
    engine.setBypass(!active);
    const playing = !this.element.paused && !this.element.ended;
    if (active && playing) engine.start();
    else engine.stop();
  }

  private block(reason: BlockReason): void {
    this.state = 'blocked';
    this.blockReason = reason;
  }
}
