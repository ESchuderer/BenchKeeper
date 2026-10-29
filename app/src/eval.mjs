// benchkeeper evals: skill trigger rates per skill, agent and model. It starts real agent sessions on the owner's
// subscription, so it never runs in CI. Rule cases run too, and their output is kept for review, not scored.
import { appendFileSync, chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { noTrace } from './advise.mjs';
import { agentEnv, childEnv } from './childenv.mjs';
import { contentDir } from './content.mjs';
import { mask } from './redact.mjs';
import { exists, hashPath, hashText, readText } from './fsx.mjs';
import { inLibrary, loadCases, scopeOf, skillSource, userEvals } from './cases.mjs';

const results = (ctx) => join(userEvals(ctx), 'results.jsonl');

// What a target's result depends on: the skill or rules text, and its cases.
function targetHash(ctx, target, cases) {
  const src = target.startsWith('rule:') ? join(contentDir, 'rules', `${target.slice('rule:'.length)}.md`) : skillSource(ctx, target, cases[0]?.project)?.dir;
  return hashText(`${src ? hashPath(src) : 'missing'}\n${JSON.stringify(cases.map(({ file, ...c }) => c))}`);
}

// --target takes the id of a target, or skill:<name> for an own skill that no library skill shares.
const picked = (only, target) => only.some((t) => t === target || (target.startsWith(`${t}@`) && !inLibrary(t.slice('skill:'.length))));

// Lines that do not parse (a write cut off by a killed run) are left out, as in the results view.
function lastResults(ctx) {
  const last = new Map();
  for (const line of (readText(results(ctx)) ?? '').split('\n').filter(Boolean)) {
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    last.set(`${r.target}|${r.agent}|${r.model ?? ''}`, r);
  }
  return last;
}

// Agent command per case; tool output is read for the skill's SKILL.md or a Skill tool call.
// No session is saved (the transcript would land in the user's own history and on the sessions board; the stream is read from stdout)
// and Claude loads no MCP server, for rule cases too (a skill's trigger rate does not depend on one, and it would run as the user).
// The scratch repository takes no template from the user's git config (a template can bring hooks).
const AGENTS = {
  claude: { argv: (ctx, q, model) => ['claude', '-p', q, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'plan', '--strict-mcp-config', ...noTrace(ctx, 'claude'), ...(model ? ['--model', model] : [])], skills: '.claude/skills' },
  // shortcut: Codex trigger detection reads SKILL.md paths in the JSON events (unverified), check it on the first owner run.
  codex: { argv: (ctx, q, model) => ['codex', 'exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', ...noTrace(ctx, 'codex'), ...(model ? ['-m', model] : []), q], skills: '.agents/skills' },
};
export const EVAL_AGENTS = Object.keys(AGENTS);
export function triggered(output, name) {
  for (const line of output.split('\n')) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const uses = e.message?.content?.filter?.((c) => c.type === 'tool_use') ?? [];
    if (uses.some((u) => u.name === 'Skill' && [name, `benchkeeper:${name}`].includes(u.input?.skill ?? u.input?.command))) return true;
  }
  return new RegExp(`skills/${name}/SKILL\\.md`).test(output);
}

// The runs eval would start: targets whose skill, rules or cases changed since their last stored result (all: every target).
export function evalPlan(ctx, { agents = ['claude'], model, all = false, only } = {}) {
  const last = lastResults(ctx);
  const plan = [];
  for (const [target, cases] of Object.entries(loadCases(ctx))) {
    if (only && !picked(only, target)) continue;
    const project = cases[0].project;
    const source = target.startsWith('skill:') ? skillSource(ctx, target, project) : null;
    // An own skill that was deleted or moved has nothing to measure: no result, not a run of misses.
    if (scopeOf(target) !== 'library' && !source) continue;
    const hash = targetHash(ctx, target, cases);
    for (const agent of agents) if (all || last.get(`${target}|${agent}|${model ?? ''}`)?.hash !== hash) plan.push({ target, agent, model, hash, cases, project });
  }
  return plan;
}

