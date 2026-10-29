// Smoke test for every OS (the Windows CI job runs only this): start, plan, apply writes files and a ledger run; a change to
// an existing file outside HOME (its backup goes below _root) applies and undoes.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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
const project = mkdtempSync(join(tmpdir(), 'bk-smoke-project-'));
const settings = join(project, '.claude', 'settings.json');
mkdirSync(join(project, '.claude'));
writeFileSync(settings, '{"model":"opus"}\n');
text = '';
assert.equal(await main(['settings', 'set', 'model', 'sonnet', '--agent', 'claude', '--layer', 'project', '--project', project, '--yes'], { out, ctx }), 0, text);
assert.match(readFileSync(settings, 'utf8'), /sonnet/);
assert.equal(await main(['undo', text.match(/benchkeeper undo (\S+)/)[1]], { out, ctx }), 0, text);
assert.equal(readFileSync(settings, 'utf8'), '{"model":"opus"}\n');
console.log('smoke ok');
