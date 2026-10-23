// Latest release (or newest tag), stars and forks of the repository, read from the GitHub API once per build.
// Any failure (offline, rate limit, timeout) leaves the fact out; the header then shows icon and name only.
export const SLUG = 'ESchuderer/BenchKeeper';
export type RepoFacts = { tag?: string; stars?: string; forks?: string };

const get = async (path: string) => {
  try {
    const token = process.env.GITHUB_TOKEN;
    const r = await fetch(`https://api.github.com/repos/${SLUG}${path}`, {
      headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(5000),
    });
    return r.ok ? await r.json() : null;
  } catch { return null; }
};
const short = (n?: number) => (typeof n !== 'number' ? undefined : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n));

const [repo, release] = await Promise.all([get(''), get('/releases/latest')]);
const tags = release?.tag_name ? null : await get('/tags');
export const facts: RepoFacts = { tag: release?.tag_name ?? tags?.[0]?.name, stars: short(repo?.stargazers_count), forks: short(repo?.forks_count) };
