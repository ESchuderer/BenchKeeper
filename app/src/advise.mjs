// Setup suggestions from an agent: one read-only session in the project, started only after the user agreed in the UI.
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { agentEnv } from './childenv.mjs';
import { ENVS, isEnv } from './steps/project.mjs';

// The flag that keeps an agent from saving the session to disk, where the installed CLI has it: read from the CLI's help
// (cached per context), never from a prompt. A CLI without the flag runs as before.
const NO_TRACE = { claude: ['--no-session-persistence', ['claude', '--help']], codex: ['--ephemeral', ['codex', 'exec', '--help']] };
const probed = new WeakMap();
export function noTrace(ctx, agent) {
  const [flag, help] = NO_TRACE[agent];
  if (!probed.has(ctx)) probed.set(ctx, new Map());
  const seen = probed.get(ctx);
  if (!seen.has(agent)) {
    const r = ctx.run(help, { timeout: 30e3, env: agentEnv() });
    seen.set(agent, r.code === 0 && new RegExp(`(^|\\s)${flag}(\\s|$)`, 'm').test(r.stdout));
  }
  return seen.get(agent) ? [flag] : [];
}

// The folder Codex is installed in: its sandbox starts a helper from there, so the profile must let it read it.
// The npm package root, else the binary's own folder (never two levels up: for ~/bin/codex that is the home folder).
function codexHome() {
  for (const d of (process.env.PATH ?? '').split(delimiter)) {
    const bin = join(d, 'codex');
    if (!d || !existsSync(bin)) continue;
    const real = realpathSync(bin);
    return real.match(/^(.*[\\/]node_modules[\\/]@openai[\\/]codex)[\\/]/)?.[1] ?? dirname(real);
  }
  return null;
}

// Codex: a permission profile that reads only the project, the system's minimal paths and Codex itself, writes
// nothing, and has no network; no web search, and every MCP server the project or user config names turned off.
function codexArgv(ctx, dir, q, out) {
  // Without the list no server can be turned off, so the session does not start.
  const list = ctx.run(['codex', 'mcp', 'list', '--json'], { cwd: dir, timeout: 30e3, env: agentEnv() });
  let servers;
  try { servers = JSON.parse(list.stdout).map((s) => s.name); } catch { throw new Error(`codex mcp list --json failed (${list.code}): ${(list.stderr || list.stdout).trim().slice(-200)}`); }
  const odd = servers.findIndex((n) => typeof n !== 'string' || !/^[\w-]+$/.test(n));
  if (odd >= 0) throw new Error(`the MCP server name ${JSON.stringify(servers[odd] ?? null)} cannot be turned off for this session`);
  const home = codexHome();
  const read = [':minimal', ':workspace_roots', ...(home ? [home] : [])].map((p) => `${JSON.stringify(p)}="read"`).join(', ');
  // sandbox_mode read-only too: a Codex that ignores the profile still writes nothing. Codex 0.163 lets the profile win
  // over any sandbox_mode, also one from the user's config.
  return ['codex', 'exec', '-c', 'sandbox_mode="read-only"', '-c', 'default_permissions="benchkeeper-advice"', '-c', `permissions.benchkeeper-advice.filesystem={${read}}`, '-c', 'web_search="disabled"',
    ...servers.flatMap((n) => ['-c', `mcp_servers.${n}.enabled=false`]), '--skip-git-repo-check', ...noTrace(ctx, 'codex'), '-o', out, q];
}

const ARGV = {
  // --restricted ignores the project's settings (hooks) and confines the file tools, --strict-mcp-config skips its MCP servers.
  claude: (ctx, dir, q) => ['claude', '-p', q, '--restricted', '--strict-mcp-config', '--tools', 'Read,Grep,Glob', '--output-format', 'json', ...noTrace(ctx, 'claude')],
  codex: codexArgv,
};
export const ADVISERS = Object.keys(ARGV);

export function advicePrompt(lib) {
  return [
    'Suggest the agent setup for the repository in the current directory. Read its files (package manifests, CI workflows, docs, .devcontainer/, AGENTS.md); change nothing.',
    'Answer with one JSON object and nothing else: {"env": {"id": "...", "reason": "..."}, "packs": [{"id": "...", "reason": "..."}], "skills": [{"name": "...", "reason": "..."}]}.',
    'Use only ids and names from the lists below. Packs whose skills the project needs; single skills only when no chosen pack has them; only skills the project needs. Each reason is one short sentence naming the file that shows it.',
    '', 'Environments (where the agent and the project commands run):', ...Object.entries(ENVS).map(([id, text]) => `- ${id}: ${text?.split('. ')[0] ?? 'the agent and all commands run on the host'}`),
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

export async function adviseSetup(ctx, { dir, agent, lib, signal }) {
  if (!ADVISERS.includes(agent)) throw new Error(`agent must be one of ${ADVISERS.join(', ')}`);
  const tmp = mkdtempSync(join(tmpdir(), 'bk-advice-'));
  const out = join(tmp, 'answer.txt');
  try {
    const r = await (ctx.runAsync ?? ctx.run)(ARGV[agent](ctx, dir, advicePrompt(lib), out), { cwd: dir, timeout: 5 * 60e3, signal, env: agentEnv() });
    // A session that ended on its own before the cancel keeps its answer.
    if (signal?.aborted && r.code !== 0) throw new Error('cancelled');
    if (r.code !== 0) throw new Error(`${agent} exited with ${r.code}: ${(r.stderr || r.stdout || '').trim().slice(-300)}`);
    let text;
    try { text = agent === 'claude' ? JSON.parse(r.stdout).result : readFileSync(out, 'utf8'); } catch { throw new Error(`${agent} gave no answer`); }
    return parseAdvice(text, lib);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
