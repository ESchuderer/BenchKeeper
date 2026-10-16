// Documentation of an app: README coverage and accuracy, code documentation (TypeScript parser) and decision records.
// Own source = files() of erosion.mjs. A function counts when it is named (declaration, method, or a function or arrow bound
// to a variable, property or assignment); it is documented when a comment of any style (`/** */`, `/* */`, `//`) ends on the
// line before it or on its first line. Exported = `export` keyword, `export { }`, `export default name`, `module.exports`, `exports.x`.
// Usage: node bench/scorer/docs.mjs <app-dir>   prints JSON; needs `typescript` (bench/scorer/package.json)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { files } from './erosion.mjs';

const read = (p) => (existsSync(p) && statSync(p).isFile() ? readFileSync(p, 'utf8') : null);
const nonEmpty = (p) => (read(p) ?? '').trim().length > 0;

function walk(dir, depth = 4) {
  if (depth < 0) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (/^(node_modules|\.git)$/.test(e.name)) return [];
    const p = join(dir, e.name);
    return e.isDirectory() ? [{ p, dir: true }, ...walk(p, depth - 1)] : [{ p, dir: false }];
  });
}

export function decisionRecords(dir) {
  const all = walk(dir);
  const md = (e) => !e.dir && /\.md$/i.test(e.p) && nonEmpty(e.p);
  const inDir = (re) => all.some((e) => md(e) && relative(dir, dirname(e.p)).split('/').some((s) => re.test(s)));
  const adr = inDir(/^(adrs?|decisions?)$/i) || all.some((e) => md(e) && /^adr[-_]?\d+/i.test(e.p.split('/').pop()));
  const changelog = all.some((e) => !e.dir && /^(changelog|history|changes)(\.md)?$/i.test(e.p.split('/').pop()) && nonEmpty(e.p));
  const spec = inDir(/^(openspec|\.specify|specs)$/i) || all.some((e) => md(e) && /^(spec|plan|tasks)\.md$/i.test(e.p.split('/').pop()));
  return { adr, changelog, spec, count: [adr, changelog, spec].filter(Boolean).length };
}

// --- README
const NPM_BUILTIN_RUN = /npm\s+(?:run|run-script)\s+([\w:.-]+)/g;
const NPM_LIFECYCLE = /npm\s+(test|start|stop|restart)\b/g;
const PATHISH = /^\.{0,2}\/?[\w@.-]+(\/[\w@.*-]+)*\/?$/;
const EXT = /\.(js|mjs|cjs|json|html|css|md|svg|ts|png|jpe?g|ico)$/i;
const GENERATED = /^(node_modules|dist|build|coverage|\.git)(\/|$)/;

