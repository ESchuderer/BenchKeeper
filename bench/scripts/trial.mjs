// Turns one brief trial (stream-json transcript, workspace, scorer output) into trial.json:
// delivery audit, workflow trace, usage, scores and line counts.
// Usage: node bench/scripts/trial.mjs <trial-dir> <arm>   (reads transcript.jsonl, workspace/, score/; writes trial.json)
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { OPENCODE_ARMS, ocAudit, ocOutcome, ocUses, sessions } from './opencode.mjs';
import { claudePhases, opencodePhases, shellWriteTarget } from './phases.mjs';

// Arm table (same as bench/image/install-arm.sh): framework, Ponytail, BenchKeeper layer (1: v1 rules, 'v3' to 'v5': rules and the
// following-dev-workflow skill, 'v6': the setup-v4.0 plugin, 'v7': the setup-v5.0 plugin), spec tool.
export const ARMS = {
  A: [null, 0, 0, null], B: [null, 1, 0, null],
  F: ['as', 0, 0, null], G: ['sp', 0, 0, null], H: ['ecc', 0, 0, null],
  I: ['as', 0, 0, 'openspec'], J: ['sp', 0, 0, 'openspec'], K: ['ecc', 0, 0, 'openspec'],
  L: ['as', 1, 1, null], M: ['sp', 1, 1, null], N: ['ecc', 1, 1, null],
  C: ['as', 1, 1, 'openspec'], D: ['sp', 1, 1, 'openspec'], E: ['ecc', 1, 1, 'openspec'],
  O: [null, 1, 0, 'openspec'], P: [null, 1, 0, 'speckit'], AB: [null, 0, 0, 'openspec'], AC: [null, 0, 0, 'speckit'],
  V: ['mp', 0, 0, null], W: ['mp', 0, 0, 'openspec'], X: ['mp', 1, 1, null], Y: ['mp', 1, 1, 'openspec'],
  AD: ['mp', 1, 'v3', null], AE: ['mp', 1, 'v3', 'openspec'], AF: ['mp', 1, 0, null], AG: ['mp', 1, 'v4', null], AH: ['mp', 1, 'v5', null],
  AL: ['mp', 1, 'v6', null], AM: ['mp', 1, 'v7', null], AN: ['mp', 0, 'v6', null],
};

// What the init event and hooks must show per arm; any other arm's marker in the listing invalidates the trial.
function expect(fw, pt, bk, spec) {
  const e = { plugins: [], skills: [], agents: [], mcp: [], hooks: [] };
  if (fw === 'as') e.plugins.push('agent-skills'), e.skills.push('agent-skills:test-driven-development');
  if (fw === 'sp') e.plugins.push('superpowers'), e.skills.push('superpowers:brainstorming'), e.hooks.push('superpowers');
  if (fw === 'ecc') e.skills.push('tdd-workflow'), e.agents.push('planner', 'code-reviewer');
  if (fw === 'mp') e.plugins.push('mattpocock-skills'), e.skills.push('mattpocock-skills:tdd');
  if (pt) e.plugins.push('ponytail'), e.skills.push('ponytail:ponytail'), e.hooks.push('PONYTAIL MODE ACTIVE');
  if (bk === 'v6' || bk === 'v7') e.plugins.push('benchkeeper'), e.skills.push('find-skills', 'benchkeeper:following-dev-workflow');
  else if (bk) e.skills.push('find-skills', ['v3', 'v4', 'v5'].includes(bk) ? 'following-dev-workflow' : 'project-setup', 'playwright-best-practices'), e.mcp.push('playwright');
  if (spec === 'openspec') e.skills.push('openspec-propose');
  if (spec === 'speckit') e.skills.push('speckit-specify');
  return e;
}
export const EXPECT = Object.fromEntries(Object.entries(ARMS).map(([arm, a]) => [arm, expect(...a)]));
const MARKERS = [...new Set(Object.values(EXPECT).flatMap((e) => [...e.skills, ...(e.agents || [])]))];

