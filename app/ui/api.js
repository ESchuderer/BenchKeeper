// The API key from the token exchange; this origin's storage keeps it for reloads and new tabs.
const KEY = 'benchkeeper-key';
let key = null;
export function setKey(k) {
  key = k;
  try { localStorage.setItem(KEY, k); } catch { /* the key stays for this page only */ }
}
const current = () => { if (key) return key; try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; } };

export const NO_SESSION = 'This tab has no session with the running BenchKeeper server: it was started again, or the link was opened in another browser. Run npx benchkeeper again and open the link it prints (it works once and for 10 minutes).';

// Every request carries the key; every change is a POST.
export async function api(path, body, { signal } = {}) {
  const headers = { 'x-benchkeeper': current() };
  const send = () => fetch(path, body === undefined ? { headers, signal } : { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  let r;
  try {
    r = await send();
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    // A read that lost its connection (a reload, a connection the server just closed) is asked once more; a change is
    // not sent twice.
    if (body === undefined) r = await new Promise((ok) => setTimeout(ok, 300)).then(send).catch((x) => (x.name === 'AbortError' ? Promise.reject(x) : null));
    // Still no answer: the server stopped (Ctrl+C, Stop, a closed terminal), not a request it refused.
    if (!r) throw new Error('BenchKeeper does not answer: its server has stopped. Start it again with npx benchkeeper, then reload.');
  }
  // 401: a retry cannot help.
  if (r.status === 401) throw Object.assign(new Error(NO_SESSION), { status: 401 });
  const data = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw Object.assign(new Error(data.error ?? `HTTP ${r.status}`), { status: r.status });
  return data;
}
