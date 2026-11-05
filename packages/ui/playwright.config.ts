import { defineConfig } from "@playwright/test";

// The browser tests are test/*.spec.ts; test/*.test.ts are Vitest unit tests of the workflow model.
export default defineConfig({ testDir: "test", testMatch: "*.spec.ts" });
