/**
 * @file exchange-datapackage.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The pure half of a data package sold on EXCHANGE (plan doc-mvwxcas3dom3, D5): the
 *   coordinate; the node's proposal of deliversData (D5.5); the sale terms a request may set; the plans
 *   a listing carries; the price a contract is minted at (a month by default); a contract reader opens
 *   only its package and the versions of its interface; a party share's versions bind it too.
 * @usage cd aimeat && pnpm exec vitest run test/unit/exchange-datapackage.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D5).
 */
import { describe, it, expect } from 'vitest';
import {
    datapackageCoordinate, parseDatapackageCoordinate, proposeDeliversData, validateExchangeTerms, plansForTerms,
    resolveDatapackagePricing, PER_MONTH_SECONDS,
} from '../../src/services/exchange-datapackage.js';
import { offeringDeliversData } from '../../src/services/data-intermediation/contract.js';
import { datapackageReadable, versionOpenTo } from '../../src/services/datapackage/audience.js';
import type { Storage } from '../../src/storage/interface.js';

const OWNER = 'alice@aimeat-local-001-dev';
const storage = { getOrganism: async () => null, getMembership: async () => null } as unknown as Storage;
const H1 = 'a'.repeat(64), H2 = 'b'.repeat(64);

describe('the coordinate', () => {
    it('is datapkg:{owner}/{name} + read, and parses back', () => {
        expect(datapackageCoordinate('alice', 'budget')).toEqual({ ext: 'datapkg:alice/budget', action: 'read' });
        expect(parseDatapackageCoordinate('datapkg:alice/budget')).toEqual({ ownerName: 'alice', name: 'budget' });
        expect(parseDatapackageCoordinate('apptool:alice/x.html')).toBeNull();
    });
});

describe('deliversData (D5.5)', () => {
    it('a package delivers data; agent work does not; an action or tool by its output schema', () => {
        expect(proposeDeliversData('datapackage')).toBe(true);
        expect(proposeDeliversData('agent-work', { type: 'array', items: { type: 'object' } })).toBe(false);
        expect(proposeDeliversData('ext-action', { type: 'array', items: { type: 'object', properties: {} } })).toBe(true);
        expect(proposeDeliversData('app-tool', { type: 'object', properties: { records: { type: 'array', items: { type: 'object' } } } })).toBe(true);
        expect(proposeDeliversData('ext-action', { type: 'object', properties: { valid: { type: 'boolean' } } })).toBe(false);
        expect(proposeDeliversData('ext-action', undefined)).toBe(false);
    });
    it('the gate reads the field, and the kind only for a listing without it', () => {
        expect(offeringDeliversData({ kind: 'ext-action', deliversData: false })).toBe(false);
        expect(offeringDeliversData({ kind: 'app-tool', deliversData: true })).toBe(true);
        expect(offeringDeliversData({ kind: 'ext-action' })).toBe(true);
        expect(offeringDeliversData({ kind: 'agent-work' })).toBe(false);
    });
});

describe('the sale terms', () => {
    const usage = { derivatives: true, resale: false, attribution: true };
    it('need usage terms and a price or pacing to list, and nothing to delist', () => {
        expect(validateExchangeTerms({ prices_money: [{ amount: 1, currency: 'EUR' }] }, 'x')).toMatchObject({ ok: false, code: 'USAGE_TERMS_REQUIRED' });
        expect(validateExchangeTerms({ usage_terms: usage }, 'x')).toMatchObject({ ok: false, code: 'NOT_PRICED' });
        expect(validateExchangeTerms({ exchange: false }, 'x')).toMatchObject({ ok: true });
        const ok = validateExchangeTerms({ usage_terms: usage, prices_money: [{ amount: 5_000_000, currency: 'eur' }] }, 'alice@n');
        expect(ok.ok && ok.terms).toMatchObject({ exchange: true, model: 'per_month', pricesMoney: [{ amount: 5_000_000, currency: 'EUR' }], updatedBy: 'alice@n' });
    });
    it('refuse a bad model, amount, currency, a repeated currency and a pacing outside 0 to 100', () => {
        for (const body of [
            { model: 'yearly' }, { prices_money: [{ amount: 0.5, currency: 'EUR' }] }, { prices_money: [{ amount: 1, currency: 'SEK' }] },
            { prices_money: [{ amount: 1, currency: 'EUR' }, { amount: 2, currency: 'EUR' }] }, { toll_morsels: 101 }, { delivers_data: 'yes' },
        ]) expect(validateExchangeTerms({ usage_terms: usage, ...body }, 'x').ok).toBe(false);
    });
});

