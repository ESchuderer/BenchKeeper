// Smoke test for every OS (the Windows CI job runs only this): start, plan, apply writes files and a ledger run.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { main, machineContext } from '../src/cli.mjs';

const home = mkdtempSync(join(tmpdir(), 'bk-smoke-'));
const ctx = machineContext({ BENCHKEEPER_HOME: home });
let text = '';
const out = new Writable({ write(c, _, done) { text += c; done(); } });
assert.equal(await main(['help'], { out, ctx }), 0);
assert.equal(await main(['plan', '--agents', 'claude'], { out, ctx }), 0);
assert.match(text, /Claude Code rules/);
// Agent commands fail here (no agent installed); file changes still apply and the run is recorded.
await main(['apply', '--agents', 'claude', '--yes'], { out, ctx });
assert.ok(existsSync(join(home, '.claude', 'rules', '00-global.md')), text);
assert.equal(readdirSync(join(home, '.config', 'benchkeeper', 'ledger')).length, 1);
console.log('smoke ok');
