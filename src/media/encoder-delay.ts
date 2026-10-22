// How far this browser's audio encoder delays what it encodes. An AAC
// encoder starts its output with priming samples (2,112 of them in Chrome on macOS), and WebCodecs
// doesn't say how many: the packets start at the first sample's time, so a player that plays them
// all hears the music late, 44 ms in Chrome. The export worker measures the delay once per MP4
// export, by encoding a click and decoding it back with the browser's own decoder, then times the
// music that much earlier, and the MP4 gets an edit list that skips the priming. Opus's header
// says its own delay (pre-skip), which decoders honor (it measures as none), so WebM needs nothing.

/** Where the click is, and how long the sound measured is: 0.1 s and 0.2 s at 48 kHz. */
const CLICK_AT = 4_800;
const LENGTH = 9_600;

/** The first sample louder than the threshold, counted across the decoded chunks; null if none. */
export function firstLoud(chunks: readonly Float32Array[], threshold = 0.2): number | null {
  let offset = 0;
  for (const chunk of chunks) {
    const index = chunk.findIndex((sample) => Math.abs(sample) > threshold);
    if (index >= 0) return offset + index;
    offset += chunk.length;
  }
  return null;
}

/**
 * The encoder's delay in samples for `config` (codec, rate, channels, bitrate): where a click
 * comes back, less where it went in. 0 when it can't be measured, as the music then stays as is.
 */
export async function encoderDelay(config: AudioEncoderConfig): Promise<number> {
  try {
    const { chunks, decoderConfig } = await encodeClick(config);
    if (!decoderConfig) return 0;
    const at = firstLoud(await decode(chunks, decoderConfig));
    return at === null ? 0 : Math.max(0, at - CLICK_AT);
  } catch {
    return 0;
  }
}

async function encodeClick(
  config: AudioEncoderConfig,
): Promise<{ chunks: EncodedAudioChunk[]; decoderConfig: AudioDecoderConfig | undefined }> {
  const chunks: EncodedAudioChunk[] = [];
  let decoderConfig: AudioDecoderConfig | undefined;
  // An encoder that fails rejects its flush.
  const encoder = new AudioEncoder({
    output: (chunk, metadata) => {
      chunks.push(chunk);
      decoderConfig ??= metadata?.decoderConfig;
    },
    error: () => undefined,
  });
  try {
    encoder.configure(config);
    const { numberOfChannels, sampleRate } = config;
    const data = new Float32Array(LENGTH * numberOfChannels);
    for (let channel = 0; channel < numberOfChannels; channel += 1) {
      const start = channel * LENGTH + CLICK_AT;
      data.fill(0.8, start, start + 48);
    }
    const audio = new AudioData({
      format: "f32-planar",
      sampleRate,
      numberOfChannels,
      numberOfFrames: LENGTH,
      timestamp: 0,
      data,
    });
    encoder.encode(audio);
    audio.close();
    await encoder.flush();
    return { chunks, decoderConfig };
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
}

async function decode(
  chunks: readonly EncodedAudioChunk[],
  config: AudioDecoderConfig,
): Promise<Float32Array[]> {
  const decoded: Float32Array[] = [];
  const decoder = new AudioDecoder({
    output: (data) => {
      const samples = new Float32Array(data.numberOfFrames);
      data.copyTo(samples, { planeIndex: 0, format: "f32-planar" });
      decoded.push(samples);
      data.close();
    },
    error: () => undefined,
  });
  try {
    decoder.configure(config);
    for (const chunk of chunks) decoder.decode(chunk);
    await decoder.flush();
    return decoded;
  } finally {
    if (decoder.state !== "closed") decoder.close();
  }
}
