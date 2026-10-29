import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fill, genericDir, load } from '../src/automations.mjs';
import { context } from '../src/runner.mjs';

const plan = readFileSync(new URL('./fixtures/automations/update-all-plan.json', import.meta.url), 'utf8');
const template = () => load(context({ home: mkdtempSync(join(tmpdir(), 'bk-ua-')) }), [['generic', genericDir]]).templates.find((t) => t.id === 'update-all');

// The precheck with a fake npx on PATH that records its arguments and prints the plan document.
function precheck(values, doc) {
  const bin = mkdtempSync(join(tmpdir(), 'bk-ua-bin-'));
  writeFileSync(join(bin, 'plan.json'), doc);
  writeFileSync(join(bin, 'npx'), `#!/bin/sh\necho "$@" > '${bin}/args'\ncat '${bin}/plan.json'\n`, { mode: 0o755 });
  const r = spawnSync('sh', ['-c', fill(template(), values).precheck], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  return { code: r.status, args: readFileSync(join(bin, 'args'), 'utf8').trim() };
}

test('update-all: parameters projects, push and mode, report only by default', () => {
  const t = template();
  assert.deepEqual(Object.keys(t.parameters), ['projects', 'push']);
  assert.deepEqual(fill(t).values, { mode: 'report', projects: '', push: 'false' });
});

test('update-all precheck: starts the run only when the plan reports an outdated project', { skip: process.platform === 'win32' && 'sh precheck' }, () => {
  assert.deepEqual(precheck({ projects: '/projects/a,/projects/b' }, plan), { code: 0, args: '-y benchkeeper@6 projects update --dry-run --unattended --json /projects/a /projects/b' });
  assert.deepEqual(precheck({}, plan).args, '-y benchkeeper@6 projects update --dry-run --unattended --json');
  assert.equal(precheck({}, plan.replace('"ready": true', '"ready": false')).code, 1);
});

test('update-all: the precheck decides ready with the same command as the prompt', { skip: process.platform === 'win32' && 'sh precheck' }, () => {
  assert.ok(template().prompt.includes(`\`npx ${precheck({}, plan).args}\``));
});
