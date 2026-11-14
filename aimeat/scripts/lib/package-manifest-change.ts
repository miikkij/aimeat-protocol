/**
 * @file scripts/lib/package-manifest-change.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether aimeat/package.json changed in anything but `scripts` since a commit. A new
 *   or renamed script changes nothing the code imports or the package ships, so the gate runs no
 *   whole unit suite for it and the nightly preflight runs no pack start for it.
 *
 *   WHY. vitest reruns every test file when package.json changes (its default forceRerunTriggers),
 *   so adding one script line cost `pnpm gate` twenty minutes of unit tests on 2026-11-14.
 * @structure manifestChangedBeyondScripts(base, repoRoot)
 * @usage if (manifestChangedBeyondScripts(mergeBase, repoRoot)) { ...run the whole unit suite }
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const withoutScripts = (text: string): string => {
    const manifest = JSON.parse(text) as Record<string, unknown>;
    delete manifest.scripts;
    return JSON.stringify(manifest);
};

/** True when aimeat/package.json differs from `base` outside `scripts`, or either side cannot be read. */
export function manifestChangedBeyondScripts(base: string, repoRoot: string): boolean {
    try {
        const before = execFileSync('git', ['show', `${base}:aimeat/package.json`], { encoding: 'utf8', cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
        const now = readFileSync(join(repoRoot, 'aimeat', 'package.json'), 'utf8');
        return withoutScripts(before) !== withoutScripts(now);
    } catch {
        return true;
    }
}
