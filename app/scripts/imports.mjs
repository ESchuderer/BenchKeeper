// Import rules of src/ and ui/ (.dependency-cruiser.cjs) and the rule that the name of the multi-agent IDE appears only in src/orca/.
// Usage: node scripts/imports.mjs. Exit 1 on a violation. The tests check another app folder through APP_ROOT.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('..', import.meta.url));
const root = resolve(process.env.APP_ROOT ?? here);
const bin = join(here, 'node_modules/dependency-cruiser/bin/dependency-cruiser.mjs');

const cruise = spawnSync(process.execPath, [bin, '--config', join(here, '.dependency-cruiser.cjs'), ...['src', 'ui'].filter((d) => existsSync(join(root, d)))], { cwd: root, stdio: 'inherit' });

// The name in a word in any case, or inside a string literal; a lowercase identifier, an import or require path and a `${}` expression are not one.
// Scans the whole file, so a template literal over several lines is one literal. Shortcut: a backtick inside a `${}` and a regex literal after something other than an operator or bracket end the scan of that literal early; upgrade to a parser if the check misfires on real code.
const TOKEN = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|(?<=[(,=:[!&|?{};]|\breturn)\s*\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[a-z]*|(['"])(?:\\[\s\S]|(?!\1)[^\\\n])*\1|`(?:\\[\s\S]|[^`\\])*`/g;
// `from 'x'` and `import 'x'` take the path bare, `import('x')` and `require('x')` in parentheses; a call `from('x')` is none.
const SPECIFIER = /(?<![.$\w])(?:(?:from|import)|(?:import|require)\s*\()\s*$/;
const nameAt = (text) => {
  const at = [];
  const bare = text.replace(TOKEN, (s) => /^\/[/*]/.test(s) ? s.replace(/[^\n]/g, ' ') : s); // comments are whitespace between keyword and path
  const code = text.replace(TOKEN, (s, _quote, i) => {
    if (!/^['"`]/.test(s)) return s;
    if (!SPECIFIER.test(bare.slice(Math.max(0, i - 40), i)) && /orca/i.test(s.replace(/\$\{[^}]*\}/g, ''))) at.push(i);
    return s.replace(/[^\n]/g, ' ');
  });
  for (const m of code.matchAll(/Orca|ORCA/g)) at.push(m.index);
  return [...new Set(at.map((i) => text.slice(0, i).split('\n').length))].sort((x, y) => x - y);
};
const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (join(dir, e.name) === join(root, 'src', 'orca') ? [] : files(join(dir, e.name))) : /\.(mjs|cjs|js|jsx)$/.test(e.name) ? [join(dir, e.name)] : []);
const strings = ['src', 'ui'].filter((d) => existsSync(join(root, d))).flatMap((d) => files(join(root, d)))
  .flatMap((f) => nameAt(readFileSync(f, 'utf8')).map((line) => `${relative(root, f)}:${line}`));
for (const at of strings) console.error(`error orca-name-outside-module: ${at}`);

if (cruise.error) console.error(cruise.error);
process.exit(cruise.error || cruise.status !== 0 || strings.length ? 1 : 0);
