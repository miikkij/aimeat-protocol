/**
 * @file test/unit/erasure-leftover-schedules.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The schedules that account erasures before 2026-10-25 left are named once on the
 *   Security page, one entry per schedule, nothing deleted, and the operator deletes or keeps each
 *   one from the incident (services/erasure-leftover-schedules.ts, services/incident-entries.ts).
 *
 *   WHY. An erasure deleted only the jobs the person made; a job one of their agents made kept the
 *   account as its ownerScope, was listed to the next holder of the name and fired as that holder's
 *   agent of the same name (secaudit2026oct22, owner-erasure:agent-made-schedules-survive-and-rebind).
 *
 *   With the real store (PostgreSQL too when DATABASE_URL is set): a job of an account no one holds
 *   and a job older than the account that holds its name now are named; a job an agent made in an
 *   account older than the job (an agent registered again under the same name keeps its schedules),
 *   a core job and a job of another node are not. A second run opens no second incident. Delete
 *   removes the named job and nothing else; keep leaves it; the last decision resolves the incident.
 * @usage cd aimeat && pnpm exec vitest run test/unit/erasure-leftover-schedules.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-25 -- Initial (secaudit2026oct22).
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
import { reportErasureLeftoverSchedulesOnce, ERASURE_LEFTOVER_INCIDENT_TYPE, ERASURE_LEFTOVER_SCHEDULES_KEY } from '../../src/services/erasure-leftover-schedules.js';
import { decideIncidentCase } from '../../src/services/incident-decisions.js';
import { listSecurityIncidents, type SecurityIncidentValue } from '../../src/services/security-incident.js';
import type { ScheduledJobRecord, Storage } from '../../src/storage/interface.js';

requirePostgresWhenAsked('erasure-leftover-schedules');

const SQLITE_PATH = `./test/.leftover-sched-${process.pid}.db`;
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

const JOB_AT = '2026-02-01T00:00:00.000Z';

function job(ownerScope: string | undefined, extra: Partial<ScheduledJobRecord> = {}): ScheduledJobRecord {
    return {
        id: `schedule:${randomUUID()}`, name: 'leftover probe', displayName: 'Morning digest', type: 'ai', cron: '0 7 * * *',
        enabled: true, createdBy: ownerScope ? `claude#${ownerScope}` : 'system', ownerScope, createdAt: JOB_AT, updatedAt: JOB_AT, ...extra,
    } as ScheduledJobRecord;
}

describe.each([['sqlite'], ...(PG_URL ? [['postgres-kysely']] : [])])('the schedules older erasures left (%s)', (provider) => {
    it('are named once, nothing deleted, and the operator deletes or keeps each one', async () => {
        const storage = provs.find(p => p.name === provider)!.storage;
        const node = `aimeat-leftover-${randomUUID().slice(0, 8)}`;
        const config = { nodeId: node } as never;
        const s = Date.now() % 1_000_000;
        const alive = `alive${s}`, reborn = `reborn${s}`, gone = `gone${s}`;
        await storage.createOwner({ name: alive, displayName: alive, publicKey: 'pk', roles: ['owner'], createdAt: '2026-01-01T00:00:00.000Z' } as never);
        await storage.createOwner({ name: reborn, displayName: reborn, publicKey: 'pk', roles: ['owner'], createdAt: new Date().toISOString() } as never);

        const ofGone = job(`${gone}@${node}`);
        const ofReborn = job(`${reborn}@${node}`, { type: 'agent_task' });
        const ofAlive = job(`${alive}@${node}`);
        const core = job(undefined, { type: 'core', coreHandler: 'count' });
        const otherNode = job(`${gone}@another-node`);
        for (const j of [ofGone, ofReborn, ofAlive, core, otherNode]) await storage.createScheduledJob(j);

        const found = await reportErasureLeftoverSchedulesOnce(storage, config);
        expect(found?.map(e => e.id).sort()).toEqual([ofGone.id, ofReborn.id].sort());
        expect(await reportErasureLeftoverSchedulesOnce(storage, config)).toBeNull();
        for (const j of [ofGone, ofReborn, ofAlive, core, otherNode]) expect(await storage.getScheduledJob(j.id)).not.toBeNull();

        const incidents = (await listSecurityIncidents(storage, config)).items.filter(i => i.type === ERASURE_LEFTOVER_INCIDENT_TYPE);
        expect(incidents).toHaveLength(1);
        const inc = incidents[0] as SecurityIncidentValue;
        expect(inc.entries?.every(e => e.action === 'delete' && e.status === 'open')).toBe(true);
        expect(inc.entries?.find(e => e.id === ofGone.id)?.params?.label).toBe('Morning digest');

        const by = { principal: `op@${node}`, kind: 'human' as const };
        const wrong = await decideIncidentCase(config, storage, { incidentId: inc.id, name: ofGone.id, resolution: 'clear', by });
        expect(wrong).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
        const del = await decideIncidentCase(config, storage, { incidentId: inc.id, name: ofGone.id, resolution: 'delete', by });
        expect(del).toMatchObject({ ok: true, data: { incident_status: 'open' } });
        expect(await storage.getScheduledJob(ofGone.id)).toBeFalsy();
        expect(await storage.getScheduledJob(ofAlive.id)).not.toBeNull();
        const again = await decideIncidentCase(config, storage, { incidentId: inc.id, name: ofGone.id, resolution: 'delete', by });
        expect(again).toMatchObject({ ok: false, code: 'CONFLICT' });
        const keep = await decideIncidentCase(config, storage, { incidentId: inc.id, name: ofReborn.id, resolution: 'keep', by });
        expect(keep).toMatchObject({ ok: true, data: { incident_status: 'resolved' } });
        expect(await storage.getScheduledJob(ofReborn.id)).not.toBeNull();

        for (const j of [ofReborn, ofAlive, core, otherNode]) await storage.deleteScheduledJob(j.id);
        await storage.deleteMemory(`system@${node}`, ERASURE_LEFTOVER_SCHEDULES_KEY);
    });

    it('a node with no such schedule opens no incident', async () => {
        const storage = provs.find(p => p.name === provider)!.storage;
        const node = `aimeat-leftover-${randomUUID().slice(0, 8)}`;
        const config = { nodeId: node } as never;
        expect(await reportErasureLeftoverSchedulesOnce(storage, config)).toEqual([]);
        expect((await listSecurityIncidents(storage, config)).items.filter(i => i.type === ERASURE_LEFTOVER_INCIDENT_TYPE)).toHaveLength(0);
        await storage.deleteMemory(`system@${node}`, ERASURE_LEFTOVER_SCHEDULES_KEY);
    });
});
