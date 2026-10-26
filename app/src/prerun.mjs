// Rehearses a skills CLI command in a scratch folder before it runs for real, so a plan shows the files it would write.
// A project command runs in a scratch copy of its snapshot paths, a global one in an empty scratch home; both get a
// scratch HOME and every variable the skills CLI reads its folders from, so nothing outside the scratch folder changes.
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { registry } from './agents.mjs';
import { childEnv } from './childenv.mjs';
import { diffLines } from './diff.mjs';
import { mask } from './redact.mjs';
import { exists, isDir, listFiles, readText } from './fsx.mjs';
import { SKILLS_SPEC } from './steps/global.mjs';

export const rehearsable = (c) => c.kind === 'command' && c.argv?.[2] === SKILLS_SPEC;

// Folders npx and npm fill in the scratch home; not part of what the command installs.
const SKIP = ['.npm', '.cache', join('.config', 'npm')];
const LOCK = join('.agents', '.skill-lock.json');
// Variables the skills CLI and npm read folders from (skills 1.7.2 dist/cli.mjs: codexHome, claudeHome, getSkillLockPath).
const MOVED = ['CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME'];
const MAX_FILES = 200;
// What a seeded path may weigh, links followed: a link to a huge folder must not fill the temporary folder.
const SEED_FILES = 5000, SEED_BYTES = 64 * 1024 * 1024;

// Throws when the files below p, through links, pass the budget (a link loop ends here too).
function weigh(p, budget) {
  const st = statSync(p);
  if (--budget.files < 0 || (budget.bytes -= st.isFile() ? st.size : 0) < 0) throw new Error('too large');
  if (st.isDirectory()) for (const n of readdirSync(p)) weigh(join(p, n), budget);
}

// The user's npm settings without credentials: registry, proxy and certificates stay, tokens and passwords do not.
// A line with a credential, a client key, a credential helper or user info in a URL is left out.
const safeNpmrc = (text) => (text ?? '').split('\n').filter((l) => !/_auth|_password|_token|username|helper|:\/\/[^@/\s]*@|(^|[\s/:])(key|keyfile)\s*=/i.test(l)).join('\n');

// A relative path that stays below its base, by name: a link in it is copied as what it points to.
const below = (r) => r && r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r);

// The files below a path, relative to it: '' for the path itself when it is a file.
const filesBelow = (p) => (isDir(p) ? listFiles(p) : exists(p) ? [''] : []);

// Where the real command writes what a global rehearsal wrote below the scratch home: the folder a variable moves it to,
// as the skills CLI resolves them, else the same path below home.
const MOVES = [['.claude', () => process.env.CLAUDE_CONFIG_DIR], ['.codex', () => process.env.CODEX_HOME],
  [LOCK, () => process.env.XDG_STATE_HOME && join(process.env.XDG_STATE_HOME, 'skills', '.skill-lock.json')],
  ['.config', () => process.env.XDG_CONFIG_HOME], [join('.local', 'share'), () => process.env.XDG_DATA_HOME]];
function homePath(home, rel) {
  for (const [from, to] of MOVES) {
    const dir = to()?.trim();
    if (dir && (rel === from || rel.startsWith(`${from}${sep}`))) return join(dir, relative(from, rel));
  }
  return join(home, rel);
}

const checked = new Map();

