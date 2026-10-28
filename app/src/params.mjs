// Parameter files as validated JSON: pins (who runs a phase), presets (tier and change type) and the orchestrator
// policy. Schemas ship in <content>/schemas/. The loader returns the parsed document untouched, so unknown keys and
// "//" comment keys survive a round trip; it reads no step order, the coordinating session decides that.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registry } from './agents.mjs';
import { contentDir } from './content.mjs';
import { exists, readText } from './fsx.mjs';

// Team file first, personal file last: the personal one wins per phase.
export const FILES = { pins: ['.benchkeeper/pins.json', '.benchkeeper/pins.local.json'], preset: ['.benchkeeper/preset.json'], policy: ['docs/agents/orchestration.json'] };
const SCHEMA_FILE = { pins: 'pins', preset: 'preset', policy: 'orchestration' };
export const PHASES = ['research', 'implement', 'review', 'verify'];
// Every rule an error can name; the tests keep one invalid fixture for each.
// loadFiles adds 'unreadable' for a file that exists but cannot be read; it has no document, so no fixture.
export const RULES = ['bad-json', 'not-object', 'schema-version', 'required', 'type', 'enum', 'length', 'pattern', 'range', 'unique', 'unknown-key', 'unknown-agent', 'effort-without-model', 'duplicate-preset'];

const schemas = {};
const schemaOf = (family) => (schemas[family] ??= JSON.parse(readFileSync(join(contentDir, 'schemas', `${SCHEMA_FILE[family]}.schema.json`), 'utf8')));
export const SCHEMA_VERSION = (family) => schemaOf(family).properties.schemaVersion.const;

const kind = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const isComment = (k) => k.startsWith('//');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The JSON Schema keywords the shipped schemas use, nothing more. Each error names the rule it breaks.
function check(s, v, path, root, out) {
  if (s.$ref) s = s.$ref.slice(2).split('/').reduce((n, k) => n[k], root);
  const fail = (rule, message) => out.push({ rule, path, message });
  // const is only used by schemaVersion.
  if ('const' in s && !same(s.const, v)) return fail('schema-version', `must be ${JSON.stringify(s.const)}`);
  if (s.enum && !s.enum.some((e) => same(e, v))) return fail('enum', `must be one of ${s.enum.join(', ')}`);
  const want = s.type;
  if (want && kind(v) !== want && !(want === 'number' && kind(v) === 'integer')) return fail('type', `must be ${want}, not ${kind(v)}`);
  if (typeof v === 'string') {
    if (s.minLength && v.length < s.minLength) fail('length', `must have at least ${s.minLength} characters`);
    if (s.pattern && !new RegExp(s.pattern).test(v)) fail('pattern', `"${v.slice(0, 40)}" does not match ${s.pattern}`);
  }
  if (typeof v === 'number') {
    if (s.minimum != null && v < s.minimum) fail('range', `must be at least ${s.minimum}`);
    if (s.maximum != null && v > s.maximum) fail('range', `must be at most ${s.maximum}`);
  }
  if (Array.isArray(v)) {
    if (s.uniqueItems && new Set(v.map((x) => JSON.stringify(x))).size !== v.length) fail('unique', 'must not repeat an item');
    if (s.items) v.forEach((x, i) => check(s.items, x, `${path}[${i}]`, root, out));
  } else if (kind(v) === 'object') {
    const at = (k) => (path ? `${path}.${k}` : k);
    for (const k of s.required ?? []) if (!(k in v)) out.push({ rule: 'required', path: at(k), message: 'is required' });
    for (const [k, sub] of Object.entries(s.properties ?? {})) if (k in v) check(sub, v[k], at(k), root, out);
    if (s.additionalProperties === false) for (const k of Object.keys(v)) if (!isComment(k) && !(k in (s.properties ?? {}))) out.push({ rule: 'unknown-key', path: at(k), message: `is not one of ${Object.keys(s.properties).join(', ')}` });
  }
}

// Rules a schema cannot hold: they need the agent registry or compare entries.
function extra(family, doc, errors) {
  if (family === 'pins') {
    for (const phase of PHASES) {
      const p = doc.phases?.[phase];
      if (!p || typeof p !== 'object') continue;
      if (p.agent && p.agent !== 'default' && !registry.some((a) => a.id === p.agent)) errors.push({ rule: 'unknown-agent', path: `phases.${phase}.agent`, message: `${p.agent} is not one of ${registry.map((a) => a.id).join(', ')}` });
      if (p.effort && p.effort !== 'default' && (!p.model || p.model === 'default')) errors.push({ rule: 'effort-without-model', path: `phases.${phase}.effort`, message: 'an effort needs a model' });
    }
  }
  if (family === 'preset' && Array.isArray(doc.presets)) {
    const seen = new Set();
    for (const [i, p] of doc.presets.entries()) {
      if (!p || typeof p !== 'object') continue;
      const key = `${p.tier}/${p.changeType ?? ''}`;
      if (seen.has(key)) errors.push({ rule: 'duplicate-preset', path: `presets[${i}]`, message: `tier ${p.tier}${p.changeType ? ` with change type ${p.changeType}` : ''} is already set` });
      seen.add(key);
    }
  }
}

