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
 *   v1.2.0 — 2026-10-27 — A bare install of a name another account keeps under its own lands in the
 *     installer's namespace; a shipped cortex name's bare address reaches no account's copy
 *     (secaudit2026oct26).
 *   v1.1.0 — 2026-10-26 — The owner's short file key and memory owner (ownExtensionFileKey, ownExtensionMemoryOwner).
 *   v1.0.0 — 2026-10-25 — Initial (owner namespaces wish, secaudit2026oct22).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { requirePostgresWhenAsked } from './postgres-arm.js';
import { rmSync, existsSync } from 'node:fs';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage, ExtensionRecord } from '../../src/storage/interface.js';
import {
    splitComponentAddress, findExtension, findCortex, installNameFor, placeExtensionInstall, extensionCallTarget,
    cortexLibPath, idStemOf, settleReclaimed, ownExtensionFileKey, ownExtensionMemoryOwner, withOwnerFields,
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

            // Another account installing the same short name meets the record that holds it, as always
            // (the door refuses), and keeps the bare name.
            const placed = extRecord(legacy, other);
            expect((await placeExtensionInstall(storage, other, placed)).existing?.installedBy, `${name}: the holder's record is in the way`).toBe(holder);
            expect(placed.name).toBe(legacy);

            // A free name keeps its bare form; one asked for in full lands in the installer's namespace.
            const fresh = extRecord(`fresh${s}`, other);
            expect((await placeExtensionInstall(storage, other, fresh)).existing).toBeNull();
            expect(fresh.name, `${name}: a new install keeps its bare name`).toBe(`fresh${s}`);
            const full = extRecord(`${other}/${legacy}`, other);
            expect((await placeExtensionInstall(storage, other, full)).existing).toBeNull();
            expect(full.name, `${name}: asked for in full`).toBe(`${other}/${legacy}`);
            await storage.createExtension(full);
            expect((await findExtension(storage, legacy, other, 'manage'))?.name, `${name}: manage reads own first`).toBe(`${other}/${legacy}`);
            expect((await findExtension(storage, legacy, other))?.name, `${name}: a call reads the bare record first`).toBe(legacy);
            expect(withOwnerFields(full), `${name}: the answer keeps the short name`).toMatchObject({ name: legacy, owner: other, full_name: `${other}/${legacy}` });
        }
    });

    it('a bare name only one account holds in its namespace reaches it; two such accounts are named in the refusal', async () => {
        for (const { name, storage } of provs) {
            const s = stamp();
            const alice = `alice${s}`, bob = `bob${s}`, carol = `carol${s}`, short = `solo${s}`;
            await storage.createExtension(extRecord(`${alice}/${short}`, alice));
            expect((await findExtension(storage, short))?.name, `${name}: a visitor reaches the one holder`).toBe(`${alice}/${short}`);
            expect((await findExtension(storage, short, carol))?.name, `${name}: so does another account`).toBe(`${alice}/${short}`);
            await storage.createExtension(extRecord(`${bob}/${short}`, bob));
            expect((await findExtension(storage, short, bob))?.name, `${name}: the caller's own first`).toBe(`${bob}/${short}`);
            await expect(findExtension(storage, short, carol), `${name}: two holders`).rejects.toMatchObject({ code: 'AMBIGUOUS_NAME', fullNames: [`${alice}/${short}`, `${bob}/${short}`] });
        }
    });

    // secaudit2026oct26: a bare install by another account does not take the bare address that
    // reaches the one account keeping the name under its own; it lands in its own namespace, as a
    // second namespaced holder does, and the bare address answers by the two-holder rule.
    it('a bare install of a short name another account keeps under its own lands in the installer\'s namespace', async () => {
        for (const { name, storage } of provs) {
            const s = stamp();
            const bea = `bea${s}`, cid = `cid${s}`, short = `kept${s}`;
            await storage.createExtension(extRecord(`${bea}/${short}`, bea));
            const placed = extRecord(short, cid);
            expect((await placeExtensionInstall(storage, cid, placed)).existing, `${name}: nothing in the way`).toBeNull();
            expect(placed.name, `${name}: stored in the installer's namespace`).toBe(`${cid}/${short}`);
            // The holder keeps its own name, and a name nobody keeps is still installed bare.
            const own = extRecord(short, bea);
            await placeExtensionInstall(storage, bea, own);
            expect(own.name, `${name}: the holder's own`).toBe(`${bea}/${short}`);
            const free = extRecord(`free${s}`, cid);
            await placeExtensionInstall(storage, cid, free);
            expect(free.name, `${name}: a free name stays bare`).toBe(`free${s}`);
        }
    });

    // secaudit2026oct26: a shipped cortex name is the node's own; with the bundled record missing, the
    // bare address reaches no account's namespaced copy of it, which its full address still reaches.
    it('the bare address of a shipped cortex name never falls back to an account\'s namespaced copy', async () => {
        const { bundledCortexNames } = await import('../../src/services/cortex-seeder.js');
        const shipped = [...bundledCortexNames()][0]!;
        expect(shipped, 'the build ships at least one cortex').toBeTruthy();
        for (const { name, storage } of provs) {
            if (await storage.getCortexExtension(shipped)) continue;
            const s = stamp();
            const alice = `alice${s}`;
            const now = new Date().toISOString();
            await storage.createCortexExtension({
                name: `${alice}/${shipped}`, namespace: alice, shortName: shipped, apiVersion: 'cortex.aimeat.org/v1', version: '1.0.0',
                description: 'namespace test', author: 'test', tags: [], labels: {}, status: 'active', visibility: 'public',
                installedAt: now, installedBy: alice, manifest: '', components: [], activationArtifacts: {} as never,
            } as never);
            expect(await findCortex(storage, shipped), `${name}: the shipped bare address`).toBeNull();
            expect((await findCortex(storage, `${alice}/${shipped}`))?.name, `${name}: the full address`).toBe(`${alice}/${shipped}`);
            expect((await findCortex(storage, shipped, alice))?.name, `${name}: the holder's own bare call`).toBe(`${alice}/${shipped}`);
            await storage.deleteCortexExtension(`${alice}/${shipped}`);
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

    it('the owner\'s short file key and memory owner name the stored ones, and nobody else\'s', async () => {
        for (const { name, storage } of provs) {
            const s = stamp();
            const alice = `alice${s}`, bob = `bob${s}`;
            await storage.createExtension(extRecord(`${alice}/tally`, alice));
            expect(await ownExtensionFileKey(storage, 'ext/tally/morning.txt', alice), `${name}: the owner's file`).toBe(`ext/${alice}/tally/morning.txt`);
            expect(await ownExtensionMemoryOwner(storage, 'ext:tally', alice), `${name}: the owner's memory`).toBe(`ext:${alice}/tally`);
            expect(await ownExtensionMemoryOwner(storage, 'ext:tally.i1', alice), `${name}: an instance`).toBe(`ext:${alice}/tally.i1`);
            expect(await ownExtensionFileKey(storage, 'ext/tally/morning.txt', bob), `${name}: another account`).toBeNull();
            expect(await ownExtensionMemoryOwner(storage, 'ext:tally', bob), `${name}: another account's memory`).toBeNull();
            expect(await ownExtensionFileKey(storage, 'notes/tally.txt', alice), `${name}: not an extension key`).toBeNull();
        }
    });
});
