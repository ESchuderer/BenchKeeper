// Presets: the start of a new project. A preset is the setup answers of a project (agents, environment, packs, single skills,
// tier and the rest a profile keeps), saved under a name in ~/.config/benchkeeper/presets/<id>.json. A pack is a set of skills
// switched on in a project; a preset names packs and starts a project with them.
import { basename, dirname, join, sep } from 'node:path';
import { exists, isDir, listDir, move, readText, writeAtomic } from './fsx.mjs';
import { libraryWith, overlap } from './packs.mjs';
import { planAnswers, savedAnswers } from './profile.mjs';
import { canon, listProjects } from './projects.mjs';
import { preview } from './runner.mjs';
import { skillFiles } from './skills.mjs';
import { installedPlugins } from './steps/global.mjs';
import { projectCtx, projectPlan, readState, tryState } from './steps/project.mjs';

const PRESET_SCHEMA = 1;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const dir = (ctx) => join(ctx.config, 'presets');
const lookup = (message) => Object.assign(new Error(message), { status: 404 });

const list = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
// The answers the list and the form read: agents, and packs and single skills when present, as lists of names.
const valid = (a) => list(a?.agents) && a.agents.length > 0 && ['packs', 'singles'].every((k) => a[k] === undefined || list(a[k]));

// A file that is not a preset of this schema, named like its id, is left out.
export const listPresets = (ctx) => listDir(dir(ctx)).flatMap((file) => {
  try {
    const p = JSON.parse(readText(join(dir(ctx), file)));
    return p.kind === 'benchkeeper-preset' && p.schemaVersion === PRESET_SCHEMA && file === `${p.id}.json` && ID.test(p.id) && valid(p.answers) ? [p] : [];
  } catch { return []; }
});

// The presets whose single picks name the skill, for the refusal of skills delete.
export const presetsWith = (ctx, name) => listPresets(ctx).filter((p) => p.answers.singles?.includes(name)).map((p) => `preset ${p.id}`);

function preset(ctx, id) {
  const p = listPresets(ctx).find((x) => x.id === id);
  if (!p) throw lookup(`unknown preset ${id}, see benchkeeper presets list`);
  return p;
}

// The answers of a project with a setup, under a new name; an existing preset is not replaced.
export function savePreset(ctx, id, from) {
  if (!ID.test(id ?? '')) throw new Error('preset id: lowercase letters, digits and dashes');
  // Also a file that is not a valid preset stays: it may be one to repair.
  if (exists(join(dir(ctx), `${id}.json`))) throw new Error(`preset ${id} exists (also a file that is not a valid preset): remove it first (benchkeeper presets remove ${id})`);
  const state = readState(from);
  if (!state) throw new Error(`${from} has no setup yet: benchkeeper projects apply --agents a,b`);
  const p = { kind: 'benchkeeper-preset', schemaVersion: PRESET_SCHEMA, id, title: id, answers: savedAnswers(state) };
  writeAtomic(join(dir(ctx), `${id}.json`), `${JSON.stringify(p, null, 2)}\n`);
  return p;
}

// Also a file of the id that is not a valid preset, so it can be cleared away.
export function removePreset(ctx, id) {
  if (!ID.test(id ?? '') || !exists(join(dir(ctx), `${id}.json`))) throw lookup(`unknown preset ${id}, see benchkeeper presets list`);
  move(join(dir(ctx), `${id}.json`), join(ctx.config, 'backup', 'presets', `${id}-${Date.now()}.json`));
}

// The setup plan of a new folder from a preset. Refused for a folder that exists (projects apply sets up an existing one),
// a missing parent folder, and a folder inside a registered project. No git init: a later projects apply in the repository
// adds the git exclude list.
export function createPlan(ctx, path, id) {
  const p = preset(ctx, id);
  if (exists(path)) throw new Error(`${path} exists already: a preset starts a new folder; set up an existing one with benchkeeper projects apply`);
  if (!isDir(dirname(path))) throw new Error(`the parent folder ${dirname(path)} does not exist`);
  const target = join(canon(dirname(path)), basename(path));
  const inside = listProjects(ctx).find((x) => target.startsWith(x.path + sep));
  if (inside) throw new Error(`${target} is inside the registered project ${inside.path}`);
  const pctx = projectCtx(ctx, target);
  const { changes, skills, warnings } = projectPlan({ ctx: pctx, dir: target, answers: planAnswers(p.answers), plugins: installedPlugins(ctx) });
  return { dir: target, pctx, plan: preview(changes), skills, warnings };
}

// The check after creation: skills to turn off (also installed for all projects, or a description that overlaps another of
// the project's) and packs to add (on in at least half of the other registered projects that share an agent, two at least).
// The plan of all of them comes with no change selected.
export function recommend(ctx, path) {
  const state = readState(path), lib = libraryWith(ctx);
  const names = [...new Set(skillFiles(path).map((s) => s.name))].filter((n) => !state.disabled?.includes(n));
  const items = [];
  const global = skillFiles(ctx.home);
  for (const n of names) {
    const g = global.find((s) => s.name === n);
    if (g) items.push({ action: 'remove', kind: 'skill', name: n, reason: `also installed for all projects in ${dirname(g.file)}` });
  }
  const known = lib.skills.filter((s) => names.includes(s.name));
  for (const [i, b] of known.entries()) {
    const a = known.slice(0, i).find((x) => overlap(x.pickWhen, b.pickWhen) && !items.some((r) => r.name === x.name));
    if (a && !items.some((r) => r.name === b.name)) items.push({ action: 'remove', kind: 'skill', name: b.name, reason: `its description overlaps ${a.name}, so an agent may load the wrong one` });
  }
  const others = listProjects(ctx).filter((x) => x.path !== path).map((x) => tryState(x.path)).filter((s) => s?.agents?.some((a) => state.agents.includes(a)));
  if (others.length >= 2) {
    for (const pack of lib.packs.filter((x) => !state.packs.includes(x.id))) {
      const n = others.filter((s) => s.packs?.includes(pack.id)).length;
      if (n * 2 >= others.length) items.push({ action: 'add', kind: 'pack', name: pack.id, reason: `on in ${n} of ${others.length} registered projects with the same agents` });
    }
  }
  const pctx = projectCtx(ctx, path);
  const answers = { packOn: items.filter((r) => r.kind === 'pack').map((r) => r.name), disable: items.filter((r) => r.kind === 'skill').map((r) => r.name) };
  const plan = items.length ? preview(projectPlan({ ctx: pctx, dir: path, answers, plugins: installedPlugins(ctx) }).changes).map((c) => ({ ...c, selected: false })) : [];
  return { items, pctx, plan };
}
