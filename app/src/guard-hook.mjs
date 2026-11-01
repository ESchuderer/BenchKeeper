// Written by project setup to .claude/hooks/benchkeeper-guard.mjs and run by Claude Code as a PreToolUse hook for Bash.
// It denies the commands the project rules forbid in the forms a deny rule's text pattern misses: combined short flags,
// `git -C dir push`, a path to the program, `bash -c '...'`, `eval`, command substitution, heredocs for a shell.
// It only denies (exit 2 and one line on stderr); it never approves and writes nothing. It reads its input and, since bot
// sessions (#817), its environment: while BENCHKEEPER_BOT_EMAIL is set (benchkeeper run --as-bot, bot shell) it also denies the
// usual ways to commit or push under another identity, so a bot session cannot quietly act as the user. Without that variable
// nothing else of the environment is read.
// shortcut: a shell parser by hand, not a full one (no nesting inside command substitution, no variables, no aliases,
// no abbreviated long options); a command it cannot read passes on to the normal permission flow.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish']);
// Words that run or prefix another command: the command follows (with their own flags and numbers).
const WRAP = new Set(['env', 'command', 'exec', 'nohup', 'time', 'nice', 'timeout', 'stdbuf', 'xargs', 'builtin', 'setsid', 'ionice', '{', '}', '!', 'if', 'then', 'else', 'elif', 'do', 'while', 'until']);
// Of those, the ones whose options take a separate value (env -u VAR, timeout -s KILL, xargs -I X): the command can be any later word.
const WIDE = new Set(['env', 'timeout', 'xargs', 'stdbuf', 'time', 'exec', 'ionice', 'nice']);
const base = (w) => w.split('/').pop();

