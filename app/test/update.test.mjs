import assert from 'node:assert/strict';
import { test } from 'node:test';
import { updateProjects } from '../ui/update.js';

const answer = (paths) => async (url, init) => {
  const [path] = JSON.parse(init.body).paths;
  paths.push(path);
  return { ok: true, status: 200, json: async () => [{ path, status: 'applied' }] };
};

test('Update all in the app: one request per project, each row reports on its own', async () => {
  const seen = [], steps = [];
  globalThis.fetch = answer(seen);
  const rows = await updateProjects(['/a', '/b'], true, (r) => steps.push(r.map((x) => x.status).join()));
  assert.deepEqual(seen, ['/a', '/b']);
  assert.deepEqual(rows.map((r) => r.status), ['applied', 'applied']);
  assert.deepEqual(steps, ['pending,pending', 'running,pending', 'applied,pending', 'applied,running', 'applied,applied']);
});

test('stop after this project: the running one finishes, the rest are skipped and never requested', async () => {
  const seen = [], control = { stop: false };
  globalThis.fetch = async (url, init) => { control.stop = true; return answer(seen)(url, init); };
  const rows = await updateProjects(['/a', '/b', '/c'], true, () => {}, control);
  assert.deepEqual(seen, ['/a']);
  assert.deepEqual(rows, [{ path: '/a', status: 'applied' }, { path: '/b', status: 'skipped', reason: 'stopped by you' }, { path: '/c', status: 'skipped', reason: 'stopped by you' }]);
});
