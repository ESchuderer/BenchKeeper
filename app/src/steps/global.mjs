// Machine setup per detected agent: rules, command rules, plugins, settings, host tools, and everything else
// installed globally, offered for removal (destructive, off by default).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { agent, forAgent, renderRules } from '../agents.mjs';
import { childEnv } from '../childenv.mjs';
import { contentDir } from '../content.mjs';
import { cooldownEnv, cooled } from '../cooldown.mjs';
import { exists, hashText, listFiles, readText } from '../fsx.mjs';
import { mergeJson, parseJson, setToml } from '../merge.mjs';
import { bandStacks, hideBandChanges } from '../ponytail.mjs';
import { SRT_VERSION } from '../sandbox.mjs';
import { verifyArgv } from '../verify.mjs';

// lite: the BenchKeeper plugin alone (nothing outside the plugin install). standard: the same on the machine, plus the local block
// that `projects apply` writes per project. full: everything below (global rules, settings, other plugins, host tools).
export const LEVELS = ['lite', 'standard', 'full'];
// The oldest skills CLI the app runs: used when the registry cannot be asked, and never undercut by a newer answer.
export const SKILLS_CLI = '1.7.2';
// As an npm alias: npx runs a package from the project's node_modules when its version satisfies a plain spec, so a
// cloned repository could ship its own "skills" 1.7.2. An alias range never matches a local package (npm 10 libnpmexec).
export const SKILLS_SPEC = `skills@npm:skills@${SKILLS_CLI}`;
// Run before a command that fetches the skills CLI: npm's registry signatures of the CLI and its dependencies.
export const SKILLS_VERIFY = verifyArgv(`skills@${SKILLS_CLI}`);
// The global skills' repositories, from their default branch: only the skills CLI is pinned.
export const SKILL_SOURCES = {
  'vercel-labs/skills': 'https://github.com/vercel-labs/skills',
  'https://github.com/stablyai/orca': 'https://github.com/stablyai/orca',
};
// When the CLI minimum and the sandbox of the skill install preview (srt, an exact pin) were published (npm `time`), written by
// hand when either is raised: one under 7 days old fails the test, as the host tools are held back that long.
export const PIN_DATES = {
  [`skills@${SKILLS_CLI}`]: '2026-10-09T16:49:31Z',
  [`@anthropic-ai/sandbox-runtime@${SRT_VERSION}`]: '2026-10-20T01:13:23Z',
};
// ref is the git ref a new marketplace is added at, version the plugin version it yields; 'app' is this app's version.
// BenchKeeper's marketplace follows the branch stable, which each release moves, so an update is a marketplace refresh: moving
// a marketplace to another ref removes it and the plugin's data. Third-party plugins (Ponytail, Matt Pocock) have no ref and
// no version: the marketplace is added as the agent's own add command does, and the agent's normal update keeps it current.
export const PLUGINS = {
  claude: [
    { id: 'benchkeeper@benchkeeper', marketplace: 'benchkeeper', source: 'ESchuderer/BenchKeeper', ref: 'stable', version: 'app', sparse: ['.claude-plugin', 'plugins'] },
    { id: 'ponytail@ponytail', marketplace: 'ponytail', source: 'DietrichGebert/ponytail' },
    { id: 'mattpocock-skills@claude-plugins-official', marketplace: 'claude-plugins-official', pack: 'matt-pocock' },
  ],
  codex: [
    { id: 'benchkeeper@benchkeeper', marketplace: 'benchkeeper', source: 'ESchuderer/BenchKeeper', ref: 'stable', version: 'app', sparse: ['.claude-plugin', 'plugins'] },
    { id: 'ponytail@ponytail', marketplace: 'ponytail', source: 'DietrichGebert/ponytail' },
    { id: 'mattpocock-skills@mattpocock', marketplace: 'mattpocock', source: 'mattpocock/skills', pack: 'matt-pocock' },
  ],
};
// The ref and version a plugin is pinned to, for this app version.
export function pin(p, appVersion) {
  return { ref: p.ref, version: p.version === 'app' ? appVersion : p.version };
}
// What a marketplace add names: the source, at the ref when the plugin has one (Claude Code `source#ref`, Codex `source@ref`).
export const marketSource = (p, a) => `${p.source}${p.ref ? `${a === 'claude' ? '#' : '@'}${p.ref}` : ''}`;
// Names that come from an agent's files end up as command arguments: a leading dash would be read as an option.
const SAFE_NAME = /^[A-Za-z0-9][\w.@:-]*$/;
const ORCA_FILES = ['worker-spec.md', 'orca.yaml.sample', 'worktreeinclude.sample'];
export const KEEP_SKILLS = ['find-skills', 'orca-cli', 'orchestration', 'synced'];
const KEEP_MARKETPLACES = { claude: ['benchkeeper', 'ponytail', 'claude-plugins-official', 'anthropic-plugin-directory'], codex: ['benchkeeper', 'ponytail', 'mattpocock'] };
const keepPlugin = (id, a) => PLUGINS[a].some((p) => p.id === id) || /@(anthropic-plugin-directory|openai-curated)/.test(id);