// Every init event (first turn, follow-ups, resumes after a background agent) must match the arm.
export function audit(events, arm) {
  const inits = events.filter((e) => e.type === 'system' && e.subtype === 'init');
  if (!inits.length) return { ok: false, problems: ['no init event'] };
  const results = inits.map((init) => auditInit(init, events, arm));
  const problems = [...new Set(results.flatMap((r) => r.problems))];
  // Once per session: a follow-up turn resumes the session, and some hooks (Superpowers) do not fire on resume,
  // while the first turn's hook output stays in the continued conversation.
  const starts = events.filter((e) => e.subtype === 'hook_response' && e.hook_name === 'SessionStart:startup').map((e) => e.output || '');
  for (const h of EXPECT[arm].hooks) if (!starts.some((o) => o.includes(h))) problems.push(`no SessionStart:startup output "${h}"`);
  // A server pending at a follow-up turn counts as connected there (auditInit), but pending at every turn never started.
  for (const n of EXPECT[arm].mcp || []) if (!inits.some((e) => (e.mcp_servers || []).some((m) => m.name === n && m.status === 'connected'))) problems.push(`mcp ${n} never connected`);
  return { ...results[0], ok: problems.length === 0, problems };
}

function auditInit(init, events, arm) {
  const want = EXPECT[arm];
  const plugins = (init.plugins || []).filter((p) => p.path !== 'builtin').map((p) => p.name).sort();
  const listed = new Set([...(init.skills || []), ...(init.agents || [])]);
  const hookOut = events.filter((e) => e.subtype === 'hook_response' && e.hook_event === 'SessionStart').map((e) => e.output).join('\n');
  const problems = [];
  if (plugins.join() !== [...want.plugins].sort().join()) problems.push(`plugins ${plugins.join(',') || 'none'}`);
  const expected = [...want.skills, ...(want.agents || [])];
  for (const m of expected) if (!listed.has(m)) problems.push(`missing ${m}`);
  for (const m of MARKERS) if (!expected.includes(m) && listed.has(m)) problems.push(`unexpected ${m}`);
  // A configured server may still be starting when a follow-up turn begins: pending counts like connected.
  const mcp = (init.mcp_servers || []).map((s) => `${s.name}:${s.status === 'pending' ? 'connected' : s.status}`).sort();
  if (mcp.join() !== (want.mcp || []).map((n) => `${n}:connected`).join()) problems.push(`mcp ${(init.mcp_servers || []).map((s) => `${s.name}:${s.status}`).sort().join(',') || 'none'}`);
  if (!want.hooks.length && hookOut.trim()) problems.push('unexpected SessionStart output');
  return { ok: problems.length === 0, problems, model: init.model, claude_code_version: init.claude_code_version, plugins };
}

