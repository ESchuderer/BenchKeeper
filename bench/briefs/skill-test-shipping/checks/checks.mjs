// Step 1 checks of skill-test-shipping, run by skill-common/run.mjs. The agent's tests (`npm test` of the workspace) run
// on the baseline's src/ (the agent's src/ changes are not used): S1-green, they pass; S1-kill-<m>, they pass there and
// fail with src/shipping.js replaced by the hidden mutant checks/mutants/<m>.js (one changed rule each).
import { cpSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const MUTANTS = '/brief/checks/mutants';
const baseSrc = (t) => { rmSync(join(t.ws, 'src'), { recursive: true, force: true }); cpSync(join(t.base, 'src'), join(t.ws, 'src'), { recursive: true }); };
const green = (t) => { baseSrc(t); return t.sh('npm test --silent'); };
const kill = (m) => async (t) => {
  const g = green(t);
  if (g.code !== 0) return { ok: false, detail: 'tests fail on the original source' };
  cpSync(join(MUTANTS, `${m}.js`), join(t.ws, 'src/shipping.js'));
  const r = t.sh('npm test --silent');
  return { ok: r.code !== 0, detail: r.code !== 0 ? 'killed' : 'survived' };
};

export default {
  // Passes, with more tests than the baseline (TAP or spec reporter summary).
  'S1-green': async (t) => {
    const count = (out) => Number(/^(?:# |\u2139 )tests (\d+)$/m.exec(out)?.[1] ?? 0);
    const g = green(t);
    const [n, before] = [count(g.out), count(t.sh('node --test', t.base).out)];
    return { ok: g.code === 0 && n > before, detail: `exit ${g.code}, ${n} tests, baseline ${before}` };
  },
  ...Object.fromEntries(readdirSync(MUTANTS).filter((f) => f.endsWith('.js')).sort().map((f) => [`S1-kill-${f.slice(0, -3)}`, kill(f.slice(0, -3))])),
  'S1-src-unchanged': async (t) => {
    const changed = readdirSync(join(t.base, 'src')).filter((f) => t.read(join('src', f)) !== readFileSync(join(t.base, 'src', f), 'utf8'));
    return { ok: changed.length === 0, detail: changed.join(',') };
  },
  // The baseline's only other test covers src/format.js, which S1-src-unchanged already guards.
  'S1-regressions': null,
};
