/**
 * @file test/unit/ci-stats-rest.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description scripts/ci-stats.ts reads GitHub's REST API when the GitHub CLI is missing: the
 *   repository comes from the origin remote, and a REST workflow run is turned into the shape
 *   `gh run list --json` gives, which the red-period code reads.
 * @usage cd aimeat && pnpm exec vitest run test/unit/ci-stats-rest.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-19 — Initial (the CI watch round stopped at spawnSync gh ENOENT).
 */
import { describe, expect, it } from 'vitest';
import { repoFromRemote, runFromRest, redPeriods } from '../../scripts/ci-stats.js';

describe('ci-stats without the GitHub CLI', () => {
    it('reads owner/repo from an https or ssh GitHub remote, and nothing from another host', () => {
        expect(repoFromRemote('https://github.com/miikkij/aimeat-protocol.git')).toBe('miikkij/aimeat-protocol');
        expect(repoFromRemote('git@github.com:miikkij/aimeat-protocol.git\n')).toBe('miikkij/aimeat-protocol');
        expect(repoFromRemote('https://github.com/miikkij/aimeat-protocol')).toBe('miikkij/aimeat-protocol');
        expect(repoFromRemote('https://gitlab.com/someone/project.git')).toBeNull();
    });

    it('turns a REST run into the gh shape, and a run still going has no conclusion', () => {
        expect(runFromRest({ id: 7, conclusion: 'failure', status: 'completed', created_at: '2026-10-16T19:56:00Z', updated_at: '2026-10-16T20:20:00Z', head_sha: 'a5549bad6abc' }))
            .toEqual({ databaseId: 7, conclusion: 'failure', status: 'completed', createdAt: '2026-10-16T19:56:00Z', updatedAt: '2026-10-16T20:20:00Z', headSha: 'a5549bad6abc' });
        expect(runFromRest({ id: 8, conclusion: null, status: 'in_progress', created_at: 'x', updated_at: 'x', head_sha: 'y' }).conclusion).toBe('');
    });

    it('an all-green run list has no red period, so no GitHub lookup is made', () => {
        const green = [1, 2].map(i => runFromRest({ id: i, conclusion: 'success', status: 'completed', created_at: `2026-10-1${i}T00:00:00Z`, updated_at: `2026-10-1${i}T00:10:00Z`, head_sha: `s${i}` }));
        expect(redPeriods(green, '2026-10-19T00:00:00Z')).toEqual([]);
    });
});
