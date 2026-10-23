// The API key from the token exchange; this origin's storage keeps it for reloads and new tabs.
const KEY = 'benchkeeper-key';
let key = null;
export function setKey(k) {
  key = k;
  try { localStorage.setItem(KEY, k); } catch { /* the key stays for this page only */ }
}
const current = () => { if (key) return key; try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; } };

// Every request carries the key; every change is a POST.
export async function api(path, body, { signal } = {}) {
  const headers = { 'x-benchkeeper': current() };
  let r;
  try {
    r = await fetch(path, body === undefined ? { headers, signal } : { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  } catch (e) {
    // No answer at all: the server stopped (Ctrl+C, Stop, a closed terminal), not a request it refused.
    if (e.name === 'AbortError') throw e;
    throw new Error('BenchKeeper does not answer: its server has stopped. Start it again with npx benchkeeper, then reload.');
  }
  const data = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw Object.assign(new Error(data.error ?? `HTTP ${r.status}`), { status: r.status });
  return data;
}
