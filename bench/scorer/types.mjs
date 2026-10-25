// Type errors of an app's own source (same files as erosion.mjs): `tsc --allowJs --checkJs --noEmit` through the compiler API.
// Usage: node bench/scorer/types.mjs <app-dir: /app or a folder of the temp folder>   prints JSON; needs `typescript` and `@types/node` (bench/scorer/package.json)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { files } from './erosion.mjs';
import { appFolder } from './mounts.mjs';

export function typeErrors(dir) {
  const own = files(dir).filter((f) => /\.(js|jsx|mjs|cjs)$/.test(f)).map((f) => join(dir, f));
  const options = {
    allowJs: true, checkJs: true, noEmit: true, strict: false, // TS 6 defaults to strict, where untyped parameters dominate the count
    skipLibCheck: true, jsx: ts.JsxEmit.Preserve,
    target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2023.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], types: ['node'],
    typeRoots: [join(import.meta.dirname, 'node_modules/@types')],
  };
  const program = ts.createProgram(own, options);
  const set = new Set(own);
  const diags = ts.getPreEmitDiagnostics(program).filter((d) => d.file && set.has(d.file.fileName) && d.category === ts.DiagnosticCategory.Error);
  const codes = {};
  for (const d of diags) codes[`TS${d.code}`] = (codes[`TS${d.code}`] || 0) + 1;
  const lines = own.reduce((n, f) => n + readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).length, 0);
  return { files: own.length, source_lines: lines, errors: diags.length, per_1000_lines: lines ? Math.round((1e4 * diags.length) / lines) / 10 : 0, codes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(typeErrors(appFolder(process.argv[2]))));
