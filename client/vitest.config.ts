import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // The decoder and builder are pure, so there is nothing to isolate. Determinism matters more
    // than speed here: a fuzz failure has to be reproducible from the seed in the failure message.
    sequence: { shuffle: false },
  },
});
