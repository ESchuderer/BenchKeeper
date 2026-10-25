// Code metrics of a built app's own source (no dependencies, build output, tests or configuration): cyclomatic
// complexity per function and erosion, the share of all complexity that sits in functions above complexity 10.
// Usage: node bench/scorer/erosion.mjs <app-dir: /app or a folder of the temp folder>   prints JSON; needs `typescript` (bench/scorer/package.json)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { appFolder } from './mounts.mjs';

const SOURCE = /\.(js|jsx|ts|tsx|mjs|cjs|mts|cts)$/;
const SKIP_DIR = /^(node_modules|dist|build|coverage|\.git|\.next|out|tests?|__tests__|e2e|openspec|\.specify|\.claude|\.agents|docs)$/;
const SKIP_FILE = /\.(test|spec)\.|\.config\.|^(vite|vitest|playwright|eslint|postcss|tailwind)\b|\.d\.ts$/;
const DECISIONS = new Set([ts.SyntaxKind.IfStatement, ts.SyntaxKind.ConditionalExpression, ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement, ts.SyntaxKind.ForOfStatement, ts.SyntaxKind.WhileStatement, ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.CaseClause, ts.SyntaxKind.CatchClause]);
const LOGICAL = new Set([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken, ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken]);

export function files(dir, root = dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return SKIP_DIR.test(n) ? [] : files(p, root);
    return SOURCE.test(n) && !SKIP_FILE.test(n) ? [relative(root, p)] : [];
  });
}

// Complexity of every function-like node: 1 plus its own decision points (nested functions count on their own).
export function functions(text, name) {
  const kind = /\.tsx$/.test(name) ? ts.ScriptKind.TSX : /\.(ts|mts|cts)$/.test(name) ? ts.ScriptKind.TS : ts.ScriptKind.JSX;
  const src = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, kind);
  const out = [];
  const visit = (node, fn) => {
    if (ts.isFunctionLike(node) && node.body) {
      const f = { name: node.name?.getText(src) || '(anonymous)', line: src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1, complexity: 1 };
      out.push(f);
      ts.forEachChild(node, (c) => visit(c, f));
      return;
    }
    if (fn && (DECISIONS.has(node.kind) || (ts.isBinaryExpression(node) && LOGICAL.has(node.operatorToken.kind)))) fn.complexity++;
    ts.forEachChild(node, (c) => visit(c, fn));
  };
  visit(src, null);
  return out;
}

export function metrics(dir) {
  let total = 0, over = 0, max = 0, count = 0, lines = 0;
  for (const f of files(dir)) {
    const text = readFileSync(join(dir, f), 'utf8');
    lines += text.split('\n').filter((l) => l.trim()).length;
    for (const fn of functions(text, f)) {
      count++; total += fn.complexity; max = Math.max(max, fn.complexity);
      if (fn.complexity > 10) over += fn.complexity;
    }
  }
  return { source_lines: lines, functions: count, complexity: total, max_complexity: max, erosion: total ? Math.round(1000 * over / total) / 1000 : 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(metrics(appFolder(process.argv[2]))));
