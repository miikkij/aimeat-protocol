/**
 * @file src/utils/git-head.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The commit a checkout is on, read from the files git keeps, with no `git` process.
 *   For a node that runs from source (tsx, no dist/ and so no build stamp): /v1/build can still
 *   say which commit is checked out.
 *
 *   WHAT IT READS. `.git/HEAD` is either a commit id (a detached head) or `ref: refs/heads/<name>`.
 *   The ref is a file with the commit id, or a line of `packed-refs` once git has packed it. In a
 *   linked worktree `.git` is a FILE that says `gitdir: <path>`; HEAD is in that directory, and the
 *   branch refs are in the directory its `commondir` file names.
 *
 *   WHAT IT DOES NOT SAY. Whether the working tree has uncommitted changes: that needs git itself.
 *   A caller that shows this commit says so (utils/build-stamp.ts reports `dirty: null`).
 * @structure readGitHead(startDir): string | null
 * @usage const commit = readGitHead(dirname(fileURLToPath(import.meta.url)));
 * @version-history
 *   v1.0.0 — 2026-10-11 — Initial (wish-ajossa-olevan-koodin-commit-n-kyviin-nodesta).
 */
import { readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const COMMIT_ID = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** A file's text, or null when it is not there: every file here is optional in some layout. */
function textOf(path: string): string | null {
  try { return readFileSync(path, 'utf-8'); }
  // eslint-disable-next-line aimeat/no-silent-catch -- an absent git file is one of the layouts, and the caller tries the next
  catch { return null; }
}

/** Whether `path` is a directory, a file, or absent. */
function kindOf(path: string): 'dir' | 'file' | null {
  try { return statSync(path).isDirectory() ? 'dir' : 'file'; }
  // eslint-disable-next-line aimeat/no-silent-catch -- absent means "not at this level", and the walk goes one level up
  catch { return null; }
}

/** The commit id `ref` points at, from its own file in either directory or from packed-refs. */
function resolveRef(gitDir: string, commonDir: string, ref: string): string | null {
  for (const base of new Set([gitDir, commonDir])) {
    const loose = textOf(join(base, ref))?.trim();
    if (loose && COMMIT_ID.test(loose)) return loose;
  }
  for (const line of (textOf(join(commonDir, 'packed-refs')) ?? '').split('\n')) {
    const [id, name] = line.trim().split(' ');
    if (name === ref && COMMIT_ID.test(id)) return id;
  }
  return null;
}

/** The commit HEAD is on in the git directory behind `gitPath` (`.git` as a directory or as a file). */
function headOf(gitPath: string, kind: 'dir' | 'file'): string | null {
  let gitDir = gitPath;
  if (kind === 'file') {
    const named = /^gitdir:\s*(.+)$/m.exec(textOf(gitPath) ?? '')?.[1]?.trim();
    if (!named) return null;
    gitDir = isAbsolute(named) ? named : resolve(dirname(gitPath), named);
  }
  const head = textOf(join(gitDir, 'HEAD'))?.trim();
  if (!head) return null;
  if (COMMIT_ID.test(head)) return head;
  const ref = /^ref:\s*(.+)$/.exec(head)?.[1]?.trim();
  if (!ref) return null;
  const common = textOf(join(gitDir, 'commondir'))?.trim();
  const commonDir = common ? (isAbsolute(common) ? common : resolve(gitDir, common)) : gitDir;
  return resolveRef(gitDir, commonDir, ref);
}

/**
 * The commit id of the checkout that holds `startDir`, or null when it is in no checkout (an npm
 * install) or the files do not say. Looks for `.git` in `startDir` and up to eight levels above.
 */
export function readGitHead(startDir: string): string | null {
  let dir = startDir;
  for (let level = 0; level < 9; level++) {
    const gitPath = join(dir, '.git');
    const kind = kindOf(gitPath);
    if (kind) return headOf(gitPath, kind);
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}
