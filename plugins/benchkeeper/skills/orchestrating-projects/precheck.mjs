// Sample precheck for a scheduled coordinator run: exit 0 when a project has an issue to pick, else 1. Read only.
// Usage: node precheck.mjs <project paths...>
// Pickable: open, carries the policy's startLabel, written by a trusted author, and no open or merged pull request has a head
// branch <type>/<number>-<slug> (a merged one means the work is delivered; an issue that needs more is started by hand). The policy is read from origin's default branch, never from a checked-out branch.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TRUSTED = ['OWNER', 'MEMBER', 'COLLABORATOR'];

const sh = (cwd, cmd, args) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export function pickable(policy, issues, heads) {
  if (!policy?.startLabel) return [];
  const trusted = new Set(policy.trustedAuthors ?? []);
  return issues
    .filter((i) => !i.pull_request && (TRUSTED.includes(i.author_association) || trusted.has(i.user?.login)))
    .filter((i) => i.labels.some((l) => l.name === policy.startLabel))
    .filter((i) => !heads.some((h) => h.includes(`/${i.number}-`)))
    .map((i) => i.number);
}

export function check(dir, run = sh) {
  const head = run(dir, 'git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).trim();
  run(dir, 'git', ['fetch', '--quiet', 'origin', head.replace(/^origin\//, '')]);
  let policy;
  try { policy = JSON.parse(run(dir, 'git', ['show', `${head}:docs/agents/orchestration.json`])); } catch { return []; }
  if (!policy.startLabel) return [];
  const issues = JSON.parse(run(dir, 'gh', ['api', '--paginate', '--slurp', `repos/{owner}/{repo}/issues?state=open&per_page=100&labels=${encodeURIComponent(policy.startLabel)}`])).flat();
  const heads = JSON.parse(run(dir, 'gh', ['pr', 'list', '--state', 'all', '--limit', '1000', '--json', 'headRefName,state'])).filter((p) => p.state !== 'CLOSED').map((p) => p.headRefName);
  return pickable(policy, issues, heads);
}

// True when this file is the script Node was started with. Node resolves symlinks for import.meta.url but keeps
// process.argv[1] as typed, so both are compared as real paths: started through a symlinked folder, the command line still runs.
const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (isMain()) {
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