const TEST = /(^|\/)(tests?|__tests__|e2e|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$/;
const SOURCE = /\.([cm]?[jt]sx?|html|css)$/;
const CONFIG = /(^|\/)[^/]*\.config\.[cm]?[jt]s$/;

// Tool uses of a Claude Code stream-json transcript, main thread and subagents.
const claudeUses = (events) => events.filter((e) => e.type === 'assistant').flatMap((e) => (e.message?.content || [])
  .filter((c) => c.type === 'tool_use').map((c) => ({ name: c.name, input: c.input || {}, sub: Boolean(e.parent_tool_use_id) })));

// uses: [{ name, input: { file_path, skill, subagent_type, command }, sub }]; OpenCode trials pass theirs (opencode.mjs).
export function workflow(events, uses = claudeUses(events)) {
  // Files written by edit tools or by shell commands (`cat > f <<EOF`, which OpenCode agents use often).
  const writes = uses.flatMap((u) => (['Write', 'Edit', 'MultiEdit'].includes(u.name) ? [String(u.input.file_path || '')]
    : u.name === 'Bash' && shellWriteTarget(u.input.command) ? [shellWriteTarget(u.input.command)] : []));
  const firstTest = writes.findIndex((p) => TEST.test(p));
  const firstSource = writes.findIndex((p) => SOURCE.test(p) && !TEST.test(p) && !CONFIG.test(p));
  const skills = uses.filter((u) => u.name === 'Skill').map((u) => u.input.skill || u.input.command || '?');
  const agents = uses.filter((u) => u.name === 'Agent' || u.name === 'Task').map((u) => u.input.subagent_type || 'general-purpose');
  // Planning before the first source edit: a plan or spec file (also a spec tool's artifacts), a planning skill or a
  // planning agent. Checks run after the last source edit: a test, build, lint or type check command.
  const PLAN_FILE = /(plan|spec|design|brainstorm|requirement|proposal|tasks|adr)[^/]*\.md$|(^|\/)(openspec|\.specify|specs|docs\/(adr|plans?|superpowers))\//i;
  const planIndex = uses.findIndex((u) => (['Write', 'Edit', 'MultiEdit'].includes(u.name) && PLAN_FILE.test(String(u.input.file_path || '')))
    || (u.name === 'Skill' && /plan|spec|brainstorm|grill|propos|prd|design/i.test(String(u.input.skill || u.input.command || '')))
    || ((u.name === 'Agent' || u.name === 'Task') && /plan/i.test(String(u.input.subagent_type || ''))) || u.name === 'EnterPlanMode');
  const sourceIndex = uses.findIndex((u) => ['Write', 'Edit', 'MultiEdit'].includes(u.name) && SOURCE.test(String(u.input.file_path || '')) && !TEST.test(String(u.input.file_path || '')) && !CONFIG.test(String(u.input.file_path || '')));
  const lastSource = uses.findLastIndex((u) => ['Write', 'Edit', 'MultiEdit'].includes(u.name) && SOURCE.test(String(u.input.file_path || '')));
  const CHECK = /\b(npm (run )?test|npx (mocha|vitest|jest|tsc)|mocha|vitest|jest|tsc\b|npm run (build|lint|typecheck))/;
  const last = uses.at(-1);
  // Tier lines the agent wrote (`Tier: quick`), from the main thread's text.
  const tiers = events.filter((e) => e.type === 'assistant' && !e.parent_tool_use_id).flatMap((e) => (e.message?.content || [])
    .filter((c) => c.type === 'text').flatMap((c) => [...(c.text || '').matchAll(/^[^\w\n]*Tier[^\w\n]*:[^\w\n]*(\w+)/gim)].map((m) => m[1].toLowerCase())));
  return {
    tool_calls: uses.length,
    subagent_tool_calls: uses.filter((u) => u.sub).length,
    skills,
    agents,
    tiers,
    plan_or_spec_files: writes.filter((p) => /\.md$/i.test(p) && /(plan|spec|design|brainstorm|requirement)/i.test(p)),
    tests_written: firstTest >= 0,
    tests_first: firstTest >= 0 && (firstSource < 0 || firstTest < firstSource),
    plan_first: planIndex >= 0 && (sourceIndex < 0 || planIndex < sourceIndex),
    verified: uses.some((u, i) => i > lastSource && u.name === 'Bash' && CHECK.test(String(u.input.command || ''))),
    // A review skill or agent type, or a general subagent whose task description names a review.
    review: [...skills, ...agents].some((n) => /review/i.test(n))
      || uses.some((u) => (u.name === 'Agent' || u.name === 'Task') && /review/i.test(u.input.description || '')),
    last_tool: last ? `${last.name} ${String(last.input.command || last.input.file_path || last.input.skill || '').slice(0, 80)}` : null,
  };
}

export function outcome(events) {
  // Cost and per-model usage in a result event are cumulative for its session, also across follow-up turns
  // (`--continue` keeps the session), so the last result per session_id counts.
  const results = events.filter((e) => e.type === 'result');
  const r = results.at(-1);
  if (!r) return { finished: false };
  const last = [...new Map(results.map((e) => [e.session_id, e])).values()];
  const models = last.flatMap((e) => Object.values(e.modelUsage || {}));
  const sum = (k) => models.reduce((n, m) => n + (m[k] || 0), 0);
  const text = String(r.result || '');
  return {
    finished: true,
    subtype: r.subtype,
    is_error: r.is_error,
    infra_error: /usage limit|session limit|weekly limit|hit your .*limit|rate limit|overloaded|\b429\b|\b529\b|\b401\b|authenticat|oauth|log ?in/i.test(text) && r.is_error,
    ends_with_question: /\?\s*$/.test(text.trim()),
    duration_ms: r.duration_ms,
    result_events: results.length,
    // Main-thread assistant messages, counted once by message id (num_turns overlaps across result events).
    turns: new Set(events.filter((e) => e.type === 'assistant' && !e.parent_tool_use_id).map((e) => e.message?.id)).size,
    sessions: last.length,
    cost_usd_api_equivalent: last.reduce((n, e) => n + (e.total_cost_usd || 0), 0),
    usage: models.length ? {
      input: sum('inputTokens'), cache_creation: sum('cacheCreationInputTokens'),
      cache_read: sum('cacheReadInputTokens'), output: sum('outputTokens'), thinking: sum('thinkingTokens'),
    } : null,
  };
}

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', 'test-results', 'playwright-report']);
export function lines(dir) {
  const out = { source: 0, test: 0, files: 0 };
  const walk = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const n = e.name;
      if (SKIP.has(n) || n === 'package-lock.json') continue;
      const p = join(d, n), r = rel ? `${rel}/${n}` : n;
      if (e.isDirectory()) walk(p, r);
      else if (e.isFile() && SOURCE.test(n)) {
        const count = readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).length;
        out.files++;
        out[TEST.test(r) ? 'test' : 'source'] += count;
      }
    }
  };
  if (existsSync(dir)) walk(dir, '');
  return out;
}

