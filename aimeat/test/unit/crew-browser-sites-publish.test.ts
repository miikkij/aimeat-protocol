/**
 * @file crew-browser-sites-publish.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Feature-list audit row 73: the sites a crew's browser may open are the owner's to
 *   approve, and the node checked the list only when an agent was proposed. A publish, seed or
 *   restore by the agent itself now refuses a list with the wrong shape (400 INVALID_CREW_DEF) and a
 *   list the owner has not published (403 OWNER_APPROVES_SITES). The owner in person passes the site
 *   check and goes on to the runtime's own validation.
 * @usage cd aimeat && pnpm exec vitest run test/unit/crew-browser-sites-publish.test.ts
 * @version-history
 *   2026-10-16 — The plain memory write of the live definition: the agent cannot widen its own list,
 *     an unchanged list and the owner's change pass, a draft is not held to it (QA audit F07b-02).
 *   v1.0.0 — 2026-10-15 — Initial (feature-list audit 73).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { crewSeed, type CrewCaller } from '../../src/services/crew-ops.js';
import { writeMemoryRecord } from '../../src/services/memory-write.js';

const NODE = 'aimeat-unit-crewsites-001';
let deps: { storage: Storage; config: AimeatConfig };

beforeAll(async () => {
    const storage = new SqliteStorage(':memory:') as unknown as Storage;
    const config = { ...loadConfig().config, nodeId: NODE } as AimeatConfig;
    const now = new Date().toISOString();
    for (const name of ['browsy', 'browsy2', 'memwriter']) {
        await storage.createAgent({
            name, owner: 'alice', gaii: `${name}#alice@${NODE}`, capabilities: [], publicKey: 'pk',
            trustScore: 50, morselBalance: 0, createdAt: now, lastSeen: now,
        } as never);
    }
    deps = { storage, config };
});

const agentCaller: CrewCaller = { principal: `browsy#alice@${NODE}`, owner: 'alice', scopes: ['memory:write'], roles: ['agent'], pipeline: 'test' };
const ownerCaller: CrewCaller = { principal: `alice@${NODE}`, owner: 'alice', scopes: [], roles: ['owner'], pipeline: 'test' };
const withSites = (sites: unknown) => ({ agents: [{ name: 'reader', role: 'reader', tools: ['browser'] }], tasks: [], browser_domains: sites }) as never;

describe('the browser site list on a publishing path', () => {
    it('refuses a list with the wrong shape', async () => {
        const out = await crewSeed(deps, agentCaller, 'browsy', withSites(['http://example.com/x']));
        expect(out).toMatchObject({ ok: false, status: 400, code: 'INVALID_CREW_DEF' });
    });

    it('refuses a list the owner has not published, to the agent itself', async () => {
        const out = await crewSeed(deps, agentCaller, 'browsy', withSites(['example.com']));
        expect(out).toMatchObject({ ok: false, status: 403, code: 'OWNER_APPROVES_SITES' });
    });

    it('lets the owner in person past the site check', async () => {
        const out = await crewSeed(deps, ownerCaller, 'browsy2', withSites(['example.com']));
        expect((out as { code?: string }).code).not.toBe('OWNER_APPROVES_SITES');
    });
});

// QA audit F07b-02: crews.registry.<agent> stays off the reserved-key list, so the agent could replace
// its own live definition with a plain memory write and widen its browser list past the owner.
describe('the browser site list on the plain memory write', () => {
    const live = (sites: string[]) => ({
        version: 1, revision: 1, publishedAt: '2026-10-16T00:00:00Z', publishedBy: `alice@${NODE}`, agent_name: 'memwriter',
        doc: { agents: [{ name: 'reader', role: 'reader', tools: ['browser'] }], tasks: [], browser_domains: sites },
    });
    const agentGaii = `memwriter#alice@${NODE}`;
    const asAgent = { principal: agentGaii, targetGaii: agentGaii, scopes: ['memory:write'], roles: ['agent'] };
    const asOwner = { principal: `alice@${NODE}`, targetGaii: agentGaii, scopes: [], roles: ['owner'] };
    const write = (caller: typeof asAgent, value: unknown) => writeMemoryRecord({ storage: deps.storage, config: { ...deps.config, aiProvenance: false } }, caller, {
        key: 'crews.registry.memwriter', value, visibility: 'private', pipeline: 'test',
    });

    it('refuses the agent a write that widens its own list, and the stored list is unchanged', async () => {
        expect((await write(asOwner, live(['example.com']))).ok).toBe(true);
        const out = await write(asAgent, live(['example.com', 'other.example.org']));
        expect(out).toMatchObject({ ok: false, status: 403, code: 'OWNER_APPROVES_SITES' });
        const stored = await deps.storage.getMemory(agentGaii, 'crews.registry.memwriter');
        expect((stored!.value as ReturnType<typeof live>).doc.browser_domains).toEqual(['example.com']);
    });

    it('lets the agent write its definition with the list unchanged, and the owner change the list', async () => {
        expect((await write(asAgent, live(['example.com']))).ok).toBe(true);
        expect((await write(asOwner, live(['example.com', 'docs.example.org']))).ok).toBe(true);
    });

    it('a draft is not the live definition, and is not held to the list', async () => {
        const out = await writeMemoryRecord({ storage: deps.storage, config: { ...deps.config, aiProvenance: false } }, asAgent, {
            key: 'crews.registry.memwriter.draft', value: { savedAt: 'now', doc: live(['anything.example']).doc }, visibility: 'private', pipeline: 'test',
        });
        expect(out.ok).toBe(true);
    });
});
