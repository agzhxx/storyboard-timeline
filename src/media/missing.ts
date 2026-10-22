// Files whose copy in this browser's storage is gone (spec section 3.5): found when a restored save
// names a file storage no longer has, or after a file is removed from My files and Undo brings
// back a clip of it. Their clips show an error badge and say why; the app keeps working.

import { create } from "zustand";

export const useMissingMedia = create<{ assetIds: readonly string[] }>(() => ({ assetIds: [] }));

/** Marks assets as missing, besides any marked before. */
export function markMissing(assetIds: readonly string[]): void {
  if (assetIds.length === 0) return;
  useMissingMedia.setState(({ assetIds: known }) => ({
    assetIds: [...new Set([...known, ...assetIds])],
  }));
}

/** A new project: nothing is missing from it. */
export function forgetMissing(): void {
  useMissingMedia.setState({ assetIds: [] });
}

export function isMissing(assetId: string): boolean {
  return useMissingMedia.getState().assetIds.includes(assetId);
}
