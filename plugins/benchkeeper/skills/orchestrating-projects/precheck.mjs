// Usage: node precheck.mjs <project paths...>. Sample precheck for a scheduled coordinator run: exit 0 when a project has an issue to pick, else 1. It starts and merges nothing.
// Pickable: open, carries startLabel and every issues.labels entry, not labeled question (an owner question), written by a trusted author, and no pull request for it: none merged or open in the repository with a head branch <type>/<number>-<slug> (an open one from a fork does not count, since anyone can open it).
// A tracker's numbers (issues.repository) can equal those of the project's own old branches: a pull request then counts only when its body also holds <owner/repo>#<number> or the issue's URL.
// An issue that several of the given projects list starts in none of them: it is printed once on stderr, as "several projects: <tracker>#<number> (<paths>)".
import { errorLine, escaped, isMain, read, sh } from './policy.mjs';

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

const LOCAL = 'origin is a local path or a file: URL: gh would list the repository of the same path on its own host';
// { host, scp } of an origin URL: the host of a URL with a scheme, or the name before the colon of [user@]host:path. Only a URL that every reader splits the same way gives a host: user text that holds @ / ? # \ or a space, where git, curl and a browser disagree, gives none, and neither does a local path. No error holds the URL, which can carry a credential.
function hostOf(url) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    const host = /^(?!file:)[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#\\\s]*@)?([a-z0-9._-]+)(?::\d*)?(?:[/?#]|$)/i.exec(url)?.[1];
    if (!host) throw new Error(/^file:/i.test(url) ? LOCAL : "origin's URL names no host that can be compared with the one gh asks");
    return { host: host.toLowerCase(), scp: false };
  }
  // A drive letter is a local path on Windows.
  const host = /^[a-z]:[\\/]/i.test(url) ? null : /^(?:[^@/:\\\s]+@)?([a-z0-9._-]+):/i.exec(url)?.[1];
  if (!host) throw new Error(LOCAL);
  return { host: host.toLowerCase(), scp: true };
}

// gh resolves a bare `gh pr list` and {owner}/{repo} through an upstream remote or a set default; the policy came from origin, so origin's repository is named.
// gh asks github.com, or the host GH_HOST names: for an origin on another host it would list the repository of the same path there.
export const originRepo = (dir, run, env = process.env) => {
  const url = run(dir, 'git', ['remote', 'get-url', 'origin']).trim();
  const repo = /[:/]([A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(url)?.[1];
  if (!repo || /\/\.\.?$/.test(repo)) throw new Error("origin's URL names no repository as owner/repo");
  const { host, scp } = hostOf(url), gh = (env.GH_HOST || 'github.com').toLowerCase();
  // An alias of ~/.ssh/config names no host: a name without a dot, or gh's host, a hyphen and a suffix without one (github.com-work).
  const alias = scp && !(host.startsWith(`${gh}-`) ? host.slice(gh.length) : host).includes('.');
  // ssh.github.com is github.com's ssh endpoint on port 443.
  if (!alias && host !== gh && !(gh === 'github.com' && host === 'ssh.github.com')) throw new Error(`origin's URL names the host ${host}, and gh asks ${gh}: set GH_HOST for an origin on another host`);
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

// What the command line prints and its exit code: { out, err, code }. pick(dir) gives a project's { tracker, numbers } or throws why nothing starts there.
export function report(dirs, pick) {
  const found = [], err = [];
  for (const dir of dirs) {
    try { found.push({ dir, ...pick(dir) }); } catch (e) { err.push(`${dir}: ${e.message.split('\n')[0]}`); }
  }
  const { lists, shared } = distinct(found);
  for (const { tracker, number, dirs: listing } of shared) err.push(`several projects: ${tracker}#${number} (${listing.join(', ')})`);
  // Oldest first, which is the lowest number.
  const out = lists.filter(({ numbers }) => numbers.length).map(({ dir, numbers }) => `${dir}: ${[...numbers].sort((a, b) => a - b).map((n) => `#${n}`).join(' ')}`);
  return { out: out.map((line) => escaped(line)), err: err.map((line) => escaped(line)), code: out.length ? 0 : 1 };
}

if (isMain(import.meta.url)) {
  if (process.argv.length < 3) console.error('usage: node precheck.mjs <project paths...>');
  const { out, err, code } = report(process.argv.slice(2), (dir) => picks(dir, sh, process.env));
  for (const line of err) console.error(line);
  for (const line of out) console.log(line);
  process.exit(code);
}
