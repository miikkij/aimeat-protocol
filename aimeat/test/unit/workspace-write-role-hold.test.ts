/**
 * @file test/unit/workspace-write-role-hold.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A memory space's writeRole (services/organism/write-role.ts) and the once-only boot step
 *   that holds the spaces members already wrote into (services/workspace/write-role-hold.ts), with the
 *   real store (PostgreSQL too when DATABASE_URL is set).
 *
 *   Ruled by the developer on 2026-11-21: "a space that declares owner or admin today and that members
 *   already write into is not changed silently; the node finds such spaces itself and lists them for the
 *   operator, and the rule is enforced for the rest at once."
 *
 *   Attack: bob, a plain member, writes a space marked owner or admin; the rule refuses him at once on a
 *   space nobody but its owner wrote. Ambiguous: a space bob already wrote stays writable for him and is
 *   named on the Security page; "enforce" refuses him from then on, "keep" sets the space's writeRole to
 *   member. Usage: alice (the workspace's creator) and carol (an organism admin) write every space; a
 *   former member's old record is no evidence; a second run does nothing.
 *
 *   The E2E side (REST, MCP, rows) is test/e2e-workspace-write-role.ts.
 * @usage cd aimeat && pnpm exec vitest run test/unit/workspace-write-role-hold.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
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
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, OrganismRecord, OrganismMembershipRecord, MemoryRecord } from '../../src/storage/interface.js';
import {
    spaceWriteRoleRefusal, standingMeets, WRITE_ROLE_HELD_KEY, type SpaceWriteRole,
} from '../../src/services/organism/write-role.js';
import { fencedSpaceRefusal } from '../../src/services/fenced-space.js';
import {
    holdMemberWrittenSpacesOnce, WRITE_ROLE_INCIDENT_TYPE, WRITE_ROLE_STEP_KEY,
} from '../../src/services/workspace/write-role-hold.js';
import { decideIncidentCase } from '../../src/services/incident-decisions.js';
import { listSecurityIncidents } from '../../src/services/security-incident.js';
import { readWorkspaceManifest } from '../../src/services/workspace/meta.js';

requirePostgresWhenAsked('workspace-write-role-hold');

const SQLITE_PATH = `./test/.write-role-hold-${process.pid}.db`;
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

describe('standingMeets', () => {
    const s = (orgRole: string | null, workspaceCreator = false) => ({ orgRole, workspaceCreator });
    it('owner: the workspace creator who is a member, or an organism admin', () => {
        expect(standingMeets('owner', s('member', true))).toBe(true);
        expect(standingMeets('owner', s('admin'))).toBe(true);
        expect(standingMeets('owner', s('creator'))).toBe(true);
        expect(standingMeets('owner', s('member'))).toBe(false);
        expect(standingMeets('owner', s(null, true)), 'a creator who left is no member').toBe(false);
    });
    it('admin: an organism admin only, the workspace creator who is a plain member not', () => {
        expect(standingMeets('admin', s('admin'))).toBe(true);
        expect(standingMeets('admin', s('creator'))).toBe(true);
        expect(standingMeets('admin', s('member', true))).toBe(false);
    });
    it('member asks nothing', () => {
        expect(standingMeets('member', s('member'))).toBe(true);
        expect(standingMeets('member', s(null))).toBe(true);
    });
});

/** One world per provider: its own node id, so the system records and the incident are its own. */
function world() {
    const N = `aimeat-test-001-wr${randomUUID().slice(0, 8)}`;
    const ORG = `wr-${randomUUID()}`;
    const WS = 'ws1';
    const root = `organism.${ORG}.w.${WS}`;
    const config = { nodeId: N } as AimeatConfig;
    return { N, ORG, WS, root, config, ghii: (n: string) => `${n}@${N}` };
}

