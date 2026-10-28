// New-machine bootstrap: the projects of an imported profile that are not on this machine and carry an origin address
// are listed, and each is cloned only after its own question. Nothing is cloned under --yes, and an address that does
// not pass checkOrigin is refused, whatever the profile says.
import { join, resolve } from 'node:path';
import { exists, isDir } from './fsx.mjs';
import { checkOrigin, cloneChange, cloneName } from './origin.mjs';
import { mask } from './redact.mjs';
import { unfit } from './roots.mjs';
import { apply } from './runner.mjs';
import { projectCtx } from './steps/project.mjs';

// What the file says, as one safe line: escapes shown, tokens masked, cut short.
const shown = (v) => JSON.stringify(mask(String(v))).slice(0, 200);

// Returns the apply runs. A project that was cloned gets the new path in `p`, so the registration and the project setup
// that follow treat it like any project that was here. ask is the CLI's yes/no question; ask.line reads a line.
export async function cloneMissing(ctx, p, { into, yes, ask, out }) {
  const runs = [], todo = [];
  for (const x of (p.projects ?? []).filter((y) => y.origin !== undefined && !exists(y.path))) {
    try {
      const { url, host } = checkOrigin(x.origin);
      out.write(`missing ${x.path}: ${url} (host ${host})\n`);
      todo.push({ x, url });
    } catch (e) { out.write(`refused origin of ${x.path}: ${shown(x.origin)}: ${e.message}\n`); }
  }
  if (!todo.length) return runs;
  if (yes) { out.write('nothing is cloned under --yes: run profile import without it to confirm each clone\n'); return runs; }
  const typed = (into ?? await ask.line('Folder to clone the missing projects into (empty: none): '))?.trim();
  if (!typed) { out.write('nothing cloned\n'); return runs; }
  const folder = resolve(typed);
  if (!isDir(folder)) { out.write(`refused: ${folder} is not a folder\n`); return runs; }
  for (const { x, url } of todo) {
    const name = cloneName(x.path, url), dest = name && join(folder, name);
    if (!dest) { out.write(`refused: no usable folder name for ${x.path}\n`); continue; }
    if (exists(dest)) { out.write(`skipped ${dest}: exists already\n`); continue; }
    // Where it goes is checked as for any project, before the question: a clone is never made where a project cannot be.
    const why = unfit(ctx, dest);
    if (why) { out.write(`refused ${dest}: it is ${why}\n`); continue; }
    if (!(await ask(`Clone ${url} into ${dest}?`))) { out.write(`not cloned: ${url}\n`); continue; }
    const change = cloneChange({ url, dest, folder });
    const run = apply([change], projectCtx(ctx, dest), { scope: dest, select: [change.id] });
    runs.push(run);
    if (run.status === 'done') x.path = dest;
    else if (change.scheme === 'ssh') out.write('an ssh clone cannot ask for a host key or a passphrase: connect once with ssh to that host, or add its key to the agent\n');
  }
  return runs;
}
