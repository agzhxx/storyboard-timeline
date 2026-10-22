import { describe, expect, test, vi } from "vitest";
import { chunk, chunkAddress } from "../../src/app/chunks.ts";

const ADDRESS = "http://localhost:4173/assets/ShortcutsDialog-DHM4yjiH.js";

describe("lazily loaded chunks", () => {
  test("find the chunk's address in Chrome's and Firefox's errors, not Safari's", () => {
    const chrome = new TypeError(`Failed to fetch dynamically imported module: ${ADDRESS}`);
    const firefox = new TypeError(`error loading dynamically imported module: ${ADDRESS}`);
    const retried = new TypeError(
      `Failed to fetch dynamically imported module: ${ADDRESS}?retry=1`,
    );
    expect(chunkAddress(chrome)).toBe(ADDRESS);
    expect(chunkAddress(firefox)).toBe(ADDRESS);
    expect(chunkAddress(retried)).toBe(ADDRESS);
    expect(chunkAddress(new TypeError("Importing a module script failed."))).toBeNull();
  });

  test("load once, and keep the module", async () => {
    const load = vi.fn(() => Promise.resolve("module"));
    const get = chunk(load);
    expect(await get()).toBe("module");
    expect(await get()).toBe("module");
    expect(load).toHaveBeenCalledOnce();
  });

  test("after a failure Chrome remembers, load the chunk's address again with a new query", async () => {
    const load = vi.fn(() =>
      Promise.reject(new TypeError(`Failed to fetch dynamically imported module: ${ADDRESS}`)),
    );
    const retry = vi.fn((address: string) =>
      address.endsWith("=1")
        ? Promise.reject(new TypeError(`Failed to fetch dynamically imported module: ${address}`))
        : Promise.resolve("module"),
    );
    const get = chunk(load, retry);
    await expect(get()).rejects.toThrow();
    await expect(get()).rejects.toThrow();
    expect(await get()).toBe("module");
    expect(retry.mock.calls).toEqual([[`${ADDRESS}?retry=1`], [`${ADDRESS}?retry=2`]]);
    expect(load).toHaveBeenCalledOnce();
  });

  test("where the error names no address (Safari), the same import is tried again", async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new TypeError("Importing a module script failed."))
      .mockResolvedValueOnce("module");
    const retry = vi.fn(() => Promise.resolve("never"));
    const get = chunk(load, retry);
    await expect(get()).rejects.toThrow();
    expect(await get()).toBe("module");
    expect(retry).not.toHaveBeenCalled();
  });
});
