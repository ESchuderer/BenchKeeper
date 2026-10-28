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

// Any case of the name in a word or in a quoted string; a lowercase identifier (a variable, an import path) is not one.
const NAME = /Orca|ORCA|['"`]orca/;
const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (join(dir, e.name) === join(root, 'src', 'orca') ? [] : files(join(dir, e.name))) : /\.(mjs|js|jsx)$/.test(e.name) ? [join(dir, e.name)] : []);
const strings = ['src', 'ui'].filter((d) => existsSync(join(root, d))).flatMap((d) => files(join(root, d)))
  .flatMap((f) => readFileSync(f, 'utf8').split('\n').flatMap((line, i) => NAME.test(line) ? [`${relative(root, f)}:${i + 1}`] : []));
for (const at of strings) console.error(`error orca-name-outside-module: ${at}`);

process.exit(cruise.status || strings.length ? 1 : 0);
