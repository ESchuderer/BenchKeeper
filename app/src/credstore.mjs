// Account tokens in the OS credential store, behind four calls (set, get, has, delete). The token goes to the store's
// command on stdin, never on its command line (other local users read that with ps). Where no store works the adapter
// refuses with the reason: there is no plaintext file or environment fallback.
// Linux: secret-tool (libsecret). macOS: security, fed through its stdin. Other systems refuse.
// shortcut: macOS and Windows are untested here (Windows Credential Manager has no stdin form), refuse there until verified.
import { childEnv } from './childenv.mjs';

const SERVICE = 'benchkeeper';
// A token is one run of these characters: the shape lets it go into a quoted command without escaping.
export const TOKEN = /^[A-Za-z0-9._~+/=-]{20,4096}$/;

export class StoreError extends Error {}

const refuse = (why) => ({
  name: 'none',
  set: () => { throw new StoreError(why); },
  get: () => { throw new StoreError(why); },
  has: () => { throw new StoreError(why); },
  delete: () => { throw new StoreError(why); },
});

// run: ctx.run (argv, { input, env }) -> { code, stdout, stderr }. A missing program is code 127.
export function credentialStore(run, { platform = process.platform, env = process.env } = {}) {
  // The session bus is how secret-tool finds the secret service.
  const base = { ...childEnv({}, env), ...Object.fromEntries(['DBUS_SESSION_BUS_ADDRESS', 'DISPLAY', 'WAYLAND_DISPLAY'].filter((k) => env[k]).map((k) => [k, env[k]])) };
  const call = (argv, input) => {
    const r = run(argv, { input, env: base });
    if (r.code === 127) throw new StoreError(`${argv[0]} is not installed${platform === 'linux' ? ' (package libsecret-tools)' : ''}: the token cannot be kept`);
    return r;
  };
  const check = (name, token) => {
    if (!/^[\w.-]{1,64}$/.test(name)) throw new StoreError('invalid account name');
    if (token !== undefined && !TOKEN.test(token)) throw new StoreError('the token has an unexpected shape: nothing was stored');
  };
  // get answers the token on stdout; delete is confirmed by a lookup after it.
  const lookup = (getArgv, deleteArgv, notDeleted) => ({
    get(name) {
      check(name);
      const r = call(getArgv(name));
      return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
    },
    has(name) { return this.get(name) !== null; },
    delete(name) {
      check(name);
      call(deleteArgv(name));
      if (this.has(name)) throw new StoreError(notDeleted);
    },
  });
  if (platform === 'linux') {
    const attrs = (name) => ['service', SERVICE, 'account', name];
    return {
      name: 'libsecret',
      set(name, token) {
        check(name, token);
        const r = call(['secret-tool', 'store', `--label=BenchKeeper ${name}`, ...attrs(name)], token);
        if (r.code !== 0) throw new StoreError('the secret service did not store the token (is a keyring running and unlocked?)');
      },
      ...lookup((name) => ['secret-tool', 'lookup', ...attrs(name)], (name) => ['secret-tool', 'clear', ...attrs(name)],
        'the secret service did not delete the token: delete it there by hand (it is stored under the service name benchkeeper)'),
    };
  }
  if (platform === 'darwin') {
    // `security -i` reads its commands from stdin; the token shape needs no escaping inside the quotes.
    const target = (name) => `-s ${SERVICE} -a "${name}"`;
    return {
      name: 'keychain',
      set(name, token) {
        check(name, token);
        const r = call(['security', '-i'], `add-generic-password -U ${target(name)} -w "${token}"\n`);
        if (r.code !== 0) throw new StoreError('the keychain did not store the token');
      },
      ...lookup((name) => ['security', 'find-generic-password', '-s', SERVICE, '-a', name, '-w'], (name) => ['security', 'delete-generic-password', '-s', SERVICE, '-a', name],
        'the keychain did not delete the token: delete it in Keychain Access (service benchkeeper)'),
    };
  }
  return refuse(`no credential store is supported on ${platform}: the token is not kept (sign in with accounts login instead)`);
}
