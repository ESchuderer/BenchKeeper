// The environment of a command that installs or looks up third-party code (npx, npm, plugin installs): the variables a
// tool needs to find itself, the network and its own folders, and nothing that looks like a credential. Variables
// named in BENCHKEEPER_PASS_ENV (comma separated) and the change's own env pass as they are.
import { repoEnv } from './git.mjs';

const NAMES = new Set(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LANGUAGE', 'TERM', 'COLORTERM', 'TMPDIR', 'TMP', 'TEMP', 'TZ', 'NO_COLOR', 'FORCE_COLOR', 'CI',
  'DO_NOT_TRACK', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE',
  'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'PATHEXT', 'USERPROFILE', 'USERNAME', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'OS', 'PROCESSOR_ARCHITECTURE']);
const PREFIXES = ['LC_', 'XDG_', 'NPM_CONFIG_', 'CLAUDE_', 'CODEX_', 'GIT_', 'BENCHKEEPER_'];
// A name that suggests a credential never passes, whatever its prefix (npm_config_//registry/:_authToken, CLAUDE_CODE_OAUTH_TOKEN).
const SECRET = /token|secret|passw|credential|auth|api[_-]?key|private/i;
// Git variables that run a program or carry a setting whose value can hold a credential (an askpass program, an ssh command with a key,
// -c pairs such as http.extraheader): the name says nothing about the value, so they stay out like the names above.
const GIT_HOOKS = /^GIT_(ASKPASS|SSH|SSH_COMMAND|CONFIG_(PARAMETERS|COUNT|KEY_\d+|VALUE_\d+))$/i;

export function childEnv(extra, env = process.env) {
  const pass = new Set((env.BENCHKEEPER_PASS_ENV ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean));
  const kept = Object.entries(repoEnv(env)).filter(([k, v]) => {
    const K = k.toUpperCase();
    return v !== undefined && (pass.has(K) || ((NAMES.has(K) || PREFIXES.some((p) => K.startsWith(p))) && !SECRET.test(k) && !GIT_HOOKS.test(k)));
  });
  return { ...Object.fromEntries(kept), ...extra };
}

// Variables an agent reads its own login, endpoint and model from.
const AGENT_PREFIXES = { claude: ['ANTHROPIC_', 'CLAUDE_'], codex: ['OPENAI_', 'CODEX_'], gemini: ['GEMINI_'], copilot: ['COPILOT_'] };

// The environment of an agent session the app starts (eval, setup advice): childEnv, plus that agent's own login variables.
// A session reads project files and runs the user's hooks and MCP servers, so another agent's key, GH_TOKEN, NPM_TOKEN,
// SSH_AUTH_SOCK and the like stay out. A variable a hook or a cloud login needs comes through BENCHKEEPER_PASS_ENV.
export function agentEnv(agent, env = process.env) {
  const prefixes = AGENT_PREFIXES[agent] ?? [];
  const login = Object.entries(repoEnv(env)).filter(([k, v]) => v !== undefined && prefixes.some((p) => k.toUpperCase().startsWith(p)));
  return { ...childEnv({}, env), ...Object.fromEntries(login) };
}
