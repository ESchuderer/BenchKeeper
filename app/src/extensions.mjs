// What an agent loads or runs besides rules and skills: MCP servers, hooks, subagents, commands and output styles, read from
// the files only (no agent is started). Per row: owner, the file it comes from, and whether it can run code. Nothing here
// writes. Never in a row: environment values, headers, tokens. A URL shows scheme and host only (a path or query can hold a key);
// a command line is masked like the other reports (redact.mjs), best-effort: a secret in a shape it does not know stays.
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { agent } from './agents.mjs';
import { exists, isDir, readText, real } from './fsx.mjs';
import { activePlugins, display, frontMatter, markdownIn } from './instructions.mjs';
import * as orca from './orca/index.mjs';
import { mask } from './redact.mjs';
import { RULE_AGENTS, writtenPaths } from './rules.mjs';
import { readSettings } from './settings.mjs';

export const EXTENSION_AGENTS = RULE_AGENTS;
export const KINDS = ['mcp', 'hook', 'subagent', 'command', 'style'];
const SHOWN = 240;
const SCOPES = ['managed', 'local', 'project', 'user', 'plugin'];
const clip = (s) => (s.length > SHOWN ? `${s.slice(0, SHOWN)}...` : s);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const parseJson = (text) => { try { return obj(JSON.parse(text)); } catch { return null; } };
const parseToml0 = (text) => { try { return parseToml(text); } catch { return null; } };

// A URL as scheme and host: user info, path, query and fragment can carry a secret.
function safeUrl(u) {
  try { return new URL(String(u)).origin; } catch { return '(not a URL)'; }
}

// Claude Code: a server with a command is stdio unless it says otherwise (https://code.claude.com/docs/en/mcp#transport-types-type-field).
function serverRow(name, def, base) {
  const d = obj(def);
  const transport = d.type === 'streamable-http' ? 'http' : d.type ?? (d.command ? 'stdio' : d.url ? 'http' : 'unknown');
  const stdio = transport === 'stdio' || (!d.type && !!d.command);
  const target = stdio ? clip(mask([d.command, ...(Array.isArray(d.args) ? d.args : [])].filter((x) => typeof x === 'string').join(' ')).trim()) : d.url ? safeUrl(d.url) : '';
  return { ...base, kind: 'mcp', name, transport, detail: target, runsCode: stdio, state: d.enabled === false ? 'off' : 'on' };
}

function hookRows(data, base) {
  const out = [];
  for (const [event, groups] of Object.entries(obj(data?.hooks))) {
    for (const g of Array.isArray(groups) ? groups : []) {
      for (const h of (Array.isArray(obj(g).hooks) ? g.hooks : []).filter((x) => x && typeof x === 'object')) {
        const type = h.type ?? 'command';
        const detail = type === 'command' ? clip(mask(String(h.command ?? '')).trim()) : type === 'http' ? `POST ${safeUrl(h.url)}` : `${type} hook`;
        out.push({ ...base, kind: 'hook', name: event, matcher: typeof g.matcher === 'string' ? g.matcher : null, transport: type, detail, runsCode: type === 'command',
          ide: type === 'command' && orca.ownsHook(h.command) });
      }
    }
  }
  return out;
}

