// Sample precheck for a scheduled coordinator run: exit 0 when a project has an issue to pick, else 1. Read only.
// Usage: node precheck.mjs <project paths...>
// Pickable: open, carries the policy's startLabel and every issues.labels entry, written by a trusted author, and no open or merged pull request has a head
// branch <type>/<number>-<slug> (a merged one means the work is delivered; an issue that needs more is started by hand). The policy comes from the reader (policy.mjs).
// With issues.repository the issues are that tracker's, whose numbers can equal those of the project's own old branches: a pull request then counts only when its body also holds <owner/repo>#<number>.
import { isMain, read, sh } from './policy.mjs';

const TRUSTED = ['OWNER', 'MEMBER', 'COLLABORATOR'];

// True when the body holds ref as its own token: owner/repo#12 is not found in co-owner/repo#12 or in owner/repo#123. GitHub ignores case in owner/repo.
const refers = (body, ref) => {
  const literal = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w/.-])${literal}(?!\\d)`, 'i').test(body ?? '');
};

export function pickable(policy, issues, pulls) {
  if (!policy?.startLabel) return [];
  const trusted = new Set(policy.trustedAuthors ?? []);
  const labels = [policy.startLabel, ...(policy.issues?.labels ?? [])];
  const tracker = policy.issues?.repository;
  return issues
    .filter((i) => !i.pull_request && (TRUSTED.includes(i.author_association) || trusted.has(i.user?.login)))
    .filter((i) => labels.every((label) => i.labels.some((l) => l.name === label)))
    .filter((i) => !pulls.some((p) => p.headRefName.includes(`/${i.number}-`) && (!tracker || refers(p.body, `${tracker}#${i.number}`))))
    .map((i) => i.number);
}

export function check(dir, run = sh) {
  const { policy } = read(dir, run);
  if (!policy?.startLabel) return [];
  const tracker = policy.issues.repository;
  const labels = [policy.startLabel, ...policy.issues.labels].map(encodeURIComponent).join(',');
  const issues = JSON.parse(run(dir, 'gh', ['api', '--paginate', '--slurp', `repos/${tracker ?? '{owner}/{repo}'}/issues?state=open&per_page=100&labels=${labels}`])).flat();
  const pulls = JSON.parse(run(dir, 'gh', ['pr', 'list', '--state', 'all', '--limit', '1000', '--json', `headRefName,state${tracker ? ',body' : ''}`])).filter((p) => p.state !== 'CLOSED');
  return pickable(policy, issues, pulls);
}

if (isMain(import.meta.url)) {
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
