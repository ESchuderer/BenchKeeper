// Packs: the library's presets plus the user's own, saved in ~/.config/benchkeeper/packs/<id>.json. The user's own skills
// (source 'user'), saved in ~/.config/benchkeeper/skills/<name>/, join the library's skills.
// A pack file names library skills only, so an imported pack cannot bring a source or ref the library does not pin; an own
// pack may name the user's skills too, and is not exported then.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { contentDir, library } from './content.mjs';
import { exists, listDir, listFiles, move, readText, real, writeAtomic } from './fsx.mjs';
import { mergeJson } from './merge.mjs';

const PACK_SCHEMA = 1;
const dir = (ctx) => join(ctx.config, 'packs');

// A file that is not a pack with a plain id named like its file is left out of the packs (the id becomes a file name) and
// listed as invalid, with the reason, so it can be seen and removed.
function scan(ctx) {
  let files = [];
  try { files = readdirSync(dir(ctx)).filter((f) => f.endsWith('.json')); } catch { return { packs: [], invalid: [] }; }
  const packs = [], invalid = [];
  for (const file of files) {
    let p;
    try { p = { ...JSON.parse(readFileSync(join(dir(ctx), file), 'utf8')), own: true }; } catch { invalid.push({ file, reason: 'not valid JSON' }); continue; }
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(p.id ?? '')) invalid.push({ file, reason: 'the id is not a plain id' });
    else if (file !== `${p.id}.json`) invalid.push({ file, reason: `the file name is not ${p.id}.json` });
    else packs.push(p);
  }
  return { packs, invalid };
}
export const ownPacks = (ctx) => scan(ctx).packs;
export const invalidPacks = (ctx) => scan(ctx).invalid;

// The user's skills: one folder each, SKILL.md and any other files, copied into the projects and global folders that pick
// them like a library skill BenchKeeper ships (source 'own'). In code their source is 'user'.
export const userSkillDir = (ctx, name) => join(ctx.config, 'skills', name);
// A skill copied from a folder, not added through the skills CLI, and the folder it is copied from.
export const copied = (s) => s?.source === 'own' || s?.source === 'user';
export const skillFolder = (ctx, s) => (s.source === 'user' ? userSkillDir(ctx, s.name) : join(contentDir, 'library', s.name));
// A copied skill's files (src: its folder) as they are written: text with the path globs of the setup in SKILL.md's front matter,
// and a file that is not UTF-8 text (an image of a user skill) as a byte copy, from, with its bytes.
// An entry that is not a file (a link to nothing or to a folder) is left out: skippedLinks names it for the plan's warning.
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
export const skippedLinks = (src) => listFiles(src).filter((file) => !isFile(join(src, file)));
export function ownSkillFiles(src, paths) {
  return listFiles(src).filter((file) => isFile(join(src, file))).map((file) => {
    const bytes = readFileSync(join(src, file)), text = bytes.toString('utf8');
    // The target of a link, not the link: the copy copies a link as a link.
    if (!Buffer.from(text).equals(bytes)) return { file, from: real(join(src, file)), bytes };
    return { file, text: file === 'SKILL.md' && paths ? text.replace(/^(description: .*)$/m, `$1\npaths: ${paths}`) : text };
  });
}

// The Agent Skills rules (agentskills.io/specification): a name of 1 to 64 lowercase letters, digits and single hyphens, not
// at the start or end, that the front matter repeats, and a description of 1 to 1024 characters. Returns the description.
const SKILL_NAME = /^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;
function checkSkill(name, text) {
  if (!SKILL_NAME.test(name ?? '')) throw new Error('skill name: 1 to 64 lowercase letters, digits and single hyphens, not at the start or end');
  let front;
  try { front = parseYaml(String(text).replaceAll('\r\n', '\n').match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ''); } catch (e) { throw new Error(`SKILL.md front matter: ${e.message}`); }
  if (front?.name !== name) throw new Error(`SKILL.md front matter: name must be ${name}`);
  if (typeof front.description !== 'string' || !front.description.trim() || front.description.length > 1024) throw new Error('SKILL.md front matter: a description of 1 to 1024 characters');
  return front.description.trim();
}

// The user's skills in the library's shape. A folder that breaks the rules or has a library skill's name is left out.
export function userSkills(ctx, lib = library()) {
  let names = [];
  try { names = readdirSync(join(ctx.config, 'skills')); } catch { return []; }
  return names.filter((n) => !lib.skills.some((s) => s.name === n)).flatMap((name) => {
    try { return [{ name, source: 'user', agents: 'both', pickWhen: checkSkill(name, readText(join(userSkillDir(ctx, name), 'SKILL.md')) ?? '') }]; } catch { return []; }
  });
}

