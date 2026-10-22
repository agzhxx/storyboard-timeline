// Silence for browsers with no mute switch: an init script that plays each
// live AudioContext through a gain of 0, so its clock runs as it would and nothing reaches the
// speakers. The e2e tests use it in WebKit (e2e/test.ts), the benches in WebKit and Firefox
// (bench/browser.ts). Chrome runs with --mute-audio instead.

// The function runs in the page, with the DOM.
/// <reference lib="dom" />

/** Runs in the page: a live AudioContext's destination becomes a gain of 0 in front of it. */
export function silenceAudio(): void {
  const destination = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, "destination");
  if (!destination?.get) return;
  const silent = new WeakMap<BaseAudioContext, GainNode>();
  Object.defineProperty(BaseAudioContext.prototype, "destination", {
    ...destination,
    get(this: BaseAudioContext): AudioNode {
      const out = destination.get?.call(this) as AudioDestinationNode;
      // An OfflineAudioContext (the export's mix) renders; it doesn't play.
      if (!(this instanceof AudioContext)) return out;
      let gain = silent.get(this);
      if (!gain) {
        gain = new GainNode(this, { gain: 0 });
        gain.connect(out);
        silent.set(this, gain);
      }
      return gain;
    },
  });
}
