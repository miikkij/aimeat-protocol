/**
 * @file workspace-suggestions.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A plain member's suggested change to a workspace (services/workspace-member-changes.ts
 *   and services/workspace-suggestions.ts), driven on SQLite with a clock the test moves: what the
 *   E2E suite cannot reach from outside. An expired suggestion does nothing and the member hears it;
 *   approving re-validates the stored change and runs nothing when it no longer holds; a sections
 *   suggestion approved after the creator reorganised keeps the creator's work; and a member's change
 *   never leaves a copy under the member.
 * @usage cd aimeat && pnpm exec vitest run test/unit/workspace-suggestions.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-25 — Initial (workspace actions for plain members).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { addWorkspaceSpaces, setWorkspaceSections, isRefusal } from '../../src/services/workspace-member-changes.js';
import { decideSuggestion, listSuggestions } from '../../src/services/workspace-suggestions.js';
import { readWorkspaceManifest } from '../../src/services/workspace-meta.js';
import type { OrganismRecord, GHIIRecord, ConsentRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

const NODE = 'test-node';
const ORG = 'org-suggest';
const WS = 'ws-notes';
const config = { nodeId: NODE, organismDecisionLogCap: 0 } as unknown as AimeatConfig;
const T0 = new Date('2026-09-25T10:00:00.000Z');
const DAY = 86_400_000;

const iso = (d: Date) => d.toISOString();
const root = `organism.${ORG}.w.${WS}`;

async function put(storage: SqliteStorage, ownerGaii: string, key: string, value: unknown): Promise<void> {
    const prev = await storage.getMemory(ownerGaii, key);
    await storage.setMemory({
        key, ownerGaii, value, visibility: 'private', tags: [], ttlHours: null,
        version: (prev?.version ?? 0) + 1, createdAt: prev?.createdAt ?? iso(T0), updatedAt: iso(T0),
    });
}

/** alice created the organism and WS; bob is a plain member with the contributor role; carol an admin. */
async function world(): Promise<SqliteStorage> {
    const storage = new SqliteStorage(':memory:');
    await storage.createOrganism({
        id: ORG, name: 'Suggest', description: 'x', type: 'project', interests: [],
        creatorGhii: 'alice', admins: ['alice', 'carol'], members: ['alice', 'bob', 'carol'], agentGaiis: [],
        boardId: 'board-suggest', joinPolicy: 'open', maxMembers: 100, visibility: 'public',
        moderationConfig: { flagsEnabled: true, autoHideThreshold: 5, appealsEnabled: false },
        memoryNamespace: `organism.${ORG}`, createdAt: iso(T0), updatedAt: iso(T0),
    } as OrganismRecord);
    for (const [name, role] of [['alice', 'creator'], ['bob', 'member'], ['carol', 'admin']] as const) {
        await storage.createGHII({ username: name, nodeId: NODE, ghii: `${name}@${NODE}`, displayName: name, ownerName: name, verificationLevel: 0, totpEnabled: false, createdAt: iso(T0), updatedAt: iso(T0) } as GHIIRecord);
        await storage.createMembership({ id: `mem-${name}`, organismId: ORG, ghii: name, role, status: 'active', joinedAt: iso(T0) });
    }
    await put(storage, `alice@${NODE}`, `organism.${ORG}.meta.workspaces`, { workspaces: [{ id: WS, name: 'Notes', createdBy: 'alice' }] });
    await put(storage, `alice@${NODE}`, `${root}.meta.manifest`, {
        manifestVersion: '1.0', id: ORG, name: 'Notes', kind: 'project', status: 'active',
        objectTypes: [{ name: 'note', namespace: 'shared.notes', schemaRef: 'schema:note@1', mode: 'document', backing: 'memory', writeRole: 'member' }],
    });
    await put(storage, `alice@${NODE}`, `${root}.meta.sections.note`, { sections: [{ id: 'sec-a', name: 'Drafts', parentId: null, documents: [] }] });
    await storage.createConsent({
        id: 'consent-bob', ownerGaii: `alice@${NODE}`, dataPattern: `${root}.**`, recipient: `ghii:bob@${NODE}`,
        purpose: 'workspace-contributor', scope: 'private', expires: null, status: 'active', grantedAt: iso(T0), revokedAt: null,
    } as ConsentRecord);
    return storage;
}