// Each case runs in a fresh scratch repository holding the project skill under test; plugin skills come from the agent's global setup.
// Sessions run through ctx.runAsync when there is one, so a server stays responsive; onCase gets each case before it starts.
// signal aborts: the running session is stopped and the target it belongs to gets no result; finished targets keep theirs.
export async function runEval(ctx, plan, { now = () => new Date().toISOString(), onCase = () => {}, onResult = () => {}, signal } = {}) {
  // The query is the agent's last argument: one that starts with - would be read as an option. Nothing starts before every case is checked.
  for (const p of plan) for (const c of p.cases) if (typeof c.query !== 'string' || !c.query || c.query.startsWith('-')) throw new Error(`case ${c.id} of ${p.target}: the query is empty or starts with a dash (an agent CLI would read it as an option)`);
  const out = [];
  const session = ctx.runAsync ?? ctx.run;
  const total = plan.reduce((n, p) => n + p.cases.length, 0);
  let n = 0;
  for (const p of plan) {
    const a = AGENTS[p.agent];
    const [kind, rest] = p.target.split(':');
    const name = rest.split('@')[0];
    const scope = scopeOf(p.target);
    const source = kind === 'skill' ? skillSource(ctx, p.target, p.project) : null;
    if (scope !== 'library' && !source) throw new Error(`${p.target}: the skill is not in ${scope === 'user' ? 'your skill folders' : p.project} any more`);
    const version = ctx.run([p.agent, '--version'], { env: agentEnv(p.agent) }).stdout.trim();
    const details = [];
    const keep = join(userEvals(ctx), 'outputs', `${now().replace(/[:.]/g, '')}-${p.agent}-${p.target.replace(':', '-')}`);
    // A target that stops (a failed session, a cancel) keeps no outputs: its cases are not a result.
    try {
      for (const c of p.cases) {
        if (signal?.aborted) throw new Error('cancelled');
        const dir = mkdtempSync(join(tmpdir(), 'bk-eval-'));
        try {
          ctx.run(['git', 'init', '-q', '--template=', dir], { env: childEnv({}) });
          writeFileSync(join(dir, 'README.md'), '# Scratch project\n');
          // shortcut: a user skill is also in the real home, so the agent may see two copies; fine while both hold the same text.
          if (kind === 'skill' && source?.copy) cpSync(source.dir, join(dir, a.skills, name), { recursive: true });
          onCase({ index: n++, total, target: p.target, agent: p.agent, case: c.id });
          // The whole stream: the skill call comes early in a long session.
          const r = await session(a.argv(ctx, c.query, p.model), { cwd: dir, keep: 64 * 1024 * 1024, signal, env: agentEnv(p.agent) });
          if (signal?.aborted && r.code !== 0) throw new Error('cancelled');
          // A session that failed to start (a CLI that rejects a flag, a managed MCP setup) is no miss: nothing of this target is stored.
          if (r.code !== 0) throw new Error(`${p.agent} exited with ${r.code} on case ${c.id} of ${p.target}: ${mask((r.stderr || r.stdout || '').trim()).slice(-200)}`);
          if (kind === 'skill') details.push({ id: c.id, should: c.should, triggered: triggered(r.stdout, name), exit: r.code });
          else {
            // Session output can quote files and tokens the agent read: for this user alone, also in folders made before.
            mkdirSync(keep, { recursive: true, mode: 0o700 });
            for (const d of [userEvals(ctx), dirname(keep), keep]) chmodSync(d, 0o700);
            writeFileSync(join(keep, `${c.id}.jsonl`), r.stdout, { mode: 0o600 });
            details.push({ id: c.id, should: c.should, expected: c.expected, review: join(keep, `${c.id}.jsonl`), exit: r.code });
          }
        } finally { rmSync(dir, { recursive: true, force: true }); }
      }
    } catch (e) { rmSync(keep, { recursive: true, force: true }); throw e; }
    const pos = details.filter((d) => d.should && 'triggered' in d), neg = details.filter((d) => !d.should && 'triggered' in d);
    const rate = (list, f) => (list.length ? list.filter(f).length / list.length : null);
    const result = { time: now(), target: p.target, agent: p.agent, agentVersion: version, model: p.model ?? null, hash: p.hash, appVersion: ctx.appVersion,
      cases: details.length, ...(scope !== 'library' && { scope, ...(p.project && { project: p.project }) }), missRate: rate(pos, (d) => !d.triggered), falseTriggerRate: rate(neg, (d) => d.triggered), details };
    mkdirSync(userEvals(ctx), { recursive: true, mode: 0o700 });
    // A line cut off by an earlier write would swallow this result.
    const cut = !(readText(results(ctx)) ?? '\n').endsWith('\n');
    appendFileSync(results(ctx), `${cut ? '\n' : ''}${JSON.stringify(result)}\n`, { mode: 0o600 });
    // Files and folders of an earlier version, and the skill-only path that wrote no output, keep their modes otherwise.
    chmodSync(userEvals(ctx), 0o700);
    chmodSync(results(ctx), 0o600);
    onResult(result);
    out.push(result);
  }
  return out;
}
