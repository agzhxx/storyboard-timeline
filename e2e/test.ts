// The e2e tests' `test`: Playwright's, with WebKit's and Firefox's pages silent. The fixtures' tones
// and the demo music would otherwise play through the speakers of whoever runs the tests. Chrome
// runs with --mute-audio (playwright.config.ts); WebKit and Firefox have no such switch, so there
// each AudioContext plays through a gain of 0, and its clock runs as it would. Firefox runs by
// hand (the browser matrix in docs/PERF.md, M8).

import { test as base } from "@playwright/test";
import { silenceAudio } from "./silence.ts";

export { expect } from "@playwright/test";

export const test = base.extend<{ silent: undefined }>({
  silent: [
    async ({ browserName, context }, use) => {
      if (browserName !== "chromium") await context.addInitScript(silenceAudio);
      await use(undefined);
    },
    { auto: true },
  ],
});
