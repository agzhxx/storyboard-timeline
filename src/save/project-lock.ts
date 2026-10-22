// One project per browser, one tab at a time (spec section 3.5). Every tab
// of the app shares the same storage, so two tabs saving would write over each other's work. A
// tab edits only while it holds a Web Lock on the project, as imports hold one per file
// (src/media/library.ts). A tab that opens while another holds it shows that, and waits: when the
// other tab closes, it gets the project. "Use it here" takes the lock over (`steal`), and the tab
// that had it learns it lost it, stops saving, and waits in turn.

/** The lock's name, the same in every tab of the app. */
export const PROJECT_LOCK = "storyboard-timeline:project";

/**
 * What this tab may do: edit and save ("owner"), nothing because another tab had the project when
 * this one opened ("elsewhere"), or nothing since another tab took it over ("moved").
 */
export type Claim = "owner" | "elsewhere" | "moved";

/** The part of the browser's LockManager this uses; the tests give it a fake one. */
export type Locks = Pick<LockManager, "request">;

/** A held lock that another tab takes over fails its request with this; so does a call-off. */
function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export class ProjectLock {
  private readonly locks: Locks | undefined;
  private readonly onClaim: (claim: Claim) => void;
  /** The request waiting for the lock, while another tab holds it. */
  private waiting: AbortController | null = null;
  /** Whether this tab holds the lock, or is taking it over. */
  private holding = false;
  private taking = false;

  constructor(locks: Locks | undefined, onClaim: (claim: Claim) => void) {
    this.locks = locks;
    this.onClaim = onClaim;
  }

  /** At startup: takes the project if no tab holds it, else says so and waits for it. */
  claim(): void {
    const locks = this.locks;
    // Without Web Locks (an old browser), this tab just edits.
    if (!locks) {
      this.onClaim("owner");
      return;
    }
    locks
      .request(PROJECT_LOCK, { ifAvailable: true }, (lock) => {
        if (lock) return this.hold();
        this.onClaim("elsewhere");
        this.wait(locks);
        return undefined;
      })
      .catch((error: unknown) => {
        this.failed(locks, error);
      });
  }

  /**
   * "Use it here": takes the project from the tab that has it, which then stops saving. A second
   * click, or one as the project arrives on its own, does nothing: stealing the lock from this tab
   * would only fail its own hold, and leave it waiting for itself.
   */
  takeOver(): void {
    const locks = this.locks;
    if (!locks || this.holding || this.taking) return;
    this.taking = true;
    this.waiting?.abort();
    this.waiting = null;
    locks
      .request(PROJECT_LOCK, { steal: true }, () => this.hold())
      .catch((error: unknown) => {
        this.failed(locks, error);
      });
  }

  /** Holds the lock until the tab closes, or another tab takes it over. */
  private hold(): Promise<void> {
    this.holding = true;
    this.taking = false;
    this.onClaim("owner");
    return new Promise<void>(() => undefined);
  }

  private wait(locks: Locks): void {
    const waiting = new AbortController();
    this.waiting = waiting;
    locks
      .request(PROJECT_LOCK, { signal: waiting.signal }, () => {
        this.waiting = null;
        return this.hold();
      })
      .catch((error: unknown) => {
        // Called off because this tab is taking the project over: that request has it.
        if (!waiting.signal.aborted) this.failed(locks, error);
      });
  }

  /**
   * A request failed: another tab took the held lock over, so this one waits to get it back; or
   * the browser won't lock here at all (a sandboxed page), so this tab edits, as without locks.
   */
  private failed(locks: Locks, error: unknown): void {
    this.holding = false;
    this.taking = false;
    if (!isAbort(error)) {
      this.onClaim("owner");
      return;
    }
    this.onClaim("moved");
    this.wait(locks);
  }
}
