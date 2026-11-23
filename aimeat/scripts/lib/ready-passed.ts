/**
 * @file scripts/lib/ready-passed.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which steps of pnpm ready were green for a tree, kept so that a second run on the
 *   same tree starts at the step that was red.
 *
 *   WHY. A red step ended the run, and the next run began at the checks again. On 2026-11-23 one
 *   session paid 22 to 28 minutes of unit suite nine times to reach a sweep step that was red for the
 *   machine's load, not for the change. A step reads the tree and nothing else, so a step that was
 *   green on a tree is green on the same tree again: running it a second time adds minutes and no
 *   evidence.
 *
 *   THE KEY IS THE TREE, NOT THE COMMIT. `git rev-parse HEAD^{tree}` names the content of every file.
 *   A fix, or a rebase onto a main that changed anything, gives another tree, and every step runs
 *   again. An amended message or a rebase that changed no file gives the same tree, and the content
 *   that was tested is the content that is there.
 *
 *   WHERE. One JSON file per tree under git's common directory (`<common>/aimeat-ready/`), which
 *   every worktree of the repository shares and no commit carries. A file older than KEEP_MS is
 *   removed when a store is opened, so the directory holds the last days' runs and nothing else.
 *
 *   `pnpm ready --fresh` opens no store: every step runs.
 * @structure KEEP_MS · PassedStore · passedStore() · prunePassed()
 * @usage
 *   const passed = passedStore(dir, tree);
 *   if (!passed.at('the unit suite')) { run(); passed.add('the unit suite'); }
 * @version-history
 *   v1.0.0 — 2026-11-23 — Initial (wish-pnpm-ready-valmis-ty-mainiin-nopeasti-yht-turvallisesti).
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** How long a tree's record is kept: longer than any run, shorter than anyone remembers the tree. */
export const KEEP_MS = 3 * 24 * 60 * 60_000;

export interface PassedStore {
    /** When the step was green on this tree (ISO time), or null. */
    at(step: string): string | null;
    /** Record the step as green on this tree, now. */
    add(step: string): void;
}

const FILE = /^passed-[0-9a-f]{40,64}\.json$/;

/** Remove every tree record in `dir` older than `keepMs`. */
export function prunePassed(dir: string, keepMs: number = KEEP_MS, now: number = Date.now()): void {
    let names: string[];
    try { names = readdirSync(dir); } catch { return; } // no directory yet: nothing to remove
    for (const name of names) {
        if (!FILE.test(name)) continue;
        try {
            if (now - statSync(join(dir, name)).mtimeMs > keepMs) rmSync(join(dir, name), { force: true });
        } catch { /* removed by another run between the listing and this look */ }
    }
}

/** The green steps of `tree` (a full tree id), read from and written to `dir`. */
export function passedStore(dir: string, tree: string, now: () => number = Date.now): PassedStore {
    if (!/^[0-9a-f]{40,64}$/.test(tree)) throw new Error(`not a tree id: "${tree}"`);
    mkdirSync(dir, { recursive: true });
    prunePassed(dir, KEEP_MS, now());
    const file = join(dir, `passed-${tree}.json`);
    const read = (): Record<string, string> => {
        try {
            const steps = (JSON.parse(readFileSync(file, 'utf-8')) as { steps?: Record<string, string> }).steps;
            return steps && typeof steps === 'object' ? steps : {};
        } catch {
            return {}; // no record, or one cut short by a stopped run: every step runs
        }
    };
    return {
        at: step => read()[step] ?? null,
        add: (step) => {
            const steps = { ...read(), [step]: new Date(now()).toISOString() };
            writeFileSync(file, `${JSON.stringify({ tree, steps }, null, 2)}\n`, 'utf-8');
        },
    };
}
