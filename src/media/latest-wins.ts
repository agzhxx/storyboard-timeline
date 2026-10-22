// "Latest wins" (spec section 4.5): while the playhead moves, only the newest request for a frame
// matters. Each request carries a sequence number. The main thread keeps the newest number per slot
// (a monitor layer, say) and drops any answer to an older one as it arrives (`LatestWins`); the
// decode worker drops a waiting request as soon as a newer one comes in, and stops decoding the
// one under way (`LatestSlot`), so it never decodes a frame nobody will look at.

/** The main thread's side: which request is the newest, per slot. */
export class LatestWins<Slot> {
  private readonly newest = new Map<Slot, number>();
  private last = 0;

  /** A new request for a slot: every earlier one for it is stale from now on. */
  request(slot: Slot): number {
    this.last += 1;
    this.newest.set(slot, this.last);
    return this.last;
  }

  /** Whether an answer belongs to the newest request of its slot. */
  isLatest(slot: Slot, seq: number): boolean {
    return this.newest.get(slot) === seq;
  }

  /** Makes every request so far stale, as when the picture has moved on to something else. */
  cancel(slot: Slot): void {
    this.newest.delete(slot);
  }
}

/**
 * The worker's side, for one slot: one request runs at a time. A request that comes in while
 * another runs replaces any request waiting, which is never run, and aborts the running one, whose
 * `signal` tells its work to stop and let go of what it holds.
 */
export class LatestSlot<Request> {
  private waiting: Request | null = null;
  private running: AbortController | null = null;
  private readonly work: (request: Request, signal: AbortSignal) => Promise<void>;

  constructor(work: (request: Request, signal: AbortSignal) => Promise<void>) {
    this.work = work;
  }

  submit(request: Request): void {
    this.waiting = request;
    if (this.running) {
      this.running.abort();
      return;
    }
    void this.drain();
  }

  /** Drops the waiting request and stops the running one. */
  cancel(): void {
    this.waiting = null;
    this.running?.abort();
  }

  private async drain(): Promise<void> {
    while (this.waiting !== null) {
      const request = this.waiting;
      this.waiting = null;
      const controller = new AbortController();
      this.running = controller;
      try {
        await this.work(request, controller.signal);
      } catch {
        // The work reports its own failures; one that throws mustn't stop the next request.
      } finally {
        this.running = null;
      }
    }
  }
}
