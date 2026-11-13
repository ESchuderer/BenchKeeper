// Usage: node facts.mjs write --run <run folder> --repo <owner/name> [--repo ...] [--tracker <owner/name> --labels <label,...>] [--accounts]. Writes <run folder>/facts.md from the job files, gh and cswap, exit 0: a source that cannot be read shows "unread" in its section.
// Usage: node facts.mjs costs --run <run folder> --repo <owner/name> [--repo ...] --since <YYYY-MM-DD> --until <YYYY-MM-DD> [--json]. Per pull request merged in the period: its jobs' summed cost and its fix rounds (changes verdicts), then totals and medians; exit 2 when gh cannot list the merged pull requests.
// The run folder is .benchkeeper/runs/ of the working directory or a folder below it, not a link; any other exits 2. The tracker is named on the command line only: a public repository must not name a private tracker.
import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { answer } from './approval.mjs';
import { escaped, isMain, json, sh } from './policy.mjs';

const DAY = 24 * 3600_000;
const UNREAD = 'unread';
const REVIEWS = ['review', 'recheck', 'verify'];
const VERDICT = /^Verdict: (approve|changes|owner) ([0-9a-f]{40})\s*$/;
const BUCKETS = ['pass', 'fail', 'pending', 'skipping', 'cancel'];
const THREADS = 'query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { pullRequests(states: OPEN, first: 100) { nodes { number reviewThreads(first: 100) { nodes { isResolved } } } } } }';

