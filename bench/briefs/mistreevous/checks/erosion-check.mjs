// Q<k>-erosion from bench/scorer/erosion.mjs output before and after step k: passes when erosion (the share of complexity
// in functions above complexity 10, as SlopCodeBench measures it) rises by at most MAX_RISE. Unmeasured counts as failed.
// Usage: node erosion-check.mjs <k> <before.json> <after.json>
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const MAX_RISE = 0.01;

export function erosionCheck(k, before, after) {
  const id = `Q${k}-erosion`;
  if (typeof before?.erosion !== 'number' || typeof after?.erosion !== 'number') return { id, ok: false, detail: 'not measured' };
  return { id, ok: after.erosion <= before.erosion + MAX_RISE, detail: `erosion ${before.erosion} to ${after.erosion}, max complexity ${before.max_complexity} to ${after.max_complexity}` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [k, b, a] = process.argv.slice(2);
  const load = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
  console.log(JSON.stringify({ checks: [erosionCheck(Number(k), load(b), load(a))] }));
}
