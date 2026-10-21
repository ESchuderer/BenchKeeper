import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('failed rescoring leaves prior checkpoint and final results intact and rescores the other trials', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bench-rescore-'));
  try {
    const bench = join(dir, 'bench'), run = join(dir, 'run'), trial = join(run, 'round-1/A');
    mkdirSync(join(bench, 'scorer'), { recursive: true });
    for (const d of ['score', 'steps/1', 'log', 'workspace']) mkdirSync(join(trial, d), { recursive: true });
    copyFileSync(new URL('../rescore.sh', import.meta.url), join(bench, 'rescore.sh'));
    writeFileSync(join(bench, 'scorer/score.sh'), '#!/bin/sh\nmkdir -p "$3" "$(dirname "$3")/steps/1"\necho broken > "$3/score.json"\necho broken > "$(dirname "$3")/steps/1/checks.json"\ncase $2 in */round-1/A/*) exit 1 ;; esac\n', { mode: 0o755 });
    const other = join(run, 'round-1/B'), bin = join(dir, 'bin');
    for (const d of ['score', 'log', 'workspace']) mkdirSync(join(other, d), { recursive: true });
    for (const [f, v] of [['agent.exit', '0'], ['trial.json', '{}'], ['score/score.json', 'original']]) writeFileSync(join(other, f), v);
    mkdirSync(bin);
    writeFileSync(join(bin, 'podman'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    for (const f of ['agent.exit', 'trial.json', 'score/score.json', 'steps/1/checks.json', 'steps/1/repo.tar.gz']) writeFileSync(join(trial, f), 'original');
    const result = spawnSync('sh', [join(bench, 'rescore.sh'), run, 'scb-xjq'], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /previous results kept/);
    assert.match(result.stderr, /rescoring failed for: round-1\/A\//);
    assert.equal(readFileSync(join(other, 'score/score.json'), 'utf8'), 'broken\n');
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
