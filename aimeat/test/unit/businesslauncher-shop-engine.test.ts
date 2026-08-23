/**
 * @file businesslauncher-shop-engine.test.ts
 * @description The shop's engine, run as a real sandboxed extension against real storage: the
 *   claim, the public catalogue copy, stock, holds and the sweep that puts expired holds back.
 *
 *   The case this exists for is the last one: two buyers reaching for the last unit at the same
 *   moment. Stock and holds live in ONE record so a reserve is a single compare-and-swap, because
 *   a decrement that landed while its hold was lost would sell a unit nobody can claim.
 *
 *   The scripts are read from packages/businesslauncher/ext/scripts/ — the same bytes the package
 *   ships — so this cannot pass against a copy that has drifted from what installs.
 * @structure claim · publish_catalog · set_stock · reserve (incl. the race) · release · sweep
 * @usage pnpm test -- businesslauncher-shop-engine
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial (TARGET-070).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { buildExtensionCtx } from '../../src/services/extension-ctx.js';
import { executeExtensionAction } from '../../src/services/extension-runtime.js';
import type { ExtensionCtx, ExtensionLimits } from '../../src/services/extension-runtime.js';
import { loadConfig } from '../../src/config.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = resolve(HERE, '../../../packages/businesslauncher/ext/scripts');
const script = (name: string) => readFileSync(resolve(SCRIPTS, name), 'utf8');

const EXT_OWNER = 'ext:businesslauncher-shop';
const OWNER = 'alice@aimeat-local-001-dev';
const BUYER = 'bob@aimeat-local-001-dev';

const LIMITS: ExtensionLimits = { memoryMb: 64, timeoutMs: 5000, maxApiCalls: 200 };

function ctxFor(storage: SqliteStorage, gaii: string): ExtensionCtx {
    return buildExtensionCtx({
        config: loadConfig({}),
        storage: storage as never,
        extMemoryOwner: EXT_OWNER,
        caller: { gaii, owner: gaii.split('@')[0], roles: ['owner'] } as never,
        extConfig: {},
        logPrefix: 'test',
    });
}

/** Run one action as one caller. */
function run(storage: SqliteStorage, file: string, gaii: string, input: unknown) {
    return executeExtensionAction(script(file), ctxFor(storage, gaii), input as never, LIMITS) as Promise<Record<string, unknown>>;
}

/** An ISO timestamp offset from now, for hold expiry. */
function isoIn(ms: number): string {
    return new Date(Date.now() + ms).toISOString();
}