// Text from gh, cswap or a job file goes into a file a model reads: a pipe would split the cell and a control character could rewrite the line.
const cell = (v) => (v === undefined || v === null || v === '' ? '-' : escaped(String(v)).replace(/[\\|]/g, '\\$&'));
const row = (cells) => `| ${cells.map(cell).join(' | ')} |`;
const table = (head, rows) => (rows.length ? [row(head), `|${head.map(() => '---').join('|')}|`, ...rows.map(row)] : ['none']);
const utc = (t) => { const ms = typeof t === 'string' ? Date.parse(t) : NaN; return Number.isNaN(ms) ? null : `${new Date(ms).toISOString().slice(0, 16)}Z`; };
const age = (ms) => {
  const m = Math.max(0, Math.floor(ms / 60_000)), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d ? `${d}d${String(h % 24).padStart(2, '0')}h` : h ? `${h}h${String(m % 60).padStart(2, '0')}m` : `${m}m`;
};
const data = (text) => { try { return JSON.parse(text); } catch { return null; } };
// stdout of a command, or null when it failed.
const read = (exec, cmd, args) => { try { return exec(cmd, args); } catch { return null; } };
// undefined for a missing file, null for one that is no JSON; a link or a FIFO in the run folder is not followed.
const file = (path) => {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    return fstatSync(fd).isFile() ? data(readFileSync(fd, 'utf8')) : null;
  } catch (e) { return e.code === 'ENOENT' ? undefined : null; } finally { if (fd !== undefined) closeSync(fd); }
};
const money = (usd) => (typeof usd === 'number' ? usd.toFixed(2) : null);
const prOf = (meta) => (meta?.pr === undefined || meta?.pr === null ? null : Number(String(meta.pr).replace(/^#/, '')));
// A job file names its project by name; a job without one counts for every repository.
const inRepo = (meta, repo) => !meta?.project || [repo, repo.split('/')[1]].some((name) => name.toLowerCase() === String(meta.project).toLowerCase());

// The run folder comes from a command line: one that is a link, or resolves outside .benchkeeper/runs of the working directory, is refused, as approval.mjs refuses a file there.
export function runFolder(path) {
  try {
    const cwd = realpathSync('.'), runs = join(cwd, '.benchkeeper', 'runs');
    const full = resolve(cwd, path), real = realpathSync(full);
    // A link anywhere below the working directory makes the real path differ.
    if (real !== full || (real !== runs && !real.startsWith(runs + sep))) return null;
    return lstatSync(real).isDirectory() ? real : null;
  } catch { return null; }
}

const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// Every job of jobs/<name>.meta.json with its result: { name, meta, result, state, cost, verdict }. state as job.mjs status says it: running, lost, failed or done.
export function jobs(run, alive = pidAlive) {
  let names;
  try { names = readdirSync(join(run, 'jobs')).filter((f) => f.endsWith('.meta.json')).map((f) => f.slice(0, -'.meta.json'.length)); } catch { return []; }
  return names.sort().map((name) => {
    const meta = file(join(run, 'jobs', `${name}.meta.json`)) ?? null, result = file(join(run, 'jobs', `${name}.json`));
    if (!meta || typeof meta !== 'object') return { name, meta: null, result: null, state: UNREAD, cost: UNREAD, verdict: null };
    const state = !meta.endedAt ? (Number.isInteger(meta.pid) && alive(meta.pid) ? 'running' : 'lost') : meta.exit !== 0 || result?.is_error ? 'failed' : 'done';
    const found = REVIEWS.includes(meta.kind) && typeof result?.result === 'string' ? VERDICT.exec(result.result.split(/\r?\n/)[0]) : null;
    const cost = result === null ? UNREAD : money(result?.total_cost_usd);
    return { name, meta, result, state, cost, verdict: found && { line: found[0].trim(), kind: found[1], head: found[2] } };
  });
}

function jobSection(list, now) {
  const recent = list.filter((j) => !j.meta || j.state === 'running' || now - Date.parse(j.meta.endedAt ?? j.meta.startedAt) <= DAY);
  const newest = [...recent].sort((a, b) => (Date.parse(b.meta?.startedAt) || 0) - (Date.parse(a.meta?.startedAt) || 0) || a.name.localeCompare(b.name));
  return table(['Job', 'Kind', 'Model', 'Account', 'State', 'Age', 'PR', 'Head', 'Cost (USD)', 'Verdict'], newest.map(({ name, meta, state, cost, verdict }) => {
    const started = Date.parse(meta?.startedAt);
    return [name, meta?.kind, meta && [meta.model, meta.effort].filter(Boolean).join(' '), meta?.account, state, Number.isNaN(started) ? null : age(now - started),
      prOf(meta), typeof meta?.head === 'string' ? meta.head.slice(0, 7) : null, cost, verdict?.line];
  }));
}

// gh pr checks exits 8 while a check is pending and still prints the checks; with no required check it fails and says so.
function requiredChecks(exec, repo, number) {
  let text;
  try { text = exec('gh', ['pr', 'checks', String(number), '-R', repo, '--required', '--json', 'name,bucket']); } catch (e) {
    if (/no (required )?checks reported/.test(String(e.stderr ?? ''))) return 'none';
    if (e.status !== 8) return UNREAD;
    text = e.stdout;
  }
  const checks = data(text);
  if (!Array.isArray(checks)) return UNREAD;
  return BUCKETS.map((bucket) => [checks.filter((c) => c.bucket === bucket).length, bucket]).filter(([n]) => n).map(([n, bucket]) => `${n} ${bucket}`).join(', ') || 'none';
}

function pullSection(repo, list, exec) {
  const pulls = data(read(exec, 'gh', ['pr', 'list', '-R', repo, '--state', 'open', '--limit', '100', '--json', 'number,title,headRefOid,mergeable']));
  if (!Array.isArray(pulls)) return [`### ${repo}`, '', UNREAD];
  const [owner, name] = repo.split('/');
  const nodes = data(read(exec, 'gh', ['api', 'graphql', '-f', `query=${THREADS}`, '-f', `owner=${owner}`, '-f', `name=${name}`]))?.data?.repository?.pullRequests?.nodes;
  const open = (number) => {
    const threads = Array.isArray(nodes) ? nodes.find((n) => n.number === number)?.reviewThreads?.nodes : null;
    return Array.isArray(threads) ? threads.filter((t) => !t.isResolved).length : Array.isArray(nodes) ? 0 : UNREAD;
  };
  // The reviewer's job result is the verdict's source (a pull request comment can be written by anyone with the login), and only one for the current head counts.
  const verdict = (number, head) => list.filter((j) => j.verdict?.head === head && prOf(j.meta) === number && inRepo(j.meta, repo))
    .sort((a, b) => (Date.parse(b.meta.endedAt) || 0) - (Date.parse(a.meta.endedAt) || 0))[0];
  const rows = [...pulls].sort((a, b) => a.number - b.number).map(({ number, title, headRefOid, mergeable }) => {
    const found = verdict(number, headRefOid);
    return [number, title, String(headRefOid ?? '').slice(0, 7), mergeable, requiredChecks(exec, repo, number), open(number), found && `${found.verdict.kind} (${found.name})`];
  });
  return [`### ${repo}`, '', ...table(['PR', 'Title', 'Head', 'Mergeable', 'Required checks', 'Open threads', 'Verdict'], rows)];
}

// Open approvals with one of the labels, and closed ones answered in the last 24 hours.
function approvalSection(tracker, labels, exec, now) {
  if (!tracker) return ['Not read: no --tracker.'];
  const fields = ['--label', 'question', '--limit', '200', '--json', 'number,labels,comments,author'];
  const open = data(read(exec, 'gh', ['issue', 'list', '-R', tracker, '--state', 'open', ...fields]));
  const closed = data(read(exec, 'gh', ['issue', 'list', '-R', tracker, '--state', 'closed', '--search', `closed:>=${new Date(now - DAY).toISOString().slice(0, 10)}`, ...fields]));
  if (!Array.isArray(open) || !Array.isArray(closed)) return [UNREAD];
  const wanted = labels.map((l) => l.toLowerCase());
  const rows = [...open.map((i) => [i, 'open']), ...closed.map((i) => [i, 'closed'])].flatMap(([issue, state]) => {
    const names = (issue.labels ?? []).map((l) => String(l.name));
    const project = names.filter((n) => wanted.includes(n.toLowerCase()));
    let given;
    try { given = answer(issue); } catch { given = UNREAD; }
    if (!project.length || (state === 'closed' && !(now - Date.parse(given?.at) <= DAY))) return [];
    const others = names.filter((n) => n.toLowerCase() !== 'question' && !project.includes(n));
    return [[issue.number, project.join(', '), state === 'open' ? others.join(', ') || 'open' : 'closed', given === UNREAD ? UNREAD : given?.option, utc(given?.at)]];
  });
  return table(['Issue', 'Project', 'State', 'Answer', 'Answered'], rows.sort((a, b) => a[0] - b[0]));
}

function accountSection(asked, exec) {
  if (!asked) return ['Not read: no --accounts.'];
  const accounts = data(read(exec, 'cswap', ['list', '--json']))?.accounts;
  if (!Array.isArray(accounts)) return [UNREAD];
  const pct = (w) => (typeof w?.pct === 'number' ? `${w.pct}%` : UNREAD);
  const resets = (w) => utc(w?.resetsAt) ?? UNREAD;
  return table(['Account', 'Alias', 'Active', '5-hour', '5-hour resets', '7-day', '7-day resets', 'Fable'], accounts.map((a) => {
    const { fiveHour, sevenDay, scoped } = a?.usage ?? {};
    const fable = Array.isArray(scoped) ? scoped.find((s) => String(s?.name).toLowerCase() === 'fable') : undefined;
    return [a?.number ?? UNREAD, a?.alias, typeof a?.active === 'boolean' ? (a.active ? 'yes' : 'no') : UNREAD, pct(fiveHour), resets(fiveHour), pct(sevenDay), resets(sevenDay), pct(fable)];
  }));
}

// The newest commit with a push run on the default branch: failed when a run of it failed, pending while one runs, else success.
function mainRow(repo, exec) {
  const branch = data(read(exec, 'gh', ['repo', 'view', repo, '--json', 'defaultBranchRef']))?.defaultBranchRef?.name;
  const runs = branch ? data(read(exec, 'gh', ['run', 'list', '-R', repo, '--branch', branch, '--event', 'push', '--limit', '20', '--json', 'headSha,status,conclusion,createdAt'])) : null;
  if (!Array.isArray(runs)) return [repo, UNREAD, UNREAD, UNREAD];
  if (!runs.length) return [repo, 'no run', null, null];
  const newest = [...runs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  const own = runs.filter((r) => r.headSha === newest.headSha);
  const bad = own.find((r) => r.status === 'completed' && !['success', 'skipped', 'neutral'].includes(r.conclusion));
  return [repo, String(newest.headSha).slice(0, 7), bad ? bad.conclusion : own.some((r) => r.status !== 'completed') ? 'pending' : 'success', utc(newest.createdAt)];
}

// The text of facts.md. exec(cmd, args) gives a command's stdout or throws; now is the time in milliseconds.
export function facts({ run, repos, tracker = null, labels = [], accounts = false, now, exec, alive = pidAlive }) {
  const list = jobs(run, alive);
  return [
    '# Facts',
    '',
    `Generated by facts.mjs at ${new Date(now).toISOString().slice(0, 19)}Z. Do not edit; rerun the script.`,
    '', '## Jobs', '', ...jobSection(list, now),
    '', '## Pull requests', '', ...repos.flatMap((repo, i) => [...(i ? [''] : []), ...pullSection(repo, list, exec)]),
    '', '## Approvals', '', ...approvalSection(tracker, labels, exec, now),
    '', '## Accounts', '', ...accountSection(accounts, exec),
    '', '## Main', '', ...table(['Repository', 'Commit', 'Conclusion', 'Time'], repos.map((repo) => mainRow(repo, exec))),
    '',
  ].join('\n');
}

const median = (values) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b), mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const cents = (usd) => Math.round(usd * 100) / 100;

// { prs: [{ repo, number, merged, jobs, cost, rounds }], total, median } for the pull requests merged from since to until, both days included. Throws when gh cannot list them.
export function costs({ run, repos, since, until, exec }) {
  const list = jobs(run, () => false);
  const prs = repos.flatMap((repo) => {
    const merged = data(read(exec, 'gh', ['pr', 'list', '-R', repo, '--state', 'merged', '--search', `merged:${since}..${until}`, '--limit', '1000', '--json', 'number,mergedAt']));
    if (!Array.isArray(merged)) throw new Error(`unread: gh could not list the merged pull requests of ${repo}`);
    return merged.map(({ number, mergedAt }) => {
      const own = list.filter((j) => prOf(j.meta) === number && inRepo(j.meta, repo));
      const cost = own.reduce((sum, j) => sum + (typeof j.result?.total_cost_usd === 'number' ? j.result.total_cost_usd : 0), 0);
      return { repo, number, merged: utc(mergedAt), jobs: own.length, cost: cents(cost), rounds: own.filter((j) => j.verdict?.kind === 'changes').length };
    });
  }).sort((a, b) => String(a.merged).localeCompare(String(b.merged)) || a.repo.localeCompare(b.repo) || a.number - b.number);
  const costMedian = median(prs.map((p) => p.cost)), roundMedian = median(prs.map((p) => p.rounds));
  return {
    prs,
    total: { prs: prs.length, cost: cents(prs.reduce((sum, p) => sum + p.cost, 0)), rounds: prs.reduce((sum, p) => sum + p.rounds, 0) },
    median: { cost: costMedian === null ? null : cents(costMedian), rounds: roundMedian },
  };
}

export function costTable({ prs, total, median: mid }) {
  return [
    ...table(['PR', 'Merged', 'Jobs', 'Cost (USD)', 'Fix rounds'], prs.map((p) => [`${p.repo}#${p.number}`, p.merged, p.jobs, money(p.cost), p.rounds])),
    '',
    `Totals: ${total.prs} pull requests, cost ${money(total.cost)} USD, fix rounds ${total.rounds}.`,
    `Medians per pull request: cost ${mid.cost === null ? '-' : `${money(mid.cost)} USD`}, fix rounds ${mid.rounds ?? '-'}.`,
    '',
  ].join('\n');
}

const REPO = /^[A-Za-z0-9][A-Za-z0-9-]*\/(?!\.\.?$)[A-Za-z0-9._-]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const USAGE = 'usage: node facts.mjs write --run <run folder> --repo <owner/name> [--repo ...] [--tracker <owner/name> --labels <label,...>] [--accounts], or node facts.mjs costs --run <run folder> --repo <owner/name> [--repo ...] --since <YYYY-MM-DD> --until <YYYY-MM-DD> [--json]';

function main(argv) {
  const [mode, ...rest] = argv;
  const { values: v } = parseArgs({
    args: rest,
    options: { run: { type: 'string' }, repo: { type: 'string', multiple: true }, tracker: { type: 'string' }, labels: { type: 'string' }, accounts: { type: 'boolean' }, since: { type: 'string' }, until: { type: 'string' }, json: { type: 'boolean' } },
  });
  const repos = v.repo ?? [];
  const writing = mode === 'write' && !v.since && !v.until && !v.json && Boolean(v.tracker) === Boolean(v.labels);
  const costing = mode === 'costs' && !v.tracker && !v.labels && !v.accounts && DATE.test(v.since ?? '') && DATE.test(v.until ?? '') && v.since <= v.until;
  if (!(writing || costing) || !v.run || !repos.length || ![...repos, ...(v.tracker ? [v.tracker] : [])].every((r) => REPO.test(r))) throw new Error(USAGE);
  const labels = v.labels ? v.labels.split(',').map((l) => l.trim()).filter(Boolean) : [];
  if (v.tracker && !labels.length) throw new Error(USAGE);
  const run = runFolder(v.run);
  if (!run) throw new Error(`refused: ${v.run} is no folder in .benchkeeper/runs/ of the working directory, or it is a link`);
  const exec = (cmd, args) => sh(process.cwd(), cmd, args);
  if (mode === 'costs') {
    const found = costs({ run, repos, since: v.since, until: v.until, exec });
    process.stdout.write(v.json ? `${json(found)}\n` : costTable(found));
    return;
  }
  const text = facts({ run, repos, tracker: v.tracker ?? null, labels, accounts: Boolean(v.accounts), now: Date.now(), exec });
  // A reader never sees half a file: the text goes to a file of its own, then replaces facts.md in one rename.
  const temp = join(run, `.facts.md.${process.pid}.tmp`);
  writeFileSync(temp, text, { flag: 'wx' });
  renameSync(temp, join(run, 'facts.md'));
  console.log(join(run, 'facts.md'));
}

if (isMain(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) {
    console.error(escaped(e.message.split('\n')[0]));
    process.exitCode = 2;
  }
}
