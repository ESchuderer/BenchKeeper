// Checks the registry signatures and provenance attestations of an npm package and its dependencies before a command
// installs or runs it. `npm audit signatures` reads an installed tree, so the package goes into a throwaway project
// first, with lifecycle scripts off. Run as a script: node verify.mjs <name@version>; the exit code is npm's.
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './childenv.mjs';
import { runCommand } from './runner.mjs';

// The command that checks spec: a change's `verify` runs it first, and a failure stops the change.
export const verifyArgv = (spec) => [process.execPath, fileURLToPath(import.meta.url), spec];

// An exact name@version, so the check and the install that follows name the same release.
const EXACT = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*@\d+\.\d+\.\d+(-[\w.]+)?$/;

export function verifyPackage(spec, env = childEnv({})) {
  if (!EXACT.test(spec)) return { code: 2, stderr: `${spec} is not an exact name@version\n` };
  const dir = mkdtempSync(join(tmpdir(), 'bk-verify-'));
  try {
    writeFileSync(join(dir, 'package.json'), '{"private":true}');
    const npm = (...args) => runCommand(['npm', ...args, '--no-fund', '--no-update-notifier'], { cwd: dir, env, timeout: 120e3 });
    const installed = npm('install', '--ignore-scripts', '--no-audit', spec);
    if (installed.code !== 0) return { code: installed.code, stderr: `${installed.stderr}\ncould not fetch ${spec} to verify it\n` };
    const r = npm('audit', 'signatures');
    return { code: r.code, stdout: r.stdout, stderr: r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// import.meta.main (Node 22.18 and later) is true for the entry module, also through a symlink, but false while a
// preload (--import) imports it first. So also compare real paths, as Node keeps process.argv[1] as given (macOS /var is
// /private/var), except under -e or -p, where process.argv[1] is an argument and not the entry module.
const evalOrPrint = process.execArgv.some((a) => ['-e', '--eval', '-p', '--print'].includes(a) || a.startsWith('--eval=') || a.startsWith('--print='));
if (import.meta.main || (!evalOrPrint && process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)))) {
  const r = verifyPackage(process.argv[2] ?? '');
  process.stdout.write(r.stdout ?? '');
  process.stderr.write(r.stderr ?? '');
  process.exit(r.code);
}
