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
function setup({ agent = 'claude', schedule = '0 7 * * 1', precheck = 'probe/precheck.sh "{{flag}}"', list = 'list.sh' } = {}) {
  const ctx = context({ home: mkdtempSync(join(tmpdir(), 'bk-export-')) });
  const dir = join(userDir(ctx), 'probe');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(userDir(ctx), 'probe.md'), `+++
id = "probe"
title = "Probe"
agent = "${agent}"
schedule = "${schedule}"
precheck = '${precheck}'
helpers = ["probe/precheck.sh", "probe/${list}"]

[parameters.flag]
default = "x"
description = "passed through"
+++
${PROMPT}
`);
  writeFileSync(join(dir, 'precheck.sh'), '#!/bin/sh\necho "$1 $(dirname "$0")" > seen\nexit "$(cat go)"\nHELPER\n', { mode: 0o755 });
  mkdirSync(join(dir, list, '..'), { recursive: true });
  writeFileSync(join(dir, list), '#!/bin/sh\necho one\n', { mode: 0o755 });
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
  const helper = prompt.match(/`(\S+)\/list\.sh b`/)[1];
  assert.deepEqual([p, ...flags.slice(0, 3)], ['-p', '--permission-mode', 'dontAsk', '--allowedTools']);
  assert.deepEqual(flags.slice(3, -1), ['precheck.sh', 'list.sh'].map((f) => `Bash(${helper}/${f} *)`));
  const expected = PROMPT.replace('{{flag}}', 'b');
  assert.equal(prompt, expected.replace('probe/list.sh', `${helper}/list.sh`));
  assert.notEqual(helper, 'probe');
});

test('export: codex runs codex exec in a workspace-write sandbox', () => {
  const s = setup({ agent: 'codex' });
  const args = run(exportScript(s.ctx, 'probe', { dir: s.project }), s, 0);
  assert.deepEqual(args.slice(0, 4), ['exec', '--sandbox', 'workspace-write', '--']);
  assert.match(args[4], /automation-probe/);
});

test('export: docs/automations.md shows the agent command each exported script runs', () => {
  const doc = readFileSync(new URL('../../docs/automations.md', import.meta.url), 'utf8');
  for (const agent of ['claude', 'codex']) {
    const s = setup({ agent });
    const line = exportScript(s.ctx, 'probe', { dir: s.project }).split('\n').find((l) => l.startsWith(`${agent} `));
    // The script passes the claude allow rules through "$@"; the table writes them out.
    const shown = line.replace(' "$@"', '');
    assert.ok(doc.includes(`| \`${agent}\` | \`${shown}`), `${agent}: ${shown}`);
  }
});

test('export: a helper in a subfolder is unpacked into the same subfolder', () => {
  const s = setup({ list: 'sub/list.sh' });
  const script = exportScript(s.ctx, 'probe', { dir: s.project });
  assert.match(script, /mkdir -p "\$helpers"\/'sub'\ncat > "\$helpers"\/'sub\/list\.sh'/);
  const [, , ...flags] = run(script, s, 0);
  assert.match(flags.join(' '), /Bash\(\S+\/sub\/list\.sh \*\)/);
});

test('export: an agent missing from PATH fails with exit 127 before the precheck', () => {
  const s = setup();
  const file = join(s.project, 'probe.sh');
  writeFileSync(file, exportScript(s.ctx, 'probe', { dir: s.project }));
  assert.throws(() => execFileSync('/bin/sh', [file], { env: { PATH: '/nonexistent' }, stdio: 'pipe' }), (e) => e.status === 127 && /claude is not in PATH/.test(e.stderr));
  assert.equal(existsSync(join(s.project, 'seen')), false);
});

test('export refuses a template it cannot run without the runner', () => {
  assert.throws(() => exportScript(setup({ schedule: '' }).ctx, 'probe', { dir: '.' }), /not a cron line/);
  assert.throws(() => exportScript(setup({ schedule: 'FREQ=DAILY' }).ctx, 'probe', { dir: '.' }), /not a cron line/);
  assert.throws(() => exportScript(setup({ precheck: '' }).ctx, 'probe', { dir: '.' }), /has no precheck/);
  assert.throws(() => exportScript(setup({ precheck: '{{flag}}' }).ctx, 'probe', { values: { flag: '' }, dir: '.' }), /has no precheck/);
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
