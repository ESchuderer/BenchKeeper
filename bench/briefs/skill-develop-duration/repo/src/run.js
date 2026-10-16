// Runs jobs one after the other: each command in a shell, stopped at its timeout, retried once after retryDelay.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const once = (job) => new Promise((resolve) => {
  const p = spawn('sh', ['-c', job.command], { stdio: 'inherit' });
  const timer = setTimeout(() => p.kill('SIGTERM'), job.timeout);
  p.on('exit', (code) => { clearTimeout(timer); resolve(code === 0); });
});

export async function runJobs(jobs) {
  let ok = true;
  for (const job of jobs) {
    let done = await once(job);
    if (!done) { await sleep(job.retryDelay); done = await once(job); }
    console.log(`${job.name}: ${done ? 'ok' : 'failed'}`);
    ok &&= done;
  }
  return ok;
}