async function seed(storage: Storage, w: ReturnType<typeof world>): Promise<void> {
    const stamp = '2026-11-01T00:00:00.000Z';
    const put = async (owner: string, key: string, value: unknown) => {
        await storage.setMemory({ key, ownerGaii: owner, value, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: stamp, updatedAt: stamp } as MemoryRecord);
    };
    await storage.createOrganism({
        id: w.ORG, name: 'Charter Org', description: 'x', type: 'project', interests: [], creatorGhii: w.ghii('alice'), createdBy: w.ghii('alice'), owners: [w.ghii('alice')],
        admins: [w.ghii('alice')], members: [w.ghii('alice')], agentGaiis: [], boardId: 'b1', joinPolicy: 'invite_only', maxMembers: 10, visibility: 'private',
        moderationConfig: { flagsEnabled: false, autoHideThreshold: 5, appealsEnabled: false },
        memoryNamespace: `organism.${w.ORG}`, createdAt: stamp, updatedAt: stamp,
    } as OrganismRecord);
    const roles: Array<[string, string, string]> = [['alice', 'creator', 'active'], ['bob', 'member', 'active'], ['carol', 'admin', 'active'], ['dave', 'member', 'left']];
    for (const [name, role, status] of roles) {
        await storage.createMembership({ id: `m-${name}-${w.ORG}`, organismId: w.ORG, ghii: name, role, status, joinedAt: stamp } as OrganismMembershipRecord);
    }
    await put(w.ghii('alice'), `organism.${w.ORG}.meta.workspaces`, { workspaces: [{ id: w.WS, name: 'Charter', createdAt: stamp, createdBy: 'alice' }] });
    const space = (name: string, namespace: string, writeRole: string, backing = 'memory') =>
        ({ name, schemaRef: `schema:${name}@1`, namespace, backing, writeRole, mode: 'records' });
    await put(w.ghii('alice'), `${w.root}.meta.manifest`, {
        manifestVersion: '1', name: 'Charter', kind: 'project', objectTypes: [
            space('charter', 'shared.charter', 'owner'),     // bob wrote here: held
            space('budget', 'shared.budget', 'admin'),       // bob's agent wrote here: held
            space('plan', 'shared.plan', 'owner'),           // alice, carol and a former member: not held
            space('note', 'shared.notes', 'member'),         // bob wrote here: nothing to hold
            space('ledger', 'books.ledger', 'owner', 'rows'), // a row space: the row service's rule, never held
        ],
    });
    await put(w.ghii('bob'), `${w.root}.shared.charter.c1.latest`, { id: 'c1' });
    await put(w.ghii('carol'), `${w.root}.shared.charter.c2.latest`, { id: 'c2' });
    await put(`bot#bob@${w.N}`, `${w.root}.shared.budget.b1.draft`, { id: 'b1' });
    await put(w.ghii('alice'), `${w.root}.shared.plan.p1.latest`, { id: 'p1' });
    await put(w.ghii('carol'), `${w.root}.shared.plan.p2.latest`, { id: 'p2' });
    await put(w.ghii('dave'), `${w.root}.shared.plan.p3.latest`, { id: 'p3' });
    await put(w.ghii('bob'), `${w.root}.shared.notes.n1.latest`, { id: 'n1' });
}