// Maintenance facts from the delivered workspace: what a later maintainer finds without asking anyone.
export function maintenance(ws) {
  const has = (p) => existsSync(join(ws, p));
  const read = (p) => { try { return readFileSync(join(ws, p), 'utf8'); } catch { return ''; } };
  const pkg = (() => { try { return JSON.parse(read('package.json')); } catch { return {}; } })();
  const readme = read('README.md');
  const ci = has('.github/workflows') && readdirSync(join(ws, '.github/workflows')).some((f) => /\.ya?ml$/.test(f));
  return {
    readme: readme.length > 0,
    readme_setup: /npm (i|install|ci)\b/.test(readme) && /npm (start|run)/.test(readme),
    lockfile: has('package-lock.json') || has('pnpm-lock.yaml') || has('yarn.lock'),
    test_script: Boolean(pkg.scripts?.test) && !/no test specified/.test(pkg.scripts.test),
    lint_or_typecheck: Boolean(pkg.scripts?.lint || pkg.scripts?.typecheck || pkg.scripts?.['type-check']),
    ci,
    node_version: Boolean(pkg.engines?.node) || has('.nvmrc') || has('.node-version'),
    changelog: has('CHANGELOG.md'),
    docs: has('docs') || has('openspec/specs') || has('specs'),
  };
}

