import { defineConfig } from '@playwright/test';
import { BASE } from './tests/base';

export default defineConfig({
  testDir: 'tests',
  use: { baseURL: `http://localhost:4321${BASE}` },
  webServer: { command: 'npx astro preview --port 4321 --ignore-lock', url: `http://localhost:4321${BASE}`, reuseExistingServer: false, env: { ASTRO_TELEMETRY_DISABLED: '1' } },
});
