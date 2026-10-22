import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/ui',
  use: { baseURL: 'http://127.0.0.1:4410/' },
  webServer: { command: 'node test/ui/serve.mjs', url: 'http://127.0.0.1:4410/', reuseExistingServer: false },
});
