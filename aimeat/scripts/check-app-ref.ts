/**
 * @file scripts/check-app-ref.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The gate for one rule: how an app's name relates to its `.html` file is decided in
 *   src/services/app/app-ref.ts, and nowhere else.
 *
 *   WHY. An app is stored as `lifecycle-central.html` and everybody names it `lifecycle-central`.
 *   Until 2026-11-20 about forty places added or removed the extension each in its own way, two of
 *   them as private copies of the same rule, and the endpoints that did neither refused the name a
 *   person and an AI actually use. app-ref.ts now holds the rule (appDisplayName, appDataMapId,
 *   appFilenameCandidates, resolveAppFilename, publishFilename) and the inputs call it. This gate keeps
 *   a new copy from being written.
 *
 *   WHAT IT READS. Every `.ts` file under src/ except app-ref.ts itself, src/static (browser code)
 *   and generated files, parsed with the compiler, so a comment or a plain string is not a finding:
 *     html-regex      a regular expression literal that matches `.html` or `.htm`
 *     ends-with-html  x.endsWith('.html') or ('.htm')
 *     adds-html       `${x}.html` or x + '.html'
 *
 *   ALLOWED names the places that are right as they are, per file, by the expression's own text,
 *   with the sentence that says why: a node page that is a real `.html` file, a URL path test, the
 *   app template's own browser code. A new finding fails, and so does an entry whose expression is gone.
 * @structure appRefFindings(file, source) · compareWithAllowed(found, allowed) · ALLOWED · main()
 * @usage
 *   cd aimeat && pnpm check:app-ref          # the gate
 *   cd aimeat && pnpm check:app-ref --list   # every finding, allowed or not
 * @version-history
 *   v1.0.1 — 2026-11-22 — The content-access-gate entry follows its pattern, which lost app-catalog
 *     with the old /app-catalog.html.
 *   v1.0.0 — 2026-11-20 — Initial (wish-sovelluksen-nimi-ilman-html-p-tett-kaikkialla).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The rule's home. */
const HOME = 'src/services/app/app-ref.ts';

export interface Finding { line: number; shape: string; text: string }

const HTML_IN_REGEX = /\\\.html?|\\\.htm/;

