import { describe, expect, test } from "vitest";
import { LatestSlot, LatestWins } from "../../src/media/latest-wins.ts";

describe("LatestWins, on the main thread", () => {
  test("only the newest request of a slot is answered; older answers are stale on arrival", () => {
    const latest = new LatestWins<string>();
    const first = latest.request("V1");
    const second = latest.request("V1");
    expect(latest.isLatest("V1", first)).toBe(false);
    expect(latest.isLatest("V1", second)).toBe(true);
  });

  test("slots don't affect each other", () => {
    const latest = new LatestWins<string>();
    const v1 = latest.request("V1");
    const v2 = latest.request("V2");
    expect(latest.isLatest("V1", v1)).toBe(true);
    expect(latest.isLatest("V2", v2)).toBe(true);
    expect(latest.isLatest("V2", v1)).toBe(false);
  });

  test("cancel makes every answer for the slot stale", () => {
    const latest = new LatestWins<string>();
    const seq = latest.request("V1");
    latest.cancel("V1");
    expect(latest.isLatest("V1", seq)).toBe(false);
  });
});

/** Work that waits until the test lets it finish, and records what it did. */
function controlledWork() {
  const log: string[] = [];
  const finishers = new Map<number, () => void>();
  const work = (request: number, signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      log.push(`start ${request}`);
      signal.addEventListener("abort", () => {
        log.push(`abort ${request}`);
        resolve();
      });
      finishers.set(request, () => {
        log.push(`done ${request}`);
        resolve();
      });
    });
  return { log, work, finish: (request: number) => finishers.get(request)?.() };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("LatestSlot, in the worker", () => {
  test("a request that comes in while one runs aborts it, and replaces any waiting one", async () => {
    const { log, work, finish } = controlledWork();
    const slot = new LatestSlot(work);
    slot.submit(1);
    slot.submit(2);
    slot.submit(3);
    await settle();
    // 2 was dropped before decoding: 3 came in while it waited.
    expect(log).toEqual(["start 1", "abort 1", "start 3"]);
    finish(3);
    await settle();
    expect(log.at(-1)).toBe("done 3");
  });

  test("requests that come one after another all run", async () => {
    const { log, work, finish } = controlledWork();
    const slot = new LatestSlot(work);
    slot.submit(1);
    finish(1);
    await settle();
    slot.submit(2);
    finish(2);
    await settle();
    expect(log).toEqual(["start 1", "done 1", "start 2", "done 2"]);
  });

  test("cancel stops the running request and drops the waiting one", async () => {
    const { log, work } = controlledWork();
    const slot = new LatestSlot(work);
    slot.submit(1);
    slot.cancel();
    await settle();
    expect(log).toEqual(["start 1", "abort 1"]);
  });

  test("work that throws doesn't stop the next request", async () => {
    const log: number[] = [];
    const slot = new LatestSlot((request: number) => {
      log.push(request);
      return request === 1 ? Promise.reject(new Error("broken")) : Promise.resolve();
    });
    slot.submit(1);
    await settle();
    slot.submit(2);
    await settle();
    expect(log).toEqual([1, 2]);
  });
});
