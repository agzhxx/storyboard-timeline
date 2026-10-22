// Whether this browser is online (spec section 3.6, "Offline"): navigator.onLine and its events.
// Offline here means the connection went while the app was open; there's no service worker, so a
// reload offline doesn't load the app at all. Offline, local editing works
// as ever, the Feed tab says what still works, and the Feed's clips keep the filmstrips this
// browser stored. A request that fails while the browser thinks it's online is the Feed being
// unreachable, which the Feed tab already says. When the connection comes back, what didn't load
// is asked for again: filmstrips, and the Feed tab's page.

import { create } from "zustand";
import { retryFeedAfterReconnect } from "../feed/feed-store.ts";
import { retryFailedRemoteMedia } from "../media/remote-media.ts";

export const useOnline = create<{ online: boolean }>(() => ({ online: navigator.onLine }));

/** Follows the connection until the returned function is called. */
export function watchConnection(): () => void {
  const update = () => {
    const back = navigator.onLine && !useOnline.getState().online;
    useOnline.setState({ online: navigator.onLine });
    if (!back) return;
    retryFailedRemoteMedia();
    retryFeedAfterReconnect();
  };
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  return () => {
    window.removeEventListener("online", update);
    window.removeEventListener("offline", update);
  };
}
