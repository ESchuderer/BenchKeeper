import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { costs, costTable, facts } from '../../plugins/benchkeeper/skills/orchestrating-projects/facts.mjs';

const FIXTURES = fileURLToPath(new URL('./fixtures/facts/', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../../plugins/benchkeeper/skills/orchestrating-projects/facts.mjs', import.meta.url));
const RUN = join(FIXTURES, 'run');
const NOW = Date.parse('2026-11-13T12:00:00Z');
const COMMANDS = JSON.parse(readFileSync(join(FIXTURES, 'commands.json'), 'utf8'));

// A fake gh and cswap: each argv, the GraphQL query as <query>, prints its fixture, or fails with its exit code as execFileSync throws.
const fake = (commands) => (cmd, args) => {
  const found = commands[[cmd, ...args.map((a) => (a.startsWith('query=') ? 'query=<query>' : a))].join(' ')];
  if (!found) throw Object.assign(new Error(`not faked: ${cmd} ${args.join(' ')}`), { status: 1, stdout: '', stderr: '' });
  const stdout = found.out === undefined ? '' : JSON.stringify(found.out);
  if (found.exit) throw Object.assign(new Error('exit'), { status: found.exit, stdout, stderr: found.stderr ?? '' });
  return stdout;
};
const write = (commands) => facts({ run: RUN, repos: ['octo/app', 'octo/lib'], tracker: 'octo/tracker', labels: ['project:app'], accounts: true, now: NOW, exec: fake(commands), alive: (pid) => pid === 4242 });

test('facts: job files, gh and cswap output give the expected facts.md', () => {
  assert.equal(write(COMMANDS), readFileSync(join(FIXTURES, 'facts.md'), 'utf8'));
});

test('facts: a failing gh call reads unread in its own section only', () => {
  const text = write({ ...COMMANDS, 'gh pr list -R octo/app --state open --limit 100 --json number,title,headRefOid,mergeable': { exit: 1, stderr: 'HTTP 502' }, 'cswap list --json': { exit: 1 } });
  assert.ok(text.includes('### octo/app\n\nunread\n\n### octo/lib\n'));
  assert.ok(text.includes('| 20 | feat: lib | 9d9d9d9 | UNKNOWN | none | unread | - |'));
  assert.ok(text.includes('## Accounts\n\nunread\n\n## Main'));
  assert.ok(text.includes('| 41 | project:app | ready-for-human | a | 2026-11-13T09:00Z |'));
});

test('facts costs: per merged pull request the summed job cost and the changes rounds, with totals and medians', () => {
  const found = costs({ run: RUN, repos: ['octo/app', 'octo/lib'], since: '2026-11-12', until: '2026-11-13', exec: fake(COMMANDS) });
  assert.equal(costTable(found), `| PR | Merged | Jobs | Cost (USD) | Fix rounds |
|---|---|---|---|---|
| octo/app#15 | 2026-11-12T08:00Z | 1 | 3.00 | 0 |
| octo/app#12 | 2026-11-13T11:45Z | 4 | 4.50 | 2 |

Totals: 2 pull requests, cost 7.50 USD, fix rounds 2.
Medians per pull request: cost 3.75 USD, fix rounds 1.
`);
  assert.throws(() => costs({ run: RUN, repos: ['octo/other'], since: '2026-11-12', until: '2026-11-13', exec: fake(COMMANDS) }), /unread/);
});

test('facts write: a gh that cannot start still writes facts.md, exit 0; a run folder that is a link or outside .benchkeeper/runs is refused', () => {
  const home = mkdtempSync(join(tmpdir(), 'facts-'));
  const runs = join(home, '.benchkeeper', 'runs');
  mkdirSync(join(runs, 'real'), { recursive: true });
  symlinkSync(join(runs, 'real'), join(runs, 'link'), 'dir');
  mkdirSync(join(home, 'outside'));
  const empty = mkdtempSync(join(tmpdir(), 'no-gh-'));
  const run = (folder) => spawnSync(process.execPath, [SCRIPT, 'write', '--run', folder, '--repo', 'octo/app'], { cwd: home, encoding: 'utf8', env: { ...process.env, PATH: empty } });

  const ok = run('.benchkeeper/runs/real');
  assert.equal(ok.status, 0, ok.stderr);
  assert.ok(readFileSync(join(runs, 'real', 'facts.md'), 'utf8').includes('### octo/app\n\nunread\n'));
  for (const folder of ['.benchkeeper/runs/link', '.benchkeeper/runs/link/', 'outside', '.benchkeeper/runs/../../outside']) {
    const refused = run(folder);
    assert.equal(refused.status, 2, folder);
    assert.match(refused.stderr, /^refused: /, folder);
  }
  assert.ok(!existsSync(join(home, 'outside', 'facts.md')));
});
