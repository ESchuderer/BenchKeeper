import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compare, knipFindings } from '../scripts/quality.mjs';

const quality = JSON.parse(readFileSync(new URL('../quality.json', import.meta.url), 'utf8'));

test('quality: every mutation module has a source file', () => {
  for (const m of Object.keys(quality.mutation)) assert.ok(existsSync(new URL(`../src/${m}.mjs`, import.meta.url)), m);
});

test('quality: the baselines only shrink, a new finding or more duplicated lines fail, a fixed finding must leave the file', () => {
  const report = { issues: [{ file: 'src/a.mjs', exports: [{ name: 'x', line: 3 }], files: [], dependencies: [] }, { file: 'package.json', devDependencies: [{ name: 'p' }] }] };
  const run = { knip: knipFindings(report), duplicatedLines: { app: 12, web: 3 } };
  assert.deepEqual(run.knip, ['devDependencies package.json p', 'exports src/a.mjs x']);

  assert.deepEqual(compare({ knip: run.knip, duplicatedLines: { app: 12, web: 3 } }, run).problems, []);
  const grown = compare({ knip: ['exports src/a.mjs x'], duplicatedLines: { app: 10, web: 3 } }, run);
  assert.deepEqual(grown.problems, ['new knip finding: devDependencies package.json p', 'app duplicated lines 12 > baseline 10']);
  assert.deepEqual(grown.shrunk, { knip: ['exports src/a.mjs x'], duplicatedLines: { app: 10, web: 3 } });
  assert.deepEqual(compare({ knip: run.knip, duplicatedLines: { app: 12 } }, run).problems, ['web duplicated lines 3 > baseline 0']);

  const fixed = compare({ knip: [...run.knip, 'exports src/b.mjs y'], duplicatedLines: { app: 20, web: 3 } }, run);
  assert.equal(fixed.problems.length, 2);
  assert.ok(fixed.problems.every((p) => p.endsWith('(run with --write)')));
  assert.deepEqual(fixed.shrunk, { knip: run.knip, duplicatedLines: { app: 12, web: 3 } });
});

test('quality: started through a symlinked folder it still runs its command line', () => {
  const real = realpathSync(fileURLToPath(new URL('../scripts', import.meta.url)));
  const link = join(mkdtempSync(join(tmpdir(), 'bk-quality-')), 'link');
  symlinkSync(real, link, 'dir');
  for (const dir of [real, link]) {
    const r = spawnSync(process.execPath, [join(dir, 'quality.mjs'), 'nothing'], { encoding: 'utf8' });
    assert.deepEqual([r.status, r.stderr.split('\n')[0]], [2, 'usage: node scripts/quality.mjs baselines [--write]'], dir);
  }
});
