// The orchestrator policy as validated JSON. Its schema ships in <content>/schemas/. The loader returns the parsed
// document untouched, so unknown keys and "//" comment keys survive a round trip; it reads no step order, the
// coordinating session decides that.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contentDir } from './content.mjs';
import { readText } from './fsx.mjs';

export const FILES = { policy: ['docs/agents/orchestration.json'] };
const SCHEMA_FILE = { policy: 'orchestration' };
// Every rule an error can name; the tests keep one invalid fixture for each.
export const RULES = ['bad-json', 'not-object', 'schema-version', 'type', 'length', 'range'];

const schemas = {};
const schemaOf = (family) => (schemas[family] ??= JSON.parse(readFileSync(join(contentDir, 'schemas', `${SCHEMA_FILE[family]}.schema.json`), 'utf8')));
export const SCHEMA_VERSION = (family) => schemaOf(family).properties.schemaVersion.const;

const kind = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The JSON Schema keywords the shipped schema uses, nothing more. Each error names the rule it breaks.
function check(s, v, path, out) {
  const fail = (rule, message) => out.push({ rule, path, message });
  // const is only used by schemaVersion.
  if ('const' in s && !same(s.const, v)) return fail('schema-version', `must be ${JSON.stringify(s.const)}`);
  const want = s.type;
  if (want && kind(v) !== want && !(want === 'number' && kind(v) === 'integer')) return fail('type', `must be ${want}, not ${kind(v)}`);
  if (typeof v === 'string' && s.minLength && v.length < s.minLength) fail('length', `must have at least ${s.minLength} characters`);
  if (typeof v === 'number') {
    if (s.minimum != null && v < s.minimum) fail('range', `must be at least ${s.minimum}`);
    if (s.maximum != null && v > s.maximum) fail('range', `must be at most ${s.maximum}`);
  }
  if (Array.isArray(v)) v.forEach((x, i) => check(s.items, x, `${path}[${i}]`, out));
  else if (kind(v) === 'object') for (const [k, sub] of Object.entries(s.properties ?? {})) if (k in v) check(sub, v[k], path ? `${path}.${k}` : k, out);
}

// text: the file's content, null when it does not exist. Returns the document as parsed and the errors; no input is changed.
export function load(family, text) {
  if (text == null) return { doc: null, errors: [] };
  let doc;
  try { doc = JSON.parse(text); } catch { return { doc: null, errors: [{ rule: 'bad-json', path: '', message: 'is not valid JSON' }] }; }
  if (kind(doc) !== 'object') return { doc, errors: [{ rule: 'not-object', path: '', message: 'must be a JSON object' }] };
  const errors = [];
  check(schemaOf(family), doc, '', errors);
  return { doc, errors };
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
// A plan that writes the text as typed, so unknown and "//" keys stay; refused while the loader finds an error. A whole-file
// write (after, not edit): the apply refuses it when the file changed after the plan.
export function paramsChange(dir, file, text) {
  const errors = checkText(file, text);
  if (errors.length) throw new Error(`${file}: ${errors.map((e) => `${e.rule}${e.path ? ` at ${e.path}` : ''}: ${e.message}`).join('; ')}`);
  return [{ id: `params:${file}`, step: 'params', title: `write ${file}`, kind: 'write', path: join(dir, file), after: text }];
}