const field = (text, key) => frontMatter(text).match(new RegExp(`^${key}:\\s*(.*)$`, 'm'))?.[1].trim().replace(/^["']|["']$/g, '') ?? '';
// A command whose text runs a shell line (!`cmd`) or a file that carries hooks of its own can run code.
const markdownRunsCode = (text) => /!`[^`\n]+`/.test(text) || /^hooks:/m.test(frontMatter(text));

function fileRows(kind, folder, base) {
  return markdownIn(folder).map((path) => {
    const text = readText(path) ?? '';
    const name = field(text, 'name') || relative(folder, path).replace(/\.md$/, '').split(/[\\/]/).join(':');
    return { ...base, kind, name, file: path, detail: clip(mask(field(text, 'description'), { keys: false })), runsCode: markdownRunsCode(text) };
  });
}

// Codex custom agents: one TOML file each in the agents folders of agents.json, name and description read from it (unverified: no
// official page for the file format was reachable).
function tomlAgentRows(folder) {
  if (!isDir(folder)) return [];
  return readdirSync(folder).filter((f) => f.endsWith('.toml')).sort().map((f) => {
    const t = parseToml0(readText(join(folder, f)) ?? '') ?? {};
    const str = (v) => (typeof v === 'string' ? v : '');
    return { kind: 'subagent', name: str(t.name) || f.replace(/\.toml$/, ''), file: join(folder, f), detail: clip(mask(str(t.description), { keys: false })), runsCode: false };
  });
}

// The ledger names files BenchKeeper wrote; a settings or config file holds the user's entries beside its own, so only a file that is one item counts.
const ownerOf = (scope, path, written, id, kind) => (id?.startsWith('benchkeeper@') || (kind !== 'mcp' && kind !== 'hook' && written.has(real(path))) ? 'BenchKeeper' : scope === 'managed' ? 'managed' : scope === 'plugin' ? 'plugin' : scope === 'project' ? 'project' : 'yours');

// Rows for one agent: { agent, kind, name, scope, owner, file (shown), path, runsCode, detail, transport?, matcher?, state?, removal }.
// removal: Doctor offers to remove it at the full level: the user's global MCP servers, hooks of Claude Code's settings.json and of Codex's hooks.json.
function agentRows(ctx, id, dir, written, problems) {
  const rows = [];
  const add = (scope, path, list, pluginId) => {
    for (const { file = path, ide, ...r } of list) {
      const owner = ownerOf(scope, file, written, pluginId, r.kind);
      rows.push({ agent: id, scope, owner, path: file, shown: display(ctx, dir, file), removal: scope === 'user' && !pluginId && owner === 'yours' && !ide && (r.kind === 'mcp' || (r.kind === 'hook' && (id === 'claude' || file.endsWith('hooks.json')))), ...r, ...(pluginId ? { plugin: pluginId } : {}) });
    }
  };
  const bad = (path) => problems.push({ path, shown: display(ctx, dir, path), message: 'cannot be read or parsed: its entries are missing here' });
  const asScope = (layer) => (layer === 'managed' || layer === 'project' || layer === 'local' ? layer : 'user');
  const settings = readSettings(ctx, id, { dir });
  for (const l of settings) if (l.error) bad(l.path);
  for (const l of settings.filter((x) => !x.error)) add(asScope(l.layer), l.path, hookRows(l.data, {}));

  if (id === 'codex') {
    const bases = [['user', join(ctx.home, '.codex')], ...(dir ? [['project', join(dir, '.codex')]] : [])];
    for (const [scope, folder] of bases) {
      const hooks = join(folder, 'hooks.json');
      if (exists(hooks)) { const data = parseJson(readText(hooks)); if (data) add(scope, hooks, hookRows(data, {})); else bad(hooks); }
      const layer = settings.find((l) => l.layer === scope && !l.error);
      if (layer) add(scope, layer.path, Object.entries(obj(layer.data.mcp_servers)).map(([name, def]) => serverRow(name, def, {})));
      add(scope, join(folder, 'agents'), tomlAgentRows(join(folder, 'agents')));
    }
    return rows;
  }

  // Claude Code: user and local servers live in the .claude.json file of the home folder, project servers in .mcp.json, plugin ones in the plugin.
  const userFile = join(ctx.home, '.claude.json');
  const text = readText(userFile);
  const user = text == null ? {} : parseJson(text);
  if (user === null) bad(userFile);
  const here = dir ? obj(obj(user?.projects)[dir] ?? obj(user?.projects)[real(dir)]) : {};
  const off = new Set([...(here.disabledMcpServers ?? [])]);
  const approvals = settings.filter((l) => !l.error).map((l) => l.data);
  const approved = (n) => approvals.some((d) => d.enableAllProjectMcpServers === true || [d.enabledMcpjsonServers].flat().includes(n));
  const rejected = (n) => approvals.some((d) => [d.disabledMcpjsonServers].flat().includes(n));
  const withState = (r, state) => ({ ...r, state });
  // shortcut: the answer given in the approval prompt is stored where the documentation does not say, so a server approved only there shows "asks first".
  add('user', userFile, Object.entries(obj(user?.mcpServers)).map(([n, d]) => serverRow(n, d, {})).map((r) => withState(r, off.has(r.name) ? 'off' : r.state)));
  if (dir) {
    add('local', userFile, Object.entries(obj(here.mcpServers)).map(([n, d]) => serverRow(n, d, {})).map((r) => withState(r, off.has(r.name) ? 'off' : r.state)));
    const file = join(dir, '.mcp.json');
    const project = exists(file) ? parseJson(readText(file)) : {};
    if (project === null) bad(file);
    add('project', file, Object.entries(obj(project?.mcpServers)).map(([n, d]) => serverRow(n, d, {})).map((r) => withState(r, rejected(r.name) ? 'off' : approved(r.name) ? 'on' : 'asks first')));
  }
  for (const [scope, base] of [['user', ctx.home], ...(dir ? [['project', dir]] : [])]) {
    const c = join(base, '.claude');
    add(scope, join(c, 'agents'), fileRows('subagent', join(c, 'agents'), {}));
    add(scope, join(c, 'commands'), fileRows('command', join(c, 'commands'), {}));
    add(scope, join(c, 'output-styles'), fileRows('style', join(c, 'output-styles'), {}));
  }
  for (const p of activePlugins(ctx, dir)) {
    const hooks = join(p.root, 'hooks/hooks.json');
    if (exists(hooks)) add('plugin', hooks, hookRows(parseJson(readText(hooks)) ?? {}, {}), p.id);
    const servers = [[join(p.root, '.mcp.json'), (d) => d.mcpServers ?? d], [join(p.root, '.claude-plugin/plugin.json'), (d) => d.mcpServers]];
    for (const [file, pick] of servers) {
      const d = exists(file) ? parseJson(readText(file)) : {};
      add('plugin', file, Object.entries(obj(pick(obj(d)))).map(([n, def]) => serverRow(n, def, {})).map((r) => withState(r, off.has(r.name) ? 'off' : r.state)), p.id);
    }
    for (const [kind, folder] of [['subagent', 'agents'], ['command', 'commands'], ['style', 'output-styles']]) add('plugin', join(p.root, folder), fileRows(kind, join(p.root, folder), {}), p.id);
  }
  return rows;
}

const rank = (r) => [KINDS.indexOf(r.kind), SCOPES.indexOf(r.scope)];
// agents: ids of EXTENSION_AGENTS; dir: a project folder, without it the global files.
export function extensionsView(ctx, { agents = EXTENSION_AGENTS, dir } = {}) {
  const written = writtenPaths(ctx);
  return {
    dir: dir ?? null,
    agents: agents.filter((a) => EXTENSION_AGENTS.includes(a)).map((id) => {
      const problems = [];
      const rows = agentRows(ctx, id, dir, written, problems).sort((a, b) => { const [x, y] = [rank(a), rank(b)]; return x[0] - y[0] || x[1] - y[1] || a.name.localeCompare(b.name); });
      return { id, name: agent(id).name, rows, problems };
    }),
  };
}

// Control characters of a repository's own text (an escape sequence in a hook command or a name) must not reach a terminal.
const plain = (s) => String(s).replace(/[\u0000-\u001f\u007f-\u009f]/g, '?');
// The terminal listing of a view, one block per agent.
export function extensionLines(view) {
  return view.agents.flatMap((a) => [a.name, ...a.rows.map((r) => `  ${r.kind.padEnd(8)} ${r.scope.padEnd(8)} ${r.owner.padEnd(12)} ${(r.runsCode ? 'runs code' : '').padEnd(9)} ${r.name}${r.matcher ? ` [${r.matcher}]` : ''}${r.detail ? `  ${r.detail}` : ''}${r.state && r.state !== 'on' ? `  (${r.state})` : ''}  ${r.shown}`), ...a.problems.map((p) => `  note: ${p.shown} ${p.message}`)]).map(plain);
}
