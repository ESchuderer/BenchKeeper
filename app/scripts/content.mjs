// prepack: copies the rules, own skills, library catalog and eval sets into content/, so the npm package plans and
// applies them offline. --clean (postpack) removes the copy, so a clone reads the repository again.
import { cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../content/', import.meta.url));
const src = fileURLToPath(new URL('../../plugins/benchkeeper/', import.meta.url));
export const PARTS = ['rules', 'skills', 'library', 'evals'];

rmSync(out, { recursive: true, force: true });
if (!process.argv.includes('--clean')) for (const p of PARTS) cpSync(`${src}${p}`, `${out}${p}`, { recursive: true });
