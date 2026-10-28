import { readFileSync } from 'node:fs';

// A stand-in for the sandbox: the facts of a machine that has everything, and a runner that starts the wrapped command.
export const SANDBOX = { platform: 'linux', has: () => true, node: '22.22.0' };
const LAUNCH = /^--package=@anthropic-ai\/sandbox-runtime@npm:@anthropic-ai\/sandbox-runtime@\d+\.\d+\.\d+$/;
export const isLaunch = (argv) => argv[0] === 'npx' && LAUNCH.test(argv[2] ?? '');
// Wraps a fake runner: a launch of srt runs the command after its first `--` (a bare `true` is the start check) and is
// added to `seen` with the environment it got and the settings file it was given. The signature check of srt passes and is
// added to `checks`.
export function viaSrt(run, seen = [], checks = []) {
  return (argv, o) => {
    if (argv[1]?.endsWith('verify.mjs') && argv[2]?.startsWith('@anthropic-ai/sandbox-runtime@')) { checks.push(argv[2]); return { code: 0, stdout: '', stderr: '' }; }
    if (!isLaunch(argv)) return run(argv, o);
    seen.push({ argv, env: o.env, settings: JSON.parse(readFileSync(argv[argv.indexOf('--settings') + 1], 'utf8')) });
    const inner = argv.slice(argv.indexOf('--') + 1);
    return inner[0] === 'true' ? { code: 0, stdout: '', stderr: '' } : run(inner, o);
  };
}
