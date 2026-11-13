import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Tests plan with the app's minimum skills CLI instead of asking the npm registry.
process.env.CEDARLOOM_APP_SKILLS_CLI = '1.7.2';

// The folders the agents and the skills CLI read from these variables follow the test's fixture home, not the caller's
// (an agent session that runs the tests has CLAUDE_CONFIG_DIR set, for example).
for (const v of ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME']) delete process.env[v];

// Started from a git hook or `git rebase --exec`, these name the caller's repository: a test's `git -C <fixture>` would then init, configure and commit there.
for (const v of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_PREFIX']) delete process.env[v];

// Tests leave their mkdtemp folders behind: each test process (and its children) gets its own temp folder, removed on exit.
// shortcut: a killed process (Stryker timeout, kill -9, Ctrl-C) skips the exit handler and leaves its one folder; add a sweep of old bk-run-* folders if they pile up.
const dir = mkdtempSync(join(tmpdir(), 'bk-run-'));
Object.assign(process.env, { TMPDIR: dir, TEMP: dir, TMP: dir });
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
