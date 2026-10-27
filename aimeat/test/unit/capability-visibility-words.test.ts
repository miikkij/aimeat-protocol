/**
 * @file test/unit/capability-visibility-words.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The capabilities stored with a visibility word the node does not know are set to
 *   private once, and each owner gets one notice that names theirs; the operator is asked nothing
 *   (services/capability-visibility-words.ts; secaudit2026oct22, developer decision 2026-10-27).
 *
 *   With the real store (PostgreSQL too when DATABASE_URL is set): two capabilities with unknown words
 *   become private and the ones with private, owner and public keep their words; the run record keeps
 *   the former words; the owner gets one notice for both; a second run does nothing; no Security page
 *   incident is opened. A node with none changes nothing and tells nobody.
 * @usage cd aimeat && pnpm exec vitest run test/unit/capability-visibility-words.test.ts
 * @version-history
 *   v2.0.0 — 2026-10-27 — The step sets an unknown word to private and tells the owner, in place of the
 *     Security page incident (developer decision 2026-10-27).
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
    settleUnknownCapabilityVisibilityOnce, CAPABILITY_VISIBILITY_WORDS_KEY,
} from '../../src/services/capability-visibility-words.js';
import { buildCapabilityRecord } from '../../src/services/capability-record.js';
import { listSecurityIncidents } from '../../src/services/security-incident.js';
import { NOTIF_PREFIX } from '../../src/services/notify.js';
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

const noticesOf = async (storage: Storage, owner: string) => (await storage.listMemory(owner, { prefix: NOTIF_PREFIX }))
    .map(r => r.value as { type?: string; i18n?: { key?: string; vars?: Record<string, unknown> }; link?: string })
    .filter(v => v.type === 'capability_visibility_private');

describe.each([['sqlite'], ...(PG_URL ? [['postgres-kysely']] : [])])('capabilities with an unknown visibility word (%s)', (provider) => {
    it('become private once, the owner is told once, and the operator is asked nothing', async () => {
        const storage = provs.find(p => p.name === provider)!.storage;
        const node = `aimeat-capvis-${randomUUID().slice(0, 8)}`;
        const config = { nodeId: node } as never;
        const owner = `alice@${node}`;
        const friends = capability(owner, 'friends');
        const group = capability(owner, 'group');
        const known = ['private', 'owner', 'public'].map(w => capability(owner, w));
        for (const c of [friends, group, ...known]) await storage.createCapability(c);

        const settled = await settleUnknownCapabilityVisibilityOnce(storage, config);
        const ids = settled?.map(s => s.id) ?? [];
        expect(ids).toEqual(expect.arrayContaining([friends.id, group.id]));
        for (const c of known) expect(ids).not.toContain(c.id);
        expect(settled?.find(s => s.id === friends.id)).toMatchObject({ owner, word: 'friends' });
        expect((await storage.getCapability(friends.id))?.visibility).toBe('private');
        expect((await storage.getCapability(group.id))?.visibility).toBe('private');
        for (const c of known) expect((await storage.getCapability(c.id))?.visibility).toBe(c.visibility);

        // The run record keeps each former word, so the change can be read back.
        const run = await storage.getMemory(`system@${node}`, CAPABILITY_VISIBILITY_WORDS_KEY);
        expect(JSON.stringify(run?.value)).toContain('"word":"friends"');

        // One notice for the owner, naming both, pointing at the Capabilities page.
        const notices = await noticesOf(storage, owner);
        expect(notices).toHaveLength(1);
        expect(notices[0]!.i18n?.key).toBe('capability_visibility_private');
        expect(String(notices[0]!.i18n?.vars?.names)).toContain(friends.name);
        expect(notices[0]!.link).toBe('/v1/profile?tab=capabilities');

        expect(await settleUnknownCapabilityVisibilityOnce(storage, config)).toBeNull();
        expect(await noticesOf(storage, owner)).toHaveLength(1);
        expect((await listSecurityIncidents(storage, config)).items.filter(i => i.type === 'capability_visibility_words')).toHaveLength(0);

        for (const c of [friends, group, ...known]) await storage.deleteCapability(c.id);
        await storage.deleteMemory(`system@${node}`, CAPABILITY_VISIBILITY_WORDS_KEY);
    });
});

it('a node with no such capability changes nothing and tells nobody', async () => {
    const storage = provs.find(p => p.name === 'clean')!.storage;
    const node = `aimeat-capvis-${randomUUID().slice(0, 8)}`;
    const config = { nodeId: node } as never;
    const owner = `bob@${node}`;
    for (const w of ['private', 'owner', 'public']) await storage.createCapability(capability(owner, w));
    expect(await settleUnknownCapabilityVisibilityOnce(storage, config)).toEqual([]);
    expect(await noticesOf(storage, owner)).toHaveLength(0);
    expect(await settleUnknownCapabilityVisibilityOnce(storage, config)).toBeNull();
});
