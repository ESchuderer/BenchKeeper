// Codex SessionStart after a clear or compaction: hands the coordinator's handoff file back, as the Claude Code module does.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { FILE, HEADER } from './handoff.mjs';

const { cwd } = JSON.parse(await text(process.stdin));
let handoff;
try {
  handoff = readFileSync(join(cwd, FILE), 'utf8');
} catch {
  process.exit(0);
}
// Plain stdout is added as developer context.
process.stdout.write(`${HEADER}\n\n${handoff}`);
