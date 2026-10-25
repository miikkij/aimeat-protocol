/**
 * @file component-address.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Extension and cortex names live in the owner's namespace (services/component-address.ts;
 *   wish wish-cortex-and-extension-names-live-in-the-owner-s-namespace, secaudit2026oct22 leads 589
 *   and 2827). The node cannot make a bare name any more, so a bare record is written straight into
 *   storage here, as one installed before the change: its holder's namespace reaches it as an alias,
 *   a bare call keeps reaching it, its uninstall writes the name down for the holder, and only the
 *   holder takes it back. Run against every provider: the released-name rows are new storage.
 *
 *   A plain local run without DATABASE_URL checks SQLite only, as storage-conformance.test.ts does.
 * @usage cd aimeat && pnpm exec vitest run test/unit/component-address.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (owner namespaces wish, secaudit2026oct22).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { requirePostgresWhenAsked } from './postgres-arm.js';
import { rmSync, existsSync } from 'node:fs';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage, ExtensionRecord } from '../../src/storage/interface.js';
import {
    splitComponentAddress, findExtension, installNameFor, placeExtensionInstall, extensionCallTarget,
    cortexLibPath, idStemOf, settleReclaimed,
} from '../../src/services/component-address.js';
import { uninstallExtension } from '../../src/services/extension-lifecycle.js';

requirePostgresWhenAsked('component-address');

const SQLITE_PATH = `./test/.component-address-${process.pid}.db`;
const PG_URL = process.env.DATABASE_URL ?? '';

interface Provider { name: string; storage: Storage }
const provs: Provider[] = [];

beforeAll(async () => {
    provs.push({ name: 'sqlite', storage: await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH }) });
    if (PG_URL) provs.push({ name: 'postgres-kysely', storage: await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL }) });
}, 60_000);

afterAll(async () => {
    for (const { storage } of provs) await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
    for (const suffix of ['', '-wal', '-shm']) {
        const p = SQLITE_PATH + suffix;
        if (existsSync(p)) { try { rmSync(p); } catch { /* the test's own scratch file */ } }
    }
});

const stamp = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

/** An extension record as an install writes it, under exactly the name given. */
function extRecord(name: string, installedBy: string): ExtensionRecord {
    const now = new Date().toISOString();
    return {
        name, version: '1.0.0', description: 'namespace test', author: 'test', status: 'active',
        requiredApis: [], actions: [{ id: 'run', method: 'POST', path: '/run', inputSchema: {}, outputSchema: {}, scriptContent: 'export default async () => 1;' }],
        config: {}, limits: { memoryMb: 16, timeoutMs: 1000, maxApiCalls: 1 }, federation: { advertise: false, capabilities: [] },
        installedBy, installedAt: now,
    } as ExtensionRecord;
}

describe('the address form', () => {
    it('splits `<owner>/<name>` and nothing else', () => {
        expect(splitComponentAddress('alice/weather')).toEqual({ owner: 'alice', name: 'weather' });
        expect(splitComponentAddress('weather')).toBeNull();
        expect(splitComponentAddress('a/b/c')).toBeNull();
        expect(splitComponentAddress('/weather')).toBeNull();
        expect(splitComponentAddress('Alice/weather')).toBeNull();
    });
    it('writes a namespaced lib address with two segments, and a bare one as before', () => {
        expect(cortexLibPath('alice/ui', 'ui.js')).toBe('/v1/cortex/alice/ui/libs/ui.js');
        expect(cortexLibPath('alice/ui', 'ui.js', '1.2.0')).toBe('/v1/cortex/alice/ui@1.2.0/libs/ui.js');
        expect(cortexLibPath('aimeat-input', 'aimeat-input.js')).toBe('/v1/cortex/aimeat-input/libs/aimeat-input.js');
    });
    it('gives an id stem without a slash, and a bare name its old stem', () => {
        expect(idStemOf('alice/recipes')).toBe('alice-recipes');
        expect(idStemOf('recipes')).toBe('recipes');
    });
});

