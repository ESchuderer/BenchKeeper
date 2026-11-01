// Where the ledger, the pack files and the files on disk disagree: one finding each ({ message, fix }). Reads only.
import { dirname } from 'node:path';
import { exists, hashPath } from './fsx.mjs';
import { invalidPacks } from './packs.mjs';

// Files and folders each recorded change left, with the hash it left them in (null: gone). The paths a command's tool
// writes (a lock file, skill folders) are the tool's to change later, so they are not compared.
const left = (e) => {
  if (e.status !== 'done' || e.undone) return [];
  if (e.kind === 'restore') return (e.files ?? []).map((f) => [f.path, f.hashAfter]);
  return e.path ? [[e.path, e.kind === 'remove' ? null : e.hashAfter]] : [];
};

// The paths of the newer entries, walking the runs newest first. An older entry's path no longer counts when a newer entry changed
// that path, a folder that holds it (a skill folder removed or moved after its files were written) or a path inside it (files
// written again after their folder was removed).
export function newerPaths() {
  const seen = new Set(), holders = new Set();
  const up = (p) => { const out = []; for (let d = dirname(p); d !== dirname(d); d = dirname(d)) out.push(d); return out; };
  return {
    settled: (p) => seen.has(p) || holders.has(p) || up(p).some((d) => seen.has(d)),
    add: (p) => { seen.add(p); for (const d of up(p)) holders.add(d); },
  };
}

// A run that never finished, an unreadable run file, runs a newer app wrote, and each path whose newest recorded change
// no longer holds: a file edited or removed outside the app, or one that came back after a removal.
export function ledgerIssues(ctx) {
  const out = ctx.ledger.broken().map((n) => ({ message: `ledger file ${n} is unreadable`, fix: `move it out of ${ctx.ledger.dir}: history and undo skip it until then` }));
  const foreign = ctx.ledger.foreign();
  if (foreign.length) out.push({ message: `${foreign.length} ledger ${foreign.length === 1 ? 'run was' : 'runs were'} written by a newer benchkeeper: ${foreign.join(', ')}`, fix: 'run the newer benchkeeper: this one leaves them out of history and refuses to undo them or a run before them' });
  const seen = newerPaths();
  for (const run of ctx.ledger.list()) {
    // A run another process is still applying has no status yet: only one older than an hour counts as unfinished.
    if (!run.status && Date.now() - Date.parse(run.time) > 3600e3) out.push({ message: `run ${run.id} did not finish`, fix: `benchkeeper undo ${run.id} restores what it changed` });
    if (run.scope !== 'global' && !exists(run.scope)) continue;
    for (const e of [...run.entries].reverse()) {
      for (const [path, hash] of left(e)) {
        if (!path) continue;
        // A newer entry settled it; it still settles the older entries under it.
        const done = seen.settled(path);
        seen.add(path);
        if (done) continue;
        let now;
        try { now = hashPath(path); } catch (err) { out.push({ message: `${path} cannot be read (${err.code ?? 'read error'}) to compare it with run ${run.id}`, fix: 'fix its permissions, then run benchkeeper doctor again' }); continue; }
        if (now !== hash) out.push({ message: hash == null ? `${path} is back after run ${run.id} removed it` : `${path} changed since run ${run.id}`, fix: 'edit it back, or run the step again (benchkeeper plan shows it); undo refuses a file changed after its run' });
      }
    }
  }
  return out;
}

const packIssues = (ctx) => invalidPacks(ctx).map(({ file, reason }) => ({ message: `pack file ${file} is not used: ${reason}`, fix: `benchkeeper packs remove ${file} moves it to the backup` }));

export const integrity = (ctx) => [...ledgerIssues(ctx), ...packIssues(ctx)];