// The user's skill folders the library has a skill of: the library's wins, and doctor, the catalog and the project plan name
// the clash (#945). clashFix: how to keep the user's skill under another name.
export const hiddenUserSkills = (ctx, lib = library()) => listDir(join(ctx.config, 'skills')).filter((n) => lib.skills.some((s) => s.name === n) && exists(join(userSkillDir(ctx, n), 'SKILL.md')));
export const clashFix = (ctx, name) => `copy ${userSkillDir(ctx, name)} to a folder of a new name, set that name in its SKILL.md, and pick the new name in your projects`;

// The plan change that writes a user skill's SKILL.md, new or edited; undo puts the earlier file back.
export function userSkillWrite(ctx, name, text, { isNew }) {
  if (library().skills.some((s) => s.name === name)) throw new Error(`${name} is a library skill`);
  checkSkill(name, text);
  const have = exists(userSkillDir(ctx, name));
  if (isNew && have) throw new Error(`you have a skill ${name}: benchkeeper skills edit ${name} --file <path>`);
  if (!isNew && !have) throw new Error(`you have no skill ${name}`);
  return { id: `user-skill:${name}`, step: `user-skill:${name}`, title: `your skill ${name}: ${isNew ? 'new' : 'edited'} SKILL.md`, kind: 'write', path: join(userSkillDir(ctx, name), 'SKILL.md'), after: text, selected: true };
}

// The plan change that removes a user skill's folder; usedBy: the projects and own packs that still name it.
export function userSkillRemove(ctx, name, { usedBy = [] } = {}) {
  if (!SKILL_NAME.test(name ?? '') || !exists(userSkillDir(ctx, name))) throw new Error(`you have no skill ${name}`);
  if (usedBy.length) throw new Error(`skill ${name} is in use by ${usedBy.join(', ')}: take it out there first`);
  return { id: `user-skill:${name}`, step: `user-skill:${name}`, title: `remove your skill ${name}`, kind: 'remove', path: userSkillDir(ctx, name), selected: true };
}

// The library with the user's packs added to its presets and the user's skills to its skills.
export function libraryWith(ctx) {
  const lib = library();
  return { ...lib, skills: [...lib.skills, ...userSkills(ctx, lib)], packs: [...lib.packs, ...ownPacks(ctx)] };
}

// Install scope per pack: global (installed once on the machine, for every project) or projects (in each project whose setup
// selects the pack). Only a scope the user chose is stored; a pack without one keeps the scope its installs have: plugin packs
// global, skill packs per project. ctx.packScopes (pack id to scope) stands in for the file in the preview of a scope change.
export const PACK_SCOPES = ['global', 'projects'];
export const scopeFile = (ctx) => join(ctx.config, 'pack-scopes.json');
// The scopes the user chose, pack id to scope; a damaged file reads as none.
export function storedScopes(ctx) {
  try { return Object.fromEntries(Object.entries(JSON.parse(readText(scopeFile(ctx)) ?? '{}').scopes ?? {}).filter(([, s]) => PACK_SCOPES.includes(s))); } catch { return {}; }
}
export function packScope(ctx, pack) {
  const stored = ctx.packScopes?.[pack.id] ?? storedScopes(ctx)[pack.id];
  return PACK_SCOPES.includes(stored) ? stored : pack.plugins ? 'global' : 'projects';
}
// Skill packs for all projects: the global plan copies their skills into the global skill folders.
export const globalSkillPacks = (ctx, lib = libraryWith(ctx)) => lib.packs.filter((p) => !p.plugins && p.skills?.length && packScope(ctx, p) === 'global');
export const scopeText = (scope) => (scope === 'global' ? 'all projects' : 'selected projects');
// The plan change that records a scope: a write, so undo puts the previous file back.
export const scopeWrite = (ctx, id, scope) => ({ kind: 'write', path: scopeFile(ctx), edit: (t) => mergeJson(t, [{ path: ['schemaVersion'], value: 1 }, { path: ['scopes', id], value: scope }]) });

// The scopes an agent offers a pack: { scopes, fixed } where fixed names why only one is offered; null when the pack has nothing
// for the agent. A skill pack is skill folders, global or in the project, for Claude Code and Codex (Codex: repository and user;
// its admin scope is not offered, developers.openai.com/codex/skills); the global copies are made for those two only. Claude Code installs plugins at user, project or local scope
// (code.claude.com/docs/en/discover-plugins): global is user, selected projects is local (this machine only). Codex plugins:
// `codex plugin add` has no scope option and the docs state none (developers.openai.com/codex/plugins), so user only, unverified.
export function packScopes(pack, a) {
  if (!pack.plugins) return ['claude', 'codex'].includes(a) ? { scopes: PACK_SCOPES, fixed: null } : { scopes: ['projects'], fixed: 'BenchKeeper copies skills into the global folders of Claude Code and Codex only' };
  if (!pack.plugins[a]) return null;
  if (a === 'codex') return { scopes: ['global'], fixed: 'Codex installs plugins for the user only (codex plugin add has no scope option; other scopes unverified)' };
  return { scopes: PACK_SCOPES, fixed: null };
}

