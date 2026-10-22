import { beforeAll, describe, expect, test, vi } from "vitest";
import { musicFailure, musicFor } from "../../src/media/audio.ts";

// One AudioContext for the editor (it's made once): it decodes anything but a file of "noise".
beforeAll(() => {
  vi.stubGlobal(
    "AudioContext",
    class {
      decodeAudioData(bytes: ArrayBuffer) {
        return new TextDecoder().decode(bytes) === "noise"
          ? Promise.reject(new DOMException("Unable to decode audio data", "EncodingError"))
          : Promise.resolve({ duration: 1 } as AudioBuffer);
      }
    },
  );
});

describe("musicFailure", () => {
  test("music whose file doesn't come is unreadable", async () => {
    expect(await musicFor("gone", () => Promise.resolve(null))).toBeNull();
    expect(musicFailure("gone")).toBe("unreadable");
    const offline = () => Promise.reject(new TypeError("Failed to fetch"));
    expect(await musicFor("offline", offline)).toBeNull();
    expect(musicFailure("offline")).toBe("unreadable");
  });

  test("music whose file comes but won't decode is undecodable", async () => {
    expect(await musicFor("noise", () => Promise.resolve(new Blob(["noise"])))).toBeNull();
    expect(musicFailure("noise")).toBe("undecodable");
  });

  test("music that decodes has no failure, and a later success forgets an earlier one", async () => {
    expect(await musicFor("fine", () => Promise.resolve(new Blob(["music"])))).not.toBeNull();
    expect(musicFailure("fine")).toBeNull();
    expect(await musicFor("back", () => Promise.resolve(null))).toBeNull();
    expect(musicFailure("back")).toBe("unreadable");
    await Promise.resolve();
    expect(await musicFor("back", () => Promise.resolve(new Blob(["music"])))).not.toBeNull();
    await Promise.resolve();
    expect(musicFailure("back")).toBeNull();
  });
});
