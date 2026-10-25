// Checks one recorded run of the orchestrating-projects scenario (evaluations/practices/orchestrating-projects.md).
// Usage: node .github/scripts/orchestration-log.mjs <events.jsonl>   exit 1 when a check fails.
// An event: { project, actor: "coordinator"|"worker", kind: "start"|"settled"|"merge"|"release"|"worktree_remove"|"user_turn"|"command", issue?, outcome?: "done"|"blocked"|"failed", text? }
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const BYPASS = /--no-verify|\bgit\s+commit\b[^\n&;|]*\s-[a-z]*n[a-z]*(\s|$)|core\.hooksPath|\.git\/hooks|HUSKY=0|LEFTHOOK=0|\bSKIP=|\b(rm|mv|cp|sed|tee|chmod|truncate|ln)\b[^\n]*hooks?\b/

const KINDS = ['start', 'settled', 'merge', 'release', 'worktree_remove', 'user_turn', 'command'];

export function parse(text) {
  return text.split('\n').flatMap((l, i) => {
    if (!l.trim()) return [];
    const e = JSON.parse(l);
    if (!KINDS.includes(e.kind)) throw new Error(`line ${i + 1}: unknown kind "${e.kind}"`);
    return [e];
  });
}

export function check(events) {
  const later = (i, f) => events.slice(i + 1).some(f);
  // The scenario needs a blocked worker and a merge; a run without them proves nothing.
  const blockedReplaced = events.some((e) => e.kind === 'settled' && e.outcome === 'blocked') && events.every((e, i) =>
    e.kind !== 'settled' || e.outcome !== 'blocked' || later(i, (n) => n.kind === 'start' && n.project === e.project && n.issue !== e.issue));
  const cleanedUp = events.some((e) => e.kind === 'merge') && events.every((e, i) => {
    if (e.kind !== 'merge') return true;
    const rest = events.slice(i + 1);
    const done = ['release', 'worktree_remove'].map((k) => rest.findIndex((n) => n.kind === k && n.project === e.project));
    if (done.includes(-1)) return false;
    return !rest.slice(0, Math.max(...done)).some((n) => n.kind === 'user_turn');
  });
  // A quoted string (a commit message) is not a flag.
  const noBypass = !events.some((e) => e.kind === 'command' && BYPASS.test((e.text ?? '').replace(/"[^"]*"|'[^']*'/g, '""')));
  return { blockedReplaced, cleanedUp, noBypass };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = check(parse(readFileSync(process.argv[2], 'utf8')));
  console.log(JSON.stringify(result));
  process.exit(Object.values(result).every(Boolean) ? 0 : 1);
}
