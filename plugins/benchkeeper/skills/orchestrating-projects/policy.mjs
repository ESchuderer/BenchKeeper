// Reader of a project's coordinator policy: prints the effective policy (the file with every default filled in) as JSON, exit 0.
// Usage: node policy.mjs <project path>
// Without a policy it prints each error on stderr and exits 1, and nothing may start in that project: the schema rejects the file (a key or a
// schemaVersion it does not name included), or minPlugin is newer than this plugin. The file is read from origin's default branch, never from a checked-out branch.
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FILE = 'docs/agents/orchestration.json';
// Pull requests on these paths are left for the owner: a policy adds to the list and cannot shorten it.
const OWNER_ONLY = ['.github/workflows', '.github/dependabot.yml', FILE, 'docs/agents/worker-rules.md'];
// A worker session's model and effort by the tier of its task.
const TIERS = { quick: ['sonnet', 'high'], standard: ['opus', 'high'], full: ['opus', 'xhigh'], research: ['fable', 'xhigh'] };

const shipped = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
// content.json lies two folders up in the plugin and in the app's packed content; a skill folder copied alone (an agent without plugins) has none, so its version is unknown.
const pluginVersion = () => { try { const v = shipped('../../content.json').contentVersion; return /^\d+\.\d+\.\d+$/.test(v) ? v : null; } catch { return null; } };

// 64 MB: a thousand pull requests with their bodies do not fit Node's default of 1 MB.
export const sh = (cwd, cmd, args) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 });

const kind = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);

// The JSON Schema keywords the shipped schema uses, nothing more. The app's editor has its own copy (app/src/params.mjs); a test holds both to the same rule and path.
function check(s, v, path, out) {
  const fail = (rule, message) => out.push({ rule, path, message });
  if (s.enum && !s.enum.includes(v)) return fail('enum', `must be one of ${s.enum.map((x) => JSON.stringify(x)).join(', ')}`);
  const want = s.type;
  if (want && kind(v) !== want && !(want === 'number' && kind(v) === 'integer')) return fail('type', `must be ${want}, not ${kind(v)}`);
  if (typeof v === 'string' && s.minLength && v.length < s.minLength) fail('length', `must have at least ${s.minLength} characters`);
  if (typeof v === 'string' && s.pattern && !new RegExp(s.pattern, 'u').test(v)) fail('pattern', `must match ${s.pattern}`);
  if (typeof v === 'number') {
    if (s.minimum != null && v < s.minimum) fail('range', `must be at least ${s.minimum}`);
    if (s.maximum != null && v > s.maximum) fail('range', `must be at most ${s.maximum}`);
  }
  if (Array.isArray(v)) v.forEach((x, i) => check(s.items, x, `${path}[${i}]`, out));
  else if (kind(v) === 'object') {
    const at = (k) => (path ? `${path}.${k}` : k);
    const known = s.properties ?? {};
    for (const [k, sub] of Object.entries(known)) if (k in v) check(sub, v[k], at(k), out);
    // additionalProperties is only ever false, and the one patternProperties entry ("^//", a comment) takes any value.
    if (s.additionalProperties === false) for (const k of Object.keys(v)) if (!Object.hasOwn(known, k) && !Object.keys(s.patternProperties ?? {}).some((p) => new RegExp(p, 'u').test(k))) out.push({ rule: 'unknown-key', path: at(k), message: 'is not a key the schema names (a comment key starts with //)' });
  }
}

// The errors of a parsed policy file against the shipped schema, each { rule, path, message }.
export function validate(doc) {
  if (kind(doc) !== 'object') return [{ rule: 'not-object', path: '', message: 'must be a JSON object' }];
  const errors = [];
  check(shipped('./orchestration.schema.json'), doc, '', errors);
  return errors;
}

const older = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i]; return false; };
// Comment keys explain the file to its reader; the policy holds only what the coordinator acts on.
const plain = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('//')));