export async function rehearse(ctx, c, { signal, timeout = 5 * 60e3 } = {}) {
  const t = mkdtempSync(join(tmpdir(), 'bk-prerun-'));
  try {
    const h = join(t, 'h'), p = join(t, 'p'), root = c.cwd ? p : h;
    for (const d of [h, p]) mkdirSync(d, { recursive: true });
    // The real path of a path in the scratch folder, and the paths copied in first so the command finds them as they are:
    // in a project its snapshot and every agent's skill folder, which the skills CLI reads to keep shared lock entries.
    const realOf = c.cwd ? (rel) => join(c.cwd, rel) : (rel) => homePath(ctx.home, rel);
    const seeds = c.cwd ? [...new Set([...(c.snapshot ?? []).map((x) => relative(c.cwd, x)).filter(below), ...registry.map((a) => join(a.project.skills))])] : [LOCK];
    // Links are copied as what they point to: a link left in place would let the command write through it.
    const budget = { files: SEED_FILES, bytes: SEED_BYTES };
    try { for (const s of seeds) if (exists(realOf(s))) weigh(realOf(s), budget); } catch (e) { return { files: [], error: `a folder the command reads is too large to rehearse (over ${SEED_FILES} files or ${SEED_BYTES / 2 ** 20} MB, links followed): ${e.message === 'too large' ? 'run it without a preview' : e.message}` }; }
    for (const s of seeds) if (exists(realOf(s))) { mkdirSync(dirname(join(root, s)), { recursive: true }); cpSync(realOf(s), join(root, s), { recursive: true, dereference: true }); }
    // git gets an empty config: the user's holds credential helpers, extra headers and ssh commands, and the rehearsed code is not theirs to read.
    const gitconfig = join(t, 'gitconfig');
    writeFileSync(gitconfig, '', { mode: 0o600 });
    const npmrc = join(t, 'npmrc');
    writeFileSync(npmrc, safeNpmrc(readText(process.env.npm_config_userconfig ?? process.env.NPM_CONFIG_USERCONFIG ?? join(ctx.home, '.npmrc'))), { mode: 0o600 });
    // Unset, the folder variables fall back to folders below the scratch HOME (spawn leaves out undefined values).
    const env = {
      ...childEnv(c.env), HOME: h, USERPROFILE: h, ...Object.fromEntries(MOVED.map((k) => [k, undefined])),
      // npm keeps the user's cache and, without credentials, its settings.
      // The home is the machine's context home, so BENCHKEEPER_HOME isolates the rehearsal too.
      npm_config_cache: process.env.npm_config_cache ?? (process.platform === 'win32' ? join(process.env.LOCALAPPDATA ?? join(ctx.home, 'AppData/Local'), 'npm-cache') : join(ctx.home, '.npm')),
      npm_config_userconfig: npmrc,
      GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1',
    };
    // npm reads these names in either case: the user's own upper-case ones must not win over the scratch ones.
    for (const k of Object.keys(env)) if (/^npm_config_(userconfig|cache)$/i.test(k) && k !== k.toLowerCase()) delete env[k];
    const runAsync = ctx.runAsync ?? (async (argv, o) => ctx.run(argv, o));
    // The same signature check as the run: unsigned code is not downloaded for a preview either.
    // A passed check counts for 10 minutes, so a list of previews checks the skills CLI once.
    const key = c.verify?.join(' ');
    if (c.verify && !(checked.get(key) > Date.now())) {
      const v = await runAsync(c.verify, { cwd: t, env: childEnv(c.env), signal, timeout });
      if (v.code === 0) checked.set(key, Date.now() + 10 * 60e3);
      if (v.code !== 0) return { files: [], error: `signature check failed: ${mask((v.stderr || v.stdout).trim().split('\n').slice(-3).join(' ')) || `exit ${v.code}`}` };
    }
    const r = await runAsync(c.argv, { cwd: root, env, signal, timeout });
    if (r.code !== 0) return { files: [], error: mask((r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ')) || `exit ${r.code}` };
    // What the command left in the scratch folder, and the seeded paths it may have removed.
    const skip = (f) => !c.cwd && SKIP.some((s) => f === s || f.startsWith(`${s}${sep}`));
    const rels = [...new Set([...listFiles(root), ...seeds.flatMap((s) => filesBelow(realOf(s)).map((f) => join(s, f)))])].filter((f) => !skip(f)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const changed = rels.filter((f) => readText(realOf(f)) !== readText(join(root, f)));
    const files = changed.slice(0, MAX_FILES).map((f) => ({ path: realOf(f), diff: diffLines(readText(realOf(f)), readText(join(root, f)), realOf(f)) }));
    return { files, more: Math.max(changed.length - MAX_FILES, 0), error: null };
  } finally { rmSync(t, { recursive: true, force: true }); }
}
