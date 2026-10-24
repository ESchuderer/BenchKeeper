// Records what an interactive agent session changes in a project: a snapshot before and after, the changed files,
// the exit code and the agent's transcript. Undo restores the files from the snapshot before (runner.undo).
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { changedFiles, isRepo, repoRoot, snapshot } from './git.mjs';
import { SCHEMA, runId } from './ledger.mjs';

// The newest agent transcript written since the session started.
export function transcript(home, dir, since) {
  const claude = join(home, '.claude/projects', dir.replace(/[^a-zA-Z0-9]/g, '-'));
  const found = [];
  const scan = (d, depth) => {
    let entries = [];
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory() && depth > 0) scan(p, depth - 1);
      else if (e.name.endsWith('.jsonl')) { try { const t = statSync(p).mtimeMs; if (t >= since) found.push([t, p]); } catch { /* a dangling link */ } }
    }
  };
  scan(claude, 0);
  scan(join(home, '.codex/sessions'), 3);
  return found.sort((a, b) => b[0] - a[0])[0]?.[1] ?? null;
}

// The agent starts in dir; snapshots, file paths and undo cover the whole repository (entry cwd is its root).
export function recordSession(ctx, dir, argv) {
  if (!isRepo(ctx, dir)) throw new Error(`${dir} is not a git repository: a session is recorded through git snapshots`);
  const root = repoRoot(ctx, dir);
  const before = snapshot(ctx, root);
  const start = Date.now();
  const r = ctx.run(argv, { cwd: dir, stdio: 'inherit' });
  const after = snapshot(ctx, root);
  const run = {
    schema: SCHEMA, id: runId(), time: new Date(start).toISOString(), appVersion: ctx.appVersion, kind: 'session', scope: root,
    entries: [{ id: 'session', step: 'session', title: `agent session: ${argv.join(' ')}`, kind: 'session', argv, cwd: root, started: dir, exit: r.code, before, after, files: changedFiles(ctx, root, before, after), transcript: transcript(ctx.home, dir, start - 1000), status: 'done' }],
  };
  run.status = 'done';
  ctx.ledger.save(run);
  return run;
}
