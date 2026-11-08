/**
 * @file test/unit/erased-lock-holders.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The once-only boot step for the schema locks of accounts erased before
 *   secaudit2026nov08 round 14 (services/csm/erased-lock-holders.ts), with the real store (PostgreSQL too
 *   when DATABASE_URL is set).
 *
 *   Attack: a lock an erased account set (as the bare name, the GHII and an agent's GAII) still names
 *   the account, so a later account of that name would hold it; the step gives all three ONE pseudonym.
 *   Ambiguous: a lock older than the account that holds its holder's name now is left as it is and
 *   named on the Security page; the operator's 'pseudonymise' moves it, 'keep' leaves it. Usage: a live
 *   holder's lock, the system's, a reserved name's, an extension's, an ecosystem app's, another node's
 *   and a pseudonym's are untouched. A second run does nothing, and a node whose locks are all live
 *   sees no change and no incident.
 * @usage cd aimeat && pnpm exec vitest run test/unit/erased-lock-holders.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08 round 14b, item C).
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
import {
    moveErasedLockHoldersOnce, lockHolderAccount, ERASED_LOCK_INCIDENT_TYPE, ERASED_LOCK_HOLDERS_KEY,
} from '../../src/services/csm/erased-lock-holders.js';
import { decideIncidentCase } from '../../src/services/incident-decisions.js';
import { listSecurityIncidents, type SecurityIncidentValue } from '../../src/services/security-incident.js';
import type { SchemaRecord, Storage } from '../../src/storage/interface.js';

requirePostgresWhenAsked('erased-lock-holders');

const SQLITE_PATH = `./test/.erased-locks-${process.pid}.db`;
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
const lock = (keyPattern: string, lockedBy: string, setAt = LOCK_AT): SchemaRecord => ({
    keyPattern, applyTo: 'prefix', schemaJson: { type: 'object' }, schemaMode: 'open', lockedBy, setAt, updatedAt: setAt,
});

describe('lockHolderAccount', () => {
    const node = 'aimeat-test-001-lock';
    it('names the account of a bare name, a GHII and an agent GAII of this node', () => {
        expect(lockHolderAccount('alice', node)).toBe('alice');
        expect(lockHolderAccount(`alice@${node}`, node)).toBe('alice');
        expect(lockHolderAccount(`bot#alice@${node}`, node)).toBe('alice');
    });
    it('names nobody for the system, a reserved name, a principal that is not an account\'s, another node or a pseudonym', () => {
        for (const h of [`system@${node}`, 'operator', `operator@${node}`, 'ext:notes', `eco:drum#alice@${node}`, 'schedule:abc',
            'erased:0123456789abcdef01234567', 'alice@aimeat-other-002-node', `bot#alice@aimeat-other-002-node`, 'bot#alice', 'A B', '']) {
            expect(lockHolderAccount(h, node), h).toBeNull();
        }
    });
});

describe.each([['sqlite'], ...(PG_URL ? [['postgres-kysely']] : [])])('the locks of accounts erased before round 14 (%s)', (provider) => {
    it('moves an erased holder\'s locks to one pseudonym, asks about a reused name, leaves the rest, and runs once', async () => {
        const storage = provs.find(p => p.name === provider)!.storage;
        const node = `aimeat-locks-${randomUUID().slice(0, 8)}`;
        const config = { nodeId: node } as never;
        const s = Date.now() % 1_000_000;
        const gone = `gone${s}`, reborn = `reborn${s}`, alive = `alive${s}`;
        await storage.createOwner({ name: alive, displayName: alive, publicKey: 'pk', roles: ['owner'], createdAt: '2026-01-01T00:00:00.000Z' } as never);
        await storage.createOwner({ name: reborn, displayName: reborn, publicKey: 'pk', roles: ['owner'], createdAt: new Date().toISOString() } as never);

        const p = `t${s}`;
        const goneLocks = [lock(`${p}.gone-bare`, gone), lock(`${p}.gone-ghii`, `${gone}@${node}`), lock(`${p}.gone-agent`, `bot#${gone}@${node}`)];
        const rebornLock = lock(`${p}.reborn`, `${reborn}@${node}`);
        const left = [
            lock(`${p}.alive`, `${alive}@${node}`), lock(`${p}.system`, `system@${node}`), lock(`${p}.reserved`, 'operator'),
            lock(`${p}.ext`, 'ext:notes'), lock(`${p}.eco`, `eco:drum#${gone}@${node}`), lock(`${p}.other-node`, `${gone}@aimeat-other-002-node`),
            lock(`${p}.erased`, 'erased:0123456789abcdef01234567'),
        ];
        for (const l of [...goneLocks, rebornLock, ...left]) await storage.setSchema(l);

        const ran = await moveErasedLockHoldersOnce(storage, config);
        expect(ran?.moved).toBeGreaterThanOrEqual(3);

        // The attack's red line: before the step, a later account named `gone` held these three locks.
        const after = await Promise.all(goneLocks.map(l => storage.getSchema(l.keyPattern, 'prefix')));
        const pseudonyms = new Set(after.map(l => l!.lockedBy));
        expect(pseudonyms.size).toBe(1);
        expect([...pseudonyms][0]).toMatch(/^erased:[0-9a-f]{24}$/);
        for (const l of after) expect(l!.schemaJson).toEqual({ type: 'object' });

        expect((await storage.getSchema(rebornLock.keyPattern, 'prefix'))!.lockedBy).toBe(rebornLock.lockedBy);
        for (const l of left) expect((await storage.getSchema(l.keyPattern, 'prefix'))!.lockedBy, l.keyPattern).toBe(l.lockedBy);

        const incidents = (await listSecurityIncidents(storage, config)).items.filter(i => i.type === ERASED_LOCK_INCIDENT_TYPE);
        expect(incidents).toHaveLength(1);
        const inc = incidents[0] as SecurityIncidentValue;
        const mine = (inc.entries ?? []).filter(e => e.id === `prefix:${rebornLock.keyPattern}`);
        expect(mine).toHaveLength(1);
        expect(mine[0]).toMatchObject({ action: 'pseudonymise', status: 'open', kind: 'schema_lock' });
        expect((inc.entries ?? []).some(e => String(e.params?.pattern ?? '').startsWith(`${p}.`) && e.id !== mine[0]!.id)).toBe(false);

        // A second run does nothing.
        await storage.setSchema(lock(`${p}.gone-late`, gone));
        expect(await moveErasedLockHoldersOnce(storage, config)).toBeNull();
        expect((await storage.getSchema(`${p}.gone-late`, 'prefix'))!.lockedBy).toBe(gone);
        expect((await listSecurityIncidents(storage, config)).items.filter(i => i.type === ERASED_LOCK_INCIDENT_TYPE)).toHaveLength(1);

        // The operator decides: 'pseudonymise' moves the reused name's lock, a second decision is a conflict.
        const by = { principal: `op@${node}`, kind: 'human' as const };
        const wrong = await decideIncidentCase(config, storage, { incidentId: inc.id, name: mine[0]!.id, resolution: 'delete', by });
        expect(wrong).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
        const moved = await decideIncidentCase(config, storage, { incidentId: inc.id, name: mine[0]!.id, resolution: 'pseudonymise', by });
        expect(moved).toMatchObject({ ok: true });
        expect((await storage.getSchema(rebornLock.keyPattern, 'prefix'))!.lockedBy).toMatch(/^erased:[0-9a-f]{24}$/);
        const again = await decideIncidentCase(config, storage, { incidentId: inc.id, name: mine[0]!.id, resolution: 'keep', by });
        expect(again).toMatchObject({ ok: false, code: 'CONFLICT' });

        for (const l of [...goneLocks, rebornLock, ...left]) await storage.deleteSchema(l.keyPattern);
        await storage.deleteSchema(`${p}.gone-late`);
        await storage.deleteMemory(`system@${node}`, ERASED_LOCK_HOLDERS_KEY);
    });

    it('\'keep\' leaves a reused name\'s lock with the account that holds the name', async () => {
        const storage = provs.find(p => p.name === provider)!.storage;
        const node = `aimeat-locks-${randomUUID().slice(0, 8)}`;
        const config = { nodeId: node } as never;
        const s = Date.now() % 1_000_000;
        const reborn = `kept${s}`;
        await storage.createOwner({ name: reborn, displayName: reborn, publicKey: 'pk', roles: ['owner'], createdAt: new Date().toISOString() } as never);
        const l = lock(`k${s}.reborn`, reborn);
        await storage.setSchema(l);
        await moveErasedLockHoldersOnce(storage, config);
        const inc = (await listSecurityIncidents(storage, config)).items.find(i => i.type === ERASED_LOCK_INCIDENT_TYPE) as SecurityIncidentValue;
        const r = await decideIncidentCase(config, storage, { incidentId: inc.id, name: `prefix:${l.keyPattern}`, resolution: 'keep', by: { principal: `op@${node}`, kind: 'human' } });
        expect(r).toMatchObject({ ok: true });
        expect((await storage.getSchema(l.keyPattern, 'prefix'))!.lockedBy).toBe(reborn);
        await storage.deleteSchema(l.keyPattern);
        await storage.deleteMemory(`system@${node}`, ERASED_LOCK_HOLDERS_KEY);
    });

    it('a node whose locks are all live sees no change and no incident', async () => {
        const storage = provs.find(p => p.name === provider)!.storage;
        const node = `aimeat-locks-${randomUUID().slice(0, 8)}`;
        const config = { nodeId: node } as never;
        const s = Date.now() % 1_000_000;
        const alive = `live${s}`;
        await storage.createOwner({ name: alive, displayName: alive, publicKey: 'pk', roles: ['owner'], createdAt: '2026-01-01T00:00:00.000Z' } as never);
        const l = lock(`l${s}.alive`, `claude#${alive}@${node}`);
        await storage.setSchema(l);
        const ran = await moveErasedLockHoldersOnce(storage, config);
        expect(ran?.asked).toEqual([]);
        expect((await storage.getSchema(l.keyPattern, 'prefix'))!.lockedBy).toBe(l.lockedBy);
        expect((await listSecurityIncidents(storage, config)).items.filter(i => i.type === ERASED_LOCK_INCIDENT_TYPE)).toHaveLength(0);
        await storage.deleteSchema(l.keyPattern);
        await storage.deleteMemory(`system@${node}`, ERASED_LOCK_HOLDERS_KEY);
    });
});
