// What the editor draws for media read from an address (spec section 4.5): a Feed clip's
// thumbnails, for its filmstrip and the monitor's quick scrub, and the robot story's music's
// waveform. A Feed clip's thumbnails come back from storage when an earlier session kept them
// (src/media/opfs.ts); else the import worker makes them in two rounds: first the thumbnails each
// clip's preview holds (the Feed's 480p file of its first 2.5 s), three clips at a time, every
// clip's before any clip's rest; then the rest from each clip's 720p file, one at a time.
// The story uses each clip's first 3 s, so its filmstrips are in after
// the first round. Each asset's
// media is fetched once a session: one that fails (the Feed's media unreachable, offline) stays
// without until the connection comes back (`retryFailedRemoteMedia`). A clip's filmstrip in is a
// performance mark, "feed:thumbnails" (detail: the asset's id), which the benches wait on.

import type { Asset } from "../engine/types.ts";
import { musicOf } from "./audio.ts";
import { importWorker } from "./import-client.ts";
import { addPeaks, addThumbnail, readThumbnails } from "./media-cache.ts";
import {
  META_FILE,
  openStorage,
  parseJson,
  parseRemoteMeta,
  REMOTE_FOLDER,
  type RemoteMeta,
} from "./opfs.ts";
import type { Thumbnail } from "./protocol.ts";
import { thumbnailCount } from "./thumbnails.ts";

const requested = new Set<string>();

/** The assets whose media didn't come this session, to ask for again once online. */
const failed = new Map<string, Asset>();

/** Which project's media is fetched: New project starts the next. */
let generation = 0;

/** Draws need an asset's thumbnails or peaks: fetches them, the first time. */
export function requestRemoteMedia(asset: Asset): void {
  if (requested.has(asset.id)) return;
  requested.add(asset.id);
  const asked = generation;
  const fetched =
    asset.source.type === "feed"
      ? thumbnailsFor(asset.id, thumbnailCount(asset.durationSec), asset.source, asked)
      : asset.kind === "audio"
        ? peaksFor(asset)
        : Promise.resolve(true);
  void fetched.then((ok) => {
    // What New project dropped was the last project's: it's never asked for again.
    if (!ok && asked === generation) failed.set(asset.id, asset);
  });
}

/** The connection is back: the media that didn't come is asked for again. */
export function retryFailedRemoteMedia(): void {
  const again = [...failed.values()];
  failed.clear();
  for (const asset of again) {
    requested.delete(asset.id);
    requestRemoteMedia(asset);
  }
}

/**
 * New project: the media fetched so far is forgotten with the project's caches, and thumbnail jobs
 * still waiting their turn are dropped, so none writes into storage after it's cleared.
 */
export function forgetRemoteMedia(): void {
  requested.clear();
  failed.clear();
  generation += 1;
}

type Round = "first" | "rest";

/** The thumbnail jobs waiting, by round: no clip's "rest" job starts while a "first" one waits. */
const rounds: Record<Round, Job[]> = { first: [], rest: [] };

/**
 * How many of a round's jobs run at once. A preview is about 180 KB, so its job mostly waits for
 * the bucket's first byte: three at a time overlap those waits. A 720p file is about 1.6 MB, one at
 * a time, and only once every preview is done (docs/PERF.md, M8).
 */
const AT_ONCE: Record<Round, number> = { first: 3, rest: 1 };

interface Job {
  run: () => Promise<void>;
  /** The project it was asked for: New project drops it. */
  generation: number;
  resolve: () => void;
  reject: (error: Error) => void;
}

let running = 0;

/** Runs a thumbnail job in its round's turn: every "first" job comes before any "rest" job. */
function enqueue(round: Round, generation: number, run: () => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    rounds[round].push({ run, generation, resolve, reject });
    startJobs();
  });
}

function startJobs(): void {
  for (;;) {
    const round = rounds.first.length > 0 ? "first" : "rest";
    if (running >= AT_ONCE[round]) return;
    const job = rounds[round].shift();
    if (!job) return;
    running += 1;
    void runJob(job).finally(() => {
      running -= 1;
      startJobs();
    });
  }
}

async function runJob(job: Job): Promise<void> {
  try {
    if (job.generation !== generation) throw new Error("A new project dropped this job.");
    await job.run();
    job.resolve();
  } catch (error) {
    job.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * A Feed clip's thumbnails, from storage or its files; whether they came. From its files, in two
 * jobs: the thumbnails its preview holds, then the rest from its 720p file, which also keeps them
 * all in storage. A clip without a preview (a save from before M8), or whose preview didn't come,
 * gets them all from its 720p file.
 */
async function thumbnailsFor(
  assetId: string,
  count: number,
  { previewUrl, videoUrl }: Extract<Asset["source"], { type: "feed" }>,
  asked: number,
): Promise<boolean> {
  try {
    const stored = await storedRemoteMeta(assetId);
    const root = stored && (await openStorage());
    if (stored && root) {
      await readThumbnails(root, assetId, stored.thumbnails, 0, REMOTE_FOLDER);
    } else {
      const made = new Set<number>();
      const onThumbnail = (index: number, thumbnail: Thumbnail) => {
        made.add(index);
        void addThumbnail(assetId, index, thumbnail.blob);
      };
      if (previewUrl !== undefined) {
        const request = { assetId, url: previewUrl, from: 0, preview: { count } };
        await enqueue("first", asked, () =>
          importWorker.remoteThumbnails(request, onThumbnail),
        ).catch(() => undefined);
      }
      let from = 0;
      while (made.has(from)) from += 1;
      const request = { assetId, url: videoUrl, from, preview: null };
      await enqueue("rest", asked, () => importWorker.remoteThumbnails(request, onThumbnail));
    }
    performance.mark("feed:thumbnails", { detail: assetId });
    return true;
  } catch {
    // Unreachable, or not decodable here: the filmstrip stays empty, and the exact frames say why.
    return false;
  }
}

/**
 * The music's waveform: decoded once (playback keeps the samples), boiled down by the worker.
 * Whether it came.
 */
async function peaksFor(asset: Asset): Promise<boolean> {
  try {
    const buffer = await musicOf(asset);
    if (!buffer) return false;
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) =>
      buffer.getChannelData(channel).slice(),
    );
    addPeaks(asset.id, await importWorker.peaks(channels, buffer.sampleRate));
    return true;
  } catch {
    // No waveform: the clip still plays.
    return false;
  }
}

/** A remote video's facts and thumbnails as an earlier session kept them; null when it didn't. */
export async function storedRemoteMeta(assetId: string): Promise<RemoteMeta | null> {
  try {
    const root = await openStorage();
    const folder = await (await root?.folder(REMOTE_FOLDER))?.folder(assetId);
    const meta = await folder?.file(META_FILE);
    const parsed = meta ? parseRemoteMeta(parseJson(await meta.text())) : null;
    return parsed?.id === assetId ? parsed : null;
  } catch {
    return null;
  }
}
