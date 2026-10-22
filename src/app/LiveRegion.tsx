// The app's one polite live region (src/app/announcer.ts): always in the page, out of sight, so
// what goes into it is read out.

import { useAnnouncer } from "./announcer.ts";

export function LiveRegion() {
  const text = useAnnouncer((state) => state.text);
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {text}
    </div>
  );
}
