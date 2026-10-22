// Where the media workers read an asset's media (spec section 4.5): a file the person added from
// its copy in this browser's storage (OPFS), and media at an address with range requests
// (src/media/remote.ts). The decode worker and the export worker open media through here.

import { BlobSource, type Source } from "mediabunny";
import type { MediaLocation } from "../engine/picture.ts";
import { remoteSource } from "./remote.ts";

/** A copy in OPFS is read as a file; media at an address with range requests. */
export async function sourceOf(location: MediaLocation): Promise<Source> {
  if (location.type === "url") return remoteSource(location.url);
  const parts = location.opfsPath.split("/");
  const name = parts.pop();
  if (name === undefined) throw new Error(`Not a file path: ${location.opfsPath}`);
  let folder = await navigator.storage.getDirectory();
  for (const part of parts) folder = await folder.getDirectoryHandle(part);
  return new BlobSource(await (await folder.getFileHandle(name)).getFile());
}
