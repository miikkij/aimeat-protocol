/**
 * @file scripts/check-datapackage-pointer-reads.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The gate for a data package's audience: who may read a package is decided on the
 *   service-owned record (`trustedAudienceOf` in src/services/datapackage/audience-record.ts), never
 *   on the package's `latest.json` pointer.
 *
 *   WHY. The pointer is an ordinary storage file. POST /v1/storage writes it for any principal with
 *   storage:write, so an app of the owner can set `visibility: 'public'` on it with neither the
 *   publish gate nor a label cap asked. Round 10 of secaudit2026oct31w2 moved every read onto the
 *   record; the merge of main that followed brought a new read (GET /v1/pub, services/datapackage/
 *   file-read.ts) that decided on the pointer again and opened a private CSV to anyone (fixed in
 *   d75ad0ca2). Jouni approved this gate on 2026-11-01 so the same read cannot come back a third time.
 *
 *   WHAT IT READS. Every `.ts` file under src/ except the record's own module (HOME), src/static and
 *   src/generated, parsed with the compiler, so a comment that talks about `latest.json` is not a
 *   finding. Two shapes:
 *     pointer-visibility  `.visibility` read off a pointer: a variable or parameter typed
 *                         LatestPointer, one set from readPointer(…), readLatestPointer(…) or
 *                         `… as LatestPointer`, or an expression whose last name is `pointer`, `latest`
 *                         or `ptr`. Anywhere in src/, the datapackage service included.
 *     pointer-source      outside src/services/datapackage/: a call to readPointer, readLatestPointer
 *                         or latestKey, or a string that names `/latest.json`. The service is the one
 *                         place that reads the pointer; a reader elsewhere says why it decides nothing.
 *
 *   ALLOWED names the places that are right as they are, per file, by the expression's own text,
 *   with the sentence that says why: the pointer is read for display, freshness or the write path, and
 *   the audience it shows is the record's. An entry is a decision, not a way around the gate: a new
 *   read fails, and so does an entry whose expression is gone.
 * @structure
 *   - pointerFindings(file, source): the findings in one file (pure)
 *   - compareWithAllowed(found, allowed): new findings and stale entries (pure)
 *   - ALLOWED: file → { expression text → why it is right }
 *   - main(): walk src/, report; exit 1 on a new finding or a stale entry
 * @usage
 *   cd aimeat && pnpm check:datapackage-pointer-reads          # the gate
 *   cd aimeat && pnpm check:datapackage-pointer-reads --list   # every finding, allowed or not
 * @version-history
 *   v1.0.3 — 2026-11-01 — routes/datapackages.ts no longer reads the pointer: the schema.org block is built
 *     by services/datapackage/landing-page.ts, inside the service (WP9b).
 *   v1.0.2 — 2026-11-01 — The ten DEBT entries are gone: withdraw.ts, dataspace/catalog.ts,
 *     dataproduct/sources-io.ts, parties/shares.ts and exchange-datapackage.ts decide on the service's
 *     records (trustedPackageOf, saleTermsOf) and read no pointer (WP9e, cc-jouni-dataulos).
 *   v1.0.1 — 2026-11-01 — ALLOWED: the on-change source key (dataproduct/on-change.ts) and the visitor read's
 *     pointer handed to trustedAudienceOf (routes/package-reader.ts) (WP9c, cc-jouni-dataulos).
 *   v1.0.0 — 2026-11-01 — Initial (secaudit2026oct31w2, after round 10; approved by Jouni 2026-11-01).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The record's own module: it reads the pointer to build the record and to answer before the record exists. */
const HOME = 'src/services/datapackage/audience-record.ts';
const SERVICE = 'src/services/datapackage/';

export interface Finding { line: number; shape: string; text: string }

const POINTER_CALLS = new Set(['readPointer', 'readLatestPointer']);
const SOURCE_CALLS = new Set(['readPointer', 'readLatestPointer', 'latestKey']);
const POINTER_NAMES = new Set(['pointer', 'latest', 'ptr']);

function unwrap(node: ts.Node): ts.Node {
  let cur = node;
  while (ts.isParenthesizedExpression(cur) || ts.isNonNullExpression(cur) || ts.isAwaitExpression(cur)) {
    cur = cur.expression;
  }
  return cur;
}

/** The name a call is made by: `readPointer(…)` and `x.readPointer(…)` alike. */
function calleeName(node: ts.CallExpression): string {
  const e = node.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return '';
}

/** Does an initializer hold a pointer: readPointer(…), readLatestPointer(…), `… as LatestPointer`, `x ?? y` of those. */
function holdsPointer(init: ts.Expression | undefined): boolean {
  if (!init) return false;
  const n = unwrap(init);
  if (ts.isBinaryExpression(n) && (n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    || n.operatorToken.kind === ts.SyntaxKind.BarBarToken)) return holdsPointer(n.left) || holdsPointer(n.right);
  if (ts.isConditionalExpression(n)) return holdsPointer(n.whenTrue) || holdsPointer(n.whenFalse);
  if (ts.isAsExpression(n)) return /\bLatestPointer\b/.test(n.type.getText()) || holdsPointer(n.expression);
  return ts.isCallExpression(n) && POINTER_CALLS.has(calleeName(n));
}

