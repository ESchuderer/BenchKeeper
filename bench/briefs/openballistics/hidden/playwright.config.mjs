import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [['json', { outputFile: process.env.PW_OUT || 'acceptance.json' }]],
  use: { baseURL: `http://localhost:${process.env.PORT || 3000}`, browserName: 'chromium' },
});