describe('plans and the contract price', () => {
    it('per_month carries one 30-day subscription on a money row, per_read and morsels none', () => {
        expect(plansForTerms({ model: 'per_month' }, 'money', 5_000_000)).toEqual([{ id: 'per_month', model: 'subscription', periodSeconds: PER_MONTH_SECONDS, periodPrice: 5_000_000, callsPerWindow: 60, windowSeconds: 60 }]);
        expect(plansForTerms({ model: 'per_read' }, 'money', 10)).toEqual([]);
        expect(plansForTerms({ model: 'per_month' }, 'morsels', 3)).toEqual([]);
    });
    it('a per_month listing mints the subscription unless another plan is asked; per_read is per call', () => {
        const plans = plansForTerms({ model: 'per_month', readsPerMinute: 10 }, 'money', 5_000_000);
        const month = resolveDatapackagePricing({ unit: 'money', basePrice: 5_000_000, currency: 'EUR', plans, surface: { kind: 'datapackage', model: 'per_month' } }, null);
        expect(month.ok && month.pricing).toMatchObject({ model: 'subscription', periodPrice: 5_000_000, callsPerWindow: 10 });
        const read = resolveDatapackagePricing({ unit: 'money', basePrice: 20_000, currency: 'EUR', plans: [], surface: { kind: 'datapackage', model: 'per_read' } }, null);
        expect(read.ok && read.pricePerCall === 20_000 && read.pricing === null).toBe(true);
        expect(resolveDatapackagePricing({ unit: 'money', basePrice: 1, currency: 'EUR', plans: [], surface: null }, 'per_month')).toMatchObject({ ok: false, code: 'PLAN_NOT_FOUND' });
    });
});

describe('a contract reader (D5.3)', () => {
    const reader = { sub: 'bob@aimeat-local-001-dev', owner: 'bob', roles: ['owner'], contract: { ownerGhii: OWNER, packageName: 'budget', entitlementId: 'e1', versions: [`sha256:${H1}`] } };
    it('opens its package only, whatever the audience', async () => {
        expect(await datapackageReadable(storage, OWNER, 'private', reader, 'budget')).toBe(true);
        expect(await datapackageReadable(storage, OWNER, 'public', reader, 'other')).toBe(false);
        expect(await datapackageReadable(storage, 'carol@aimeat-local-001-dev', 'private', reader, 'budget')).toBe(false);
        expect(await datapackageReadable(storage, OWNER, 'private', reader)).toBe(false);
    });
    it('opens the versions of its interface only', async () => {
        expect(await versionOpenTo(storage, OWNER, reader, { contentHash: H2 }, H1, {})).toBe(true);
        expect(await versionOpenTo(storage, OWNER, reader, { contentHash: H2 }, H2, {})).toBe(false);
    });
    it('a party share bound to a purchase reads the purchased versions only', async () => {
        const party = { sub: 'party:alice/m@aimeat-local-001-dev', party: { ownerGhii: OWNER, packageName: 'budget', shareId: 's', versions: [`sha256:${H1}`] } };
        expect(await versionOpenTo(storage, OWNER, party, { contentHash: H2 }, H1, {})).toBe(true);
        expect(await versionOpenTo(storage, OWNER, party, { contentHash: H2 }, H2, {})).toBe(false);
    });
});
