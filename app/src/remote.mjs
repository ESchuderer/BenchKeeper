// What a skill source's default branch points to now: the one network question the app asks about skills, on demand.
import { childEnv } from './childenv.mjs';

// The commit of the default branch of a GitHub repository; null when it cannot be read (offline, private, gone).
export function headCommit(ctx, source) {
  const r = ctx.run(['git', 'ls-remote', `https://github.com/${source}`, 'HEAD'], { cwd: ctx.home, env: childEnv({ GIT_TERMINAL_PROMPT: '0' }), timeout: 30e3 });
  const sha = r.code === 0 ? r.stdout.split(/\s/)[0] : '';
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

// { source: commit | null } for each distinct source.
export const latestCommits = (ctx, sources) => Object.fromEntries([...new Set(sources)].map((s) => [s, headCommit(ctx, s)]));
