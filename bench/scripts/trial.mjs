// Turns one brief trial (stream-json transcript, workspace, scorer output) into trial.json:
// delivery audit, workflow trace, usage, scores and line counts.
// Usage: node bench/scripts/trial.mjs <trial-dir> <arm>   (reads transcript.jsonl, workspace/, score/; writes trial.json)
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// What the init event and hooks must show per arm; any other arm's marker in the listing invalidates the trial.
export const EXPECT = {
  A: { plugins: [], skills: [], hooks: [] },
  B: { plugins: ['ponytail'], skills: ['ponytail:ponytail'], hooks: ['PONYTAIL MODE ACTIVE'] },
  C: { plugins: ['agent-skills', 'ponytail'], skills: ['ponytail:ponytail', 'find-skills', 'project-setup', 'agent-skills:test-driven-development'], hooks: ['PONYTAIL MODE ACTIVE'] },
  D: { plugins: ['ponytail', 'superpowers'], skills: ['ponytail:ponytail', 'find-skills', 'project-setup', 'superpowers:brainstorming'], hooks: ['PONYTAIL MODE ACTIVE', 'superpowers'] },
  E: { plugins: ['ponytail'], skills: ['ponytail:ponytail', 'find-skills', 'project-setup', 'tdd-workflow'], agents: ['planner', 'code-reviewer'], hooks: ['PONYTAIL MODE ACTIVE'] },
};
const MARKERS = [...new Set(Object.values(EXPECT).flatMap((e) => [...e.skills, ...(e.agents || [])]))];

export function audit(events, arm) {
  const init = events.find((e) => e.type === 'system' && e.subtype === 'init');
  if (!init) return { ok: false, problems: ['no init event'] };
  const want = EXPECT[arm];
  const plugins = (init.plugins || []).filter((p) => p.path !== 'builtin').map((p) => p.name).sort();
  const listed = new Set([...(init.skills || []), ...(init.agents || [])]);
  const hookOut = events.filter((e) => e.subtype === 'hook_response' && e.hook_event === 'SessionStart').map((e) => e.output).join('\n');
  const problems = [];
  if (plugins.join() !== [...want.plugins].sort().join()) problems.push(`plugins ${plugins.join(',') || 'none'}`);
  const expected = [...want.skills, ...(want.agents || [])];
  for (const m of expected) if (!listed.has(m)) problems.push(`missing ${m}`);
  for (const m of MARKERS) if (!expected.includes(m) && listed.has(m)) problems.push(`unexpected ${m}`);
  for (const h of want.hooks) if (!hookOut.includes(h)) problems.push(`no hook output "${h}"`);
  if (!want.hooks.length && hookOut.trim()) problems.push('unexpected SessionStart output');
  return { ok: problems.length === 0, problems, model: init.model, claude_code_version: init.claude_code_version, plugins };
}

