// Checks github.com and gist.github.com links through the GitHub API, which lychee hits as HTML pages and GitHub rate-limits.
// Links to this repository's own files are checked against the checkout, so files added in a pull request pass.
// Usage: GITHUB_TOKEN=... node .github/scripts/github-links.mjs <files...>
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SELF = (process.env.GITHUB_REPOSITORY || 'ESchuderer/BenchKeeper').toLowerCase();

// Returns { local: path } for this repository's files, { api: path } or { graphql: {...} } otherwise.
export function target(url) {
  const u = new URL(url);
  const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (u.hostname === 'gist.github.com') return { api: `/gists/${parts.at(-1)}` };
  const [owner, rawRepo, kind, ...rest] = parts;
  const repo = rawRepo?.replace(/\.git$/, '');
  if (!repo) return { api: `/users/${owner}` };
  const base = `/repos/${owner}/${repo}`;
  if (kind === 'blob' || kind === 'tree') {
    const [ref, ...path] = rest;
    if (`${owner}/${repo}`.toLowerCase() === SELF) return { local: path.join('/') || '.' };
    return { api: `${base}/contents/${path.map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}` };
  }
  if ((kind === 'issues' || kind === 'pull') && rest[0]) return { api: `${base}/issues/${rest[0]}` };
  if (kind === 'discussions' && rest[0]) {
    return { graphql: { query: 'query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){discussion(number:$n){id}}}', variables: { o: owner, r: repo, n: Number(rest[0]) } } };
  }
  if (kind === 'releases' && rest[0] === 'tag') return { api: `${base}/releases/tags/${encodeURIComponent(rest.slice(1).join('/'))}` };
  if (kind === 'commit') return { api: `${base}/commits/${rest[0]}` };
  return { api: base };
}

const URL_RE = /https:\/\/(?:gist\.)?github\.com\/[^\s)"'<>`\]]+/g;

async function check(t, token) {
  if (t.local) return existsSync(t.local) ? null : 'missing in checkout';
  // The Actions token gets 403 on the gists API; gists are checked unauthenticated.
  const auth = token && !t.api?.startsWith('/gists/');
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'benchkeeper-links', ...(auth && { Authorization: `Bearer ${token}` }) };
  const res = t.graphql
    ? await fetch('https://api.github.com/graphql', { method: 'POST', headers, body: JSON.stringify(t.graphql) })
    : await fetch(`https://api.github.com${t.api}`, { headers });
  if (!res.ok) return `HTTP ${res.status}`;
  if (t.graphql) {
    const body = await res.json();
    return body.data?.repository?.discussion ? null : 'discussion not found';
  }
  return null;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.GITHUB_TOKEN;
  const urls = new Set();
  for (const file of process.argv.slice(2)) {
    for (const m of readFileSync(file, 'utf8').matchAll(URL_RE)) urls.add(m[0].replace(/[.,;:]+$/, '').split('#')[0]);
  }
  let failed = 0;
  for (const url of [...urls].sort()) {
    const err = await check(target(url), token);
    if (err) { failed++; console.log(`FAIL ${url}: ${err}`); }
  }
  console.log(`${urls.size} GitHub links, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
