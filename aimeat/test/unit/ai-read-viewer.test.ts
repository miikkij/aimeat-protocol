/**
 * @file test/unit/ai-read-viewer.test.ts
 * @description Who a model reads the owner scope for (services/ai-read-viewer.ts), what the one AI
 *   input loader then hands it (services/ai-inputs.ts readAiRecords), and which caller of an
 *   extension's action makes its ctx.ai.start read narrower than the installer (ai-jobs/
 *   ext-capability.ts attendedReadAs). The e2e suite e2e-ai-input-reach.ts proves the same on a node;
 *   this file covers the callers it cannot reach cheaply: another account's caller, a sibling agent
 *   that did not write the code, an app grant, a personal access token, a visitor.
 * @version-history
 *   v1.0.0 -- 2026-10-22 -- Initial (secaudit 2026-10, r49, v75).
 */
import { describe, it, expect } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import { aiReadViewerOf, AiInputHiddenError } from '../../src/services/ai-read-viewer.js';
import { readAiRecords } from '../../src/services/ai-inputs.js';
import { attendedReadAs } from '../../src/services/ai-jobs/ext-capability.js';
import { jobReadViewer } from '../../src/services/ai-jobs/starter.js';
import type { ContentReader } from '../../src/services/classification/reader.js';

const NODE = 'aimeat-local-001-dev';
const OWNER = `alice@${NODE}`;
const AGENT = `claude#alice@${NODE}`;
const SIBLING = `other#alice@${NODE}`;

const who = (principal: string, roles: string[], scopes: string[] = [], extra: Record<string, unknown> = {}) =>
    ({ principal, owner: 'alice', roles, scopes, ...extra });

describe('who reads every record of the owner scope', () => {
    it.each([
        ['the owner in person', who(OWNER, ['owner']), true],
        ['the owner through a personal access token', who(OWNER, ['owner'], [], { via: 'pat' }), true],
        ['an app grant', who(OWNER, ['app'], ['ai:use']), true],
        ['an agent holding memory:read-as-owner', who(AGENT, ['agent'], ['ai:use', 'memory:read-as-owner']), true],
        ['an agent holding every wildcard but not the word', who(AGENT, ['agent'], ['*']), false],
        ['an agent with ai:use and memory:read', who(AGENT, ['agent'], ['ai:use', 'memory:read']), false],
        ['a visitor from another node with role owner', who(`bob@other-node`, ['owner'], [], { federated: true }), false],
    ])('%s', (_label, w, all) => {
        expect(aiReadViewerOf(w)?.readsAll).toBe(all);
    });

    it('no principal is no viewer, which reads as before', () => {
        expect(aiReadViewerOf(undefined)).toBeUndefined();
        expect(jobReadViewer({})).toBeUndefined();
    });

    it('a job reads as `read_as` when one is recorded, and says where the extension setting is', () => {
        const v = jobReadViewer({ started_by: who(OWNER, ['owner']), read_as: who(AGENT, ['agent'], ['ext:write']) });
        expect(v?.principal).toBe(AGENT);
        expect(v?.readsAll).toBe(false);
        expect(v?.note).toMatch(/profile\?tab=extensions/);
    });
});

describe('whose invoke of an extension narrows its ctx.ai.start', () => {
    const caller = (gaii: string, roles: string[], scopes: string[] = []) => ({ gaii, owner: 'alice', roles, scopes });
    it('the agent that wrote the code, invoking it, reads as itself', () => {
        expect(attendedReadAs(AGENT, caller(AGENT, ['agent'], ['ext:invoke']))?.principal).toBe(AGENT);
    });
    it.each([
        ['the owner in person', OWNER, caller(OWNER, ['owner'])],
        ['an app grant (its principal is the account)', AGENT, caller(OWNER, ['app'])],
        ['a sibling agent that did not write it (ruling 3)', AGENT, caller(SIBLING, ['agent'], ['ext:invoke'])],
        ['another account calling the owner\'s extension (ruling 2)', AGENT, { gaii: `bob@${NODE}`, owner: 'bob', roles: ['owner'], scopes: [] }],
        ['an extension the owner wrote in person', 'alice', caller(OWNER, ['owner'])],
        ['a record written before the principal was kept', undefined, caller(AGENT, ['agent'])],
    ])('%s keeps the installer\'s reach', (_label, author, c) => {
        expect(attendedReadAs(author as string | undefined, c)).toBeUndefined();
    });
});

describe('readAiRecords with a viewer', () => {
    const at = '2026-10-22T00:00:00.000Z';
    const rec = (ownerGaii: string, key: string, value: string, visibility: string): MemoryRecord =>
        ({ ownerGaii, key, value, visibility, tags: [], ttlHours: null, version: 1, createdAt: at, updatedAt: at } as unknown as MemoryRecord);
    const rows = [
        rec(OWNER, 'secret', 'OWNER-PRIVATE', 'private'),
        rec(OWNER, 'shared', 'OWNER-SHARED', 'owner'),
        rec(OWNER, 'dup', 'DUP-OWNER', 'private'),
        rec(AGENT, 'dup', 'DUP-AGENT', 'private'),
        rec(AGENT, 'own', 'AGENT-OWN', 'private'),
        rec(SIBLING, 'sib', 'SIBLING-PRIVATE', 'private'),
    ];
    const storage = {
        getMemory: async (o: string, k: string) => rows.find(r => r.ownerGaii === o && r.key === k) ?? null,
        getAgentsByOwner: async () => [{ gaii: AGENT }, { gaii: SIBLING }],
        getEcosystemAppsByOwner: async () => [],
        listMemoryForOwners: async (ids: string[], o: { prefix?: string }) => rows.filter(r => ids.includes(r.ownerGaii) && r.key.startsWith(o.prefix ?? '')),
    } as unknown as Storage;
    const config = { nodeId: NODE } as AimeatConfig;
    // Classification off: the reader lets everything through, so only the viewer decides.
    const reader = { useForAi: async () => {}, show: async <T>(items: readonly T[]) => [...items] } as unknown as ContentReader;
    const read = (keys: string[], viewer?: ReturnType<typeof aiReadViewerOf>) =>
        readAiRecords({ storage, config }, reader, AGENT, keys.map(key => ({ key })), { capability: 'text' }, viewer);
    const agent = aiReadViewerOf(who(AGENT, ['agent'], ['ai:use', 'memory:read']));

    it('refuses the owner\'s and a sibling\'s private record, naming the permission', async () => {
        for (const key of ['secret', 'sib']) {
            const err = await read([key], agent).catch(e => e);
            expect(err).toBeInstanceOf(AiInputHiddenError);
            expect(err.code).toBe('SCOPE_DENIED');
            expect(err.message).toMatch(/memory:read-as-owner/);
            expect(err.message).not.toMatch(/PRIVATE/);
        }
    });

    it('hands over the agent\'s own record, the owner-visible one, and its own copy over a hidden owner copy', async () => {
        const got = await read(['own', 'shared', 'dup', 'missing'], agent);
        expect(got.map(g => g.value)).toEqual(['AGENT-OWN', 'OWNER-SHARED', 'DUP-AGENT', undefined]);
    });

    it('reads everything for a viewer that reads as the owner, and for no viewer at all', async () => {
        const all = aiReadViewerOf(who(AGENT, ['agent'], ['memory:read-as-owner']));
        for (const v of [all, undefined]) {
            const got = await read(['secret', 'sib', 'dup'], v);
            expect(got.map(g => g.value)).toEqual(['OWNER-PRIVATE', 'SIBLING-PRIVATE', 'DUP-OWNER']);
        }
    });
});
