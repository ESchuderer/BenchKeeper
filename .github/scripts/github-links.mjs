// Checks github.com links through the GitHub API, which lychee hits as HTML pages and GitHub rate-limits.
// Links to this repository's main branch are checked against the checkout, so files added in a pull request pass.
// Usage: GITHUB_TOKEN=... node .github/scripts/github-links.mjs <files...> (without a token, discussion links fail and the API allows 60 requests per hour)
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const byCode = (a, b) => Number(a > b) - Number(a < b);
const trimTrailing = (s) => { let end = s.length; while (end > 0 && '.,;:_'.includes(s[end - 1])) end--; return s.slice(0, end); };
const SELF = (process.env.GITHUB_REPOSITORY || 'ESchuderer/BenchKeeper').toLowerCase();
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
// First path segments that are GitHub pages, not owners.
const RESERVED = new Set(['orgs', 'marketplace', 'sponsors', 'topics', 'features', 'apps', 'settings', 'enterprise', 'collections', 'login']);

// The tags the merge of the release pull request creates: app-v<x.y.z> and setup-v<x.y.z> (release-please's form of the content tag).
const releaseTags = () => {
  const m = JSON.parse(readFileSync(`${ROOT}.release-please-manifest.json`, 'utf8'));
  return [`app-v${m.app}`, `setup-v${m['plugins/benchkeeper']}`];
};

// Returns { local: path } for this repository's main branch, { api: path } or { graphql: {...} } otherwise, { unsupported: true } for link kinds without a mapping.
export function target(url) {
  const u = new URL(url);
  let parts;
  try {
    parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return { unsupported: true };
  }
  const [owner, rawRepo, kind, ...rest] = parts;
  if (RESERVED.has(owner)) return { unsupported: true };
  const repo = rawRepo?.replace(/\.git$/, '');
  if (!repo) return { api: `/users/${owner}` };
  const base = `/repos/${owner}/${repo}`;
  if (kind === 'blob' || kind === 'tree') {
    // shortcut: refs containing "/" are split at the first segment; resolve them through the refs API when such a link appears.
    const [ref, ...path] = rest;
    if (`${owner}/${repo}`.toLowerCase() === SELF && ref === 'main') return { local: path.join('/') || '.' };
    return { api: `${base}/contents/${path.map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}` };
  }
  if ((kind === 'issues' || kind === 'pull') && rest[0]) return { api: `${base}/issues/${rest[0]}` };
  // The issue list: the API answers 410 when a repository has issues turned off.
  if (kind === 'issues') return { api: `${base}/issues?per_page=1` };
  if (kind === 'discussions' && rest[0]) {
    return { graphql: { query: 'query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){discussion(number:$n){id}}}', variables: { o: owner, r: repo, n: Number(rest[0]) } } };
  }
  if (kind === 'releases' && rest[0] === 'tag') return { api: `${base}/releases/tags/${encodeURIComponent(rest.slice(1).join('/'))}` };
  if (kind === 'commit') return { api: `${base}/commits/${rest[0]}` };
  if (kind === 'compare' && rest.join('/').includes('...')) {
    const [from, head] = rest.join('/').split('...');
    // The changelogs of a release pull request link to the tags that the merge creates: only those tags of this repository are skipped, their base is still checked.
    if (`${owner}/${repo}`.toLowerCase() === SELF && releaseTags().includes(head)) return { api: `${base}/commits/${encodeURIComponent(from)}` };
    return { api: `${base}/compare/${encodeURIComponent(from)}...${encodeURIComponent(head)}` };
  }
  // Unmapped kinds (wiki, actions, release assets) fail loudly instead of passing on the repository alone.
  return kind ? { unsupported: true } : { api: base };
}

// Markdown emphasis or table pipes next to a URL are not part of it.
export const extract = (text) => [...text.matchAll(/https:\/\/github\.com\/[^\s)"'<>`\]|*]+/g)].map((m) => trimTrailing(m[0]).split('#')[0]);

function request(t, token) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'benchkeeper-links', ...(token && { Authorization: `Bearer ${token}` }) };
  return t.graphql
    ? fetch('https://api.github.com/graphql', { method: 'POST', headers, body: JSON.stringify(t.graphql) })
    : fetch(`https://api.github.com${t.api}`, { headers });
}

async function check(t, token) {
  if (t.unsupported) return 'unsupported GitHub page, add a mapping in github-links.mjs';
  if (t.local) return existsSync(ROOT + t.local) ? null : 'missing in checkout';
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    try {
      const res = await request(t, token);
      if (res.ok) {
        if (!t.graphql) {
          await res.body?.cancel();
          return null;
        }
        const body = await res.json();
        if (body.data?.repository?.discussion) return null;
        // GraphQL reports rate limits as HTTP 200 with an errors array.
        if (body.errors?.some((e) => e.type === 'RATE_LIMITED')) { last = 'GraphQL rate limited'; continue; }
        return 'discussion not found';
      }
      last = `HTTP ${res.status}`;
      if (![403, 429].includes(res.status) && res.status < 500) return last;
      const wait = Number(res.headers.get('retry-after'));
      if (wait > 0 && wait <= 120) await new Promise((r) => setTimeout(r, wait * 1000));
    } catch (e) {
      last = e.message;
    }
  }
  return last;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.GITHUB_TOKEN;
  const urls = [...new Set(process.argv.slice(2).flatMap((f) => extract(readFileSync(f, 'utf8'))))].sort(byCode);
  const errors = [];
  for (let i = 0; i < urls.length; i += 4) {
    const batch = urls.slice(i, i + 4);
    const results = await Promise.all(batch.map((u) => check(target(u), token)));
    results.forEach((err, j) => err && errors.push(`FAIL ${batch[j]}: ${err}`));
  }
  errors.forEach((e) => console.log(e));
  console.log(`${urls.length} GitHub links, ${errors.length} failed`);
  process.exit(errors.length ? 1 : 0);
}
