// BenchKeeper's rules, skills and library: packed into content/ for npm, read from the repository in a clone.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const packed = fileURLToPath(new URL('../content/', import.meta.url));
export const contentDir = existsSync(packed) ? packed : fileURLToPath(new URL('../../plugins/benchkeeper/', import.meta.url));
export const appVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
export const library = () => JSON.parse(readFileSync(`${contentDir}library/library.json`, 'utf8'));

// content.json: { schemaVersion, contentVersion, minApp }. Content without the file (an older plugin) has no requirement.
export const content = () => { try { return JSON.parse(readFileSync(`${contentDir}content.json`, 'utf8')); } catch { return {}; } };
export const contentVersion = content().contentVersion ?? appVersion;
const older = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i]; return false; };
// The message when the content in dir needs a newer app than version, else null. An unreadable file or a version that is not x.y.z needs nothing.
export function contentRefusal(dir, version = appVersion) {
  let minApp;
  try { minApp = JSON.parse(readFileSync(`${dir}/content.json`, 'utf8')).minApp; } catch { return null; }
  if (typeof minApp !== 'string' || !/^\d+\.\d+\.\d+$/.test(minApp) || !/^\d+\.\d+\.\d+$/.test(version) || !older(version, minApp)) return null;
  return `the content in ${dir} needs benchkeeper ${minApp} or newer, this is ${version}: run npx benchkeeper@${minApp.split('.')[0]}`;
}
