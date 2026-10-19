import assert from 'node:assert/strict';
import { test } from 'node:test';
import { erosionCheck } from './erosion-check.mjs';

test('erosion check passes within the allowed rise and fails above it or unmeasured', () => {
  assert.equal(erosionCheck(1, { erosion: 0.193 }, { erosion: 0.184 }).ok, true);
  assert.equal(erosionCheck(1, { erosion: 0.193 }, { erosion: 0.203 }).ok, true);
  assert.equal(erosionCheck(2, { erosion: 0.193 }, { erosion: 0.21 }).ok, false);
  assert.equal(erosionCheck(3, null, { erosion: 0.1 }).ok, false);
  assert.equal(erosionCheck(3, null, null).id, 'Q3-erosion');
});
