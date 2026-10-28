// Written by project setup to .claude/hooks/benchkeeper-guard.mjs and run by Claude Code as a PreToolUse hook for Bash.
// It denies the commands the project rules forbid in the forms a deny rule's text pattern misses: combined short flags,
// `git -C dir push`, a path to the program, `bash -c '...'`, `eval`, command substitution, heredocs for a shell.
// It only denies (exit 2 and one line on stderr); it never approves, writes nothing and reads only its input.
// shortcut: a shell parser by hand, not a full one (no nesting inside command substitution, no variables, no aliases,
// no abbreviated long options); a command it cannot read passes on to the normal permission flow.
import { pathToFileURL } from 'node:url';

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish']);
// Words that run or prefix another command: the command follows (with their own flags and numbers).
const WRAP = new Set(['env', 'command', 'exec', 'nohup', 'time', 'nice', 'timeout', 'stdbuf', 'xargs', 'builtin', 'setsid', 'ionice', '{', '}', '!', 'if', 'then', 'else', 'elif', 'do', 'while', 'until']);
const base = (w) => w.split('/').pop();

// Splits a command text into simple commands: { words, bodies } with quotes removed and the heredoc bodies that follow.
function split(text) {
  const segs = [];
  let words = [], word = null, quote = null;
  const flush = () => { if (word !== null) words.push(word); word = null; };
  const end = () => { flush(); if (words.length) segs.push({ words, bodies: [] }); words = []; };
  const heredocs = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote === "'") { if (c === "'") quote = null; else word += c; continue; }
    if (quote === '"') {
      if (c === '"') quote = null;
      else if (c === '\\') word += text[++i] ?? '';
      else word += c;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; word ??= ''; continue; }
    if (c === '\\') { if (text[i + 1] !== '\n') word = (word ?? '') + (text[i + 1] ?? ''); i++; continue; }
    if (c === '#' && word === null) { while (i < text.length && text[i] !== '\n') i++; i--; continue; }
    if (c === '<' && text.startsWith('<<', i) && text[i + 2] !== '<') {
      const m = text.slice(i).match(/^<<-?[ \t]*(?:'([^']*)'|"([^"]*)"|([^\s;&|()<>]+))/);
      if (m) { heredocs.push(m[1] ?? m[2] ?? m[3]); i += m[0].length - 1; continue; }
    }
    if (c === '\n') {
      end();
      for (const delim of heredocs.splice(0)) {
        const lines = [];
        for (i++; i < text.length; i++) {
          const nl = text.indexOf('\n', i), line = text.slice(i, nl < 0 ? text.length : nl);
          i = nl < 0 ? text.length : nl;
          if (line.trim() === delim) break;
          lines.push(line);
        }
        i--;
        segs.at(-1)?.bodies.push(lines.join('\n'));
      }
      continue;
    }
    if (';&|()'.includes(c)) { end(); continue; }
    if (c === ' ' || c === '\t' || c === '\r') { flush(); continue; }
    word = (word ?? '') + c;
  }
  end();
  return segs;
}

// Short-flag letters that take the rest of the cluster (or the next word) as their value.
const VALUE_LETTERS = { commit: 'mFCctuS', push: 'o' };
const VALUE_WORDS = new Set(['--message', '--file', '--author', '--date', '--template', '--fixup', '--squash', '--reuse-message', '--reedit-message', '--cleanup', '--push-option', '--repo', '--receive-pack', '--exec']);
const GIT_VALUE_OPTS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env']);

// git commit and push flags: the reason to deny, or null.
function git(args) {
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) i += GIT_VALUE_OPTS.has(args[i]) ? 2 : 1;
  const sub = args[i];
  if (sub !== 'commit' && sub !== 'push') return null;
  const found = new Set();
  const rest = args.slice(i + 1);
  for (let j = 0; j < rest.length && rest[j] !== '--'; j++) {
    const a = rest[j];
    if (VALUE_WORDS.has(a)) { j++; continue; }
    if (a === '--no-verify') found.add('--no-verify');
    else if (a.startsWith('--force')) found.add('--force');
    else if (a.startsWith('--')) continue;
    else if (a.startsWith('-')) {
      for (let k = 1; k < a.length; k++) {
        // The letter that takes a value ends the cluster; with nothing after it in the word, the value is the next word.
        if (VALUE_LETTERS[sub].includes(a[k])) { if (k === a.length - 1) j++; break; }
        if (a[k] === 'n') found.add('-n');
        if (a[k] === 'f' && sub === 'push') found.add('-f');
      }
    } else if (sub === 'push' && a.startsWith('+')) found.add('a +refspec');
  }
  return found.size ? `git ${sub} with ${[...found].join(', ')}` : null;
}

// The reason to deny a command text, or null.
export function denyReason(text, depth = 0) {
  if (typeof text !== 'string' || depth > 5) return null;
  // Command substitution inside double quotes is not split off by the parser above.
  for (const m of text.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)) {
    const r = denyReason(m[1] ?? m[2], depth + 1);
    if (r) return r;
  }
  for (const { words, bodies } of split(text)) {
    let i = 0;
    for (; i < words.length; i++) {
      if (/^[A-Za-z_]\w*=/.test(words[i])) continue;
      if (!WRAP.has(base(words[i]))) break;
      while (/^(-|\d|[A-Za-z_]\w*=)/.test(words[i + 1] ?? '')) i++;
    }
    const cmd = base(words[i] ?? ''), args = words.slice(i + 1);
    let r = null;
    if (cmd === 'sudo') r = 'sudo';
    else if (cmd === 'git') r = git(args);
    else if (cmd === 'terraform' || cmd === 'kubectl') r = args.includes('apply') ? `${cmd} apply` : null;
    else if (cmd === 'helm') r = args.includes('upgrade') ? 'helm upgrade' : null;
    else if (cmd === 'eval') r = denyReason(args.join(' '), depth + 1);
    else if (SHELLS.has(cmd)) {
      const c = args.findIndex((a) => /^-[a-z]*c[a-z]*$/.test(a));
      r = c >= 0 && args[c + 1] != null ? denyReason(args[c + 1], depth + 1) : bodies.map((b) => denyReason(b, depth + 1)).find(Boolean) ?? null;
    }
    if (r) return r;
  }
  return null;
}

// The line for Claude Code, or null when the input is not a Bash call or holds nothing denied.
export function decide(input) {
  let call;
  try { call = JSON.parse(input); } catch { return null; }
  const why = call?.tool_name === 'Bash' ? denyReason(call.tool_input?.command) : null;
  return why && `BenchKeeper guard: ${why} is denied in this project (the rules without exceptions); ask the user to run it themselves`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { input += d; });
  process.stdin.on('end', () => {
    const line = decide(input);
    if (line) { process.stderr.write(`${line}\n`); process.exitCode = 2; }
  });
}
