/**
 * @file scripts/lib/watch-digest.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The digest a review ledger keeps of the code a document describes, shared by
 *   check:it-adoption and check:feature-list. A ledger entry names `watches`: repository paths, each
 *   a file or a directory. A file is read as it stands on disk. A directory means every file git
 *   tracks under it, so a new file added to the folder (once staged) changes the digest as surely as
 *   an edit does; an untracked scratch file or a build output beside them does not. The digest is a
 *   sha256 over "path hash" lines in path order, with CRLF folded to LF, so a checkout on Windows
 *   and one on Linux agree.
 *
 *   WHY DIRECTORIES ARE TRACKED FILES. The SIEM exporter landed in src/services/node-admin/ on
 *   2026-11-15 and page 10 of the IT adoption package kept saying the node had none: the page
 *   watched two files, and the new code was in neither. Watching the folder is what catches that,
 *   and reading git's list rather than the disk keeps the folder's digest the same in every clean
 *   checkout.
 * @structure trackedFiles() · filesOfWatch(watch) · digestOf(watches) · readRepoFile(rel)
 * @usage
 *   import { digestOf } from './lib/watch-digest.js';
 *   const { digest, files, missing } = digestOf(REPO, ['aimeat/src/services/node-admin', 'aimeat/src/utils/logger.ts']);
 * @version-history
 *   v1.0.0 -- 2026-11-19 -- Initial: moved out of check-it-adoption.ts, a directory now digests the
 *     files git tracks under it, and check:feature-list uses the same digest.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const trackedCache = new Map<string, string[]>();

/** Every path git tracks in the repository at `repo`, sorted, with forward slashes. Read once per run. */
export function trackedFiles(repo: string): string[] {
    let list = trackedCache.get(repo);
    if (!list) {
        list = execFileSync('git', ['ls-files', '-z'], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
            .split('\0').filter(Boolean).sort();
        trackedCache.set(repo, list);
    }
    return list;
}

/** A repository file's text with line endings folded. */
export function readRepoFile(repo: string, rel: string): string {
    return readFileSync(join(repo, rel), 'utf8').replace(/\r\n/g, '\n');
}

/**
 * The files one watch stands for: the file itself when it is a file on disk, or every tracked file
 * under it that is still on disk when it is a directory. Empty when the path is gone.
 */
export function filesOfWatch(repo: string, watch: string): string[] {
    const full = join(repo, watch);
    if (!existsSync(full)) return [];
    if (!statSync(full).isDirectory()) return [watch];
    const prefix = watch.replace(/\/+$/, '') + '/';
    return trackedFiles(repo).filter(f => f.startsWith(prefix) && existsSync(join(repo, f)));
}

/** The digest of the watched files, in a stable order, with line endings folded. */
export function digestOf(repo: string, watches: string[]): { digest: string; files: Record<string, string>; missing: string[] } {
    const files: Record<string, string> = {};
    const missing: string[] = [];
    for (const watch of watches) {
        const found = filesOfWatch(repo, watch);
        if (!found.length) missing.push(watch);
        for (const file of found) files[file] = createHash('sha256').update(readRepoFile(repo, file), 'utf8').digest('hex').slice(0, 16);
    }
    const lines = Object.keys(files).sort().map(f => `${f} ${files[f]}`).join('\n');
    return { digest: lines ? 'sha256:' + createHash('sha256').update(lines, 'utf8').digest('hex').slice(0, 24) : '', files, missing };
}

/** Which of the files differ between two `files` maps of digestOf (added, removed or changed). */
export function changedFiles(now: Record<string, string>, before: Record<string, string>): string[] {
    return [...new Set([...Object.keys(now), ...Object.keys(before)])].filter(f => now[f] !== before[f]).sort();
}
