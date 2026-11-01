// Merges into files users already have: JSON by key, text in one marked block, TOML by key.
import { applyEdits, findNodeAtLocation, modify, parse, parseTree, printParseErrorCode } from 'jsonc-parser';
import { parse as parseToml } from 'smol-toml';

const FORMAT = { formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } };

export class MergeError extends Error {}

export function parseJson(text, file = 'JSON') {
  const errors = [];
  // An empty file counts as an empty object.
  const value = parse(text?.trim() ? text : '{}', errors, { allowTrailingComma: true });
  if (errors.length) throw new MergeError(`${file}: ${printParseErrorCode(errors[0].error)} at offset ${errors[0].offset}`);
  return value ?? {};
}

// Sets (value) or removes (undefined) one key. jsonc-parser formats an insert or a removal over whole lines, which would
// reformat the property next to it on the same line: here the other properties keep their text. An object written on one
// line is formatted as a whole.
function setKey(text, path, value) {
  const parent = findNodeAtLocation(parseTree(text), path.slice(0, -1));
  const props = parent?.type === 'object' && /[\r\n]/.test(text.slice(parent.offset, parent.offset + parent.length)) ? parent.children ?? [] : [];
  const at = props.findIndex((p) => p.children[0].value === path.at(-1));
  // A removal takes the property with the comma and line break between it and its neighbour; formatted when it leaves the object empty.
  if (value === undefined && at >= 0 && props.length > 1) {
    const [from, to] = at > 0 ? [props[at - 1].offset + props[at - 1].length, props[at].offset + props[at].length] : [props[0].offset, props[1].offset];
    return text.slice(0, from) + text.slice(to);
  }
  // An insert after the last property: its value stands aside as a placeholder while the new key is formatted.
  if (value !== undefined && at < 0 && props.length) {
    const last = props.at(-1), prev = last.children[1], end = prev.offset + prev.length;
    const shielded = `${text.slice(0, prev.offset)}0${text.slice(end)}`;
    const out = applyEdits(shielded, modify(shielded, path, value, FORMAT));
    const moved = findNodeAtLocation(parseTree(out), [...path.slice(0, -1), last.children[0].value]);
    return text.slice(0, end) + out.slice(moved.offset + moved.length);
  }
  return applyEdits(text, modify(text, path, value, FORMAT));
}

// Same value whatever the order of an object's keys (a formatter may reorder them).
const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));

// edits: [{ path: [...keys], value }] sets a value, [{ path, append: [...] }] adds missing list entries after the user's own,
// { path, remove: true } deletes a key.
export function mergeJson(text, edits, file) {
  let out = text?.trim() ? text : '{}\n';
  for (const e of edits) {
    const current = parseJson(out, file);
    const at = (path) => path.reduce((o, k) => (o == null ? undefined : o[k]), current);
    let value = e.value;
    if (e.append) {
      const list = at(e.path) ?? [];
      if (!Array.isArray(list)) throw new MergeError(`${file}: ${e.path.join('.')} is not a list`);
      const missing = e.append.filter((x) => !list.some((y) => canon(y) === canon(x)));
      if (!missing.length) continue;
      value = [...list, ...missing];
    }
    // pull takes items out of a list; prune drops a list or object left empty.
    if (e.pull) {
      const list = at(e.path);
      if (!Array.isArray(list)) continue;
      value = list.filter((y) => !e.pull.some((x) => canon(x) === canon(y)));
      if (value.length === list.length) continue;
      if (!value.length) value = undefined;
    }
    if (e.prune) {
      const v = at(e.path);
      if (v == null || typeof v !== 'object' || Object.keys(v).length) continue;
      value = undefined;
    }
    if (e.remove) {
      if (at(e.path) === undefined) continue;
      value = undefined;
    }
    out = setKey(out, e.path, value);
  }
  parseJson(out, file);
  return out.endsWith('\n') ? out : `${out}\n`;
}

