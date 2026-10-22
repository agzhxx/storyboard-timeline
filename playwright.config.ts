import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
/** The design canvas's editor boards are 1440 × 900. */
const DESIGN_VIEWPORT = { width: 1440, height: 900 };
const isCI = Boolean(process.env.CI);

// Runs against the production build: `pnpm build` first.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    // Google Chrome rather than the bundled Chromium: it has the H.264 and AAC codecs that
    // playback and export need (spec section 5). WebKit runs the UI tests too.
    {
      name: "chrome",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        viewport: DESIGN_VIEWPORT,
        // Silent on this machine's speakers, headed too; the audio clock still runs.
        launchOptions: { args: ["--mute-audio"] },
      },
    },
    { name: "webkit", use: { ...devices["Desktop Safari"], viewport: DESIGN_VIEWPORT } },
  ],
  webServer: {
    command: `pnpm preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !isCI,
  },
});