// BenchKeeper adds no permission rules: Claude Code's auto mode (its defaults) decides what needs a prompt. Whatever else sits in
// permissions.ask or in Codex's rules folder differs from that set and is offered for removal.
export const PERMISSION_ASK = [];
const CODEX_OWN_RULES = ['default.rules'];
export const CLAUDE_KEYS = [
  [['advisorModel'], 'opus'], [['remoteControlAtStartup'], true], [['showClearContextOnPlanAccept'], true],
  [['cleanupPeriodDays'], 14], [['autoUpdatesChannel'], 'stable'],
  [['attribution'], { commit: '', pr: '', sessionUrl: false }],
  [['env', 'DISABLE_ERROR_REPORTING'], '1'], [['env', 'CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY'], '1'],
  [['env', 'DISABLE_FEEDBACK_COMMAND'], '1'], [['env', 'CLAUDE_CODE_SUBAGENT_MODEL'], 'sonnet'],
];
const EFFORT_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5'];

const json = (list, fallback) => { try { return JSON.parse(list); } catch { return fallback; } };
const sets = (pairs) => (text) => mergeJson(text, pairs.map(([path, value]) => ({ path, value })));

// Marketplace names and refs from a CLI list (unverified field names: a missing ref stays unknown).
const marketRefs = (list) => ({ markets: list.map((m) => m.name), refs: Object.fromEntries(list.map((m) => [m.name, m.source?.ref ?? m.ref])) });

// Skills an agent loads in every session: its global skill folder plus the skills of its turned-on plugins.
export function globalSkills(ctx, a) {
  const count = (d) => (exists(d) ? readdirSync(d).filter((n) => exists(join(d, n, 'SKILL.md'))).length : 0);
  let n = count(join(ctx.home, agent(a).global.skills));
  if (a === 'claude' || a === 'codex') {
    for (const p of pluginState(ctx, a).listed.filter((x) => x.enabled && x.version)) {
      const [name, market] = p.id.split('@');
      n += count(join(ctx.home, `.${a}/plugins/cache/${market}/${name}/${p.version}/skills`));
    }
  }
  return n;
}

