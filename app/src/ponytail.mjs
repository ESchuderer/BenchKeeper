// Ponytail is an optional third-party plugin. This module reads or writes only files that plugin keeps, only when they are
// there, and imports none of its code. The task name column of its ledger is parsed but not kept in a row.
// shortcut: paths follow the default layout below the home folder; CLAUDE_CONFIG_DIR, XDG_CONFIG_HOME and APPDATA are not followed, as in the rest of the app.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { exists, readText } from './fsx.mjs';
import { mergeJson } from './merge.mjs';

export const PLUGIN = 'ponytail@ponytail';
const BAND_FLAG = '.claude/.ponytail-band';
const CONFIG = '.config/ponytail/config.json';
const LEDGER = '.config/ponytail/band';
const MAX_BYTES = 8 * 1024 * 1024;
const COLUMNS = ['key', 'project', 'cost_usd', 'turns', 'agent_minutes', 'tokens_total', 'reuse_pct', 'tests', 'level', 'model'];
// The session id's first 8 characters and the start in epoch milliseconds.
const KEY = /^([0-9a-f]{8})-(\d{12,14})$/;

const json = (text) => { try { return JSON.parse(text ?? '{}') ?? {}; } catch { return {}; } };

// True when Ponytail's band would draw above the prompt next to BenchKeeper's tier band: both plugins are on, the tier band
// is on, and `/ponytail band off` has not been run.
export function bandStacks(ctx) {
  const settings = json(readText(join(ctx.home, '.claude/settings.json')));
  return settings.enabledPlugins?.[PLUGIN] === true
    && settings.enabledPlugins?.['benchkeeper@benchkeeper'] === true
    && settings.pluginConfigs?.['benchkeeper@benchkeeper']?.options?.tierBand === true
    && readText(join(ctx.home, BAND_FLAG))?.trim() !== 'off';
}

// The two writes that hide Ponytail's band and status indicator; its behaviour (mode, skills) stays on. Plan changes.
export const hideBandChanges = (ctx) => [
  { title: "hide Ponytail's band above the prompt (writes off to ~/.claude/.ponytail-band, what /ponytail band off does)", kind: 'write', path: join(ctx.home, BAND_FLAG), after: 'off' },
  { title: "hide Ponytail's status indicator (hideStatus in ~/.config/ponytail/config.json)", kind: 'write', path: join(ctx.home, CONFIG), edit: (t) => {
    // A config that is there but unreadable fails the plan, so the flag file is not written alone.
    if (t === null && exists(join(ctx.home, CONFIG))) throw new Error(`${join(ctx.home, CONFIG)} cannot be read`);
    return mergeJson(t, [{ path: ['hideStatus'], value: true }]);
  } },
];

// The doctor finding for bandStacks, or [].
export const bandChecks = (ctx) => (bandStacks(ctx) ? [{
  level: 'warning', check: 'ponytail',
  message: "Ponytail draws its own band above the prompt, so two bands stack with BenchKeeper's tier band. The switch is the file ~/.claude/.ponytail-band (off hides it, /ponytail band off writes it) and hideStatus in ~/.config/ponytail/config.json for its status indicator",
  fix: "benchkeeper apply: choose the optional change \"hide Ponytail's band\" (a plan with a diff; benchkeeper undo restores both files)",
}] : []);

// Quote-aware: a task name holds commas, quotes and line breaks.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) rows.push([...row, field]);
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

const num = (s) => (s === '' || !Number.isFinite(Number(s)) ? null : Number(s));
const testsOf = (s) => (/passed$/.test(s) ? 'pass' : /failed$/.test(s) ? 'fail' : null);

// One row per Ponytail task, keyed by session: { id, startedMs, project, costUSD, turns, agentMinutes, tokens, reusePct, tests,
// level, model }, summed over the tasks of a session. notes: files and rows left out. Read only; no task name is kept.
export function readLedger(ctx) {
  const dir = join(ctx.home, LEDGER);
  const notes = [];
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.csv')).sort(); } catch (e) {
    // An absent folder means no Ponytail ledger; one that cannot be listed is reported, not read as empty.
    return { rows: [], notes: e?.code === 'ENOENT' ? notes : [`Ponytail ledger folder could not be read: ${e?.code ?? 'error'}`] };
  }
  const bySession = new Map();
  for (const f of files) {
    let size = 0;
    try { size = statSync(join(dir, f)).size; } catch { /* read below fails the same way */ }
    const [head, ...body] = size > MAX_BYTES ? [] : parseCsv(readText(join(dir, f)) ?? '');
    if (!head || COLUMNS.some((c) => !head.includes(c))) { notes.push(`Ponytail ledger ${f} skipped: ${size > MAX_BYTES ? 'larger than 8 MB' : 'not a Ponytail ledger'}`); continue; }
    const at = (r, c) => r[head.indexOf(c)];
    let bad = 0;
    for (const r of body) {
      const key = r.length === head.length ? at(r, 'key').match(KEY) : null;
      if (!key) { bad++; continue; }
      const prev = bySession.get(key[1]);
      const row = { id: key[1], startedMs: Number(key[2]), project: at(r, 'project') || null, costUSD: num(at(r, 'cost_usd')), turns: num(at(r, 'turns')) ?? 0, agentMinutes: num(at(r, 'agent_minutes')), tokens: num(at(r, 'tokens_total')), reusePct: num(at(r, 'reuse_pct')), reused: num(at(r, 'reused')), fresh: num(at(r, 'new')), tests: testsOf(at(r, 'tests')), level: at(r, 'level') || null, model: at(r, 'model') || null };
      const sum = (a, b) => (a == null && b == null ? null : (a ?? 0) + (b ?? 0));
      bySession.set(key[1], !prev ? row : { ...row, startedMs: Math.min(prev.startedMs, row.startedMs), costUSD: sum(prev.costUSD, row.costUSD), turns: prev.turns + row.turns, agentMinutes: sum(prev.agentMinutes, row.agentMinutes), tokens: sum(prev.tokens, row.tokens), reusePct: row.reusePct ?? prev.reusePct, reused: sum(prev.reused, row.reused), fresh: sum(prev.fresh, row.fresh), tests: row.tests ?? prev.tests });
    }
    if (bad) notes.push(`Ponytail ledger ${f}: ${bad} malformed ${bad === 1 ? 'row' : 'rows'} skipped`);
  }
  // A session's share comes from its summed counts, as Ponytail's own (no share below 3 functions), not from one task's.
  const rows = [...bySession.values()].map(({ reused, fresh, ...r }) => (reused == null || fresh == null ? r : { ...r, reusePct: reused + fresh < 3 ? null : Math.round((reused / (reused + fresh)) * 100) }));
  return { rows, notes };
}
