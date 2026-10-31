import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { exportScript, userDir } from '../src/automations.mjs';
import { main } from '../src/cli.mjs';
import { context } from '../src/runner.mjs';

const PROMPT = `Check it's "quoted" $HOME \`date\` automation-probe.
Run \`probe/list.sh {{flag}}\` and read its lines.`;

// A user template whose precheck helper exits with the code in the file go, so a test picks whether the agent starts.
function setup({ agent = 'claude', schedule = '0 7 * * 1' } = {}) {
  const ctx = context({ home: mkdtempSync(join(tmpdir(), 'bk-export-')) });
  const dir = join(userDir(ctx), 'probe');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(userDir(ctx), 'probe.md'), `+++
id = "probe"
title = "Probe"
agent = "${agent}"
schedule = "${schedule}"
precheck = 'probe/precheck.sh "{{flag}}"'
helpers = ["probe/precheck.sh", "probe/list.sh"]

[parameters.flag]
default = "x"
description = "passed through"
+++
${PROMPT}
`);
  writeFileSync(join(dir, 'precheck.sh'), '#!/bin/sh\necho "$1 $(dirname "$0")" > seen\nexit "$(cat go)"\nHELPER\n', { mode: 0o755 });
  writeFileSync(join(dir, 'list.sh'), '#!/bin/sh\necho one\n', { mode: 0o755 });
  const project = mkdtempSync(join(tmpdir(), 'bk-export-project-'));
  const bin = mkdtempSync(join(tmpdir(), 'bk-export-bin-'));
  // The stand-in agent writes its arguments, each followed by a -- line.
  writeFileSync(join(bin, agent), '#!/bin/sh\nfor a in "$@"; do printf "%s\\n--\\n" "$a"; done > args\n', { mode: 0o755 });
  return { ctx, project, bin };
}

const run = (script, { project, bin }, go) => {
  writeFileSync(join(project, 'go'), String(go));
  const file = join(project, 'probe.sh');
  writeFileSync(file, script);
  execFileSync('sh', [file], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  return existsSync(join(project, 'args')) ? readFileSync(join(project, 'args'), 'utf8').split('\n--\n') : null;
};

test('export: the precheck runs in the project folder with its helpers, a non-zero exit starts no agent', () => {
  const s = setup();
  const script = exportScript(s.ctx, 'probe', { values: { flag: 'b' }, dir: s.project });
  assert.match(script, /^#!\/bin\/sh\n/);
  assert.match(script, /^# 0 7 \* \* 1 \/path\/to\/probe\.sh$/m);
  assert.equal(run(script, s, 1), null);
  const [flag, helpers] = readFileSync(join(s.project, 'seen'), 'utf8').trim().split(' ');
  assert.equal(flag, 'b');
  assert.equal(existsSync(helpers), false, 'the helper folder is removed at the end');
});

test('export: precheck 0 runs claude headless with the prompt intact and the helper paths filled in', () => {
  const s = setup();
  const [p, prompt, ...flags] = run(exportScript(s.ctx, 'probe', { values: { flag: 'b' }, dir: s.project }), s, 0);
  assert.deepEqual([p, ...flags], ['-p', '--permission-mode', 'dontAsk', '']);
  const expected = PROMPT.replace('{{flag}}', 'b');
  const helper = prompt.match(/`(\S+)\/list\.sh b`/)[1];
  assert.equal(prompt, expected.replace('probe/list.sh', `${helper}/list.sh`));
  assert.notEqual(helper, 'probe');
});

test('export: codex runs codex exec in a workspace-write sandbox', () => {
  const s = setup({ agent: 'codex' });
  const args = run(exportScript(s.ctx, 'probe', { dir: s.project }), s, 0);
  assert.deepEqual(args.slice(0, 3), ['exec', '--sandbox', 'workspace-write']);
  assert.match(args[3], /automation-probe/);
});

test('export refuses a template it cannot run without the runner', () => {
  assert.throws(() => exportScript(setup({ schedule: '' }).ctx, 'probe', { dir: '.' }), /not a cron line/);
  assert.throws(() => exportScript(setup({ schedule: 'FREQ=DAILY' }).ctx, 'probe', { dir: '.' }), /not a cron line/);
  assert.throws(() => exportScript(setup({ agent: 'gemini' }).ctx, 'probe', { dir: '.' }), /claude or codex, not gemini/);
  assert.throws(() => exportScript(setup().ctx, 'probe', { values: { flag: 'a;b' }, dir: '.' }), /parameter flag/);
});

test('automations export prints the script, --json carries it, a missing id is a usage error', async () => {
  const s = setup();
  const lines = [];
  const cli = (argv) => main(argv, { out: { write: (x) => { lines.push(x); } }, err: { write: () => {} }, ctx: s.ctx });
  assert.equal(await cli(['automations', 'export', 'probe', '--project', s.project, '--param', 'flag=c']), 0);
  assert.match(lines.pop(), /\("\$helpers"\/'precheck\.sh' "c"\) \|\| exit 0/);
  assert.equal(await cli(['automations', 'export', 'probe', '--json']), 0);
  assert.match(JSON.parse(lines.pop()).script, /^#!\/bin\/sh/);
  assert.equal(await cli(['automations', 'export']), 2);
  assert.match(lines.pop(), /export needs a template id/);
});
