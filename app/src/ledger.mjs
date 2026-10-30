// Install ledger: one JSON file per run under <config>/ledger, backups under <config>/backup/<run id>.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import nodePath, { dirname, join, sep } from 'node:path';
import { readText, real, writeAtomic } from './fsx.mjs';

export const SCHEMA = 1;

const held = new Map();
const alive = (pid) => { if (!Number.isInteger(pid) || pid < 1) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
// Start time of a process (Linux: field 22 of /proc/<pid>/stat), undefined where the OS does not tell.
const startOf = (pid) => { try { return readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^.*\) /, '').split(' ')[19]; } catch { return undefined; } };
// Command line of a process where no start time is known (macOS ps, Windows CIM), undefined when the OS does not tell.
const commandOf = (pid) => {
  const [cmd, args] = process.platform === 'win32'
    ? [join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`]]
    : ['ps', ['-ww', '-o', 'command=', '-p', String(pid)]];
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 10e3 });
  return (r.status === 0 && r.stdout?.trim()) || undefined;
};

export function runId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `${stamp}-${randomBytes(3).toString('hex')}`;
}

// A file's place below <run>/<change number>: its path below HOME, else below _root with a drive letter or UNC prefix as a
// plain folder name (Windows refuses a colon in a folder name). Windows paths compare case-insensitively.
export function backupRel(home, file, path = nodePath) {
  const p = path.resolve(file);
  const fold = (s) => (path.sep === '\\' ? s.toLowerCase() : s);
  if (fold(p).startsWith(fold(home + path.sep))) return path.relative(home, p);
  return path.join('_root', p.replace(/^\\\\/, 'UNC\\').replace(/^([A-Za-z]):/, '$1'));
}

export class Ledger {
  constructor(config, home) {
    this.dir = join(config, 'ledger');
    this.backups = join(config, 'backup');
    this.home = home;
    this.proc = { alive, startOf, commandOf };
  }

  // The process that wrote a lock still runs: its pid is alive and, where both are known, started when the lock says or,
  // without a start time, runs the command line the lock says (a reused pid is another program).
  holds({ pid, start, cmd }) {
    const { alive, startOf, commandOf } = this.proc;
    if (!alive(pid)) return false;
    const now = start ? startOf(pid) : cmd && commandOf(pid);
    return !now || now === (start ?? cmd);
  }

  // <backup>/<run>/<change number>/<path below HOME>: one file changed twice in a run keeps both earlier states.
  backupPath(id, n, path) {
    const out = join(this.backups, id, String(n), backupRel(this.home, path));
    // Backups hold copies of settings files with tokens: the folders are the user's alone.
    mkdirSync(dirname(out), { recursive: true, mode: 0o700 });
    return out;
  }

  // Backups hold the old text of settings files, tokens included: a rotated token must not stay in them for good. A run's
  // backup folder goes after `days` (BENCHKEEPER_BACKUP_DAYS, default 90, 0 keeps them); undo of that run then reports the
  // missing backup. Only folders named like a run id go: setup.sh backups are dated folders of another form.
  prune(days = Number(process.env.BENCHKEEPER_BACKUP_DAYS ?? 90), now = Date.now()) {
    if (!(days > 0)) return [];
    const gone = [];
    let names = [];
    try { names = readdirSync(this.backups); } catch { return gone; }
    for (const n of names) {
      const m = n.match(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z-[0-9a-f]{6}$/);
      if (m && Date.UTC(m[1], m[2] - 1, m[3], m[4], m[5], m[6]) < now - days * 864e5) { rmSync(join(this.backups, n), { recursive: true, force: true }); gone.push(n); }
    }
    return gone;
  }

  save(run) {
    this.cache = null;
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    // Folders made by an earlier version keep their mode otherwise.
    for (const d of [this.dir, this.backups]) { try { chmodSync(d, 0o700); } catch { /* not there yet */ } }
    writeAtomic(join(this.dir, `${run.id}.json`), `${JSON.stringify(run, null, 2)}\n`, 0o600);
  }

  // One run at a time on this config folder, also across processes: a lock file with the pid and the start time of the run,
  // or its command line where the OS tells no start time: a reused pid is not the dead run. A second run in the same process
  // goes on (Update all applies many times). The lock of a dead process is taken over under a second file made with wx, so two processes that find the
  // same dead lock cannot both remove it: the one that holds the guard compares the lock with what it examined before removing.
  // shortcut: a takeover guard left by a crash is removed after 5 s by the next run (check-then-remove on that file only).
  lock() {
    const file = join(dirname(this.dir), 'lock'), guard = `${file}.takeover`;
    const release = () => { const n = held.get(file) - 1; if (n > 0) held.set(file, n); else { held.delete(file); rmSync(file, { force: true }); } };
    if (held.has(file)) { held.set(file, held.get(file) + 1); return release; }
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const check = (pid) => (process.platform === 'win32' ? `tasklist /fi "pid eq ${pid}"` : `ps -p ${pid}`);
    const busy = (pid) => new Error(`another BenchKeeper run is in progress${pid ? ` (process ${pid})` : ''}: wait until it ends. `
      + `If no BenchKeeper run is going${pid ? ` (check with ${check(pid)})` : ''}, remove ${file}`);
    const start = this.proc.startOf(process.pid);
    const me = JSON.stringify({ pid: process.pid, start, cmd: start ? undefined : this.proc.commandOf(process.pid) });
    for (;;) {
      try { writeFileSync(file, me, { flag: 'wx', mode: 0o600 }); break; } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        let text;
        try { text = readFileSync(file, 'utf8'); } catch (r) { if (r.code === 'ENOENT') continue; throw r; } // released just now: take it
        let holder = {};
        try { holder = JSON.parse(text) ?? {}; } catch { /* being written right now, or torn */ }
        const fresh = Date.now() - (statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? 0) < 5000;
        // Not held here (held is empty), so this process's own pid names a lock an earlier process with that pid left.
        if ((holder.pid !== process.pid && this.holds(holder)) || (!holder.pid && fresh)) throw busy(holder.pid);
        try { writeFileSync(guard, String(process.pid), { flag: 'wx', mode: 0o600 }); } catch (g) {
          if (g.code !== 'EEXIST') throw g;
          if (Date.now() - (statSync(guard, { throwIfNoEntry: false })?.mtimeMs ?? Date.now()) < 5000) throw busy();
          rmSync(guard, { force: true });
          continue;
        }
        // Only the lock just examined goes: another process that took it over meanwhile keeps it.
        try { if (readText(file) === text) rmSync(file, { force: true }); } finally { rmSync(guard, { force: true }); }
      }
    }
    held.set(file, 1);
    return release;
  }

  get(id) {
    if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) throw Object.assign(new Error(`bad run id: ${id}`), { status: 400 });
    try { return JSON.parse(readFileSync(join(this.dir, `${id}.json`), 'utf8')); } catch (e) {
      if (e.code === 'ENOENT') throw Object.assign(new Error(`no run ${id}`), { status: 404 });
      // Never the raw parser error: it names no run and, in the server, reads like a crash.
      throw Object.assign(new Error(`the ledger file of run ${id} is unreadable (${e instanceof SyntaxError ? 'not valid JSON' : e.code ?? 'read error'}): move it out of ${this.dir}`), { status: 500 });
    }
  }

  // Kept until the next save here or a change of the folder (each save renames a file into it, so another process's
  // save changes its mtime). Callers read the runs; they do not change them.
  list() {
    let names = [], gen;
    try { gen = statSync(this.dir).mtimeMs; names = readdirSync(this.dir).filter((n) => n.endsWith('.json')); } catch { return []; }
    if (this.cache?.gen === gen && this.cache.count === names.length) return this.cache.runs;
    const runs = names.sort().reverse().map((n) => {
      try { return JSON.parse(readFileSync(join(this.dir, n), 'utf8')); } catch { return null; }
    }).filter((r) => r?.schema === SCHEMA);
    this.cache = { gen, count: names.length, runs };
    return runs;
  }

  // Each run file's name with its content, undefined where it does not parse.
  files() {
    let names = [];
    try { names = readdirSync(this.dir).filter((n) => n.endsWith('.json')); } catch { return []; }
    return names.sort().map((n) => { try { return [n, JSON.parse(readFileSync(join(this.dir, n), 'utf8'))]; } catch { return [n, undefined]; } });
  }

  // Names of run files that do not parse: list() leaves them out, so doctor names them.
  broken() {
    return this.files().filter(([, v]) => v === null || typeof v !== 'object' || Array.isArray(v)).map(([n]) => n);
  }

  // Names of runs of another schema (a newer app wrote them): list() leaves them out too, so doctor names them and undo
  // refuses to go past them.
  foreign() {
    return this.files().filter(([, v]) => v !== null && typeof v === 'object' && !Array.isArray(v) && v.schema !== SCHEMA).map(([n]) => n);
  }

  // A moved project folder: the runs of that scope (and the Update all and removal runs, whose scope is a worktree and
  // whose note names the project) get the new path in their scope, note and entry paths (not in the
  // backup paths, which lie in the config folder). Callers hold the lock.
  relocate(from, to) {
    const swap = (v, key) => {
      if (typeof v === 'string') return key !== 'backup' && (v === from || v.startsWith(from + sep)) ? to + v.slice(from.length) : v;
      if (Array.isArray(v)) return v.map((x) => swap(x));
      return v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x, k)])) : v;
    };
    for (const run of this.list().filter((r) => r.scope === from || r.note?.updateAll === from)) this.save(swap(run));
  }

  // The newest applied, not undone, write entry for a path.
  last(path) {
    const p = real(path);
    for (const run of this.list()) {
      const e = [...run.entries].reverse().find((x) => x.path === p && x.status === 'done' && !x.undone);
      if (e) return e;
    }
    return null;
  }
}
