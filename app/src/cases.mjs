// Eval cases: an observed miss becomes a regression case for a skill or rule. The app's sets ship in
// <content>/evals/, the user's own go to ~/.config/benchkeeper/evals/; benchkeeper evals reads both.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { registry, skillDirs } from './agents.mjs';
import { contentDir } from './content.mjs';
import { exists, readText } from './fsx.mjs';
import { mask } from './redact.mjs';
import { apply, preview } from './runner.mjs';

const CASE_SCHEMA = 1;
// A skill that is not in the library is addressed by its scope: skill:<name>@user, or skill:<name>@project-<id of the project folder>.
const NAME = '[a-z0-9][a-z0-9-]*';
const PLAIN = new RegExp(`^(skill|rule):${NAME}$`);
const TARGET = new RegExp(`^(rule:${NAME}|skill:${NAME}(@user|@project-[0-9a-f]{8})?)$`);
const fileName = (target) => `${target.replace(':', '-')}.json`;
export const userEvals = (ctx) => join(ctx.config, 'evals');
const shippedEvals = join(contentDir, 'evals');

const projectId = (dir) => createHash('sha256').update(dir).digest('hex').slice(0, 8);
export const scopeOf = (target) => ({ user: 'user', project: 'project' })[target.split('@')[1]?.split('-')[0]] ?? 'library';
const libraryDirs = (name) => [join(contentDir, 'skills', name), join(contentDir, 'library', name)];
export const inLibrary = (name) => libraryDirs(name).some((d) => exists(d));
// The first agent folder of the project or the user that holds the skill. A skill installed by link (the skills CLI) is read where it lives:
// a hash of the link would not change with the text, and a copy of the link would not resolve in the scratch repository.
const ownDir = (ctx, name, scope, project) => {
  const dir = skillDirs(registry.map((a) => a.id), scope === 'user' ? 'global' : 'project', scope === 'user' ? ctx.home : project)
    .map((x) => join(x.dir, name)).find((d) => existsSync(join(d, 'SKILL.md'))); // a dangling link is no skill text
  return dir && realpathSync(dir);
};

// Where a skill target's text lives. copy: the scratch repository needs it (plugin skills come from the agent's global setup).
export function skillSource(ctx, target, project) {
  const name = target.slice('skill:'.length).split('@')[0];
  const scope = scopeOf(target);
  if (scope === 'library') { const dir = libraryDirs(name).find((d) => exists(d)); return dir && { dir, copy: dir === libraryDirs(name)[1] }; }
  const dir = ownDir(ctx, name, scope, project);
  return dir && { dir, copy: true };
}

// The target a case is stored under: the library skill of that name unless a scope is named; otherwise the project's or the user's own skill.
// Neither found and no scope named: the name as before (a case for a skill that is installed later).
function scoped(ctx, target, { scope, project }) {
  if (scope != null && !['project', 'user'].includes(scope)) throw new Error('scope: project or user');
  if (!target.startsWith('skill:')) { if (scope) throw new Error('scope: only skills have one'); return { target }; }
  const name = target.slice('skill:'.length);
  const dir = project && resolve(project);
  if (!scope && inLibrary(name)) return { target };
  if (scope !== 'user' && dir && ownDir(ctx, name, 'project', dir)) return { target: `${target}@project-${projectId(dir)}`, project: dir };
  if (scope === 'project') throw new Error(`no project skill ${name}${dir ? ` in ${dir}` : ': name the folder with --project'}`);
  if (ownDir(ctx, name, 'user')) return { target: `${target}@user` };
  if (scope) throw new Error(`no user skill ${name}`);
  return { target };
}

function readSet(path) {
  const text = readText(path);
  if (text == null) return null;
  const set = JSON.parse(text);
  if (set.kind !== 'benchkeeper-evals' || set.schemaVersion !== CASE_SCHEMA) throw new Error(`${path}: not a schemaVersion ${CASE_SCHEMA} eval set`);
  // Target and case ids become folder and file names in a run.
  const own = typeof set.target === 'string' && scopeOf(set.target) === 'project';
  if (typeof set.target !== 'string' || !TARGET.test(set.target) || (own && !(typeof set.project === 'string' && isAbsolute(set.project) && set.target.endsWith(`-${projectId(set.project)}`))) || (!own && set.project != null) || !Array.isArray(set.cases) || !set.cases.every((c) => typeof c?.id === 'string' && /^[\w-]+$/.test(c.id))) throw new Error(`${path}: a target or case id with characters outside letters, digits, dash and underscore`);
  return set;
}

// { target: [cases] } from both places.
export function loadCases(ctx) {
  const all = {};
  for (const dir of [shippedEvals, userEvals(ctx)]) {
    let files = [];
    try { files = readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { continue; }
    for (const f of files) {
      const set = readSet(join(dir, f));
      (all[set.target] ??= []).push(...set.cases.map((c) => ({ ...c, file: join(dir, f), ...(set.project && { project: set.project }) })));
    }
  }
  return all;
}

// The first user prompt of a Claude Code or Codex transcript (JSON lines).
export function firstPrompt(path) {
  for (const line of (readText(path) ?? '').split('\n')) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type === 'user' && typeof e.message?.content === 'string') return e.message.content;
    if (e.type === 'user' && Array.isArray(e.message?.content)) { const t = e.message.content.find((c) => c.type === 'text')?.text; if (t) return t; }
    const p = e.payload;
    if (e.type === 'response_item' && p?.type === 'message' && p.role === 'user') { const t = p.content?.find((c) => c.type === 'input_text')?.text; if (t && !t.startsWith('<')) return t; }
  }
  return null;
}

// Adds a case through the step engine, so the ledger links it to the project and run and undo removes it.
export function addCase(ctx, { target: asked, scope, expected, should = true, project, transcript, description, query, run }) {
  if (!PLAIN.test(asked ?? '')) throw new Error('target: skill:<name> or rule:<name>');
  const { target, project: own } = scoped(ctx, asked, { scope, project });
  if (!expected) throw new Error('expected: the behavior that should or should not happen');
  const text = query ?? (transcript && firstPrompt(transcript)) ?? description;
  if (!text) throw new Error('a query, a transcript with a user prompt, or a description is needed');
  // The query is the agent's last argument: one that starts with - would be read as an option.
  if (text.startsWith('-')) throw new Error('the query starts with a dash: an agent CLI would read it as an option; reword it');
  // A prompt copied from a transcript may hold a pasted token.
  const q = mask(text, { keys: false });
  const c = { id: `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`, time: new Date().toISOString(), query: q, should, expected,
    source: Object.fromEntries(Object.entries({ project, transcript, description: description && mask(description, { keys: false }), run }).filter(([, v]) => v)) };
  const path = join(userEvals(ctx), fileName(target));
  const change = { id: 'case:0', step: 'case', title: `eval case for ${target}: ${should ? 'should' : 'should not'} ${expected}`, kind: 'write', path,
    edit: (t) => { const set = t ? JSON.parse(t) : { kind: 'benchkeeper-evals', schemaVersion: CASE_SCHEMA, target, ...(own && { project: own }), cases: [] }; set.cases.push(c); return `${JSON.stringify(set, null, 2)}\n`; } };
  const [planned] = preview([change]);
  if (planned.error) throw new Error(`${path}: ${planned.error}`);
  const r = apply([planned], ctx, { scope: 'global', note: { case: c.id, target, ...(project ? { project } : {}), ...(run ? { run } : {}) } });
  if (r.status !== 'done') throw new Error(r.entries[0]?.error ?? 'case not written');
  return { case: c, run: r.id, path, target };
}
