// Drift of a repository's GitHub settings and caller workflows against a repo-baseline profile (the shared desired
// state in ESchuderer/repo-baseline). Reads only: GET requests through gh, files of the checkout. Applying a profile is
// repo-baseline's script (dry run, snapshot, restore), never this app. Without gh, a login or the network the check says
// so and nothing else fails.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { exists, readText } from './fsx.mjs';
import { git } from './git.mjs';

export const BASELINE_REPO = 'ESchuderer/repo-baseline';
// The repo-baseline commit the bundled copy in ./baseline/ and the caller files come from (scripts/baseline-sync.mjs).
export const REF = '9fa20b5c33cc72f777a717fb9418c57211ace0b0';
export const PROFILES = ['oss', 'private-advisory'];
export const CALLERS = ['promote', 'lint-js', 'lint-python', 'sonar'];
const REF_OK = /^[\w][\w./-]*$/;
const GH_ENV = { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' };

const bundled = (path) => readFileSync(new URL(`./baseline/${path}`, import.meta.url), 'utf8');
// Arrays of strings (merge methods, refs, patterns) are sets here: their order is not a difference.
const canon = (v) => (Array.isArray(v) ? (v.every((x) => typeof x === 'string') ? [...v].sort((a, b) => a.localeCompare(b)) : v.map(canon)) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort((a, b) => a.localeCompare(b)).map((k) => [k, canon(v[k])])) : v);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const show = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
const valid = (p, name) => p?.schemaVersion === 1 && p.name === name && typeof p.advisory === 'boolean' && (p.rulesets === undefined || Array.isArray(p.rulesets));

// The profile at ref (default: the pinned commit), read from repo-baseline. The pinned commit falls back to the bundled
// copy, which is that commit's file, when repo-baseline cannot be reached; another ref has no fallback.
export function loadProfile(ctx, name, ref = REF) {
  if (!PROFILES.includes(name)) throw new Error(`profile must be one of ${PROFILES.join(', ')}`);
  if (!REF_OK.test(ref)) throw new Error(`not a ref: ${ref}`);
  const r = ctx.run(['gh', 'api', '-H', 'Accept: application/vnd.github.raw', `repos/${BASELINE_REPO}/contents/profiles/${name}.json?ref=${ref}`], { env: GH_ENV, timeout: 20e3 });
  let why = r.stderr.trim().split('\n')[0] || 'no answer';
  if (r.code === 0) {
    try {
      const profile = JSON.parse(r.stdout);
      if (valid(profile, name)) return { profile, source: `${BASELINE_REPO}@${ref.slice(0, 7)}` };
    } catch { /* not JSON */ }
    why = 'not a valid profile file (a newer schema?)';
  }
  if (ref !== REF) throw new Error(`cannot read profile ${name} at ${BASELINE_REPO}@${ref}: ${why}`);
  return { profile: JSON.parse(bundled(`profiles/${name}.json`)), source: `bundled copy of ${BASELINE_REPO}@${REF.slice(0, 7)} (repo-baseline: ${why})` };
}

// A caller workflow of repo-baseline, pinned to the bundled commit: { path, text }.
export function callerFile(module) {
  if (!CALLERS.includes(module)) throw new Error(`unknown caller ${module} (${CALLERS.join(', ')})`);
  return { path: `.github/workflows/${module}.yml`, text: bundled(`callers/${module}.yml`).replaceAll('{{ref}}', REF) };
}

