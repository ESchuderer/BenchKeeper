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
