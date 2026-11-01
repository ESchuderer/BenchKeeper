// Every claim in web/src/data/facts.json (the source of the README blocks and the site) names its evidence: a repository file,
// a Markdown file with `#<heading>` (as GitHub anchors it, outside a generated block), or a result in BenchKeeper-research,
// or a list of these. Entries about another product may add its official https pages, next to a repository file for what BenchKeeper says.
// Usage: node .github/scripts/claims.mjs   (exit 1 and one line per claim when evidence is missing or does not resolve)
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// Claims that are objects carry `evidence`; `[]` means each item.
const ITEMS = ['levels[]', 'quickstart.paths[].steps[]', 'overview.parts[]', 'overview.defaults[]', 'sdlc.steps[]', 'stack.reasons[]', 'parts[]'];
const THIRD_PARTY = ['core', 'prerequisites[]', 'parallelTools[]', 'openhands'];
// Claims that are strings keep their evidence in the top-level map `evidence`, keyed by path.
const STRINGS = ['description', 'tagline', 'overview.audience', 'sdlc.requirements', 'quickstart.needs', 'quickstart.choose', 'quickstart.next', 'quickstart.changes'];
// A new top-level key is either a claim above or named here, so nothing new goes unchecked.
const NOT_CLAIMS = ['evidence'];
const RESEARCH = 'https://github.com/ESchuderer/BenchKeeper-research/';

const slug = (h) => h.trim().toLowerCase().replace(/[^a-z0-9 _-]/g, '').replace(/ /g, '-');
// A generated block repeats facts.json, so a heading whose section holds nothing else cannot back a claim.
// A section holds its subsections; lines in a code fence are no heading; a repeated heading gets -1, -2 like GitHub's anchors.
const sections = (md) => {
  const out = new Map();
  const seen = new Map();
  let open = [];
  let fence;
  for (const line of md.replace(/<!-- generated:(\w+) -->[\s\S]*?<!-- \/generated:\1 -->/g, '').split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && (!fence || (marker[0] === fence[0] && marker.length >= fence.length))) fence = fence ? undefined : marker;
    const heading = !fence && !marker && /^(#{1,6}) (.*)/.exec(line);
    if (heading) {
      const s = slug(heading[2]);
      const n = seen.get(s) ?? 0;
      seen.set(s, n + 1);
      const key = n ? `${s}-${n}` : s;
      out.set(key, '');
      open = [...open.filter((h) => h.level < heading[1].length), { level: heading[1].length, key }];
    } else for (const { key } of open) out.set(key, out.get(key) + line.trim());
  }
  return out;
};

function problem(evidence, thirdParty, dir) {
  const list = [evidence].flat();
  if (!list.length || list.some((e) => typeof e !== 'string' || !e)) return 'no evidence';
  for (const e of list) {
    if (e.startsWith(RESEARCH)) continue;
    if (/^https?:/.test(e)) {
      if (thirdParty && e.startsWith('https://')) continue;
      return `only BenchKeeper-research results may be cited by URL here: ${e}`;
    }
    const [file, anchor] = e.split('#');
    if (file === 'README.md') return 'README.md is generated from facts.json';
    if (!existsSync(resolve(dir, file))) return `file not found: ${file}`;
    if (anchor === undefined) continue;
    if (!file.endsWith('.md')) return `#${anchor}: only a Markdown heading can be cited, not a place in ${file}`;
    const body = sections(readFileSync(resolve(dir, file), 'utf8')).get(anchor);
    if (body === undefined) return `no heading for #${anchor} in ${file}`;
    if (!body) return `#${anchor} in ${file} holds only generated text`;
  }
  if (list.every((e) => /^https?:/.test(e) && !e.startsWith(RESEARCH))) return 'what BenchKeeper says needs a repository file next to the official pages';
  return null;
}

// [path, value] for each claim a path names; `a[].b[]` walks each item of a, then each item of its b.
const resolvePath = (value, keys, at) => {
  if (value === undefined) return [];
  if (!keys.length) return [[at, value]];
  const [key, ...rest] = keys;
  const name = key.replace('[]', '');
  const next = value?.[name];
  const here = at ? `${at}.${name}` : name;
  if (!key.endsWith('[]')) return resolvePath(next, rest, here);
  return (next ?? []).flatMap((v, i) => resolvePath(v, rest, `${here}[${i}]`));
};

export function check(facts, dir = root) {
  const errors = [];
  const claim = (paths, thirdParty) => {
    for (const path of paths) {
      for (const [at, c] of resolvePath(facts, path.split('.'), '')) {
        const err = problem(c.evidence, thirdParty, dir);
        const label = c.title ?? c.name;
        if (err) errors.push(`facts.${at}${label ? ` "${label}"` : ''}: ${err}`);
      }
    }
  };
  claim(ITEMS, false);
  claim(THIRD_PARTY, true);
  for (const path of STRINGS) {
    if (resolvePath(facts, path.split('.'), '').length === 0) continue;
    const err = problem(facts.evidence?.[path], false, dir);
    if (err) errors.push(`facts.${path}: ${err}`);
  }
  for (const key of Object.keys(facts.evidence ?? {})) {
    if (!STRINGS.includes(key) || resolvePath(facts, key.split('.'), '').length === 0) errors.push(`facts.evidence["${key}"]: no such string claim`);
  }
  const known = new Set([...ITEMS, ...THIRD_PARTY, ...STRINGS].map((p) => p.split(/[.[]/)[0]).concat(NOT_CLAIMS));
  for (const key of Object.keys(facts)) if (!known.has(key)) errors.push(`facts.${key}: not a known claim; add it to .github/scripts/claims.mjs`);
  return errors;
}

// Node runs the main module from its real path but leaves process.argv[1] as given (macOS /var is /private/var).
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const errors = check(JSON.parse(readFileSync(`${root}/web/src/data/facts.json`, 'utf8')));
  for (const e of errors) console.log(`::error file=web/src/data/facts.json::${e}`);
  if (errors.length) process.exit(1);
}
