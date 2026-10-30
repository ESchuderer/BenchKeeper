import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Tests plan with the app's minimum skills CLI instead of asking the npm registry.
process.env.BENCHKEEPER_SKILLS_CLI = '1.7.2';

// Tests leave their mkdtemp folders behind: each test process (and its children) gets its own temp folder, removed on exit.
// shortcut: a killed process (Stryker timeout, kill -9, Ctrl-C) skips the exit handler and leaves its one folder; add a sweep of old bk-run-* folders if they pile up.
const dir = mkdtempSync(join(tmpdir(), 'bk-run-'));
Object.assign(process.env, { TMPDIR: dir, TEMP: dir, TMP: dir });
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
