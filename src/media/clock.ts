// The playback clock (spec section 4.6). The audio clock leads: the timeline's time is where
// playback started plus how far the AudioContext has played since, at the playback rate,
//
//   position = start position + (currentTime − outputLatency − start time) × rate
//
// where the start time is the context time the sound for the start position was scheduled at,
// and the output latency is how far the speakers are behind the context, so the picture follows
// what you hear. When the AudioContext can't run or its time stops moving (no audio output, as on
// CI runners, or a context that stays suspended), the clock carries on from where it got to with
// performance.now() and the same math, so playback never freezes.

/** The parts of an AudioContext the clock reads. */
export interface AudioTime {
  readonly currentTime: number;
  /** Seconds from the context's time to the sound coming out; missing where unknown (Safari). */
  readonly outputLatency?: number;
}

export interface ClockSources {
  /** The shared AudioContext; null where there's none, and the clock follows performance.now(). */
  audio: AudioTime | null;
  /** performance.now(), in ms. */
  now: () => number;
  /** Called once if the clock stops following the audio. */
  onFallBack?: () => void;
}

export interface ClockStart {
  /** The timeline position to start from, in seconds. */
  position: number;
  /** 1 or 2. */
  rate: number;
  /** The context time the sound for `position` is scheduled at; ignored without an audio clock. */
  audioStart: number;
}

/** How long the audio clock may stand still before the clock stops following it. */
export const STALL_MS = 500;

export class PlaybackClock {
  private readonly sources: ClockSources;
  private following: "audio" | "performance";
  private start: ClockStart;
  /** When the clock switched to performance.now(), in ms, and the position it had then. */
  private fallBackAt = 0;
  private fallBackPosition = 0;
  /** The audio clock's last time, and when it last moved (ms). */
  private audioTime = Number.NaN;
  private audioMovedAt: number;
  /** The last position given out: the clock never goes back. */
  private last: number;

  constructor(sources: ClockSources, start: ClockStart) {
    this.sources = sources;
    this.start = start;
    this.last = start.position;
    const now = sources.now();
    this.audioMovedAt = now;
    this.following = sources.audio ? "audio" : "performance";
    if (!sources.audio) this.anchorPerformance(now, start.position);
  }

  /** Whether the clock follows the audio, or performance.now() since the audio stopped moving. */
  get source(): "audio" | "performance" {
    return this.following;
  }

  /** The timeline position now, in seconds. */
  position(): number {
    const now = this.sources.now();
    const { audio } = this.sources;
    let position: number;
    if (this.following === "audio" && audio) {
      const time = audio.currentTime;
      if (time !== this.audioTime) {
        this.audioTime = time;
        this.audioMovedAt = now;
      }
      if (now - this.audioMovedAt > STALL_MS) {
        this.following = "performance";
        this.anchorPerformance(now, this.last);
        this.sources.onFallBack?.();
        position = this.last;
      } else {
        const heard = time - latencyOf(audio) - this.start.audioStart;
        position = this.start.position + Math.max(0, heard) * this.start.rate;
      }
    } else {
      position = this.fallBackPosition + ((now - this.fallBackAt) / 1000) * this.start.rate;
    }
    this.last = Math.max(this.last, position);
    return this.last;
  }

  /** Starts again from another position or at another rate, following the same source. */
  restart(start: ClockStart): void {
    this.start = start;
    this.last = start.position;
    const now = this.sources.now();
    this.audioMovedAt = now;
    if (this.following === "performance") this.anchorPerformance(now, start.position);
  }

  private anchorPerformance(now: number, position: number): void {
    this.fallBackAt = now;
    this.fallBackPosition = position;
  }
}

function latencyOf(audio: AudioTime): number {
  const latency = audio.outputLatency;
  return latency !== undefined && Number.isFinite(latency) && latency > 0 ? latency : 0;
}
