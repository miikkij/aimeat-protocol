/**
 * @file test/unit/datapackage-pointer-state.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one-time step that copies each data package pointer's sale terms and withdrawal mark
 *   onto the service's records (services/datapackage/sale-terms-record.ts recordPointerStateOnce; WP9e).
 *   Before the step, saleTermsOf answers the pointer's terms as the reads did; the step waits while the
 *   audience records are not in place; it copies terms only where a pointer has them and no record
 *   exists, skips a pointer that is not JSON, and copies a withdrawal onto the audience record. After it,
 *   a pointer rewritten with other terms or with its withdrawal cleared changes no answer.
 * @usage cd aimeat && pnpm exec vitest run test/unit/datapackage-pointer-state.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (WP9e, cc-jouni-dataulos).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { createStorage } from '../../src/storage/storage-factory.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { recordDatapackageAudiencesOnce, trustedPackageOf } from '../../src/services/datapackage/audience-record.js';
import { recordPointerStateOnce, saleTermsOf, saleTermsKey } from '../../src/services/datapackage/sale-terms-record.js';
import { isServiceOwnedKey } from '../../src/utils/reserved-keys.js';

const SQLITE_PATH = `./test/.dppointerstate-${process.pid}.db`;
const NODE = 'aimeat-dp-pointer-state';
const OWNER = 'psowner';
const GHII = `${OWNER}@${NODE}`;
const config = { nodeId: NODE, baseUrl: 'http://localhost', classificationMode: 'off' } as unknown as AimeatConfig;
let storage: Storage;
const H = (c: string) => c.repeat(64);

const TERMS = { exchange: true, model: 'per_read', pricesMoney: [{ amount: 10_000, currency: 'EUR' }], usageTerms: { resale: false } };
const FORGED = { exchange: true, model: 'per_read', pricesMoney: [{ amount: 1, currency: 'EUR' }], usageTerms: { resale: true } };

async function put(key: string, data: unknown): Promise<void> {
    const bytes = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data), 'utf8');
    await storage.deleteStorageFile(GHII, key);
    await storage.createStorageFile({ key, ownerGaii: GHII, visibility: 'private', mimeType: 'application/json', size: bytes.length, data: bytes, tags: [], createdAt: new Date().toISOString() });
}
const pointer = (name: string, hash: string, extra: Record<string, unknown> = {}) => ({
    packageId: `pkg:${OWNER}/${name}`, name, contentHash: `sha256:${hash}`, descriptorUrl: '', updatedAt: '2026-10-01T00:00:00.000Z', visibility: 'private', ...extra,
});

beforeAll(async () => {
    setThisNodeId(NODE);
    storage = await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH });
    await storage.createOwner({ name: OWNER, displayName: OWNER, publicKey: 'pk', roles: ['owner'], createdAt: new Date().toISOString() } as never);
    await put('datapkg/sold/latest.json', pointer('sold', H('1'), { exchange: TERMS }));
    await put('datapkg/gone/latest.json', pointer('gone', H('2'), { status: 'withdrawn', withdrawnAt: '2026-10-20T00:00:00.000Z' }));
    await put('datapkg/plain/latest.json', pointer('plain', H('3')));
    await put('datapkg/broken/latest.json', 'not json');
}, 60_000);

afterAll(async () => {
    setThisNodeId(null);
    await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
    for (const suffix of ['', '-wal', '-shm']) {
        const p = SQLITE_PATH + suffix;
        if (existsSync(p)) rmSync(p);
    }
});

describe('the sale terms and withdrawals of the existing pointers', () => {
    it('is a service-owned key, which no memory route writes', () => {
        expect(isServiceOwnedKey(saleTermsKey('anything'))).toBe(true);
    });

    it('before the step, the terms are the pointer\'s, as the reads took them', async () => {
        expect(await saleTermsOf(storage, NODE, GHII, 'sold', { exchange: TERMS as never })).toEqual(TERMS);
    });

    it('waits while the audience records are not in place, and claims nothing', async () => {
        expect(await recordPointerStateOnce(storage, config)).toEqual({ ran: false });
        expect(await storage.getMemory(`system@${NODE}`, 'migrations.datapackage-pointer-state')).toBeNull();
    });

    it('after the audience step, copies the terms and the withdrawal once, and skips a pointer that is not JSON', async () => {
        await recordDatapackageAudiencesOnce(storage, config);
        // The audience step carries the withdrawal of a package it records.
        expect((await trustedPackageOf(storage, NODE, GHII, 'gone'))?.trusted.withdrawnAt).toBe('2026-10-20T00:00:00.000Z');
        const first = await recordPointerStateOnce(storage, config);
        expect(first).toEqual({ ran: true, terms: 1, withdrawals: 0 });
        expect(await recordPointerStateOnce(storage, config)).toEqual({ ran: false });
        expect(await saleTermsOf(storage, NODE, GHII, 'sold', null)).toEqual(TERMS);
        expect(await saleTermsOf(storage, NODE, GHII, 'plain', null)).toBeNull();
    });

    it('after the step, a rewritten pointer changes neither the terms nor the withdrawal', async () => {
        await put('datapkg/sold/latest.json', pointer('sold', H('9'), { exchange: FORGED, visibility: 'public' }));
        await put('datapkg/gone/latest.json', pointer('gone', H('2')));
        await put('datapkg/plain/latest.json', pointer('plain', H('3'), { exchange: FORGED }));
        expect(await saleTermsOf(storage, NODE, GHII, 'sold', { exchange: FORGED as never })).toEqual(TERMS);
        expect(await saleTermsOf(storage, NODE, GHII, 'plain', { exchange: FORGED as never })).toBeNull();
        const sold = await trustedPackageOf(storage, NODE, GHII, 'sold');
        expect(sold?.trusted.current).toBe(`sha256:${H('1')}`);
        expect(sold?.trusted.visibility).toBe('private');
        expect((await trustedPackageOf(storage, NODE, GHII, 'gone'))?.trusted.withdrawnAt).toBe('2026-10-20T00:00:00.000Z');
    });
});
