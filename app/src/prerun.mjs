// Rehearses a skills CLI command in a scratch folder before it runs for real, so a plan shows the files it would write.
// A project command runs in a scratch copy of its snapshot paths, a global one in an empty scratch home; both get a
// scratch HOME and every variable the skills CLI reads its folders from, so nothing outside the scratch folder changes.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { diffLines } from './diff.mjs';
import { copy, exists, isDir, listFiles, readText } from './fsx.mjs';
import { SKILLS_SPEC } from './steps/global.mjs';

export const rehearsable = (c) => c.kind === 'command' && c.argv?.[2] === SKILLS_SPEC;

// Folders npx and npm fill in the scratch home; not part of what the command installs.
const SKIP = ['.npm', '.cache', join('.config', 'npm')];
const LOCK = '.agents/.skill-lock.json';
// Variables the skills CLI and npm read folders from (skills 1.7.2 dist/cli.mjs: codexHome, claudeHome, getSkillLockPath).
const MOVED = ['CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME'];
const MAX_FILES = 200;

// The files of a path, relative to base: every file below a folder, the file itself, or nothing.
const filesOf = (p, base) => (isDir(p) ? listFiles(p).map((f) => relative(base, join(p, f))) : exists(p) ? [relative(base, p)] : []);

// shortcut: a real CODEX_HOME, CLAUDE_CONFIG_DIR or XDG_STATE_HOME is not mapped back, the diff compares with the default
// folders under home; map them when the app itself honours those variables.
export async function rehearse(ctx, c, { signal } = {}) {
  const t = mkdtempSync(join(tmpdir(), 'bk-prerun-'));
  try {
    const h = join(t, 'h'), p = join(t, 'p');
    // The real folders the scratch one stands for, and the paths copied in first so the command finds them as they are.
    const [root, real, seeds] = c.cwd ? [p, c.cwd, (c.snapshot ?? []).filter((x) => !relative(c.cwd, x).startsWith('..'))] : [h, ctx.home, [join(ctx.home, LOCK)]];
    for (const s of seeds) if (exists(s)) copy(s, join(root, relative(real, s)));
    for (const d of [h, p]) mkdirSync(d, { recursive: true });
    // Unset, these fall back to folders below the scratch HOME (spawn leaves out undefined values).
    const env = {
      ...process.env, ...c.env, HOME: h, USERPROFILE: h, ...Object.fromEntries(MOVED.map((k) => [k, undefined])),
      // npm keeps the user's cache and settings, read from where they are.
      npm_config_cache: process.env.npm_config_cache ?? (process.platform === 'win32' ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData/Local'), 'npm-cache') : join(homedir(), '.npm')),
      npm_config_userconfig: process.env.npm_config_userconfig ?? join(homedir(), '.npmrc'),
    };
    const runAsync = ctx.runAsync ?? (async (argv, o) => ctx.run(argv, o));
    const r = await runAsync(c.argv, { cwd: c.cwd ? p : h, env, signal });
    if (r.code !== 0) return { files: [], error: (r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ') || `exit ${r.code}` };
    // What the command left in the scratch folder, and the seeded paths it may have removed.
    const skip = (f) => !c.cwd && SKIP.some((s) => f === s || f.startsWith(`${s}${sep}`));
    const rels = [...new Set([...filesOf(root, root), ...seeds.flatMap((s) => filesOf(s, real))])].filter((f) => !skip(f)).sort();
    const files = [];
    for (const f of rels) {
      const before = readText(join(real, f)), after = readText(join(root, f));
      if (before === after) continue;
      files.push({ path: join(real, f), diff: diffLines(before, after, join(real, f)) });
    }
    return { files: files.slice(0, MAX_FILES), more: Math.max(files.length - MAX_FILES, 0), error: null };
  } finally { rmSync(t, { recursive: true, force: true }); }
}
