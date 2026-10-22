// The frames a video track has decoded ahead during playback, on the main thread (spec section
// 4.6). The decode worker sends them in order, each placed on the timeline. Each animation frame,
// the track shows the newest one whose time has come and closes those before it. Every frame is
// closed exactly once: when a newer one replaces it on screen, when it's skipped because a newer
// one is already due, or when playback stops. Each closed frame is handed back to the worker
// (`onClosed`), which is what lets it decode another (backpressure).

export interface Closable {
  close(): void;
}

export interface Queued<F extends Closable> {
  frame: F;
  clipId: string;
  /** From when it shows on the timeline, in µs. */
  presentUs: number;
  /** Until when, in µs: the clip's end, or where the next source frame starts. */
  endUs: number;
}

export interface Shown<F> {
  /** The frame on screen for this track now; null when it shows nothing. */
  frame: F | null;
  /** Whether that changed, so the picture must be drawn again. */
  changed: boolean;
  /** Whether the frame on screen is the one due: false when the right one isn't decoded yet. */
  onTime: boolean;
}

export class TrackQueue<F extends Closable> {
  /** Frames still to show, in timeline order. */
  private waiting: Queued<F>[] = [];
  private shown: Queued<F> | null = null;
  private readonly onClosed: (count: number) => void;

  constructor(onClosed: (count: number) => void) {
    this.onClosed = onClosed;
  }

  /** How many frames wait to be shown. */
  get length(): number {
    return this.waiting.length;
  }

  /** A frame from the worker, which sends them in timeline order. */
  push(entry: Queued<F>): void {
    this.waiting.push(entry);
  }

  /**
   * Shows what's due at `targetUs` (the playhead's frame, plus the tolerance for rounded source
   * times): the newest frame that starts at or before it, closing the ones before. Where this track
   * has no clip to decode (`expected` false: a gap, or a placeholder), it shows nothing.
   */
  show(targetUs: number, expected: boolean): Shown<F> {
    let due = -1;
    for (let index = 0; index < this.waiting.length; index += 1) {
      if ((this.waiting[index]?.presentUs ?? Infinity) > targetUs) break;
      due = index;
    }
    let changed = false;
    const passed = this.waiting.splice(0, due + 1);
    const next = expected ? passed.pop() : undefined;
    if (next || !expected) {
      changed = this.shown !== null || next !== undefined;
      if (this.shown) passed.push(this.shown);
      this.shown = next ?? null;
    }
    this.close(passed);
    const onTime =
      this.shown !== null && this.shown.presentUs <= targetUs && targetUs < this.shown.endUs;
    return { frame: this.shown?.frame ?? null, changed, onTime };
  }

  /** Closes every frame, shown or waiting: playback stopped. */
  clear(): void {
    const all = this.shown ? [this.shown, ...this.waiting] : this.waiting;
    this.shown = null;
    this.waiting = [];
    this.close(all);
  }

  private close(entries: Queued<F>[]): void {
    if (entries.length === 0) return;
    for (const { frame } of entries) frame.close();
    this.onClosed(entries.length);
  }
}

/**
 * Late or dropped frames over a playback (spec section 4.8): each frame a track should show counts
 * once, as it comes due. It's late when the picture due isn't decoded in time, and dropped when
 * the page skipped its moment entirely (an animation frame that came too late, past it).
 */
export class LateFrames {
  expected = 0;
  late = 0;

  /** A track's frame came due: whether its picture was ready. */
  due(onTime: boolean): void {
    this.expected += 1;
    if (!onTime) this.late += 1;
  }

  /** Frames that came and went between two animation frames: none of them was shown. */
  skipped(count: number): void {
    this.expected += count;
    this.late += count;
  }

  reset(): void {
    this.expected = 0;
    this.late = 0;
  }
}
