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
  const r = await fetch(path, body === undefined ? { headers, signal } : { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  const data = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw Object.assign(new Error(data.error ?? `HTTP ${r.status}`), { status: r.status });
  return data;
}
