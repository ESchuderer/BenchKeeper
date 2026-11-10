// Codex SessionStart after a clear or compaction: hands the coordinator's handoff file back, as the Claude Code module does.
import { execFileSync } from 'node:child_process';
import { constants, fstatSync, openSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
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
  // Opened without following a link where the platform can (Windows cannot), read through that handle, and refused unless
  // its real path is the one under the real working folder, so a committed file or a link on the way is never read.
  const handle = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  if (!fstatSync(handle).isFile() || realpathSync(path) !== join(realpathSync(cwd), FILE)) process.exit(0);
  handoff = readFileSync(handle, 'utf8');
  if (!mine(handoff, process.env.ORCA_TERMINAL_HANDLE) || tracked(cwd)) process.exit(0);
} catch {
  process.exit(0);
}
// As additionalContext, which codex.json lets through whole (additionalContextLimit 0): restored() caps it below 10,000
// characters, while Codex would cut plain stdout past about 2,500 tokens to a preview.
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: restored(handoff) } }));
