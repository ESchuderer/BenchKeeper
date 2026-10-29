import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The signed-in cookie and API key, written by test/ui/login.setup.mjs.
export const STATE = join(tmpdir(), 'bk-ui-state-4410.json');

export default defineConfig({
  testDir: 'test/ui',
  use: { baseURL: 'http://127.0.0.1:4410/' },
  projects: [
    { name: 'login', testMatch: /login\.setup\.mjs/ },
    { name: 'ui', dependencies: ['login'], use: { storageState: STATE } },
  ],
  webServer: { command: 'node test/ui/serve.mjs', url: 'http://127.0.0.1:4410/', reuseExistingServer: false },
});
