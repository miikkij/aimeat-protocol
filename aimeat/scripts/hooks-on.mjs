#!/usr/bin/env node
/**
 * @file scripts/hooks-on.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Turns the repository's git hooks on: `git config core.hooksPath .githooks`, run by
 *   this package's "prepare" script on `pnpm install` in aimeat/.
 *
 *   WHY HERE TOO. The root package.json's prepare already does this, but the documented worktree
 *   recipe and the WorktreeCreate hook install in aimeat/ only, so a clone set up that way never ran
 *   it: core.hooksPath stayed unset, no pre-commit, commit-msg or pre-push hook ran, and nothing said
 *   so (QA audit 2026-10-16, P2-07). The setting lives in the clone's shared config, so one install
 *   in any worktree turns the hooks on for all of them.
 *
 *   NEVER FAILS AN INSTALL. Outside this repository (a Docker build, the desktop stage, a copy with
 *   no .githooks beside it) it does nothing. npm does not run "prepare" for a package installed from
 *   the registry, so an operator's install never reaches this file.
 * @usage node scripts/hooks-on.mjs     (pnpm install runs it)
 * @version-history
 *   v1.0.0 -- 2026-10-16 -- Initial (QA audit W09, P2-07).
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
try {
    if (existsSync(join(repo, '.githooks', 'pre-commit')) && existsSync(join(repo, '.git'))) {
        const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        let current = '';
        try { current = git('config', '--get', 'core.hooksPath'); } catch { current = ''; }
        if (current !== '.githooks') {
            git('config', 'core.hooksPath', '.githooks');
            console.log(`hooks-on: git hooks turned on (core.hooksPath .githooks, was ${current || 'unset'})`);
        }
    }
} catch (e) {
    console.warn(`hooks-on: could not turn the git hooks on (${e instanceof Error ? e.message : String(e)}). Run: git config core.hooksPath .githooks`);
}
