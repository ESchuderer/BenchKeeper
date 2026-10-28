// Skills as a project has them: the state of each against the library, what no setup installed, and the plan that
// changes one skill (update, reset, remove, adopt, enable, disable). Reads only; the changes go through the project plan and its runner.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { skillDirs } from './agents.mjs';
import { contentDir } from './content.mjs';
import { exists, isDir, readText } from './fsx.mjs';
import { libraryWith } from './packs.mjs';
import { latestCommits } from './remote.mjs';
import { itemState } from './runner.mjs';
import { KEEP_SKILLS } from './steps/global.mjs';
import { editedHere, lockedSkills, ownSkillFiles, tryState } from './steps/project.mjs';

// The SKILL.md files in a project's agent skill folders; a skill several agents read can appear once per folder.
// Turned-off skills sit in .benchkeeper/disabled/ and are not among them.
export function skillFiles(dir) {
  return ['.claude/skills', '.agents/skills', '.github/skills', '.gemini/skills'].map((x) => join(dir, x)).filter(exists)
    .flatMap((d) => readdirSync(d).map((name) => ({ name, file: join(d, name, 'SKILL.md') })))
    .flatMap((f) => { const text = readText(f.file); return text == null ? [] : [{ ...f, text }]; });
}

const NAME = /^[a-z0-9][a-z0-9-]*$/;
const subfolders = (dir) => { try { return readdirSync(dir).filter((n) => NAME.test(n) && isDir(join(dir, n))); } catch { return []; } };

// current, outdated (the library has a newer copy, or the source's default branch has moved on: only known after a check), modified (edited here), removed (the folder is gone), disabled.
function ownState(ctx, dir, skill, a) {
  const ids = a.agents.filter((x) => skill.agents !== 'codex' || x === 'codex');
  const seen = skillDirs(ids, 'project', dir).flatMap(({ dir: d }) => ownSkillFiles(skill.name, a.paths?.[skill.name]).map(({ file, text }) => itemState(join(d, skill.name, file), text, ctx)));
  if (seen.includes('modified')) return 'modified';
  if (seen.some((s) => ['removed', 'absent'].includes(s))) return 'removed';
  // Foreign: no run of this machine wrote it (a clone, another worktree), so the library's copy counts as the newer one.
  return seen.some((s) => ['outdated', 'foreign'].includes(s)) ? 'outdated' : 'current';
}

function communityState(dir, rec, skill, a, latest) {
  const folders = skillDirs(a.agents.filter((x) => skill?.agents !== 'codex' || x === 'codex'), 'project', dir).map((x) => x.dir);
  if (!folders.some((d) => exists(join(d, rec.name)))) return 'removed';
  if (folders.some((d) => editedHere(d, rec.name, rec.hash))) return 'modified';
  // A skill with no recorded commit is outdated once the source is known: an update records one.
  return latest[rec.source] && rec.ref !== latest[rec.source] ? 'outdated' : 'current';
}

// null: no state file. Skills by the state file, each with where it comes from, its state, the commit installed (pinned)
// and the commit the source's default branch is at (newest, only with check: one ls-remote per source; a repository with
// many skills counts as moved when any of them changed). untracked: folders no setup of BenchKeeper installed, never touched by an
// update; library is true when the name is a library skill (it can be adopted).
export function projectSkills(ctx, dir, { check = false } = {}) {
  const state = tryState(dir);
  if (!state) return null;
  const lib = libraryWith(ctx);
  const a = { agents: state.agents ?? [], paths: state.paths ?? {} };
  const disabled = state.disabled ?? [];
  const latest = check ? latestCommits(ctx, (state.skills ?? []).filter((r) => r.source !== 'own').map((r) => r.source)) : {};
  const skills = (state.skills ?? []).filter((r) => NAME.test(r.name ?? '')).map((rec) => {
    const skill = lib.skills.find((x) => x.name === rec.name);
    const own = rec.source === 'own';
    const packs = (state.packs ?? []).filter((p) => lib.packs.find((x) => x.id === p)?.skills?.includes(rec.name));
    const status = disabled.includes(rec.name) ? 'disabled' : own && skill ? ownState(ctx, dir, skill, a) : communityState(dir, rec, skill, a, latest);
    return { name: rec.name, source: rec.source, own, state: status, pinned: own ? null : rec.ref ?? null, newest: own ? null : latest[rec.source] ?? null, packs, single: (state.singles ?? []).includes(rec.name) };
  });
  const tracked = new Set([...skills.map((s) => s.name), ...lockedSkills(dir), ...disabled]);
  const found = new Map();
  for (const { dir: d } of skillDirs(a.agents, 'project', dir)) {
    for (const name of subfolders(d).filter((n) => !tracked.has(n))) found.set(name, [...(found.get(name) ?? []), d.slice(dir.length + 1)]);
  }
  const untracked = [...found].map(([name, folders]) => ({ name, folders, library: lib.skills.some((s) => s.name === name) }));
  return { skills, untracked };
}

// Skill folders in an agent's global folder that no BenchKeeper setup put there (its own skills and the kept ones).
export function globalUntracked(ctx, agents) {
  const ours = new Set([...KEEP_SKILLS, ...subfolders(join(contentDir, 'skills'))]);
  const found = new Map();
  for (const { dir: d } of skillDirs(agents, 'global', ctx.home)) for (const name of subfolders(d).filter((n) => !ours.has(n))) found.set(name, [...(found.get(name) ?? []), d.slice(ctx.home.length + 1)]);
  return [...found].map(([name, folders]) => ({ name, folders }));
}

// The skill answers of one action. remove: a single pick goes, a skill a pack brings stays with the pack. add: a library skill
// the project does not have becomes a single pick.
export function skillAction(rows, action, names, lib) {
  const row = (n) => rows.skills.find((s) => s.name === n);
  for (const n of names) {
    if (action === 'adopt' && !rows.untracked.some((u) => u.name === n && u.library)) throw new Error(`${n} is not an untracked library skill of this project`);
    if (action === 'add' && (row(n) || rows.untracked.some((u) => u.name === n))) throw new Error(`${n} is already in this project${row(n)?.state === 'disabled' ? `: benchkeeper skills enable ${n}` : ''}`);
    if (action === 'add' && !lib.skills.some((s) => s.name === n)) throw new Error(`${n} is not a library skill`);
    if (!['adopt', 'add'].includes(action) && !row(n)) throw new Error(`${n} is not a skill of this project`);
    if (action === 'remove' && !row(n).single) throw new Error(`${n} comes from ${row(n).packs.length ? `the pack ${row(n).packs.join(', ')}` : 'the setup'}: switch the pack off (benchkeeper packs disable ${row(n).packs[0] ?? '<pack>'}) or turn the skill off (benchkeeper skills disable ${n})`);
  }
  if (action === 'update' && !names.length) {
    const outdated = rows.skills.filter((s) => s.state === 'outdated').map((s) => s.name);
    return { names: outdated, answers: { update: outdated } };
  }
  return { names, answers: { enable: action === 'enable' ? names : [], disable: action === 'disable' ? names : [], update: action === 'update' ? names : [], reset: action === 'reset' ? names : [], drop: action === 'remove' ? names : [], pick: ['adopt', 'add'].includes(action) ? names : [] } };
}

// Only the changes of the skills named, with the state file, the git exclude list and the rules block (it points to own skills).
export const focusOn = (changes, names) => changes.filter((c) => {
  const m = c.step.match(/^(?:skill|on|off|remove):(.+)$/);
  return m ? names.includes(m[1]) : ['state', 'exclude', 'agents-md', 'local-claude', 'local-codex'].includes(c.step);
});
