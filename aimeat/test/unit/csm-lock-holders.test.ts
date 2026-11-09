/**
 * @file test/unit/csm-lock-holders.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The locks under `csm.` that an account other than the CSM's registering account held
 *   from before round 15 (secaudit2026nov08b round 15, D1), with the real store (PostgreSQL too when
 *   DATABASE_URL is set): the once-only boot step (services/csm/csm-lock-holders.ts) and the DELETE half
 *   of rule 5 (services/schema-lock-rule.ts csmLockRemovalRefusal).
 *
 *   Attack: another account holds the lock at a CSM's own key, an exact row and a wildcard row under its
 *   keys, the lock of a package CSM that has no row of its own, a template's lock, a pattern over every
 *   CSM, and a later account of an erased author's name holds that author's CSM lock. Such a holder
 *   removed a CSM's own lock with DELETE, and kept every row from the CSM's registering account.
 *   After the step: a row under one live registering account's CSMs is that account's (and it is told),
 *   every other one names an erasure pseudonym, and no row's content changed.
 *   Usage: the registering account's own, its GHII's and its agent's rows, the seeder's, the operator's,
 *   an extension's, a pseudonym's and a row that reaches no CSM are untouched. The registering account,
 *   its agent and the operator still remove a CSM's own lock, and every holder still removes a row that
 *   is not a CSM's own. A second run does nothing.
 * @usage cd aimeat && pnpm exec vitest run test/unit/csm-lock-holders.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08b round 15, D1).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { rmSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { requirePostgresWhenAsked } from './postgres-arm.js';

vi.mock('../../src/utils/logger.js', async (importOriginal) => {
    const real = await importOriginal<Record<string, unknown>>();
    const quiet: unknown = new Proxy({}, { get: () => () => quiet });
    return { ...real, logger: quiet };
});

import { createStorage } from '../../src/storage/storage-factory.js';
import { moveCsmLockHoldersOnce } from '../../src/services/csm/csm-lock-holders.js';
import { csmLockRemovalRefusal } from '../../src/services/schema-lock-rule.js';
import type { SchemaRecord, Storage } from '../../src/storage/interface.js';

requirePostgresWhenAsked('csm-lock-holders');

const SQLITE_PATH = `./test/.csm-lock-holders-${process.pid}.db`;
const PG_URL = process.env.DATABASE_URL ?? '';
const provs: Array<{ name: string; storage: Storage }> = [];

beforeAll(async () => {
    provs.push({ name: 'sqlite', storage: await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH }) });
    if (PG_URL) provs.push({ name: 'postgres-kysely', storage: await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL }) });
}, 60_000);

afterAll(async () => {
    for (const { storage } of provs) await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
    for (const suffix of ['', '-wal', '-shm']) {
        const p = SQLITE_PATH + suffix;
        if (existsSync(p)) { try { rmSync(p); } catch { /* the test's own scratch */ } }
    }
});

const LOCK_AT = '2026-02-01T00:00:00.000Z';
const CSM_AT = '2026-03-01T00:00:00.000Z';
const SHAPE = { type: 'object', properties: { theirs: { type: 'string' } } };
const lock = (keyPattern: string, lockedBy: string, applyTo: 'exact' | 'prefix' = 'prefix'): SchemaRecord => ({
    keyPattern, applyTo, schemaJson: SHAPE, schemaMode: 'open', lockedBy, setAt: LOCK_AT, updatedAt: LOCK_AT,
});

