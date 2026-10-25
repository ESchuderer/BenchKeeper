// HTML validity from a Nu HTML Checker run (`vnu --format json index.html detail.html`): errors and warnings per file and in total.
// Usage: node bench/scorer/html.mjs </o/vnu.json>   prints JSON (index.html as `index`, the rendered detail page as `detail`)
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { choose } from './mounts.mjs';

export function summarize(vnu) {
  if (vnu.missing) return { checker: null, errors: null, warnings: null, reason: vnu.missing };
  const out = { checker: vnu.version, index: { errors: 0, warnings: 0 }, detail: { errors: 0, warnings: 0 }, errors: 0, warnings: 0, rules: {} };
  for (const m of vnu.messages) {
    const file = /^detail\./.test(basename(m.url ?? '')) ? 'detail' : 'index';
    const kind = m.type === 'info' && m.subType === 'warning' ? 'warnings' : m.type === 'info' ? null : 'errors';
    if (!kind) continue;
    out[file][kind]++; out[kind]++;
    if (kind === 'errors') out.rules[m.message.slice(0, 80)] = (out.rules[m.message.slice(0, 80)] || 0) + 1;
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(summarize(JSON.parse(readFileSync(choose(process.argv[2], ['/o/vnu.json']), 'utf8')))));
