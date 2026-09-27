/**
 * @file scripts/check-migration-hashes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A Postgres migration file that is on main never changes. The runner applies each file
 *   once and records its NAME (providers/postgres-kysely/migrate.ts), so a database that applied a
 *   file keeps what that version did, and a changed file reaches only the databases that have not
 *   run it yet: two databases then hold two different results under one name. A change goes into a
 *   new file, and a file that must not run any more is superseded (migrate.ts SUPERSEDED).
 *
 *   TWO CHECKS, because the first alone can be passed by changing a file and its line together:
 *   1. Every file under the migrations directory is listed in security/migration-hashes.json, and its
 *      sha256 matches its line. A new file is listed in the same commit (`--add` writes its line).
 *   2. When origin/main can be read and is not HEAD: every migration file on origin/main is still in
 *      the tree with the same bytes, and every line of origin/main's manifest is still there,
 *      unchanged. The manifest only grows. Without git, or without origin/main, or on origin/main
 *      itself, this check is skipped with one line saying so, never failed.
 *   Line ends are read as LF: git stores these files with LF, and a Windows working copy may give
 *   the reader CRLF, which is not a change to the file.
 * @structure
 *   - sha256Of(bytes) — the hash of one file, line ends read as LF
 *   - migrationFindings(head, base) — both checks, pure: two trees in, a list out
 *   - readBase(git, dir, manifestPath) — origin/main's files and manifest, through an injected git
 *   - main() — the gate (`pnpm check:migration-hashes`), and `--add` for a new file's line
 * @usage
 *   cd aimeat && pnpm check:migration-hashes          # the gate (in check:fast)
 *   cd aimeat && pnpm check:migration-hashes --add    # list a new migration file
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial, with the manifest seeded from the files on main, 0085 as it is.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AIMEAT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(AIMEAT, '..');

/** Both paths from the repository root, as git names them. */
export const MIGRATIONS_DIR = 'aimeat/src/storage/providers/postgres-kysely/migrations';
export const MANIFEST = 'aimeat/security/migration-hashes.json';

const ABOUT = 'The sha256 of every Postgres migration file, by file name. A file on main never changes: '
  + 'the runner records only the name of a file it applied, so a changed file would leave two databases with '
  + 'two results under one name. pnpm check:migration-hashes fails on a changed or removed file, on a line '
  + 'changed or removed, and on a file with no line. A new file gets its line in the same commit: '
  + 'pnpm check:migration-hashes --add. A file that must not run any more is superseded by a new one '
  + '(src/storage/providers/postgres-kysely/migrate.ts SUPERSEDED). Reasoning: aimeat/scripts/check-migration-hashes.ts.';

/** A set of migration files, by file name, and the manifest that lists them. */
export interface MigrationTree {
  files: Map<string, Buffer>;
  manifest: Record<string, string>;
}

export interface Finding {
  kind: 'changed' | 'unlisted' | 'removed' | 'changed-on-main' | 'removed-from-main' | 'manifest-changed' | 'manifest-removed';
  file: string;
  detail: string;
}

/** Runs git with the given arguments and returns what it wrote; throws when git fails or is missing. */
export type GitRunner = (args: string[]) => Buffer;

