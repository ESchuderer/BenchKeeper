// Packs: the library's presets plus the user's own, saved in ~/.config/benchkeeper/packs/<id>.json.
// A pack file names library skills only, so an imported pack cannot bring a source or ref the library does not pin.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { library } from './content.mjs';
import { move, readText, writeAtomic } from './fsx.mjs';
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

// The library with the user's packs added to its presets.
export function libraryWith(ctx) {
  const lib = library();
  return { ...lib, packs: [...lib.packs, ...ownPacks(ctx)] };
}

// Install scope per pack: global (installed once on the machine, for every project) or projects (in each project whose setup
// selects the pack). Only a scope the user chose is stored; a pack without one keeps the scope its installs have: plugin packs
// global, skill packs per project. ctx.packScopes (pack id to scope) stands in for the file in the preview of a scope change.
export const PACK_SCOPES = ['global', 'projects'];
export const scopeFile = (ctx) => join(ctx.config, 'pack-scopes.json');
export function packScope(ctx, pack) {
  let stored = ctx.packScopes?.[pack.id];
  if (!stored) try { stored = JSON.parse(readText(scopeFile(ctx)) ?? '{}').scopes?.[pack.id]; } catch { /* a damaged file reads as the defaults */ }
  return PACK_SCOPES.includes(stored) ? stored : pack.plugins ? 'global' : 'projects';
}
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
  validate(pack, library());
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