const TEST = /(^|\/)(tests?|__tests__|e2e|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$/;
const SOURCE = /\.([cm]?[jt]sx?|html|css)$/;
const CONFIG = /(^|\/)[^/]*\.config\.[cm]?[jt]s$/;

export function workflow(events) {
  const uses = events.filter((e) => e.type === 'assistant').flatMap((e) => (e.message?.content || [])
    .filter((c) => c.type === 'tool_use').map((c) => ({ name: c.name, input: c.input || {}, sub: Boolean(e.parent_tool_use_id) })));
  const writes = uses.filter((u) => ['Write', 'Edit', 'MultiEdit'].includes(u.name)).map((u) => String(u.input.file_path || ''));
  const firstTest = writes.findIndex((p) => TEST.test(p));
  const firstSource = writes.findIndex((p) => SOURCE.test(p) && !TEST.test(p) && !CONFIG.test(p));
  const skills = uses.filter((u) => u.name === 'Skill').map((u) => u.input.skill || u.input.command || '?');
  const agents = uses.filter((u) => u.name === 'Agent' || u.name === 'Task').map((u) => u.input.subagent_type || 'general-purpose');
  const last = uses.at(-1);
  return {
    tool_calls: uses.length,
    subagent_tool_calls: uses.filter((u) => u.sub).length,
    skills,
    agents,
    plan_or_spec_files: writes.filter((p) => /\.md$/i.test(p) && /(plan|spec|design|brainstorm|requirement)/i.test(p)),
    tests_written: firstTest >= 0,
    tests_first: firstTest >= 0 && (firstSource < 0 || firstTest < firstSource),
    review: [...skills, ...agents].some((n) => /review/i.test(n)),
    last_tool: last ? `${last.name} ${String(last.input.command || last.input.file_path || last.input.skill || '').slice(0, 80)}` : null,
  };
}

export function outcome(events) {
  const r = events.findLast((e) => e.type === 'result');
  if (!r) return { finished: false };
  const text = String(r.result || '');
  return {
    finished: true,
    subtype: r.subtype,
    is_error: r.is_error,
    infra_error: /usage limit|rate limit|overloaded|\b429\b|\b529\b|\b401\b|authenticat|oauth|log ?in/i.test(text) && r.is_error,
    ends_with_question: /\?\s*$/.test(text.trim()),
    duration_ms: r.duration_ms,
    num_turns: r.num_turns,
    cost_usd_api_equivalent: r.total_cost_usd,
    usage: r.usage && {
      input: r.usage.input_tokens, cache_creation: r.usage.cache_creation_input_tokens,
      cache_read: r.usage.cache_read_input_tokens, output: r.usage.output_tokens,
    },
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

export function score(dir) {
  const read = (f) => { try { return JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { return null; } };
  const exit = (f) => { try { return Number(readFileSync(join(dir, `${f}.exit`), 'utf8')); } catch { return null; } };
  const pw = read('acceptance.json');
  // A feature passes only when its test ran and passed; Playwright's `ok` is also true for skipped tests.
  const specs = (pw ? collect(pw) : []).map((s) => ({ title: s.title, ok: s.tests.every((t) => t.results.at(-1)?.status === 'passed') }));
  const lh = read('lighthouse.json');
  const axe = read('axe.json');
  const vulns = read('audit.log')?.metadata?.vulnerabilities;
  return {
    install: exit('install'), build: exit('build'), acceptance_run: exit('acceptance'), agent_tests: exit('agent-tests'),
    features: Object.fromEntries(specs.map((s) => [s.title.split(' ')[0], s.ok])),
    features_passed: specs.filter((s) => s.ok).length,
    // Violations per page; null unless all four pages were scanned, so a broken app does not score fewer violations.
    axe: axe && AXE_PAGES.every((k) => axe[k]) ? Object.fromEntries(AXE_PAGES.map((k) => [k, axe[k].length])) : null,
    lighthouse: lh?.categories ? Object.fromEntries(Object.entries(lh.categories).map(([k, v]) => [k, v.score])) : null,
    audit: vulns ? { high: vulns.high + vulns.critical, total: vulns.total } : null,
  };
}
const AXE_PAGES = ['start', 'confirmation', 'form', 'staff'];
const collect = (o) => [...(o.specs || []), ...(o.suites || []).flatMap(collect)];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [dir, arm] = process.argv.slice(2);
  const events = readFileSync(join(dir, 'transcript.jsonl'), 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  const wall = (f) => { try { return Number(readFileSync(join(dir, f), 'utf8')); } catch { return null; } };
  const trial = { arm, wall_seconds: wall('end') - wall('start') || null, audit: audit(events, arm), outcome: outcome(events), workflow: workflow(events), score: score(join(dir, 'score')), lines: lines(join(dir, 'workspace')) };
  writeFileSync(join(dir, 'trial.json'), JSON.stringify(trial, null, 2) + '\n');
}
