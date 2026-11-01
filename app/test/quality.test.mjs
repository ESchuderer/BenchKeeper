import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { belowFloors, compare, knipFindings, modules, perModule } from '../scripts/quality.mjs';

const quality = JSON.parse(readFileSync(new URL('../quality.json', import.meta.url), 'utf8'));

test('quality: coverage is summed per module of the import rules, and a kind below its floor is named', () => {
  const lcov = [
    'SF:src/fsx.mjs\nFNF:2\nFNH:2\nBRF:4\nBRH:3\nLF:10\nLH:10\nend_of_record',
    'SF:src/merge.mjs\nFNF:2\nFNH:1\nBRF:0\nBRH:0\nLF:10\nLH:8\nend_of_record',
    'SF:src\\server.mjs\nFNF:1\nFNH:1\nLF:4\nLH:4\nend_of_record',
    'SF:scripts/other.mjs\nLF:5\nLH:0\nend_of_record\n',
  ].join('\n');
  const measured = perModule(lcov, modules());
  assert.deepEqual(measured, {
    core: { lines: 90, branches: 75, functions: 75 },
    server: { lines: 100, branches: 100, functions: 100 },
  });
  assert.deepEqual(belowFloors(measured, { core: { lines: 90, branches: 80 }, cli: { lines: 50 } }), ['core branches 75 < 80', 'cli lines 0 < 50']);
});

test('quality: every module of the import rules has coverage floors, every mutation module a source file', () => {
  assert.deepEqual(Object.keys(quality.coverage).sort(), Object.keys(modules()).sort());
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

test('quality: coverage without an lcov file prints the usage and exits 2', () => {
  const r = spawnSync(process.execPath, [new URL('../scripts/quality.mjs', import.meta.url).pathname, 'coverage'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^usage: node scripts\/quality\.mjs coverage <lcov file>/);
});

test('quality: started through a symlinked folder it still runs its command line', () => {
  const real = realpathSync(fileURLToPath(new URL('../scripts', import.meta.url)));
  const link = join(mkdtempSync(join(tmpdir(), 'bk-quality-')), 'link');
  symlinkSync(real, link, 'dir');
  for (const dir of [real, link]) {
    const r = spawnSync(process.execPath, [join(dir, 'quality.mjs'), 'nothing'], { encoding: 'utf8' });
    assert.deepEqual([r.status, r.stderr.split('\n')[0]], [2, 'usage: node scripts/quality.mjs coverage <lcov file> | baselines [--write]'], dir);
  }
});
