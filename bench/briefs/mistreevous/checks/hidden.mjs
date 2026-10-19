// Turns the mocha JSON reports of the hidden tests (<dir>/h<j>.json, j = 1..k) into checks: one per top-level describe of
// step k (its title is the check id), plus S<k>-regressions from step 2 on. A report that is missing or unreadable (the
// tests did not load, for example because the API is missing) fails every check of its step with the reason.
// Usage: node hidden.mjs <k> <dir>
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Check ids per step, in hidden/step<k>.spec.ts.
export const IDS = {
  1: ['S1-api', 'S1-resume', 'S1-counters', 'S1-random', 'S1-wait-clock', 'S1-wait-delta', 'S1-details', 'S1-fresh-run'],
  2: ['S2-reject', 'S2-unchanged', 'S2-equivalent', 'S2-invalid', 'S2-async'],
  3: ['S3-no-events', 'S3-detached'],
};

export function fromReport(report, ids) {
  if (!report?.stats) return ids.map((id) => ({ id, ok: false, detail: 'hidden tests did not run' }));
  const all = [...(report.passes || []).map((t) => ({ ...t, ok: true })), ...(report.failures || []).map((t) => ({ ...t, ok: false }))];
  return ids.map((id) => {
    const mine = all.filter((t) => t.fullTitle.startsWith(`${id} `));
    const failed = mine.filter((t) => !t.ok);
    return { id, ok: mine.length > 0 && !failed.length,
      detail: !mine.length ? 'no test ran' : failed.length ? failed.map((t) => `${t.title}: ${String(t.err?.message || '').slice(0, 150)}`).join('; ') : `${mine.length} tests pass` };
  });
}

export function hiddenChecks(k, load) {
  const out = fromReport(load(k), IDS[k]);
  if (k > 1) {
    const earlier = Array.from({ length: k - 1 }, (_, i) => fromReport(load(i + 1), IDS[i + 1])).flat();
    const bad = earlier.filter((c) => !c.ok);
    out.push({ id: `S${k}-regressions`, ok: !bad.length, detail: bad.length ? `failing: ${bad.map((c) => c.id).join(', ')}` : 'earlier hidden tests pass' });
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [k, dir] = process.argv.slice(2);
  const load = (j) => { try { return JSON.parse(readFileSync(`${dir}/h${j}.json`, 'utf8')); } catch { return null; } };
  console.log(JSON.stringify({ checks: hiddenChecks(Number(k), load) }));
}