/** Every place one file decides on `.html` by itself. Pure: a path and its text in, findings out. */
export function appRefFindings(file: string, source: string): Finding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: Finding[] = [];
  const add = (node: ts.Node, shape: string): void => {
    found.push({
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      shape,
      text: node.getText(sf).replace(/\s+/g, ' ').slice(0, 160),
    });
  };
  const isHtmlLiteral = (n: ts.Node | undefined): boolean =>
    !!n && ts.isStringLiteralLike(n) && /^\.html?$/i.test(n.text);

  const visit = (node: ts.Node): void => {
    if (ts.isRegularExpressionLiteral(node) && HTML_IN_REGEX.test(node.text)) {
      add(node, 'html-regex');
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'endsWith' && isHtmlLiteral(node.arguments[0])) {
      add(node, 'ends-with-html');
    } else if (ts.isTemplateExpression(node)) {
      const spans = node.templateSpans;
      if (spans.some(s => /^\.html?(?![\w-])/i.test(s.literal.text))) add(node, 'adds-html');
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken && isHtmlLiteral(node.right)) {
      add(node, 'adds-html');
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** New findings (not in ALLOWED) and stale entries (in ALLOWED, no longer found). Pure. */
export function compareWithAllowed(
  found: Map<string, Finding[]>, allowed: Record<string, Record<string, string>>,
): { fresh: Array<{ file: string } & Finding>; stale: Array<{ file: string; text: string }> } {
  const fresh: Array<{ file: string } & Finding> = [];
  const stale: Array<{ file: string; text: string }> = [];
  for (const [file, list] of found) {
    const ok = allowed[file] ?? {};
    for (const f of list) if (!(f.text in ok)) fresh.push({ file, ...f });
  }
  for (const [file, entries] of Object.entries(allowed)) {
    const texts = new Set((found.get(file) ?? []).map(f => f.text));
    for (const text of Object.keys(entries)) if (!texts.has(text)) stale.push({ file, text });
  }
  return { fresh, stale };
}

/**
 * The places that are right as they are. The key is the expression's text as the finding prints it.
 * Seeded on 2026-11-20 with every finding left after the move to app-ref.ts, each read and answered.
 */
export const ALLOWED: Record<string, Record<string, string>> = {
  'src/middleware/content-access-gate.ts': {
    '/^\\/(spa|app-silent)\\.html$/': 'The node\'s own pages, real files under public/, not app names.',
    '/^\\/(everything|start|index\\.html)$/': 'The node\'s own pages, real files under public/, not app names.',
    '/^\\/([^/]+\\/[^/]+\\.html?)?$/i': 'A URL test on the app host for a members-only node: only the .html path is opened without a session. Widening it to any two-segment path would open /v1/... there; the short /<owner>/<name> path asks for a sign-in on such a node, and the app\'s subdomain serves it.',
  },
  'src/services/appdev/kb-quality.ts': {
    '/\\b[a-z0-9][a-z0-9_-]*\\/[a-z0-9][a-z0-9_.-]*\\.html\\b/i': 'A text search, not an app reference: a pitfall report whose words name one app\'s file is kept private (the app field app_ref is the other signal). Nothing is resolved or opened by it.',
  },
  'src/routes/bootstrap.ts': {
    '`${base}.html`': 'The node\'s own static front page and its Finnish copy, real files under public/.',
  },
  'src/routes/portal.ts': {
    '/^(.+)\\.([a-z]{2})\\.html$/': 'The node\'s own localised static pages (privacy.fi.html), real files under public/.',
    '`${wanted[1]}.html`': 'The node\'s own localised static pages, real files under public/.',
    '/\\.([a-z]{2})\\.html$/': 'The node\'s own localised static pages, real files under public/.',
    '`privacy.${l}.html`': 'The node\'s own localised static page.',
    '`terms.${l}.html`': 'The node\'s own localised static page.',
    '`connect.${l}.html`': 'The node\'s own localised static page.',
  },
  'src/services/ai/gen-rules.ts': {
    '/^[a-z0-9][a-z0-9._-]{0,99}\\/[a-z0-9][a-z0-9._-]{0,150}\\.html$/i': 'Validates the stored form after the inputs resolved the name (services/app/app-ref-inputs.ts aimeat_ai_gen_rules_set and PUT /v1/ai/gen-rules); a bare name that is still bare names no published app.',
  },
  'src/services/company/company-page-key.ts': {
    '/^company\\/([^/]+)\\/index\\.html$/': 'A company page\'s storage path, a real file name, not an app name.',
  },
  'src/services/design-book/grown-genre.ts': {
    '/^[a-z0-9][a-z0-9._-]{0,120}\\.html$/i': 'Validates the stored form after the inputs resolved the name (aimeat_designbook_propose, POST /v1/designbook); a bare name that is still bare names no published app.',
  },
  'src/services/design-book/kit.ts': {
    '/^[a-z0-9][a-z0-9._-]{0,120}\\.html$/i': 'Validates the stored form after the inputs resolved the name (aimeat_designbook_propose, POST /v1/designbook); a bare name that is still bare names no published app.',
  },
};

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'static' || name === 'generated' || name === 'node_modules') continue;
      walk(p, out);
    } else if (p.endsWith('.ts') && !p.endsWith('.d.ts') && !/\.generated\.ts$/.test(p) && !/__tests__/.test(p)) {
      out.push(p);
    }
  }
}

function main(): void {
  const list = process.argv.includes('--list');
  const files: string[] = [];
  walk(path.join(ROOT, 'src'), files);
  const found = new Map<string, Finding[]>();
  for (const abs of files) {
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    if (rel === HOME) continue;
    const f = appRefFindings(rel, readFileSync(abs, 'utf8'));
    if (f.length) found.set(rel, f);
  }
  if (list) {
    for (const [file, fs] of found) for (const f of fs) console.log(`${file}:${f.line}  ${f.shape}  ${f.text}`);
    return;
  }
  const { fresh, stale } = compareWithAllowed(found, ALLOWED);
  if (fresh.length === 0 && stale.length === 0) {
    console.log(`✓ check:app-ref — every app-name/.html decision is in ${HOME} or answered in ALLOWED.`);
    return;
  }
  for (const f of fresh) {
    console.log(`✗ ${f.file}:${f.line}  ${f.shape}  ${f.text}`);
  }
  if (fresh.length) {
    console.log(`\n${fresh.length} new place(s) decide on .html by themselves. Use ${HOME} (appDisplayName,`
      + ' appDataMapId, appFilenameCandidates, resolveAppFilename, publishFilename), or, for a real .html page'
      + ' or a URL test, answer it in ALLOWED in scripts/check-app-ref.ts with the reason.');
  }
  for (const s of stale) console.log(`✗ stale ALLOWED entry: ${s.file}  ${s.text}`);
  if (stale.length) console.log(`\n${stale.length} ALLOWED entr(y/ies) name an expression that is gone: delete them.`);
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
