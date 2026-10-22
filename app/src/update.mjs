// One registry request for a newer app version; it is shown, never installed. Off with BENCHKEEPER_NO_UPDATE_CHECK=1.
export const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

export async function updateNotice(current, env = process.env, get = fetch) {
  if (env.BENCHKEEPER_NO_UPDATE_CHECK === '1' || env.CI) return null;
  try {
    const r = await get('https://registry.npmjs.org/benchkeeper/latest', { signal: AbortSignal.timeout(2000) });
    const { version } = r.ok ? await r.json() : {};
    return /^\d+\.\d+\.\d+$/.test(version ?? '') && newer(version, current) ? `benchkeeper ${version} is available (this is ${current}): npx benchkeeper@${version}` : null;
  } catch { return null; }
}
