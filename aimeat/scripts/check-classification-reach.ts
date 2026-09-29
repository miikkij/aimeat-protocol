/**
 * @file scripts/check-classification-reach.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The gate that keeps stored content from reaching a caller around the classification
 *   check (TARGET-082, spec §13.2, decided by Jouni 2026-09-29: "Tee yksi komponentti mitä käytetään
 *   useammassa kohtaa tarkistus mukaan lukien ettei synny duplikaatti patheja").
 *
 *   WHAT IT READS. Every `.ts` file under src/ except the storage layer itself, the browser code and
 *   the generated types, parsed with the compiler, so a comment or a string that names a method is
 *   not a finding. A finding is a call to one of the storage methods that load CONTENT (memory values
 *   and keys, stored files, workspace rows) on a receiver named `storage`, or to one of the service
 *   wrappers that load the same content across an owner's identities (getOwnerScopeMemory,
 *   listOwnerScopeMemory, and the memory service's owner-scope reads on `memoryDb`).
 *
 *   WHAT IT HOLDS. security/classification-reach.json names every file that makes such calls, how
 *   many of each, and why: either the reads pass the classification reader, or the read is the
 *   node's own (a setting, a key, a manifest) and says so. A new file with a content read fails, a
 *   file whose count grew fails, and a line whose count fell or whose file stopped reading fails as
 *   stale, so the list only moves on purpose and the backlog only shrinks.
 *
 *   THE SEED. The list was seeded on 2026-09-29, when the loaders of V1 took the reader. A seeded
 *   line says it was not yet reviewed; converting a file to a loader that takes a reader, or writing
 *   why its read is the node's own, is how a line changes.
 * @structure CONTENT_READS · WRAPPER_READS · MEMORY_DB_READS · findingsOf(source) · compare() · main()
 * @usage
 *   cd aimeat && pnpm check:classification-reach            # the gate
 *   cd aimeat && pnpm check:classification-reach --shrink   # lower counts that fell; nothing else
 *   cd aimeat && pnpm check:classification-reach --seed     # rewrite from the tree, keeping reasons
 * @version-history
 *   v1.1.0 — 2026-09-29 — TARGET-082 review: counts the reads the seed missed (listMemoryHistory,
 *     listDeletedMemory, listAllDeletedMemory, listMemoryKeysByPrefix, readStorageFileRange,
 *     listStorageFilesForOwners) and the download-token mint (generateDownloadToken), and a memory
 *     service read on `this.memoryDb` / `deps.memoryDb` as well as on a bare `memoryDb`.
 *   v1.0.0 — 2026-09-29 — Initial (TARGET-082 V1).
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const LIST = path.join(ROOT, 'security', 'classification-reach.json');

/**
 * Storage methods that load content a caller could be shown. The second group (2026-09-29 review)
 * are the reads the first seed missed: a record's earlier versions, the bin, the key list under a
 * prefix, a file's bytes by range, and the files of several owners at once.
 */
export const CONTENT_READS = new Set([
  'getMemory', 'getMemoryByKeys', 'getMemoryByKeysAnyOwner', 'listMemory', 'listMemoryMeta',
  'listMemoryForOwners', 'listMemoryMetaForOwners', 'listAllMemory', 'listAllMemoryMeta',
  'searchText', 'searchMemory', 'getStorageFile', 'getStorageFileMeta', 'listStorageFiles',
  'listWorkspaceRows', 'getWorkspaceRow',
  'listMemoryHistory', 'listDeletedMemory', 'listAllDeletedMemory', 'listMemoryKeysByPrefix',
  'readStorageFileRange', 'listStorageFilesForOwners',
]);

/**
 * The service wrappers that load the same content across an owner's identities. A call to one is a
 * content read just as a storage call is, so a caller cannot step around the gate through them.
 * Free functions by name; the memory service's methods on a receiver named `memoryDb`.
 *
 * `generateDownloadToken` is here because a minted download token hands a file's bytes to whoever
 * holds it, later and without asking again: the mint is the read, so the file passes the reader first.
 */
export const WRAPPER_READS = new Set(['getOwnerScopeMemory', 'listOwnerScopeMemory', 'generateDownloadToken']);
export const MEMORY_DB_READS = new Set(['getOwnerScope', 'listOwnerScope', 'listOwnerScopeMeta', 'searchOwnerScope']);

const SKIP_DIRS = new Set([path.join(SRC, 'storage'), path.join(SRC, 'static'), path.join(SRC, 'generated')]);

const SEED_WHY = 'Seeded 2026-09-29 before the gate existed; not yet reviewed. Move the read into a loader that takes a classification reader, or write why the read is the node\'s own.';

type Counts = Record<string, number>;
interface Entry { reads: Counts; why: string }
interface ListFile { about: string; files: Record<string, Entry> }

/** `name.x(`, `deps.name.x(`, `this.name.x(`: the receiver's last name is `name`. */
function receiverIsNamed(expr: ts.Expression, name: string): boolean {
  if (ts.isIdentifier(expr)) return expr.text === name;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text === name;
  return false;
}

/** `storage.x(`, `deps.storage.x(`, `this.storage.x(`: the receiver's last name is `storage`. */
function receiverIsStorage(expr: ts.Expression): boolean {
  return receiverIsNamed(expr, 'storage');
}

