// Installable units: one description of a skill, pack, plugin, rules or agent files that plan, apply, the ledger and undo
// read. A plan tags each change of a unit with it (change.installUnit), apply records its id on the ledger entry and the
// units of the run on the run, and undo can take one unit back.
import { sep } from 'node:path';

const UNIT_KINDS = ['skill', 'pack', 'plugin', 'rules', 'agent-files'];
// library: shipped with the app; git: a repository (at a ref when the unit names one, else its default branch);
// marketplace: a plugin marketplace entry.
const UNIT_SOURCES = ['library', 'git', 'marketplace'];
// files: removed with their backups (undo); skills-cli: the skills CLI's remove; plugin: the agent's plugin uninstall;
// block: BenchKeeper's block comes out of a file that stays.
const REMOVALS = ['files', 'skills-cli', 'plugin', 'block'];

// files are the paths the unit alone writes, whole files or folders; edits merged into a shared file (settings, the
// project block) are not listed, as other units edit the same file.
export function unit({ id, kind, source, agents, scope, files = [], removal }) {
  if (!UNIT_KINDS.includes(kind)) throw new Error(`unit ${id}: kind must be one of ${UNIT_KINDS.join(', ')}`);
  if (!UNIT_SOURCES.includes(source?.type)) throw new Error(`unit ${id}: source must be one of ${UNIT_SOURCES.join(', ')}`);
  if (!['global', 'project'].includes(scope)) throw new Error(`unit ${id}: scope must be global or project`);
  if (!REMOVALS.includes(removal)) throw new Error(`unit ${id}: removal must be one of ${REMOVALS.join(', ')}`);
  return { id, kind, source, agents, scope, files, removal };
}

// The distinct units among changes, in plan order.
export const unitsOf = (changes) => [...new Map(changes.filter((c) => c.installUnit).map((c) => [c.installUnit.id, c.installUnit])).values()];

const overlaps = (a, b) => a === b || a.startsWith(b + sep) || b.startsWith(a + sep);

// The source gate. Code fetched through npm (the skills CLI that adds or removes a git source's skill, a host tool) runs only
// after npm's signature check (verify) and with npm's before date 7 days back (npm_config_before), as each step sets them.
// A git source follows its default branch, or the ref the unit pins, with no age limit; a marketplace entry is added and updated
// by the agent itself; the shipped library comes with the app's own package.
const fetchesNpm = (argv) => Array.isArray(argv) && (argv[0] === 'npx' || (argv[0] === 'npm' && ['i', 'install'].includes(argv[1])));
export function gate(c) {
  if (fetchesNpm(c.argv) && !(c.verify && c.env?.npm_config_before)) throw new Error(`${c.title}: fetches code through npm without the signature check and the 7-day cooldown`);
  return c;
}

// A plan passes the gate, and two units that write the same file (or one inside the other's folder) are refused.
export function checkPlan(changes) {
  changes.forEach(gate);
  const seen = [];
  for (const u of unitsOf(changes)) {
    for (const f of u.files) {
      const other = seen.find((x) => x.id !== u.id && overlaps(x.file, f));
      if (other) throw new Error(`${other.id} and ${u.id} both write ${other.file === f ? f : `${other.file} and ${f}`}: one of them has to go`);
      seen.push({ id: u.id, file: f });
    }
  }
  return changes;
}
