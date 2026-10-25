// Where the ledger, the pack files and the files on disk disagree: one finding each ({ message, fix }). Reads only.
import { exists, hashPath } from './fsx.mjs';
import { invalidPacks } from './packs.mjs';

// Files and folders each recorded change left, with the hash it left them in (null: gone). The paths a command's tool
// writes (a lock file, skill folders) are the tool's to change later, so they are not compared.
const left = (e) => {
  if (e.status !== 'done' || e.undone) return [];
  if (e.kind === 'restore') return (e.files ?? []).map((f) => [f.path, f.hashAfter]);
  return e.path ? [[e.path, e.kind === 'remove' ? null : e.hashAfter]] : [];
};

// A run that never finished, an unreadable run file, and each path whose newest recorded change no longer holds: a file
// edited or removed outside the app, or one that came back after a removal.
export function ledgerIssues(ctx) {
  const out = ctx.ledger.broken().map((n) => ({ message: `ledger file ${n} is unreadable`, fix: `move it out of ${ctx.ledger.dir}: history and undo skip it until then` }));
  const seen = new Set();
  for (const run of ctx.ledger.list()) {
    // A run another process is still applying has no status yet: only one older than an hour counts as unfinished.
    if (!run.status && Date.now() - Date.parse(run.time) > 3600e3) out.push({ message: `run ${run.id} did not finish`, fix: `benchkeeper undo ${run.id} restores what it changed` });
    if (run.scope !== 'global' && !exists(run.scope)) continue;
    for (const e of [...run.entries].reverse()) {
      for (const [path, hash] of left(e)) {
        if (!path || seen.has(path)) continue;
        seen.add(path);
        if (hashPath(path) !== hash) out.push({ message: hash == null ? `${path} is back after run ${run.id} removed it` : `${path} changed since run ${run.id}`, fix: 'edit it back, or run the step again (benchkeeper plan shows it); undo refuses a file changed after its run' });
      }
    }
  }
  return out;
}

export const packIssues = (ctx) => invalidPacks(ctx).map(({ file, reason }) => ({ message: `pack file ${file} is not used: ${reason}`, fix: `benchkeeper packs remove ${file} moves it to the backup` }));

export const integrity = (ctx) => [...ledgerIssues(ctx), ...packIssues(ctx)];
