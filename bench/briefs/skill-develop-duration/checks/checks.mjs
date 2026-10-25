// Step 1 checks of skill-develop-duration, run by skill-common/run.mjs. The change must reach every place that accepts a
// duration: the parser (src/duration.js) and the two places that validate a duration before parsing it (src/config.js,
// src/cli.js). The job file and the command line are checked against the workspace's own parseDuration, so a wrong
// parser fails only S1-parse.
import assert from 'node:assert/strict';

const job = (fields) => JSON.stringify({ jobs: [{ name: 'a', command: 'true', ...fields }] });

export default {
  'S1-parse': async (t) => {
    const { parseDuration } = await t.load('src/duration.js');
    assert.deepEqual(['1h30m', '2m30s', '1m500ms', '1h0m1s', '90s'].map((s) => parseDuration(s)), [5_400_000, 150_000, 60_500, 3_601_000, 90_000]);
    return true;
  },
  'S1-config': async (t) => {
    const { parseDuration } = await t.load('src/duration.js');
    const [j] = (await t.load('src/config.js')).loadConfig(job({ timeout: '1h30m', retryDelay: '2m30s' }));
    assert.deepEqual([j.timeout, j.retryDelay], [parseDuration('1h30m'), parseDuration('2m30s')]);
    return true;
  },
  'S1-cli': async (t) => {
    const { parseDuration } = await t.load('src/duration.js');
    assert.equal((await t.load('src/cli.js')).parseArgs(['jobs.json', '--timeout', '2m30s']).timeout, parseDuration('2m30s'));
    return true;
  },
  'S1-invalid': async (t) => {
    const { parseDuration } = await t.load('src/duration.js');
    for (const s of ['1h30', '1x', '', 'h', '1.5h', '-1s', '1h 30m']) assert.throws(() => parseDuration(s), RangeError, s);
    return true;
  },
};
