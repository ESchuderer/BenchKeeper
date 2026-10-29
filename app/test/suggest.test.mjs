import assert from 'node:assert/strict';
import { test } from 'node:test';
import { differs, editableIn, fixOf, matches } from '../ui/suggest.js';

const CLAUDE = ['managed', 'local', 'project', 'user'];

const scrub = { key: 'env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB', type: 'switch', suggest: { value: true } };
const telemetry = { key: 'env.DISABLE_TELEMETRY', type: 'switch', zeroIsSet: true, suggest: { value: null } };

test('a switch matches its suggestion by its own rule: 0 and false are off, unless any present value counts as set', () => {
  for (const v of ['1', 1, true, 'TRUE']) assert.equal(matches(scrub, v), true, String(v));
  for (const v of ['0', 0, false, 'false', null, undefined]) assert.equal(matches(scrub, v), false, String(v));
  // Leave unset: a present 0 or false still turns telemetry off.
  for (const v of [null, undefined, '']) assert.equal(matches(telemetry, v), true, String(v));
  for (const v of ['0', 0, false, '1']) assert.equal(matches(telemetry, v), false, String(v));
});

test('other types compare the value, and leave unset is no value', () => {
  const row = { key: 'cleanupPeriodDays', type: 'int', suggest: { value: null } };
  assert.equal(matches(row, undefined), true);
  assert.equal(matches(row, 30), false);
  assert.equal(matches({ ...row, suggest: { value: 30 } }, 30), true);
});

test('differs reads the given layer, and a row without a suggestion never differs', () => {
  const row = { ...scrub, sets: [{ layer: 'project', value: '1' }, { layer: 'user', value: '0' }] };
  assert.equal(differs(row, 'user'), true);
  assert.equal(differs(row, 'project'), false);
  assert.equal(differs({ key: 'x', type: 'int', sets: [] }, 'user'), false);
});

test('a note fixes only when it prescribes a fix, and only editable settings that differ', () => {
  const rows = [{ ...scrub, sets: [] }, { ...telemetry, sets: [{ layer: 'user', value: '1' }] }, { ...scrub, key: 'locked', editable: false, sets: [] }];
  assert.deepEqual(fixOf({ fix: 'set it' }, rows, 'user', CLAUDE), { 'env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB': true, 'env.DISABLE_TELEMETRY': null });
  // A note that says nothing needs to change offers no fix, even where its settings differ from their suggestions.
  assert.deepEqual(fixOf({ fixChanges: 'Nothing needs to change.' }, rows, 'user', CLAUDE), {});
});

test('a key its scope refuses for a layer is neither editable nor fixed there', () => {
  const user = { ...scrub, refusedIn: ['project', 'local'], sets: [] };
  assert.deepEqual(['user', 'project', 'local'].map((l) => editableIn(user, l)), [true, false, false]);
  assert.equal(editableIn({ ...scrub, editable: false }, 'user'), false);
  assert.deepEqual(fixOf({ fix: 'set it' }, [user], 'project', CLAUDE), {});
  assert.deepEqual(fixOf({ fix: 'set it' }, [user], 'user', CLAUDE), { 'env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB': true });
});

test('a fix skips a setting that a layer with higher precedence sets, and writes one that a lower layer sets', () => {
  const fail = { key: 'sandbox.failIfUnavailable', type: 'switch', suggest: { value: true } };
  const local = [{ ...fail, sets: [{ layer: 'local', value: false }] }];
  assert.deepEqual(fixOf({ fix: 'set it' }, local, 'project', CLAUDE), {}, 'the local file wins over the project file');
  assert.deepEqual(fixOf({ fix: 'set it' }, local, 'local', CLAUDE), { 'sandbox.failIfUnavailable': true });
  const user = [{ ...fail, sets: [{ layer: 'user', value: false }] }];
  assert.deepEqual(fixOf({ fix: 'set it' }, user, 'project', CLAUDE), { 'sandbox.failIfUnavailable': true }, 'the project file wins over the user file');
  assert.deepEqual(fixOf({ fix: 'set it' }, [{ ...fail, sets: [] }], 'user', CLAUDE), { 'sandbox.failIfUnavailable': true });
});

test('a removal fix is offered only when the value below it matches the suggestion', () => {
  const days = { key: 'cleanupPeriodDays', type: 'int', suggest: { value: null } };
  const both = [{ ...days, sets: [{ layer: 'project', value: 7 }, { layer: 'user', value: 7 }] }];
  assert.deepEqual(fixOf({ fix: 'remove it' }, both, 'project', CLAUDE), {}, 'the user value still applies after the removal');
  assert.deepEqual(fixOf({ fix: 'remove it' }, both, 'user', CLAUDE), {}, 'the project value wins over the user file');
  assert.deepEqual(fixOf({ fix: 'remove it' }, [{ ...days, sets: [{ layer: 'project', value: 7 }] }], 'project', CLAUDE), { cleanupPeriodDays: null });
  assert.deepEqual(fixOf({ fix: 'remove it' }, [{ ...days, sets: [{ layer: 'project', value: 7 }, { layer: 'user', value: null }] }], 'project', CLAUDE), { cleanupPeriodDays: null });
});
