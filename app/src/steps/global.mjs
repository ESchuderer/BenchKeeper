// Machine setup per detected agent: rules, command rules, plugins, settings, host tools, and everything else
// installed globally, offered for removal (destructive, off by default).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { agent, forAgent, renderRules } from '../agents.mjs';
import { contentDir } from '../content.mjs';
import { exists, listFiles, readText } from '../fsx.mjs';
import { mergeJson, parseJson, setToml } from '../merge.mjs';

export const SKILLS_CLI = '1.7.2';
export const PONYTAIL_REF = 'v5.3.2';
export const PLUGINS = {
  claude: [
    { id: 'benchkeeper@benchkeeper', marketplace: 'benchkeeper', source: 'ESchuderer/BenchKeeper', sparse: ['.claude-plugin', 'plugins'] },
    { id: 'ponytail@ponytail', marketplace: 'ponytail', source: `DietrichGebert/ponytail#${PONYTAIL_REF}` },
    { id: 'mattpocock-skills@claude-plugins-official', marketplace: 'claude-plugins-official', pack: 'matt-pocock' },
  ],
  codex: [
    { id: 'benchkeeper@benchkeeper', marketplace: 'benchkeeper', source: 'ESchuderer/BenchKeeper', sparse: ['.claude-plugin', 'plugins'] },
    { id: 'ponytail@ponytail', marketplace: 'ponytail', source: `DietrichGebert/ponytail@${PONYTAIL_REF}` },
    { id: 'mattpocock-skills@mattpocock', marketplace: 'mattpocock', source: 'mattpocock/skills', pack: 'matt-pocock' },
  ],
};
const KEEP_SKILLS = ['find-skills', 'orca-cli', 'orchestration', 'synced'];
const KEEP_MARKETPLACES = { claude: ['benchkeeper', 'ponytail', 'claude-plugins-official', 'anthropic-plugin-directory'], codex: ['benchkeeper', 'ponytail', 'mattpocock'] };
const keepPlugin = (id, a) => PLUGINS[a].some((p) => p.id === id) || /@(anthropic-plugin-directory|openai-curated)/.test(id);

export const ASK = ['Bash(gh pr merge *)', 'Bash(git push *--force*)', 'Bash(git push -f*)', 'Bash(git push * -f*)', 'Bash(git push * +*)', 'Bash(git reset --hard*)', 'Bash(git reset * --hard*)', 'Bash(git branch -D *)', 'Bash(git branch * -D*)', 'Bash(git clean *)'];
const CLAUDE_KEYS = [
  [['advisorModel'], 'opus'], [['remoteControlAtStartup'], true], [['showClearContextOnPlanAccept'], true],
  [['cleanupPeriodDays'], 14], [['autoUpdatesChannel'], 'stable'],
  [['attribution'], { commit: 'Assisted-by: generative AI', pr: 'Created with the assistance of generative AI.', sessionUrl: false }],
  [['env', 'DISABLE_ERROR_REPORTING'], '1'], [['env', 'CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY'], '1'],
  [['env', 'DISABLE_FEEDBACK_COMMAND'], '1'], [['env', 'CLAUDE_CODE_SUBAGENT_MODEL'], 'sonnet'],
];
const EFFORT_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5'];

const json = (list, fallback) => { try { return JSON.parse(list); } catch { return fallback; } };
const sets = (pairs) => (text) => mergeJson(text, pairs.map(([path, value]) => ({ path, value })));

