// Reading the saves back (spec section 3.5), in the save worker: both slots' texts, the newest that
// passes the schema and the document's rules (src/save/save-schema.ts), and which of its files the
// browser's storage no longer has. Feed clips need nothing from storage: the save holds their
// addresses, model and facts.

import { type Folder, readPath } from "../media/opfs.ts";
import { SAVES_FOLDER, type SaveFile, SLOT_FILES } from "./save-file.ts";
import { newestSave } from "./save-schema.ts";
import type { ReadResult } from "./save-protocol.ts";

/** The slots' texts: null for a slot that isn't there. */
async function slotTexts(root: Folder): Promise<[string | null, string | null]> {
  const folder = await root.folder(SAVES_FOLDER);
  const read = async (name: string) => (await folder?.file(name))?.text() ?? null;
  const [a = null, b = null] = await Promise.all(SLOT_FILES.map(read));
  return [a, b];
}

export async function readSaves(root: Folder): Promise<ReadResult> {
  const texts = await slotTexts(root);
  if (texts.every((text) => text === null)) return { kind: "none" };
  const newest = newestSave(texts);
  if (!newest) return { kind: "unreadable" };
  return { kind: "restored", ...newest, missing: await missingFiles(root, newest.save) };
}

/** The files of a save whose copies in storage are gone. */
async function missingFiles(root: Folder, save: SaveFile): Promise<string[]> {
  const missing: string[] = [];
  for (const asset of Object.values(save.project.assets)) {
    if (asset.source.type !== "file") continue;
    const copy = await readPath(root, asset.source.opfsPath).catch(() => null);
    if (!copy) missing.push(asset.id);
  }
  return missing;
}
