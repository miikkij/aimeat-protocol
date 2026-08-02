/**
 * @file scripts/write-build-stamp.mjs
 * @description Stamp dist/ with the identity of the source it was built from, so a stale build can
 *   announce itself instead of silently behaving like an older commit. Written as the last step of
 *   `pnpm build`, after tsc, so the recorded state is the state that actually got compiled.
 *
 *   This exists because the failure it detects has landed three times: the node was right, the
 *   source was right, and the artifact the consumer actually ran was older than the merge — a new
 *   optional field simply vanished on the way through. `dist/` is gitignored, so nothing about it
 *   shows up in git status; nothing tells you it is behind.
 *
 *   The stamp records `newest_source_mtime` rather than only a commit, because the common case is
 *   not a wrong commit — it is an edited-but-unbuilt tree, which no commit hash can see. Comparing
 *   source mtime against source mtime (rather than against a wall clock) keeps the check honest
 *   across filesystems and timezones.
 *
 *   Plain .mjs on purpose, matching vendor-libs.mjs: it runs inside `pnpm build`, which must work
 *   without tsx on a production install.
 * @structure newestMtime(dir) → walk; gitCommit() → HEAD + dirty flag; main() → write dist/build-stamp.json
 * @usage node scripts/write-build-stamp.mjs   # the `build` script runs this after tsc
 * @version-history
 *   v1.0.0 — 2026-08-02 — Initial build stamp (stale-dist detection for `aimeat connect serve`).
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Directories whose contents end up compiled or copied into dist/. */
const SOURCE_DIRS = ['src', 'bin', 'scripts'];

/**
 * Newest mtime (epoch ms) across a directory tree, or 0 when it does not exist.
 * Symlinks are not followed: a linked-in tree is not this package's source.
 */
function newestMtime(dir) {
  let newest = 0;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  // eslint-disable-next-line aimeat/no-silent-catch -- unreadable dir contributes nothing
  catch { return 0; }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestMtime(full));
    } else if (entry.isFile()) {
      try { newest = Math.max(newest, statSync(full).mtimeMs); }
      // eslint-disable-next-line aimeat/no-silent-catch -- vanished mid-walk; nothing to record
      catch { /* vanished mid-walk */ }
    }
  }
  return newest;
}

/** HEAD sha + whether the tree is dirty, or nulls outside a git checkout (npm tarball, CI export). */
function gitState() {
  const run = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    return { commit: run(['rev-parse', 'HEAD']), dirty: run(['status', '--porcelain']).length > 0 };
  // eslint-disable-next-line aimeat/no-silent-catch -- not a git checkout; the stamp is still useful
  } catch { return { commit: null, dirty: null }; }
}

function main() {
  const distDir = join(ROOT, 'dist');
  if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });

  let version = 'unknown';
  try { version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).version ?? 'unknown'; }
  // eslint-disable-next-line aimeat/no-silent-catch -- version is descriptive only; the stamp still works
  catch { /* keep 'unknown' */ }

  const newest = Math.max(...SOURCE_DIRS.map((d) => newestMtime(join(ROOT, d))));
  const { commit, dirty } = gitState();

  const stamp = {
    schema_version: 1,
    version,
    commit,
    dirty,
    built_at: new Date().toISOString(),
    // Epoch ms of the newest source file at build time. The freshness check re-scans and compares
    // against this: anything newer was written after the compiler read the tree.
    newest_source_mtime: Number.isFinite(newest) ? newest : 0,
    source_dirs: SOURCE_DIRS,
  };

  writeFileSync(join(distDir, 'build-stamp.json'), `${JSON.stringify(stamp, null, 2)}\n`, 'utf-8');
  const short = commit ? commit.slice(0, 8) + (dirty ? '-dirty' : '') : 'no-git';
  console.log(`[build-stamp] v${version} ${short} — dist/build-stamp.json written`);
}

main();