// { policy, errors }: the policy with every default filled in, or null with the errors. Fields are read by name, whatever the file's schemaVersion.
export function effective(doc, version = pluginVersion()) {
  const errors = validate(doc);
  if (!errors.length) {
    // Without a label of its own, two projects on one tracker would pick the same issue.
    if (doc.issues?.repository && !doc.issues.labels?.length) errors.push({ rule: 'length', path: 'issues.labels', message: 'must have at least 1 entry when issues.repository is set' });
    if (doc.minPlugin && !version) errors.push({ rule: 'range', path: 'minPlugin', message: 'cannot be checked: the version of this plugin is unknown (no content.json two folders above the skill)' });
    else if (doc.minPlugin && older(version, doc.minPlugin)) errors.push({ rule: 'range', path: 'minPlugin', message: `must be at most ${version}, the version of this plugin` });
  }
  if (errors.length) return { policy: null, errors };
  const { merge = {}, review = {}, issues = {}, models = {} } = doc;
  return {
    errors,
    policy: {
      startLabel: doc.startLabel ?? null,
      trustedAuthors: doc.trustedAuthors ?? [],
      workersPerProject: doc.workersPerProject ?? 1,
      hostWorkerLimit: doc.hostWorkerLimit ?? 2,
      stallMinutes: doc.stallMinutes ?? 20,
      merge: {
        allowed: merge.allowed ?? false,
        requiredChecks: merge.requiredChecks ?? [],
        mode: merge.mode ?? 'strict',
        additivePaths: merge.additivePaths ?? [],
        ownerOnlyPaths: [...new Set([...OWNER_ONLY, ...(merge.ownerOnlyPaths ?? [])])],
      },
      closeIssue: doc.closeIssue ?? false,
      deleteMergedBranch: doc.deleteMergedBranch ?? false,
      issuesPerWorker: doc.issuesPerWorker ?? 1,
      keepRunning: doc.keepRunning ?? false,
      permissionPrompts: doc.permissionPrompts ?? 'block',
      review: { depth: review.depth ?? 'high', sensitiveDepth: review.sensitiveDepth ?? 'xhigh', sensitivePaths: review.sensitivePaths ?? [] },
      issues: { repository: issues.repository ?? null, labels: issues.labels ?? [] },
      minPlugin: doc.minPlugin ?? null,
      models: {
        worker: Object.fromEntries(Object.entries(TIERS).map(([tier, [model, effort]]) => [tier, { model: models.worker?.model ?? model, effort: models.worker?.effort ?? effort }])),
        phases: Object.fromEntries(Object.entries(plain(models.phases ?? {})).map(([phase, named]) => [phase, plain(named)])),
      },
    },
  };
}

// The effective policy of the project in dir. A project without the file gets the defaults, which start and merge nothing.
export function read(dir, run = sh) {
  let head;
  try { head = run(dir, 'git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).trim(); } catch {
    // Not cloned (git init, then remote add): the remote names its default branch, and no reference is written here.
    const named = /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(run(dir, 'git', ['ls-remote', '--symref', 'origin', 'HEAD']));
    if (!named) throw new Error('origin names no default branch');
    head = `origin/${named[1]}`;
  }
  run(dir, 'git', ['fetch', '--quiet', 'origin', head.replace(/^origin\//, '')]);
  let text;
  try { text = run(dir, 'git', ['show', `${head}:${FILE}`]); } catch { return effective({}); }
  let doc;
  try { doc = JSON.parse(text); } catch { return { policy: null, errors: [{ rule: 'bad-json', path: '', message: 'is not valid JSON' }] }; }
  return effective(doc);
}

export const errorLine = (e) => `${e.rule}${e.path ? ` at ${e.path}` : ''}: ${e.message}`;

// Node resolves symlinks for import.meta.url but keeps process.argv[1] as typed: compared as real paths, the command line also runs through a symlinked folder.
export const isMain = (url) => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(url)); } catch { return false; } };
if (isMain(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('usage: node policy.mjs <project path>');
    const { policy, errors } = read(process.argv[2]);
    for (const e of errors) console.error(errorLine(e));
    if (policy) console.log(JSON.stringify(policy, null, 2));
    process.exitCode = policy ? 0 : 1;
  } catch (e) {
    console.error(e.message.split('\n')[0]);
    process.exitCode = 1;
  }
}
