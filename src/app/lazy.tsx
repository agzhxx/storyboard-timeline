// A component from a lazily loaded chunk (src/app/chunks.ts), mounted while it's wanted: the export
// dialog, the shortcuts, the New project confirmation, the phone view. A chunk that won't load
// (offline) calls `failed` instead of taking the app down, and is tried again the next time.

import { type ComponentType, useEffect, useState } from "react";

/** Mounts the chunk's component while `open`; `load` and `failed` must be stable functions. */
export function LazyHost({
  open,
  load,
  failed,
}: {
  open: boolean;
  load: () => Promise<ComponentType>;
  failed: () => void;
}) {
  const [Loaded, setLoaded] = useState<ComponentType | null>(null);
  useEffect(() => {
    if (!open || Loaded) return;
    let wanted = true;
    load().then(
      (component) => {
        if (wanted) setLoaded(() => component);
      },
      () => {
        if (wanted) failed();
      },
    );
    return () => {
      wanted = false;
    };
  }, [open, Loaded, load, failed]);
  return open && Loaded ? <Loaded /> : null;
}
