/**
 * @file test/unit/git-head.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description readGitHead() against the layouts git actually writes: a branch with its own ref
 *   file, a detached head, a ref that lives only in packed-refs, a linked worktree whose `.git` is a
 *   file, and no checkout at all. Each layout is built in a temp directory by hand, because the
 *   reader never runs git and the test must not either. The last case reads this repository itself
 *   and compares with `git rev-parse HEAD`, the one place the two are allowed to meet.
 * @usage pnpm exec vitest run test/unit/git-head.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-11 — Initial.
 */
import { describe, expect, it, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGitHead } from '../../src/utils/git-head.js';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const root = mkdtempSync(join(tmpdir(), 'aimeat-git-head-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function put(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf-8');
}

describe('the commit a checkout is on, from git\'s own files', () => {
  it('a branch whose ref is a file of its own', () => {
    const repo = join(root, 'branch');
    put(join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    put(join(repo, '.git', 'refs', 'heads', 'main'), `${A}\n`);
    expect(readGitHead(repo)).toBe(A);
  });

  it('is found from a directory deep inside the checkout', () => {
    const deep = join(root, 'branch', 'aimeat', 'src', 'utils');
    mkdirSync(deep, { recursive: true });
    expect(readGitHead(deep)).toBe(A);
  });

  it('a detached head is the commit itself', () => {
    const repo = join(root, 'detached');
    put(join(repo, '.git', 'HEAD'), `${B}\n`);
    expect(readGitHead(repo)).toBe(B);
  });

  it('a ref that git has packed is read from packed-refs', () => {
    const repo = join(root, 'packed');
    put(join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    put(join(repo, '.git', 'packed-refs'), `# pack-refs with: peeled fully-peeled sorted\n${B} refs/heads/other\n${A} refs/heads/main\n`);
    expect(readGitHead(repo)).toBe(A);
  });

  it('a linked worktree: .git is a file, HEAD is in its own directory, the branch is in the common one', () => {
    const main = join(root, 'wt-main');
    const linked = join(root, 'wt-linked');
    const own = join(main, '.git', 'worktrees', 'linked');
    put(join(main, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    put(join(main, '.git', 'refs', 'heads', 'main'), `${A}\n`);
    put(join(main, '.git', 'refs', 'heads', 'feature'), `${B}\n`);
    put(join(own, 'HEAD'), 'ref: refs/heads/feature\n');
    put(join(own, 'commondir'), '../..\n');
    put(join(linked, '.git'), `gitdir: ${own}\n`);
    expect(readGitHead(linked)).toBe(B);
    expect(readGitHead(main)).toBe(A);
  });

  it('answers null outside a checkout, and for a ref nothing resolves', () => {
    const none = join(root, 'none', 'deep');
    mkdirSync(none, { recursive: true });
    // The temp directory itself may sit inside nothing; nine levels up from here there is no .git.
    expect(readGitHead(none)).toBeNull();
    const broken = join(root, 'broken');
    put(join(broken, '.git', 'HEAD'), 'ref: refs/heads/gone\n');
    expect(readGitHead(broken)).toBeNull();
    const garbage = join(root, 'garbage');
    put(join(garbage, '.git', 'HEAD'), 'not a head\n');
    expect(readGitHead(garbage)).toBeNull();
  });

  it('agrees with git on this repository', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    let expected: string;
    try { expected = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: here, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch { return; } // no git on this machine, or an export without .git: nothing to compare with
    expect(readGitHead(here)).toBe(expected);
  });
});
