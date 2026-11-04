#!/usr/bin/env node
/**
 * @file scripts/check-rewritten-history.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Refuses a push that carries a rewritten history of main back to GitHub.
 *
 *   WHY. Main's history was rewritten on 2026-11-04 to take organisation data out of a public
 *   repository. Every checkout made before that still held the old history, and an hour later one
 *   session merged it into its branch and pushed: GitHub accepted it, since a merge on top of the
 *   new main is a fast-forward, and 26 old commit messages were public again. GitHub refuses only a
 *   plain push of the old history; a merge or a rebase of an old branch gets through.
 *
 *   security/rewritten-history.txt names the first commit of each rewritten history. A pushed commit
 *   that descends from one of them is refused, for everybody: there is no reason to push it. A root
 *   this clone never had cannot be in what it pushes, and is skipped.
 * @usage
 *   node scripts/check-rewritten-history.mjs < refs     # the pre-push hook passes its stdin
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const git = (a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const has = (sha) => { try { git(['cat-file', '-e', `${sha}^{commit}`]); return true; } catch { return false; } };
const descends = (root, tip) => { try { git(['merge-base', '--is-ancestor', root, tip]); return true; } catch { return false; } };

const listFile = fileURLToPath(new URL('../security/rewritten-history.txt', import.meta.url));
const roots = readFileSync(listFile, 'utf8').split(/\r?\n/)
    .map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    .map(l => ({ sha: l.split(/\s+/)[0], why: l.split(/\s+/).slice(1).join(' ') }))
    .filter(r => has(r.sha));

const stdin = process.stdin.isTTY ? '' : readFileSync(0, 'utf8');
const tips = stdin.split(/\r?\n/).map(l => l.trim().split(/\s+/)[1]).filter(s => s && !/^0+$/.test(s));
if (!tips.length) tips.push('HEAD');

const found = [];
for (const tip of tips) for (const r of roots) if (descends(r.sha, tip)) found.push({ tip, ...r });
if (found.length) {
    console.error('[pre-push] this push carries a history of main that was rewritten and must not reach GitHub again:');
    for (const f of found) console.error(`  ${f.tip.slice(0, 12)} descends from ${f.sha.slice(0, 12)} (${f.why})`);
    console.error('Start from the current main and bring over only your own commits: git fetch origin, git checkout --detach origin/main, then git cherry-pick <each of your commits>. Never merge or rebase a branch that began before the rewrite.');
    process.exit(1);
}
