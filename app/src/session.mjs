// Records what an interactive agent session changes in a project: a snapshot before and after, the changed files,
// the exit code and the agent's transcript. Undo restores the files from the snapshot before (runner.undo).
import { openSync, readSync, closeSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { realish } from './fsx.mjs';
import { changedFiles, isRepo, repoRoot, snapshot } from './git.mjs';
import { SCHEMA, runId } from './ledger.mjs';
import { redactArgv } from './redact.mjs';

// The working folder a Codex rollout starts in (the session_meta line): rollouts of every project share one folder.
function codexCwd(file) {
  let fd;
  try {
    fd = openSync(file, 'r');
    // The session_meta line carries the instructions text and can be long: read up to 1 MiB of it.
    const buf = Buffer.alloc(1 << 20);
    const first = buf.toString('utf8', 0, readSync(fd, buf, 0, buf.length, 0)).split('\n')[0];
    return JSON.parse(first)?.payload?.cwd ?? null;
  } catch { return null; } finally { if (fd !== undefined) closeSync(fd); }
}

// The newest transcript of the recorded agent (claude or codex, by the command's name) written since the session started
// in dir; null for any other agent.
export function transcript(home, dir, since, agent) {
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
  if (agent === 'claude') scan(claude, 0);
  else if (agent === 'codex') { scan(join(home, '.codex/sessions'), 3); found.splice(0, found.length, ...found.filter(([, p]) => codexCwd(p) != null && realish(codexCwd(p)) === realish(dir))); }
  return found.sort((a, b) => b[0] - a[0])[0]?.[1] ?? null;
}

// The agent starts in dir; snapshots, file paths and undo cover the whole repository (entry cwd is its root).
export function recordSession(ctx, dir, argv) {
  if (!isRepo(ctx, dir)) throw new Error(`${dir} is not a git repository: a session is recorded through git snapshots`);
  const root = repoRoot(ctx, dir);
  const before = snapshot(ctx, root);
  const start = Date.now();
  const r = ctx.run(argv, { cwd: dir, stdio: 'inherit' });
  // The ledger keeps what the user typed with secrets masked (best effort: a secret in an unflagged argument is kept).
  const shown = redactArgv(argv);
  const after = snapshot(ctx, root);
  const run = {
    schema: SCHEMA, id: runId(), time: new Date(start).toISOString(), appVersion: ctx.appVersion, kind: 'session', scope: root,
    entries: [{ id: 'session', step: 'session', title: `agent session: ${shown.join(' ')}`, kind: 'session', argv: shown, cwd: root, started: dir, exit: r.code, before, after, files: changedFiles(ctx, root, before, after), transcript: transcript(ctx.home, dir, start - 1000, basename(argv[0]).replace(/\.(exe|cmd)$/i, '')), status: 'done' }],
  };
  run.status = 'done';
  ctx.ledger.save(run);
  return run;
}