export const marks = (id, comment) => (comment === '#' ? [`# benchkeeper:${id} start`, `# benchkeeper:${id} end`] : [`<!-- benchkeeper:${id} start -->`, `<!-- benchkeeper:${id} end -->`]);

// Replaces or appends the block between benchkeeper markers; text outside it stays. block null removes the block.
export function setBlock(text, id, block, comment) {
  const [start, end] = marks(id, comment);
  const src = text ?? '';
  const a = src.indexOf(start), b = src.indexOf(end);
  if ((a < 0) !== (b < 0) || b < a) throw new MergeError(`unbalanced benchkeeper:${id} markers`);
  const inner = block == null ? '' : `${start}\n${block.trimEnd()}\n${end}`;
  if (a < 0) {
    if (!inner) return src;
    return src.trim() ? `${src.trimEnd()}\n\n${inner}\n` : `${inner}\n`;
  }
  const before = src.slice(0, a), after = src.slice(b + end.length);
  if (inner) return before + inner + after;
  const joined = `${before.trimEnd()}${after.replace(/^\n+/, before.trim() ? '\n\n' : '')}`;
  return joined.trim() ? `${joined.trimEnd()}\n` : '';
}

export function getBlock(text, id, comment) {
  const [start, end] = marks(id, comment);
  const a = (text ?? '').indexOf(start), b = (text ?? '').indexOf(end);
  return a < 0 || b < a ? null : text.slice(a + start.length, b).trim();
}

