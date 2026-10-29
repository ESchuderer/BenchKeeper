// The built-in checks behind `automations precheck <id>`: whether a scheduled session of issue-pickup or pr-watcher has work.
// They read GitHub through gh, the runner's open workers and the checkout's worktrees; they start, claim, merge and write
// nothing. The policy is read from the default branch on GitHub, never from a checked-out branch, so a worker cannot widen it.
import { freemem } from 'node:os';
import { hashText } from './fsx.mjs';
import { repoEnv } from './git.mjs';
import * as orca from './orca/index.mjs';
import { load } from './params.mjs';

const POLICY = 'docs/agents/orchestration.json';
const TRUSTED = ['OWNER', 'MEMBER', 'COLLABORATOR'];
// An automated reviewer appends its summary below the author's footer, starting with this comment: what follows is not the author's.
const APPENDED = /^<!-- This is an auto-generated comment/m;
const REFS = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?)\s+#(\d+)\b/gi;
const CLOSES = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi;
const numbers = (body, re) => [...String(body ?? '').split(APPENDED)[0].matchAll(re)].map((m) => Number(m[1]));
// GraphQL names a bot without the [bot] suffix that REST and the policy use.
const who = (login) => String(login ?? '').replace(/\[bot\]$/, '');
const PASS = ['SUCCESS', 'NEUTRAL', 'SKIPPED'];
const WAIT = ['PENDING', 'EXPECTED', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED'];
const result = (c) => {
  const v = c.__typename === 'CheckRun' && c.status !== 'COMPLETED' ? 'PENDING' : c.conclusion ?? c.state;
  return PASS.includes(v) ? 'pass' : WAIT.includes(v) ? 'pending' : 'fail';
};

// Parameters per check with their defaults (the template's) and the form a value must have.
export const CHECKS = {
  'issue-pickup': { blocked_label: ['blocked', /^[\w.:-]+$/], min_free_mb: ['2048', /^\d+$/] },
  'pr-watcher': { hold_label: ['hold', /^[\w.:-]+$/], pr: ['', /^\d*$/], head: ['', /^([0-9a-f]{40})?$/] },
};

function gh(ctx, dir, args) {
  const r = ctx.run(['gh', ...args], { cwd: dir, timeout: 30e3 });
  if (r.code !== 0) throw new Error(`gh ${args.slice(0, 2).join(' ')} failed: ${String(r.stderr).trim().split('\n')[0]}`);
  return r.stdout;
}

// The repository of the checkout, its policy and the runner's workers, each with the branch of its worktree in this checkout
// (none: a worker of another project).
async function project(ctx, dir) {
  const repo = JSON.parse(gh(ctx, dir, ['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef']));
  const slug = repo.nameWithOwner, branch = repo.defaultBranchRef?.name;
  let text;
  try { text = gh(ctx, dir, ['api', '-H', 'Accept: application/vnd.github.raw', `repos/${slug}/contents/${POLICY}?ref=${encodeURIComponent(branch)}`]); } catch (e) {
    throw new Error(`cannot read ${POLICY} from ${branch} of ${slug}, and without it nothing may start or merge (${e.message})`);
  }
  const { doc: policy, errors } = load('policy', text);
  if (errors.length) throw new Error(`${POLICY} on ${branch}: ${errors[0].path || 'the file'} ${errors[0].message}`);
  const all = await orca.workers(ctx);
  if (!all) throw new Error(`${orca.NAME} did not list the open workers of every run, so the worker limits cannot be checked`);
  const trees = ctx.run(['git', '-C', dir, 'worktree', 'list', '--porcelain'], { env: repoEnv(), timeout: 15e3 });
  if (trees.code !== 0) throw new Error(`${dir} is not a git checkout: ${trees.stderr.trim()}`);
  const branches = new Map();
  let path;
  for (const l of trees.stdout.split('\n')) {
    if (l.startsWith('worktree ')) path = l.slice(9);
    if (l.startsWith('branch refs/heads/')) branches.set(path, l.slice(18));
  }
  const workers = all.map((w) => ({ ...w, branch: branches.get(w.path) ?? null }));
  return { slug, policy, workers, branches: [...branches.values()] };
}

// Issues to start, oldest first, up to the free worker slots, and the settled workers of this project the session releases.
async function issuePickup(ctx, dir, v) {
  const { slug, policy, workers, branches } = await project(ctx, dir);
  if (!policy.startLabel) throw new Error(`${POLICY} names no startLabel, so no issue may start`);
  const work = workers.filter((w) => w.branch && !w.working).map((w) => `settled ${w.branch} ${w.path}`);
  const perProject = policy.workersPerProject ?? 1, perHost = policy.hostWorkerLimit ?? 2;
  const here = workers.filter((w) => w.branch && w.working).length, host = workers.filter((w) => w.working).length;
  const free = Math.floor(freemem() / 2 ** 20);
  const limits = [
    here >= perProject && `skip limit workersPerProject ${perProject} reached`,
    host >= perHost && `skip limit hostWorkerLimit ${perHost} reached`,
    free < Number(v.min_free_mb) && `skip limit free memory ${free} MB below ${v.min_free_mb} MB`,
  ].filter(Boolean);
  if (limits.length) return { work, skipped: limits };
  const trusted = new Set((policy.trustedAuthors ?? []).map(who));
  const issues = JSON.parse(gh(ctx, dir, ['api', '--paginate', '--slurp', `repos/${slug}/issues?state=open&labels=${encodeURIComponent(policy.startLabel)}&sort=created&direction=asc&per_page=100`])).flat();
  const prs = JSON.parse(gh(ctx, dir, ['pr', 'list', '--repo', slug, '--state', 'open', '--limit', '1000', '--json', 'number,headRefName,body']));
  const skipped = [], picks = [];
  for (const i of issues.filter((x) => !x.pull_request)) {
    const pr = prs.find((p) => p.headRefName.includes(`/${i.number}-`) || numbers(p.body, REFS).includes(i.number));
    const why = !TRUSTED.includes(i.author_association) && !trusted.has(who(i.user?.login)) ? `author ${i.user?.login} is not trusted`
      : i.labels.some((l) => l.name === v.blocked_label) ? `label ${v.blocked_label}`
        : (i.issue_dependencies_summary?.blocked_by ?? 0) > 0 ? 'an open dependency'
          : pr ? `pull request #${pr.number} is open`
            : branches.some((b) => b.includes(`/${i.number}-`)) ? 'a worktree of its branch exists' : null;
    if (why) skipped.push(`skip #${i.number} ${why}`);
    else picks.push(`pick #${i.number}`);
  }
  const slots = Math.min(perProject - here, perHost - host);
  return { work: [...work, ...picks.slice(0, slots)], skipped: [...skipped, ...picks.slice(slots).map((p) => `${p} waits for a free worker`)] };
}

const QUERY = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { pullRequests(states: OPEN, first: 100) { nodes {
  number isDraft isCrossRepository headRefName headRefOid body mergeable reviewDecision author { login } labels(first: 50) { totalCount nodes { name } }
  commits(first: 100) { totalCount nodes { commit { author { user { login } } } } }
  reviewThreads(first: 100) { totalCount nodes { id isResolved } }
  comments(last: 50) { totalCount nodes { author { login } body } }
  head: commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { totalCount nodes {
    __typename ... on CheckRun { name status conclusion } ... on StatusContext { context state } } } } } } }
} } } }`;

// Per open pull request of this account: merge it, start a fix worker for its failing checks or its unresolved review threads, or skip it.
// With pr and head: only whether that pull request is merge-ready at that head commit.
async function prWatcher(ctx, dir, v) {
  const { slug, policy, workers } = await project(ctx, dir);
  const me = who(gh(ctx, dir, ['api', 'user', '--jq', '.login']).trim());
  const [owner, name] = slug.split('/');
  const nodes = JSON.parse(gh(ctx, dir, ['api', 'graphql', '-f', `query=${QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`])).data.repository.pullRequests.nodes;
  const decide = (p) => {
    const author = who(p.author?.login), labels = p.labels.nodes.map((l) => l.name);
    const contexts = p.head.nodes[0]?.commit.statusCheckRollup?.contexts;
    const checks = (contexts?.nodes ?? []).map((c) => ({ name: c.name ?? c.context, result: result(c) }));
    const threads = p.reviewThreads.nodes.filter((t) => !t.isResolved).map((t) => t.id).sort();
    // A fix worker the session started leaves a comment with this line, so a head or a set of threads gets one worker.
    const started = (kind, key) => p.comments.nodes.some((c) => who(c.author?.login) === me && c.body.split('\n').includes(`pr-watcher fix ${kind} ${key}`));
    // One page per connection: what it did not read could hold a foreign commit, the hold label, a thread, a failing check or the marker.
    const cut = [[p.commits, 'commits'], [p.labels, 'labels'], [p.reviewThreads, 'review threads'], [contexts, 'check contexts'], [p.comments, 'comments']]
      .find(([c]) => c?.totalCount > c.nodes.length);
    if (cut) return { skip: `more than ${cut[0].nodes.length} ${cut[1]}, not read` };
    if (p.headRefName.startsWith('release-please--') || labels.includes('autorelease: pending')) return { skip: 'release pull request' };
    if (p.isCrossRepository) return { skip: 'from a fork' };
    if (author !== me) return { skip: `external, by ${author}` };
    // The git author: a co-author trailer, such as an agent's attribution, does not make a commit someone else's.
    if (p.commits.nodes.some((c) => who(c.commit.author?.user?.login) !== author)) return { skip: 'holds a commit by someone else' };
    if (labels.includes(v.hold_label)) return { skip: `label ${v.hold_label}` };
    if (workers.some((w) => w.working && w.branch === p.headRefName)) return { skip: 'a worker is on it' };
    if (v.head && p.headRefOid !== v.head) return { skip: `head is ${p.headRefOid}, not ${v.head}` };
    if (checks.some((c) => c.result === 'fail')) {
      return started('checks', p.headRefOid) ? { skip: 'a fix worker was started for this head' } : { fix: `fix-checks #${p.number} ${p.headRefOid}` };
    }
    if (threads.length) {
      const key = hashText(threads.join(' ')).slice(0, 12);
      return started('threads', key) ? { skip: 'a fix worker was started for these threads' } : { fix: `fix-threads #${p.number} ${key}` };
    }
    const missing = (policy.merge?.requiredChecks ?? []).filter((n) => !checks.some((c) => c.name === n && c.result === 'pass'));
    if (checks.some((c) => c.result === 'pending')) return { skip: 'checks pending' };
    if (!policy.merge?.allowed) return { skip: 'the policy allows no merge' };
    if (p.isDraft) return { skip: 'draft' };
    if (p.mergeable !== 'MERGEABLE') return { skip: `mergeable is ${p.mergeable}` };
    if (p.reviewDecision === 'CHANGES_REQUESTED') return { skip: 'changes requested' };
    if (missing.length) return { skip: `required checks not green: ${missing.join(', ')}` };
    return { merge: `merge #${p.number} ${p.headRefOid}${numbers(p.body, CLOSES).map((n) => ` closes #${n}`).join('')}` };
  };
  const work = [], skipped = [];
  for (const p of nodes.filter((x) => !v.pr || x.number === Number(v.pr))) {
    const d = decide(p), line = d.merge ?? (v.head ? null : d.fix);
    if (line) work.push(line);
    else skipped.push(`skip #${p.number} ${d.skip ?? `not merge-ready, due: ${d.fix}`}`);
  }
  if (v.pr && !nodes.some((x) => x.number === Number(v.pr))) skipped.push(`skip #${v.pr} is not an open pull request`);
  return { work, skipped };
}

// values: the given parameters; the others take their defaults. Returns { work, skipped }: lines, work empty when there is
// none. Throws with { usage: true } on an unknown id or parameter, else on a missing policy, runner or a failing read.
export async function precheck(ctx, id, values = {}, dir = '.') {
  const spec = CHECKS[id];
  const usage = (message) => Object.assign(new Error(message), { usage: true });
  if (!spec) throw usage(`no built-in precheck for ${id}; the template's own precheck applies (built in: ${Object.keys(CHECKS).join(', ')})`);
  const v = {};
  for (const [k, [fallback, form]] of Object.entries(spec)) {
    v[k] = values[k] ?? fallback;
    if (!form.test(v[k])) throw usage(`--param ${k}=${v[k]} does not have the form ${form.source}`);
  }
  const unknown = Object.keys(values).find((k) => !spec[k]);
  if (unknown) throw usage(`${id} has no parameter ${unknown} (${Object.keys(spec).join(', ')})`);
  return id === 'issue-pickup' ? issuePickup(ctx, dir, v) : prWatcher(ctx, dir, v);
}
