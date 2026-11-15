/**
 * @file scripts/lib/gate-coverage.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The E2E suites a change can have reached, for `pnpm gate`: the suites the nightly's
 *   coverage map (scripts/lib/e2e-coverage-map.ts) says executed a changed line of src/.
 *
 *   The map is fetched by `pnpm e2e:nightly coverage` into coverage-e2e/coverage-map.json and is
 *   refreshed here when it is missing or older than a day. Without it (no gh CLI, no sign-in, no
 *   nightly with a map yet) the gate runs what it ran before and says that the selection is missing.
 *
 *   Changed lines are read twice from git: against the gate's base, to know WHICH lines changed, and
 *   against the map's commit, to translate them into the numbering the map was built in.
 * @structure GateCoverage · coverageSelection()
 * @version-history
 *   v1.0.0 -- 2026-11-15 -- Initial (report of 2026-11-15, 4.2.6).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { selectSuites, translateLines, type CoverageMap } from './e2e-coverage-map.js';

/** Past this many suites the change touches a path nearly every suite runs; the guard and purpose tiers stand in. */
export const COVERAGE_SUITE_CAP = 150;
const MAX_AGE_MS = 24 * 60 * 60_000;

export interface GateCoverage {
    /** The selected suites, or null when there is no map. */
    suites: string[] | null;
    /** One line for the plan: where the map is from, or why there is none. */
    note: string;
    /** Changed src/ files the map does not know (new, or executed by no suite). */
    unknown: string[];
}

function git(root: string, args: string[]): string {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** The new-side line numbers a `git diff -U0` text touches; a deletion counts the lines on both sides of it. */
function changedNewLines(diffText: string): number[] {
    const out = new Set<number>();
    for (const m of diffText.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
        const start = Number(m[1]);
        const len = m[2] === undefined ? 1 : Number(m[2]);
        if (len === 0) { out.add(Math.max(1, start)); out.add(start + 1); continue; }
        for (let l = start; l < start + len; l++) out.add(l);
    }
    return [...out].sort((a, b) => a - b);
}

function loadMap(aimeat: string, refresh: boolean): { map: CoverageMap | null; note: string } {
    const file = join(aimeat, 'coverage-e2e', 'coverage-map.json');
    const stale = !existsSync(file) || Date.now() - statSync(file).mtimeMs > MAX_AGE_MS;
    if (stale && refresh) {
        spawnSync('pnpm', ['-s', 'exec', 'tsx', 'scripts/e2e-nightly.ts', 'coverage', '--quiet'], { cwd: aimeat, stdio: 'ignore', shell: process.platform === 'win32' });
    }
    if (!existsSync(file)) return { map: null, note: 'no coverage map (pnpm e2e:nightly coverage fetches it; it needs gh auth login)' };
    try {
        const map = JSON.parse(readFileSync(file, 'utf8')) as CoverageMap;
        const age = Math.round((Date.now() - statSync(file).mtimeMs) / 3_600_000);
        return { map, note: `coverage map of ${map.commit.slice(0, 9)}, built ${map.built.slice(0, 10)}${age > 24 ? `, ${age} h old` : ''}` };
    } catch (e) {
        return { map: null, note: `the coverage map could not be read: ${(e as Error).message}` };
    }
}

/** The suites that executed a line the change touched under aimeat/src/. */
export function coverageSelection(root: string, aimeat: string, files: string[], mergeBase: string, opts: { refresh: boolean }): GateCoverage {
    const src = files.filter(f => /^aimeat\/src\/.+\.ts$/.test(f));
    if (src.length === 0) return { suites: [], note: 'no src/ change', unknown: [] };
    const { map, note } = loadMap(aimeat, opts.refresh);
    if (!map) return { suites: null, note, unknown: [] };
    let mapCommitKnown = true;
    try { git(root, ['cat-file', '-e', `${map.commit}^{commit}`]); } catch { mapCommitKnown = false; }
    const changes = new Map<string, number[]>();
    for (const f of src) {
        const abs = join(root, f);
        if (!existsSync(abs)) { changes.set(f, []); continue; }
        let lines: number[];
        try { lines = changedNewLines(git(root, ['diff', '-U0', mergeBase, '--', f])); } catch { lines = []; }
        if (lines.length === 0) {
            // A new, untracked file has no diff against the base: the whole file is new.
            changes.set(f, []);
            continue;
        }
        if (!mapCommitKnown) { changes.set(f, []); continue; }
        let toMap: string;
        try { toMap = git(root, ['diff', '-U0', map.commit, '--', f]); } catch { changes.set(f, []); continue; }
        changes.set(f, translateLines(lines, toMap));
    }
    const sel = selectSuites(map, changes);
    return { suites: [...sel.suites].sort(), note: note + (mapCommitKnown ? '' : '; its commit is not in this clone, so whole files were matched'), unknown: sel.unknown };
}
