// The webhook a run calls when it finishes or needs a person: an automation output, off until set. The URL and an optional
// bearer token are one entry of the OS credential store, never a file. A send is one POST of ids and a state, started as a
// detached process with a 5 second limit and no retry, so the caller never waits; a failure is one line in a log without the URL.
import { spawn } from 'node:child_process';
import { appendFileSync, chmodSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { store } from './accounts.mjs';
import { childEnv } from './childenv.mjs';
import { TOKEN } from './credstore.mjs';
import { readText } from './fsx.mjs';

// A dot is not allowed in an account name, so the entry never meets an account's token.
export const ENTRY = 'app.webhook';
const STATES = ['finished', 'failed', 'needs-person'];
export const TIMEOUT = 5000;
const ID = /^[\w.-]{1,64}$/;
// The template id shape of automations.mjs.
const AUTOMATION = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/;

export const logFile = (ctx) => join(ctx.home, '.cache/benchkeeper/webhook.log');

export class UsageError extends Error {}

function checkUrl(text) {
  let u;
  try { u = new URL(text); } catch { throw new UsageError('the webhook is not a URL'); }
  if (!(u.protocol === 'https:' || (u.protocol === 'http:' && LOOPBACK.test(u.hostname)))) throw new UsageError('the webhook needs https (http only to this machine)');
  if (u.username || u.password) throw new UsageError('the webhook URL holds a user or password: give a token on the second line instead');
}

// Stores the webhook; { replaced, store } with the name of the credential store.
export function setWebhook(ctx, url, token) {
  checkUrl(url);
  if (token !== undefined && !/^\S{1,2048}$/.test(token)) throw new UsageError('the token is one line without spaces');
  const value = Buffer.from(JSON.stringify(token ? { url, token } : { url })).toString('base64url');
  if (!TOKEN.test(value)) throw new UsageError('the URL and token are too long for the credential store: nothing was stored');
  const s = store(ctx), replaced = s.has(ENTRY);
  s.set(ENTRY, value);
  return { replaced, store: s.name };
}

// { url, token } or null when none is set or the store cannot be read.
function readWebhook(ctx) {
  try {
    const v = store(ctx).get(ENTRY);
    return v ? JSON.parse(Buffer.from(v, 'base64url').toString()) : null;
  } catch { return null; }
}

export const removeWebhook = (ctx) => store(ctx).delete(ENTRY);

// { configured, store, note, lastFailure }: never the URL, its host or the token.
export function webhookStatus(ctx) {
  const lastFailure = readText(logFile(ctx))?.trim().split('\n').at(-1) ?? null;
  try {
    const s = store(ctx);
    return { configured: s.has(ENTRY), store: s.name, note: null, lastFailure };
  } catch (e) { return { configured: false, store: null, note: e.message, lastFailure }; }
}

// The body of a send. Ids of fixed shapes only, so no objective or other text can ride along in a field.
export function payload({ state, run, automation, task }, time = new Date()) {
  if (!STATES.includes(state)) throw new UsageError(`--state is ${STATES.join(', ')}`);
  if (run === undefined && automation === undefined) throw new UsageError('webhook send needs --run or --automation');
  for (const [k, v] of [['run', run], ['task', task]]) if (v !== undefined && !ID.test(v)) throw new UsageError(`--${k} is an id of up to 64 letters, digits, _ . and -`);
  if (automation !== undefined && !AUTOMATION.test(automation)) throw new UsageError('--automation is a template id: lowercase words joined by hyphens');
  return { event: 'run', state, ...(run === undefined ? {} : { run }), ...(automation === undefined ? {} : { automation }), ...(task === undefined ? {} : { task }), time: time.toISOString() };
}

// Starts the POST in a detached process and returns at once: { sent } is false when no webhook is set. The URL and token
// reach the process on stdin, never in its arguments or environment.
export function sendWebhook(ctx, fields) {
  const body = payload(fields), hook = readWebhook(ctx);
  if (!hook) return { sent: false };
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import { post } from ${JSON.stringify(import.meta.url)}; let t = ''; for await (const c of process.stdin) t += c; await post(JSON.parse(t));`],
    { detached: true, stdio: ['pipe', 'ignore', 'ignore'], env: childEnv(), cwd: dirname(fileURLToPath(import.meta.url)) });
  // A failed start or a child that exits before reading is a send that did not happen, never the caller's error.
  child.on('error', () => {});
  child.stdin.on('error', () => {});
  child.stdin.end(JSON.stringify({ ...hook, payload: body, log: logFile(ctx) }));
  child.unref();
  return { sent: true };
}

// One POST, no redirect (a second request) and no retry; a failure appends the time and a status or error code, never
// the error message (it names the host).
export async function post({ url, token, payload: body, log }, timeout = TIMEOUT) {
  let why = null;
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(timeout) });
    await r.body?.cancel();
    if (!r.ok) why = `HTTP ${r.status}`;
  } catch (e) { why = e.name === 'TimeoutError' ? 'timeout' : e.cause?.code ?? e.name; }
  if (why) {
    mkdirSync(dirname(log), { recursive: true });
    appendFileSync(log, `${new Date().toISOString()} not sent: ${why}\n`, { mode: 0o600 });
    chmodSync(log, 0o600);
  }
  return why;
}
