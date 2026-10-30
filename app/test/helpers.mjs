// Setup shared by several test files.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { genericDir, load } from '../src/automations.mjs';
import { context } from '../src/runner.mjs';

// Makes dir a git repository on main with one commit (README.md) and returns a git runner in it.
export function initRepo(dir) {
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  writeFileSync(join(dir, 'README.md'), '# P\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  return git;
}

// The generic automation template with this id, loaded in a fresh home.
export const automationTemplate = (id) => load(context({ home: mkdtempSync(join(tmpdir(), `bk-${id}-`)) }), [['generic', genericDir]]).templates.find((t) => t.id === id);
export const sh = { skip: process.platform === 'win32' && 'sh helpers' };

// A host account folder below ctx.home; a tracked one holds the usage script.
export function hostAccount(ctx, name, tracked) {
  const dir = join(ctx.home, `acct-${name}`);
  mkdirSync(join(dir, 'benchkeeper'), { recursive: true });
  if (tracked) writeFileSync(join(dir, 'benchkeeper/usage.mjs'), '');
  return { name, agent: 'claude', mode: 'host', dir };
}

// A request to the local server on port; resolves with its status, headers and body.
export function httpRequest(port, method, path, headers = {}, body, timeoutMs) {
  return new Promise((ok, fail) => {
    const r = request({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: data }));
    });
    r.on('error', fail);
    if (timeoutMs) r.setTimeout(timeoutMs, () => r.destroy(new Error('no answer')));
    r.end(body);
  });
}