// text: the file's content, null when it does not exist. Returns the document as parsed and the errors; no input is changed.
export function load(family, text) {
  if (text == null) return { doc: null, errors: [] };
  let doc;
  try { doc = JSON.parse(text); } catch { return { doc: null, errors: [{ rule: 'bad-json', path: '', message: 'is not valid JSON' }] }; }
  if (kind(doc) !== 'object') return { doc, errors: [{ rule: 'not-object', path: '', message: 'must be a JSON object' }] };
  const errors = [];
  check(schemaOf(family), doc, '', schemaOf(family), errors);
  extra(family, doc, errors);
  return { doc, errors };
}
// The one way a document is written back: two-space indent, key order as read.
export const format = (doc) => `${JSON.stringify(doc, null, 2)}\n`;

// Every existing file of a family in a project, with its errors tagged by file.
export function loadFiles(dir, family) {
  return FILES[family].flatMap((file) => {
    const text = readText(join(dir, file));
    // A missing file is absent; one that exists but cannot be read is an error, never a silent fallback to the session defaults.
    if (text == null) return exists(join(dir, file)) ? [{ file, doc: null, errors: [{ rule: 'unreadable', path: '', message: 'cannot be read', file }] }] : [];
    const { doc, errors } = load(family, text);
    return [{ file, doc, errors: errors.map((e) => ({ ...e, file })) }];
  });
}

// Each phase with the agent, model and effort to use and the file they came from. null: the flag is omitted
// ("default", or nothing pinned), so the session's own agent, model and effort apply. A later file replaces a
// phase of an earlier one as a whole: a team model is never paired with a personal agent.
export function resolvePins(dir) {
  const files = loadFiles(dir, 'pins');
  const errors = files.flatMap((f) => f.errors);
  const none = (v) => (v == null || v === 'default' ? null : v);
  const pins = PHASES.map((phase) => {
    const hit = files.filter((f) => f.doc?.phases?.[phase]).at(-1);
    const p = hit?.doc.phases[phase] ?? {};
    return { phase, agent: none(p.agent), model: none(p.model), effort: none(p.effort), source: hit?.file ?? 'session' };
  });
  return { pins, errors };
}

const issue = (level, check, message, fix) => ({ level, check, message, fix });

// Doctor findings. Nothing is reported for a project without these files. models: [{id, argv}] lists models for agents
// that can (registry field modelsCommand, an argv); an agent without it is not checked.
export function paramChecks(ctx, dir, reg = registry) {
  const out = [];
  for (const family of Object.keys(FILES)) {
    for (const f of loadFiles(dir, family)) for (const e of f.errors) out.push(issue('error', 'params', `${f.file}: ${e.rule}${e.path ? ` at ${e.path}` : ''}: ${e.message}`, `edit ${f.file} (schema: plugins/benchkeeper/schemas)`));
  }
  const { pins, errors } = resolvePins(dir);
  const local = FILES.pins[1];
  if (exists(join(dir, local)) && ctx.run(['git', '-C', dir, 'check-ignore', '-q', local]).code === 1) out.push(issue('warning', 'pins', `${local} is not ignored by git`, `add ${local} to .gitignore or .git/info/exclude`));
  if (errors.length) return out;
  for (const id of new Set(pins.map((p) => p.agent).filter(Boolean))) {
    const a = reg.find((x) => x.id === id);
    if (ctx.run([a.bin, '--version']).code !== 0) { out.push(issue('warning', 'pins', `a pin names ${id}, which is not installed`, `install ${a.name} or change the pin`)); continue; }
    if (!a.modelsCommand) continue;
    const listed = ctx.run(a.modelsCommand);
    if (listed.code !== 0) continue;
    const names = listed.stdout.split('\n').map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
    for (const p of pins.filter((x) => x.agent === id && x.model && !names.includes(x.model))) out.push(issue('warning', 'pins', `the ${p.phase} pin names model ${p.model}, which ${a.name} does not list`, `run ${a.modelsCommand.join(' ')} for the names it offers`));
  }
  return out;
}
