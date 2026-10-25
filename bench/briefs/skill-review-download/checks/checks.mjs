// Step 1 checks of skill-review-download, run by skill-common/run.mjs. The commit under review (commits/1) has three
// faults: path traversal (`..`, encoded, absolute, and a sibling directory with root's prefix), a missing file or a
// directory crashes the process (unhandled stream error), and a malformed %-encoding crashes it (URIError). The
// commit's own test (test/files.test.js, run by S1-regressions) keeps the feature, so reverting the commit does not
// pass. A crash ends the check's process: ok false.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SECRET = 'do-not-serve-7f3a';

async function serve(t) {
  const dir = mkdtempSync(join(tmpdir(), 'att-'));
  for (const d of ['attachments', 'attachments-old', 'attachments/sub']) mkdirSync(join(dir, d));
  writeFileSync(join(dir, 'secret.txt'), SECRET);
  writeFileSync(join(dir, 'attachments-old', 'old.txt'), SECRET);
  const server = (await t.load('src/server.js')).createServer({ root: join(dir, 'attachments') });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return (path) => new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port: server.address().port, path, timeout: 10000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c)).on('end', () => resolve({ status: res.statusCode, headers: res.headers, body })).on('error', reject);
    }).on('error', reject).on('timeout', () => reject(new Error(`timeout ${path}`))).end();
  });
}
const alive = async (get) => assert.equal((await get('/health')).status, 200, 'server alive');

export default {
  'S1-traversal': async (t) => {
    const get = await serve(t);
    for (const p of ['/files/..%2Fsecret.txt', '/files/%2e%2e%2fsecret.txt', '/files/sub%2F..%2F..%2Fsecret.txt', '/files/..%2Fattachments-old%2Fold.txt', '/files/%2Fetc%2Fhostname']) {
      const r = await get(p);
      assert.ok(r.status >= 400 && r.status < 500, `${p}: status ${r.status}`);
      assert.ok(!r.body.includes(SECRET), `${p}: leaked`);
    }
    await alive(get);
    return true;
  },
  'S1-missing': async (t) => {
    const get = await serve(t);
    assert.equal((await get('/files/nope.txt')).status, 404, 'missing file');
    // A directory is no attachment: any client error (404, 400, 403, ...).
    for (const p of ['/files/sub', '/files/']) {
      const { status } = await get(p);
      assert.ok(status >= 400 && status < 500, `${p}: status ${status}`);
    }
    await alive(get);
    return true;
  },
  'S1-encoding': async (t) => {
    const get = await serve(t);
    const r = await get('/files/%E0%A4%A');
    assert.ok(r.status >= 400 && r.status < 500, `status ${r.status}`);
    await alive(get);
    return true;
  },
};