/** The content reads in one file's source, counted by method. */
export function findingsOf(fileName: string, source: string): Counts {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const counts: Counts = {};
  const count = (m: string): void => { counts[m] = (counts[m] ?? 0) + 1; };
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (ts.isPropertyAccessExpression(callee)) {
        const m = callee.name.text;
        if (CONTENT_READS.has(m) && receiverIsStorage(callee.expression)) count(m);
        else if (MEMORY_DB_READS.has(m) && receiverIsNamed(callee.expression, 'memoryDb')) count(`memoryDb.${m}`);
      } else if (ts.isIdentifier(callee) && WRAPPER_READS.has(callee.text)) {
        count(callee.text);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return counts;
}

function walk(dir: string, out: string[]): void {
  if (SKIP_DIRS.has(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(p);
  }
}

/** Every file with a content read, keyed by its path from the package root with forward slashes. */
export function scanTree(): Record<string, Counts> {
  const files: string[] = [];
  walk(SRC, files);
  const out: Record<string, Counts> = {};
  for (const f of files) {
    const counts = findingsOf(f, readFileSync(f, 'utf8'));
    if (Object.keys(counts).length) out[path.relative(ROOT, f).split(path.sep).join('/')] = counts;
  }
  return out;
}

export interface Problems { added: string[]; grew: string[]; stale: string[] }

/** What the tree does that the list does not allow, and what the list allows that is gone. */
export function compare(found: Record<string, Counts>, listed: Record<string, Entry>): Problems {
  const p: Problems = { added: [], grew: [], stale: [] };
  for (const [file, counts] of Object.entries(found)) {
    const entry = listed[file];
    if (!entry) { p.added.push(`${file}: ${JSON.stringify(counts)}`); continue; }
    for (const [m, n] of Object.entries(counts)) {
      const allowed = entry.reads[m] ?? 0;
      if (n > allowed) p.grew.push(`${file}: ${m} ${allowed} → ${n}`);
      else if (n < allowed) p.stale.push(`${file}: ${m} ${allowed} → ${n}`);
    }
    for (const [m, allowed] of Object.entries(entry.reads)) {
      if (!(m in counts) && allowed > 0) p.stale.push(`${file}: ${m} ${allowed} → 0`);
    }
  }
  for (const file of Object.keys(listed)) if (!(file in found)) p.stale.push(`${file}: no content read any more`);
  return p;
}

function readList(): ListFile {
  try { return JSON.parse(readFileSync(LIST, 'utf8')) as ListFile; }
  catch { return { about: '', files: {} }; }
}

const ABOUT = 'Every file under src/ that calls a storage method loading content (memory, files, workspace rows), how many calls of each, and why. The reads either pass the classification reader (services/classification/, TARGET-082) or are the node\'s own. pnpm check:classification-reach fails on a new file, a count that grew, and a line that is stale; --shrink lowers the counts that fell. Reasoning: aimeat/scripts/check-classification-reach.ts.';

function write(list: ListFile): void {
  const files = Object.fromEntries(Object.entries(list.files).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(LIST, JSON.stringify({ about: ABOUT, files }, null, 2) + '\n');
}

function main(): void {
  const found = scanTree();
  const list = readList();
  const mode = process.argv.includes('--seed') ? 'seed' : process.argv.includes('--shrink') ? 'shrink' : 'check';

  if (mode === 'seed') {
    const files: Record<string, Entry> = {};
    for (const [file, counts] of Object.entries(found)) files[file] = { reads: counts, why: list.files[file]?.why ?? SEED_WHY };
    write({ about: ABOUT, files });
    console.log(`classification-reach: seeded ${Object.keys(files).length} files.`);
    return;
  }

  const p = compare(found, list.files);
  if (mode === 'shrink') {
    if (p.added.length || p.grew.length) {
      console.error('classification-reach: --shrink only lowers counts; the tree has new or grown reads:');
      for (const l of [...p.added, ...p.grew]) console.error(`  ${l}`);
      process.exit(1);
    }
    const files: Record<string, Entry> = {};
    for (const [file, entry] of Object.entries(list.files)) {
      if (!(file in found)) continue;
      files[file] = { reads: found[file], why: entry.why };
    }
    write({ about: ABOUT, files });
    console.log(`classification-reach: ${p.stale.length} line(s) lowered.`);
    return;
  }

  const total = Object.keys(found).length;
  if (!p.added.length && !p.grew.length && !p.stale.length) {
    console.log(`classification-reach: ${total} files read content; every read is listed with its reason.`);
    return;
  }
  if (p.added.length) {
    console.error('NEW content reads outside the list. Load through a loader that takes a classification reader (services/workspace-content.ts, services/ai-inputs.ts, services/file-refs.ts, services/classification/present-memory.ts), or add the file with why its read is the node\'s own:');
    for (const l of p.added) console.error(`  ${l}`);
  }
  if (p.grew.length) {
    console.error('More content reads than listed:');
    for (const l of p.grew) console.error(`  ${l}`);
  }
  if (p.stale.length) {
    console.error('Stale lines (a read went away; run --shrink to lower them):');
    for (const l of p.stale) console.error(`  ${l}`);
  }
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