const bob = { principal: `bot#bob@${NODE}`, owner: 'bob', roles: ['agent'] };
const carol = { principal: `carol@${NODE}`, owner: 'carol', roles: ['owner'] };
const alice = { principal: `alice@${NODE}`, owner: 'alice', roles: ['owner'] };
const at = (d: Date) => () => d;
const spaceNames = async (storage: SqliteStorage) =>
    ((await readWorkspaceManifest(storage as never, ORG, WS, NODE))?.objectTypes ?? []).map(o => String(o.name));

describe('a suggestion that nobody decided in time', () => {
    let storage: SqliteStorage;
    beforeEach(async () => { storage = await world(); });

    it('does nothing when approved after its deadline, and the member hears it expired', async () => {
        const r = await addWorkspaceSpaces({ storage, config, now: at(T0) }, bob, { orgId: ORG, ws: WS, spaces: { name: 'later', namespace: 'shared.later', mode: 'document' } });
        expect(isRefusal(r) ? r : r.status).toBe('pending_approval');
        const sid = (!isRefusal(r) && r.suggestion?.id) as string;

        const late = await decideSuggestion({ storage, config, now: at(new Date(T0.getTime() + 31 * DAY)) }, carol, { orgId: ORG, id: sid, decision: 'approve' });
        expect(isRefusal(late) && late.code).toBe('EXPIRED');
        expect(await spaceNames(storage)).not.toContain('later');
        const a = await storage.getPendingApproval(sid);
        expect(a?.status).toBe('rejected');
        expect(a?.resolutionNote).toMatch(/^expired/);
        const notes = (await storage.listMemory(`bob@${NODE}`, { prefix: 'notif.' })).map(n => (n.value as { type?: string }).type);
        expect(notes).toContain('workspace_space_expired');
    });

    it('is still decided the day before its deadline', async () => {
        const r = await addWorkspaceSpaces({ storage, config, now: at(T0) }, bob, { orgId: ORG, ws: WS, spaces: [{ name: 'later', namespace: 'shared.later', mode: 'document' }] });
        const sid = (!isRefusal(r) && r.suggestion?.id) as string;
        const inTime = await decideSuggestion({ storage, config, now: at(new Date(T0.getTime() + 29 * DAY)) }, carol, { orgId: ORG, id: sid, decision: 'approve' });
        expect(isRefusal(inTime) ? inTime.code : inTime.suggestion.status).toBe('approved');
        expect(await spaceNames(storage)).toContain('later');
    });
});

describe('approving runs the stored change again, checked', () => {
    let storage: SqliteStorage;
    beforeEach(async () => { storage = await world(); });

    it('runs nothing when the stored change is no longer valid, and leaves the suggestion pending', async () => {
        const r = await addWorkspaceSpaces({ storage, config, now: at(T0) }, bob, { orgId: ORG, ws: WS, spaces: { name: 'later', namespace: 'shared.later', mode: 'document' } });
        const sid = (!isRefusal(r) && r.suggestion?.id) as string;
        const stored = await storage.getPendingApproval(sid);
        await storage.updatePendingApproval(sid, { arguments: { ...(stored!.arguments as Record<string, unknown>), spaces: [{ name: 'evil', namespace: 'meta.manifest' }] } });
        const d = await decideSuggestion({ storage, config, now: at(T0) }, carol, { orgId: ORG, id: sid, decision: 'approve' });
        expect(isRefusal(d) && d.code).toBe('INVALID_STATE');
        expect(await spaceNames(storage)).toEqual(['note']);
        expect((await storage.getPendingApproval(sid))?.status).toBe('pending');
    });

    it('runs nothing when the member who made it lost the contributor role', async () => {
        const r = await addWorkspaceSpaces({ storage, config, now: at(T0) }, bob, { orgId: ORG, ws: WS, spaces: { name: 'later', namespace: 'shared.later', mode: 'document' } });
        const sid = (!isRefusal(r) && r.suggestion?.id) as string;
        await storage.updateConsent('consent-bob', { status: 'revoked', revokedAt: iso(T0) });
        const d = await decideSuggestion({ storage, config, now: at(T0) }, alice, { orgId: ORG, id: sid, decision: 'approve' });
        expect(isRefusal(d) && d.code).toBe('INVALID_STATE');
        expect(await spaceNames(storage)).toEqual(['note']);
    });
});