// User plugins ({ id, version, enabled }), marketplace names and their git refs of Claude Code or Codex, read from the agent's own files:
// each list command takes about 0.5 s. The CLI answers when the files are missing or unreadable.
// shortcut: the files are internal CLI formats; if a CLI release changes them, the CLI fallback stays correct but slow.
export function pluginState(ctx, a) {
  const state = readPluginState(ctx, a);
  return { ...state, listed: state.listed.filter((p) => SAFE_NAME.test(p.id ?? '')), markets: state.markets.filter((m) => SAFE_NAME.test(m ?? '')) };
}
function readPluginState(ctx, a) {
  const at = (p) => join(ctx.home, p);
  try {
    if (a === 'claude') {
      const installed = JSON.parse(readText(at('.claude/plugins/installed_plugins.json')));
      const markets = JSON.parse(readText(at('.claude/plugins/known_marketplaces.json')));
      const on = parseJson(readText(at('.claude/settings.json')) ?? '{}').enabledPlugins ?? {};
      if (installed?.version === 2 && installed.plugins && markets) {
        const listed = Object.entries(installed.plugins).flatMap(([id, l]) => l.filter((p) => p.scope === 'user').map((p) => ({ id, version: p.version, ...(p.gitCommitSha ? { commit: p.gitCommitSha } : {}), enabled: on[id] === true })));
        return { listed, markets: Object.keys(markets), refs: Object.fromEntries(Object.entries(markets).map(([m, v]) => [m, v?.source?.ref])) };
      }
    } else {
      const conf = parseToml(readText(at('.codex/config.toml')) ?? '');
      if (conf.plugins || conf.marketplaces) {
        const version = (id) => {
          const [name, market] = id.split('@');
          const d = at(`.codex/plugins/cache/${market}/${name}`);
          return (exists(d) ? readdirSync(d) : []).filter((v) => /^\d+\.\d+\.\d+$/.test(v)).sort(bySemver).at(-1);
        };
        // No version folder in the cache: the entry is there, its files are not.
        const listed = Object.entries(conf.plugins ?? {}).map(([id, p]) => ({ id, version: version(id), enabled: p?.enabled === true, missing: !version(id) }));
        return { listed, markets: Object.keys(conf.marketplaces ?? {}), refs: Object.fromEntries(Object.entries(conf.marketplaces ?? {}).map(([m, v]) => [m, v?.ref])) };
      }
    }
  } catch { /* the CLI below */ }
  if (a === 'claude') {
    return { listed: json(ctx.run(['claude', 'plugin', 'list', '--json']).stdout, []).filter((p) => p.scope === 'user' || p.scope == null).map((p) => ({ id: p.id, version: p.version, enabled: p.enabled })),
      ...marketRefs(json(ctx.run(['claude', 'plugin', 'marketplace', 'list', '--json']).stdout, [])) };
  }
  return { listed: (json(ctx.run(['codex', 'plugin', 'list', '--json']).stdout, {}).installed ?? []).map((p) => ({ id: p.pluginId, version: p.version, enabled: p.enabled })),
    ...marketRefs(json(ctx.run(['codex', 'plugin', 'marketplace', 'list', '--json']).stdout, {}).marketplaces ?? []) };
}

// The BenchKeeper plugin of an agent: the installed version (null when not installed) and the one this app sets up.
export function benchkeeperPlugin(ctx, a) {
  const p = PLUGINS[a].find((x) => x.id === 'benchkeeper@benchkeeper');
  return { installed: pluginState(ctx, a).listed.find((x) => x.id === p.id)?.version ?? null, available: pin(p, ctx.appVersion).version };
}

// Enabled plugin ids per agent.
export function installedPlugins(ctx) {
  const ids = (a) => pluginState(ctx, a).listed.filter((p) => p.enabled).map((p) => p.id);
  return { claude: ids('claude'), codex: ids('codex') };
}

const bySemver = (a, b) => a.split('.').map(Number).reduce((d, x, i) => d || x - b.split('.')[i], 0);
// A version that is not x.y.z (a commit, "unknown") cannot be compared: it counts as current.
const semver = (v) => /^\d+\.\d+\.\d+$/.test(v ?? '');

