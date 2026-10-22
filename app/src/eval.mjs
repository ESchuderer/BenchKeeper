// benchkeeper eval: skill trigger rates per skill, agent and model. It starts real agent sessions on the owner's
// subscription, so it never runs in CI. Rule cases run too, and their output is kept for review, not scored.
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contentDir } from './content.mjs';
import { exists, hashPath, hashText, readText } from './fsx.mjs';
import { loadCases, userEvals } from './cases.mjs';

const results = (ctx) => join(userEvals(ctx), 'results.jsonl');

// What a target's result depends on: the skill or rules text, and its cases.
export function targetHash(target, cases) {
  const [kind, name] = target.split(':');
  const src = kind === 'rule' ? join(contentDir, 'rules', `${name}.md`) : [join(contentDir, 'skills', name), join(contentDir, 'library', name)].find(exists);
  return hashText(`${src ? hashPath(src) : 'missing'}\n${JSON.stringify(cases.map(({ file, ...c }) => c))}`);
}

export function lastResults(ctx) {
  const last = new Map();
  for (const line of (readText(results(ctx)) ?? '').split('\n').filter(Boolean)) {
    const r = JSON.parse(line);
    last.set(`${r.target}|${r.agent}|${r.model ?? ''}`, r);
  }
  return last;
}

// Agent command per case; tool output is read for the skill's SKILL.md or a Skill tool call.
const AGENTS = {
  claude: { argv: (q, model) => ['claude', '-p', q, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'plan', ...(model ? ['--model', model] : [])], skills: '.claude/skills' },
  // shortcut: Codex trigger detection reads SKILL.md paths in the JSON events (unverified), check it on the first owner run.
  codex: { argv: (q, model) => ['codex', 'exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', ...(model ? ['-m', model] : []), q], skills: '.agents/skills' },
};
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
    if (only && !only.includes(target)) continue;
    const hash = targetHash(target, cases);
    for (const agent of agents) if (all || last.get(`${target}|${agent}|${model ?? ''}`)?.hash !== hash) plan.push({ target, agent, model, hash, cases });
  }
  return plan;
}

// Each case runs in a fresh scratch repository holding the project skill under test; plugin skills come from the agent's global setup.
// Sessions run through ctx.runAsync when there is one, so a server stays responsive; onCase gets each case before it starts.
// signal aborts: the running session is stopped and the target it belongs to gets no result; finished targets keep theirs.
export async function runEval(ctx, plan, { now = () => new Date().toISOString(), onCase = () => {}, signal } = {}) {
  const out = [];
  const session = ctx.runAsync ?? ctx.run;
  const total = plan.reduce((n, p) => n + p.cases.length, 0);
  let n = 0;
  for (const p of plan) {
    const a = AGENTS[p.agent];
    const [kind, name] = p.target.split(':');
    const version = ctx.run([p.agent, '--version']).stdout.trim();
    const details = [];
    const keep = join(userEvals(ctx), 'outputs', `${now().replace(/[:.]/g, '')}-${p.agent}-${p.target.replace(':', '-')}`);
    for (const c of p.cases) {
      if (signal?.aborted) throw new Error('cancelled');
      const dir = mkdtempSync(join(tmpdir(), 'bk-eval-'));
      try {
        ctx.run(['git', 'init', '-q', dir]);
        writeFileSync(join(dir, 'README.md'), '# Scratch project\n');
        const lib = join(contentDir, 'library', name);
        if (kind === 'skill' && exists(lib)) cpSync(lib, join(dir, a.skills, name), { recursive: true });
        onCase({ index: n++, total, target: p.target, agent: p.agent, case: c.id });
        // The whole stream: the skill call comes early in a long session.
        const r = await session(a.argv(c.query, p.model), { cwd: dir, keep: 64 * 1024 * 1024, signal });
        if (signal?.aborted && r.code !== 0) throw new Error('cancelled');
        if (kind === 'skill') details.push({ id: c.id, should: c.should, triggered: triggered(r.stdout, name), exit: r.code });
        else {
          mkdirSync(keep, { recursive: true });
          writeFileSync(join(keep, `${c.id}.jsonl`), r.stdout);
          details.push({ id: c.id, should: c.should, expected: c.expected, review: join(keep, `${c.id}.jsonl`), exit: r.code });
        }
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }
    const pos = details.filter((d) => d.should && 'triggered' in d), neg = details.filter((d) => !d.should && 'triggered' in d);
    const rate = (list, f) => (list.length ? list.filter(f).length / list.length : null);
    const result = { time: now(), target: p.target, agent: p.agent, agentVersion: version, model: p.model ?? null, hash: p.hash, appVersion: ctx.appVersion,
      cases: details.length, missRate: rate(pos, (d) => !d.triggered), falseTriggerRate: rate(neg, (d) => d.triggered), details };
    mkdirSync(userEvals(ctx), { recursive: true });
    appendFileSync(results(ctx), `${JSON.stringify(result)}\n`);
    out.push(result);
  }
  return out;
}
