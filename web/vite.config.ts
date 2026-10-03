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
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