describe('names live in the owner\'s namespace, on every provider', () => {
    it('a bare record is reached through its holder, a bare call keeps it, and the shipped one through system', async () => {
        for (const { name, storage } of provs) {
            const s = stamp();
            const holder = `hold${s}`, other = `oth${s}`, legacy = `legacy${s}`, shipped = `shipped${s}`;
            await storage.createExtension(extRecord(legacy, holder));
            await storage.createExtension(extRecord(shipped, 'system'));

            expect((await findExtension(storage, `${holder}/${legacy}`))?.name, `${name}: the holder's alias`).toBe(legacy);
            expect(await findExtension(storage, `${other}/${legacy}`), `${name}: another account's prefix is no alias`).toBeNull();
            expect((await findExtension(storage, legacy, other))?.name, `${name}: a bare call keeps the bare record`).toBe(legacy);
            expect((await findExtension(storage, `system/${shipped}`))?.name, `${name}: the shipped alias`).toBe(shipped);

            // Another account installs the same short name: it lands in its own namespace, and its own
            // management names its own first, while a bare call still means the published record.
            const placed = extRecord(legacy, other);
            expect((await placeExtensionInstall(storage, other, placed)).existing, `${name}: nothing of the other's yet`).toBeNull();
            expect(placed.name).toBe(`${other}/${legacy}`);
            await storage.createExtension(placed);
            expect((await findExtension(storage, legacy, other, 'manage'))?.name, `${name}: manage reads own first`).toBe(`${other}/${legacy}`);
            expect((await findExtension(storage, legacy, other))?.name, `${name}: a call reads the bare record first`).toBe(legacy);

            // The holder's own install of the same short name is the legacy record, not a second one.
            const again = extRecord(legacy, holder);
            expect((await placeExtensionInstall(storage, holder, again)).existing?.name, `${name}: the holder's own`).toBe(legacy);
        }
    });

    it('an uninstall writes a bare name down; only its holder takes it back, and then it is no longer released', async () => {
        for (const { name, storage } of provs) {
            const s = stamp();
            const holder = `hold${s}`, other = `oth${s}`, legacy = `legacy${s}`;
            await storage.createExtension(extRecord(legacy, holder));
            expect(await uninstallExtension({ storage, scheduler: undefined }, legacy), `${name}: uninstalled`).toBe(true);
            expect((await storage.getReleasedComponentName('extension', legacy))?.holder, `${name}: released with its holder`).toBe(holder);

            // Nobody else can have it, and the old instance address does not move to an account named like it.
            expect((await installNameFor(storage, 'extension', other, legacy)).name).toBe(`${other}/${legacy}`);
            expect(await extensionCallTarget(storage, legacy, 'inst', other), `${name}: still the instance form`).toEqual({ extRef: legacy, instanceId: 'inst' });

            const back = await installNameFor(storage, 'extension', holder, legacy);
            expect(back, `${name}: the holder reclaims the bare name`).toMatchObject({ name: legacy, reclaimed: true });
            await storage.createExtension(extRecord(legacy, holder));
            await settleReclaimed(storage, 'extension', legacy);
            expect(await storage.getReleasedComponentName('extension', legacy), `${name}: settled`).toBeNull();
            expect(await storage.deleteReleasedComponentName('extension', legacy)).toBe(false);
        }
    });

    it('a namespaced uninstall writes nothing, and a later release of a bare name replaces the row', async () => {
        for (const { name, storage } of provs) {
            const s = stamp();
            const owner = `own${s}`, short = `ns${s}`;
            await storage.createExtension(extRecord(`${owner}/${short}`, owner));
            await uninstallExtension({ storage, scheduler: undefined }, `${owner}/${short}`);
            expect(await storage.getReleasedComponentName('extension', `${owner}/${short}`), `${name}: nothing to write`).toBeNull();

            await storage.recordReleasedComponentName({ kind: 'cortex', name: short, holder: 'first', releasedAt: new Date().toISOString() });
            await storage.recordReleasedComponentName({ kind: 'cortex', name: short, holder: owner, releasedAt: new Date().toISOString() });
            expect((await storage.getReleasedComponentName('cortex', short))?.holder, `${name}: the later row`).toBe(owner);
            expect(await storage.getReleasedComponentName('extension', short), `${name}: kinds are apart`).toBeNull();
            expect(await storage.deleteReleasedComponentName('cortex', short)).toBe(true);
        }
    });

    it('the three-segment call path: a known bare name is the instance form, else the caller\'s own, else `<owner>/<name>`', async () => {
        for (const { name, storage } of provs) {
            const s = stamp();
            const alice = `alice${s}`, bob = `bob${s}`;
            await storage.createExtension(extRecord(`${alice}/wx`, alice));
            expect(await extensionCallTarget(storage, alice, 'wx', bob), `${name}: literal owner/name`).toEqual({ extRef: `${alice}/wx` });
            await storage.createExtension(extRecord(`${bob}/tool`, bob));
            expect(await extensionCallTarget(storage, 'tool', 'i1', bob), `${name}: own with an instance`).toEqual({ extRef: 'tool', instanceId: 'i1' });
            expect(await extensionCallTarget(storage, `${alice}/wx`, 'i2', bob), `${name}: an encoded name with an instance`).toEqual({ extRef: `${alice}/wx`, instanceId: 'i2' });
        }
    });
});
