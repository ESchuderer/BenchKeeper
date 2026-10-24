// Install ledger: one JSON file per run under <config>/ledger, backups under <config>/backup/<run id>.
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { real, writeAtomic } from './fsx.mjs';

export const SCHEMA = 1;

const held = new Map();
const alive = (pid) => { if (!Number.isInteger(pid) || pid < 1) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

export function runId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `${stamp}-${randomBytes(3).toString('hex')}`;
}

export class Ledger {
  constructor(config, home) {
    this.dir = join(config, 'ledger');
    this.backups = join(config, 'backup');
    this.home = home;
  }

  // <backup>/<run>/<change number>/<path below HOME>: one file changed twice in a run keeps both earlier states.
  backupPath(id, n, path) {
    const p = resolve(path);
    const rel = p.startsWith(this.home + sep) ? relative(this.home, p) : join('_root', p);
    const out = join(this.backups, id, String(n), rel);
    // Backups hold copies of settings files with tokens: the folders are the user's alone.
    mkdirSync(dirname(out), { recursive: true, mode: 0o700 });
    return out;
  }

  save(run) {
    this.cache = null;
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    // Folders made by an earlier version keep their mode otherwise.
    for (const d of [this.dir, this.backups]) { try { chmodSync(d, 0o700); } catch { /* not there yet */ } }
    writeAtomic(join(this.dir, `${run.id}.json`), `${JSON.stringify(run, null, 2)}\n`, 0o600);
  }

  // One run at a time on this config folder, also across processes: a lock file with the pid of the run. A second run
  // in the same process goes on (Update all applies many times); the lock of a dead process is taken over.
  // shortcut: a reused pid keeps a dead run's lock alive, delete <config>/lock then.
  lock() {
    const file = join(dirname(this.dir), 'lock');
    const release = () => { const n = held.get(file) - 1; if (n > 0) held.set(file, n); else { held.delete(file); rmSync(file, { force: true }); } };
    if (held.has(file)) { held.set(file, held.get(file) + 1); return release; }
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    for (;;) {
      try { writeFileSync(file, JSON.stringify({ pid: process.pid }), { flag: 'wx', mode: 0o600 }); break; } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        let pid;
        try { pid = JSON.parse(readFileSync(file, 'utf8')).pid; } catch { /* being written right now, or torn */ }
        const fresh = Date.now() - (statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? 0) < 5000;
        if (alive(pid) || (!pid && fresh)) throw new Error(`another BenchKeeper run is in progress${pid ? ` (process ${pid})` : ''}: wait until it ends`);
        rmSync(file, { force: true });
      }
    }
    held.set(file, 1);
    return release;
  }

  get(id) {
    if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) throw Object.assign(new Error(`bad run id: ${id}`), { status: 400 });
    try { return JSON.parse(readFileSync(join(this.dir, `${id}.json`), 'utf8')); } catch (e) {
      if (e.code === 'ENOENT') throw Object.assign(new Error(`no run ${id}`), { status: 404 });
      throw e;
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
