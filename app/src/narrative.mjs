// Insights narrative (#324): a model-written summary of the findings with a suggested order, from one session of an agent the
// user chose. Off until the user agreed once; a run sends exactly the input narrativeInput() builds, shown beforehand; the
// answer is model text, cached for the findings it was written for and dropped when that set changes.
// The input is an allowlist of finding fields: no session title, message, prompt, file content or skill description, and
// a project only by its folder name.
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentAnswer } from './advise.mjs';
import { readText, writeAtomic } from './fsx.mjs';
import { WINDOW_DAYS, findingKey } from './insights.mjs';

const MAX_TEXT = 4000;
// The prompt is one command-line argument (Windows allows about 32,000 characters in all): the most severe findings, the rest counted.
const MAX_FINDINGS = 25;
const consentFile = (ctx) => join(ctx.config, 'insights-narrative.json');
const cacheFile = (ctx) => join(ctx.home, '.cache/benchkeeper', 'insights-narrative.json');
// A path in a doctor message is cut to its last segment, as a project is named by its folder.
const PATH = /(^|[\s'"`(=])((?:~|[A-Za-z]:)[\\/][^\s'"`),;:]*|[\\/][^\s'"`),;:]*[\\/][^\s'"`),;:]*)/g;
const last = (path) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? '';
// The known folders (the home folder as ~ and as a path, the config folder, the registered projects), whose names can
// hold spaces, are cut first, longest first, either separator. Below one, a folder name may hold spaces too: a segment
// counts as a folder when another separator follows it and it neither starts nor ends with a space. The last segment
// ends where a PATH segment ends.
const SEP = /[\\/]/, STOP = /[\s'"`),;:]/;
const escaped = (p) => p.replace(/[\\/]+$/, '').split(SEP).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\\\/]');
const knownPattern = (known) => {
  const list = [...new Set(['~', ...known.filter((p) => typeof p === 'string' && p.length > 1)])].sort((x, y) => y.length - x.length).map(escaped);
  return new RegExp(`(^|[\\s'"\`(=])(?:${list.join('|')})(?=[\\\\/]|$|[\\s'"\`),;:])`, 'g');
};
// The end of the path that starts at i (just after a known folder): its folders, then its last segment.
function pathEnd(text, i) {
  while (SEP.test(text[i] ?? '')) {
    let k = i + 1;
    while (k < text.length && !SEP.test(text[k]) && !/['"`\n\t]/.test(text[k])) k++;
    const seg = text.slice(i + 1, k);
    if (k < text.length && SEP.test(text[k]) && seg && seg.trim() === seg) { i = k; continue; }
    let e = i + 1;
    while (e < text.length && !STOP.test(text[e])) e++;
    return e;
  }
  return i;
}
function cutKnown(text, pattern) {
  let out = '', from = 0;
  for (const m of text.matchAll(pattern)) {
    const at = m.index + m[1].length;
    if (at < from) continue;
    const end = pathEnd(text, at + m[0].length - m[1].length);
    out += text.slice(from, at) + last(text.slice(at, end));
    from = end;
  }
  return out + text.slice(from);
}
const plain = (text, pattern = knownPattern([])) => cutKnown(String(text ?? ''), pattern).replace(PATH, (m, pre, path) => pre + last(path)).slice(0, 300);
// Numbers stay, a list is its length; of the strings only the project (a folder name), the doctor check and the scope.
const evidenceOf = (e, cut = plain) => Object.fromEntries(Object.entries(e).flatMap(([k, v]) => {
  if (k === 'line') return [];
  if (typeof v === 'number') return [[k, v]];
  if (Array.isArray(v)) return [[k, v.length]];
  return ['project', 'check', 'scope'].includes(k) && typeof v === 'string' ? [[k, cut(v)]] : [];
}));

// The folders whose paths the input cuts first: the home folder, the config folder and the registered projects.
export const narrativePaths = (ctx, projects = []) => [ctx.home, ctx.config, ...projects.map((p) => p.path)];

// found: the result of insights() with the findings to summarize (the ones shown); known: narrativePaths().
export function narrativeInput({ samples }, findings, known = []) {
  const pattern = knownPattern(known), cut = (text) => plain(text, pattern);
  return {
    window: { days: WINDOW_DAYS }, samples,
    omitted: Math.max(0, findings.length - MAX_FINDINGS),
    findings: findings.slice(0, MAX_FINDINGS).map((f) => ({ id: f.id, signal: f.signal, severity: f.severity, message: cut(f.message), evidence: evidenceOf(f.evidence, cut), proposal: cut(f.fix) })),
  };
}

// The text that goes to the agent, and so the text the preview shows. id changes with any byte of it.
// id: the prompt and the findings key, so a change to a finding the prompt does not carry (past the cap) still changes it.
export function narrativePrompt(input, key = '') {
  const prompt = [
    'Below are the findings of a scan of one machine\'s coding-agent setup, as JSON. Write a short summary of what they say together,',
    'then a numbered order in which to work through them, with one sentence of reason each. Use only the data below; do not read files or run commands.',
    'Answer in plain text, at most 200 words.', '', JSON.stringify(input, null, 2),
  ].join('\n');
  return { prompt, size: prompt.length, id: createHash('sha256').update(`${key}\n${prompt}`).digest('hex').slice(0, 16) };
}

// What the narrative was written for: the findings by key (id and a digest of the evidence set), not the running counts.
export const narrativeKey = (findings) => createHash('sha256').update(findings.map(findingKey).sort().join('\n')).digest('hex').slice(0, 16);

export function hasConsent(ctx) {
  try { return typeof JSON.parse(readText(consentFile(ctx))).consentedAt === 'string'; } catch { return false; }
}
export function giveConsent(ctx, now = Date.now()) {
  writeAtomic(consentFile(ctx), `${JSON.stringify({ schemaVersion: 1, consentedAt: new Date(now).toISOString() }, null, 2)}\n`, 0o600);
}

// The cached narrative when it was written for this findings set; another set drops it.
export function readNarrative(ctx, key) {
  try {
    const c = JSON.parse(readText(cacheFile(ctx)));
    if (c.key === key && typeof c.text === 'string') return { agent: c.agent, text: c.text, cost: c.cost ?? null, at: c.at };
  } catch { /* none */ }
  if (existsSync(cacheFile(ctx))) rmSync(cacheFile(ctx), { force: true });
  return null;
}

// One session of the agent, in an empty folder with no tools: it gets the prompt and nothing else to read.
export async function runNarrative(ctx, { agent, prompt, key, signal, now = Date.now() }) {
  const dir = mkdtempSync(join(tmpdir(), 'bk-narrative-'));
  try {
    const { text, cost } = await agentAnswer(ctx, { dir, agent, prompt, signal, tools: '', usage: true });
    const answer = String(text ?? '').trim().slice(0, MAX_TEXT);
    if (!answer) throw new Error(`${agent} gave no answer`);
    const entry = { agent, text: answer, cost, at: new Date(now).toISOString() };
    writeAtomic(cacheFile(ctx), `${JSON.stringify({ schemaVersion: 1, key, ...entry }, null, 2)}\n`, 0o600);
    return entry;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
