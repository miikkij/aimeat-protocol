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
 *   v1.0.0 — 2026-10-15 — Initial (feature-list audit 73).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { crewSeed, type CrewCaller } from '../../src/services/crew-ops.js';

const NODE = 'aimeat-unit-crewsites-001';
let deps: { storage: Storage; config: AimeatConfig };

beforeAll(async () => {
    const storage = new SqliteStorage(':memory:') as unknown as Storage;
    const config = { ...loadConfig().config, nodeId: NODE } as AimeatConfig;
    const now = new Date().toISOString();
    for (const name of ['browsy', 'browsy2']) {
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