// User plugins ({ id, version, enabled }) and marketplace names of Claude Code or Codex, read from the agent's own files:
// each list command takes about 0.5 s. The CLI answers when the files are missing or unreadable.
// shortcut: the files are internal CLI formats; if a CLI release changes them, the CLI fallback stays correct but slow.
export function pluginState(ctx, a) {
  const at = (p) => join(ctx.home, p);
  try {
    if (a === 'claude') {
      const installed = JSON.parse(readText(at('.claude/plugins/installed_plugins.json')));
      const markets = JSON.parse(readText(at('.claude/plugins/known_marketplaces.json')));
      const on = parseJson(readText(at('.claude/settings.json')) ?? '{}').enabledPlugins ?? {};
      if (installed?.version === 2 && installed.plugins && markets) {
        const listed = Object.entries(installed.plugins).flatMap(([id, l]) => l.filter((p) => p.scope === 'user').map((p) => ({ id, version: p.version, enabled: on[id] === true })));
        return { listed, markets: Object.keys(markets) };
      }
    } else {
      const conf = parseToml(readText(at('.codex/config.toml')) ?? '');
      if (conf.plugins || conf.marketplaces) {
        const version = (id) => {
          const [name, market] = id.split('@');
          const d = at(`.codex/plugins/cache/${market}/${name}`);
          return (exists(d) ? readdirSync(d) : []).filter((v) => /^\d+\.\d+\.\d+$/.test(v)).sort(bySemver).at(-1);
        };
        const listed = Object.entries(conf.plugins ?? {}).map(([id, p]) => ({ id, version: version(id), enabled: p?.enabled === true }));
        return { listed, markets: Object.keys(conf.marketplaces ?? {}) };
      }
    }
  } catch { /* the CLI below */ }
  if (a === 'claude') {
    return { listed: json(ctx.run(['claude', 'plugin', 'list', '--json']).stdout, []).filter((p) => p.scope === 'user' || p.scope == null).map((p) => ({ id: p.id, version: p.version, enabled: p.enabled })),
      markets: json(ctx.run(['claude', 'plugin', 'marketplace', 'list', '--json']).stdout, []).map((m) => m.name) };
  }
  return { listed: (json(ctx.run(['codex', 'plugin', 'list', '--json']).stdout, {}).installed ?? []).map((p) => ({ id: p.pluginId, version: p.version, enabled: p.enabled })),
    markets: (json(ctx.run(['codex', 'plugin', 'marketplace', 'list', '--json']).stdout, {}).marketplaces ?? []).map((m) => m.name) };
}

// Enabled plugin ids per agent.
export function installedPlugins(ctx) {
  const ids = (a) => pluginState(ctx, a).listed.filter((p) => p.enabled).map((p) => p.id);
  return { claude: ids('claude'), codex: ids('codex') };
}

const bySemver = (a, b) => a.split('.').map(Number).reduce((d, x, i) => d || x - b.split('.')[i], 0);

// The highest x.y.z release public for at least 7 days, or null.
// The registry answer is kept per context, so a long-running server asks once per package.
export function newest(ctx, pkg, now = Date.now()) {
  const cache = (ctx.registry ??= new Map());
  if (!cache.has(pkg)) cache.set(pkg, ctx.run(['npm', 'view', pkg, 'time', '--json']));
  const r = cache.get(pkg);
  if (r.code !== 0) return null;
  const times = json(r.stdout, {});
  const list = Array.isArray(times) ? Object.assign({}, ...times) : times;
  const ok = Object.entries(list).filter(([v, t]) => /^\d+\.\d+\.\d+$/.test(v) && Date.parse(t) < now - 7 * 864e5).map(([v]) => v);
  ok.sort(bySemver);
  return ok.at(-1) ?? null;
}

