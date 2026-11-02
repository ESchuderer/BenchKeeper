import { defineConfig } from '@playwright/test';
import { BASE } from './tests/base.ts';

export default defineConfig({
  testDir: 'tests',
  use: { baseURL: `http://localhost:4321${BASE}` },
  // Serves the built dist/ under the edition's base (SITE_EDITION reaches docusaurus.config.ts through the environment).
  webServer: { command: 'npx docusaurus serve --dir dist --port 4321 --no-open', url: `http://localhost:4321${BASE}`, reuseExistingServer: false },
});
