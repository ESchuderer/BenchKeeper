import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  use: { baseURL: 'http://localhost:4321/BenchKeeper/' },
  webServer: { command: 'npx astro preview --port 4321 --ignore-lock', url: 'http://localhost:4321/BenchKeeper/', reuseExistingServer: false, env: { ASTRO_TELEMETRY_DISABLED: '1' } },
});
