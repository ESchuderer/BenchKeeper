// Usage: node policy.mjs <project path>. Prints the project's effective coordinator policy as JSON; a file the schema rejects, a minPlugin newer than this plugin or an unreadable file prints each error and exits 1, and nothing may start there.
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FILE = 'docs/agents/orchestration.json';
// Pull requests on these paths are left for the owner, and a policy adds to the list and cannot shorten it: what CI runs and who reviews (.github, CODEOWNERS), and the coordinator's own rules.
const OWNER_ONLY = ['.github', 'CODEOWNERS', 'docs/CODEOWNERS', FILE, 'docs/agents/worker-rules.md'];
// A path with one of these names as a segment is the owner's at any depth: Claude Code also loads the skills of a .claude folder below the root, and they decide what agents may do.
const OWNER_ONLY_NAMES = ['.claude', '.mcp.json'];
// A worker session's model and effort by the tier of its task. Every default effort is high: a higher one costs much more and is the owner's to ask for, in the policy.
const TIERS = { quick: ['sonnet', 'high'], standard: ['opus', 'high'], full: ['opus', 'high'], research: ['fable', 'high'] };

const shipped = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
// content.json lies two folders up in the plugin and in the app's packed content; a skill folder copied alone (an agent without plugins) has none, so its version is unknown.
const pluginVersion = () => { try { const v = shipped('../../content.json').contentVersion; return /^\d+\.\d+\.\d+$/.test(v) ? v : null; } catch { return null; } };

// Started from a hook or `git rebase --exec`, these variables name another repository and carry that command's -c settings: neither reaches git here, and git fails instead of asking (as repoEnv in the app's src/git.mjs).
const REPO_VARS = /^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|PREFIX)$/;
const CONFIG_VARS = /^GIT_CONFIG_(PARAMETERS|COUNT|KEY_\d+|VALUE_\d+)$/;
const childEnv = () => {
  const fromHook = Object.keys(process.env).some((k) => REPO_VARS.test(k));
  return {
    // GH_REPO would list another repository's issues than the origin the policy came from.
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'GH_REPO' && !REPO_VARS.test(k) && !(fromHook && CONFIG_VARS.test(k)))),
    GIT_TERMINAL_PROMPT: '0',
    // A worker shares the git directory: a replace ref it wrote must not swap the policy file for another.
    GIT_NO_REPLACE_OBJECTS: '1',
  };
};
// 64 MB: a thousand pull requests with their bodies do not fit Node's default of 1 MB. Two minutes: a stalled transfer or a prompt ssh waits at ends.
export const sh = (cwd, cmd, args) => execFileSync(cmd, args, { cwd, env: childEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20, timeout: 120_000 });

const kind = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);

const KEYWORDS = ['$schema', 'title', 'type', 'enum', 'minLength', 'pattern', 'minimum', 'maximum', 'minItems', 'items', 'properties', 'additionalProperties', 'patternProperties', 'dependentRequired'];
// A schema edit that uses a keyword check() does not implement must fail every check, never pass files the schema refuses.
function supported(s, at = 'the schema') {
  const bad = Object.keys(s).find((k) => !KEYWORDS.includes(k))
    ?? ('additionalProperties' in s && s.additionalProperties !== false ? 'additionalProperties other than false' : undefined)
    ?? (Object.values(s.patternProperties ?? {}).some((sub) => Object.keys(sub).length) ? 'patternProperties with rules' : undefined);
  if (bad) throw new Error(`${at} uses ${bad}, which the policy check does not implement`);
  for (const [k, sub] of Object.entries(s.properties ?? {})) supported(sub, `${at}.${k}`);
  if (s.items) supported(s.items, `${at}[]`);
  return s;
}

// The JSON Schema keywords the shipped schema uses, nothing more.
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
  if (Array.isArray(v)) {
    if (s.minItems && v.length < s.minItems) fail('length', `must have at least ${s.minItems} entries`);
    v.forEach((x, i) => check(s.items, x, `${path}[${i}]`, out));
  } else if (kind(v) === 'object') {
    const at = (k) => (path ? `${path}.${k}` : k);
    const known = s.properties ?? {};
    for (const [k, sub] of Object.entries(known)) if (k in v) check(sub, v[k], at(k), out);
    // The key is the file's text: control and format characters could rewrite the terminal line or cut the message.
    const shown = (k) => at(k.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '?'));
    if (s.additionalProperties === false) for (const k of Object.keys(v)) if (!Object.hasOwn(known, k) && !Object.keys(s.patternProperties ?? {}).some((p) => new RegExp(p, 'u').test(k))) out.push({ rule: 'unknown-key', path: shown(k), message: 'is not a key the schema names (a comment key starts with //)' });
    for (const [k, needs] of Object.entries(s.dependentRequired ?? {})) if (k in v) for (const n of needs) if (!(n in v)) out.push({ rule: 'missing-key', path: at(n), message: `is needed when ${k} is set` });
  }
}

