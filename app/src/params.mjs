// The orchestrator policy as validated JSON, checked by the coordinator's own reader (policy.mjs in the content), so the editor refuses exactly the files the reader refuses; the document is returned as parsed, so "//" comment keys survive a round trip.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { contentDir } from './content.mjs';
import { readText } from './fsx.mjs';

export const FILES = { policy: ['docs/agents/orchestration.json'] };
// No static path names the content (content/ in the package, plugins/benchkeeper/ in a clone); a content folder whose reader does not load must not keep the app from starting, so only the editor fails, with the reason.
const reader = await import(pathToFileURL(join(contentDir, 'skills/orchestrating-projects/policy.mjs')).href).catch((e) => ({ failed: e.message.split('\n')[0] }));
const VALIDATE = { policy: reader.validate };

// text: the file's content, null when it does not exist. Returns the document as parsed and the errors; no input is changed.
export function load(family, text) {
  if (text == null) return { doc: null, errors: [] };
  let doc;
  try { doc = JSON.parse(text); } catch { return { doc: null, errors: [{ rule: 'bad-json', path: '', message: 'is not valid JSON' }] }; }
  if (typeof VALIDATE[family] !== 'function') throw new Error(`the content in ${contentDir} has no usable policy reader (${reader.failed ?? 'policy.mjs exports no validate'}): update it`);
  return { doc, errors: VALIDATE[family](doc) };
}
// A policy text as the coordinator's reader judges it: with version (the content version of the plugin that will read it), also
// the minPlugin rule, through the reader's effective(); without, the schema alone. Reads nothing else and fetches nothing.
export function policyCheck(text, version) {
  const r = load('policy', text);
  return r.errors.length || r.doc == null || !version ? r : { doc: r.doc, errors: reader.effective(r.doc, version).errors };
}
export const errorLine = (e) => `${e.rule}${e.path ? ` at ${e.path}` : ''}: ${e.message}`;
// The one way a document is written back: two-space indent, key order as read.
export const format = (doc) => `${JSON.stringify(doc, null, 2)}\n`;

// The editor view: every file of every family with its text (null: absent) and errors.
export const paramsView = (dir) => Object.entries(FILES).flatMap(([family, files]) => files.map((file) => {
  const text = readText(join(dir, file));
  return { family, file, text, errors: load(family, text).errors };
}));
// The loader's errors for a text typed into the editor.
export function checkText(file, text) {
  const family = Object.keys(FILES).find((f) => FILES[f].includes(file));
  if (!family) throw new Error(`file must be one of ${Object.values(FILES).flat().join(', ')}`);
  if (typeof text !== 'string') throw new Error('text must be a string');
  return load(family, text).errors;
}
// A plan that writes the text as typed, so "//" comment keys stay; refused while the loader finds an error. A whole-file
// write (after, not edit): the apply refuses it when the file changed after the plan.
export function paramsChange(dir, file, text) {
  const errors = checkText(file, text);
  if (errors.length) throw new Error(`${file}: ${errors.map(errorLine).join('; ')}`);
  return [{ id: `params:${file}`, step: 'params', title: `write ${file}`, kind: 'write', path: join(dir, file), after: text }];
}
