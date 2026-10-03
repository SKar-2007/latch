import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// `@latch/client` ships TypeScript source with no build step. The alias resolves it before Vite's
// dependency pre-bundling sees it, so the same specifier works in `vite build`, `vite dev` and
// vitest without a separate `dist/` to keep in sync. `@/` mirrors tsconfig's `paths`.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@latch/client": r("../client/src/index.ts"),
      "@": r("./src"),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    // Three vendors rather than one 553 kB blob. `viem` and React are the bulk of the bundle and
    // neither changes when the app does, so splitting them keeps each chunk reviewable and keeps
    // the browser from re-fetching 171 kB of libraries over an edited line of UI. There is no lazy
    // boundary in the app today — everything is imported at first paint — so this is about chunk
    // shape, not about deferring work.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          viem: ["viem"],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
