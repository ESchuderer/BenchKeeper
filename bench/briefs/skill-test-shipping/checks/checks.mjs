// Step 1 checks of skill-test-shipping, run by skill-common/run.mjs. The agent's tests (`npm test` of the workspace) run
// on the baseline's src/ (the agent's src/ changes are not used): S1-green, they pass; S1-kill-<m>, they pass there and
// fail with src/shipping.js replaced by the hidden mutant checks/mutants/<m>.js (one changed rule each, `t.hidden`).
// A run stopped at its time limit (50 s, two runs within run.mjs's 120 s per check) is no kill: the check fails.
import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LIMIT = 50000;
const MUTANTS = ['express-base-only', 'express-free', 'free-eu', 'started-step', 'threshold', 'zero-weight'];
const baseSrc = (t) => { rmSync(join(t.ws, 'src'), { recursive: true, force: true }); cpSync(join(t.base, 'src'), join(t.ws, 'src'), { recursive: true }); };
const run = (t) => t.sh('npm test --silent', t.ws, LIMIT);
const kill = (m) => async (t) => {
  baseSrc(t);
  const g = run(t);
  if (g.timedOut) return { ok: false, detail: 'time limit on the original source' };
  if (g.code !== 0) return { ok: false, detail: 'tests fail on the original source' };
  writeFileSync(join(t.ws, 'src/shipping.js'), t.hidden[`mutants/${m}.js`]);
  const r = run(t);
  if (r.timedOut) return { ok: false, detail: 'time limit on the mutant' };
  return { ok: r.code !== 0, detail: r.code !== 0 ? 'killed' : 'survived' };
};

export default {
  // Passes, with more tests than the baseline (counted by node --test with a fixed reporter).
  'S1-green': async (t) => {
    baseSrc(t);
    const g = run(t);
    const [n, before] = [t.countTests(t.ws), t.countTests(t.base)];
    return { ok: g.code === 0 && !g.timedOut && n > before, detail: `exit ${g.code}${g.timedOut ? ' (time limit)' : ''}, ${n} tests, baseline ${before}` };
  },
  ...Object.fromEntries(MUTANTS.map((m) => [`S1-kill-${m}`, kill(m)])),
  'S1-src-unchanged': async (t) => {
    const changed = readdirSync(join(t.base, 'src')).filter((f) => t.read(join('src', f)) !== readFileSync(join(t.base, 'src', f), 'utf8'));
    return { ok: changed.length === 0, detail: changed.join(',') };
  },
  // The baseline's only other test covers src/format.js, which S1-src-unchanged already guards.
  'S1-regressions': null,
};
