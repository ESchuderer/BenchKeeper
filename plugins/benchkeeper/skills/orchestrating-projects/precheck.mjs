// Usage: node precheck.mjs <project paths...>. Sample precheck for a scheduled coordinator run: exit 0 when a project has an issue to pick, else 1. It starts and merges nothing.
// Pickable: open, carries startLabel and every issues.labels entry, written by a trusted author, and no pull request for it: none merged or open in the repository with a head branch <type>/<number>-<slug> (an open one from a fork does not count, since anyone can open it).
// A tracker's numbers (issues.repository) can equal those of the project's own old branches: a pull request then counts only when its body also holds <owner/repo>#<number> or the issue's URL.
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
    .filter((i) => !pulls.some((p) => p.headRefName.includes(`/${i.number}-`) && (!tracker || refers(p.body, tracker, i.number))))
    .map((i) => i.number);
}

export function check(dir, run = sh) {
  const { policy, errors } = read(dir, run);
  // Thrown, so the command line names the project and why nothing starts there, as it does for a failed command.
  if (!policy) throw new Error(errors.map(errorLine).join('; '));
  if (!policy.startLabel) return [];
  const tracker = policy.issues.repository;
  const labels = [policy.startLabel, ...policy.issues.labels].map(encodeURIComponent).join(',');
  const issues = JSON.parse(run(dir, 'gh', ['api', '--paginate', '--slurp', `repos/${tracker ?? '{owner}/{repo}'}/issues?state=open&per_page=100&labels=${labels}`])).flat();
  const pulls = JSON.parse(run(dir, 'gh', ['pr', 'list', '--state', 'all', '--limit', '1000', '--json', `headRefName,state,isCrossRepository${tracker ? ',body' : ''}`]))
    .filter((p) => p.state === 'MERGED' || (p.state !== 'CLOSED' && !p.isCrossRepository));
  return pickable(policy, issues, pulls);
}

if (isMain(import.meta.url)) {
  if (process.argv.length < 3) console.error('usage: node precheck.mjs <project paths...>');
  let found = false;
  for (const dir of process.argv.slice(2)) {
    try {
      const numbers = check(dir);
      if (numbers.length) { found = true; console.log(`${dir}: ${numbers.map((n) => `#${n}`).join(' ')}`); }
    } catch (e) {
      console.error(`${dir}: ${e.message.split('\n')[0]}`);
    }
  }
  process.exit(found ? 0 : 1);
}
