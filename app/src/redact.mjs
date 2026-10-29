// Best-effort masking of secrets in text that is shown or stored: diff context, session argv, command output, prompts.
// A value is masked when its key names a secret or when it has the shape of a known token; nothing else is guessed.
// The runs around the word are bounded: a long dotted or dashed token cannot make the match quadratic.
const NAME = '[\\w.-]{0,64}(?:token|secret|passw(?:or)?d|credential|authorization|api[_-]?key|key)[\\w.-]{0,64}';
const SHAPES = /\b(?:sk-ant-|sk-|ghp_|gho_|ghs_|ghu_|ghr_|github_pat_|npm_|glpat-|xox[abprs]-|AKIA|AIza)[\w-]{8,}/g;
const VALUE = `(?:(?:Bearer|Basic|token)\\s+)?("(?:[^"\\\\]|\\\\.)*"|'[^']*'|[^\\s,;"']+)`;
const ASSIGN = new RegExp(`(\\b${NAME}["']?\\s*[=:]\\s*)${VALUE}`, 'gi');
const FLAG = new RegExp(`(--?${NAME}[ =])("(?:[^"\\\\]|\\\\.)*"|'[^']*'|\\S+)`, 'gi');
// A body stops at the next BEGIN line: a BEGIN without END scans only to the next block, so the match stays linear.
const PEM = /(-----BEGIN ([A-Z0-9 ]*)PRIVATE KEY( BLOCK)?-----)((?:(?!-----BEGIN )[\s\S])*?)(-----END \2PRIVATE KEY\3-----)/g;
const SHAPED = (t) => t.replace(/\bBearer\s+\S+/gi, 'Bearer ***').replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '***').replace(/(:\/\/)[^\s/:@]+:[^\s/@]+@/g, '$1***@').replace(SHAPES, '***');

// Each line of a key body becomes ***, so masking never adds or removes a line break.
export const maskKeys = (text) => String(text ?? '').replace(PEM, (_, begin, _t, _b, body, end) => begin + body.replace(/[^\r\n]+/g, '***') + end);

// keys false: free text (rules, skills), where only token shapes are masked; true: settings, configuration and commands.
export function mask(text, { keys = true } = {}) {
  // The key block goes first: a key=value pattern inside its base64 body could eat its END line.
  const t = maskKeys(text);
  return SHAPED(keys ? t.replace(FLAG, '$1***').replace(ASSIGN, '$1***') : t);
}

// Output that arrives in chunks is masked line by line as it comes, so the kept tail is masked before it is cut and a
// key block whose END line has not come yet is masked too. s holds { text, rest, end }: the masked lines, the unfinished
// last line (raw) and the END line an open key block waits for. shown(s) is the text with the unfinished line masked.
// s.pending is set when a line ends with a secret key and no value: the first token of the next line is that value.
const PENDING = new RegExp(`\\b${NAME}["']?\\s*[=:]\\s*(?:(?:Bearer|Basic|token)\\s+)?$`, 'i');
const NEXT = new RegExp(`^(\\s*)${VALUE}`, 'i');
const BEGIN = /-----BEGIN ([A-Z0-9 ]*)PRIVATE KEY( BLOCK)?-----/g;
const stars = (t) => t.replace(/[^\r\n]+/g, '***');
function maskLine(s, line) {
  if (s.end) {
    const i = line.indexOf(s.end);
    if (i < 0) return stars(line);
    const end = s.end;
    s.end = null;
    return stars(line.slice(0, i)) + end + maskLine(s, line.slice(i + end.length));
  }
  if (s.pending && /\S/.test(line)) {
    s.pending = false;
    // A key block on the next line is masked as a block: its BEGIN line is not the value.
    const v = !/^\s*-----BEGIN /.test(line) && line.match(NEXT);
    if (v) return `${v[1]}***${maskLine(s, line.slice(v[0].length))}`;
  }
  const open = [...line.matchAll(BEGIN)].at(-1);
  const end = open && `-----END ${open[1]}PRIVATE KEY${open[2] ?? ''}-----`;
  if (!open || line.includes(end, open.index)) {
    if (PENDING.test(line)) s.pending = true;
    return mask(line);
  }
  s.end = end;
  const cut = open.index + open[0].length;
  return mask(line.slice(0, cut)) + stars(line.slice(cut));
}
export function maskStream(s, chunk, max = 65536) {
  const lines = (s.rest + chunk).split(/(?<=\n)/);
  let rest = lines.at(-1).endsWith('\n') ? '' : lines.pop();
  s.text = (s.text + lines.map((l) => maskLine(s, l)).join('')).slice(-max);
  // An unfinished line longer than max loses its head: the head goes through maskLine first, so a BEGIN in it leaves
  // s.end set for the kept tail. A BEGIN line across the cut moves the cut behind it.
  let cut = rest.length - max;
  if (cut > 0) {
    const across = [...rest.matchAll(BEGIN)].find((m) => m.index < cut && m.index + m[0].length > cut);
    if (across) cut = across.index + across[0].length;
    maskLine(s, rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  s.rest = rest;
  return s;
}
export const shown = (s) => s.text + maskLine({ end: s.end, pending: s.pending }, s.rest);

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