describe('businesslauncher shop engine', () => {
    let storage: SqliteStorage;

    beforeEach(async () => {
        storage = new SqliteStorage(':memory:');
        await run(storage, 'admin.js', OWNER, { op: 'claim', currency: 'EUR' });
    });

    it('the first caller claims the shop and the second is refused', async () => {
        const second = await run(storage, 'admin.js', BUYER, { op: 'claim' });
        expect(second.ok).toBe(false);
        expect(second.owner).toBe(OWNER);
    });

    it('only the owner may stock the shelf', async () => {
        const asBuyer = await run(storage, 'admin.js', BUYER, { op: 'set_stock', units: { mug: 5 } });
        expect(asBuyer.ok).toBe(false);
        expect(String(asBuyer.error)).toMatch(/only the shop owner/);
    });

    it('publishing the catalogue writes the copy a visitor reads with no login', async () => {
        const res = await run(storage, 'admin.js', OWNER, {
            op: 'publish_catalog',
            catalog: { currency: 'EUR', items: [{ sku: 'mug', name: 'Mug' }] },
        });
        expect(res.ok).toBe(true);

        // Anonymous read: an ext namespace is public by design, which is the whole reason the
        // storefront copy lives here rather than in the workspace.
        const record = await storage.getMemory(EXT_OWNER, 'catalog');
        expect(record?.visibility).toBe('public');
        expect((record?.value as { items: unknown[] }).items).toHaveLength(1);
    });

    it('a hold takes the units off the shelf, and the same id twice is one hold', async () => {
        await run(storage, 'admin.js', OWNER, { op: 'set_stock', units: { mug: 3 } });

        const first = await run(storage, 'reserve.js', BUYER, { sku: 'mug', qty: 2, reservationId: 'r1', expiresAt: isoIn(60_000) });
        expect(first.ok).toBe(true);
        expect(first.left).toBe(1);

        const retry = await run(storage, 'reserve.js', BUYER, { sku: 'mug', qty: 2, reservationId: 'r1', expiresAt: isoIn(60_000) });
        expect(retry.ok).toBe(true);
        expect(retry.already).toBe(true);
        // The retry took nothing more.
        const inv = await storage.getMemory(EXT_OWNER, 'inventory');
        expect((inv?.value as { stock: Record<string, number> }).stock.mug).toBe(1);
    });

    it('a hold that would overdraw the shelf is refused', async () => {
        await run(storage, 'admin.js', OWNER, { op: 'set_stock', units: { mug: 1 } });
        const res = await run(storage, 'reserve.js', BUYER, { sku: 'mug', qty: 2, reservationId: 'r1', expiresAt: isoIn(60_000) });
        expect(res.ok).toBe(false);
        expect(res.left).toBe(1);
    });

    // THE case, and the interleaving is FORCED rather than hoped for. Two `Promise.all` calls over a
    // synchronous store simply run one after the other, so a race test written that way passes with
    // the guard removed — it proves nothing. Here the first write is held until the second buyer has
    // read, which is exactly the window the defect lives in.
    it('two buyers reaching for the last unit, both reading before either writes: one gets it', async () => {
        await run(storage, 'admin.js', OWNER, { op: 'set_stock', units: { mug: 1 } });

        // Hold the FIRST attempt to write the inventory until a SECOND one arrives. A script always
        // reads before it writes, so this guarantees both buyers decided against the same stock.
        // Gating on reads instead does not work: `set` reads the existing row too, so one caller
        // alone reaches two reads and the gate opens with nobody else in the window.
        let writes = 0;
        let secondWriteArrived: () => void;
        const bothAboutToWrite = new Promise<void>((r) => { secondWriteArrived = r; });
        const holdFirstWrite = async (key: string) => {
            if (key !== 'inventory') return;
            if (++writes === 1) await bothAboutToWrite;
            else secondWriteArrived();
        };
        const gated = new Proxy(storage, {
            get(target, prop, receiver) {
                if (prop === 'setMemory') {
                    return async (record: { key: string }) => {
                        await holdFirstWrite(record.key);
                        return (target as unknown as SqliteStorage).setMemory(record as never);
                    };
                }
                if (prop === 'setMemoryIfVersion') {
                    return async (record: { key: string }, expected: number) => {
                        await holdFirstWrite(record.key);
                        return (target as unknown as SqliteStorage).setMemoryIfVersion!(record as never, expected);
                    };
                }
                return Reflect.get(target, prop, receiver);
            },
        }) as unknown as SqliteStorage;

        const [a, b] = await Promise.all([
            run(gated, 'reserve.js', BUYER, { sku: 'mug', qty: 1, reservationId: 'ra', expiresAt: isoIn(60_000) }),
            run(gated, 'reserve.js', OWNER, { sku: 'mug', qty: 1, reservationId: 'rb', expiresAt: isoIn(60_000) }),
        ]);

        expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
        const inv = await storage.getMemory(EXT_OWNER, 'inventory');
        const value = inv?.value as { stock: Record<string, number>; reservations: Record<string, unknown> };
        expect(value.stock.mug).toBe(0);
        expect(Object.keys(value.reservations)).toHaveLength(1);
    });

    it('releasing puts the units back, and someone else cannot release your hold', async () => {
        await run(storage, 'admin.js', OWNER, { op: 'set_stock', units: { mug: 2 } });
        await run(storage, 'reserve.js', BUYER, { sku: 'mug', qty: 1, reservationId: 'r1', expiresAt: isoIn(60_000) });

        const stranger = await run(storage, 'release.js', 'carol@aimeat-local-001-dev', { reservationId: 'r1' });
        expect(stranger.ok).toBe(false);

        const mine = await run(storage, 'release.js', BUYER, { reservationId: 'r1' });
        expect(mine.ok).toBe(true);
        expect(mine.left).toBe(2);
    });

    it('committing a sale drops the hold WITHOUT putting the units back', async () => {
        await run(storage, 'admin.js', OWNER, { op: 'set_stock', units: { mug: 2 } });
        await run(storage, 'reserve.js', BUYER, { sku: 'mug', qty: 1, reservationId: 'r1', expiresAt: isoIn(60_000) });

        const done = await run(storage, 'admin.js', OWNER, { op: 'commit', reservationId: 'r1' });
        expect(done.ok).toBe(true);

        const inv = await storage.getMemory(EXT_OWNER, 'inventory');
        const value = inv?.value as { stock: Record<string, number>; reservations: Record<string, unknown> };
        expect(value.stock.mug).toBe(1);
        expect(Object.keys(value.reservations)).toHaveLength(0);
    });

    it('a hold cannot be taken with an expiry already in the past', async () => {
        await run(storage, 'admin.js', OWNER, { op: 'set_stock', units: { mug: 1 } });
        const res = await run(storage, 'reserve.js', BUYER, { sku: 'mug', qty: 1, reservationId: 'r1', expiresAt: isoIn(-1000) });
        expect(res.ok).toBe(false);
        expect(String(res.error)).toMatch(/past/);
    });

    it('the sweep puts expired holds back on the shelf and leaves live ones alone', async () => {
        await run(storage, 'admin.js', OWNER, { op: 'set_stock', units: { mug: 5 } });
        await run(storage, 'reserve.js', BUYER, { sku: 'mug', qty: 2, reservationId: 'stale', expiresAt: isoIn(60_000) });
        await run(storage, 'reserve.js', BUYER, { sku: 'mug', qty: 1, reservationId: 'live', expiresAt: isoIn(60_000) });

        // Age the first hold rather than waiting for it: reserve refuses a past expiry, on purpose.
        const rec = (await storage.getMemory(EXT_OWNER, 'inventory'))!;
        const aged = rec.value as { stock: Record<string, number>; reservations: Record<string, { expiresAt: string }> };
        aged.reservations.stale.expiresAt = isoIn(-1000);
        await storage.setMemory({ ...rec, value: aged, version: rec.version + 1, updatedAt: new Date().toISOString() });

        const swept = await run(storage, 'admin.js', OWNER, { op: 'sweep' });
        expect(swept.ok).toBe(true);
        expect(swept.expired).toBe(1);

        const inv = await storage.getMemory(EXT_OWNER, 'inventory');
        const value = inv?.value as { stock: Record<string, number>; reservations: Record<string, string> };
        expect(value.stock.mug).toBe(4);              // 5 - 2 - 1, then the stale 2 came back
        expect(Object.keys(value.reservations)).toEqual(['live']);
    });
});
