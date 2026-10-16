// Static scan of an app's own source (same file selection as erosion.mjs) with the scorer's ESLint config.
// Usage: node static-scan.mjs <app-dir> <out-dir>   writes <out-dir>/static-scan.json; needs bench/scorer/node_modules
// Files that fail to parse as modules are linted again as scripts; files that fail both count in totals.parse_errors.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ESLint } from 'eslint';
import { files } from './erosion.mjs';
import { makeConfig } from './static-scan.config.mjs';

const SONAR = JSON.parse(readFileSync(new URL('./sonar-types.json', import.meta.url), 'utf8'));
const lint = (cwd, sourceType, paths) =>
  new ESLint({ cwd, overrideConfigFile: true, overrideConfig: makeConfig(sourceType), errorOnUnmatchedPattern: false }).lintFiles(paths);

// Group of a rule id: core ESLint rules are `lint`, sonarjs rules by sonar-types.json, security/* and sonarjs vulnerabilities `security`.
export function group(ruleId) {
  if (ruleId.startsWith('security/')) return 'security';
  if (ruleId.startsWith('sonarjs/')) {
    const t = SONAR[ruleId.slice(8)];
    if (!t) throw new Error(`sonarjs rule without a type: ${ruleId}`);
    return t === 'bug' ? 'sonar_bugs' : t === 'smell' ? 'sonar_smells' : 'security';
  }
  return 'lint';
}

export async function scan(app, paths = files(app).filter((f) => /\.(js|mjs|cjs)$/.test(f))) {
  const root = resolve(app);
  let results = await lint(root, 'module', paths);
  const retry = results.filter((r) => r.messages.some((m) => m.fatal)).map((r) => r.filePath);
  if (retry.length) {
    const second = new Map((await lint(root, 'script', retry)).map((r) => [r.filePath, r]));
    results = results.map((r) => second.get(r.filePath) ?? r);
  }
  const totals = { files: paths.length, lines: 0, errors: 0, warnings: 0, parse_errors: 0 };
  const rules = {};
  const groups = Object.fromEntries(['lint', 'sonar_bugs', 'sonar_smells', 'security'].map((g) => [g, { count: 0, per_1000_lines: 0, rules: {} }]));
  for (const r of results) {
    totals.lines += readFileSync(r.filePath, 'utf8').split('\n').length - 1;
    for (const m of r.messages) {
      if (m.fatal) { totals.parse_errors++; continue; }
      if (m.severity === 2) totals.errors++; else totals.warnings++;
      rules[m.ruleId] = (rules[m.ruleId] ?? 0) + 1;
      const g = groups[group(m.ruleId)];
      g.count++;
      g.rules[m.ruleId] = (g.rules[m.ruleId] ?? 0) + 1;
    }
  }
  for (const g of Object.values(groups)) g.per_1000_lines = totals.lines ? +((g.count * 1000) / totals.lines).toFixed(2) : 0;
  return { totals, rules, ...groups };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = await scan(process.argv[2]);
  mkdirSync(process.argv[3], { recursive: true });
  writeFileSync(join(process.argv[3], 'static-scan.json'), JSON.stringify(out, null, 2) + '\n');
}
