import { defineConfig } from "vitest/config";

// Shared by every package: its test script runs `vitest run --config ../../vitest.config.ts` in the package folder.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      enabled: true,
      provider: "v8",
      include: ["src/**"],
      // A package's process entry (`src/bin.ts`) runs in a child process in its tests, which coverage does not see.
      exclude: ["src/bin.ts"],
      reporter: ["text"],
    },
  },
});
