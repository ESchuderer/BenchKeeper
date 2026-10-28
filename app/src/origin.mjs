// The origin URL of a project in a profile file, and the one command that clones it. A profile is a file from another
// machine or person: its URL is untrusted input, so only https and ssh addresses of a named host pass, nothing runs from
// the clone (no hooks, no submodules, no template), and nothing is cloned without a question per project.
import { devNull } from 'node:os';
import { basename } from 'node:path';
import { git } from './git.mjs';

const MAX = 2048;
const BAD_CHARS = /[\s\u0000-\u001f\u007f-\u009f]/u;
// An ssh user name and a host label, as a command line would not take them for an option or a shell word.
const USER = /^[A-Za-z0-9_][\w.-]*$/;
const HOST = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
// An address like 127.0.0.1 or 0x7f.1 ends in a number: a host name ends in a letter label.
const NAMED = /\.[A-Za-z][A-Za-z0-9-]*$/;
const SCP = /^([^@/:]+)@([^@/:]+):(?!\/\/)([^\s]+)$/;

// { url, host, scheme } of an address a clone may use, else an Error that says why. Local paths, file:, git:, http:, ext::
// and the like, an address with a password or token, and a host that is an IP address or has no domain are refused.
export function checkOrigin(url) {
  if (typeof url !== 'string' || !url) throw new Error('the address is empty');
  if (url.length > MAX) throw new Error(`the address is longer than ${MAX} characters`);
  if (BAD_CHARS.test(url)) throw new Error('the address has spaces or control characters');
  if (url.startsWith('-')) throw new Error('the address starts with a dash');
  let scheme, host, user = '', path;
  const m = url.match(SCP);
  if (m) [, user, host, path] = m, scheme = 'ssh';
  else {
    let u;
    try { u = new URL(url); } catch { throw new Error('only https://, ssh:// and user@host:path addresses are cloned'); }
    scheme = u.protocol.slice(0, -1);
    if (scheme !== 'https' && scheme !== 'ssh') throw new Error(`${scheme}: addresses are not cloned, only https and ssh`);
    if (u.password || (scheme === 'https' && u.username)) throw new Error('the address carries a user name or password');
    if (u.search || u.hash) throw new Error('the address has a query or fragment');
    ({ hostname: host, username: user, pathname: path } = u);
    // The URL parser percent-encodes and normalizes: the text must be what a git command would read.
    if (/%|\\/.test(url.slice(url.indexOf('//') + 2))) throw new Error('the address has escapes');
  }
  if (!HOST.test(host) || !NAMED.test(host)) throw new Error(`the host ${JSON.stringify(host)} is not a named internet host`);
  if (user && !USER.test(user)) throw new Error('the ssh user name has unusual characters');
  if (!path || path === '/' || path.startsWith('-') || /\/\.\.?(\/|$)/.test(url)) throw new Error('the address names no repository path');
  return { url, host, scheme };
}

// The same address without the user name and password of an https address and the password of an ssh one: a profile
// never carries a login. An address that does not parse stays as it is, checkOrigin refuses it.
export function stripLogin(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') { u.username = ''; u.password = ''; } else if (u.protocol === 'ssh:') u.password = '';
    else return url;
    return u.href;
  } catch { return url; }
}

// Each project's origin for a profile: the address that passes checkOrigin once its login is stripped, or why not.
// `git remote get-url` reads config only, so a repository's own settings run nothing.
export function projectOrigins(ctx, paths) {
  return paths.map((path) => {
    const r = git(ctx, path, ['remote', 'get-url', 'origin']);
    if (r.code !== 0) return { path, reason: 'no origin' };
    const url = stripLogin(r.stdout.trim());
    try { return { path, ...checkOrigin(url) }; } catch (e) { return { path, reason: e.message }; }
  });
}

// The folder name a project gets under the folder the user picks: the profile's name for it, else the repository's.
// Both come from the file, so a name that could leave the folder or hide as a dot file is not used.
export function cloneName(path, url) {
  return [basename(path), basename(url.replace(/[/:]+$/, '')).replace(/\.git$/, '')].find((n) => /^[A-Za-z0-9_][\w.-]*$/.test(n)) ?? null;
}

// The runner change for one clone, run in `folder` (a plain git clone of the default branch):
// - no hooks (an empty template and a hooks folder that is none), no submodules, no fsmonitor;
// - only https and ssh, whatever the address redirects to (GIT_ALLOW_PROTOCOL and protocol.allow);
// - no prompts for a password or key phrase, and a stalled transfer ends.
export function cloneChange({ url, dest, folder }) {
  const { host, scheme } = checkOrigin(url);
  return {
    id: `clone-${basename(dest)}`, step: `clone:${basename(dest)}`, title: `clone ${url} into ${dest}`, kind: 'clone', url, host, scheme, path: dest, cwd: folder,
    argv: ['git', '-c', `core.hooksPath=${devNull}`, '-c', 'core.fsmonitor=false', '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'protocol.ssh.allow=always',
      '-c', 'transfer.fsckObjects=true', '-c', 'http.lowSpeedLimit=1000', '-c', 'http.lowSpeedTime=60',
      'clone', '--no-recurse-submodules', '--template=', '--', url, dest],
    env: { GIT_ALLOW_PROTOCOL: 'https:ssh', GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=30',
      ...(process.env.SSH_AUTH_SOCK ? { SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK } : {}) },
  };
}
