// Usage: node precheck.mjs <project paths...>. Sample precheck for a scheduled coordinator run: exit 0 when a project has an issue to pick, else 1. It starts and merges nothing.
// Pickable: open, carries startLabel and every issues.labels entry, not labeled question (an owner question), written by a trusted author, and no pull request for it: none merged or open in the repository with a head branch <type>/<number>-<slug> (an open one from a fork does not count, since anyone can open it).
// A tracker's numbers (issues.repository) can equal those of the project's own old branches: a pull request then counts only when its body also holds <owner/repo>#<number> or the issue's URL.
// An issue that several of the given projects list starts in none of them: it is printed once on stderr, as "several projects: <tracker>#<number> (<paths>)".
import { errorLine, isMain, read, sh } from './policy.mjs';

const TRUSTED = ['OWNER', 'MEMBER', 'COLLABORATOR'];

// True when the body names the tracker's issue as its own token, as owner/repo#12 or by its URL: not co-owner/repo#12, other/owner/repo#12 or issue 123. GitHub ignores case in owner/repo.
const refers = (body, tracker, number) => {
  const repo = tracker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:(?<![\\w/.-])${repo}#|https?://(?:www\\.)?github\\.com/${repo}/issues/)${number}(?!\\d)`, 'i').test(body ?? '');
};

export function pickable(policy, issues, pulls) {
  if (!policy?.startLabel) return [];
  const trusted = new Set(policy.trustedAuthors ?? []);
  const labels = [policy.startLabel, ...(policy.issues?.labels ?? [])];
  const tracker = policy.issues?.repository;
  return issues
    .filter((i) => !i.pull_request && (TRUSTED.includes(i.author_association) || trusted.has(i.user?.login)))
    .filter((i) => labels.every((label) => i.labels.some((l) => l.name.toLowerCase() === label.toLowerCase())))
    // The approvals the coordinator files carry this label: such an issue asks the owner, also after it gained the start label.
    .filter((i) => !i.labels.some((l) => l.name.toLowerCase() === 'question'))
    .filter((i) => !pulls.some((p) => p.headRefName.includes(`/${i.number}-`) && (!tracker || refers(p.body, tracker, i.number))))
    .map((i) => i.number);
}

// The host an origin URL names: the authority of a URL with a scheme, or the name with a dot before the colon of user@host:path. An ssh alias (work:owner/repo) and a local path name none.
const hostOf = (url) => (/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:]*)/i.exec(url)?.[1] ?? /^(?:[^@/:]*@)?([^/:]*\.[^/:]*):/.exec(url)?.[1] ?? '').toLowerCase();

// gh resolves a bare `gh pr list` and {owner}/{repo} through an upstream remote or a set default; the policy came from origin, so origin's repository is named.
// gh asks github.com, or the host GH_HOST names: for an origin on another host it would list the repository of the same path there.
export const originRepo = (dir, run, env = process.env) => {
  const url = run(dir, 'git', ['remote', 'get-url', 'origin']).trim();
  const repo = /[:/]([A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(url)?.[1];
  if (!repo || /\/\.\.?$/.test(repo)) throw new Error("origin's URL names no repository as owner/repo");
  const host = hostOf(url), gh = (env.GH_HOST || 'github.com').toLowerCase();
  // ssh.github.com is github.com's ssh endpoint on port 443.
  if (host && host !== gh && !(gh === 'github.com' && host === 'ssh.github.com')) throw new Error(`origin's URL names the host ${host.replace(/[^a-z0-9.-]/g, '?')}, and gh asks ${gh}: set GH_HOST for an origin on another host`);
  return repo;
};

// { tracker, numbers }: the repository that holds the project's issues and the pickable ones; no tracker is read without a startLabel.
function picks(dir, run, env) {
  const { policy, errors } = read(dir, run);
  // Thrown, so the command line names the project and why nothing starts there, as it does for a failed command.
  if (!policy) throw new Error(errors.map(errorLine).join('; '));
  if (!policy.startLabel) return { tracker: null, numbers: [] };
  const repo = originRepo(dir, run, env);
  const tracker = policy.issues.repository ?? repo;
  const labels = [policy.startLabel, ...policy.issues.labels].map(encodeURIComponent).join(',');
  const issues = JSON.parse(run(dir, 'gh', ['api', '--paginate', '--slurp', `repos/${tracker}/issues?state=open&per_page=100&labels=${labels}`])).flat();
  const pulls = JSON.parse(run(dir, 'gh', ['pr', 'list', '-R', repo, '--state', 'all', '--limit', '1000', '--json', `headRefName,state,isCrossRepository${policy.issues.repository ? ',body' : ''}`]))
    .filter((p) => p.state === 'MERGED' || (p.state !== 'CLOSED' && !p.isCrossRepository));
  return { tracker, numbers: pickable(policy, issues, pulls) };
}

export const check = (dir, run = sh, env = process.env) => picks(dir, run, env).numbers;

// A label per project does not make the labels distinct: an issue listed for two projects would get a worker in each. lists: [{ dir, tracker, numbers }]; shared: [{ tracker, number, dirs }].
export function distinct(lists) {
  const key = (tracker, number) => `${tracker.toLowerCase()}#${number}`;
  const seen = new Map();
  for (const { dir, tracker, numbers } of lists) for (const number of numbers) {
    const had = seen.get(key(tracker, number));
    seen.set(key(tracker, number), { tracker: had?.tracker ?? tracker, number, dirs: [...(had?.dirs ?? []), dir] });
  }
  const shared = [...seen.values()].filter(({ dirs }) => dirs.length > 1);
  const gone = new Set(shared.map(({ tracker, number }) => key(tracker, number)));
  return { lists: lists.map((list) => ({ ...list, numbers: list.numbers.filter((number) => !gone.has(key(list.tracker, number))) })), shared };
}

// One worker's batch: the oldest issuesPerWorker issues, which are the lowest numbers.
export const batch = (numbers, issuesPerWorker) => [...numbers].sort((a, b) => a - b).slice(0, issuesPerWorker);

// How many workers may start now in a project with inProject workers, on a machine with onHost.
export const slots = (policy, inProject, onHost) => Math.max(0, Math.min(policy.workersPerProject - inProject, policy.hostWorkerLimit - onHost));

if (isMain(import.meta.url)) {
  if (process.argv.length < 3) console.error('usage: node precheck.mjs <project paths...>');
  const found = [];
  for (const dir of process.argv.slice(2)) {
    try {
      found.push({ dir, ...picks(dir, sh, process.env) });
    } catch (e) {
      console.error(`${dir}: ${e.message.split('\n')[0]}`);
    }
  }
  const { lists, shared } = distinct(found);
  for (const { tracker, number, dirs } of shared) console.error(`several projects: ${tracker}#${number} (${dirs.join(', ')})`);
  for (const { dir, numbers } of lists) if (numbers.length) console.log(`${dir}: ${batch(numbers, numbers.length).map((n) => `#${n}`).join(' ')}`);
  process.exit(lists.some(({ numbers }) => numbers.length) ? 0 : 1);
}
