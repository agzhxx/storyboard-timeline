import { afterEach, describe, expect, test, vi } from "vitest";
import {
  ANSWER_TIMEOUT_MS,
  answeringFetch,
  retryDelay,
  UnreachableError,
  unreachable,
} from "../../src/media/remote.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("a failed request is asked again twice, half a second and a second later, then given up", () => {
  expect(retryDelay(1)).toBe(0.5);
  expect(retryDelay(2)).toBe(1);
  expect(retryDelay(3)).toBeNull();
});

describe("answeringFetch", () => {
  test("hands over an answer, an error status that's final included", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("bytes", { status: 206 })));
    expect((await answeringFetch("https://media.example/clip.mp4")).status).toBe(206);
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("gone", { status: 404 })));
    expect((await answeringFetch("https://media.example/clip.mp4")).status).toBe(404);
  });

  test("throws for a status a later try may not get, so Mediabunny tries again", async () => {
    for (const status of [429, 500, 503]) {
      vi.stubGlobal("fetch", () => Promise.resolve(new Response("busy", { status })));
      await expect(answeringFetch("https://media.example/clip.mp4")).rejects.toThrow(
        UnreachableError,
      );
    }
  });

  test("gives up on a server that hasn't started answering in 10 s", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    const answer = answeringFetch("https://media.example/clip.mp4");
    const failed = expect(answer).rejects.toThrow("No answer in time");
    await vi.advanceTimersByTimeAsync(ANSWER_TIMEOUT_MS);
    await failed;
  });

  test("Mediabunny's own abort still aborts", async () => {
    vi.stubGlobal(
      "fetch",
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    const controller = new AbortController();
    const answer = answeringFetch("https://media.example/clip.mp4", { signal: controller.signal });
    controller.abort();
    await expect(answer).rejects.toThrow("Aborted");
  });
});

test("a failure to read media is the network's when nothing answered, or the server said no", () => {
  expect(unreachable(new UnreachableError("No answer in time"))).toBe(true);
  expect(unreachable(new TypeError("Failed to fetch"))).toBe(true);
  expect(unreachable(new TypeError("Load failed"))).toBe(true);
  expect(unreachable(new TypeError("NetworkError when attempting to fetch resource."))).toBe(true);
  expect(
    unreachable(new Error("Error fetching https://media.example/clip.mp4: 404 Not Found")),
  ).toBe(true);
  // The decoder's own errors, and our bugs, aren't.
  expect(unreachable(new DOMException("Decoding error", "EncodingError"))).toBe(false);
  expect(unreachable(new TypeError("sample.close is not a function"))).toBe(false);
  expect(unreachable(new Error("No frame decoded"))).toBe(false);
  expect(unreachable(undefined)).toBe(false);
});
