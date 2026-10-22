// The Feed's API client and zod, loaded as their own chunk the first time the Feed tab opens or the
// robot story loads: the app shell never carries them (spec section 2's budget, docs/PERF.md). A
// load that failed offline is tried again the next time, without a reload (src/app/chunks.ts).

import { chunk } from "../app/chunks.ts";

export const loadFeedApi = chunk(() => import("./feed-api.ts"));
