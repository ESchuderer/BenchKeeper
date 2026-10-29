// Best-effort masking of secrets in text that is shown or stored: diff context, session argv, command output, prompts.
// A value is masked when its key names a secret or when it has the shape of a known token; nothing else is guessed.
// The runs around the word are bounded: a long dotted or dashed token cannot make the match quadratic.
const NAME = '[\\w.-]{0,64}(?:token|secret|passw(?:or)?d|credential|authorization|api[_-]?key|key)[\\w.-]{0,64}';
const SHAPES = /\b(?:sk-ant-|sk-|ghp_|gho_|ghs_|ghu_|ghr_|github_pat_|npm_|glpat-|xox[abprs]-|AKIA|AIza)[\w-]{8,}/g;
const ASSIGN = new RegExp(`(\\b${NAME}["']?\\s*[=:]\\s*)(?:(?:Bearer|Basic|token)\\s+)?("(?:[^"\\\\]|\\\\.)*"|'[^']*'|[^\\s,;"']+)`, 'gi');
const FLAG = new RegExp(`(--?${NAME}[ =])("(?:[^"\\\\]|\\\\.)*"|'[^']*'|\\S+)`, 'gi');
const PEM = /(-----BEGIN ([A-Z0-9 ]*)PRIVATE KEY-----)[\s\S]*?(-----END \2PRIVATE KEY-----)/g;
const SHAPED = (t) => t.replace(/\bBearer\s+\S+/gi, 'Bearer ***').replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '***').replace(/(:\/\/)[^\s/:@]+:[^\s/@]+@/g, '$1***@').replace(SHAPES, '***');

// keys false: free text (rules, skills), where only token shapes are masked; true: settings, configuration and commands.
export function mask(text, { keys = true } = {}) {
  // The key block goes first: a key=value pattern inside its base64 body could eat its END line.
  const t = String(text ?? '').replace(PEM, '$1\n***\n$3');
  return SHAPED(keys ? t.replace(FLAG, '$1***').replace(ASSIGN, '$1***') : t);
}

// Files whose lines are key = value: their diff context may sit next to a secret.
export const keyed = (path) => /\.(json|jsonc|toml|ya?ml|env|ini)$|(^|[\\/])(\.npmrc|config|\.env(\.[\w-]+)?)$/i.test(path ?? '');

// An argv of a session the user records: values that follow a secret flag or sit in a key=value pair are masked.
export function redactArgv(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const flag = new RegExp(`^--?${NAME}$`, 'i').test(a);
    out.push(mask(a));
    if (flag && i + 1 < argv.length) { out.push('***'); i++; }
  }
  return out;
}