export function score(dir) {
  const read = (f) => { try { return JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { return null; } };
  const exit = (f) => { try { return Number(readFileSync(join(dir, `${f}.exit`), 'utf8')); } catch { return null; } };
  const pw = read('acceptance.json');
  // A feature passes only when its test ran and passed; Playwright's `ok` is also true for skipped tests.
  const specs = (pw ? collect(pw) : []).map((s) => ({ title: s.title, ok: s.tests.every((t) => t.results.at(-1)?.status === 'passed') }));
  const lh = read('lighthouse.json');
  const axe = read('axe.json');
  const vulns = read('audit.log')?.metadata?.vulnerabilities;
  // The brief's pages when the scorer copied its settings (brief.json), the winery pages otherwise.
  const pages = read('brief.json')?.axe_pages ?? AXE_PAGES;
  return {
    install: exit('install'), build: exit('build'), acceptance_run: exit('acceptance'), agent_tests: exit('agent-tests'),
    // Features: every test that is not a robustness (R) or step (S) test (winery F1 to F6, cartridges C1 to C6).
    features: Object.fromEntries(specs.filter(isFeature).map((s) => [s.title.split(' ')[0], s.ok])),
    features_passed: specs.filter((s) => isFeature(s) && s.ok).length,
    // Robustness tests (protocol v1.7) are scored apart from the features; null for trials scored before them.
    robustness: specs.some((s) => s.title.startsWith('R')) ? Object.fromEntries(specs.filter((s) => s.title.startsWith('R')).map((s) => [s.title.split(' ')[0], s.ok])) : null,
    robustness_passed: specs.some((s) => s.title.startsWith('R')) ? specs.filter((s) => s.title.startsWith('R') && s.ok).length : null,
    // Iterative briefs: one test per change request (titles S1, S2, ...); strict means every test that ran passed.
    changes: specs.some((s) => /^S\d/.test(s.title)) ? Object.fromEntries(specs.filter((s) => /^S\d/.test(s.title)).map((s) => [s.title.split(' ')[0], s.ok])) : null,
    strict: specs.length ? specs.every((s) => s.ok) : null,
    code: code(dir),
    // Violations per page; null unless all pages were scanned, so a broken app does not score fewer violations.
    axe: axe && pages.every((k) => axe[k]) ? Object.fromEntries(pages.map((k) => [k, axe[k].length])) : null,
    lighthouse: lh?.categories ? Object.fromEntries(Object.entries(lh.categories).map(([k, v]) => [k, v.score])) : null,
    audit: vulns ? { high: vulns.high + vulns.critical, total: vulns.total } : null,
    mutation: mutation(dir),
    hidden_tests: (() => { try { return readFileSync(join(dir, 'hidden.sha256'), 'utf8').trim(); } catch { return null; } })(),
  };
}
const AXE_PAGES = ['start', 'confirmation', 'form', 'staff'];

// Code metrics from the scorer (erosion.mjs and jscpd), null when the metrics step did not run.
export function code(dir) {
  const read = (f) => { try { return JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { return null; } };
  const e = read('erosion.json'), d = read('jscpd/jscpd-report.json')?.statistics?.total;
  if (!e) return null;
  return { ...e, duplication: d ? Math.round(10 * d.percentage) / 10 : null, duplicated_lines: d?.duplicatedLines ?? null, clones: d?.clones ?? null };
}

// Iterative briefs: the scores after each change request (checkpoints/<k>/, written by the runner), then the final score.
export function checkpoints(dir) {
  const root = join(dir, 'checkpoints');
  if (!existsSync(root)) return null;
  const ks = readdirSync(root).filter((k) => /^\d+$/.test(k)).map(Number).sort((a, b) => a - b);
  return [...ks.map((k) => ({ k, ...score(join(root, String(k))) })), { k: ks.length, ...score(join(dir, 'score')) }];
}

// Step briefs (brief.json "steps": "sessions"): per step its checks (S<k> and cross-step X<k>, checks.json; ok null when
// not checkable, left out of the total), the repository's suite (suite.json), minutes, whether the first turn's final
// message waited, follow-ups, cost and tokens of the step's transcript lines, and the subscription usage before and after.
// shortcut: cost per step reads Claude Code result events only (OpenCode steps get null), upgrade when an OpenCode arm runs a step brief.
export function steps(dir) {
  let ks;
  try { ks = readdirSync(join(dir, 'steps')).filter((k) => /^\d+$/.test(k)).map(Number).sort((a, b) => a - b); } catch { return null; }
  if (!ks.length) return null;
  let lines = [];
  try { lines = readFileSync(join(dir, 'transcript.jsonl'), 'utf8').split('\n'); } catch { /* no transcript */ }
  return ks.map((k) => {
    const d = join(dir, 'steps', String(k));
    const txt = (f) => { try { return readFileSync(join(d, f), 'utf8').trim(); } catch { return null; } };
    const json = (f) => { try { return JSON.parse(txt(f)); } catch { return null; } };
    const num = (f) => (txt(f) ? Number(txt(f)) : null);
    const checks = json('checks.json')?.checks?.map(({ id, ok }) => ({ id, ok })) ?? null;
    const suite = json('suite.json');
    const [from, to] = (txt('lines') || '').split(' ').map(Number);
    const ev = Number.isInteger(to) ? lines.slice(from, to).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }) : null;
    const o = ev && outcome(ev);
    return {
      k, checks,
      passed: checks ? checks.filter((c) => c.ok === true).length : null,
      total: checks ? checks.filter((c) => c.ok !== null).length : null,
      suite_ok: suite ? suite.ok === true : null,
      minutes: num('start') && num('end') ? Math.round((num('end') - num('start')) / 6) / 10 : null,
      waited: txt('waited') == null ? null : txt('waited') === '1',
      followups: num('followups'),
      // The agent asked through the tool for questions (deliberate ambiguity measure, next to `waited`).
      ask_user_calls: ev ? claudeUses(ev).filter((u) => u.name === 'AskUserQuestion').length : null,
      // The step's own workflow trace: skills, agents, plan and test order, review, checks after the last edit.
      workflow: ev ? workflow(ev) : null,
      cost_usd_api_equivalent: o?.finished ? o.cost_usd_api_equivalent : null,
      tokens: o?.usage ?? null,
      usage: usage(txt('usage-before'), txt('usage-after')),
    };
  });
}

// Usage gate readings ("<5h utilization> <5h reset> <7d utilization> <7d reset>", bench/run-brief.sh): the share of each
// limit a step used, null when a reading failed ("0 0 0 0") or the window reset in between.
export function usage(before, after) {
  const parse = (s) => {
    const [five_hour, five_hour_reset, weekly, weekly_reset] = String(s ?? '').split(' ').map(Number);
    return five_hour_reset && weekly_reset ? { five_hour, five_hour_reset, weekly, weekly_reset } : null;
  };
  const [b, a] = [parse(before), parse(after)];
  if (!b && !a) return null;
  const share = (u, r) => (b && a && b[r] === a[r] ? Math.round(1e4 * (a[u] - b[u])) / 1e4 : null);
  return { before: b, after: a, five_hour_share: share('five_hour', 'five_hour_reset'), weekly_share: share('weekly', 'weekly_reset') };
}

