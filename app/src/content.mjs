// BenchKeeper's rules, skills and library: packed into content/ for npm, read from the repository in a clone.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const packed = fileURLToPath(new URL('../content/', import.meta.url));
export const contentDir = existsSync(packed) ? packed : fileURLToPath(new URL('../../plugins/benchkeeper/', import.meta.url));
export const appVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
export const library = () => JSON.parse(readFileSync(`${contentDir}library/library.json`, 'utf8'));