function typedPointer(type: ts.TypeNode | undefined): boolean {
  return !!type && /\bLatestPointer\b/.test(type.getText());
}

/**
 * Every place one file decides on, or reads, a package's pointer. Pure: a path and its text in,
 * findings out, in source order.
 */
export function pointerFindings(file: string, source: string): Finding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const outside = !file.startsWith(SERVICE);
  // Names imported from the datapackage service. Another module's own `latestKey` (app tool
  // interfaces, workspace documents) is not a package pointer.
  const fromService = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (!/(^|\/)datapackage\//.test(st.moduleSpecifier.text)) continue;
    const named = st.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) for (const el of named.elements) fromService.add(el.name.text);
  }
  // A name like `latest` or `pointer` means a package pointer only in code that deals with packages:
  // the service itself, or a file that imports from it. A workspace record's `.latest` is not one.
  const packageCode = !outside || fromService.size > 0;
  const found: Finding[] = [];
  const add = (node: ts.Node, shape: string): void => {
    found.push({
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      shape,
      text: node.getText(sf).replace(/\s+/g, ' ').slice(0, 160),
    });
  };

  // Names that hold a pointer in this file: declared with the type, or set from a pointer read.
  const held = new Set<string>();
  const collect = (node: ts.Node): void => {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isPropertySignature(node)) && ts.isIdentifier(node.name)) {
      const init = ts.isVariableDeclaration(node) || ts.isParameter(node) ? node.initializer : undefined;
      if (typedPointer(node.type) || holdsPointer(init)) held.add(node.name.text);
    }
    ts.forEachChild(node, collect);
  };
  collect(sf);

  const isPointerExpr = (expr: ts.Expression): boolean => {
    const n = unwrap(expr);
    if (ts.isIdentifier(n)) return held.has(n.text) || (packageCode && POINTER_NAMES.has(n.text));
    if (ts.isPropertyAccessExpression(n)) return held.has(n.name.text) || (packageCode && POINTER_NAMES.has(n.name.text));
    return holdsPointer(n as ts.Expression);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'visibility' && isPointerExpr(node.expression)) {
      add(node, 'pointer-visibility');
    } else if (outside && ts.isCallExpression(node) && SOURCE_CALLS.has(calleeName(node)) && fromService.has(calleeName(node))) {
      add(node, 'pointer-source');
    } else if (outside && ts.isStringLiteralLike(node) && node.text.includes('/latest.json')) {
      add(node, 'pointer-source');
    } else if (outside && ts.isTemplateExpression(node)
      && [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].some((t) => t.includes('/latest.json'))) {
      add(node, 'pointer-source');
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** A finding's key in ALLOWED: the expression's own text. */
export const keyOf = (f: Finding): string => f.text;

export interface Verdict {
  fresh: { file: string; finding: Finding }[];
  stale: { file: string; text: string }[];
  empty: { file: string; text: string }[];
  allowedHits: number;
}

/** Findings no entry allows, and entries no finding needs. Pure. */
export function compareWithAllowed(found: Map<string, Finding[]>, allowed: Record<string, Record<string, string>>): Verdict {
  const verdict: Verdict = { fresh: [], stale: [], empty: [], allowedHits: 0 };
  const has = (o: Record<string, string>, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
  for (const [file, list] of found) {
    for (const finding of list) {
      if (allowed[file] && has(allowed[file], keyOf(finding))) verdict.allowedHits++;
      else verdict.fresh.push({ file, finding });
    }
  }
  for (const [file, entries] of Object.entries(allowed)) {
    const texts = new Set((found.get(file) ?? []).map(keyOf));
    for (const [text, why] of Object.entries(entries)) {
      if (!texts.has(text)) verdict.stale.push({ file, text });
      if (!why.trim()) verdict.empty.push({ file, text });
    }
  }
  return verdict;
}

/**
 * The places that are right as they are: file → { the expression's text → why }.
 * Each sentence says why the pointer read decides nobody's access.
 */
export const ALLOWED: Record<string, Record<string, string>> = {
  // ── Inside the service: the pointer's word is replaced by the record's, or shown only ──
  'src/services/datapackage/audience.ts': {
    'pointer?.visibility': 'versionOpenTo\'s `pointer` parameter is trustedAudienceOf(…).pointer at every caller (file-read.ts, store.ts openPackage and the version list), so this is the recorded audience.',
  },
  'src/services/datapackage/store.ts': {
    'pointer.visibility': 'recordFailure keeps the pointer file\'s own tier only for a package with no published version (no content hash, no rows); listPackages compares it with the recorded audience and lists the recorded one.',
  },
  'src/services/datapackage/odps-read.ts': {
    'pointer.visibility': 'The audience written on the ODPS sheet of a version the caller already opened through openPackage, which decided on the record; it selects text, not access.',
  },

  // ── Outside the service: the pointer is read for display, freshness or the record's own input ──
  'src/services/publish-requests/apply-datapackage.ts': {
    'readPointer(ctx, ownerGhii, name)': 'Tells a deleted package and hands the pointer to trustedAudienceOf; the version, the audience and the answered address are the record\'s.',
  },
  'src/services/discovery/sources/dataset-source.ts': {
    'readPointer(deps, facts.ownerGhii, facts.name)': 'Read after the audience filter for freshness (updatedAt, lastError) and the withdrawn mark; it opens nothing the filter refused.',
  },
  'src/services/dataproduct/service.ts': {
    'readPointer(ctx.deps, ctx.caller.ownerGhii, name)': 'Tells whether a data product\'s package exists (delete answer, failure note) and shows its pointer to the product\'s own caller; it opens nothing.',
    'pointer.visibility': 'Shown to the data product\'s own caller beside its definition; display only, no read decides on it.',
  },
  'src/services/dataproduct/list-facts.ts': {
    'readPointer(deps, ownerGhii, name)': 'The owner\'s own list facts per data product (version, update time, freshness); display to the owner, it opens nothing.',
    'pointer.visibility': 'Shown in the owner\'s own list facts; display only, no read decides on it.',
  },
  'src/services/dataspace/owner.ts': {
    'readPointer(ctx.deps, ctx.caller.ownerGhii, pkg)': 'Tells whether the owner has the package before the owner\'s own auto-agree setting for it is stored; it opens nothing.',
  },
  'src/services/dataproduct/scheduled-job.ts': {
    '`datapkg/${name}/latest.json`': 'Names the key a scheduled data product run writes, for the scheduler\'s reads and writes list; it decides nothing.',
  },
  'src/services/dataproduct/on-change.ts': {
    'latestKey(s.name!)': 'Names the storage key a source package\'s new version writes, so a data product that runs on a change listens for it; it reads nothing and decides no access.',
  },
  'src/routes/package-reader.ts': {
    'readPointer(deps, ownerGhii, opts.name)': 'Hands the pointer straight to trustedAudienceOf, which decides on the record once the audience rule is in force; the visitor read takes trusted.visibility.',
  },
  'src/services/anonymous-principal-records.ts': {
    "'/latest.json'": 'Finds the anonymous account\'s packages by their pointer key for the operator\'s list of what that account holds; it shows the file\'s tier and decides no access.',
  },
};

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(path.join(ROOT, dir)).sort()) {
    const rel = `${dir}/${name}`;
    if (statSync(path.join(ROOT, rel)).isDirectory()) {
      if (rel === 'src/static' || rel === 'src/generated') continue;
      walk(rel, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.d.ts') && rel !== HOME) {
      out.push(rel);
    }
  }
}

function main(): void {
  const list = process.argv.includes('--list');
  const files: string[] = [];
  walk('src', files);
  const found = new Map<string, Finding[]>();
  let total = 0;
  for (const file of files) {
    const hits = pointerFindings(file, readFileSync(path.join(ROOT, file), 'utf8'));
    if (!hits.length) continue;
    found.set(file, hits);
    total += hits.length;
  }
  const verdict = compareWithAllowed(found, ALLOWED);
  if (list) {
    const fresh = new Set(verdict.fresh.map(({ file, finding }) => `${file}:${finding.line}:${finding.text}`));
    for (const [file, hits] of found) {
      for (const f of hits) {
        const ok = !fresh.has(`${file}:${f.line}:${f.text}`);
        console.log(`${ok ? 'allowed' : 'NEW    '}  ${file}:${f.line}  ${f.shape}  ${f.text}`);
      }
    }
  }
  console.log(`Data package pointer reads: ${files.length} files read; ${total} found, ${verdict.allowedHits} allowed, `
    + `${verdict.fresh.length} new, ${verdict.stale.length} stale.`);
  if (verdict.fresh.length) {
    console.error('');
    console.error('A data package\'s audience is decided on the service-owned record: trustedAudienceOf() in');
    console.error('src/services/datapackage/audience-record.ts. The latest.json pointer is a storage file an app can');
    console.error('write, so its `visibility` decides nothing. If this place reads the pointer for display, freshness or');
    console.error('the write path, add its expression to ALLOWED in scripts/check-datapackage-pointer-reads.ts with the');
    console.error('sentence that says why.');
    for (const { file, finding } of verdict.fresh) console.error(`  ${file}:${finding.line}  ${finding.shape}  ${finding.text}`);
  }
  if (verdict.stale.length) {
    console.error('');
    console.error('ALLOWED names an expression the file no longer has; delete the entry:');
    for (const { file, text } of verdict.stale) console.error(`  ${file}  ${text}`);
  }
  for (const { file, text } of verdict.empty) console.error(`  ${file}  ${text}: an ALLOWED entry without a reason`);
  if (verdict.fresh.length || verdict.stale.length || verdict.empty.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
