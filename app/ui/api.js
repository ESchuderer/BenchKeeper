// Every change is a POST with the custom header the server requires.
export async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', 'x-benchkeeper': '1' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
  return data;
}
