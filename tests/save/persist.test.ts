import { describe, expect, test, vi } from "vitest";
import { PERSIST_KEY, persister } from "../../src/save/persist.ts";

function browser({ persisted = false, granted = true, recorded = null as string | null } = {}) {
  const memory = new Map<string, string>();
  if (recorded !== null) memory.set(PERSIST_KEY, recorded);
  const storage = {
    persisted: vi.fn(() => Promise.resolve(persisted)),
    persist: vi.fn(() => Promise.resolve(granted)),
  };
  const deps = () => ({
    storage,
    memory: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
    },
  });
  return { storage, memory, deps };
}

describe("asking for persistent storage", () => {
  test("asks once, and notes the answer", async () => {
    const { storage, memory, deps } = browser({ granted: false });
    const ask = persister(deps);
    expect(await ask()).toBe(false);
    expect(await ask()).toBeNull();
    expect(storage.persist).toHaveBeenCalledOnce();
    expect(memory.get(PERSIST_KEY)).toBe("denied");
  });

  test("never asks again once this browser answered, even in a new session", async () => {
    const { storage, deps } = browser({ recorded: "denied" });
    expect(await persister(deps)()).toBeNull();
    expect(storage.persist).not.toHaveBeenCalled();
  });

  test("storage that's already kept is noted without asking", async () => {
    const { storage, memory, deps } = browser({ persisted: true });
    expect(await persister(deps)()).toBe(true);
    expect(storage.persist).not.toHaveBeenCalled();
    expect(memory.get(PERSIST_KEY)).toBe("granted");
  });

  test("a browser without a storage manager, or local storage, changes nothing", async () => {
    expect(await persister(() => ({ storage: undefined, memory: undefined }))()).toBeNull();
    const blocked = persister(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    expect(await blocked()).toBeNull();
  });
});
