/**
 * @file scripts/check-docs.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Check documentation coverage, local links, backtick repository paths, asset syntax
 *   and package help parity, and report catalog rows checked before their source last changed.
 * @structure Git file inventory, catalog validation, links, backtick paths and data syntax,
 *   duplicate check, catalog staleness report (a warning, never a failure).
 * @usage pnpm check:docs
 * @version-history
 *   v1.4.0 - 2026-11-15 - Every catalog row says how it stays true: "checked YYYY-MM-DD" (compared
 *     with its source's last commit, as before) or "held by <check>" with a test, a check script or a
 *     ledger as its source (never compared: the holder fails when the file goes wrong). A row with
 *     neither fails, unless it is historical. 64 of 115 date warnings came from holders' own files
 *     changing for reasons that left the docs true, and 40 undated rows could not warn at all.
 *   v1.3.1 - 2026-10-12 - PENDING_ELSEWHERE is gone, the list and the code that read it: a waiting
 *     list in a gate is a standing way to silence a finding, and a dead reference in a file another
 *     session is editing is fixed by that session before its own push, as check-doc-links.ts does.
 *   v1.3.0 - 2026-10-12 - A repository path quoted in backticks outside a fenced block must exist,
 *     as a link must (the docs audit of 2026-10-11 found five dead ones the link check never read).
 *     A catalog row whose "checked YYYY-MM-DD" is older than its source file's last commit is listed
 *     as a warning with a count; it does not fail. Rules in scripts/lib/doc-rules.mjs.
 *   v1.2.0 - 2026-10-11 - docs/archive/ is gone (ruling D6): a file under docs/archive/ or docs/plans/
 *     is refused, and the history notice is required of every file the catalog marks historical,
 *     wherever it is, instead of every file in the archive.
 *   v1.1.0 - 2026-10-03 - The person help prompt's two copies must agree too.
 *   v1.0.0 - 2026-09-16 - Track both documentation trees and distinguish history from guidance.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';
import { backtickPathProblems, catalogRows, staleCatalogRows } from './lib/doc-rules.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = path => readFileSync(resolve(ROOT, path), 'utf8').replace(/\r\n/g, '\n');
const errors = [];
const warnings = [];
let tracked = null;
/** Every file git tracks, read once: a backtick path must name one, or a directory above one. */
function trackedFiles() {
  tracked ??= new Set(execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean));
  return tracked;
}
/** Whether git ignores a path: a local file a reader makes (aimeat/.env, node_modules), not a dead one. */
function isIgnored(path) {
  try {
    execFileSync('git', ['check-ignore', '-q', '--no-index', '--', path], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false; // exit status 1: not ignored
  }
}
const statuses = new Set(['maintained', 'runtime', 'reference', 'historical', 'entry']);
const files = [...new Set(execFileSync('git', [
  'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'docs', 'aimeat/docs',
], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean))]
  .filter(path => existsSync(resolve(ROOT, path))).sort();
const catalog = new Map();
// Every row says how it stays true, in one of two ways. "checked YYYY-MM-DD" names the day someone
// read the file against its source; a source that changed after that day is a warning below. "held
// by <check>" names a test, a check script or a ledger that already fails when the file goes wrong
// (a loader test for a runtime asset, the it-adoption ledger), so a date would only repeat what the
// holder knows and warn whenever the holder's own file changed. A historical file is never updated
// and needs neither.
const HOLDER = /^aimeat\/(test|scripts|security)\//;
let heldRows = 0;
for (const line of read('docs/catalog.md').split('\n')) {
  const match = line.match(/^\| \[([^\]]+)\]\([^)]+\) \| ([^|]+) \| ([^|]+) \| `([^`]+)` \|$/);
  if (!match) continue;
  const [, path, rawStatus, purpose, source] = match;
  const status = rawStatus.trim();
  if (catalog.has(path)) errors.push(`Duplicate catalog entry: ${path}`);
  if (!statuses.has(status)) errors.push(`Unknown status for ${path}: ${status}`);
  if (!existsSync(resolve(ROOT, source))) errors.push(`Missing source for ${path}: ${source}`);
  const dated = /checked \d{4}-\d{2}-\d{2}/i.test(purpose);
  const held = /\bheld by\b/i.test(purpose);
  if (held) {
    heldRows++;
    if (dated) errors.push(`Catalog row both dated and held: ${path} (a held row takes its date from its holder; drop "checked …")`);
    if (!HOLDER.test(source)) errors.push(`Catalog row held by something that is not a test, a check or a ledger: ${path} (${source})`);
  } else if (!dated && status !== 'historical') {
    errors.push(`Catalog row says neither when it was checked nor what holds it: ${path} (write "checked YYYY-MM-DD" or "held by <check>")`);
  }
  catalog.set(path, status);
}
for (const path of files) if (!catalog.has(path)) errors.push(`Unclassified file: ${path}`);
for (const path of catalog.keys()) if (!files.includes(path)) errors.push(`Catalog names absent file: ${path}`);

// Fenced examples can contain Markdown-shaped regexes and hypothetical paths.
function withoutFences(content) {
  let fence = null;
  return content.split('\n').map(line => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      return '';
    }
    return fence ? '' : line;
  }).join('\n');
}

for (const path of files) {
  const content = read(path);
  if (path.endsWith('.json')) {
    try { JSON.parse(content); } catch (error) { errors.push(`${path}: ${error.message}`); }
  }
  if (/\.ya?ml$/.test(path)) {
    for (const error of parseDocument(content).errors) errors.push(`${path}: ${error.message}`);
  }
  if (!path.endsWith('.md')) continue;
  // Plans, design specs and build notes live on the node (CLAUDE.md, "Two ways of working"); the
  // repository's archive and plans folders were removed on 2026-10-11 and do not come back.
  if (/^docs\/(archive|plans)\//.test(path)) {
    errors.push(`${path}: plans and build notes live in the development organism on the node, not in docs/`);
  }
  // A file the catalog keeps as history says so at its top, so nobody follows it as current guidance.
  if (catalog.get(path) === 'historical' && !content.includes('> Historical document.')) {
    errors.push(`History notice missing: ${path} (the catalog marks it historical)`);
  }
  // Historical links are part of the evidence and may refer to removed source files.
  if (catalog.get(path) === 'historical') continue;
  for (const match of withoutFences(content).matchAll(/!?\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    let target = match[1].split(/\s+"/)[0].replace(/^<|>$/g, '');
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.includes('{{')) continue;
    // Root paths without a tracked documentation prefix are routes on the target node.
    if (target.startsWith('/') && !/^\/(?:docs|aimeat)\//.test(target)) continue;
    target = target.split(/[?#]/)[0];
    if (!target) continue;
    try { target = decodeURIComponent(target); } catch { errors.push(`${path}: malformed link ${target}`); continue; }
    const destination = target.startsWith('/') ? resolve(ROOT, target.slice(1)) : resolve(ROOT, dirname(path), target);
    const rel = relative(ROOT, destination);
    if (rel.startsWith('..') || isAbsolute(rel) || !existsSync(destination)) errors.push(`${path}: missing local link ${target}`);
  }
  // A path in backticks is a reference too, and a reader follows it the same way.
  for (const problem of backtickPathProblems({ path, content, tracked: trackedFiles(), ignored: isIgnored })) {
    errors.push(`${path}:${problem.line}: \`${problem.ref}\` ${problem.reason}`);
  }
}

