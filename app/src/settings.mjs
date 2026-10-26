// Agent settings (Claude Code settings.json, Codex config.toml): read per layer, the effective value and where it comes
// from, notes on keys that cancel each other, and plans that edit one key at a time through the runner. The key list is
// src/settings/catalog.json, the rules between keys src/settings/couplings.json, the pinned schemas sit beside them.
// Never writes a managed layer. Values of secret-looking names are masked in everything this module returns.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { MergeError, mergeJson, removeTable, removeToml, setToml } from './merge.mjs';
import { exists, readText } from './fsx.mjs';
import { CLAUDE_KEYS } from './steps/global.mjs';

const load = (f) => JSON.parse(readFileSync(new URL(`./settings/${f}`, import.meta.url), 'utf8'));
const CATALOG = load('catalog.json').agents;
export const COUPLINGS = load('couplings.json');
const REFERENCE = load('claude-settings-keys.json');
const SCHEMAS = { claude: load('claude-code-settings.schema.json'), codex: load('codex-config.schema.json') };
export const settingsAgents = Object.keys(CATALOG);
export const agentSettings = (id) => CATALOG[id] ?? (() => { throw new Error(`no settings for agent ${id}: ${settingsAgents.join(', ')}`); })();

// Whole words of the name (split at case changes and separators), so includeCoAuthoredBy and MAX_THINKING_TOKENS stay visible.
const SECRET_WORD = /^(?:\w*key|\w*token|\w*secret|\w*password|passwd|credentials?|o?auth(?:orization)?|bearer|cookie|private)$/i;
export const isSecretName = (name) => String(name).replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).some((w) => SECRET_WORD.test(w));
const MASK = '(set)';
// A masked value must never come back as an edit: the placeholder would replace the stored secret.
const hasMask = (v) => (typeof v === 'string' ? v === MASK || v.includes(`"${MASK}"`) || v.includes(`:${MASK}@`) : v != null && typeof v === 'object' && Object.values(v).some(hasMask));

// Masks every value whose key name suggests a secret, at any depth.
export function maskSecrets(v, name = '') {
  if (isSecretName(name) && v != null) return MASK;
  if (typeof v === 'string') return redact(v);
  if (Array.isArray(v)) return v.map((x) => maskSecrets(x, name));
  if (v && typeof v === 'object' && !(v instanceof Date)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, maskSecrets(x, k)]));
  return v;
}