const tomlLiteral = (v) => (typeof v === 'string' ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(tomlLiteral).join(', ')}]` : String(v));
const keyRe = (key) => new RegExp(`^(\\s*)(${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|"${key}")\\s*=`);

// The parsed text of a line edit: CRLF line endings and invalid TOML are reported for manual editing.
function parsed(src) {
  if (src.includes('\r')) throw new MergeError('CRLF line endings: edit by hand');
  try { return parseToml(src); } catch (e) { throw new MergeError(`invalid TOML: ${e.message.split('\n')[0]}`); }
}

// The lines [from, to) of a table below its header (or of the root, up to the first header with table ''); null when the
// table has no header line of its own.
function tableLines(lines, table) {
  const header = (l) => /^\s*\[/.test(l);
  let from = 0, to = lines.findIndex(header);
  if (table) {
    from = lines.findIndex((l) => l.trim() === `[${table}]`);
    if (from < 0) return null;
    from++;
    to = lines.slice(from).findIndex(header);
    to = to < 0 ? lines.length : from + to;
  }
  return [from, to < 0 ? lines.length : to];
}

// Sets one scalar key in a table (or at the root with table ''). The edit is a line edit, accepted only when the
// parsed result equals the parsed original with that key set; anything else is reported for manual editing.
export function setToml(text, table, key, value) {
  const src = text ?? '';
  const before = parsed(src);
  const scope = table ? table.split('.').reduce((o, k) => o?.[k], before) : before;
  if (scope?.[key] === value) return src;
  const lines = src.split('\n');
  const range = tableLines(lines, table);
  const line = `${key} = ${tomlLiteral(value)}`;
  if (!range) {
    lines.splice(lines.length - (lines.at(-1) === '' ? 1 : 0), 0, ...(src.trim() ? [''] : []), `[${table}]`, line);
  } else {
    const [from, to] = range;
    const at = lines.slice(from, to).findIndex((l) => keyRe(key).test(l));
    // A comment after the old value stays with the line.
    if (at >= 0) lines[from + at] = `${line}${lines[from + at].match(/^\s*[^\s=]+\s*=\s*(?:"(?:[^"\\]|\\.)*"|'[^']*'|\[[^\]]*\]|[^#\s]+)(\s*#.*)$/)?.[1] ?? ''}`;
    else {
      let end = to;
      // Comments directly above the next table belong to it: the key goes above them.
      if (to < lines.length) while (end > from && /^\s*#/.test(lines[end - 1])) end--;
      while (end > from && lines[end - 1].trim() === '') end--;
      lines.splice(end, 0, line);
    }
  }
  const out = lines.join('\n');
  let after;
  try { after = parseToml(out); } catch { throw new MergeError(`${table || 'root'}.${key}: this form needs manual editing`); }
  const expect = structuredClone(before);
  const target = table ? table.split('.').reduce((o, k) => (o[k] ??= {}), expect) : expect;
  target[key] = value;
  if (JSON.stringify(sortKeys(after)) !== JSON.stringify(sortKeys(expect))) throw new MergeError(`${table || 'root'}.${key}: this form needs manual editing`);
  return out.endsWith('\n') || !out ? out : `${out}\n`;
}

// The same line edit for removing a key from a table (or the root with table ''). A key that is not on a line of its
// own in that table (dotted or inline form, a multi-line value) is reported for manual editing.
export function removeToml(text, table, key) {
  const src = text ?? '';
  const before = parsed(src);
  const scope = table ? table.split('.').reduce((o, k) => o?.[k], before) : before;
  if (scope?.[key] === undefined) return src;
  const lines = src.split('\n');
  const range = tableLines(lines, table);
  if (!range) throw new MergeError(`${table}.${key}: this form needs manual editing`);
  const [from, to] = range;
  const at = lines.slice(from, to).findIndex((l) => keyRe(key).test(l));
  if (at < 0) throw new MergeError(`${table || 'root'}.${key}: this form needs manual editing`);
  lines.splice(from + at, 1);
  return checkedToml(lines.join('\n'), before, table ? table.split('.') : [], key, `${table || 'root'}.${key}`);
}

// Removes a whole [a."b"] table: its header line and the lines up to the next header; comments above stay.
export function removeTable(text, path) {
  const src = text ?? '';
  const before = parsed(src);
  if (path.reduce((o, k) => o?.[k], before) === undefined) return src;
  const lines = src.split('\n');
  const keys = (l) => {
    if (!/^\s*\[[^[]/.test(l)) return null;
    try { let o = parseToml(`${l.trim()}\n`); const ks = []; while (o && typeof o === 'object' && Object.keys(o).length === 1) { const k = Object.keys(o)[0]; ks.push(k); o = o[k]; } return ks; } catch { return null; }
  };
  const from = lines.findIndex((l) => { const ks = keys(l); return ks && ks.length === path.length && ks.every((k, i) => k === path[i]); });
  if (from < 0) throw new MergeError(`${path.join('.')}: this form needs manual editing`);
  let to = lines.slice(from + 1).findIndex((l) => /^\s*\[/.test(l));
  to = to < 0 ? lines.length : from + 1 + to;
  lines.splice(from, to - from);
  return checkedToml(lines.join('\n'), before, path.slice(0, -1), path.at(-1), path.join('.'));
}

// Accepts an edited text only when it parses to the original with that one key gone.
function checkedToml(out, before, parents, key, label) {
  let after;
  try { after = parseToml(out); } catch { throw new MergeError(`${label}: this form needs manual editing`); }
  const expect = structuredClone(before);
  delete parents.reduce((o, k) => o[k], expect)[key];
  // A table left empty stays when its header line does, and is gone when it was only implied by the removed one.
  const pruned = structuredClone(expect);
  for (let i = parents.length; i > 0; i--) {
    const holder = parents.slice(0, i - 1).reduce((o, k) => o[k], pruned);
    if (Object.keys(holder[parents[i - 1]]).length) break;
    delete holder[parents[i - 1]];
  }
  const got = JSON.stringify(sortKeys(after));
  if (got !== JSON.stringify(sortKeys(expect)) && got !== JSON.stringify(sortKeys(pruned))) throw new MergeError(`${label}: this form needs manual editing`);
  return out.endsWith('\n') || !out ? out : `${out}\n`;
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object' && !(v instanceof Date)) return Object.fromEntries(Object.keys(v).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((k) => [k, sortKeys(v[k])]));
  return v;
}