function validate(pack, lib) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(pack.id ?? '')) throw new Error('pack id: lowercase letters, digits and dashes');
  if (lib.packs.some((p) => p.id === pack.id)) throw new Error(`${pack.id} is a library pack`);
  if (typeof pack.title !== 'string' || !pack.title.trim() || pack.title.length > 80 || /[\r\n]/.test(pack.title)) throw new Error('pack title: one line of at most 80 characters');
  if (!Array.isArray(pack.skills) || !pack.skills.length) throw new Error('a pack needs skills');
  const unknown = pack.skills.filter((s) => !lib.skills.some((x) => x.name === s));
  if (unknown.length) throw new Error(`not in the library: ${unknown.join(', ')}`);
}

export function savePack(ctx, { id, title, skills }) {
  const pack = { kind: 'benchkeeper-pack', schemaVersion: PACK_SCHEMA, id, title: title || id, skills: [...new Set(skills)] };
  const lib = library();
  validate(pack, { ...lib, skills: [...lib.skills, ...userSkills(ctx, lib)] });
  const file = join(dir(ctx), `${id}.json`);
  // A pack saved or imported over an own pack of the same id keeps the old file in the backup.
  // Copied, not moved: a failed write leaves the old pack in place.
  if (existsSync(file)) {
    mkdirSync(join(ctx.config, 'backup', 'packs'), { recursive: true });
    copyFileSync(file, join(ctx.config, 'backup', 'packs', `${id}-${Date.now()}-${randomUUID().slice(0, 8)}.json`));
  }
  writeAtomic(file, `${JSON.stringify(pack, null, 2)}\n`);
  return pack;
}

// id of an own pack, or the file name of an invalid pack file (taken from the listing, never joined from the argument).
// usedBy: the projects whose setup still names the pack; it stays until they switch it off.
export function removePack(ctx, id, { usedBy = [] } = {}) {
  if (usedBy.length) throw new Error(`pack ${id} is in use by ${usedBy.join(', ')}: switch it off there first (benchkeeper packs disable ${id} --project <dir>)`);
  const { packs, invalid } = scan(ctx);
  const file = invalid.find((x) => x.file === id || x.file === `${id}.json`)?.file ?? (packs.some((p) => p.id === id) ? `${id}.json` : null);
  if (!file) throw new Error(`no own pack ${id}`);
  move(join(dir(ctx), file), join(ctx.config, 'backup', 'packs', `${file.replace(/\.json$/, '')}-${Date.now()}.json`));
}

// One file per pack; library presets export too, under a new id when imported.
export function exportPack(ctx, id) {
  const p = libraryWith(ctx).packs.find((x) => x.id === id);
  if (!p) throw new Error(`unknown pack ${id}`);
  if (!p.skills?.length) throw new Error(`${id} installs a plugin, not library skills`);
  const mine = userSkills(ctx).filter((s) => p.skills.includes(s.name)).map((s) => s.name);
  if (mine.length) throw new Error(`${id} names your own skills (${mine.join(', ')}): a pack file carries library skills only, so this pack stays on this machine`);
  return `${JSON.stringify({ kind: 'benchkeeper-pack', schemaVersion: PACK_SCHEMA, id: p.id, title: p.title, skills: p.skills }, null, 2)}\n`;
}

export function importPack(ctx, text, id) {
  let pack;
  try { pack = JSON.parse(text); } catch (e) { throw new Error(`pack file: ${e.message}`); }
  if (pack?.kind !== 'benchkeeper-pack') throw new Error('not a BenchKeeper pack file');
  if (pack.schemaVersion !== PACK_SCHEMA) throw new Error(`pack schemaVersion ${pack.schemaVersion}, this app reads ${PACK_SCHEMA}`);
  return savePack(ctx, { id: id ?? pack.id, title: pack.title, skills: pack.skills });
}

const STOP = new Set(['the', 'a', 'an', 'or', 'and', 'of', 'to', 'in', 'for', 'with', 'has', 'adds', 'repository', 'project', 'uses', 'its', 'is', 'on']);
const words = (t = '') => new Set(t.toLowerCase().match(/[a-z]+/g)?.filter((w) => w.length > 2 && !STOP.has(w)) ?? []);

// Whether two "pick when" texts share most words, so an agent may load the wrong skill.
export function overlap(textA, textB) {
  const a = words(textA), b = words(textB);
  const shared = [...a].filter((w) => b.has(w)).length;
  return shared > 0 && shared / Math.min(a.size, b.size) >= 0.5;
}

// Warnings for a project's skill list: pairs whose "pick when" texts overlap.
export function warnings(names, lib = library()) {
  const out = [];
  const skills = lib.skills.filter((s) => names.includes(s.name));
  for (let i = 0; i < skills.length; i++) {
    for (let j = i + 1; j < skills.length; j++) {
      if (overlap(skills[i].pickWhen, skills[j].pickWhen)) out.push(`${skills[i].name} and ${skills[j].name} have overlapping descriptions`);
    }
  }
  return out;
}
