import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // As in vite.config.ts: the Genframe Kit's components import with @/.
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
    // Vitest turns CSS imports into empty strings; the token tests read these two files.
    css: { include: [/src\/app\/(editor-)?tokens\.css/] },
  },
});