// The highest x.y.z release public for at least 7 days and still installable, or null.
// The registry answer is kept per context, 6 hours, a failed one 1 minute, so a long-running server asks again.
// The comparison uses this machine's clock and the registry's publish times: a registry that lies about either is trusted.
export function newest(ctx, pkg, now = Date.now()) {
  const cache = (ctx.registry ??= new Map());
  const hit = cache.get(pkg);
  if (!hit || now - hit.at > (hit.r.code === 0 ? 6 * 3600e3 : 60e3)) cache.set(pkg, { at: now, r: ctx.run(['npm', 'view', pkg, 'time', 'versions', '--json'], { cwd: ctx.home, env: childEnv(), timeout: 30e3 }) });
  const { r } = cache.get(pkg);
  if (r.code !== 0) return null;
  const { time, versions } = json(r.stdout, {});
  return cooled(time, versions, now).sort(bySemver).at(-1) ?? null;
}

// The skills CLI a command runs: the newest release at least 7 days old (as the host tools), the app's minimum when the
// registry gives none or an older one. The signature check and the run get the same version and the same `before` date.
// BENCHKEEPER_SKILLS_CLI=x.y.z runs exactly that version.
export function skillsCli(ctx) {
  const forced = process.env.BENCHKEEPER_SKILLS_CLI;
  if (/^\d+\.\d+\.\d+$/.test(forced ?? '')) return forced;
  const v = newest(ctx, 'skills');
  return v && bySemver(v, SKILLS_CLI) > 0 ? v : SKILLS_CLI;
}
export const skillsSpec = (ctx) => `skills@npm:skills@${skillsCli(ctx)}`;
export const skillsVerify = (ctx) => verifyArgv(`skills@${skillsCli(ctx)}`);

