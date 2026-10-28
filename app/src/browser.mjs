// Opens a sign-in URL in a private window of a browser found on the machine. A fresh private window holds no session
// of another account, so the sign-in page asks which account to use. Only https URLs of the providers' own sign-in hosts
// are opened (the URL comes from an agent's output); anything else, no browser and a machine without a display are
// reported as null and the caller prints the URL. Nothing is launched without a caller that asked for a sign-in.
import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

const HOSTS = /(^|\.)(anthropic\.com|claude\.ai|claude\.com|openai\.com|chatgpt\.com)$/;

// The URL as written when it is safe to open, else null.
export function signInUrl(text) {
  let u;
  try { u = new URL(String(text)); } catch { return null; }
  return u.protocol === 'https:' && !u.username && !u.password && HOSTS.test(u.hostname) && !/[\s\x00-\x1f"'<>`\\]/.test(String(text)) ? u.href : null;
}

const onPath = (bin, env) => (env.PATH ?? '').split(delimiter).filter(Boolean).some((d) => isFile(join(d, bin)));

// Flags by browser family: Firefox --private-window (verified with firefox --help), Chrome and Chromium --incognito,
// Edge --inprivate (the last two unverified against the installed browsers).
const FLAGS = { firefox: '--private-window', chrome: '--incognito', chromium: '--incognito', edge: '--inprivate' };
const LINUX = [['Firefox', 'firefox', 'firefox'], ['Chrome', 'google-chrome', 'chrome'], ['Chrome', 'google-chrome-stable', 'chrome'], ['Chromium', 'chromium', 'chromium'], ['Chromium', 'chromium-browser', 'chromium'], ['Edge', 'microsoft-edge', 'edge'], ['Edge', 'microsoft-edge-stable', 'edge']];
const MAC = [['Firefox', 'Firefox', 'firefox'], ['Google Chrome', 'Google Chrome', 'chrome'], ['Chromium', 'Chromium', 'chromium'], ['Microsoft Edge', 'Microsoft Edge', 'edge']];
const WINDOWS = [['Firefox', ['ProgramFiles', 'Mozilla Firefox\\firefox.exe'], 'firefox'], ['Chrome', ['ProgramFiles', 'Google\\Chrome\\Application\\chrome.exe'], 'chrome'], ['Edge', ['ProgramFiles(x86)', 'Microsoft\\Edge\\Application\\msedge.exe'], 'edge']];

const isFile = (p) => { try { accessSync(p, constants.X_OK); return true; } catch { return false; } };

// { name, argv(url) } for the first supported browser, or null (none found, or a machine without a display).
// has(candidate) says whether a program name (Linux), an app name (macOS) or an exe path (Windows) exists; a seam for tests.
export function findBrowser({ platform = process.platform, env = process.env, has } = {}) {
  if (platform === 'linux') {
    if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return null;
    const found = LINUX.find(([, bin]) => (has ?? ((b) => onPath(b, env)))(bin));
    return found ? { name: found[0], argv: (url) => [found[1], FLAGS[found[2]], url] } : null;
  }
  if (platform === 'darwin') {
    const found = MAC.find(([app]) => (has ?? ((a) => isFile(`/Applications/${a}.app`)))(app));
    return found ? { name: found[0], argv: (url) => ['open', '-na', found[0], '--args', FLAGS[found[2]], url] } : null;
  }
  if (platform === 'win32') {
    const found = WINDOWS.map(([name, [root, rel], family]) => ({ name, family, exe: env[root] && join(env[root], rel) })).find((w) => w.exe && (has ?? isFile)(w.exe));
    return found ? { name: found.name, argv: (url) => [found.exe, FLAGS[found.family], url] } : null;
  }
  return null;
}

// Opens url in a private window. Returns the browser's name, or null when nothing was launched (the caller prints the URL).
export function openPrivate(url, { find = findBrowser, start = spawn } = {}) {
  const safe = signInUrl(url);
  const browser = safe && find();
  if (!browser) return null;
  const [cmd, ...args] = browser.argv(safe);
  try { start(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { return null; }
  return browser.name;
}
