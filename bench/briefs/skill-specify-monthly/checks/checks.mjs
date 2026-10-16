// Step 1 checks of skill-specify-monthly, run by skill-common/run.mjs. Cases that a written specification of monthly()
// should list: year end, 30-day months, no drift after a clamped month, leap years (2028, 2000, not 2100), the time
// zone, invalid input (README.md). The cases are chosen so that each mutant in validate.sh fails exactly one check.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const monthly = async (t) => (await t.load('src/schedule.js')).monthly;

export default {
  'S1-basic': async (t) => {
    const f = await monthly(t);
    assert.deepEqual(f('2027-01-15', 3), ['2027-01-15', '2027-02-15', '2027-03-15']);
    assert.deepEqual(f('2027-11-30', 3), ['2027-11-30', '2027-12-30', '2028-01-30']);
    return true;
  },
  'S1-clamp': async (t) => {
    const f = await monthly(t);
    assert.deepEqual(f('2027-05-31', 2), ['2027-05-31', '2027-06-30']);
    assert.deepEqual(f('2027-08-31', 2), ['2027-08-31', '2027-09-30']);
    return true;
  },
  'S1-anchor': async (t) => {
    assert.deepEqual((await monthly(t))('2027-01-31', 3), ['2027-01-31', '2027-02-28', '2027-03-31']);
    return true;
  },
  'S1-leap': async (t) => {
    const f = await monthly(t);
    assert.deepEqual(f('2028-01-31', 2), ['2028-01-31', '2028-02-29'], '2028');
    assert.deepEqual(f('2000-01-31', 2), ['2000-01-31', '2000-02-29'], '2000');
    assert.deepEqual(f('2100-01-31', 2), ['2100-01-31', '2100-02-28'], '2100');
    return true;
  },
  'S1-tz': async (t) => {
    const want = '["2027-03-01","2027-04-01","2027-05-01"]';
    const code = `import(${JSON.stringify(join(t.ws, 'src/schedule.js'))}).then((m) => console.log(JSON.stringify(m.monthly('2027-03-01', 3))))`;
    for (const TZ of ['Pacific/Auckland', 'America/Los_Angeles']) {
      const r = spawnSync(process.execPath, ['-e', code], { env: { ...process.env, TZ }, encoding: 'utf8', timeout: 30000 });
      assert.equal(r.stdout.trim(), want, TZ);
    }
    return true;
  },
  'S1-invalid': async (t) => {
    const f = await monthly(t);
    assert.throws(() => f('2027-02-30', 1), RangeError, 'invalid date');
    assert.throws(() => f('2027-01-31', 1.5), RangeError, 'fractional count');
    assert.deepEqual(f('2027-01-31', 0), []);
    return true;
  },
};