export function globalPlan(env) {
  const { ctx, options = {} } = env;
  const level = options.level ?? 'full';
  if (!LEVELS.includes(level)) throw new Error(`level must be one of ${LEVELS.join(', ')}`);
  const full = level === 'full';
  const { agents } = env;
  const home = ctx.home;
  const at = (p) => join(home, p);
  const rules = readFileSync(join(contentDir, 'rules/global.md'), 'utf8');
  const changes = [];
  const add = (step, title, c, extra = {}) => changes.push({ id: `${step}:${changes.length}`, step, title, ...c, ...extra });

  // Rules: lite and standard have none (the block shadows agents)
  {
  const agents = full ? env.agents : [];
  const keptFile = join(ctx.config, 'kept-rules.json');
  const kept = parseJson(readText(keptFile) ?? '{}');
  for (const id of agents) {
    const r = agent(id).global.rules;
    const file = at(r.path);
    const cur = readText(file);
    // A file the app cannot merge into (an unmatched marker) is no edit to keep: the rules change reports that error.
    let edited = false;
    try { edited = cur != null && cur !== renderRules(r.format, cur, forAgent(rules, id)); } catch { /* shown by the rules change */ }
    // A kept edit holds for this file content and this setup version: a new version offers its rules again.
    const keeps = edited && kept[file]?.hash === hashText(cur) && kept[file]?.version === ctx.appVersion;
    if (!keeps) add(`rules:${id}`, `${agent(id).name} rules ${r.path}`, { kind: 'write', path: file, edit: (c) => renderRules(r.format, c, forAgent(rules, id)) });
    const write = !keeps && changes.at(-1).id;
    // Offered, not preselected: the edits are the user's, this only stops the finding.
    if (edited && !keeps) add(`rulesKeep:${id}`, `keep your edits to ${r.path}: no warning until the file or BenchKeeper's rules change`, { kind: 'write', path: keptFile, replaces: write, edit: (t) => mergeJson(t, [{ path: [file], value: { hash: hashText(cur), version: ctx.appVersion } }]) }, { selected: false, optional: true });
  }
  // Rule files that are not BenchKeeper's are the user's: the Rules view lists them and switches them, this plan leaves them be.

  // Offered, not preselected: an ask rule may be the user's own, and a Codex rules file holds the user's saved approvals too.
  if (agents.includes('claude')) {
    const ask = parseJson(readText(at('.claude/settings.json')) ?? '{}').permissions?.ask;
    for (const rule of (Array.isArray(ask) ? ask : []).filter((x) => !PERMISSION_ASK.includes(x))) add(`ask:claude:${rule}`, `Claude Code ask rule ${rule} (BenchKeeper adds none: auto mode decides what needs a prompt)`, { kind: 'write', path: at('.claude/settings.json'), destructive: true, edit: (t) => mergeJson(t, [{ path: ['permissions', 'ask'], pull: [rule] }, { path: ['permissions'], prune: true }]) });
  }
  if (agents.includes('codex')) {
    const dir = at('.codex/rules');
    for (const f of (exists(dir) ? readdirSync(dir) : []).filter((x) => !CODEX_OWN_RULES.includes(x))) add(`ask:codex:${f}`, `Codex command rules file ${f} (BenchKeeper adds none)`, { kind: 'remove', path: join(dir, f) });
  }

  }

  // Plugins (Claude Code, Codex) or skill copies (agents without plugins).
  for (const a of ['claude', 'codex'].filter((x) => agents.includes(x))) {
    const { listed, markets } = pluginState(ctx, a);
    const name = agent(a).name;
    for (const p of PLUGINS[a].filter((x) => full || x.id.startsWith('benchkeeper@'))) {
      const have = listed.find((x) => x.id === p.id && x.enabled);
      const off = !have && listed.find((x) => x.id === p.id);
      // An installed pack plugin is kept current without its pack being chosen again.
      if (p.pack && !options.packs?.includes(p.pack) && !have) continue;
      const step = `plugin:${a}:${p.id}`;
      // Offered, not preselected: uninstalling deletes the plugin's data, and unregistered projects may still use it.
      if (have && p.pack && !options.packs?.includes(p.pack) && options.packsInUse && !options.packsInUse.includes(p.pack)) {
        add(step, `remove ${name} plugin ${p.id}: no registered project uses the ${p.pack} pack`, { kind: 'command', argv: a === 'claude' ? ['claude', 'plugin', 'uninstall', p.id] : ['codex', 'plugin', 'remove', p.id], undoArgv: a === 'claude' ? ['claude', 'plugin', 'install', p.id] : ['codex', 'plugin', 'add', p.id], destructive: true });
        continue;
      }
      const { version } = pin(p, ctx.appVersion);
      const sparse = (p.sparse ?? []).flatMap((s) => ['--sparse', s]);
      const addMarket = p.source && [a, 'plugin', 'marketplace', 'add', marketSource(p, a), ...sparse];
      const install = a === 'claude' ? ['claude', 'plugin', 'install', p.id] : ['codex', 'plugin', 'add', p.id];
      // Installed but turned off: Claude Code turns it on in settings (undone by the file's backup); Codex by hand.
      if (off) {
        if (a === 'claude') add(step, `${name} plugin ${p.id}: turn on`, { kind: 'write', path: at('.claude/settings.json'), edit: (t) => mergeJson(t, [{ path: ['enabledPlugins', p.id], value: true }]) });
        else add(step, `${name} plugin ${p.id}: turn on by hand`, { kind: 'command', argv: install, error: `${p.id} is installed but turned off: set enabled = true under [plugins."${p.id}"] in ~/.codex/config.toml` });
        continue;
      }
      // The entry is there, its files are not: install again.
      if (have?.missing) { add(step, `${name} plugin ${p.id}: files missing, install again`, { kind: 'command', argv: install }); continue; }
      if (have) {
        // Older than the app: refresh the marketplace and update. Newer stays. A marketplace at another ref is left as it is
        // (moving it deletes the plugin's options and data in Claude Code), so there is no by-hand step.
        if (!version || !semver(have.version) || bySemver(have.version, version) >= 0) continue;
        const title = `${name} plugin ${p.id} ${have.version} to ${version}`;
        add(step, title, { kind: 'command', argv: [a, 'plugin', 'marketplace', a === 'claude' ? 'update' : 'upgrade', p.marketplace], outdated: true, unit: step });
        add(step, title, { kind: 'command', argv: a === 'claude' ? ['claude', 'plugin', 'update', p.id] : install, outdated: true, unit: step });
        continue;
      }
      if (addMarket && !markets.includes(p.marketplace)) add(step, `${name} marketplace ${p.marketplace}`, { kind: 'command', argv: addMarket, undoArgv: [a, 'plugin', 'marketplace', 'remove', p.marketplace], unit: step });
      add(step, `${name} plugin ${p.id}${p.pack ? ' (optional pack)' : ''}`, { kind: 'command', argv: install, undoArgv: a === 'claude' ? ['claude', 'plugin', 'uninstall', p.id] : ['codex', 'plugin', 'remove', p.id], unit: step });
    }
    for (const { id } of full ? listed : []) {
      if (!keepPlugin(id, a)) add(`other:${a}:plugin`, `remove the ${agent(a).name} plugin ${id}`, { kind: 'command', argv: a === 'claude' ? ['claude', 'plugin', 'uninstall', id] : ['codex', 'plugin', 'remove', id], destructive: true });
    }
    for (const m of full ? markets : []) if (!KEEP_MARKETPLACES[a].includes(m) && !/^openai-curated/.test(m)) add(`other:${a}:marketplace`, `remove the ${agent(a).name} marketplace ${m}`, { kind: 'command', argv: [a, 'plugin', 'marketplace', 'remove', m], destructive: true });
  }
  for (const id of agents.filter((x) => !agent(x).plugins)) {
    for (const name of readdirSync(join(contentDir, 'skills'))) {
      const src = join(contentDir, 'skills', name);
      for (const f of listFiles(src)) {
        add(`skills:${id}`, `${agent(id).name} skill ${name}`, { kind: 'write', path: join(at(agent(id).global.skills), name, f), after: forAgent(readFileSync(join(src, f), 'utf8'), id) });
      }
    }
  }

  // Offered, not preselected, at every level: Ponytail's band next to BenchKeeper's tier band. Both writes go together.
  if (agents.includes('claude') && bandStacks(ctx)) for (const c of hideBandChanges(ctx)) add('settings:ponytail:band', c.title, c, { selected: false, optional: true, unit: 'settings:ponytail:band' });

  if (!full) return changes;

  // Global skills and MCP servers not part of the setup.
  const skillDirs = { claude: '.claude/skills', codex: '.agents/skills' };
  for (const [a, d] of Object.entries(skillDirs)) {
    if (!agents.includes(a) || !exists(at(d))) continue;
    for (const s of readdirSync(at(d))) if (!KEEP_SKILLS.includes(s)) add(`other:${a}:skill`, `move the global skill ~/${d}/${s} to the backup`, { kind: 'remove', path: at(join(d, s)) });
  }
  if (agents.includes('claude')) {
    const servers = Object.keys(parseJsonSafe(readText(at('.claude.json'))).mcpServers ?? {}).filter((n) => SAFE_NAME.test(n));
    for (const s of servers) add('other:claude:mcp', `remove the Claude user MCP server ${s} (projects configure their own)`, { kind: 'command', argv: ['claude', 'mcp', 'remove', '--scope', 'user', s], destructive: true });
  }
  if (agents.includes('codex')) {
    for (const s of json(ctx.run(['codex', 'mcp', 'list', '--json'], { cwd: home }).stdout, []).map((x) => x.name).filter((n) => SAFE_NAME.test(n ?? ''))) add('other:codex:mcp', `remove the Codex MCP server ${s} (projects configure their own)`, { kind: 'command', argv: ['codex', 'mcp', 'remove', s], cwd: home, destructive: true });
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
    add('settings:claude', 'Claude settings: advisor Opus, Remote Control at startup, clear-context on plan accept, transcripts 14 days, stable channel, commit and pull request attribution hidden, error reporting and feedback off, subagents on Sonnet', { kind: 'write', path: f, edit: sets(CLAUDE_KEYS) });
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
    // Offered, not preselected: the band is a choice, and a plugin's options live under its id.
    add('settings:claude:tier-band', 'BenchKeeper status band above the prompt (optional, terminal only): project, branch, last test run, the tier of the last answer and buttons to set it for the session', { kind: 'write', path: f, edit: sets([[['pluginConfigs', 'benchkeeper@benchkeeper', 'options', 'tierBand'], true]]) }, { selected: false, optional: true });
  }
  if (agents.includes('codex')) {
    const f = at('.codex/config.toml');
    add('settings:codex', 'Codex effort high, analytics and feedback off', { kind: 'write', path: f, edit: (t) => [['', 'model_reasoning_effort', 'high'], ['analytics', 'enabled', false], ['feedback', 'enabled', false]].reduce((x, [tbl, k, v]) => setToml(x, tbl, k, v), t ?? '') });
  }
  if (agents.some((a) => agent(a).plugins)) add('settings:ponytail', 'Ponytail level full', { kind: 'write', path: at('.config/ponytail/config.json'), edit: sets([[['defaultMode'], 'full']]) });

  // Host tools
  const want = env.devcontainerCli ?? newest(ctx, '@devcontainers/cli');
  const have = (ctx.run(['devcontainer', '--version']).stdout || '').trim();
  // A newer installed release stays: the cooldown picks what to install, it never downgrades.
  if (want && (!semver(have) || bySemver(have, want) < 0)) add('tools:devcontainer', `Dev Containers CLI ${want} (installed: ${have || 'none'})`, { kind: 'command', argv: ['npm', 'i', '-g', '--ignore-scripts', `@devcontainers/cli@${want}`], env: cooldownEnv(), verify: verifyArgv(`@devcontainers/cli@${want}`) });
  // Lifecycle scripts stay off (the skills CLI needs none); the snapshot makes the install undoable: the skill folders and the lock.
  const skill = (repo, name, flags) => add(`tools:skill:${name}`, `global skill ${name} from ${repo}`, {
    kind: 'command', argv: ['npx', '-y', skillsSpec(ctx), 'add', SKILL_SOURCES[repo], '-s', name, '-g', ...flags, '--copy', '-y'], env: { DO_NOT_TRACK: '1', npm_config_ignore_scripts: 'true', ...cooldownEnv() }, verify: skillsVerify(ctx),
    snapshot: [at(`.claude/skills/${name}`), at(`.agents/skills/${name}`), at('.agents/.skill-lock.json')],
  });
  const flagsFor = (name) => [agents.includes('claude') && !exists(at(`.claude/skills/${name}`)) && ['-a', 'claude-code'], agents.includes('codex') && !exists(at(`.agents/skills/${name}`)) && ['-a', 'codex']].filter(Boolean).flat();
  const orca = ctx.run(['orca', '--version']).code === 0;
  const wanted = [['vercel-labs/skills', 'find-skills'], ...(orca ? [['https://github.com/stablyai/orca', 'orca-cli'], ['https://github.com/stablyai/orca', 'orchestration']] : [])];
  for (const [repo, name] of wanted) { const f = flagsFor(name); if (f.length) skill(repo, name, f); }
  // Offered when Orca is installed: the worker spec and the per-worktree setup samples, in the app's config folder, never in a project.
  for (const f of orca ? ORCA_FILES : []) add('orca:templates', `Orca worker spec and setup samples (optional): ${f}`, { kind: 'write', path: join(ctx.config, 'orca', f), after: readFileSync(new URL(`../orca/${f}`, import.meta.url), 'utf8') }, { selected: false, optional: true });
  return changes;
}

function parseJsonSafe(text) { try { return parseJson(text ?? '{}'); } catch { return {}; } }
