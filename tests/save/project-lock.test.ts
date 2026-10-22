import { describe, expect, test } from "vitest";
import { type Claim, type Locks, PROJECT_LOCK, ProjectLock } from "../../src/save/project-lock.ts";

/**
 * Web Locks for one exclusive lock shared by the tabs of one browser, as the spec has them: a
 * request with `ifAvailable` gets null when it's held, a plain one waits its turn, `steal` takes it
 * at once and fails the holder's request with an AbortError, and a signal calls a waiting one off.
 */
function browserLocks() {
  interface Request {
    tab: string;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
    callback: LockGrantedCallback<unknown>;
  }
  let holder: Request | null = null;
  const queue: Request[] = [];

  function grant(request: Request) {
    holder = request;
    const lock = { name: PROJECT_LOCK, mode: "exclusive" } as Lock;
    Promise.resolve(request.callback(lock)).then((value) => {
      if (holder !== request) return;
      holder = null;
      request.resolve(value);
      const next = queue.shift();
      if (next) grant(next);
    }, request.reject);
  }

  /** The lock manager one tab sees. */
  function tab(name: string): Locks {
    return {
      request: (
        _name: string,
        optionsOrCallback: LockOptions | LockGrantedCallback<unknown>,
        maybeCallback?: LockGrantedCallback<unknown>,
      ) => {
        const options = typeof optionsOrCallback === "function" ? {} : optionsOrCallback;
        const callback = (
          typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback
        ) as LockGrantedCallback<unknown>;
        return new Promise<unknown>((resolve, reject) => {
          const request: Request = { tab: name, resolve, reject, callback };
          if (options.steal) {
            holder?.reject(new DOMException("Taken over", "AbortError"));
            grant(request);
          } else if (!holder) {
            grant(request);
          } else if (options.ifAvailable) {
            Promise.resolve(callback(null)).then(resolve, reject);
          } else {
            queue.push(request);
            options.signal?.addEventListener("abort", () => {
              const index = queue.indexOf(request);
              if (index !== -1) queue.splice(index, 1);
              reject(new DOMException("Called off", "AbortError"));
            });
          }
        });
      },
    };
  }

  /** The tab holding the lock closes: it's let go of, and the next waiting tab gets it. */
  function close(name: string) {
    if (holder?.tab !== name) return;
    holder = null;
    const next = queue.shift();
    if (next) grant(next);
  }

  return { tab, close, holder: () => holder?.tab ?? null };
}

/** A tab of the app, with what it was told. */
function openTab(locks: Locks | undefined) {
  const claims: Claim[] = [];
  const lock = new ProjectLock(locks, (claim) => claims.push(claim));
  lock.claim();
  return { lock, claims };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("one tab edits the project", () => {
  test("a browser without Web Locks just edits", () => {
    expect(openTab(undefined).claims).toEqual(["owner"]);
  });

  test("the first tab gets the project; a second says another tab has it", async () => {
    const browser = browserLocks();
    const first = openTab(browser.tab("first"));
    await settle();
    const second = openTab(browser.tab("second"));
    await settle();
    expect(first.claims).toEqual(["owner"]);
    expect(second.claims).toEqual(["elsewhere"]);
    expect(browser.holder()).toBe("first");
  });

  test("when the first tab closes, the second gets the project on its own", async () => {
    const browser = browserLocks();
    openTab(browser.tab("first"));
    await settle();
    const second = openTab(browser.tab("second"));
    await settle();
    browser.close("first");
    await settle();
    expect(second.claims).toEqual(["elsewhere", "owner"]);
  });

  test("Use it here takes the project over; the first tab stops, and can take it back", async () => {
    const browser = browserLocks();
    const first = openTab(browser.tab("first"));
    await settle();
    const second = openTab(browser.tab("second"));
    await settle();

    second.lock.takeOver();
    await settle();
    expect(second.claims).toEqual(["elsewhere", "owner"]);
    expect(first.claims).toEqual(["owner", "moved"]);
    expect(browser.holder()).toBe("second");

    first.lock.takeOver();
    await settle();
    expect(first.claims).toEqual(["owner", "moved", "owner"]);
    expect(second.claims).toEqual(["elsewhere", "owner", "moved"]);
  });

  test("Use it here twice, or once the project came on its own, takes nothing from itself", async () => {
    const browser = browserLocks();
    const first = openTab(browser.tab("first"));
    await settle();
    const second = openTab(browser.tab("second"));
    await settle();

    // A double click.
    second.lock.takeOver();
    second.lock.takeOver();
    await settle();
    expect(second.claims).toEqual(["elsewhere", "owner"]);
    expect(first.claims).toEqual(["owner", "moved"]);

    // The other tab closed, and the project came to the first on its own just before a click.
    second.lock.takeOver();
    browser.close("second");
    await settle();
    first.lock.takeOver();
    await settle();
    expect(first.claims).toEqual(["owner", "moved", "owner"]);
    expect(browser.holder()).toBe("first");
  });

  test("a browser that won't lock here (a sandboxed page) edits, as without locks", async () => {
    const refusing: Locks = {
      request: () => Promise.reject(new DOMException("No locks here", "SecurityError")),
    };
    const tab = openTab(refusing);
    await settle();
    expect(tab.claims).toEqual(["owner"]);
  });
});
