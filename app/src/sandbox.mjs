// The OS sandbox around the skill install preview (and nothing else): which one runs on this machine, the command line
// that starts a command inside it, and the check that it starts at all.
// srt (sandbox-runtime) confines writes to the scratch folder, hides credential folders and limits the network to a host
// allow list. Where it cannot run, bubblewrap (Linux, WSL2) or sandbox-exec (macOS) confines writes only and the network stays
// open. Where none runs there is no preview unless the user asks for one without a sandbox.
import { accessSync, constants, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { exists } from './fsx.mjs';
import { lastLines } from './redact.mjs';
import { verifyArgv } from './verify.mjs';

// Exact, and at least 7 days old when it was chosen (PIN_DATES in steps/global.mjs holds its publish date).
export const SRT_VERSION = '0.0.81';
// As an npm alias, like the skills CLI: a package of that name in a cloned repository never runs in its place.
const SRT_SPEC = `@anthropic-ai/sandbox-runtime@npm:@anthropic-ai/sandbox-runtime@${SRT_VERSION}`;
// Run before srt is fetched: npm's registry signatures of srt and its dependencies.
export const srtVerify = () => verifyArgv(`@anthropic-ai/sandbox-runtime@${SRT_VERSION}`);

const isFile = (p) => { try { accessSync(p, constants.X_OK); return true; } catch { return false; } };
export const onPath = (bin) => (process.env.PATH ?? '').split(delimiter).filter(Boolean).some((d) => isFile(join(d, bin)));
// srt needs Node 22.12 (its engines field).
const nodeOk = (v) => { const [a, b] = v.split('.').map(Number); return a > 22 || (a === 22 && b >= 12); };

const INSTALL = {
  linux: 'install bubblewrap, socat and ripgrep (Debian, Ubuntu, WSL2: apt install bubblewrap socat ripgrep; Fedora: dnf install bubblewrap socat ripgrep)',
  darwin: 'sandbox-exec ships with macOS, so this macOS has none',
};

// Which sandbox this machine can start, by its programs: { tool: 'srt' | 'bwrap' | 'sandbox-exec' } or { tool: null, why }.
// `note` says what the tool does not confine. `facts` is injectable for tests: platform, has(bin) and node.
export function pick({ platform = process.platform, has = onPath, node = process.versions.node } = {}) {
  if (platform === 'win32') return { tool: null, why: 'Windows has no sandbox the app can use (unsupported)' };
  const base = { linux: 'bwrap', darwin: 'sandbox-exec' }[platform];
  if (!base) return { tool: null, why: `${platform} has no sandbox the app can use (unsupported)` };
  if (!has(base)) return { tool: null, why: `${base} is missing: ${INSTALL[platform]}` };
  const missing = ['socat', 'rg'].filter((b) => (platform === 'linux' || b === 'rg') && !has(b));
  if (!missing.length && nodeOk(node)) return { tool: 'srt' };
  const fix = missing.length ? (platform === 'linux' ? INSTALL.linux : 'install ripgrep') : 'use Node 22.12 or newer';
  return { tool: base, fix, note: `${missing.length ? `${missing.join(' and ')} missing` : `Node ${node} is older than 22.12`}, so the network is not limited (${fix})` };
}

// Credential folders and files below the home that the command cannot read (srt only; the fallbacks confine writes).
const SECRET_PATHS = ['.ssh', '.aws', '.gnupg', '.azure', '.kube', '.docker', '.config/gh', '.config/gcloud', '.netrc', '.git-credentials', '.npmrc', '.claude.json', '.claude/.credentials.json', '.codex/auth.json'];

// Registry hosts of an npm settings text and of the registry variable: the hosts srt lets the command reach besides the defaults.
const hostOf = (u) => { try { return new URL(u.trim()).hostname; } catch { return null; } };
export const registryHosts = (npmrc, env) => [...new Set([
  ...(npmrc ?? '').split('\n').map((l) => l.match(/^\s*(@[^:\s]+:)?registry\s*=\s*(\S+)/)?.[2]).filter(Boolean).map(hostOf),
  ...Object.entries(env).filter(([k, v]) => /^npm_config_registry$/i.test(k) && v).map(([, v]) => hostOf(v)),
].filter(Boolean))];

// The command line that runs argv inside the sandbox in the scratch folder t. argv itself is passed on as it is.
export function wrap(tool, { argv, t, home, hosts = [], env = {} }) {
  if (tool === 'srt') {
    const settings = join(t, 'srt.json');
    writeFileSync(settings, JSON.stringify({
      network: { allowedDomains: ['registry.npmjs.org', 'github.com', ...hosts], deniedDomains: [] },
      filesystem: { denyRead: SECRET_PATHS.map((p) => join(home, p)).filter(exists), allowRead: [], allowWrite: [t], denyWrite: [] },
    }), { mode: 0o600 });
    // srt keeps its temporary files in $CLAUDE_CODE_TMPDIR (else /tmp/claude, shared and expected to exist), and covers a
    // missing .claude with an empty read-only folder (it always denies writes to .claude/commands and .claude/agents): the
    // skills CLI could not create .claude/skills.
    mkdirSync(join(t, 'tmp'), { recursive: true });
    for (const d of ['h', 'p']) mkdirSync(join(t, d, '.claude', 'skills'), { recursive: true });
    return { argv: ['npx', '-y', `--package=${SRT_SPEC}`, 'srt', '--settings', settings, '--', ...argv], env: { ...env, CLAUDE_CODE_TMPDIR: join(t, 'tmp') } };
  }
  mkdirSync(join(t, 'tmp'), { recursive: true });
  const scratch = realpathSync(t);
  const env2 = { ...env, TMPDIR: join(scratch, 'tmp') };
  if (tool === 'bwrap') return { argv: ['bwrap', '--ro-bind', '/', '/', '--bind', scratch, scratch, '--dev', '/dev', '--proc', '/proc', '--unshare-pid', '--die-with-parent', '--', ...argv], env: env2 };
  // Writes only below the scratch folder (a real path: /var is a link to /private/var), plus the terminal and null devices.
  const profile = `(version 1)(allow default)(deny file-write*)(allow file-write* (subpath ${JSON.stringify(scratch)}) (literal "/dev/null") (literal "/dev/dtracehelper") (regex #"^/dev/tty"))`;
  return { argv: ['sandbox-exec', '-p', profile, ...argv], env: env2 };
}

// A sandbox that starts is checked once per process (a failure for a minute, so installing a program needs no restart): a
// blocked user namespace or a container without an unmasked /proc shows only when it runs. A command that then fails is a
// failed preview, never a reason to run it again without the sandbox.
const probed = new Map();
export async function starts(tool, run, { t, home, hosts, env, signal }) {
  const key = `${tool}\0${home}`, hit = probed.get(key);
  if (hit && hit.until > Date.now()) return hit.error;
  const w = wrap(tool, { argv: ['true'], t, home, hosts, env });
  const r = await run(w.argv, { cwd: t, env: w.env, signal, timeout: 60e3 });
  const tail = lastLines(r.stderr || r.stdout || '');
  const error = r.code === 0 ? null : `the sandbox (${tool}) did not start: ${tail || `exit ${r.code}`}${/mount proc/i.test(tail) ? ' (in a container, start it with --security-opt unmask=/proc/*)' : ''}`;
  // A stop or a timeout says nothing about the sandbox: it is checked again next time.
  if (!signal?.aborted && r.code !== 124) probed.set(key, { error, until: Date.now() + (error ? 60e3 : 10 * 60e3) });
  return error;
}
