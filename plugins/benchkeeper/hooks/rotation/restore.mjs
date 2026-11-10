// Codex SessionStart after a clear or compaction: hands the coordinator's handoff file back, as the Claude Code module does.
import { execFileSync } from 'node:child_process';
import { constants, fstatSync, openSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { text } from 'node:stream/consumers';
import { FILE, RUNS, mine, restored } from './handoff.mjs';

// git from an absolute folder of PATH, never by its bare name: Windows looks in the working folder, a project, first.
const git = () =>
  (process.env.PATH ?? '')
    .split(delimiter)
    .filter((folder) => isAbsolute(folder))
    .map((folder) => join(folder, process.platform === 'win32' ? 'git.exe' : 'git'))
    .find((path) => {
      try {
        return statSync(path).isFile();
      } catch {
        return false;
      }
    });

// Whether git tracks anything under the runs folder; no git or any git failure counts as tracked, as in the Claude Code module.
const tracked = (cwd) => {
  const program = git();
  if (!program) return true;
  try {
    return execFileSync(program, ['-c', 'core.fsmonitor=false', 'ls-files', '--', RUNS], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) !== '';
  } catch {
    return true;
  }
};

let handoff;
try {
  const { cwd } = JSON.parse(await text(process.stdin));
  const path = join(cwd, FILE);
  // The runs folder reached through no link, the file opened without following one and read through that handle, so a
  // committed file or a link to another file is never read as the handoff.
  if (realpathSync(dirname(path)) !== join(realpathSync(cwd), RUNS)) process.exit(0);
  const handle = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  if (!fstatSync(handle).isFile()) process.exit(0);
  handoff = readFileSync(handle, 'utf8');
  if (!mine(handoff, process.env.ORCA_TERMINAL_HANDLE) || tracked(cwd)) process.exit(0);
} catch {
  process.exit(0);
}
// Plain stdout is added as developer context.
process.stdout.write(restored(handoff));
