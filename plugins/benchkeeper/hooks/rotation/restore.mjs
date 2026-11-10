// Codex SessionStart after a clear or compaction: hands the coordinator's handoff file back, as the Claude Code module does.
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { FILE, RUNS, mine, restored } from './handoff.mjs';

// Whether git tracks anything under the runs folder; any git failure counts as tracked, as in the Claude Code module.
const tracked = (cwd) => {
  try {
    return execFileSync('git', ['-c', 'core.fsmonitor=false', 'ls-files', '--', RUNS], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) !== '';
  } catch {
    return true;
  }
};

let handoff;
try {
  const { cwd } = JSON.parse(await text(process.stdin));
  const path = join(cwd, FILE);
  // A regular file reached through no link, so a committed file or a link to another file is never read as the handoff.
  if (!lstatSync(path).isFile() || realpathSync(path) !== join(realpathSync(cwd), FILE)) process.exit(0);
  handoff = readFileSync(path, 'utf8');
  if (!mine(handoff, process.env.ORCA_TERMINAL_HANDLE) || tracked(cwd)) process.exit(0);
} catch {
  process.exit(0);
}
// Plain stdout is added as developer context.
process.stdout.write(restored(handoff));