describe.each([['sqlite'], ...(PG_URL ? [['postgres-kysely']] : [])])('the locks under csm. another account holds (%s)', (provider) => {
    it('gives each to the registering account or a pseudonym, leaves the rightful ones, keeps every schema, and runs once', async () => {
        const storage = provs.find(p => p.name === provider)!.storage;
        const node = `aimeat-csmlocks-${randomUUID().slice(0, 8)}`;
        const config = { nodeId: node } as never;
        const s = Date.now() % 1_000_000;
        const a = `cla${s}`, bob = `clb${s}`, e = `cle${s}`, op = `clop${s}`;
        const owner = (name: string, createdAt: string, roles = ['owner']) =>
            storage.createOwner({ name, displayName: name, publicKey: 'pk', roles, createdAt } as never);
        await owner(a, '2026-01-01T00:00:00.000Z');
        await owner(bob, '2026-01-01T00:00:00.000Z');
        await owner(e, '2026-06-01T00:00:00.000Z');
        await owner(op, '2026-01-01T00:00:00.000Z', ['owner', 'operator']);
        const csm = (name: string, registeredBy: string) => storage.createCsm({
            name, definition: { service: { name, type: 'data' } }, jsonSchemaKey: `csm.${name}`, serviceType: 'data',
            registeredBy, registeredAt: CSM_AT, updatedAt: CSM_AT, visibility: 'public', version: 1,
        });
        const sensor = `${a}.sensor${s}`, pkg = `${a}.pkg${s}`, gauge = `${e}.gauge${s}`, tmpl = `cltmpl${s}`;
        await csm(sensor, a);
        await csm(pkg, a);
        await csm(gauge, e);
        await csm(tmpl, `system@${node}`);

        const given = [
            lock(`csm.${sensor}`, bob), lock(`csm.${pkg}`, `bot#${bob}@${node}`),
            lock(`csm.${sensor}.x`, bob, 'exact'), lock(`csm.${a}.*`, `${bob}@${node}`),
        ];
        const pseudonymised = [lock(`csm.${gauge}`, e), lock(`csm.${tmpl}`, bob), lock('csm.*', bob)];
        const left = [
            lock(`csm.${sensor}.y`, `${a}@${node}`, 'exact'), lock(`csm.${sensor}.z`, `bot#${a}@${node}`, 'exact'),
            lock(`csm.${sensor}.u`, a, 'exact'), lock(`csm.${tmpl}.x`, `system@${node}`, 'exact'),
            lock(`csm.${sensor}.w`, op, 'exact'), lock(`csm.${sensor}.v`, 'ext:notes', 'exact'),
            lock(`csm.${sensor}.t`, 'erased:0123456789abcdef01234567', 'exact'), lock(`csm.clfree${s}.x`, bob),
        ];
        const all = [...given, ...pseudonymised, ...left];
        for (const l of all) await storage.setSchema(l);

        // The DELETE half of rule 5, before the step: bob holds the lock at a's CSM's own key and may not remove it.
        const caller = (owner: string, principal = `${owner}@${node}`, isOperator = false) => ({ principal, owner, roles: ['owner'], isOperator });
        expect((await csmLockRemovalRefusal(storage, caller(bob), given[0]!))?.code).toBe('SCHEMA_PATTERN_NOT_YOURS');
        expect((await csmLockRemovalRefusal(storage, caller(e), pseudonymised[0]!))?.code).toBe('SCHEMA_PATTERN_NOT_YOURS');
        expect(await csmLockRemovalRefusal(storage, caller(a), given[0]!)).toBeNull();
        expect(await csmLockRemovalRefusal(storage, caller(a, `bot#${a}@${node}`), given[0]!)).toBeNull();
        expect(await csmLockRemovalRefusal(storage, caller(op, `${op}@${node}`, true), given[0]!)).toBeNull();
        expect(await csmLockRemovalRefusal(storage, caller(bob), given[2]!)).toBeNull();
        expect(await csmLockRemovalRefusal(storage, caller(bob), left[7]!)).toBeNull();

        const ran = await moveCsmLockHoldersOnce(storage, config);
        expect(ran).toMatchObject({ given: given.length, pseudonymised: pseudonymised.length });

        for (const l of given) {
            const now = (await storage.getSchema(l.keyPattern, l.applyTo))!;
            expect(now.lockedBy, l.keyPattern).toBe(a);
            expect(now.schemaJson).toEqual(SHAPE);
        }
        const names = new Set<string>();
        for (const l of pseudonymised) {
            const now = (await storage.getSchema(l.keyPattern, l.applyTo))!;
            expect(now.lockedBy, l.keyPattern).toMatch(/^erased:[0-9a-f]{24}$/);
            expect(now.schemaJson).toEqual(SHAPE);
            if (l.lockedBy === bob) names.add(now.lockedBy);
        }
        expect(names.size).toBe(1);
        for (const l of left) expect((await storage.getSchema(l.keyPattern, l.applyTo))!.lockedBy, l.keyPattern).toBe(l.lockedBy);

        const told = (await storage.listMemory(`${a}@${node}`, { prefix: 'notif.' })).filter(m => (m.value as { type?: string }).type === 'csm_lock_yours');
        expect(told).toHaveLength(given.length);
        expect(JSON.stringify(told.map(m => m.value))).toContain(`csm.${sensor}`);

        // A second run does nothing.
        await storage.setSchema(lock(`csm.${sensor}.late`, bob, 'exact'));
        expect(await moveCsmLockHoldersOnce(storage, config)).toBeNull();
        expect((await storage.getSchema(`csm.${sensor}.late`, 'exact'))!.lockedBy).toBe(bob);

        for (const l of [...all, lock(`csm.${sensor}.late`, bob, 'exact')]) await storage.deleteSchema(l.keyPattern, l.applyTo);
        for (const name of [sensor, pkg, gauge, tmpl]) await storage.deleteCsm(name);
    });
});
