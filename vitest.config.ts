import { defineConfig } from "vitest/config";

// Shared by every package: its test script runs `vitest run --config ../../vitest.config.ts` in the package folder.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      enabled: true,
      provider: "v8",
      include: ["src/**"],
      reporter: ["text"],
      // Floors on Linux and macOS; Windows skips the tests of POSIX file modes, so it runs without them. Branches stop
      // at 95: the rest are defensive checks the types require but no input reaches.
      thresholds: process.platform === "win32" ? {} : { lines: 100, statements: 100, functions: 100, branches: 95 },
    },
  },
});
