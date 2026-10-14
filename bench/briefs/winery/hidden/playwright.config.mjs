import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [['json', { outputFile: process.env.PW_OUT || 'acceptance.json' }]],
  use: { baseURL: `http://127.0.0.1:${process.env.PORT || 3000}`, browserName: 'chromium' },
});