describe('a sections suggestion approved after the creator reorganised', () => {
    it('keeps the creator\'s change and adds the member\'s, and writes no copy under the member', async () => {
        const storage = await world();
        const r = await setWorkspaceSections({ storage, config, now: at(T0) }, bob, { orgId: ORG, ws: WS, space: 'note', sections: [
            { id: 'sec-a', name: 'Drafts', parentId: null, documents: [] },
            { id: 'sec-b', name: 'Final', parentId: null, documents: [] },
        ] });
        expect(isRefusal(r) ? r.code : r.status).toBe('pending_approval');
        const sid = (!isRefusal(r) && r.suggestion?.id) as string;
        // The creator renames Drafts directly while the suggestion waits.
        const renamed = await setWorkspaceSections({ storage, config, now: at(T0) }, alice, { orgId: ORG, ws: WS, space: 'note', sections: [
            { id: 'sec-a', name: 'Working drafts', parentId: null, documents: [] },
        ] });
        expect(isRefusal(renamed) ? renamed.code : renamed.status).toBe('applied');
        const d = await decideSuggestion({ storage, config, now: at(T0) }, carol, { orgId: ORG, id: sid, decision: 'approve' });
        expect(isRefusal(d) ? d.code : d.sections?.map(s => s.name)).toEqual(['Working drafts', 'Final']);
        expect(await storage.getMemory(`bob@${NODE}`, `${root}.meta.sections.note`)).toBeNull();
        expect(await storage.getMemory(`bot#bob@${NODE}`, `${root}.meta.sections.note`)).toBeNull();
        const rec = await storage.getMemory(`alice@${NODE}`, `${root}.meta.sections.note`);
        expect((rec?.value as { changedBy?: string; approvedBy?: string }).changedBy).toBe(`bot#bob@${NODE}`);
        expect((rec?.value as { approvedBy?: string }).approvedBy).toBe(`carol@${NODE}`);
    });

    it('joins a member\'s further changes to the one suggestion already waiting for that space', async () => {
        const storage = await world();
        const one = await setWorkspaceSections({ storage, config, now: at(T0) }, bob, { orgId: ORG, ws: WS, space: 'note', sections: [
            { id: 'sec-a', name: 'Drafts', parentId: null, documents: [] }, { id: 'sec-b', name: 'Final', parentId: null, documents: [] },
        ] });
        const two = await setWorkspaceSections({ storage, config, now: at(T0) }, bob, { orgId: ORG, ws: WS, space: 'note', sections: [
            { id: 'sec-a', name: 'Drafts', parentId: null, documents: [] }, { id: 'sec-c', name: 'Archive', parentId: null, documents: [] },
        ] });
        expect(!isRefusal(one) && !isRefusal(two) && two.merged).toBe(true);
        expect(!isRefusal(one) && !isRefusal(two) && two.suggestion?.id === one.suggestion?.id).toBe(true);
        const listed = await listSuggestions({ storage, config, now: at(T0) }, carol, { orgId: ORG, ws: WS });
        expect(isRefusal(listed) ? [] : listed.suggestions.length).toBe(1);
    });
});
