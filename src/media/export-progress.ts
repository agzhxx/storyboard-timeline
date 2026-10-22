// How long an export has left (the Export board's "About 8 s left"), from a smoothed rate: frames
// encoded per second, sampled at most four times a second and averaged exponentially, so a slow
// clip start (a network read, say) moves the estimate without making it jump about.

/** How long the average remembers: a change in speed is mostly taken in after a few seconds. */
const SMOOTHING_MS = 2_000;

/** The rate is sampled at most this often, so one slow or fast frame doesn't swing it. */
const SAMPLE_MS = 250;

export class TimeLeft {
  /** Frames a second; null until two samples are far enough apart. */
  private rate: number | null = null;
  private last: { done: number; at: number } | null = null;
  private done = 0;

  /** `done` frames are encoded at time `now`, in ms. */
  update(done: number, now: number): void {
    this.done = done;
    if (!this.last) {
      this.last = { done, at: now };
      return;
    }
    const elapsed = now - this.last.at;
    if (elapsed < SAMPLE_MS) return;
    const sample = ((done - this.last.done) * 1000) / elapsed;
    this.rate =
      this.rate === null
        ? sample
        : this.rate + (sample - this.rate) * (1 - Math.exp(-elapsed / SMOOTHING_MS));
    this.last = { done, at: now };
  }

  /** The seconds left to encode `total` frames; null until the rate is known. */
  seconds(total: number): number | null {
    if (this.rate === null || this.rate <= 0) return null;
    return Math.max(0, total - this.done) / this.rate;
  }
}
