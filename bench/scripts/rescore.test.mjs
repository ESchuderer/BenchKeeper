import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('failed rescoring leaves prior checkpoint and final results intact', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bench-rescore-'));
  try {
    const bench = join(dir, 'bench'), run = join(dir, 'run'), trial = join(run, 'round-1/A');
    mkdirSync(join(bench, 'scorer'), { recursive: true });
    for (const d of ['score', 'steps/1', 'log', 'workspace']) mkdirSync(join(trial, d), { recursive: true });
    copyFileSync(new URL('../rescore.sh', import.meta.url), join(bench, 'rescore.sh'));
    writeFileSync(join(bench, 'scorer/score.sh'), '#!/bin/sh\nmkdir -p "$3" "$(dirname "$3")/steps/1"\necho broken > "$3/score.json"\necho broken > "$(dirname "$3")/steps/1/checks.json"\nexit 1\n', { mode: 0o755 });
    for (const f of ['agent.exit', 'trial.json', 'score/score.json', 'steps/1/checks.json', 'steps/1/repo.tar.gz']) writeFileSync(join(trial, f), 'original');
    const result = spawnSync('sh', [join(bench, 'rescore.sh'), run, 'scb-xjq'], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /previous results kept/);
    for (const f of ['trial.json', 'score/score.json', 'steps/1/checks.json', 'steps/1/repo.tar.gz']) assert.equal(readFileSync(join(trial, f), 'utf8'), 'original');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test('a corrupt checkpoint archive is a scoring error before any solution check', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bench-corrupt-'));
  try {
    for (const d of ['brief/checks', 'trial/steps/1', 'workspace', 'bin']) mkdirSync(join(dir, d), { recursive: true });
    writeFileSync(join(dir, 'brief/brief.json'), '{"steps":"sessions"}');
    writeFileSync(join(dir, 'trial/steps/1/repo.tar.gz'), 'not a gzip archive');
    writeFileSync(join(dir, 'brief/checks/step1.sh'), '#!/bin/sh\necho ran > "$2/check-ran"\n', { mode: 0o755 });
    writeFileSync(join(dir, 'bin/podman'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const result = spawnSync('sh', [new URL('../scorer/score.sh', import.meta.url).pathname,
      join(dir, 'brief'), join(dir, 'workspace'), join(dir, 'trial/score')], { encoding: 'utf8', env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}` } });
    assert.equal(result.status, 1);
    const checks = JSON.parse(readFileSync(join(dir, 'trial/steps/1/checks.json'), 'utf8'));
    assert.equal(checks.infrastructure_error, 'checkpoint archive extraction failed');
    assert.deepEqual(checks.checks, []);
    assert.throws(() => readFileSync(join(dir, 'trial/steps/1/check-ran')), /ENOENT/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