// The testing method that produced the scores: protocol version (bench/PROTOCOL.md when the trial was scored or
// re-parsed), hidden tests hash, BenchKeeper layer version (the runner's `bk` file; v1 before it was recorded).
export function method(dir, protocolFile = new URL('../PROTOCOL.md', import.meta.url)) {
  const read = (f) => { try { return readFileSync(f, 'utf8'); } catch { return null; } };
  return {
    protocol: /^Version (\d+\.\d+)/m.exec(read(protocolFile) || '')?.[1] || null,
    hidden_tests: read(join(dir, 'score', 'hidden.sha256'))?.trim() || null,
    bk: read(join(dir, 'bk'))?.trim() || 'v1',
  };
}

// Mutation score of the agent's own tests (bench/scorer/mutation.sh): killed and timed-out mutants count as detected,
// Stryker's convention; compile and runtime errors and ignored mutants are left out. Unmeasured: score null and a reason.
const MUTATION_REASONS = { 10: 'npm install failed', 11: 'no test script', 12: 'mutation tool install failed', 13: 'mutation run failed', 124: 'time limit', 137: 'time limit' };
export function mutation(dir) {
  let rc = null;
  try { rc = Number(readFileSync(join(dir, 'mutation.exit'), 'utf8')); } catch { return null; }
  if (rc !== 0) return { score: null, reason: MUTATION_REASONS[rc] || `exit ${rc}` };
  let r;
  try { r = JSON.parse(readFileSync(join(dir, 'mutation.json'), 'utf8')); } catch { return { score: null, reason: 'unreadable report' }; }
  const n = { killed: 0, timeout: 0, survived: 0, no_coverage: 0, mutants: 0 };
  const key = { Killed: 'killed', Timeout: 'timeout', Survived: 'survived', NoCoverage: 'no_coverage' };
  for (const f of Object.values(r.files || {})) for (const m of f.mutants || []) { n.mutants++; if (key[m.status]) n[key[m.status]]++; }
  const counted = n.killed + n.timeout + n.survived + n.no_coverage;
  // No mutant killed by a failing test, only time-outs: the suite did not run under the tool (seen with TypeScript 7).
  if (!n.killed && n.timeout) return { score: null, ...n, reason: 'only time-outs' };
  return { score: counted ? Math.round(1000 * (n.killed + n.timeout) / counted) / 10 : null, ...n, ...(counted ? {} : { reason: 'no mutants' }) };
}
const collect = (o) => [...(o.specs || []), ...(o.suites || []).flatMap(collect)];
const isFeature = (s) => !/^[RS]\d/.test(s.title);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [dir, arm] = process.argv.slice(2);
  const events = readFileSync(join(dir, 'transcript.jsonl'), 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  const wall = (f) => { try { return Number(readFileSync(join(dir, f), 'utf8')); } catch { return null; } };
  const followups = wall('followups');
  const oc = OPENCODE_ARMS.includes(arm);
  const all = oc ? sessions(join(dir, 'log')) : [];
  const st = steps(dir);
  const trial = {
    arm, runtime: oc ? 'opencode' : 'claude-code', followups, wall_seconds: wall('end') - wall('start') || null,
    audit: oc ? ocAudit(join(dir, 'log'), arm) : audit(events, arm),
    outcome: oc ? ocOutcome(events, all) : outcome(events),
    workflow: oc ? workflow(events, ocUses(events, all)) : workflow(events),
    score: score(join(dir, 'score')), lines: lines(join(dir, 'workspace')), maintenance: maintenance(join(dir, 'workspace')),
    condition: existsSync(join(dir, 'condition')) ? readFileSync(join(dir, 'condition'), 'utf8').trim() : 'empty',
    checkpoints: checkpoints(dir),
    steps: st,
    steps_sent: wall('steps') ?? st?.length ?? null,
    method: method(dir),
  };
  // Per-phase and per-subagent measurements, only for trials the runner marked (PHASES=1).
  if (existsSync(join(dir, 'log', 'phases'))) trial.phases = oc ? opencodePhases(all) : claudePhases(events, trial.outcome.cost_usd_api_equivalent || 0);
  writeFileSync(join(dir, 'trial.json'), JSON.stringify(trial, null, 2) + '\n');
}
