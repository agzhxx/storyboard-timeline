// Whether the window is phone-width (spec section 3.6: under 768 px), where the app is the
// read-only phone view instead of the editor. It follows the window: a phone turned on its side,
// or a desktop window made narrow, switches views, with the project as it is.

import { useSyncExternalStore } from "react";

const PHONE_WIDTH = "(width < 768px)";

function narrow(): boolean {
  return typeof matchMedia === "function" && matchMedia(PHONE_WIDTH).matches;
}

function subscribe(changed: () => void): () => void {
  if (typeof matchMedia !== "function") return () => undefined;
  const query = matchMedia(PHONE_WIDTH);
  query.addEventListener("change", changed);
  return () => {
    query.removeEventListener("change", changed);
  };
}

export function useNarrowScreen(): boolean {
  return useSyncExternalStore(subscribe, narrow);
}