// Splits a command text into simple commands: { words, bodies } with quotes removed and the heredoc bodies that follow.
function split(text) {
  const segs = [];
  let words = [], word = null, quote = null, here = false, hereWords = [];
  const flush = () => { if (word !== null) { (here ? hereWords : words).push(word); here = false; } word = null; };
  const end = () => { flush(); if (words.length) segs.push({ words, bodies: hereWords }); words = []; hereWords = []; here = false; };
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
    // `<<<` is a here-string: its word is a script body for a shell, not an argument or a heredoc delimiter.
    if (c === '<' && text.startsWith('<<<', i)) { flush(); here = true; i += 2; continue; }
    if (c === '<' && text.startsWith('<<', i)) {
      const m = text.slice(i).match(/^<<-?[ \t]*(?:'([^']*)'|"([^"]*)"|([^\s;&|()<>]+))/);
      if (m) { heredocs.push(m[1] ?? m[2] ?? m[3]); i += m[0].length - 1; continue; }
    }
    if (c === '\n') {
      end();
      for (const delim of heredocs.splice(0)) {
        const lines = [];
        while (i + 1 < text.length) {
          const nl = text.indexOf('\n', i + 1), line = text.slice(i + 1, nl < 0 ? text.length : nl);
          i += line.length + 1;
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
const VALUE_LETTERS = { commit: 'mFCct', push: 'o' };
// Letters whose value is optional and only ever attached (-S<keyid>, -u<mode>): they end the cluster, never take the next word.
const ATTACHED_LETTERS = { commit: 'uS', push: '' };
const VALUE_WORDS = new Set(['--message', '--file', '--author', '--date', '--template', '--fixup', '--squash', '--reuse-message', '--reedit-message', '--cleanup', '--push-option', '--repo', '--receive-pack', '--exec']);
const GIT_VALUE_OPTS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env']);

// Bot sessions: the variables that set who commits or which config git reads, and the config keys that set who commits or
// which login a push uses. A reason of a bot session is { bot: text }.
const IDENTITY_VARS = /^(GIT_(AUTHOR|COMMITTER)_(NAME|EMAIL)|GIT_CONFIG(_\w+)?|GH_CONFIG_DIR)$/;
const IDENTITY_KEYS = /^(user|author|committer|credential)(\.|$)/i;
const CONFIG_VALUE_OPTS = new Set(['-f', '--file', '--blob', '--type', '--default', '--comment', '--value']);
// git config that writes one of IDENTITY_KEYS: the old form with a value or a write option, and the set/unset subcommands.
function configWrite(rest) {
  const pos = [];
  let write = false;
  for (let j = 0; j < rest.length; j++) {
    if (CONFIG_VALUE_OPTS.has(rest[j])) j++;
    else if (/^(--(unset|unset-all|add|replace-all|rename-section|remove-section|edit)|-e)$/.test(rest[j])) write = true;
    else if (!rest[j].startsWith('-')) pos.push(rest[j]);
  }
  if (['get', 'list'].includes(pos[0])) return null;
  if (['set', 'unset', 'rename-section', 'remove-section', 'edit'].includes(pos[0])) { write = true; pos.shift(); }
  return (write || pos.length > 1) && IDENTITY_KEYS.test(pos[0] ?? '') ? { bot: `git config ${pos[0]}` } : null;
}

// git commit and push flags, and in a bot session the identity checks: the reason to deny, or null.
function git(args, env) {
  const bot = !!env.BENCHKEEPER_BOT_EMAIL;
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) {
    const pair = args[i] === '-c' || args[i] === '--config-env' ? args[i + 1] ?? '' : args[i].startsWith('--config-env=') ? args[i].slice(13) : null;
    if (bot && pair !== null && IDENTITY_KEYS.test(pair)) return { bot: `git ${args[i].split('=')[0]} ${pair.split('=')[0]}` };
    i += GIT_VALUE_OPTS.has(args[i]) ? 2 : 1;
  }
  const sub = args[i];
  if (bot && sub === 'config') return configWrite(args.slice(i + 1));
  if (sub !== 'commit' && sub !== 'push') return null;
  if (bot && (env.GIT_AUTHOR_EMAIL !== env.BENCHKEEPER_BOT_EMAIL || env.GIT_COMMITTER_EMAIL !== env.BENCHKEEPER_BOT_EMAIL)) return { bot: `git ${sub} while the session's author or committer is not the bot` };
  if (bot && sub === 'commit' && args.slice(i + 1).some((a) => a === '--author' || a.startsWith('--author='))) return { bot: 'git commit --author' };
  const found = new Set();
  const rest = args.slice(i + 1);
  const stop = rest.indexOf('--');
  // After `--` the words are not flags, but a push refspec with a leading + still forces.
  if (sub === 'push' && stop >= 0 && rest.slice(stop + 1).some((a) => a.startsWith('+'))) found.add('a +refspec');
  for (let j = 0; j < (stop < 0 ? rest.length : stop); j++) {
    const a = rest[j];
    if (VALUE_WORDS.has(a)) { j++; continue; }
    if (a === '--no-verify') found.add('--no-verify');
    else if (a.startsWith('--force')) found.add('--force');
    else if (a.startsWith('--')) continue;
    else if (a.startsWith('-')) {
      for (let k = 1; k < a.length; k++) {
        // The letter that takes a value ends the cluster; with nothing after it in the word, the value is the next word.
        if (ATTACHED_LETTERS[sub].includes(a[k])) break;
        if (VALUE_LETTERS[sub].includes(a[k])) { if (k === a.length - 1) j++; break; }
        if (a[k] === 'n') found.add('-n');
        if (a[k] === 'f' && sub === 'push') found.add('-f');
      }
    } else if (sub === 'push' && a.startsWith('+')) found.add('a +refspec');
  }
  return found.size ? `git ${sub} with ${[...found].join(', ')}` : null;
}

// The reason to deny a command word with its arguments, or null.
function check(cmd, args, bodies, depth, env) {
  if (cmd === 'sudo') return 'sudo';
  if (cmd === 'git') return git(args, env);
  if (env.BENCHKEEPER_BOT_EMAIL && ['export', 'declare', 'typeset', 'readonly', 'unset', 'setenv'].includes(cmd)) {
    const name = args.map((a) => a.split('=')[0]).find((a) => IDENTITY_VARS.test(a));
    return name ? { bot: `${cmd} ${name}` } : null;
  }
  if (cmd === 'terraform' || cmd === 'kubectl') return args.includes('apply') ? `${cmd} apply` : null;
  if (cmd === 'helm') return args.includes('upgrade') ? 'helm upgrade' : null;
  if (cmd === 'eval') return denyReason(args.join(' '), depth + 1, env);
  if (SHELLS.has(cmd)) {
    const c = args.findIndex((a) => /^-[a-z]+$/.test(a) && a.includes('c'));
    return c >= 0 && args[c + 1] != null ? denyReason(args[c + 1], depth + 1, env) : bodies.map((b) => denyReason(b, depth + 1, env)).find(Boolean) ?? null;
  }
  return null;
}

// The command substitutions of a text that the shell runs: not the ones inside single quotes (literal text there).
function substitutions(text) {
  const found = [];
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote === "'") { if (c === "'") quote = null; continue; }
    if (c === '\\') { i++; continue; }
    if (c === '"') { quote = quote ? null : '"'; continue; }
    if (c === "'" && !quote) { quote = "'"; continue; }
    const m = text.slice(i).match(c === '`' ? /^`([^`]*)`/ : /^\$\(([^()]*)\)/);
    if (m) { found.push(m[1]); i += m[0].length - 1; }
  }
  return found;
}

// The reason to deny a command text, or null. env: the hook's environment (bot sessions).
export function denyReason(text, depth = 0, env = {}) {
  if (typeof text !== 'string' || depth > 5) return null;
  // Command substitution inside double quotes is not split off by the parser above.
  for (const inner of substitutions(text)) {
    const r = denyReason(inner, depth + 1, env);
    if (r) return r;
  }
  for (const { words, bodies } of split(text)) {
    let i = 0, wide = false;
    for (; i < words.length; i++) {
      if (/^[A-Za-z_]\w*=/.test(words[i])) continue;
      if (!WRAP.has(base(words[i]))) break;
      wide ||= WIDE.has(base(words[i]));
      while (/^(-|\d|[A-Za-z_]\w*=)/.test(words[i + 1] ?? '')) i++;
    }
    // An assignment before the command (VAR=x git commit, env VAR=x git push) sets the identity for that one command.
    const set = env.BENCHKEEPER_BOT_EMAIL && words.slice(0, i).map((w) => w.split('=')[0]).find((w) => IDENTITY_VARS.test(w));
    if (set) return { bot: `setting ${set}` };
    // shortcut: after such a wrapper every later word counts as the command, so `timeout 5 echo sudo` is denied too.
    for (let j = i; j < (wide ? words.length : i + 1); j++) {
      const r = check(base(words[j] ?? ''), words.slice(j + 1), bodies, depth, env);
      if (r) return r;
    }
  }
  return null;
}

// The line for Claude Code, or null when the input is not a Bash call or holds nothing denied.
export function decide(input, env = process.env) {
  let call;
  try { call = JSON.parse(input); } catch { return null; }
  const why = call?.tool_name === 'Bash' ? denyReason(call.tool_input?.command, 0, env) : null;
  if (why?.bot) return `BenchKeeper guard: ${why.bot} is denied in a bot session, which commits and pushes as the bot (${env.BENCHKEEPER_BOT_EMAIL}): run git commit and git push without author, identity or credential settings and they go as the bot; to act as yourself, the user ends the bot session`;
  return why &&`BenchKeeper guard: ${why} is denied in this project (the rules without exceptions); ask the user to run it themselves`;
}

// Node resolves the main module to its real path but leaves process.argv[1] as given, so compare real paths (a symlinked project path).
const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { input += d; });
  process.stdin.on('end', () => {
    const line = decide(input);
    if (line) { process.stderr.write(`${line}\n`); process.exitCode = 2; }
  });
}
