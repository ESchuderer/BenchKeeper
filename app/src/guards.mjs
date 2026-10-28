// Guards: the deny rules and the PreToolUse hook that project setup writes for the rules without exceptions (no
// --no-verify, no force push, no sudo, no apply against shared systems), the file edits that take them out, and the
// doctor findings that read them back. The hook script itself is guard-hook.mjs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readText } from './fsx.mjs';
import { mergeJson, parseJson } from './merge.mjs';

export const GUARD_PATH = '.claude/hooks/benchkeeper-guard.mjs';
export const guardScript = () => readFileSync(new URL('./guard-hook.mjs', import.meta.url), 'utf8');

// Text patterns for the usual form of each command; `*` after the flag also covers a cluster (-nm, -fu). The hook covers the rest.
export const DENY = [
  ...['commit', 'push'].flatMap((s) => [`Bash(git ${s} *--no-verify*)`, `Bash(git ${s} -n*)`, `Bash(git ${s} * -n*)`]),
  'Bash(git push *--force*)', 'Bash(git push -f*)', 'Bash(git push * -f*)',
  'Bash(sudo *)', 'Bash(terraform apply *)', 'Bash(kubectl apply *)', 'Bash(helm upgrade *)',
];
// "$CLAUDE_PROJECT_DIR" quoted: the shell form of a hook with a path placeholder.
export const HOOK = { matcher: 'Bash', hooks: [{ type: 'command', command: `node "$CLAUDE_PROJECT_DIR/${GUARD_PATH}"` }] };

export const guardsOn = (t) => mergeJson(t, [{ path: ['permissions', 'deny'], append: DENY }, { path: ['hooks', 'PreToolUse'], append: [HOOK] }]);
// shortcut: an entry the user wrote identical to one of ours goes out with ours; the state file does not tell them apart.
export const guardsOff = (t) => mergeJson(t, [
  { path: ['permissions', 'deny'], pull: DENY }, { path: ['permissions'], prune: true },
  { path: ['hooks', 'PreToolUse'], pull: [HOOK] }, { path: ['hooks'], prune: true },
]);

const SETTINGS = ['.claude/settings.json', '.claude/settings.local.json'];
const issue = (level, message, fix) => ({ level, check: 'guards', message, fix });

// What the project's settings files and hook file hold of the guards: { rules: n of DENY, hook: registered, script }.
function found(dir) {
  const docs = SETTINGS.map((f) => { try { return parseJson(readText(join(dir, f))); } catch { return {}; } });
  const deny = new Set(docs.flatMap((d) => (Array.isArray(d.permissions?.deny) ? d.permissions.deny : [])));
  const hooks = docs.flatMap((d) => (Array.isArray(d.hooks?.PreToolUse) ? d.hooks.PreToolUse : []));
  return { rules: DENY.filter((r) => deny.has(r)).length, hook: hooks.some((h) => JSON.stringify(h) === JSON.stringify(HOOK)), script: readText(join(dir, GUARD_PATH)) };
}

// Findings for a project with a state file and Claude Code chosen: on (the default) with a rule, the hook or its script
// missing is a warning, off with any of them still there an info.
export function guardChecks(dir, state) {
  if (!state?.agents?.includes('claude')) return [];
  const f = found(dir), on = state.guards !== false;
  if (on) {
    const missing = [f.rules < DENY.length && `${DENY.length - f.rules} of ${DENY.length} deny rules`, !f.hook && 'the PreToolUse hook', f.script !== guardScript() && `${GUARD_PATH} (missing or changed)`].filter(Boolean);
    return missing.length ? [issue('warning', `guards are on, but ${dir} lacks: ${missing.join(', ')}`, 'benchkeeper projects apply writes them again')] : [];
  }
  const left = [f.rules && `${f.rules} deny rules`, f.hook && 'the PreToolUse hook', f.script != null && GUARD_PATH].filter(Boolean);
  return left.length ? [issue('info', `guards are off, but ${dir} still has: ${left.join(', ')}`, 'benchkeeper projects apply removes them')] : [];
}
