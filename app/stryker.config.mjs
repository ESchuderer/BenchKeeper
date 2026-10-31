// Mutation testing of one logic module of quality.json: MUTATE_MODULE=<name> npm run mutate. node --test has no Stryker
// runner, so the command runner runs the test files that import src/<name>.mjs (or the module's `tests`) once per mutant.
// The run fails below the module's floor, the first measured score minus 2 points; a module without a floor only reports.
import { readdirSync, readFileSync } from 'node:fs';

const name = process.env.MUTATE_MODULE;
// Without the variable (knip reads this file too) the config mutates nothing.
const mod = name === undefined ? { tests: [], floor: null } : JSON.parse(readFileSync(new URL('quality.json', import.meta.url), 'utf8')).mutation[name];
if (!mod) throw new Error(`MUTATE_MODULE must name a module of quality.json "mutation", got ${name}`);
const imports = new RegExp(`src/${name}\\.mjs['"]`);
const tests = mod.tests ?? readdirSync(new URL('test', import.meta.url)).filter((f) => f.endsWith('.test.mjs') && imports.test(readFileSync(new URL(`test/${f}`, import.meta.url), 'utf8')));

export default {
  testRunner: 'command',
  // A looping mutant once filled the swap: each test process gets a heap cap.
  commandRunner: { command: `node --max-old-space-size=256 --import ./test/setup.mjs --test ${tests.map((f) => `test/${f}`).join(' ')}` },
  mutate: name === undefined ? [] : [`src/${name}.mjs`],
  coverageAnalysis: 'off',
  concurrency: 4,
  // The floors were measured with 30 s; a shorter timeout counts slow surviving mutants as killed.
  timeoutMS: 30000,
  thresholds: { high: 80, low: 60, break: mod.floor },
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: { fileName: `reports/mutation/${name}.json` },
  // In place: tests read files outside app/ (plugins/, web/scripts/) that a sandbox copy of app/ cannot reach. Stryker
  // puts the sources back when the run ends; after a killed run, `git checkout src` does.
  inPlace: true,
  disableTypeChecks: false,
};