// A diff or text with the values of secret-looking names masked ("NAME": "x", NAME = "x", inline or on a line of its own).
const SECRET_PAIR = /("?)(?<![A-Za-z0-9_.-])([A-Za-z0-9_.-]+)\1(\s*[:=]\s*)("{3}(?:[^"\\]|\\.|"(?!""))*(?:"{3}|$)|'{3}(?:[^']|'(?!''))*(?:'{3}|$)|"(?:[^"\\]|\\.)*"|'[^']*'|(?:(?:Bearer|Basic)\s+)?[^\s,{[}\]][^\s,}\]]*)/gi;
// A value nested deeper than 32 pairs ("a=a=a=...") is masked whole instead of exhausting the stack.
// The password of a URL with user info ("scheme://user:password@host"); the user name stays.
const URL_PASSWORD = /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]*:\/\/[^\s/?#@:]*:)[^\s/?#@]+@/gi;
const redactAt = (text, depth) => text.replace(SECRET_PAIR, (_, q, name, sep, value) => `${q}${name}${q}${sep}${isSecretName(name) || depth >= 32 ? `"${MASK}"` : redactAt(value, depth + 1)}`);
export const redact = (text) => (text == null ? text : redactAt(text.replace(URL_PASSWORD, `$1${MASK}@`), 0));
// Only settings files carry such pairs: a rules file that mentions API_KEY = x stays as it is.
export const isSettingsFile = (path) => /(^|[\\/])(settings(\.local)?\.json|config\.toml|managed_config\.toml|\.claude\.json)$/.test(String(path));

// Which layers exist for an agent and where their files are. dir is a project folder; without it only user and managed.
export function layerFiles(ctx, agentId, dir) {
  const a = agentSettings(agentId);
  const files = [];
  for (const p of a.managed) files.push({ layer: 'managed', path: `${ctx.managedRoot ?? ''}${p}`, readOnly: true });
  for (const [layer, rel] of Object.entries(a.layers)) {
    if (layer === 'user') files.push({ layer, path: join(ctx.home, rel) });
    else if (dir) files.push({ layer, path: join(dir, rel) });
  }
  return files.filter((f, i, all) => all.findIndex((g) => g.layer === f.layer && g.path === f.path) === i);
}

const parseLayer = (agentId, text) => {
  if (agentId === 'codex') return parseToml(text);
  // Claude Code reads strict JSON: one stray comment or comma and it skips the whole file.
  return text.trim() ? JSON.parse(text) : {};
};

// Layers with their parsed content. A missing file is empty; one that does not parse has an error and no data.
export function readSettings(ctx, agentId, { dir } = {}) {
  return layerFiles(ctx, agentId, dir).map((f) => {
    const text = readText(f.path);
    if (text == null) return exists(f.path) ? { ...f, exists: true, data: {}, error: 'the file cannot be read' } : { ...f, exists: false, data: {} };
    try { return { ...f, exists: true, data: parseLayer(agentId, text) }; } catch (e) { return { ...f, exists: true, data: {}, error: e.message.split('\n')[0] }; }
  });
}

export const pathOf = (key) => key.split('.');
const dig = (data, path) => path.reduce((o, k) => (o != null && typeof o === 'object' ? o[k] : undefined), data);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Where each layer sets a key, highest precedence first; the first is the effective one.
export function valuesOf(layers, agentId, key) {
  const order = agentSettings(agentId).precedence;
  const path = agentId === 'codex' && key.startsWith('projects.') ? ['projects', key.slice(9)] : pathOf(key);
  return layers.filter((l) => !l.error).map((l) => ({ layer: l.layer, path: l.path, value: dig(l.data, path) })).filter((x) => x.value !== undefined)
    .sort((a, b) => order.indexOf(a.layer) - order.indexOf(b.layer));
}

// ---- key definitions: the catalog first, else the pinned schema, else the settings reference ----

// Follows $ref, and a lone allOf entry (how the Codex schema adds a description to a $ref), keeping the outer description.
const resolve = (schema, node) => {
  let description = node?.description;
  for (let i = 0; i < 20 && node; i++) {
    const next = node.$ref ? node.$ref.replace(/^#\//, '').split('/').reduce((o, k) => o?.[k], schema) : node.allOf?.length === 1 && !node.properties && !node.type ? node.allOf[0] : null;
    if (!next) break;
    node = next;
    description ??= node.description;
  }
  return node && description ? { ...node, description } : node;
};
// Types and enum values a schema node allows, through $ref, allOf, anyOf and oneOf.
const blank = () => ({ types: new Set(), values: null, description: null });
function collect(schema, node, out = blank(), depth = 0) {
  node = resolve(schema, node);
  if (!node || depth > 8) return out;
  for (const t of [node.type].flat().filter(Boolean)) out.types.add(t);
  if (node.enum) out.values = [...(out.values ?? []), ...node.enum];
  if (node.const !== undefined) out.values = [...(out.values ?? []), node.const];
  out.description ??= node.description ?? null;
  for (const sub of [...(node.allOf ?? []), ...(node.anyOf ?? []), ...(node.oneOf ?? [])]) collect(schema, sub, out, depth + 1);
  return out;
}
function schemaNode(agentId, path) {
  const schema = SCHEMAS[agentId];
  let node = schema;
  for (const seg of path) {
    node = resolve(schema, node);
    const next = node?.properties?.[seg] ?? (node?.additionalProperties && typeof node.additionalProperties === 'object' ? node.additionalProperties : null);
    if (!next) return null;
    node = next;
  }
  return node;
}

const SCOPE_NOTE = { 'Global config': 'lives in the .claude.json file of the home folder, which this editor does not touch', Managed: 'managed settings only: read-only here' };
const referenceRow = (key) => REFERENCE.find((r) => r.key === key);

// { key, type, values, ... } for a key, or null when neither the app nor a pinned schema nor the reference knows it.
export function describeKey(agentId, key) {
  const listed = agentSettings(agentId).settings.find((s) => s.key === key);
  if (listed) return listed;
  const path = agentId === 'codex' && key.startsWith('projects.') ? ['projects', key.slice(9)] : pathOf(key);
  const node = schemaNode(agentId, path);
  const row = agentId === 'claude' ? referenceRow(key) : null;
  if (!node && !row) return null;
  const c = node ? collect(SCHEMAS[agentId], node) : { types: new Set(), values: null, description: null };
  const types = [...c.types];
  const plain = types.length === 1 ? types[0] : null;
  const type = c.values && !types.some((t) => t !== 'string') ? 'enum' : plain === 'boolean' ? 'bool' : plain === 'integer' ? 'int' : plain === 'number' ? 'number' : plain === 'string' ? 'string' : types.length ? 'json' : 'any';
  return { key, type, values: c.values ?? undefined, types, sentence: row?.description ?? c.description ?? '', scope: row?.scope, group: row?.topic ?? 'Other', advanced: true, schema: !!node };
}

// ---- values: parse, validate ----

// Text typed by a person or the CLI to the value the key takes.
export function parseInput(def, text) {
  if (typeof text !== 'string') return text;
  const s = text.trim();
  if (def.type === 'bool') { if (!/^(true|false)$/i.test(s)) throw new Error(`${def.key} takes true or false`); return s.toLowerCase() === 'true'; }
  if (def.type === 'int' || def.type === 'number') { const n = Number(s); if (s === '' || Number.isNaN(n)) throw new Error(`${def.key} takes a number`); return n; }
  if (def.type === 'switch') return /^(set|on|1|true|yes)$/i.test(s) ? true : /^(0|false|off|no)$/i.test(s) ? false : s;
  if (def.type === 'enum' || def.type === 'string') return text;
  if (def.type === 'attribution' && /^(hidden|false)$/i.test(s)) return false;
  try { return JSON.parse(s); } catch { return text; }
}

const kind = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

// null when the value fits the key, else the reason. value undefined or null means removing the key.
export function validate(agentId, def, value, layer) {
  if (value == null) return null;
  const bad = (m) => `${def.key}: ${m}`;
  switch (def.type) {
    case 'switch':
      if (value !== true) return bad('an environment switch is set or removed, never 0 or false: use "set" or remove it');
      return null;
    case 'bool': return typeof value === 'boolean' ? null : bad('true or false');
    case 'int': return Number.isInteger(value) && value >= (def.min ?? -Infinity) ? null : bad(`a whole number${def.min != null ? ` of ${def.min} or more` : ''}`);
    case 'number': return typeof value === 'number' ? null : bad('a number');
    case 'string': return typeof value === 'string' && value ? null : bad('a non-empty text');
    case 'enum':
      if (typeof value === 'string' && ((def.values ?? []).includes(value) || (def.also && new RegExp(def.also).test(value)))) return null;
      return bad(`one of ${(def.values ?? []).join(', ')}${def.also ? ' or a custom one' : ''}`);
    case 'strings': return Array.isArray(value) && value.every((x) => typeof x === 'string') ? null : bad('a list of texts');
    case 'attribution': {
      if (value === false) return null;
      if (kind(value) !== 'object' || Object.keys(value).some((k) => !['commit', 'pr', 'sessionUrl'].includes(k))) return bad('false, or an object with commit, pr (texts) and sessionUrl (true or false)');
      if (['commit', 'pr'].some((k) => k in value && typeof value[k] !== 'string') || ('sessionUrl' in value && typeof value.sessionUrl !== 'boolean')) return bad('commit and pr are texts, sessionUrl is true or false');
      return null;
    }
    case 'object': return bad('edit it in the file; the app shows it only');
    default: {
      // From the pinned schema or the reference: the schema's types, else anything.
      if (def.advanced && (def.scope && SCOPE_NOTE[def.scope])) return bad(SCOPE_NOTE[def.scope]);
      if (def.advanced && def.scope === 'User or managed' && layer !== 'user') return bad('this key is taken from the user file only');
      if (def.advanced && def.scope === 'User, local, or managed' && layer === 'project') return bad('this key is not taken from the project file');
      if (def.values && !def.values.includes(value) && def.types?.every((t) => t === 'string')) return bad(`one of ${def.values.join(', ')}`);
      const ok = { string: 'string', boolean: 'boolean', integer: 'number', number: 'number', array: 'array', object: 'object' };
      if (def.types?.length && !def.types.some((t) => ok[t] === kind(value) && (t !== 'integer' || Number.isInteger(value)))) return bad(`a value of type ${def.types.join(' or ')}`);
      if (agentId === 'codex' && !isTomlValue(value)) return bad('a value the app writes into TOML only as a scalar or a list of scalars: edit tables by hand');
      return null;
    }
  }
}
const isScalar = (v) => ['string', 'boolean', 'number'].includes(typeof v);
const isTomlValue = (v) => isScalar(v) || (Array.isArray(v) && v.every(isScalar));

// ---- notes: the coupling rules ----

const SWITCHES = (agentId) => agentSettings(agentId).settings.filter((s) => s.type === 'switch');
const truthy = (v) => v === true || v === 1 || /^(1|true)$/i.test(String(v));

// The ids of advisor and main model, as the advisor page ranks them; null when either is not a full model ID.
const RANKS = COUPLINGS.advisorRanks.map((r) => r.split('|'));
const rankOf = (id) => {
  const m = String(id ?? '').match(/^claude-(haiku|sonnet|opus|fable)-(\d+)(?:-(\d+))?(?:-\d{8})?$/);
  if (!m) return null;
  const name = `${m[1]}-${m[2]}${m[3] ? `-${m[3]}` : ''}`;
  const i = RANKS.findIndex((r) => r.includes(name));
  return i < 0 ? null : i;
};

// state: { layers: [{ layer, data }], env } for the keys the rule reads. Each test looks in the layers it names, else in all.
function lookup(state, agentId, key, layers) {
  const order = agentSettings(agentId).precedence;
  const found = [...state.layers].sort((a, b) => order.indexOf(a.layer) - order.indexOf(b.layer)).filter((l) => !layers || layers.includes(l.layer)).map((l) => dig(l.data, pathOf(key))).filter((v) => v !== undefined);
  // The process environment counts for switches, whose names are known and never secrets.
  if (key.startsWith('env.') && (!layers || layers.includes('process')) && state.env?.[key.slice(4)] !== undefined) found.push(state.env[key.slice(4)]);
  return found;
}
function holds(c, state, agentId) {
  if (c.all) return c.all.every((x) => holds(x, state, agentId));
  if (c.any) return c.any.some((x) => holds(x, state, agentId));
  if (c.not) return !holds(c.not, state, agentId);
  if (c.op === 'advisorBelowMain') {
    const [advisor] = lookup(state, agentId, 'advisorModel'), [main] = lookup(state, agentId, 'model');
    const a = rankOf(advisor), m = rankOf(main);
    return a != null && m != null && a < m;
  }
  if (c.op === 'credentialReadsOpen') {
    // A deny in any layer wins. shortcut: the rule's text is matched, not its glob, and only a rule anchored at ~/ or // counts (./ is the project).
    const reads = lookup(state, agentId, 'permissions.deny').flat().filter((r) => typeof r === 'string').map((r) => r.match(/^Read\(((?:~|\/)\/[^)]*)\)$/)?.[1]).filter(Boolean);
    return COUPLINGS.credentialDirs.some((d) => !reads.some((r) => r.includes(d)));
  }
  if (c.op === 'effortDiffers') {
    const top = lookup(state, agentId, 'effortLevel', ['user'])[0], saved = lookup(state, agentId, 'modelSettings', ['user'])[0];
    return top !== undefined && Object.values(saved ?? {}).some((m) => m?.effortLevel !== undefined && m.effortLevel !== top);
  }
  if (c.keyPrefix) return state.layers.filter((l) => !c.layer || c.layer.includes(l.layer)).some((l) => Object.keys(dig(l.data, pathOf(c.keyPrefix.replace(/\.[^.]*$/, ''))) ?? {}).some((k) => `env.${k}`.startsWith(c.keyPrefix)));
  const values = lookup(state, agentId, c.key, c.layer);
  const isZero = SWITCHES(agentId).find((s) => `${s.key}` === c.key)?.zeroIsSet;
  return values.some((v) => {
    if (c.set) return true;
    if ('eq' in c) return v === c.eq;
    if (c.in) return c.in.includes(v);
    if ('lt' in c) return typeof v === 'number' && v < c.lt;
    if (c.falsy) return v === '0' || v === 0 || v === false || /^false$/i.test(String(v));
    // A switch that counts any value as set, versus a plain boolean that 0 and false turn off.
    if (c.on) return isZero ? String(v) !== '' : truthy(v);
    return false;
  });
}

// Findings for the rules of one agent over the given layers: [{ id, level, message, fix, source, keys, key? }].
export function notes(agentId, layers, { env, onlyDoctor = false, partial = false } = {}) {
  const state = { layers, env };
  const out = [];
  for (const r of COUPLINGS.rules.filter((x) => x.agent === agentId && (!onlyDoctor || x.doctor) && !(partial && x.needsAll))) {
    const expand = r.forEach === 'zeroIsSet' ? SWITCHES(agentId).filter((s) => s.zeroIsSet).map((s) => s.key) : [null];
    for (const key of expand) {
      const fill = (s) => (key ? s.replaceAll('{key}', key) : s);
      const when = key ? JSON.parse(fill(JSON.stringify(r.when))) : r.when;
      if (when && !holds(when, state, agentId)) continue;
      // A value the setup itself writes is on purpose: no finding while every such key still has the setup's value.
      if (r.unlessSetup && r.keys.filter((k) => setupValue(k) !== undefined).every((k) => same(lookup(state, agentId, k)[0], setupValue(k)))) continue;
      out.push({ id: key ? `${r.id}:${key}` : r.id, rule: r.id, level: r.level, message: fill(r.message), fix: r.fix && fill(r.fix), source: r.source, keys: key ? [key] : r.keys, static: !r.when });
    }
  }
  return out;
}

// What the setup writes for a key; null when it does not write it.
const setupValue = (key) => CLAUDE_KEYS.find(([p]) => p.join('.') === key)?.[1];

// ---- the list for the editor and the CLI ----

const SWITCH_KEYS = (agentId) => new Set(SWITCHES(agentId).map((s) => s.key));

export function schemaKeys(agentId) {
  const schema = SCHEMAS[agentId];
  const out = [];
  const walk = (node, path, depth) => {
    node = resolve(schema, node);
    const props = node?.properties;
    // A property name with a dot cannot be told from a nested key: its table is listed as one key.
    if (props && depth < 4 && path.length) {
      const names = Object.entries(props);
      for (const [k, v] of names.filter(([k]) => !k.includes('.'))) walk(v, [...path, k], depth + 1);
      if (!names.length || names.some(([k]) => k.includes('.'))) out.push(path);
      return;
    }
    if (props) { for (const [k, v] of Object.entries(props)) walk(v, [k], 1); return; }
    out.push(path);
  };
  walk(schema, [], 0);
  return out.map((p) => p.join('.'));
}

// A key set in a file that no list knows: the app's, the pinned schema's, the reference's.
function unknownKeys(agentId, layers, known) {
  const out = [];
  for (const l of layers) {
    for (const [k, v] of Object.entries(l.data ?? {})) {
      if ([...known].some((x) => x === k || x.startsWith(`${k}.`))) continue;
      out.push({ key: k, layer: l.layer, path: l.path, value: maskSecrets(v, k) });
    }
  }
  return out;
}

export function listSettings(ctx, agentId, { dir, advanced = false, env } = {}) {
  const a = agentSettings(agentId);
  const layers = readSettings(ctx, agentId, { dir });
  const found = notes(agentId, layers, { env });
  const row = (def) => {
    const vals = valuesOf(layers, agentId, def.key);
    const eff = vals[0];
    const dflt = setupValue(def.key);
    return { ...def, basic: def.basic !== false, values: def.values, value: eff ? maskSecrets(eff.value, def.key) : undefined, layer: eff?.layer ?? null, file: eff?.path ?? null, sets: vals.map((x) => ({ layer: x.layer, value: maskSecrets(x.value, def.key) })),
      changed: vals.length > 0, setByApp: !!def.setup, ...(agentId === 'claude' && dflt !== undefined ? { appValue: maskSecrets(dflt, def.key) } : {}), notes: found.filter((n) => n.keys.includes(def.key)).map(({ id, level, message, source, static: s }) => ({ id, level, message, source, static: s })) };
  };
  const settings = a.settings.filter((s) => advanced || s.basic !== false).map(row);
  const result = { agent: agentId, name: a.name, layers: layers.map(({ data, ...l }) => l), settings, bundles: a.bundles, notes: found.filter((n) => !n.static) };
  if (agentId === 'codex') result.trust = trustList(layers);
  if (!advanced) return result;
  // Advanced: every key of the pinned schemas and the reference, the app's own rows first.
  const have = new Set(a.settings.map((s) => s.key));
  const keys = [...new Set([...(agentId === 'claude' ? REFERENCE.map((r) => r.key) : []), ...schemaKeys(agentId)])].filter((k) => !have.has(k)).sort((a, b) => (a < b ? -1 : +(a > b)));
  result.advanced = keys.map((k) => {
    const def = describeKey(agentId, k);
    const vals = valuesOf(layers, agentId, k);
    // A value holding a secret is shown masked, so it is not edited here: the text typed back would be the placeholder.
    const sets = vals.map((x) => ({ layer: x.layer, value: maskSecrets(x.value, k) }));
    const masked = sets.some((x, i) => !same(x.value, vals[i].value));
    const asTable = def.types?.length > 0 && def.types.every((t) => t === 'object');
    return { key: k, type: def.type, values: def.values, sentence: def.sentence, group: def.group, scope: def.scope ?? null, inSchema: def.schema ?? true, masked, editable: !masked && !(def.scope && SCOPE_NOTE[def.scope]) && (agentId === 'claude' || !asTable), value: sets[0]?.value, layer: vals[0]?.layer ?? null, sets, changed: vals.length > 0 };
  });
  const known = new Set([...have, ...keys, ...REFERENCE.map((r) => r.key), ...schemaKeys(agentId)]);
  result.outside = unknownKeys(agentId, layers, known);
  // Environment entries (Claude Code): names always, values unless the name looks like a secret.
  if (agentId === 'claude') {
    const sw = SWITCH_KEYS(agentId);
    result.env = layers.flatMap((l) => Object.entries(l.data?.env ?? {}).map(([name, v]) => ({ name, layer: l.layer, value: maskSecrets(v, name), secret: isSecretName(name), editable: sw.has(`env.${name}`) })));
  }
  return result;
}

// Codex [projects."<path>"] entries with whether the folder still exists, from the user layer only.
export function trustList(layers) {
  const user = layers.find((l) => l.layer === 'user');
  return Object.entries(user?.data?.projects ?? {}).map(([path, v]) => ({ path, trust: v?.trust_level ?? null, exists: exists(path) }));
}

// ---- plans ----

const strictJson = (text, file) => {
  try { return text?.trim() ? JSON.parse(text) : {}; } catch (e) { throw new MergeError(`${file} is not valid JSON (${e.message.split('\n')[0]}): Claude Code would skip the whole file, so the app does not edit it`); }
};

// The editor's write for one key: JSON with comments kept and ancestors created, or a TOML line edit that keeps comments
// and key order. The result is parsed again before it is returned, so an invalid file never reaches the runner.
export function editFor(agentId, key, value, file = 'the file') {
  if (agentId === 'codex') {
    return (text) => {
      const src = text ?? '';
      if (key.startsWith('projects.')) {
        if (value != null) throw new MergeError('trusted projects are only removed here');
        return removeTable(src, ['projects', key.slice(9)]);
      }
      const path = pathOf(key), table = path.slice(0, -1).join('.'), name = path.at(-1);
      const out = value == null ? removeToml(src, table, name) : setToml(src, table, name, value);
      // Nothing to change: the file stays as it is, a missing one stays missing.
      if (out === src) return text;
      const back = dig(parseToml(out), path);
      if (value != null ? !same(back, value) : back !== undefined) throw new MergeError(`${key}: this form needs manual editing`);
      return out;
    };
  }
  return (text) => {
    const current = dig(strictJson(text, file), pathOf(key));
    if (value == null ? current === undefined : same(current, value)) return text;
    const path = pathOf(key);
    const edits = value == null ? [{ path, remove: true }, ...path.slice(0, -1).map((_, i, all) => ({ path: all.slice(0, all.length - i), prune: true }))] : [{ path, value }];
    let out;
    try { out = mergeJson(text, edits, file); } catch (e) { if (e instanceof MergeError) throw e; throw new MergeError(`${key}: the file holds a value of another shape there; edit it by hand`); }
    const back = dig(strictJson(out, file), path);
    if (value != null ? !same(back, value) : back !== undefined) throw new MergeError(`${key}: the file holds a value of another shape there; edit it by hand`);
    return out;
  };
}

// Changes for { key: value } edits in one layer (null or undefined removes the key); throws for what must not be written.
export function settingsChanges(ctx, agentId, { layer = 'user', dir, edits }) {
  const a = agentSettings(agentId);
  if (layer === 'managed') throw new Error('managed settings are read-only: ask whoever manages this machine');
  if (!a.layers[layer]) throw new Error(`${a.name} has no ${layer} layer (${Object.keys(a.layers).join(', ')})`);
  if (layer !== 'user' && !dir) throw new Error(`the ${layer} layer needs a project folder`);
  const layers = readSettings(ctx, agentId, { dir });
  const target = layers.find((l) => l.layer === layer);
  if (target.error) throw new Error(`${target.path} cannot be read (${target.error}): fix it first`);
  // The state of the target layer after the edits, to refuse what an agent would silently ignore: another layer's value is not this edit's fault.
  // shortcut: a refuse rule that must read another layer sees none here; pass them with this layer replaced when one is added.
  const after = structuredClone(target.data);
  const problems = [];
  const changes = [];
  for (const [key, raw] of Object.entries(edits)) {
    const def = describeKey(agentId, key);
    if (!def) { problems.push(`${key}: not a key of ${a.name}'s settings reference or schema`); continue; }
    if (agentId === 'codex' && key.startsWith('projects.') && raw != null) { problems.push(`${key}: trusted projects are only removed here`); continue; }
    const value = raw === undefined ? null : raw;
    const bad = key.startsWith('projects.') ? null : hasMask(value) ? `${key}: the value holds the placeholder ${MASK} that stands for a hidden secret: edit the file by hand` : validate(agentId, def, value, layer);
    if (bad) { problems.push(bad); continue; }
    const stored = def.type === 'switch' && value === true ? '1' : value;
    const path = agentId === 'codex' && key.startsWith('projects.') ? ['projects', key.slice(9)] : pathOf(key);
    if (stored == null) { const parent = dig(after, path.slice(0, -1)); if (parent && typeof parent === 'object') delete parent[path.at(-1)]; } else {
      let o = after;
      for (const seg of path.slice(0, -1)) o = (o[seg] != null && typeof o[seg] === 'object') ? o[seg] : (o[seg] = {});
      o[path.at(-1)] = stored;
    }
    const secret = isSecretName(key) || path.some(isSecretName);
    const shown = stored == null ? 'removed' : `= ${secret ? MASK : JSON.stringify(maskSecrets(stored, key))}`;
    changes.push({ id: `settings:${agentId}:${layer}:${key}`, step: `settings:${agentId}`, title: `${a.name} ${layer} settings: ${key} ${shown}`, kind: 'write', path: target.path, edit: editFor(agentId, key, stored, target.path) });
  }
  const written = Object.keys(edits).filter((k) => edits[k] != null);
  for (const n of notes(agentId, [{ ...target, data: after }]).filter((x) => COUPLINGS.rules.find((r) => r.id === x.rule)?.refuse && x.keys.some((k) => written.includes(k)))) problems.push(n.message);
  if (problems.length) throw new Error(problems.join('; '));
  return changes;
}

// The three or two keys of a bundle ("less noise") as edits: switches set, Codex booleans false.
export function bundleEdits(agentId, id) {
  const a = agentSettings(agentId);
  if (!a.bundles?.some((b) => b.id === id)) throw new Error(`${a.name} has no bundle ${id}`);
  return Object.fromEntries(a.settings.filter((s) => s.bundle === id).map((s) => [s.key, s.type === 'switch' ? true : s.suggest?.value ?? false]));
}

// ---- Doctor ----

const issue = (level, message, fix, dir) => ({ level, check: 'agent-settings', message, fix, ...(dir ? { dir } : {}) });

// Doctor findings for the agents' settings: files Claude Code would skip, the rules marked doctor, Codex trust entries of
// folders that are gone. With dir, only what the project and local layers add to the global findings. Names and places,
// never values.
export function settingsChecks(ctx, { agents = settingsAgents, dir, env } = {}) {
  const out = [];
  for (const id of agents.filter((a) => settingsAgents.includes(a))) {
    const name = agentSettings(id).name;
    const all = readSettings(ctx, id, { dir });
    for (const l of all.filter((x) => x.error && (!dir || x.layer !== 'user') && x.layer !== 'managed')) {
      out.push(issue('error', `${name} cannot read ${l.path}: ${l.error}${id === 'claude' ? '; it skips the whole file' : ''}`, 'fix the file by hand, then run benchkeeper doctor again', l.layer === 'user' ? undefined : dir));
    }
    const readable = all.filter((l) => !l.error);
    // A file that cannot be read may hold what a rule about a missing setting looks for.
    const partial = readable.length < all.length;
    const before = dir ? new Set(notes(id, readable.filter((l) => ['managed', 'user'].includes(l.layer)), { env, onlyDoctor: true, partial }).map((n) => n.id)) : new Set();
    for (const n of notes(id, readable, { env, onlyDoctor: true, partial }).filter((x) => !before.has(x.id))) out.push(issue(n.level, `${name}: ${n.message}`, `${n.fix ?? 'see the note'} (${n.source})`, dir));
    if (id === 'codex' && !dir) {
      for (const t of trustList(readable).filter((x) => !x.exists)) out.push(issue('warning', `Codex trusts ${t.path}, which no longer exists`, `benchkeeper settings set 'projects.${t.path.replaceAll("'", "'\\''")}' --unset --agent codex`));
    }
  }
  return out;
}
