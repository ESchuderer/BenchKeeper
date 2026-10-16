// Reads a job file (JSON): { "jobs": [{ "name", "command", "timeout"?, "retryDelay"? }] }, durations in ms.
import { parseDuration } from './duration.js';

const DURATION = /^\d+(ms|s|m|h)$/;
const DEFAULTS = { timeout: '30s', retryDelay: '1s' };

export function loadConfig(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data.jobs)) throw new Error('config: jobs must be a list');
  return data.jobs.map((job, i) => {
    if (typeof job.name !== 'string' || typeof job.command !== 'string') throw new Error(`config: jobs[${i}] needs a name and a command`);
    const out = { name: job.name, command: job.command };
    for (const key of ['timeout', 'retryDelay']) {
      const value = job[key] ?? DEFAULTS[key];
      if (!DURATION.test(value)) throw new Error(`config: jobs[${i}].${key}: invalid duration ${value}`);
      out[key] = parseDuration(value);
    }
    return out;
  });
}
