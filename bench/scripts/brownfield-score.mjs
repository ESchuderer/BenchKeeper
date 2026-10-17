// Brownfield score (0 to 100) of each trial of an openballistics run (owner decision 2026-10-17):
// step checks 45, review 35, suite 10, cross-step checks 10. Cost and minutes are reported, not scored.
// Usage: node bench/scripts/brownfield-score.mjs <run-dir>   writes <run-dir>/brownfield-score.json and prints a table
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Step checks per step (bench/briefs/openballistics/checks/step<k>.sh): a step not reached counts all of them as failed.
export const STEP_CHECKS = { 1: 14, 2: 7, 3: 3 };
// Cross-step checks run from step 2 on (checks/cross.sh): ci, changelog, version.
export const CROSS_CHECKS = { 2: 3, 3: 3 };
export const WEIGHTS = { checks: 45, review: 35, suite: 10, cross: 10 };

const num = (v) => (typeof v === 'number' ? v : typeof v?.score === 'number' ? v.score : null);
const share = (passed, of) => (of ? passed / of : 0);

export function score(trial, reviews) {
  const steps = new Map((trial?.steps ?? []).map((s) => [s.k, s]));
  let sPassed = 0, sOf = 0, xPassed = 0, xOf = 0, suite = 0;
  for (const k of Object.keys(STEP_CHECKS).map(Number)) {
    const s = steps.get(k);
    const ids = (s?.checks ?? []).filter((c) => c.ok !== null && c.ok !== undefined);
    const own = ids.filter((c) => c.id.startsWith('S'));
    // a reached step with fewer checkable checks than expected: the missing ones count as failed
    sPassed += own.filter((c) => c.ok).length;
    sOf += Math.max(STEP_CHECKS[k], own.length);
    if (CROSS_CHECKS[k]) {
      // X checks with ok null (no plain CI step to run) are not counted; a step not reached counts all as failed
      const cross = ids.filter((c) => c.id.startsWith('X'));
      xPassed += cross.filter((c) => c.ok).length;
      xOf += s ? cross.length : CROSS_CHECKS[k];
    }
    if (s?.suite_ok === true) suite++;
  }
  // review: every criterion 1 to 5 mapped to 0 to 1, mean over the criteria and the reviews present
  const crit = reviews.flatMap((r) => Object.values(r?.review?.scores ?? {}).map(num).filter((v) => v !== null));
  const review = crit.length ? crit.reduce((a, v) => a + (v - 1) / 4, 0) / crit.length : null;
  const parts = {
    checks: WEIGHTS.checks * share(sPassed, sOf),
    review: review === null ? null : WEIGHTS.review * review,
    suite: WEIGHTS.suite * (suite / Object.keys(STEP_CHECKS).length),
    cross: WEIGHTS.cross * share(xPassed, xOf),
  };
  const r2 = (x) => (x === null ? null : Math.round(x * 100) / 100);
  return {
    total: parts.review === null ? null : r2(Object.values(parts).reduce((a, v) => a + v, 0)),
    parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, r2(v)])),
    raw: { step_checks: `${sPassed}/${sOf}`, cross_checks: `${xPassed}/${xOf}`, suite_steps: suite, review_criteria: crit.length },
    minutes: r2((trial?.steps ?? []).reduce((a, s) => a + (s.minutes ?? 0), 0)),
    cost_usd_api_equivalent: r2((trial?.steps ?? []).reduce((a, s) => a + (s.cost_usd_api_equivalent ?? 0), 0)),
  };
}

const json = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const run = process.argv[2];
  const rows = [];
  for (const round of readdirSync(run).filter((d) => /^round-\d+$/.test(d)).sort()) {
    for (const arm of readdirSync(join(run, round)).sort()) {
      const t = join(run, round, arm);
      if (!existsSync(join(t, 'trial.json'))) continue;
      const reviews = readdirSync(t).filter((f) => /^review(-\d+)?\.json$/.test(f)).map((f) => json(join(t, f)));
      rows.push({ round, arm, ...score(json(join(t, 'trial.json')), reviews) });
    }
  }
  writeFileSync(join(run, 'brownfield-score.json'), JSON.stringify({ weights: WEIGHTS, trials: rows }, null, 2));
  for (const r of rows) console.log(`${r.round} ${r.arm.padEnd(3)} total ${r.total ?? 'n/a (no review)'}  checks ${r.parts.checks} review ${r.parts.review} suite ${r.parts.suite} cross ${r.parts.cross}  ${r.minutes} min`);
}
