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
        config: loadConfig().config,
        storage: storage as never,
        extMemoryOwner: EXT_OWNER,
        // Who owns the shop comes from the extension's record, exactly as the invoke route resolves
        // it. That is what makes an owner-only action possible without a first-caller-wins claim.
        extension: { name: 'businesslauncher-shop', owner: OWNER.split('@')[0] },
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
        await run(storage, 'admin.js', OWNER, { op: 'configure', currency: 'EUR', name: 'Test shop' });
    });

    // The shop belongs to whoever installed it, from the first second. A "whoever calls first
    // claims it" step would leave a window between the install and the owner opening the back
    // office in which anyone signed in could take the shop.
    it('a stranger cannot configure a shop that is not theirs', async () => {
        const res = await run(storage, 'admin.js', BUYER, { op: 'configure', name: 'Mine now' });
        expect(res.ok).toBe(false);
        expect(String(res.error)).toMatch(/only the shop owner/);
        const shop = await storage.getMemory(EXT_OWNER, 'shop');
        expect((shop?.value as { name: string }).name).toBe('Test shop');
    });

    it('an action that cannot tell who owns the shop refuses rather than assuming', async () => {
        const blind = buildExtensionCtx({
            config: loadConfig().config,
            storage: storage as never,
            extMemoryOwner: EXT_OWNER,
            caller: { gaii: OWNER, owner: OWNER.split('@')[0], roles: ['owner'] } as never,
            extConfig: {},
            logPrefix: 'test',
        });
        const res = await executeExtensionAction(script('admin.js'), blind, { op: 'set_stock', units: { mug: 1 } } as never, LIMITS) as Record<string, unknown>;
        expect(res.ok).toBe(false);
        expect(String(res.error)).toMatch(/cannot tell who owns/);
    });

    // Where an enquiry is sent is a POINTER at a Public Intake form the owner already defined, and
    // the intake route resolves the destination from its own stored config. A half-filled pointer
    // would still put a button on the shop front and send people into nothing, so it is refused
    // here rather than discovered by the first person who writes in.
    it('a contact pointer missing any of its three parts is refused', async () => {
        const res = await run(storage, 'admin.js', OWNER, {
            op: 'configure', contact: { org: 'org-1', ws: 'ws-1' },
        });
        expect(res.ok).toBe(false);
        expect(String(res.error)).toMatch(/org, ws and formId/);
        const shop = await storage.getMemory(EXT_OWNER, 'shop');
        expect((shop?.value as { contact: unknown }).contact).toBeNull();
    });

    it('a whole contact pointer is kept, and configuring something else does not drop it', async () => {
        const set = await run(storage, 'admin.js', OWNER, {
            op: 'configure', contact: { org: 'org-1', ws: 'ws-1', formId: 'frm_x' },
        });
        expect(set.ok).toBe(true);

        // Renaming the shop must not silently take the contact form off the page.
        const renamed = await run(storage, 'admin.js', OWNER, { op: 'configure', name: 'New name' });
        expect(renamed.ok).toBe(true);
        const shop = await storage.getMemory(EXT_OWNER, 'shop');
        const v = shop?.value as { name: string; contact: { formId: string } };
        expect(v.name).toBe('New name');
        expect(v.contact.formId).toBe('frm_x');
    });

    it('an explicit null takes the contact form off the shop front', async () => {
        await run(storage, 'admin.js', OWNER, { op: 'configure', contact: { org: 'o', ws: 'w', formId: 'f' } });
        const off = await run(storage, 'admin.js', OWNER, { op: 'configure', contact: null });
        expect(off.ok).toBe(true);
        const shop = await storage.getMemory(EXT_OWNER, 'shop');
        expect((shop?.value as { contact: unknown }).contact).toBeNull();
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

    // An ext namespace is world-readable, so anything written the default way is served to
    // strangers. The record that names who holds what must not be one of those.
    it('who holds what is private; the shelf number is public and names nobody', async () => {
        await run(storage, 'admin.js', OWNER, { op: 'set_stock', units: { mug: 3 } });
        await run(storage, 'reserve.js', BUYER, { sku: 'mug', qty: 1, reservationId: 'r1', expiresAt: isoIn(60_000) });

        const inventory = await storage.getMemory(EXT_OWNER, 'inventory');
        expect(inventory?.visibility).toBe('private');
        expect(JSON.stringify(inventory?.value)).toContain(BUYER);

        const availability = await storage.getMemory(EXT_OWNER, 'availability');
        expect(availability?.visibility).toBe('public');
        expect((availability?.value as { units: Record<string, number> }).units.mug).toBe(2);
        // The public copy carries counts and nothing else.
        expect(JSON.stringify(availability?.value)).not.toContain(BUYER);
    });

    it('the policy pages are public, and each one says who wrote it', async () => {
        const res = await run(storage, 'admin.js', OWNER, {
            op: 'publish_pages',
            pages: {
                terms: { title: 'Terms', markdown: '# Terms\n\nWe ship in 3 days.' },
                privacy: { title: 'Privacy', markdown: '# Privacy\n\nWe keep your address to post the parcel.' },
            },
        });
        expect(res.ok).toBe(true);

        const record = await storage.getMemory(EXT_OWNER, 'pages');
        expect(record?.visibility).toBe('public');
        const value = record?.value as Record<string, { writtenBy: string; markdown: string }>;
        // A skeleton the operator filled in is a starting point they own, not advice from us, so
        // the page carries an author rather than appearing out of nowhere.
        expect(value.terms.writtenBy).toBe(OWNER.split('@')[0]);
        expect(value.delivery).toBeUndefined();
    });

    it('a page with no text is refused rather than published empty', async () => {
        const res = await run(storage, 'admin.js', OWNER, { op: 'publish_pages', pages: { terms: { title: 'Terms' } } });
        expect(res.ok).toBe(false);
        expect(String(res.error)).toMatch(/needs markdown/);
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
