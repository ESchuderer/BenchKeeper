// Packs: the library's presets plus the user's own, saved in ~/.config/benchkeeper/packs/<id>.json.
// A pack file names library skills only, so an imported pack cannot bring a source or ref the library does not pin.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { library } from './content.mjs';
import { move, writeAtomic } from './fsx.mjs';

export const PACK_SCHEMA = 1;
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

function validate(pack, lib) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(pack.id ?? '')) throw new Error('pack id: lowercase letters, digits and dashes');
  if (lib.packs.some((p) => p.id === pack.id)) throw new Error(`${pack.id} is a library pack`);
  if (!Array.isArray(pack.skills) || !pack.skills.length) throw new Error('a pack needs skills');
  const unknown = pack.skills.filter((s) => !lib.skills.some((x) => x.name === s));
  if (unknown.length) throw new Error(`not in the library: ${unknown.join(', ')}`);
}

export function savePack(ctx, { id, title = id, skills }) {
  const pack = { kind: 'benchkeeper-pack', schemaVersion: PACK_SCHEMA, id, title, skills: [...new Set(skills)] };
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
export function removePack(ctx, id) {
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
