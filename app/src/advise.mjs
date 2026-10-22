// Setup suggestions from an agent: one read-only session in the project, started only after the user agreed in the UI.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENVS, isEnv } from './steps/project.mjs';

const ARGV = {
  // --restricted ignores the project's settings (hooks) and confines the file tools, --strict-mcp-config skips its MCP servers.
  claude: (q) => ['claude', '-p', q, '--restricted', '--strict-mcp-config', '--tools', 'Read,Grep,Glob', '--output-format', 'json'],
  codex: (q, out) => ['codex', 'exec', '--sandbox', 'read-only', '--skip-git-repo-check', '-o', out, q],
};
export const ADVISERS = Object.keys(ARGV);

export function advicePrompt(lib) {
  return [
    'Suggest the agent setup for the repository in the current directory. Read its files (package manifests, CI workflows, docs, .devcontainer/, AGENTS.md); change nothing.',
    'Answer with one JSON object and nothing else: {"env": {"id": "...", "reason": "..."}, "packs": [{"id": "...", "reason": "..."}], "skills": [{"name": "...", "reason": "..."}]}.',
    'Use only ids and names from the lists below. Packs whose skills the project needs; single skills only when no chosen pack has them; at most 5 skills in total. Each reason is one short sentence naming the file that shows it.',
    '', 'Environments (where the agent and the project commands run):', ...Object.keys(ENVS).map((id) => `- ${id}`),
    '', 'Packs:', ...lib.packs.map((p) => `- ${p.id}: ${p.pickWhen ?? p.title}${p.skills?.length ? ` (skills: ${p.skills.join(', ')})` : ''}`),
    '', 'Skills:', ...lib.skills.map((s) => `- ${s.name}: ${s.pickWhen ?? ''}`),
  ].join('\n');
}

// The answer comes from a session that read the repository: only known ids pass, reasons are short plain text.
export function parseAdvice(text, lib) {
  const m = String(text ?? '').match(/\{[\s\S]*\}/);
  let j;
  try { j = JSON.parse(m?.[0]); } catch { throw new Error('the agent gave no JSON answer'); }
  const reason = (x) => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const list = (x) => (Array.isArray(x) ? x : []);
  return {
    env: isEnv(j?.env?.id) ? { id: j.env.id, reason: reason(j.env.reason) } : null,
    packs: list(j?.packs).filter((p) => lib.packs.some((x) => x.id === p?.id)).map((p) => ({ id: p.id, reason: reason(p.reason) })),
    skills: list(j?.skills).filter((s) => lib.skills.some((x) => x.name === s?.name)).map((s) => ({ name: s.name, reason: reason(s.reason) })),
  };
}

export async function adviseSetup(ctx, { dir, agent, lib }) {
  if (!ADVISERS.includes(agent)) throw new Error(`agent must be one of ${ADVISERS.join(', ')}`);
  const tmp = mkdtempSync(join(tmpdir(), 'bk-advice-'));
  const out = join(tmp, 'answer.txt');
  try {
    const r = await (ctx.runAsync ?? ctx.run)(ARGV[agent](advicePrompt(lib), out), { cwd: dir, timeout: 5 * 60e3 });
    if (r.code !== 0) throw new Error(`${agent} exited with ${r.code}: ${(r.stderr || r.stdout || '').trim().slice(-300)}`);
    let text;
    try { text = agent === 'claude' ? JSON.parse(r.stdout).result : readFileSync(out, 'utf8'); } catch { throw new Error(`${agent} gave no answer`); }
    return parseAdvice(text, lib);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
