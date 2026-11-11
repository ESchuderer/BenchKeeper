// The orchestrator policy as validated JSON. The check is the coordinator's own, policy.mjs beside its schema in
// <content>/skills/orchestrating-projects/, so the editor refuses exactly the files the coordinator's reader refuses. The loader
// returns the parsed document untouched, so "//" comment keys survive a round trip; it reads no step order, the coordinating session decides that.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { contentDir } from './content.mjs';
import { readText } from './fsx.mjs';

export const FILES = { policy: ['docs/agents/orchestration.json'] };
// Every rule an error can name; the tests keep one invalid fixture for each.
export const RULES = ['bad-json', 'not-object', 'type', 'length', 'range', 'enum', 'pattern', 'unknown-key', 'missing-key'];
// Imported when the module loads: the content lies in the package (content/) or in the clone (plugins/benchkeeper/), so no static path names it.
// A stale content folder without the reader must not keep the app from starting: only the editor then fails, and says why.
const reader = await import(pathToFileURL(join(contentDir, 'skills/orchestrating-projects/policy.mjs')).href).catch(() => ({}));
const VALIDATE = { policy: reader.validate };

// text: the file's content, null when it does not exist. Returns the document as parsed and the errors; no input is changed.
export function load(family, text) {
  if (text == null) return { doc: null, errors: [] };
  let doc;
  try { doc = JSON.parse(text); } catch { return { doc: null, errors: [{ rule: 'bad-json', path: '', message: 'is not valid JSON' }] }; }
  if (typeof VALIDATE[family] !== 'function') throw new Error(`the content in ${contentDir} has no policy reader: update it`);
  return { doc, errors: VALIDATE[family](doc) };
}
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
  if (errors.length) throw new Error(`${file}: ${errors.map((e) => `${e.rule}${e.path ? ` at ${e.path}` : ''}: ${e.message}`).join('; ')}`);
  return [{ id: `params:${file}`, step: 'params', title: `write ${file}`, kind: 'write', path: join(dir, file), after: text }];
}
