// Install ledger: one JSON file per run under <config>/ledger, backups under <config>/backup/<run id>.
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { writeAtomic } from './fsx.mjs';

export const SCHEMA = 1;

export function runId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `${stamp}-${Math.random().toString(36).slice(2, 6)}`;
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
    return join(this.backups, id, String(n), rel);
  }

  save(run) {
    mkdirSync(this.dir, { recursive: true });
    writeAtomic(join(this.dir, `${run.id}.json`), `${JSON.stringify(run, null, 2)}\n`);
  }

  get(id) {
    if (!/^[\w-]+$/.test(id)) throw new Error(`bad run id: ${id}`);
    return JSON.parse(readFileSync(join(this.dir, `${id}.json`), 'utf8'));
  }

  list() {
    let names = [];
    try { names = readdirSync(this.dir).filter((n) => n.endsWith('.json')); } catch { return []; }
    return names.sort().reverse().map((n) => {
      try { return JSON.parse(readFileSync(join(this.dir, n), 'utf8')); } catch { return null; }
    }).filter((r) => r?.schema === SCHEMA);
  }

  // The newest applied, not undone, write entry for a path.
  last(path) {
    const p = resolve(path);
    for (const run of this.list()) {
      const e = [...run.entries].reverse().find((x) => x.path === p && x.status === 'done' && !x.undone);
      if (e) return e;
    }
    return null;
  }
}
