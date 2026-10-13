/**
 * @file test/unit/toll-morsels-names.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A knowledge package's `sharing.morsel_price` and a capability's `cost.morsels` are
 *   `toll_morsels` from 4.0.0 (ruling decision-4-0-0-sharing-morsel-price-ja-cost-morsels-saavat-nimen-toll).
 *   The new name is taken as it is; the old name is taken, stored under the new one and counted in
 *   deprecated_use_by_type; two names that disagree are 400 TOLL_MORSELS_MISMATCH; and from 5.0.0
 *   (MORSEL_PRICE_NAMES_REMOVED_IN) the old name is 400 MORSEL_PRICE_REMOVED. A row stored with the
 *   old name reads under the new one on both the write services and the SQLite provider.
 *
 *   The version is switched per test by mocking utils/version.ts getSoftwareVersion, the way
 *   test/unit/removals-4-0-0.test.ts does it.
 * @usage cd aimeat && pnpm exec vitest run test/unit/toll-morsels-names.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-13 — Initial (decision-4-0-0-sharing-morsel-price-ja-cost-morsels-saavat-nimen-toll).
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const v = vi.hoisted(() => ({ version: '4.0.0' }));
vi.mock('../../src/utils/version.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getSoftwareVersion: () => v.version,
}));

import { getStats, initStats } from '../../src/services/stats.js';
import { normalizeCapabilityCost, normalizeKnowledgeSharing, presentKnowledgeManifest } from '../../src/services/toll-morsels-names.js';
import { tollNameOnRead } from '../../src/utils/toll-name.js';
import { legacyPacingWriteRefusal } from '../../src/services/legacy-pacing-write.js';
import { validateManifest } from '../../src/routes/knowledge/manifest-validator.js';
import { createCapability, updateCapability } from '../../src/services/capability-record.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { MORSEL_PRICE_NAMES_REMOVED_IN } from '../../src/config-pacing.js';
import type { AimeatConfig } from '../../src/config.js';
import type { CapabilityRecord } from '../../src/storage/interface.js';

function deprecatedCount(kind: string): number {
    const snap = getStats()!.snapshot() as unknown as Record<string, Record<string, number> | undefined>;
    return Number(snap.deprecated_use_by_type?.[kind] ?? 0);
}

const MANIFEST = {
    type: 'knowledge-package', name: 'Pacing names', version: '1.0.0', author: 'alice',
    content_type: 'document', tags: [], synthesis: { level: 'original', description: 'test' },
    entries: [{ key: 'packages/p/one', title: 'One', visibility: 'private' }],
};

beforeAll(async () => { await initStats(); });
beforeEach(() => { v.version = '4.0.0'; });

describe('the removal release', () => {
    it('is the next major release, not 4.0.0', () => {
        expect(MORSEL_PRICE_NAMES_REMOVED_IN).toBe('5.0.0');
    });
});

describe('a knowledge package sharing.toll_morsels', () => {
    it('takes the new name as it is and counts nothing', () => {
        const before = deprecatedCount('knowledge_morsel_price');
        const out = normalizeKnowledgeSharing({ catalog_listed: false, allow_clone: false, toll_morsels: 0 });
        expect(out).toEqual({ ok: true, value: { catalog_listed: false, allow_clone: false, toll_morsels: 0 } });
        expect(deprecatedCount('knowledge_morsel_price')).toBe(before);
    });

    it('takes the old name on 4.0.0, stores it as toll_morsels, and counts it', () => {
        const before = deprecatedCount('knowledge_morsel_price');
        const out = normalizeKnowledgeSharing({ catalog_listed: true, allow_clone: true, morsel_price: 0 });
        expect(out).toEqual({ ok: true, value: { catalog_listed: true, allow_clone: true, toll_morsels: 0 } });
        expect(deprecatedCount('knowledge_morsel_price')).toBe(before + 1);
    });

    it('takes both names when they agree, and still counts the old one', () => {
        const before = deprecatedCount('knowledge_morsel_price');
        const out = normalizeKnowledgeSharing({ catalog_listed: false, allow_clone: false, toll_morsels: 0, morsel_price: 0 });
        expect(out).toEqual({ ok: true, value: { catalog_listed: false, allow_clone: false, toll_morsels: 0 } });
        expect(deprecatedCount('knowledge_morsel_price')).toBe(before + 1);
    });

    it('refuses two names that disagree with TOLL_MORSELS_MISMATCH', () => {
        const out = normalizeKnowledgeSharing({ catalog_listed: false, allow_clone: false, toll_morsels: 0, morsel_price: 3 });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.status).toBe(400);
        expect(out.code).toBe('TOLL_MORSELS_MISMATCH');
    });

    it('refuses an amount that is not a number of at least 0, under either name', () => {
        const a = normalizeKnowledgeSharing({ catalog_listed: false, allow_clone: false, morsel_price: -1 });
        const b = normalizeKnowledgeSharing({ catalog_listed: false, allow_clone: false, toll_morsels: 'x' });
        expect(a.ok ? null : a.code).toBe('INVALID_INPUT');
        expect(b.ok ? null : b.code).toBe('INVALID_INPUT');
    });

    it('refuses the old name from 5.0.0 with MORSEL_PRICE_REMOVED, and counts nothing', () => {
        v.version = '5.0.0';
        const before = deprecatedCount('knowledge_morsel_price');
        const out = normalizeKnowledgeSharing({ catalog_listed: false, allow_clone: false, morsel_price: 0 });
        expect(out.ok ? null : out.code).toBe('MORSEL_PRICE_REMOVED');
        expect(deprecatedCount('knowledge_morsel_price')).toBe(before);
        expect(normalizeKnowledgeSharing({ catalog_listed: false, allow_clone: false, toll_morsels: 0 }).ok).toBe(true);
    });

    it('takes the old name on a 3.x node too', () => {
        v.version = '3.27.0';
        expect(normalizeKnowledgeSharing({ catalog_listed: false, allow_clone: false, morsel_price: 0 }).ok).toBe(true);
    });

    it('the manifest schema takes either name, and refuses a sharing block with neither', () => {
        expect(validateManifest({ ...MANIFEST, sharing: { catalog_listed: false, allow_clone: false, toll_morsels: 0 } })).toBe(true);
        expect(validateManifest({ ...MANIFEST, sharing: { catalog_listed: false, allow_clone: false, morsel_price: 0 } })).toBe(true);
        expect(validateManifest({ ...MANIFEST, sharing: { catalog_listed: false, allow_clone: false } })).toBe(false);
    });

    it('a stored manifest with the old name is shown with toll_morsels', () => {
        const shown = presentKnowledgeManifest({ ...MANIFEST, sharing: { catalog_listed: true, allow_clone: true, morsel_price: 0 } });
        expect(shown.sharing).toEqual({ catalog_listed: true, allow_clone: true, toll_morsels: 0 });
    });

    it('the generic memory write of a manifest counts the old name and refuses a mismatch', () => {
        const before = deprecatedCount('knowledge_morsel_price');
        expect(legacyPacingWriteRefusal('packages/abc/manifest', { ...MANIFEST, sharing: { catalog_listed: false, allow_clone: false, morsel_price: 0 } })).toBeNull();
        expect(deprecatedCount('knowledge_morsel_price')).toBe(before + 1);
        const refused = legacyPacingWriteRefusal('packages/abc/manifest', { ...MANIFEST, sharing: { catalog_listed: false, allow_clone: false, toll_morsels: 1, morsel_price: 2 } });
        expect(refused?.code).toBe('TOLL_MORSELS_MISMATCH');
        expect(legacyPacingWriteRefusal('packages/abc/entry', { sharing: { morsel_price: 0 } })).toBeNull();
    });
});

describe('a capability cost.toll_morsels', () => {
    const config = { nodeId: 'aimeat-toll-test', capabilityPublishing: 'open', capabilityWebhooks: 'disabled', capabilityWebhookDomainAllowlist: [] } as unknown as AimeatConfig;
    const owner = { gaii: 'alice@aimeat-toll-test', isOperator: false };
    let storage: SqliteStorage;
    beforeEach(() => { storage = new SqliteStorage(':memory:'); });

    it('stores the new name as it is and counts nothing', async () => {
        const before = deprecatedCount('capability_cost_morsels');
        const out = await createCapability({ storage, config }, owner, { name: 'New', summary: 's', cost: { toll_morsels: 3 } });
        expect(out.ok && out.value.cost).toEqual({ toll_morsels: 3 });
        expect(deprecatedCount('capability_cost_morsels')).toBe(before);
    });

    it('stores the old name as toll_morsels on 4.0.0, on create and on update, and counts each', async () => {
        const before = deprecatedCount('capability_cost_morsels');
        const created = await createCapability({ storage, config }, owner, { name: 'Old', summary: 's', cost: { morsels: 4 } });
        expect(created.ok).toBe(true);
        if (!created.ok) return;
        expect(created.value.cost).toEqual({ toll_morsels: 4 });
        expect((await storage.getCapability(created.value.id))?.cost).toEqual({ toll_morsels: 4 });
        const updated = await updateCapability({ storage, config }, owner, created.value.id, { cost: { morsels: 6 } });
        expect(updated.ok && updated.value.cost).toEqual({ toll_morsels: 6 });
        expect(deprecatedCount('capability_cost_morsels')).toBe(before + 2);
    });

    it('refuses two names that disagree, on create and on update', async () => {
        const created = await createCapability({ storage, config }, owner, { name: 'Both', summary: 's', cost: { toll_morsels: 1, morsels: 2 } });
        expect(created.ok ? null : created.code).toBe('TOLL_MORSELS_MISMATCH');
        const seeded = await createCapability({ storage, config }, owner, { name: 'Seed', summary: 's' });
        if (!seeded.ok) throw new Error('seed refused');
        const updated = await updateCapability({ storage, config }, owner, seeded.value.id, { cost: { toll_morsels: 1, morsels: 2 } });
        expect(updated.ok ? null : updated.code).toBe('TOLL_MORSELS_MISMATCH');
    });

    it('refuses the old name from 5.0.0', async () => {
        v.version = '5.0.0';
        const out = await createCapability({ storage, config }, owner, { name: 'Late', summary: 's', cost: { morsels: 1 } });
        expect(out.ok ? null : out.code).toBe('MORSEL_PRICE_REMOVED');
        expect(normalizeCapabilityCost(null).ok).toBe(true);
    });

    it('a row stored with cost.morsels before 4.0.0 reads as cost.toll_morsels', async () => {
        const seeded = await createCapability({ storage, config }, owner, { name: 'Legacy row', summary: 's' });
        if (!seeded.ok) throw new Error('seed refused');
        // The provider writes what it is given: this is the shape a 3.x node stored.
        await storage.updateCapability(seeded.value.id, { cost: { morsels: 7, perUnit: 'call' } } as unknown as Partial<CapabilityRecord>);
        expect((await storage.getCapability(seeded.value.id))?.cost).toEqual({ toll_morsels: 7, perUnit: 'call' });
    });
});

describe('tollNameOnRead', () => {
    it('renames the old key, keeps the new one when both are there, and leaves anything else alone', () => {
        expect(tollNameOnRead({ morsels: 2 }, 'morsels')).toEqual({ toll_morsels: 2 });
        expect(tollNameOnRead({ morsels: 2, toll_morsels: 5 }, 'morsels')).toEqual({ toll_morsels: 5 });
        expect(tollNameOnRead({ toll_morsels: 5 }, 'morsels')).toEqual({ toll_morsels: 5 });
        expect(tollNameOnRead(null, 'morsels')).toBeNull();
    });
});
