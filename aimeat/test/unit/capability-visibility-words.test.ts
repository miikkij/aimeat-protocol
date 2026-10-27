/**
 * @file test/unit/capability-visibility-words.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The capabilities stored with a visibility word the node does not know are named once
 *   on the Security page, one entry per capability with its owner and word, nothing changed; the
 *   operator makes each one private or keeps it (services/capability-visibility-words.ts,
 *   services/incident-entries.ts; secaudit2026oct22).
 *
 *   With the real store (PostgreSQL too when DATABASE_URL is set): two capabilities with unknown words
 *   are named and the ones with private, owner and public are not; a second run opens no second
 *   incident; nothing is changed by the step; 'clear' sets the word to private and 'keep' leaves it;
 *   the last decision resolves the incident. A node with none opens no incident.
 * @usage cd aimeat && pnpm exec vitest run test/unit/capability-visibility-words.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-26 — Initial (secaudit2026oct22).
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
    reportUnknownCapabilityVisibilityOnce, CAPABILITY_VISIBILITY_INCIDENT_TYPE, CAPABILITY_VISIBILITY_WORDS_KEY,
} from '../../src/services/capability-visibility-words.js';
import { buildCapabilityRecord } from '../../src/services/capability-record.js';
import { decideIncidentCase } from '../../src/services/incident-decisions.js';
import { listSecurityIncidents, type SecurityIncidentValue } from '../../src/services/security-incident.js';
import type { Storage } from '../../src/storage/interface.js';

requirePostgresWhenAsked('capability-visibility-words');

const SQLITE_PATH = `./test/.cap-vis-words-${process.pid}.db`;
const CLEAN_PATH = `./test/.cap-vis-words-clean-${process.pid}.db`;
const PG_URL = process.env.DATABASE_URL ?? '';
const provs: Array<{ name: string; storage: Storage }> = [];

beforeAll(async () => {
    provs.push({ name: 'sqlite', storage: await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH }) });
    if (PG_URL) provs.push({ name: 'postgres-kysely', storage: await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL }) });
    provs.push({ name: 'clean', storage: await createStorage({ provider: 'sqlite', sqlitePath: CLEAN_PATH }) });
}, 60_000);

afterAll(async () => {
    for (const { storage } of provs) await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
    for (const base of [SQLITE_PATH, CLEAN_PATH]) {
        for (const suffix of ['', '-wal', '-shm']) {
            const p = base + suffix;
            if (existsSync(p)) { try { rmSync(p); } catch { /* the test's own scratch */ } }
        }
    }
});

function capability(owner: string, visibility: string) {
    const now = new Date().toISOString();
    return buildCapabilityRecord(
        { ownerGhii: owner, schemaHash: 'x', status: 'active', now },
        { id: `capvis-${randomUUID()}`, name: `word ${visibility}`, visibility: visibility as never },
    );
}

describe.each([['sqlite'], ...(PG_URL ? [['postgres-kysely']] : [])])('capabilities with an unknown visibility word (%s)', (provider) => {
    it('are named once, nothing changed, and the operator makes each one private or keeps it', async () => {
        const storage = provs.find(p => p.name === provider)!.storage;
        const node = `aimeat-capvis-${randomUUID().slice(0, 8)}`;
        const config = { nodeId: node } as never;
        const owner = `alice@${node}`;
        const friends = capability(owner, 'friends');
        const group = capability(`claude#alice@${node}`, 'group');
        const known = ['private', 'owner', 'public'].map(w => capability(owner, w));
        for (const c of [friends, group, ...known]) await storage.createCapability(c);

        const found = await reportUnknownCapabilityVisibilityOnce(storage, config);
        const ids = found?.map(e => e.id) ?? [];
        expect(ids).toEqual(expect.arrayContaining([friends.id, group.id]));
        for (const c of known) expect(ids).not.toContain(c.id);
        expect(await reportUnknownCapabilityVisibilityOnce(storage, config)).toBeNull();
        expect((await storage.getCapability(friends.id))?.visibility).toBe('friends');
        expect((await storage.getCapability(group.id))?.visibility).toBe('group');

        const incidents = (await listSecurityIncidents(storage, config)).items.filter(i => i.type === CAPABILITY_VISIBILITY_INCIDENT_TYPE);
        expect(incidents).toHaveLength(1);
        const inc = incidents[0] as SecurityIncidentValue;
        expect(inc.entries?.every(e => e.action === 'clear' && e.status === 'open')).toBe(true);
        expect(inc.entries?.find(e => e.id === friends.id)?.params).toMatchObject({ owner, word: 'friends' });
        expect(inc.detail).toMatch(/treated as private/);

        const by = { principal: `op@${node}`, kind: 'human' as const };
        const clear = await decideIncidentCase(config, storage, { incidentId: inc.id, name: friends.id, resolution: 'clear', by });
        expect(clear).toMatchObject({ ok: true });
        expect((await storage.getCapability(friends.id))?.visibility).toBe('private');
        const others = (inc.entries ?? []).filter(e => e.id !== friends.id);
        for (const e of others) {
            const keep = await decideIncidentCase(config, storage, { incidentId: inc.id, name: e.id, resolution: 'keep', by });
            expect(keep).toMatchObject({ ok: true });
        }
        expect((await storage.getCapability(group.id))?.visibility).toBe('group');
        const after = (await listSecurityIncidents(storage, config)).items.find(i => i.id === inc.id) as SecurityIncidentValue;
        expect(after.status).toBe('resolved');

        for (const c of [friends, group, ...known]) await storage.deleteCapability(c.id);
        await storage.deleteMemory(`system@${node}`, CAPABILITY_VISIBILITY_WORDS_KEY);
    });
});

it('a node with no such capability opens no incident', async () => {
    const storage = provs.find(p => p.name === 'clean')!.storage;
    const node = `aimeat-capvis-${randomUUID().slice(0, 8)}`;
    const config = { nodeId: node } as never;
    for (const w of ['private', 'owner', 'public']) await storage.createCapability(capability(`bob@${node}`, w));
    expect(await reportUnknownCapabilityVisibilityOnce(storage, config)).toEqual([]);
    expect((await listSecurityIncidents(storage, config)).items.filter(i => i.type === CAPABILITY_VISIBILITY_INCIDENT_TYPE)).toHaveLength(0);
    expect(await reportUnknownCapabilityVisibilityOnce(storage, config)).toBeNull();
});
