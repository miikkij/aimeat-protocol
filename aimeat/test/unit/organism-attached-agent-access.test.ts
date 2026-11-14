/**
 * @file test/unit/organism-attached-agent-access.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An agent attached to an organism (the Agents section, organism.agentGaiis) never has
 *   fewer rights for being attached. On aimeat.io on 2026-11-10 an organism's agentAccess was "all",
 *   its creator's own agent was on the list, and the organism rule read it as an organism-level
 *   participant: every workspace write and every extension action that wrote was refused, and the
 *   draft write told the creator's agent to request access to its own workspace. Setting "listed"
 *   gave the rights back at once (wish-organismiin-liitetty-agentti-ei-saa-menett-omistajansa-ty-ti).
 *
 *   Driven through the shared rule (checkOrganismNamespaceAccess), the draft write the MCP tool runs
 *   (writeWorkspaceDraftsOp) and the workspace capability of an extension action
 *   (buildExtensionWorkspace), on SQLite.
 * @structure
 *   - attachedAsParticipant: the owner's active membership decides, in both modes
 *   - the rule: a member's attached agent acts with the member's rights in "all" and "listed"; a
 *     non-member's attached agent keeps the narrow rule; an unlisted agent under "listed" is refused
 *   - the draft write and an extension action of the creator's attached agent write under "all"
 *   - the draft write's refusal carries the rule's own code and reason
 * @usage cd aimeat && pnpm exec vitest run test/unit/organism-attached-agent-access.test.ts
 * @version-history
 *   v1.2.0 — 2026-11-11 — The organism's agent list through services/organism-agents/attach.ts, which
 *     the route and aimeat_organism_agent_attach / _detach call: an agent acting for the person lists a
 *     member's agent under "listed"; without account:security it is refused and told why.
 *   v1.1.0 — 2026-11-11 — A member's agent that a "listed" organism does not admit hears the
 *     organism's refusal on an extension's workspace read, not "Not an active member".
 *   v1.0.0 — 2026-11-10 — Initial.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { checkOrganismNamespaceAccess } from '../../src/services/organism-namespace-access.js';
import { attachedAsParticipant, agentBarred } from '../../src/services/organism-agent-access.js';
import { workspaceCallerOf, writeWorkspaceDraftsOp } from '../../src/services/workspace/tool-ops.js';
import { buildExtensionWorkspace } from '../../src/services/extension/workspace.js';
import { attachOrganismAgent, detachOrganismAgent, AgentListError } from '../../src/services/organism-agents/attach.js';

const ORG = '7c2d9e41-3a5b-4c6d-8e7f-90a1b2c3d4e5';
const WS = 'ws-attached1';

let storage: Storage;
let config: AimeatConfig;
let NODE = '';
const agentOf = (owner: string, name = 'claude') => `${name}#${owner}@${NODE}`;
const root = () => `organism.${ORG}.w.${WS}`;
const CONTENT = () => `${root()}.crm.contacts.c1.draft`;

async function put(key: string, owner: string, value: unknown): Promise<void> {
    const now = new Date().toISOString();
    await storage.setMemory({ key, ownerGaii: owner, value, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now } as MemoryRecord);
}

async function setAccess(agentAccess: 'all' | 'listed'): Promise<void> {
    await storage.updateOrganism(ORG, { agentAccess, updatedAt: new Date().toISOString() });
}

const asAgent = (owner: string, name = 'claude') => ({ principal: agentOf(owner, name), owner, roles: ['agent'], scopes: ['memory:write', 'memory:read', 'organism:read'] });

beforeAll(async () => {
    config = { ...loadConfig().config, aiProvenance: true };
    NODE = config.nodeId;
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    const now = new Date().toISOString();
    for (const name of ['alice', 'bob', 'carol']) {
        await storage.createGHII({ username: name, nodeId: NODE, ghii: `${name}@${NODE}`, displayName: name, ownerName: name, verificationLevel: 0, totpEnabled: false, createdAt: now, updatedAt: now });
    }
    // alice created the organism and the workspace, bob is a plain member, carol is no member. Each
    // has an agent on the organism's list; carol's stayed there after she left.
    await storage.createOrganism({
        id: ORG, name: 'Client project', description: '', type: 'project', interests: [],
        creatorGhii: 'alice', createdBy: 'alice', owners: ['alice'], admins: ['alice'], members: ['alice', 'bob'],
        agentGaiis: [agentOf('alice'), agentOf('bob'), agentOf('carol')],
        boardId: 'board-attached', joinPolicy: 'invite_only', maxMembers: 100, visibility: 'private',
        moderationConfig: { flagsEnabled: false, autoHideThreshold: 5, appealsEnabled: false },
        memoryNamespace: `organism.${ORG}`, createdAt: now, updatedAt: now,
    });
    await storage.createMembership({ id: 'm-alice', organismId: ORG, ghii: 'alice', role: 'creator', status: 'active', joinedAt: now });
    await storage.createMembership({ id: 'm-bob', organismId: ORG, ghii: 'bob', role: 'member', status: 'active', joinedAt: now });
    await put(`organism.${ORG}.meta.workspaces`, `alice@${NODE}`, { workspaces: [{ id: WS, name: 'CRM', createdAt: now, createdBy: 'alice' }] });
    await put(`${root()}.meta.manifest`, `alice@${NODE}`, {
        manifestVersion: '1', name: 'CRM', kind: 'project',
        objectTypes: [{ name: 'contact', namespace: 'crm.contacts', mode: 'records', backing: 'memory' }],
    });
});

describe('attachedAsParticipant: the owner\'s membership decides', () => {
    const org = (agentAccess: 'all' | 'listed') => ({ agentAccess, agentGaiis: ['claude#alice@n'] });
    it('an agent whose owner is an active member is never a participant, in either mode', () => {
        for (const mode of ['all', 'listed'] as const) {
            expect(attachedAsParticipant(org(mode), 'claude#alice@n', { status: 'active' }), mode).toBe(false);
        }
    });
    it('an attached agent whose owner is not a member is a participant where every member\'s agent is admitted', () => {
        expect(attachedAsParticipant(org('all'), 'claude#alice@n', null)).toBe(true);
        expect(attachedAsParticipant(org('all'), 'claude#alice@n', { status: 'invited' })).toBe(true);
        expect(attachedAsParticipant(org('listed'), 'claude#alice@n', null)).toBe(false);
        expect(attachedAsParticipant(org('all'), 'other#alice@n', null)).toBe(false);
    });
});

describe('the organism rule: attaching an agent takes no right away', () => {
    it('the creator\'s attached agent writes workspace content with "all" and with "listed"', async () => {
        for (const mode of ['all', 'listed'] as const) {
            await setAccess(mode);
            expect(await checkOrganismNamespaceAccess({ storage, config }, asAgent('alice'), CONTENT(), 'write'), mode).toBeNull();
        }
    });

    it('a plain member\'s attached agent gets its owner\'s answer under "all": the same as an agent of the owner that is not attached', async () => {
        await setAccess('all');
        const attached = await checkOrganismNamespaceAccess({ storage, config }, asAgent('bob'), CONTENT(), 'write');
        const plain = await checkOrganismNamespaceAccess({ storage, config }, asAgent('bob', 'helper'), CONTENT(), 'write');
        expect(attached?.code).toBe('CONSENT_REQUIRED');
        expect(attached).toEqual(plain);
        // The list still adds the shared area, which it gave before 2026-11-10: nothing is taken away.
        expect(await checkOrganismNamespaceAccess({ storage, config }, asAgent('bob'), `organism.${ORG}.shared.notes`, 'write')).toBeNull();
    });

    it('a plain member\'s listed agent under "listed" gets its owner\'s answer too', async () => {
        await setAccess('listed');
        const r = await checkOrganismNamespaceAccess({ storage, config }, asAgent('bob'), CONTENT(), 'write');
        expect(r?.code).toBe('CONSENT_REQUIRED');
    });

    it('an attached agent whose owner is not a member keeps the narrow rule under "all", and is told why', async () => {
        await setAccess('all');
        const carol = asAgent('carol');
        expect(await checkOrganismNamespaceAccess({ storage, config }, carol, `organism.${ORG}.shared.notes`, 'write')).toBeNull();
        expect(await checkOrganismNamespaceAccess({ storage, config }, carol, `organism.${ORG}.meta.workspaces`, 'read')).toBeNull();
        const r = await checkOrganismNamespaceAccess({ storage, config }, carol, CONTENT(), 'write');
        expect(r?.status).toBe(403);
        expect(r?.code).toBe('ACCESS_DENIED');
        expect(r?.message).toContain('not an active member');
        expect(r?.message).toContain('contributor role');
        expect(await checkOrganismNamespaceAccess({ storage, config }, carol, `organism.${ORG}.meta.workspaces`, 'write')).not.toBeNull();
    });

    it('under "listed", an attached agent whose owner is not a member gets nothing, and an unlisted agent is refused', async () => {
        await setAccess('listed');
        const carol = await checkOrganismNamespaceAccess({ storage, config }, asAgent('carol'), `organism.${ORG}.shared.notes`, 'write');
        expect(carol?.code).toBe('ACCESS_DENIED');
        expect(carol?.message).toContain('Not an active member');
        const unlisted = await checkOrganismNamespaceAccess({ storage, config }, asAgent('alice', 'helper'), CONTENT(), 'write');
        expect(unlisted?.code).toBe('ACCESS_DENIED');
        expect(unlisted?.message).toContain('admits only the agents');
    });
});

describe('the organism\'s agent list, for an agent (aimeat_organism_agent_attach / _detach)', () => {
    // 2026-11-11: the owner asked their AI to list an admin's agent under "listed", and no MCP tool
    // reached the list. The service is what the route and both tools call.
    const attach = (callerOwner: string, mayActAsPerson: boolean, agentGaii: string) =>
        attachOrganismAgent(storage, config, { organismId: ORG, callerOwner, mayActAsPerson, agentGaii });
    const makeAgent = async (owner: string) => {
        if (await storage.getAgent(agentOf(owner, 'helper'))) return;
        const now = new Date().toISOString();
        await storage.createAgent({
            name: 'helper', owner, gaii: agentOf(owner, 'helper'), publicKey: 'pk', trustScore: 50,
            morselBalance: 0, capabilities: [], createdAt: now, lastSeen: now,
        } as never);
    };
    const codeOf = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AgentListError ? `${e.code}: ${e.message}` : String(e)));

    it('under "listed", the owner\'s agent acting for the person lists a member\'s agent, which then gets in, and takes it off again', async () => {
        await setAccess('listed');
        await makeAgent('bob');
        const barred = async () => agentBarred(await storage.getOrganism(ORG), agentOf('bob', 'helper'));
        expect(await barred()).toBe(true);
        expect(await codeOf(attach('alice', true, agentOf('bob', 'helper')))).toBe('ok');
        expect(await barred()).toBe(false);
        expect(await detachOrganismAgent(storage, { organismId: ORG, callerOwner: 'alice', agentGaii: agentOf('bob', 'helper') }))
            .toEqual({ detached: agentOf('bob', 'helper') });
        expect(await barred()).toBe(true);
    });

    it('under "listed", an agent without account:security is refused and told which permission lets it', async () => {
        await setAccess('listed');
        expect(await codeOf(attach('alice', false, agentOf('bob', 'helper')))).toMatch(/^ACCESS_DENIED: .*account:security/);
    });

    it('under "listed", a plain member\'s agent cannot list its own sibling, even acting for the person', async () => {
        await setAccess('listed');
        expect(await codeOf(attach('bob', true, agentOf('bob', 'helper')))).toMatch(/^ACCESS_DENIED: .*only its owner or an admin/);
    });

    it('an agent of a non-member is not listed', async () => {
        await setAccess('listed');
        await makeAgent('carol');
        expect(await codeOf(attach('alice', true, agentOf('carol', 'helper')))).toMatch(/^NOT_MEMBER: /);
    });
});

describe('the doors an agent writes through', () => {
    const opsCaller = (owner: string, name = 'claude') =>
        workspaceCallerOf({ principal: agentOf(owner, name), ownerName: owner, roles: ['agent'], scopes: ['memory:write', 'memory:read'] }, config);

    it('the creator\'s attached agent writes a workspace record under "all" (aimeat_workspace_write)', async () => {
        await setAccess('all');
        const r = await writeWorkspaceDraftsOp({ storage, config }, opsCaller('alice'),
            { organismId: ORG, ws: WS, space: 'contact', id: 'c1', value: { id: 'c1', name: 'Anna' }, pipeline: 'test' });
        expect(r.ok ? 'written' : `${r.code}: ${r.message}`).toBe('written');
    });

    it('the creator\'s attached agent writes through an extension action under "all" (ctx.workspace.write)', async () => {
        await setAccess('all');
        const cap = buildExtensionWorkspace({
            config, storage, extName: 'pipeline', actionId: 'advance',
            declaration: { read: true, write: true, rows: false }, installer: 'alice',
            caller: { gaii: agentOf('alice'), owner: 'alice', roles: ['agent'], scopes: ['memory:write', 'organism:read'] },
            reachesModel: false,
        });
        await expect(cap.workspace.write(ORG, WS, 'contact', 'c2', { id: 'c2', name: 'Bert' })).resolves.toBeTruthy();
        expect(cap.lastRefusal()).toBeNull();
    });

    it('an admin\'s agent that a "listed" organism does not admit is told so on an extension\'s workspace read, not "Not an active member"', async () => {
        // 2026-11-11: an organism admin's own agent ran an extension action that reads the workspace
        // (ctx.workspace.index) and heard "Not an active member of this organism", although its
        // owner is an active admin; the agent was simply not on the organism's list.
        const cap = () => buildExtensionWorkspace({
            config, storage, extName: 'pipeline', actionId: 'status',
            declaration: { read: true, write: true, rows: false }, installer: 'alice',
            caller: { gaii: agentOf('alice', 'helper'), owner: 'alice', roles: ['agent'], scopes: ['memory:write', 'organism:read'] },
            reachesModel: false,
        });
        await setAccess('listed');
        const refused = cap();
        const err = await refused.workspace.index(ORG, WS).then(() => null, (e: unknown) => String(e instanceof Error ? e.message : e));
        expect(err).toContain('admits only the agents');
        expect(err).not.toContain('Not an active member');
        expect(refused.lastRefusal()?.status).toBe(403);
        // Under "all" the same agent reads as its owner does.
        await setAccess('all');
        await expect(cap().workspace.index(ORG, WS)).resolves.toBeTruthy();
    });

    it('a refused draft write carries the rule\'s own code and reason', async () => {
        await setAccess('all');
        const write = (owner: string) => writeWorkspaceDraftsOp({ storage, config }, opsCaller(owner),
            { organismId: ORG, ws: WS, space: 'contact', id: 'c3', value: { id: 'c3', name: 'Cid' }, pipeline: 'test' });
        // A member without the contributor role: CONSENT_REQUIRED, told to request the role, no probe key.
        const bob = await write('bob');
        expect(bob.ok).toBe(false);
        if (!bob.ok) {
            expect(bob.code).toBe('CONSENT_REQUIRED');
            expect(bob.message).toContain('contributor role');
            expect(bob.message).toContain('aimeat_workspace_access');
            expect(bob.message).not.toContain('.probe');
        }
        // An attached agent of a non-member: the participant reason, never "request access".
        const carol = await write('carol');
        expect(carol.ok).toBe(false);
        if (!carol.ok) {
            expect(carol.code).toBe('ACCESS_DENIED');
            expect(carol.message).toContain('not an active member');
            expect(carol.message).not.toContain('Request access');
        }
    });
});