// owner/repo of a checkout's GitHub origin, or null.
export function githubSlug(ctx, dir) {
  const m = git(ctx, dir, ['remote', 'get-url', 'origin']).stdout.trim().match(/(?:^|@|\/\/)github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  return m && !/^\.{1,2}$/.test(m[1]) && !/^\.{1,2}$/.test(m[2]) && !m[1].startsWith('-') && !m[2].startsWith('-') ? `${m[1]}/${m[2]}` : null;
}

const REPO_KEYS = ['allow_merge_commit', 'allow_squash_merge', 'allow_rebase_merge', 'allow_auto_merge', 'delete_branch_on_merge'];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

// The repository's settings in the shape of a profile; a part gh cannot read (plan, rights, offline) is named in unreadable.
export function readLive(ctx, slug) {
  const unreadable = {};
  const run = (path) => ctx.run(['gh', 'api', `repos/${slug}${path}`], { env: GH_ENV, timeout: 20e3 });
  const get = (key, path) => {
    const r = run(path);
    if (r.code !== 0) { unreadable[key] = { http: /HTTP (\d{3})/.exec(r.stderr)?.[1] ?? null, message: r.stderr.trim().split('\n')[0] }; return undefined; }
    try { return r.stdout.trim() ? JSON.parse(r.stdout) : {}; } catch { unreadable[key] = { http: null, message: 'not JSON' }; return undefined; }
  };
  const repo = get('repo', '');
  // Offline or no login: the rest would fail the same way, one timeout at a time.
  if (!repo) return { visibility: null, state: {}, unreadable };
  const actions = get('actions', '/actions/permissions');
  const state = {
    repo: repo && pick(repo, REPO_KEYS),
    actions: actions && pick(actions, ['enabled', 'allowed_actions', 'sha_pinning_required']),
    selected: actions?.allowed_actions === 'selected' ? get('selected', '/actions/permissions/selected-actions') : undefined,
    workflow: get('workflow', '/actions/permissions/workflow'),
  };
  const sec = repo.security_and_analysis ?? {};
  const pvr = get('private_vulnerability_reporting', '/private-vulnerability-reporting');
  const fixes = get('dependabot_security_updates', '/automated-security-fixes');
  const code = get('code_scanning_default_setup', '/code-scanning/default-setup');
  // 204 when on, 404 when off.
  const alerts = run('/vulnerability-alerts');
  const off = alerts.code !== 0 && /HTTP 404/.test(alerts.stderr);
  if (alerts.code !== 0 && !off) unreadable.dependabot_alerts = { http: /HTTP (\d{3})/.exec(alerts.stderr)?.[1] ?? null, message: alerts.stderr.trim().split('\n')[0] };
  const on = (x) => (x ? x.status === 'enabled' : undefined);
  state.security = Object.fromEntries(Object.entries({
    private_vulnerability_reporting: pvr && pvr.enabled === true,
    dependabot_alerts: alerts.code === 0 ? true : off ? false : undefined,
    dependabot_security_updates: fixes && fixes.enabled === true,
    code_scanning_default_setup: code?.state,
    secret_scanning: on(sec.secret_scanning),
    secret_scanning_push_protection: on(sec.secret_scanning_push_protection),
  }).filter(([, v]) => v !== undefined));
  const list = get('rulesets', '/rulesets?includes_parents=false&per_page=100');
  // One detail that cannot be read leaves the section out: a missing entry would read as a missing ruleset.
  const details = Array.isArray(list) ? list.map((x) => get(`ruleset ${x.id}`, `/rulesets/${Number(x.id)}`)) : [];
  if (Array.isArray(list) && details.every(Boolean)) state.rulesets = details;
  return { visibility: repo.private ? 'private' : 'public', state, unreadable };
}

// The live ruleset a wanted one stands for: the same branches (rulesets set by hand carry other names), else the same name.
const refs = (r) => r.conditions?.ref_name?.include;
const findRuleset = (list, want) => list.find((r) => same(refs(r), refs(want))) ?? list.find((r) => r.name === want.name);
const contexts = (rs) => rs?.rules?.find((r) => r.type === 'required_status_checks')?.parameters?.required_status_checks?.map((c) => c.context) ?? [];

// What differs, as sentences. Only what the profile names counts; a setting the repository does not report is skipped.
export function compare(profile, live) {
  const out = [];
  const keys = (label, want = {}, have) => {
    // GitHub answers 404 for alerts that are off and for a token without admin read.
    if (have) for (const [k, v] of Object.entries(want)) if (have[k] !== undefined && !same(v, have[k])) out.push(`${label} ${k} is ${show(have[k])}${k === 'dependabot_alerts' ? ' (or the token cannot read it)' : ''}, the profile wants ${show(v)}`);
  };
  keys('repository', profile.repo, live.state.repo);
  keys('Actions', profile.actions, live.state.actions);
  keys('workflow token', profile.workflow, live.state.workflow);
  keys('security', profile.security, live.state.security);
  const sel = profile.selected, have = live.state.selected;
  if (sel && have) {
    for (const p of sel.patterns_allowed ?? []) if (!have.patterns_allowed?.includes(p)) out.push(`Actions allowlist lacks ${p}`);
    for (const k of ['github_owned_allowed', 'verified_allowed']) if (sel[k] !== undefined && sel[k] !== have[k]) out.push(`Actions allowlist ${k} is ${have[k]}, the profile wants ${sel[k]}`);
  }
  const rulesets = live.state.rulesets;
  if (profile.rulesets && rulesets) {
    for (const want of profile.rulesets) {
      const rs = findRuleset(rulesets, want);
      if (!rs) { out.push(`ruleset ${want.name} is missing`); continue; }
      if (rs.enforcement !== want.enforcement) out.push(`ruleset ${want.name} enforcement is ${rs.enforcement}, the profile wants ${want.enforcement}`);
      if (!same(rs.conditions, want.conditions)) out.push(`ruleset ${want.name} conditions are ${show(rs.conditions)}, the profile wants ${show(want.conditions)}`);
      if (!same(rs.bypass_actors ?? [], want.bypass_actors ?? [])) out.push(`ruleset ${want.name} has bypass actors (${(rs.bypass_actors ?? []).length}), the profile wants ${(want.bypass_actors ?? []).length}`);
      // Rules the profile does not name are the repository's own (the apply script keeps them).
      const missing = want.rules.map((x) => x.type).filter((t) => !rs.rules.some((x) => x.type === t));
      if (missing.length) out.push(`ruleset ${want.name} lacks the rules ${missing.join(', ')}`);
      for (const w of want.rules.filter((r) => r.parameters)) {
        const params = rs.rules.find((r) => r.type === w.type)?.parameters ?? {};
        for (const [k, v] of Object.entries(w.parameters)) if (!same(v, params[k])) out.push(`ruleset ${want.name} ${k} is ${show(params[k])}, the profile wants ${show(v)}`);
      }
    }
    const rc = profile.requiredChecks;
    const by = (name) => { const w = profile.rulesets.find((x) => x.name === name); return w && findRuleset(rulesets, w); };
    const dev = by('develop'), main = by('main');
    for (const rs of [dev, main].filter(Boolean)) if (!contexts(rs).length) out.push(`ruleset ${rs.name} requires no status checks`);
    if (rc?.mainSubsetOfDevelop && dev && main) {
      const extra = contexts(main).filter((c) => !contexts(dev).includes(c));
      if (extra.length) out.push(`ruleset main requires checks that develop does not require (${extra.join(', ')}): they may not have run on the promotion pull request`);
    }
    const pullOnly = contexts(main).filter((c) => rc?.notRequiredOnMain?.includes(c));
    if (pullOnly.length) out.push(`ruleset main requires ${pullOnly.join(', ')}, which runs on pull requests only and never reports on the promotion pull request`);
  }
  return out;
}

// Caller workflows and files of the checkout against the profile.
export function filesDrift(profile, dir) {
  const out = [];
  const wf = join(dir, '.github/workflows');
  const texts = exists(wf) ? readdirSync(wf).filter((f) => /\.ya?ml$/.test(f)).map((f) => readText(join(wf, f)) ?? '') : [];
  for (const m of profile.callers ?? []) {
    // A line of its own, so a comment does not count; quotes around the value are allowed.
    const uses = texts.flatMap((t) => [...t.matchAll(new RegExp(`^\\s*(?:-\\s*)?uses:\\s*["']?${BASELINE_REPO}/\\.github/workflows/${m}\\.yml@([^\\s"']+)`, 'gm'))].map((x) => x[1]));
    if (!uses.length) out.push({ message: `caller workflow ${m} is missing`, fix: `benchkeeper project apply --caller ${m}` });
    else if (!uses.some((u) => /^[0-9a-f]{40}$/.test(u))) out.push({ message: `caller workflow ${m} is not pinned to a commit (${uses[0]})`, fix: 'pin the uses: line to a full commit SHA' });
  }
  for (const f of profile.files ?? []) if (!exists(join(dir, f))) out.push({ message: `${f} is missing`, fix: 'add the file (Dependabot version updates)' });
  return out;
}

// Doctor issues for one checkout: { level, check: 'baseline', message, fix, tag? }. profile: a name or 'auto' (private
// repositories get the advisory profile). The caller files come from the checkout, the settings from GitHub.
export function baselineIssues(ctx, dir, { profile = 'auto', ref } = {}) {
  // Names and refs come from GitHub and from the checkout's workflow files: control characters never reach the terminal.
  const issue = (message, fix, tag) => ({ level: 'warning', check: 'baseline', message: message.replace(/[\x00-\x1f\x7f-\x9f]/g, '?'), fix, ...(tag ? { tag } : {}) });
  const slug = githubSlug(ctx, dir);
  if (!slug) return [issue('GitHub settings not checked: no GitHub origin', 'add origin or skip --baseline')];
  const live = readLive(ctx, slug);
  if (!live.state.repo) return [issue(`GitHub settings of ${slug} not checked: ${live.unreadable.repo?.message || 'gh gave no answer'}`, 'sign in with gh auth login (read access is enough) and go online')];
  let loaded;
  try { loaded = loadProfile(ctx, profile === 'auto' ? (live.visibility === 'private' ? 'private-advisory' : 'oss') : profile, ref); } catch (e) { return [issue(e.message, 'check the name or ref')]; }
  const { profile: p, source } = loaded;
  const tag = p.advisory ? 'advisory' : undefined;
  const fix = `${p.advisory ? 'advisory, nothing to apply: ' : ''}in a clone of ${BASELINE_REPO} at ${ref ?? REF.slice(0, 7)}: node scripts/apply.mjs ${slug} --profile ${p.name} (dry run, then --apply)`;
  const out = [...compare(p, live).map((m) => issue(`${slug}: ${m}`, fix, tag)), ...filesDrift(p, dir).map((f) => issue(`${slug}: ${f.message}`, f.fix, tag))];
  // A part the profile does not govern (private vulnerability reporting on a private repository) is not worth a line.
  const governed = (k) => (/^ruleset/.test(k) ? !!p.rulesets : k in (p.security ?? {}) || (k in p && typeof p[k] === 'object'));
  for (const [k, v] of Object.entries(live.unreadable).filter(([k]) => governed(k))) out.push(issue(`${slug}: ${k.replaceAll('_', ' ')} not readable${v.http ? ` (HTTP ${v.http})` : ''}, left out`, p.advisory ? 'the plan or the token lacks it: advisory only' : 'a token with admin read access shows it', tag));
  if (!out.length) out.push({ level: 'info', check: 'baseline', message: `${slug} matches profile ${p.name} (${source})`, fix: '' });
  return out;
}
