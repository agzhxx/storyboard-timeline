import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config.ts";

// The end-to-end tests in Playwright's Firefox engine, for the browser matrix (docs/PERF.md, M8):
// `pnpm test:e2e:firefox`, after `pnpm build` and, once, `pnpm exec playwright install firefox`.
// Not in CI. Its pages are silent, as WebKit's are (e2e/test.ts).
export default defineConfig({
  ...base,
  projects: [
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"], viewport: { width: 1440, height: 900 } },
    },
  ],
});
