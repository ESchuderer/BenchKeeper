#!/usr/bin/env node
// jobrunner <job-file> [--timeout <duration>] [--only <name>]: --timeout overrides every job's timeout.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { DURATION, parseDuration } from './duration.js';
import { runJobs } from './run.js';

export function parseArgs(argv) {
  const opts = { file: null, timeout: null, only: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--timeout') {
      const v = argv[++i];
      if (!DURATION.test(v ?? '')) throw new Error(`--timeout: expected a duration such as 90s, got ${v}`);
      opts.timeout = parseDuration(v);
    } else if (a === '--only') opts.only = argv[++i];
    else if (!opts.file) opts.file = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  if (!opts.file) throw new Error('usage: jobrunner <job-file> [--timeout <duration>] [--only <name>]');
  return opts;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const opts = parseArgs(process.argv.slice(2));
  const jobs = loadConfig(readFileSync(opts.file, 'utf8'))
    .filter((j) => !opts.only || j.name === opts.only)
    .map((j) => (opts.timeout === null ? j : { ...j, timeout: opts.timeout }));
  process.exitCode = (await runJobs(jobs)) ? 0 : 1;
}
