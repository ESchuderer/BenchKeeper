// Folders a project may not be: a project is a write root, so the root of a drive, the home folder or a parent of it, and
// the config folder (ledger, backups) would make every file of the user writable by a project run.
import { parse, sep } from 'node:path';
import { realish } from './fsx.mjs';

const holds = (outer, inner) => inner === outer || inner.startsWith(outer.endsWith(sep) ? outer : outer + sep);

// Why path cannot be a project, or null.
export function unfit(ctx, path) {
  const p = realish(path);
  if (p === parse(p).root) return 'the root of a drive';
  if (holds(p, realish(ctx.home))) return 'the home folder or a parent of it';
  if (holds(p, realish(ctx.config)) || holds(realish(ctx.config), p)) return 'the BenchKeeper config folder or a folder holding it';
  return null;
}
