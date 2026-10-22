// Reading a save back (spec section 3.5): each slot's text is checked against the save's schema and
// the document's rules before anything is loaded, and the newest slot that passes wins. A slot cut
// short mid-write, edited by hand, or from a format this version can't read is skipped, so the
// last good save comes back instead of a broken project. This module brings zod, so it's loaded
// on its own, only when there's a save to read (src/save/restore.ts).

import { z } from "zod";
import { invariantViolations } from "../engine/invariants.ts";
import { SAVE_FORMAT, SAVE_VERSION, type SaveFile, type Slot } from "./save-file.ts";

const frames = z.int().nonnegative();
const name = z.string().min(1);

/** A copy in OPFS is always `assets/<asset id>/source.<ext>` (src/media/opfs.ts). */
const OPFS_PATH = /^assets\/[^/]+\/source(\.[a-z0-9]{1,8})?$/;

const source = z.discriminatedUnion("type", [
  z.object({ type: z.literal("file"), opfsPath: z.string().regex(OPFS_PATH) }),
  z.object({
    type: z.literal("feed"),
    itemId: name,
    url: z.url({ protocol: /^https?$/ }),
    videoUrl: z.url({ protocol: /^https?$/ }),
    previewUrl: z.url({ protocol: /^https?$/ }).optional(),
    model: z.string(),
  }),
  z.object({ type: z.literal("url"), url: name }),
]);

const asset = z.object({
  id: name,
  kind: z.enum(["video", "audio"]),
  name: z.string(),
  source,
  durationSec: z.number().nonnegative(),
  width: z.int().positive().optional(),
  height: z.int().positive().optional(),
  fps: z.number().positive().optional(),
});

const clip = z.object({
  id: name,
  assetId: name,
  start: frames,
  in: frames,
  duration: z.int().positive(),
});

const project = z.object({
  id: name,
  name: z.string(),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30)]),
  width: z.int().positive(),
  height: z.int().positive(),
  assets: z.record(z.string(), asset),
  tracks: z.array(z.object({ id: name, kind: z.enum(["video", "audio"]), clips: z.array(clip) })),
});

const saveSchema = z
  .object({
    format: z.literal(SAVE_FORMAT),
    version: z.literal(SAVE_VERSION),
    seq: z.int().positive(),
    savedAt: z.number(),
    project,
    view: z.object({
      playhead: frames,
      pxPerFrame: z.number().positive(),
      scrollX: z.number().nonnegative(),
    }),
  })
  .superRefine((save, context) => {
    // The types hold; the rules between them (no overlaps, clips inside their sources) too.
    for (const problem of invariantViolations(save.project)) {
      context.addIssue({ code: "custom", path: ["project"], message: problem });
    }
  });

/**
 * A save in an older format, brought up to this one; a save in the current format as it is; null
 * for anything else, such as a newer format. There are no older formats yet: version 1 is the
 * first, and a version 2 would add its step here.
 */
export function migrate(json: unknown): unknown {
  if (typeof json !== "object" || json === null) return null;
  const { version } = json as { version?: unknown };
  return version === SAVE_VERSION ? json : null;
}

/** A slot's text read back as a save; null when it isn't one this version can load. */
export function parseSave(text: string | null): SaveFile | null {
  if (text === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // Cut short mid-write, most likely.
    return null;
  }
  const parsed = saveSchema.safeParse(migrate(json));
  return parsed.success ? parsed.data : null;
}

/** The newest save of the two slots' texts that reads back whole, and its slot; null for none. */
export function newestSave(
  texts: readonly [string | null, string | null],
): { save: SaveFile; slot: Slot } | null {
  const [a, b] = [parseSave(texts[0]), parseSave(texts[1])];
  if (a && (!b || a.seq > b.seq)) return { save: a, slot: 0 };
  return b ? { save: b, slot: 1 } : null;
}