// The errors of a parsed policy file, each { rule, path, message }. The app's policy editor checks with this function too, so both refuse the same files.
export function validate(doc) {
  if (kind(doc) !== 'object') return [{ rule: 'not-object', path: '', message: 'must be a JSON object' }];
  const errors = [];
  check(supported(shipped('./orchestration.schema.json')), doc, '', errors);
  // On a tracker, startLabel is no label of the project's own: two projects with it alone would pick the same issue. GitHub compares label names without case.
  if (!errors.length && doc.issues?.repository && doc.issues.labels.every((label) => label.toLowerCase() === doc.startLabel?.toLowerCase())) errors.push({ rule: 'length', path: 'issues.labels', message: 'must have at least 1 entry besides startLabel' });
  return errors;
}

const older = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i]; return false; };
// Comment keys explain the file to its reader; the policy holds only what the coordinator acts on.
const plain = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('//')));

// { policy, errors }: the policy with every default filled in, or null with the errors. Fields are read by name, whatever the file's schemaVersion.
export function effective(doc, version = pluginVersion()) {
  const errors = validate(doc);
  // The one check the schema cannot hold: it depends on the plugin that reads the file, which the app's editor does not judge.
  if (!errors.length && doc.minPlugin && !version) errors.push({ rule: 'range', path: 'minPlugin', message: 'cannot be checked: the version of this plugin is unknown (no content.json two folders above the skill)' });
  else if (!errors.length && doc.minPlugin && older(version, doc.minPlugin)) errors.push({ rule: 'range', path: 'minPlugin', message: `must be at most ${version}, the version of this plugin` });
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
        ownerOnlyNames: OWNER_ONLY_NAMES,
      },
      closeIssue: doc.closeIssue ?? false,
      deleteMergedBranch: doc.deleteMergedBranch ?? false,
      issuesPerWorker: doc.issuesPerWorker ?? 1,
      keepRunning: doc.keepRunning ?? false,
      permissionPrompts: doc.permissionPrompts ?? 'block',
      review: { depth: review.depth ?? 'high', sensitiveDepth: review.sensitiveDepth ?? 'high', sensitivePaths: review.sensitivePaths ?? [] },
      issues: { repository: issues.repository ?? null, labels: issues.labels ?? [] },
      minPlugin: doc.minPlugin ?? null,
      models: {
        worker: Object.fromEntries(Object.entries(TIERS).map(([tier, [model, effort]]) => [tier, { model: models.worker?.model ?? model, effort: models.worker?.effort ?? effort }])),
        phases: Object.fromEntries(Object.entries(plain(models.phases ?? {})).map(([phase, named]) => [phase, plain(named)])),
      },
    },
  };
}

// The reader's own ref for the remote's HEAD: the default branch as the remote has it now, not as a stale or locally moved origin/HEAD names it, and no name the remote chooses becomes an argument.
const REF = 'refs/benchkeeper/policy';
const unreadable = (message) => ({ policy: null, errors: [{ rule: 'unreadable', path: '', message }] });

// The effective policy of the project in dir. A project without the file gets the defaults, which start and merge nothing.
export function read(dir, run = sh) {
  let commit;
  try {
    // The commit is asked of the remote and both reads name it: a worker shares this git directory and could move the reader's ref between the fetch and the read.
    commit = /^([0-9a-f]{40}|[0-9a-f]{64})\tHEAD$/m.exec(run(dir, 'git', ['ls-remote', 'origin', 'HEAD']))?.[1];
    // The fetch touches only the reader's ref: no submodules, and not the FETCH_HEAD a session in this worktree may rely on.
    run(dir, 'git', ['fetch', '--quiet', '--no-tags', '--no-recurse-submodules', '--no-write-fetch-head', 'origin', `+HEAD:${REF}`]);
  } catch (e) {
    return unreadable(e.code === 'ENOENT' ? 'the folder does not exist, or git is not installed' : "git could not fetch origin's HEAD: no git repository here, no remote named origin, no answer from it, or no default branch there");
  }
  if (!commit) return unreadable("origin names no commit as its HEAD");
  let text;
  try {
    // ls-tree decides whether the file exists, so a show that fails is never read as "no file", which would mean the defaults. --full-tree: the path counts from the repository root, as in the show, also when dir is a folder below it.
    if (!run(dir, 'git', ['ls-tree', '--full-tree', '--name-only', commit, '--', FILE]).trim()) return effective({});
    text = run(dir, 'git', ['show', `${commit}:${FILE}`]);
  } catch { return unreadable(`git could not read ${FILE} from origin's default branch`); }
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
