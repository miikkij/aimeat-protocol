/**
 * @file test/unit/package-group-visibility-check.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The visibility a package group update stores (updatePackageGroup,
 *   services/packages/compose/package-create.ts, the body of PATCH /v1/packages/:groupId): every
 *   visibility the update would write is checked first, so an empty string, false or null is 400
 *   INVALID_INPUT and no version is written; one of the four levels is written to every version, and
 *   an update without a visibility keeps the one stored.
 * @usage cd aimeat && pnpm exec vitest run test/unit/package-group-visibility-check.test.ts
 * @version-history
 *   2026-10-31 — Initial (secaudit 2026-10-31 inv-25).
 */
import { describe, it, expect } from 'vitest';
import { updatePackageGroup } from '../../src/services/packages/compose/package-create.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, PackageRecord } from '../../src/storage/interface.js';

function world() {
    const versions = [
        { id: 'v1', packageGroupId: 'g1', version: '1.0.0', author: 'alice', visibility: 'private', description: 'd' },
        { id: 'v2', packageGroupId: 'g1', version: '1.1.0', author: 'alice', visibility: 'private', description: 'd' },
    ] as unknown as PackageRecord[];
    const writes: Array<{ id: string; updates: Partial<PackageRecord> }> = [];
    const storage = {
        listVersions: async () => ({ versions, total: versions.length }),
        updatePackage: async (id: string, updates: Partial<PackageRecord>) => {
            writes.push({ id, updates });
            const v = versions.find(x => x.id === id)!;
            Object.assign(v, updates);
            return v;
        },
        getLatestPublished: async () => versions[versions.length - 1],
    } as unknown as Storage;
    const deps = { storage, config: { nodeId: 'pkg-vis-test' } as unknown as AimeatConfig };
    return { deps, writes, versions };
}

describe('updatePackageGroup checks every visibility it writes', () => {
    for (const bad of ['', false, null]) {
        it(`visibility ${JSON.stringify(bad)} is 400 INVALID_INPUT and nothing is written`, async () => {
            const { deps, writes, versions } = world();
            const out = await updatePackageGroup(deps, { owner: 'alice' }, { groupId: 'g1', visibility: bad as unknown as string });
            expect(out.ok).toBe(false);
            expect(out.ok === false && out.code).toBe('INVALID_INPUT');
            expect(writes).toEqual([]);
            expect(versions.map(v => v.visibility)).toEqual(['private', 'private']);
        });
    }

    it('visibility public is written to every version', async () => {
        const { deps, writes, versions } = world();
        const out = await updatePackageGroup(deps, { owner: 'alice' }, { groupId: 'g1', visibility: 'public' });
        expect(out.ok).toBe(true);
        expect(writes.map(w => w.id)).toEqual(['v1', 'v2']);
        expect(versions.map(v => v.visibility)).toEqual(['public', 'public']);
    });

    it('an update without a visibility keeps the stored one', async () => {
        const { deps, versions } = world();
        const out = await updatePackageGroup(deps, { owner: 'alice' }, { groupId: 'g1', description: 'new words' });
        expect(out.ok).toBe(true);
        expect(versions.map(v => v.visibility)).toEqual(['private', 'private']);
        expect(versions.map(v => v.description)).toEqual(['new words', 'new words']);
    });
});
