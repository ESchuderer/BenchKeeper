import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The signed-in cookie and API key, written by test/ui/login.setup.mjs.
export const STATE = join(tmpdir(), 'bk-ui-state-4410.json');
const PARTS = ['ui-1-shell', 'ui-2-dashboard', 'ui-3-catalog-projects', 'ui-4-history-apply', 'ui-5-settings-rules', 'ui-6-extensions-accounts'];
const CHAIN = /ui-\d-[\w-]+\.spec\.mjs/;

export default defineConfig({
  testDir: 'test/ui',
  use: { baseURL: 'http://127.0.0.1:4410/' },
  projects: [
    { name: 'login', testMatch: /login\.setup\.mjs/ },
    { name: 'ui', dependencies: ['login'], use: { storageState: STATE }, testIgnore: CHAIN },
    // The serial chain (test/ui/chain.mjs): each part starts once the part before it passed.
    ...PARTS.map((part, i) => ({ name: part, testMatch: `${part}.spec.mjs`, dependencies: [i ? PARTS[i - 1] : 'login'], use: { storageState: STATE } })),
  ],
  webServer: { command: 'node test/ui/serve.mjs', url: 'http://127.0.0.1:4410/', reuseExistingServer: false },
});
