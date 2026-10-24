// Eval cases: an observed miss becomes a regression case for a skill or rule. The app's sets ship in
// <content>/evals/, the user's own go to ~/.config/benchkeeper/evals/; benchkeeper eval reads both.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { contentDir } from './content.mjs';
import { readText } from './fsx.mjs';
import { apply, preview } from './runner.mjs';

export const CASE_SCHEMA = 1;
const TARGET = /^(skill|rule):[a-z0-9][a-z0-9-]*$/;
const fileName = (target) => `${target.replace(':', '-')}.json`;
export const userEvals = (ctx) => join(ctx.config, 'evals');
export const shippedEvals = join(contentDir, 'evals');

function readSet(path) {
  const text = readText(path);
  if (text == null) return null;
  const set = JSON.parse(text);
  if (set.kind !== 'benchkeeper-evals' || set.schemaVersion !== CASE_SCHEMA) throw new Error(`${path}: not a schemaVersion ${CASE_SCHEMA} eval set`);
  // Target and case ids become folder and file names in a run.
  if (!TARGET.test(set.target) || !Array.isArray(set.cases) || !set.cases.every((c) => /^[\w-]+$/.test(c.id))) throw new Error(`${path}: a target or case id with characters outside letters, digits, dash and underscore`);
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
      (all[set.target] ??= []).push(...set.cases.map((c) => ({ ...c, file: join(dir, f) })));
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
export function addCase(ctx, { target, expected, should = true, project, transcript, description, query, run }) {
  if (!TARGET.test(target ?? '')) throw new Error('target: skill:<name> or rule:<name>');
  if (!expected) throw new Error('expected: the behavior that should or should not happen');
  const q = query ?? (transcript && firstPrompt(transcript)) ?? description;
  if (!q) throw new Error('a query, a transcript with a user prompt, or a description is needed');
  const c = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, time: new Date().toISOString(), query: q, should, expected,
    source: Object.fromEntries(Object.entries({ project, transcript, description, run }).filter(([, v]) => v)) };
  const path = join(userEvals(ctx), fileName(target));
  const change = { id: 'case:0', step: 'case', title: `eval case for ${target}: ${should ? 'should' : 'should not'} ${expected}`, kind: 'write', path,
    edit: (t) => { const set = t ? JSON.parse(t) : { kind: 'benchkeeper-evals', schemaVersion: CASE_SCHEMA, target, cases: [] }; set.cases.push(c); return `${JSON.stringify(set, null, 2)}\n`; } };
  const [planned] = preview([change]);
  if (planned.error) throw new Error(`${path}: ${planned.error}`);
  const r = apply([planned], ctx, { scope: 'global', note: { case: c.id, target, ...(project ? { project } : {}), ...(run ? { run } : {}) } });
  if (r.status !== 'done') throw new Error(r.entries[0]?.error ?? 'case not written');
  return { case: c, run: r.id, path };
}
