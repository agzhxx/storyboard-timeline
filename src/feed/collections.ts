// The Feed's collections and the names its filter shows. Copied from the Feed's
// lib/collections.ts at generation-feed@65a0341, a module with no imports so the bin gets these
// few strings without zod. Change them in the Feed first, then copy them here, until the UI Kit
// (project 3) owns them.

export const COLLECTIONS = [
  "worlds",
  "camera-moves",
  "story",
  "pairs",
  "ratios",
  "almaty",
  "textures",
  "ads",
] as const;
export type Collection = (typeof COLLECTIONS)[number];

export const COLLECTION_LABELS: Record<Collection, string> = {
  worlds: "Worlds",
  "camera-moves": "Camera moves",
  story: "Story",
  pairs: "Pairs",
  ratios: "Ratios",
  almaty: "Almaty",
  textures: "Textures",
  ads: "Ads",
};

// Ours, not the Feed's: what the bin's Collection picker offers.

/**
 * The collections that hold videos, in the picker's order: the story first, then the Feed's own
 * order. Pairs and ratios hold only images (checked against the live Feed on 18 October 2026); a
 * collection that comes back empty says so in the bin.
 */
export const VIDEO_COLLECTIONS: readonly Collection[] = [
  "story",
  "worlds",
  "camera-moves",
  "almaty",
  "textures",
  "ads",
];
