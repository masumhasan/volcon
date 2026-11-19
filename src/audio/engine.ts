import { TICK_MS } from '../dsp/constants';
import { GainController, type GainControllerConfig, type GainStatus } from '../dsp/gain-controller';
import { dbToLinear, meanSquare, MomentaryLoudness } from '../dsp/loudness';
import type { LimiterParams } from '../dsp/presets';

export interface EngineConfig {
  readonly gain: GainControllerConfig;
  readonly limiter: LimiterParams;
}

export interface EngineStatus {
  /** Source loudness (LUFS-like) or null when silent. */
  readonly sourceLufs: number | null;
  readonly gainDb: number;
  readonly status: GainStatus;
}

const ANALYSER_FFT_SIZE = 4096;
/** Time constant of the Web Audio gain ramp. Keeps gain changes click-free. */
const GAIN_RAMP_SECONDS = 0.03;
/** Longest gap between ticks we trust (ms); protects against timer stalls. */
const MAX_TICK_GAP_MS = 500;

/**
 * Web Audio graph that levels one audio source:
 *
 *   source ─► K-weighting ─► analyser            (measures the *source*, before any gain)
 *   source ─► gain ─► limiter ─► destination     (applies the correction)
 *
 * The decision logic lives in `GainController` (pure); this class only wires nodes and runs
 * the measurement timer. Bypass makes the signal path transparent (unity gain, limiter off).
 *
 * Note: a stereo signal is measured after the analyser's mono down-mix, which under-reads
 * uncorrelated stereo by up to ~3 dB. The control loop is relative, so this only shifts
 * where "target" sits, not how the extension behaves.
 */
export class AudioEngine {
  private readonly shelf: BiquadFilterNode;
  private readonly highpass: BiquadFilterNode;
  private readonly analyser: AnalyserNode;
  private readonly gainNode: GainNode;
  private readonly limiter: DynamicsCompressorNode;
  private readonly samples = new Float32Array(ANALYSER_FFT_SIZE);
  private readonly meter = new MomentaryLoudness();
  private readonly controller: GainController;
  private limiterParams: LimiterParams;
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastTickMs = 0;
  private bypassed = false;
  private latest: EngineStatus = { sourceLufs: null, gainDb: 0, status: 'silent' };

  constructor(
    private readonly context: BaseAudioContext,
    private readonly source: AudioNode,
    config: EngineConfig,
    private readonly onStatus?: (status: EngineStatus) => void,
  ) {
    this.controller = new GainController(config.gain);
    this.limiterParams = config.limiter;

    // K-weighting approximation of ITU-R BS.1770: high-shelf (+4 dB) then 38 Hz high-pass.
    this.shelf = context.createBiquadFilter();
    this.shelf.type = 'highshelf';
    this.shelf.frequency.value = 1500;
    this.shelf.gain.value = 4;
    this.highpass = context.createBiquadFilter();
    this.highpass.type = 'highpass';
    this.highpass.frequency.value = 38;
    this.highpass.Q.value = -3.0103; // Butterworth (Q = 1/√2) expressed in dB

    this.analyser = context.createAnalyser();
    this.analyser.fftSize = ANALYSER_FFT_SIZE;
    this.analyser.smoothingTimeConstant = 0;

    this.gainNode = context.createGain();
    this.limiter = context.createDynamicsCompressor();
    this.limiter.knee.value = 0;
    this.applyLimiter(false);

    source.connect(this.shelf);
    this.shelf.connect(this.highpass);
    this.highpass.connect(this.analyser);
    source.connect(this.gainNode);
    this.gainNode.connect(this.limiter);
    this.limiter.connect(context.destination);
  }

  get status(): EngineStatus {
    return this.latest;
  }

  /** Starts measuring. Idempotent. */
  start(): void {
    if (this.timer !== undefined) return;
    this.lastTickMs = performance.now();
    this.timer = setInterval(() => {
      this.tick();
    }, TICK_MS);
  }

  /** Stops measuring (media paused). The gain stays where it was. Idempotent. */
  stop(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
    this.meter.reset();
  }

  setConfig(config: EngineConfig): void {
    this.controller.setConfig(config.gain);
    this.limiterParams = config.limiter;
    this.applyLimiter(this.bypassed);
  }

  /** Bypass = unity gain and a transparent limiter: the original signal, untouched. */
  setBypass(bypass: boolean): void {
    if (bypass === this.bypassed) return;
    this.bypassed = bypass;
    this.controller.reset();
    this.applyLimiter(bypass);
    if (bypass) {
      this.setGain(0);
      this.publish(null, 0, 'stable');
    }
  }

  /** Disconnects everything. Only call when the source element is gone. */
  destroy(): void {
    this.stop();
    for (const node of [this.source, this.shelf, this.highpass, this.analyser, this.gainNode]) {
      node.disconnect();
    }
    this.limiter.disconnect();
  }

  private tick(): void {
    const now = performance.now();
    const dtMs = Math.min(Math.max(now - this.lastTickMs, 1), MAX_TICK_GAP_MS);
    this.lastTickMs = now;

    this.analyser.getFloatTimeDomainData(this.samples);
    const lufs = this.meter.push(meanSquare(this.samples));

    if (this.bypassed) {
      this.publish(lufs, 0, 'stable');
      return;
    }
    const update = this.controller.update(lufs, dtMs);
    this.setGain(update.gainDb);
    this.publish(lufs, update.gainDb, update.status);
  }

  private setGain(gainDb: number): void {
    this.gainNode.gain.setTargetAtTime(
      dbToLinear(gainDb),
      this.context.currentTime,
      GAIN_RAMP_SECONDS,
    );
  }

  private applyLimiter(transparent: boolean): void {
    const params = this.limiterParams;
    this.limiter.threshold.value = transparent ? 0 : params.thresholdDb;
    this.limiter.ratio.value = transparent ? 1 : params.ratio;
    this.limiter.attack.value = params.attackSeconds;
    this.limiter.release.value = params.releaseSeconds;
  }

  private publish(lufs: number | null, gainDb: number, status: GainStatus): void {
    this.latest = {
      sourceLufs: lufs !== null && Number.isFinite(lufs) ? lufs : null,
      gainDb,
      status,
    };
    this.onStatus?.(this.latest);
  }
}