export function readmeAccuracy(dir, text) {
  const pkg = (() => { try { return JSON.parse(read(join(dir, 'package.json'))); } catch { return null; } })();
  const scripts = pkg?.scripts ?? {};
  const checks = [];
  const add = (what, ok) => checks.push({ what, ok });
  for (const m of text.matchAll(NPM_BUILTIN_RUN)) add(`npm run ${m[1]}`, m[1] in scripts);
  for (const m of text.matchAll(NPM_LIFECYCLE)) {
    const ok = m[1] === 'test' ? Boolean(scripts.test) && !/no test specified/.test(scripts.test) : m[1] === 'start' ? Boolean(scripts.start) || existsSync(join(dir, 'server.js')) : m[1] in scripts;
    add(`npm ${m[1]}`, ok);
  }
  const targets = new Set();
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) if (!/^([a-z][a-z0-9+.-]*:|#)/i.test(m[1])) targets.add(m[1].split('#')[0]);
  for (const m of text.matchAll(/`([^`\s]+)`/g)) {
    const t = m[1];
    if (PATHISH.test(t) && (t.includes('/') || EXT.test(t)) && !/^(text|application|image|audio|video)\//.test(t) && !GENERATED.test(t.replace(/^\.\//, ''))) targets.add(t);
  }
  for (const t of targets) {
    if (!t) continue;
    const base = t.includes('*') ? t.slice(0, t.indexOf('*')).replace(/[^/]*$/, '') : t;
    add(`path ${t}`, existsSync(join(dir, base || '.')));
  }
  const wrong = checks.filter((c) => !c.ok).map((c) => c.what);
  return { checked: checks.length, correct: checks.length - wrong.length, share: checks.length ? Math.round((1000 * (checks.length - wrong.length)) / checks.length) / 10 : null, wrong };
}

export function readmeCoverage(dir, text, sources) {
  const heads = [...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => m[1]);
  const head = (re) => heads.some((h) => re.test(h));
  const prose = text.split('\n').filter((l) => l.trim() && !/^(#|```|[-*|>\s]|\d+\.)/.test(l)).slice(0, 8).some((l) => l.trim().split(/\s+/).length >= 6);
  const names = [...new Set(sources.map((f) => f.split('/').pop()))];
  const mentioned = names.filter((n) => text.includes(n)).length;
  return {
    purpose: prose || head(/about|overview|purpose|description|introduction|what (is|it)/i),
    setup: head(/install|setup|set up|getting started|prerequisite|requirement|dependenc/i) || /npm\s+(ci|install|i)\b|no build( step)?|nothing to install/i.test(text),
    run: head(/\b(run|running|usage|start|serve|serving|open|launch)/i) || /npm\s+(run\s+)?start|http\.server|npx\s+(serve|http-server)|open\s+`?index\.html|in (a|your|the) browser/i.test(text),
    test: head(/test/i) || /npm\s+(run\s+)?test|node\s+--test/i.test(text),
    structure: head(/structure|layout|files|architecture|organi[sz]ation|folder|director|modules|code map/i) || mentioned >= Math.min(3, names.length),
    data_licence: /licen[cs]e|public domain|copyright|\bMIT\b|CC[- ]BY/i.test(text) && /C\.?I\.?P\.?|TDCC|data source|source of (the )?data|data\s+(is|are|comes?|from|taken|provided|originates)|dataset/i.test(text),
  };
}

// --- code documentation
function commentRanges(src, text) {
  const seen = new Map();
  const add = (rs) => rs?.forEach((r) => seen.set(r.pos, r));
  const visit = (n) => {
    add(ts.getLeadingCommentRanges(text, n.getFullStart()));
    add(ts.getTrailingCommentRanges(text, n.getEnd()));
    ts.forEachChild(n, visit);
  };
  visit(src);
  add(ts.getLeadingCommentRanges(text, src.endOfFileToken.getFullStart()));
  return [...seen.values()];
}

export function codeDocs(text, name) {
  const src = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  const comments = commentRanges(src, text);
  // Lines: blank out comments; what is left decides code line, else comment line.
  // UTF-16 code units, as the comment ranges are.
  const masked = text.split('');
  for (const c of comments) for (let i = c.pos; i < c.end; i++) if (masked[i] !== '\n') masked[i] = ' ';
  const orig = text.split('\n'), mk = masked.join('').split('\n');
  let code = 0, comment = 0;
  orig.forEach((l, i) => { if (mk[i].trim()) code++; else if (l.trim()) comment++; });

  const exported = new Set();
  const mark = (n) => { if (n) exported.add(n); };
  const hasExport = (n) => ts.canHaveModifiers(n) && ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  const objNames = (o) => o.properties?.forEach((p) => mark(p.name?.getText(src) ?? (ts.isShorthandPropertyAssignment(p) ? p.name.text : null)));
  src.forEachChild((s) => {
    if (ts.isExportDeclaration(s) && s.exportClause && ts.isNamedExports(s.exportClause)) s.exportClause.elements.forEach((e) => mark((e.propertyName ?? e.name).text));
    if (ts.isExportAssignment(s) && ts.isIdentifier(s.expression)) mark(s.expression.text);
    if (ts.isExpressionStatement(s) && ts.isBinaryExpression(s.expression) && s.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const l = s.expression.left.getText(src), r = s.expression.right;
      if (l === 'module.exports') { if (ts.isObjectLiteralExpression(r)) objNames(r); else if (ts.isIdentifier(r)) mark(r.text); }
      else if (/^(module\.)?exports\./.test(l)) mark(l.split('.').pop());
    }
  });

  const fns = [];
  const documented = (anchor) => {
    const rs = ts.getLeadingCommentRanges(text, anchor.getFullStart()) ?? [];
    const last = rs[rs.length - 1];
    return Boolean(last) && text.slice(last.end, anchor.getStart(src)).split('\n').length <= 2;
  };
  const visit = (n) => {
    if (ts.isFunctionDeclaration(n) && n.body && n.name) fns.push({ anchor: n, name: n.name.text, exp: hasExport(n) || exported.has(n.name.text) });
    else if ((ts.isMethodDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n) || ts.isConstructorDeclaration(n)) && n.body) {
      const c = n.parent, cn = ts.isClassLike(c) ? c.name?.text : null;
      fns.push({ anchor: n, name: n.name?.getText(src) ?? 'constructor', exp: ts.isClassDeclaration(c) && (hasExport(c) || Boolean(cn && exported.has(cn))) });
    } else if ((ts.isFunctionExpression(n) || ts.isArrowFunction(n))) {
      const p = n.parent;
      if (ts.isVariableDeclaration(p) && p.initializer === n && ts.isIdentifier(p.name)) {
        const st = p.parent.parent;
        fns.push({ anchor: ts.isVariableStatement(st) ? st : p, name: p.name.text, exp: (ts.isVariableStatement(st) && hasExport(st)) || exported.has(p.name.text) });
      } else if (ts.isPropertyAssignment(p) && p.initializer === n) fns.push({ anchor: p, name: p.name.getText(src), exp: false });
      else if (ts.isPropertyDeclaration(p) && p.initializer === n) fns.push({ anchor: p, name: p.name.getText(src), exp: false });
      else if (ts.isBinaryExpression(p) && p.right === n && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isExpressionStatement(p.parent)) {
        const l = p.left.getText(src);
        fns.push({ anchor: p.parent, name: l, exp: /^(module\.)?exports\b/.test(l) });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  const marked = fns.map((f) => ({ exp: f.exp, doc: documented(f.anchor) }));
  return { functions: marked.length, documented: marked.filter((f) => f.doc).length, exported: marked.filter((f) => f.exp).length,
    exported_documented: marked.filter((f) => f.exp && f.doc).length, code_lines: code, comment_lines: comment };
}

export function docs(dir) {
  const readme = [read(join(dir, 'README.md')), read(join(dir, 'readme.md')), read(join(dir, 'README'))].find((t) => t !== null) ?? null;
  const sources = files(dir);
  const sum = { functions: 0, documented: 0, exported: 0, exported_documented: 0, code_lines: 0, comment_lines: 0 };
  for (const f of sources) for (const [k, v] of Object.entries(codeDocs(readFileSync(join(dir, f), 'utf8'), f))) sum[k] += v;
  const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
  return {
    readme: readme && readme.trim() ? { coverage: readmeCoverage(dir, readme, sources), accuracy: readmeAccuracy(dir, readme) } : null,
    code: { ...sum, documented_share: pct(sum.documented, sum.functions), exported_share: pct(sum.exported_documented, sum.exported),
      comments_per_100_code_lines: sum.code_lines ? Math.round((1000 * sum.comment_lines) / sum.code_lines) / 10 : null },
    decisions: decisionRecords(dir),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(docs(process.argv[2])));