export function globalPlan(env) {
  const { ctx, agents, options = {} } = env;
  const home = ctx.home;
  const at = (p) => join(home, p);
  const rules = readFileSync(join(contentDir, 'rules/global.md'), 'utf8');
  const changes = [];
  const add = (step, title, c, extra = {}) => changes.push({ id: `${step}:${changes.length}`, step, title, ...c, ...extra });

  // Rules
  for (const id of agents) {
    const r = agent(id).global.rules;
    add(`rules:${id}`, `${agent(id).name} rules ${r.path}`, { kind: 'write', path: at(r.path), edit: (cur) => renderRules(r.format, cur, forAgent(rules, id)) });
  }
  if (agents.includes('claude')) {
    const dir = at('.claude/rules');
    for (const f of exists(dir) ? readdirSync(dir) : []) if (f !== '00-global.md') add('rules:claude:other', `other Claude rules ~/.claude/rules/${f}`, { kind: 'remove', path: join(dir, f) });
    if (exists(at('.claude/CLAUDE.md'))) add('rules:claude:other', 'other Claude rules ~/.claude/CLAUDE.md', { kind: 'remove', path: at('.claude/CLAUDE.md') });
  }
  if (agents.includes('codex') && exists(at('.codex/AGENTS.override.md'))) add('rules:codex:other', 'Codex rules override ~/.codex/AGENTS.override.md', { kind: 'remove', path: at('.codex/AGENTS.override.md') });

  // Commands that are hard to undo ask first.
  if (agents.includes('claude')) add('ask:claude', 'Claude Code asks before gh pr merge, force push, git reset --hard, git branch -D, git clean', { kind: 'write', path: at('.claude/settings.json'), edit: (t) => mergeJson(t, [{ path: ['permissions', 'ask'], append: ASK }]) });
  if (agents.includes('codex')) add('ask:codex', 'Codex asks before gh pr merge, force push, git reset --hard, git branch -D, git clean', { kind: 'write', path: at('.codex/rules/benchkeeper.rules'), after: readFileSync(join(contentDir, 'rules/codex.rules'), 'utf8') });

  // Plugins (Claude Code, Codex) or skill copies (agents without plugins).
  for (const a of ['claude', 'codex'].filter((x) => agents.includes(x))) {
    const { listed, markets } = pluginState(ctx, a);
    const enabled = listed.filter((p) => p.enabled).map((p) => p.id);
    for (const p of PLUGINS[a]) {
      if (enabled.includes(p.id) || (p.pack && !options.packs?.includes(p.pack))) continue;
      const step = `plugin:${a}:${p.id}`;
      if (p.source && !markets.includes(p.marketplace)) {
        const sparse = (p.sparse ?? []).flatMap((s) => ['--sparse', s]);
        add(step, `${agent(a).name} marketplace ${p.marketplace}`, { kind: 'command', argv: [a, 'plugin', 'marketplace', 'add', p.source, ...sparse], undoArgv: [a, 'plugin', 'marketplace', 'remove', p.marketplace] });
      }
      add(step, `${agent(a).name} plugin ${p.id}${p.pack ? ' (optional pack)' : ''}`, a === 'claude'
        ? { kind: 'command', argv: ['claude', 'plugin', 'install', p.id], undoArgv: ['claude', 'plugin', 'uninstall', p.id] }
        : { kind: 'command', argv: ['codex', 'plugin', 'add', p.id], undoArgv: ['codex', 'plugin', 'remove', p.id] });
    }
    for (const { id } of listed) {
      if (!keepPlugin(id, a)) add(`other:${a}:plugin`, `remove the ${agent(a).name} plugin ${id}`, { kind: 'command', argv: a === 'claude' ? ['claude', 'plugin', 'uninstall', id] : ['codex', 'plugin', 'remove', id], destructive: true });
    }
    for (const m of markets) if (!KEEP_MARKETPLACES[a].includes(m) && !/^openai-curated/.test(m)) add(`other:${a}:marketplace`, `remove the ${agent(a).name} marketplace ${m}`, { kind: 'command', argv: [a, 'plugin', 'marketplace', 'remove', m], destructive: true });
  }
  for (const id of agents.filter((x) => !agent(x).plugins)) {
    for (const name of readdirSync(join(contentDir, 'skills'))) {
      const src = join(contentDir, 'skills', name);
      for (const f of listFiles(src)) {
        add(`skills:${id}`, `${agent(id).name} skill ${name}`, { kind: 'write', path: join(at(agent(id).global.skills), name, f), after: forAgent(readFileSync(join(src, f), 'utf8'), id) });
      }
    }
  }

  // Global skills and MCP servers not part of the setup.
  const skillDirs = { claude: '.claude/skills', codex: '.agents/skills' };
  for (const [a, d] of Object.entries(skillDirs)) {
    if (!agents.includes(a) || !exists(at(d))) continue;
    for (const s of readdirSync(at(d))) if (!KEEP_SKILLS.includes(s)) add(`other:${a}:skill`, `move the global skill ~/${d}/${s} to the backup`, { kind: 'remove', path: at(join(d, s)) });
  }
  if (agents.includes('claude')) {
    const servers = Object.keys(parseJsonSafe(readText(at('.claude.json'))).mcpServers ?? {});
    for (const s of servers) add('other:claude:mcp', `remove the Claude user MCP server ${s} (projects configure their own)`, { kind: 'command', argv: ['claude', 'mcp', 'remove', '--scope', 'user', s], destructive: true });
  }
  if (agents.includes('codex')) {
    for (const s of json(ctx.run(['codex', 'mcp', 'list', '--json'], { cwd: home }).stdout, []).map((x) => x.name)) add('other:codex:mcp', `remove the Codex MCP server ${s} (projects configure their own)`, { kind: 'command', argv: ['codex', 'mcp', 'remove', s], cwd: home, destructive: true });
  }
  // Hooks per event, Orca's kept (Orca writes its own back).
  const hookFiles = [agents.includes('claude') && at('.claude/settings.json'), agents.includes('codex') && at('.codex/hooks.json')].filter(Boolean);
  for (const f of hookFiles) {
    const hooks = parseJsonSafe(readText(f)).hooks ?? {};
    for (const [event, groups] of Object.entries(hooks)) {
      const orca = (g) => (g.hooks ?? []).some((h) => /ORCA_/.test(h.command ?? ''));
      if (!Array.isArray(groups) || groups.every(orca)) continue;
      const keep = groups.filter(orca);
      add('other:hooks', `remove the non-Orca ${event} hooks from ${f}`, { kind: 'write', path: f, destructive: true, edit: (t) => mergeJson(t, [{ path: ['hooks', event], value: keep.length ? keep : undefined, remove: !keep.length }]) });
    }
  }

  // Settings
  if (agents.includes('claude')) {
    const f = at('.claude/settings.json');
    add('settings:claude', 'Claude settings: advisor Opus, Remote Control at startup, clear-context on plan accept, transcripts 14 days, stable channel, neutral attribution, error reporting and feedback off, subagents on Sonnet', { kind: 'write', path: f, edit: sets(CLAUDE_KEYS) });
    add('settings:claude:model', 'Claude default model opusplan (Opus in plan mode, Sonnet otherwise)', { kind: 'write', path: f, edit: sets([[['model'], 'opusplan']]) });
    add('settings:claude:effort', 'Claude default effort high, per model too (Opus 5.5 ignores the top-level key)', { kind: 'write', path: f, edit: sets([[['effortLevel'], 'high'], ...EFFORT_MODELS.map((m) => [['modelSettings', m, 'effortLevel'], 'high'])]) });
    add('settings:claude:compact', 'Claude auto-compact window 400000 tokens, per-model values removed', {
      kind: 'write', path: f, edit: (t) => {
        const ms = parseJson(t ?? '{}').modelSettings ?? {};
        const edits = [{ path: ['autoCompactWindow'], value: 400000 }];
        for (const [m, v] of Object.entries(ms)) if (v && 'autoCompactWindow' in v) edits.push(Object.keys(v).length === 1 ? { path: ['modelSettings', m], remove: true } : { path: ['modelSettings', m, 'autoCompactWindow'], remove: true });
        return mergeJson(t, edits);
      },
    });
  }
  if (agents.includes('codex')) {
    const f = at('.codex/config.toml');
    add('settings:codex', 'Codex effort high, analytics and feedback off', { kind: 'write', path: f, edit: (t) => [['', 'model_reasoning_effort', 'high'], ['analytics', 'enabled', false], ['feedback', 'enabled', false]].reduce((x, [tbl, k, v]) => setToml(x, tbl, k, v), t ?? '') });
  }
  if (agents.some((a) => agent(a).plugins)) add('settings:ponytail', 'Ponytail level full', { kind: 'write', path: at('.config/ponytail/config.json'), edit: sets([[['defaultMode'], 'full']]) });

  // Host tools
  const want = env.devcontainerCli ?? newest(ctx, '@devcontainers/cli');
  const have = (ctx.run(['devcontainer', '--version']).stdout || '').trim();
  if (want && have !== want) add('tools:devcontainer', `Dev Containers CLI ${want} (installed: ${have || 'none'})`, { kind: 'command', argv: ['npm', 'i', '-g', `@devcontainers/cli@${want}`] });
  const skill = (repo, name, flags) => add(`tools:skill:${name}`, `global skill ${name} from ${repo}`, { kind: 'command', argv: ['npx', '-y', `skills@${SKILLS_CLI}`, 'add', repo, '-s', name, '-g', ...flags, '--copy', '-y'], env: { DO_NOT_TRACK: '1' } });
  const flagsFor = (name) => [agents.includes('claude') && !exists(at(`.claude/skills/${name}`)) && ['-a', 'claude-code'], agents.includes('codex') && !exists(at(`.agents/skills/${name}`)) && ['-a', 'codex']].filter(Boolean).flat();
  const wanted = [['vercel-labs/skills', 'find-skills'], ...(ctx.run(['orca', '--version']).code === 0 ? [['https://github.com/stablyai/orca', 'orca-cli'], ['https://github.com/stablyai/orca', 'orchestration']] : [])];
  for (const [repo, name] of wanted) { const f = flagsFor(name); if (f.length) skill(repo, name, f); }
  return changes;
}

function parseJsonSafe(text) { try { return parseJson(text ?? '{}'); } catch { return {}; } }
