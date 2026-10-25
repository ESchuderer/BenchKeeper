import { cooled } from './cooldown.mjs';

// One registry request for a newer app version; it is shown, never installed, and only a release at least 7 days old, as for host tools. Off with BENCHKEEPER_NO_UPDATE_CHECK=1.
export const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

export async function updateNotice(current, env = process.env, get = fetch) {
  if (env.BENCHKEEPER_NO_UPDATE_CHECK === '1' || env.CI) return null;
  try {
    const r = await get('https://registry.npmjs.org/benchkeeper', { signal: AbortSignal.timeout(3000) });
    const { time, versions } = r.ok ? await r.json() : {};
    const version = cooled(time, Object.keys(versions ?? {})).sort((a, b) => (newer(a, b) ? 1 : -1)).at(-1);
    return version && newer(version, current) ? `benchkeeper ${version} is available (this is ${current}): npx benchkeeper@${version}` : null;
  } catch { return null; }
}