/** The sha256 of a file's text, with its line ends read as LF. */
export function sha256Of(bytes: Buffer): string {
  return createHash('sha256').update(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

/** The file lines of a manifest's text. */
export function parseManifest(text: string): Record<string, string> {
  const parsed = JSON.parse(text) as { files?: Record<string, string> };
  return parsed.files ?? {};
}

/** Both checks. `base` is origin/main's files and manifest, or null when the second check is skipped. */
export function migrationFindings(head: MigrationTree, base: MigrationTree | null): Finding[] {
  const out: Finding[] = [];
  for (const [file, bytes] of head.files) {
    const listed = head.manifest[file];
    if (!listed) {
      out.push({ kind: 'unlisted', file, detail: `has no line in ${MANIFEST}. List it in the same commit: pnpm check:migration-hashes --add` });
    } else if (listed !== sha256Of(bytes)) {
      out.push({ kind: 'changed', file, detail: 'its bytes are not the ones its line records. A migration file does not change: put the change in a new file.' });
    }
  }
  for (const file of Object.keys(head.manifest)) {
    if (!head.files.has(file)) out.push({ kind: 'removed', file, detail: 'is listed but not in the migrations directory. A migration file stays; one that must not run is superseded (migrate.ts SUPERSEDED).' });
  }
  if (!base) return out;
  for (const [file, bytes] of base.files) {
    const now = head.files.get(file);
    if (!now) out.push({ kind: 'removed-from-main', file, detail: 'is on origin/main and not in this tree.' });
    else if (sha256Of(now) !== sha256Of(bytes)) out.push({ kind: 'changed-on-main', file, detail: 'differs from the file on origin/main. A migration file on main does not change: put the change in a new file.' });
  }
  for (const [file, hash] of Object.entries(base.manifest)) {
    if (!(file in head.manifest)) out.push({ kind: 'manifest-removed', file, detail: 'has a line in the manifest on origin/main that this tree removed. The manifest only grows.' });
    else if (head.manifest[file] !== hash) out.push({ kind: 'manifest-changed', file, detail: 'has a line that differs from the one on origin/main. The manifest only grows.' });
  }
  return out;
}

/**
 * origin/main's migration files and manifest, or why the second check is skipped: no git, no
 * origin/main, or HEAD is origin/main (CI on main), where there is nothing to compare with.
 */
export function readBase(git: GitRunner, dir: string = MIGRATIONS_DIR, manifestPath: string = MANIFEST): { base: MigrationTree | null; skipped?: string } {
  let head: string;
  try {
    head = git(['rev-parse', '--verify', '--quiet', 'HEAD']).toString('utf8').trim();
  } catch (err) {
    return { base: null, skipped: `git could not be run (${(err as Error).message.split('\n')[0]}), so the files were not compared with origin/main` };
  }
  let main: string;
  try {
    main = git(['rev-parse', '--verify', '--quiet', 'origin/main^{commit}']).toString('utf8').trim();
  } catch (err) {
    return { base: null, skipped: `there is no origin/main here (${(err as Error).message.split('\n')[0]}), so the files were not compared with it` };
  }
  if (main === head) return { base: null, skipped: 'HEAD is origin/main, so there is nothing to compare it with' };

  const files = new Map<string, Buffer>();
  const listed = git(['ls-tree', '--name-only', 'origin/main', '--', `${dir}/`]).toString('utf8').split('\n').map(s => s.trim()).filter(Boolean);
  for (const p of listed) {
    if (p.endsWith('.sql')) files.set(path.posix.basename(p), git(['show', `origin/main:${p}`]));
  }
  let manifest: Record<string, string> = {};
  try {
    manifest = parseManifest(git(['show', `origin/main:${manifestPath}`]).toString('utf8'));
  } catch (err) {
    // origin/main has no manifest before the commit that adds it; its files are still compared above.
    console.log(`check:migration-hashes: origin/main has no manifest to compare with (${(err as Error).message.split('\n')[0]}).`);
  }
  return { base: { files, manifest } };
}

/** The migration files and the manifest in this working tree. */
function readTree(): MigrationTree {
  const dir = path.join(REPO, MIGRATIONS_DIR);
  const files = new Map<string, Buffer>();
  for (const f of readdirSync(dir).filter(n => n.endsWith('.sql')).sort()) files.set(f, readFileSync(path.join(dir, f)));
  const manifestFile = path.join(REPO, MANIFEST);
  return { files, manifest: existsSync(manifestFile) ? parseManifest(readFileSync(manifestFile, 'utf8')) : {} };
}

function main(): void {
  const head = readTree();
  if (process.argv.includes('--add')) {
    // Lists a file that has no line. A line that exists is never rewritten here.
    const added = [...head.files].filter(([file]) => !head.manifest[file]);
    const files: Record<string, string> = { ...head.manifest };
    for (const [file, bytes] of added) files[file] = sha256Of(bytes);
    const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(path.join(REPO, MANIFEST), `${JSON.stringify({ about: ABOUT, files: sorted }, null, 2)}\n`);
    console.log(`check:migration-hashes: ${added.length} file(s) listed${added.length ? `: ${added.map(([f]) => f).join(', ')}` : ''}.`);
    return;
  }
  const git: GitRunner = (args) => execFileSync('git', args, { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  const { base, skipped } = readBase(git);
  if (skipped) console.log(`check:migration-hashes: ${skipped}; the files were checked against the manifest only.`);
  const found = migrationFindings(head, base);
  console.log(`Migration files: ${head.files.size} in the tree, ${Object.keys(head.manifest).length} listed${base ? `, ${base.files.size} on origin/main` : ''}; ${found.length} finding(s).`);
  for (const f of found) console.error(`  ${f.kind}  ${f.file}  ${f.detail}`);
  if (found.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