describe.each([['sqlite'], ['postgres-kysely']])('the writeRole hold on %s', (name) => {
    const w = world();
    const storage = () => provs.find(p => p.name === name)?.storage;
    const deps = () => ({ storage: storage()!, config: w.config });
    const key = (ns: string, id: string) => `${w.root}.${ns}.${id}.draft`;
    /** The refusal a write by `who` (a person in person) meets on `ns`, or null. */
    const asks = (who: string, ns: string) =>
        fencedSpaceRefusal(deps(), { principal: w.ghii(who), owner: who, roles: ['owner'], scopes: [] }, w.ORG, w.WS, { key: key(ns, 'x') });
    const role = (r: unknown) => (r as { details?: { writeRole?: SpaceWriteRole } } | null)?.details?.writeRole;
    let incidentId = '';

    it.skipIf(name === 'postgres-kysely' && !PG_URL)('before the step: the rule holds on every owner and admin space for bob, and never for alice or carol', async () => {
        await seed(storage()!, w);
        for (const ns of ['shared.charter', 'shared.plan']) expect(role(await asks('bob', ns)), ns).toBe('owner');
        expect(role(await asks('bob', 'shared.budget'))).toBe('admin');
        expect(await asks('bob', 'shared.notes')).toBeNull();
        for (const who of ['alice', 'carol']) {
            for (const ns of ['shared.charter', 'shared.budget', 'shared.plan']) expect(await asks(who, ns), `${who} ${ns}`).toBeNull();
        }
        // bob's agent acts with bob's standing: the identity alone names him.
        const agent = await spaceWriteRoleRefusal(deps(), { principal: `bot#bob@${w.N}` }, w.ORG, w.WS, { key: key('shared.charter', 'y') });
        expect(agent?.message).toContain('writeRole "owner"');
        expect(agent?.message).toContain('"charter"');
    });

    it.skipIf(name === 'postgres-kysely' && !PG_URL)('the step holds the spaces bob wrote, names them in one incident, and leaves the rest under the rule', async () => {
        const found = await holdMemberWrittenSpacesOnce(storage()!, w.config);
        const mine = (found ?? []).filter(s => s.organismId === w.ORG).map(s => `${s.space}:${s.writeRole}:${s.writers.join(',')}`).sort();
        expect(mine).toEqual(['budget:admin:bob', 'charter:owner:bob']);
        const incidents = (await listSecurityIncidents(storage()!, w.config)).items.filter(i => i.type === WRITE_ROLE_INCIDENT_TYPE);
        expect(incidents).toHaveLength(1);
        incidentId = incidents[0]!.id;
        const entries = (incidents[0]!.entries ?? []).filter(e => e.id.startsWith(`${w.ORG}/`));
        expect(entries.map(e => e.id).sort()).toEqual([`${w.ORG}/${w.WS}/shared.budget`, `${w.ORG}/${w.WS}/shared.charter`]);
        expect(entries.every(e => e.action === 'enforce' && e.status === 'open')).toBe(true);
        // Held: bob writes as before. Not held: the rule at once.
        expect(await asks('bob', 'shared.charter')).toBeNull();
        expect(await asks('bob', 'shared.budget')).toBeNull();
        expect(role(await asks('bob', 'shared.plan'))).toBe('owner');
    });

    it.skipIf(name === 'postgres-kysely' && !PG_URL)('a second run does nothing', async () => {
        expect(await holdMemberWrittenSpacesOnce(storage()!, w.config)).toBeNull();
        expect((await listSecurityIncidents(storage()!, w.config)).items.filter(i => i.type === WRITE_ROLE_INCIDENT_TYPE)).toHaveLength(1);
        expect(await storage()!.getMemory(`system@${w.N}`, WRITE_ROLE_STEP_KEY)).not.toBeNull();
    });

    it.skipIf(name === 'postgres-kysely' && !PG_URL)('"enforce" refuses bob on that space from then on; carol still writes it', async () => {
        const by = { principal: `operator@${w.N}`, kind: 'human' as const };
        const r = await decideIncidentCase(w.config, storage()!, { incidentId, name: `${w.ORG}/${w.WS}/shared.charter`, resolution: 'enforce', by });
        expect(r.ok, JSON.stringify(r)).toBe(true);
        expect(role(await asks('bob', 'shared.charter'))).toBe('owner');
        expect(await asks('carol', 'shared.charter')).toBeNull();
        // The other held space is still held.
        expect(await asks('bob', 'shared.budget')).toBeNull();
        const again = await decideIncidentCase(w.config, storage()!, { incidentId, name: `${w.ORG}/${w.WS}/shared.charter`, resolution: 'keep', by });
        expect(again.ok).toBe(false);
        if (!again.ok) expect(again.code).toBe('CONFLICT');
    });

    it.skipIf(name === 'postgres-kysely' && !PG_URL)('"keep" sets the space\'s writeRole to member in the manifest and ends the hold; the incident resolves with its last entry', async () => {
        const by = { principal: `operator@${w.N}`, kind: 'human' as const };
        const r = await decideIncidentCase(w.config, storage()!, { incidentId, name: `${w.ORG}/${w.WS}/shared.budget`, resolution: 'keep', by });
        expect(r.ok, JSON.stringify(r)).toBe(true);
        const manifest = await readWorkspaceManifest(storage()!, w.ORG, w.WS, w.N);
        const budget = (manifest?.objectTypes ?? []).find(o => o.namespace === 'shared.budget');
        expect(budget?.writeRole).toBe('member');
        const charter = (manifest?.objectTypes ?? []).find(o => o.namespace === 'shared.charter');
        expect(charter?.writeRole, 'the other space keeps its writeRole').toBe('owner');
        expect(await asks('bob', 'shared.budget')).toBeNull();
        const held = await storage()!.getMemory(`system@${w.N}`, WRITE_ROLE_HELD_KEY);
        expect(((held?.value as { spaces?: Array<{ id: string }> })?.spaces ?? []).filter(s => s.id.startsWith(`${w.ORG}/`))).toEqual([]);
        const incident = (await listSecurityIncidents(storage()!, w.config)).items.find(i => i.id === incidentId);
        const open = (incident?.entries ?? []).filter(e => e.status === 'open');
        if (open.length === 0) expect(incident?.status).toBe('resolved');
    });

    it.skipIf(name === 'postgres-kysely' && !PG_URL)('an unknown entry or resolution is refused', async () => {
        const by = { principal: `operator@${w.N}`, kind: 'human' as const };
        const unknown = await decideIncidentCase(w.config, storage()!, { incidentId, name: `${w.ORG}/${w.WS}/shared.nope`, resolution: 'enforce', by });
        expect(unknown.ok).toBe(false);
        if (!unknown.ok) expect(unknown.code).toBe('NOT_FOUND');
    });
});
