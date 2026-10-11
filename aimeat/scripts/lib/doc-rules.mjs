/**
 * @file scripts/lib/doc-rules.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two documentation rules for check:docs, kept apart so a unit test can call them.
 *   backtickPathProblems: a repository path quoted in backticks must exist, as a Markdown link must.
 *   The docs audit of 2026-10-11 found five dead references the link check never read, because they
 *   were code spans: two deleted plans, a deleted tunnel design and two gitignored internal notes.
 *   staleCatalogRows: a docs/catalog.md row that says "checked YYYY-MM-DD" and names a source file is
 *   stale when that file's last commit is newer than the date. It is a report, never a failure: a
 *   source changes for many reasons that leave its guide true, and only a reader can tell which.
 * @structure inlineCodeSpans, backtickPathProblems (with the path index it builds once per file
 *   list), catalogRows, staleCatalogRows.
 * @usage import { backtickPathProblems, staleCatalogRows } from './lib/doc-rules.mjs' (check-docs.mjs)
 * @version-history
 *   v1.0.0 - 2026-10-12 - Initial (docs audit phase 5b, "Pysyvät suojat").
 */

/** Notes kept outside the public tree. A public document that names one sends its reader nowhere. */
const PRIVATE_PREFIXES = ['docs/internal/', 'internal/'];

/**
 * Folders a document may name as a statement about the folder itself: docs/archive/ and docs/plans/
 * were removed and check-docs refuses any file under them (maintenance.md says so), and
 * docs/internal/ is local working material outside the public tree (docs/README.md says so). A FILE
 * path under any of them is still checked, so a dead plan or a private note is still caught.
 */
const FOLDER_STATEMENTS = new Set(['docs/archive/', 'docs/plans/', 'docs/internal/']);

/**
 * A path written as an example to copy, not a reference: one of its names starts with my-, your- or
 * example- (src/services/my-thing.ts, test/e2e-my-feature.ts).
 */
const EXAMPLE_NAME = /(?:^|[/._-])(?:my|your|example)[-_.]/i;

/** An extension manifest names its scripts as scripts/actions/<file>.js inside its own package. */
const PACKAGE_RELATIVE_PREFIXES = ['scripts/actions/'];

/** Lines of a Markdown text with every fenced block blanked, so line numbers still match. */
function blankFences(markdown) {
  let fence = null;
  return markdown.split('\n').map(line => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      return '';
    }
    return fence ? '' : line;
  });
}

/**
 * Single-backtick code spans outside fenced blocks.
 * @param {string} markdown
 * @returns {{ text: string, line: number }[]}
 */
export function inlineCodeSpans(markdown) {
  const spans = [];
  blankFences(markdown.replace(/\r\n/g, '\n')).forEach((line, index) => {
    for (const match of line.matchAll(/(?<!`)`([^`\n]+)`(?!`)/g)) spans.push({ text: match[1].trim(), line: index + 1 });
  });
  return spans;
}

/** @type {WeakMap<Set<string>, { dirs: Set<string>, rootTops: Set<string>, packageTops: Set<string> }>} */
const indexCache = new WeakMap();

/** Directories and first path segments of the tracked files, built once per file list. */
function indexOf(tracked) {
  let index = indexCache.get(tracked);
  if (index) return index;
  const dirs = new Set();
  const rootTops = new Set();
  const packageTops = new Set();
  for (const file of tracked) {
    const parts = file.split('/');
    rootTops.add(parts[0]);
    if (parts[0] === 'aimeat' && parts.length > 2) packageTops.add(parts[1]);
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  index = { dirs, rootTops, packageTops };
  indexCache.set(tracked, index);
  return index;
}

/**
 * The repository path a code span names, or null when the span is not a path: a placeholder, a
 * glob, a route, a URL, a scope, a bare file name or a name with no file extension (a lint rule).
 */
function pathOf(text, { rootTops, packageTops }) {
  if (/[\s<>{}*$…|[\]()=,"']|\.\.\./.test(text)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) || /^[/~.]/.test(text)) return null;
  const clean = text.replace(/(?::\d+(?:[-–,]\d+)*|#L\d+(?:-L?\d+)?)$/, '').replace(/[.,;:]+$/, '');
  if (!clean.includes('/') || EXAMPLE_NAME.test(clean)) return null;
  const first = clean.split('/')[0];
  const pathShaped = clean.endsWith('/') || /(?:^|\/)\.?[^/]*\.[A-Za-z0-9]+$/.test(clean) || /\/\.[^/]+$/.test(clean);
  if (!pathShaped) return null;
  if (PRIVATE_PREFIXES.some(prefix => clean.startsWith(prefix))) return clean;
  if (!rootTops.has(first) && !packageTops.has(first)) return null;
  return clean;
}

/**
 * Problems with the repository paths a document quotes in backticks.
 * @param {{ path: string, content: string, tracked: Set<string>, ignored: (path: string) => boolean }} input
 *   tracked: every file git tracks; ignored: whether git ignores a path (a local file a reader makes).
 * @returns {{ ref: string, line: number, reason: string }[]}
 */
export function backtickPathProblems({ content, tracked, ignored }) {
  const index = indexOf(tracked);
  const problems = [];
  for (const span of inlineCodeSpans(content)) {
    const ref = pathOf(span.text, index);
    if (!ref || FOLDER_STATEMENTS.has(ref)) continue;
    if (PRIVATE_PREFIXES.some(prefix => ref.startsWith(prefix))) {
      problems.push({ ref, line: span.line, reason: 'names a private note outside the public tree; a public reader cannot open it' });
      continue;
    }
    if (PACKAGE_RELATIVE_PREFIXES.some(prefix => ref.startsWith(prefix))) continue;
    const bare = ref.replace(/\/$/, '');
    const slash = ref.endsWith('/') ? '/' : '';
    const candidates = index.packageTops.has(bare.split('/')[0]) ? [bare, `aimeat/${bare}`] : [bare];
    // The tracked list answers almost every span; git is asked about ignored paths only after it.
    if (candidates.some(c => tracked.has(c) || index.dirs.has(c))) continue;
    if (candidates.some(c => ignored(c + slash))) continue;
    problems.push({ ref, line: span.line, reason: 'is not in the repository (checked at the root and under aimeat/)' });
  }
  return problems;
}

/**
 * The rows of docs/catalog.md, with the date a row says it was checked and its source path.
 * @param {string} markdown
 * @returns {{ path: string, checked: string | null, source: string }[]}
 */
export function catalogRows(markdown) {
  const rows = [];
  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const match = line.match(/^\| \[([^\]]+)\]\([^)]+\) \| [^|]+ \| ([^|]+) \| `([^`]+)` \|$/);
    if (!match) continue;
    const checked = match[2].match(/checked (\d{4}-\d{2}-\d{2})/i);
    rows.push({ path: match[1], checked: checked ? checked[1] : null, source: match[3] });
  }
  return rows;
}

/**
 * Rows checked before their source file last changed. A row with no date, or whose source is a
 * directory, says nothing a date can be compared with, and is left out.
 * @param {{ path: string, checked: string | null, source: string }[]} rows
 * @param {{ isFile: (path: string) => boolean, lastChange: (path: string) => string | null }} probe
 *   lastChange: the source's last commit date as YYYY-MM-DD.
 */
export function staleCatalogRows(rows, { isFile, lastChange }) {
  const stale = [];
  for (const row of rows) {
    if (!row.checked || !isFile(row.source)) continue;
    const changed = lastChange(row.source);
    if (changed && changed > row.checked) stale.push({ ...row, changed });
  }
  return stale;
}