// The node reads its help prompts from docs/ in the repository and from aimeat/docs/ in the package.
for (const file of ['AIMEAT_Help_Prompt.md', 'AIMEAT_Help_Prompt_Person.md']) {
  if (read(`docs/${file}`) !== read(`aimeat/docs/${file}`)) {
    errors.push(`${file} differs between docs/ and aimeat/docs/. Update both copies together.`);
  }
}
// A row that says when it was checked, against a source file that changed after that day, is a guide
// someone should read again. Reported and counted; a changed source often leaves its guide true.
const lastChange = path => execFileSync('git', ['log', '-1', '--format=%cs', '--', path], { cwd: ROOT, encoding: 'utf8' }).trim() || null;
const rows = catalogRows(read('docs/catalog.md'));
const stale = staleCatalogRows(rows, { isFile: path => trackedFiles().has(path), lastChange });
const dated = rows.filter(row => row.checked).length;
for (const row of stale) warnings.push(`Catalog row checked ${row.checked}, source changed ${row.changed}: ${row.path} (${row.source})`);
if (warnings.length) console.warn(warnings.join('\n'));
console.log(`Catalog: ${dated} of ${rows.length} rows say when they were checked, ${heldRows} are held by a test, a check or a ledger; ${stale.length} dated rows predate their source's last commit (warning only).`);

if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`Documentation check failed: ${errors.length} problem(s).`);
  process.exitCode = 1;
} else {
  const counts = [...statuses].map(status => `${status}: ${[...catalog.values()].filter(s => s === status).length}`);
  console.log(`Documentation structure checked: ${files.length} files (${counts.join(', ')}).`);
}
