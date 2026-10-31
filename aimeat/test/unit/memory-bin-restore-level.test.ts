/**
 * @file test/unit/memory-bin-restore-level.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The level a record comes back at from the memory bin (restoreMemoryRecord,
 *   services/memory-bin.ts):
 *   - on a node that shows its content to signed-in accounts only, a public record comes back at
 *     'members', also when every versioned write of the record loses to another write meanwhile
 *     (the level is stored with the restore itself, not by a later versioned write);
 *   - the same restore without that contention comes back at 'members' too, one version on;
 *   - on an open node a public record comes back public, as it went in.
 *   Runs on SQLite in memory, and on Postgres too when DATABASE_URL is set (names carry a run tag there).
 * @usage cd aimeat && pnpm exec vitest run test/unit/memory-bin-restore-level.test.ts
 * @version-history
 *   2026-10-31 — Initial (secaudit 2026-10-31 inv-24).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { requirePostgresWhenAsked } from './postgres-arm.js';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { restoreMemoryRecord } from '../../src/services/memory-bin.js';

requirePostgresWhenAsked('memory-bin-restore-level');

type TestStorage = Storage & { close(): void | Promise<void> };
const names = ['sqlite', ...(process.env.DATABASE_URL ? ['postgres-kysely'] : [])];
const providers = new Map<string, TestStorage>();
const NODE = 'bin-level-test';

beforeAll(async () => {
    for (const name of names) providers.set(name, await createStorage({
        provider: name === 'sqlite' ? 'sqlite' : 'postgres-kysely',
        sqlitePath: ':memory:', dbUrl: process.env.DATABASE_URL,
    }) as TestStorage);
}, 60_000);
afterAll(async () => { for (const s of providers.values()) await s.close(); });

const config = (contentAccess: 'signed-in' | 'anyone') =>
    ({ nodeId: NODE, contentAccess, memoryDeleteGraceDays: 7, classificationMode: 'off' }) as unknown as AimeatConfig;

/** The storage with every versioned write losing, as when another write lands each time. */
function contended(s: Storage): Storage {
    return new Proxy(s, {
        get(target, prop, receiver) {
            if (prop === 'setMemoryIfVersion') return async () => null;
            const v = Reflect.get(target, prop, receiver) as unknown;
            return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
        },
    });
}

describe.each(names)('%s: the level a record comes back at from the bin', provider => {
    const tag = provider === 'sqlite' ? '' : `-${randomUUID().slice(0, 8)}`;
    const owner = `binlevel${tag}`;
    const ghii = `${owner}@${NODE}`;
    const storage = () => providers.get(provider)!;

    beforeAll(async () => {
        const now = new Date().toISOString();
        await storage().createOwner({ name: owner, displayName: owner, publicKey: 'pk', roles: ['owner'], createdAt: now });
        await storage().createGHII({ ghii, username: owner, nodeId: NODE, ownerName: owner, displayName: owner,
            verificationLevel: 0, totpEnabled: false, createdAt: now, updatedAt: now });
    });

    /** A public record of the owner's, written and then put in the bin. */
    async function binnedPublic(key: string): Promise<void> {
        const now = new Date().toISOString();
        await storage().setMemory({
            key, ownerGaii: ghii, value: { text: key }, visibility: 'public', tags: [], ttlHours: null,
            version: 1, createdAt: now, updatedAt: now,
        } as MemoryRecord);
        expect(await storage().deleteMemory(ghii, key, ghii)).toBe(true);
    }
    const restore = (s: Storage, contentAccess: 'signed-in' | 'anyone', key: string) =>
        restoreMemoryRecord({ storage: s, config: config(contentAccess) }, { caller: ghii, ownerName: owner, key, roles: ['owner'], ownerScope: true });

    it('closed node, every versioned write losing: the public record comes back at members, never public', async () => {
        await binnedPublic('bin.level.contended');
        const out = await restore(contended(storage()), 'signed-in', 'bin.level.contended');
        expect(out.ok).toBe(true);
        expect((await storage().getMemory(ghii, 'bin.level.contended'))?.visibility).toBe('members');
    });

    it('closed node: the public record comes back at members, one version on, with its value', async () => {
        await binnedPublic('bin.level.closed');
        const out = await restore(storage(), 'signed-in', 'bin.level.closed');
        expect(out.ok).toBe(true);
        const back = await storage().getMemory(ghii, 'bin.level.closed');
        expect(back?.visibility).toBe('members');
        expect(back?.version).toBe(2);
        expect(back?.value).toEqual({ text: 'bin.level.closed' });
    });

    it('open node: the public record comes back public, as it went in', async () => {
        await binnedPublic('bin.level.open');
        const out = await restore(storage(), 'anyone', 'bin.level.open');
        expect(out.ok).toBe(true);
        const back = await storage().getMemory(ghii, 'bin.level.open');
        expect(back?.visibility).toBe('public');
        expect(back?.version).toBe(1);
        expect(back?.value).toEqual({ text: 'bin.level.open' });
    });
});
