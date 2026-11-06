/**
 * @file test/unit/place-agent-default-step.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The step that gives a store place's default to the agents that exist
 *   (givePlaceDefaultToEveryAgent, src/services/place-agent-scopes.ts; codebase analysis 2026-11-03,
 *   decision 8b of 2026-11-05), on a real SQLite store:
 *   - off a store place it writes nothing at all: no record, no agent row changed;
 *   - on a store place every agent gets the place's words added to what it held, `*` gains nothing,
 *     anonymous mode's shared agent is left alone, and an agent with no list gets the words as its list;
 *   - it runs once per agent: a second run changes nothing, and a word the owner removed stays removed;
 *   - two processes on one database that run it at once add each word once and claim each agent once;
 *   - an agent made while no plan was set gets the words when the plan is set later;
 *   - the approval door's applyPlaceDefault adds nothing to an agent the step gave the default.
 * @usage cd aimeat && pnpm exec vitest run test/unit/place-agent-default-step.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-05 — Initial (codebase analysis 2026-11-03, decision 8b of 2026-11-05).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, AgentRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { givePlaceDefaultToEveryAgent, applyPlaceDefault, placeAgentScopes } from '../../src/services/place-agent-scopes.js';

const NODE_ID = 'place-node';
const sold = { nodeId: NODE_ID, siteLinks: { purchasePlan: 'Solo' }, maxAgentScopes: ['*'] } as unknown as AimeatConfig;
const unsold = { nodeId: NODE_ID, siteLinks: { purchasePlan: '' }, maxAgentScopes: ['*'] } as unknown as AimeatConfig;
const PLACE = placeAgentScopes(sold) ?? [];

async function agent(storage: Storage, name: string, owner: string, scopes: string[] | undefined): Promise<string> {
    const gaii = `${name}#${owner}@${NODE_ID}`;
    const now = new Date().toISOString();
    await storage.createAgent({
        name, owner, gaii, publicKey: 'pk', trustScore: 50, morselBalance: 0, capabilities: [], createdAt: now, lastSeen: now,
        ...(scopes ? { defaultScopes: scopes } : {}),
    } as AgentRecord);
    return gaii;
}
const scopesOf = async (storage: Storage, gaii: string) => (await storage.getAgent(gaii))?.defaultScopes;
const snapshot = async (storage: Storage) => JSON.stringify((await storage.listAgents()).map(a => [a.gaii, a.defaultScopes]).sort());

let dir = '';
let storage: Storage;
beforeEach(() => {
    setThisNodeId(null);
    dir = mkdtempSync(join(tmpdir(), 'place-default-'));
    storage = new SqliteStorage(join(dir, 'node.db')) as unknown as Storage;
});
afterEach(() => {
    (storage as unknown as { close?: () => void }).close?.();
    rmSync(dir, { recursive: true, force: true });
});

describe('the store place default step', () => {
    it('writes nothing off a store place: no record and no agent changed', async () => {
        await agent(storage, 'narrow', 'alice', ['memory:read']);
        await agent(storage, 'bare', 'alice', undefined);
        const before = await snapshot(storage);
        const r = await givePlaceDefaultToEveryAgent(storage, unsold);
        expect(r).toEqual({ ran: false, agents: [], failed: [] });
        expect(await snapshot(storage)).toBe(before);
        expect(await storage.getMemory(`system@${NODE_ID}`, 'place.agent-default-applied')).toBeNull();
    });

    it('adds the place\'s words to every agent, gives `*` nothing, and leaves the shared anonymous agent alone', async () => {
        expect(PLACE.length).toBeGreaterThan(20);
        const narrow = await agent(storage, 'narrow', 'alice', ['memory:read', 'secrets:manage']);
        const full = await agent(storage, 'full', 'alice', ['*']);
        const bare = await agent(storage, 'bare', 'bob', undefined);
        const shared = await agent(storage, 'shared', 'anonymous', ['memory:read']);
        const r = await givePlaceDefaultToEveryAgent(storage, sold);
        expect(r.ran).toBe(true);
        expect(r.agents.sort()).toEqual([bare, narrow].sort());
        const got = (await scopesOf(storage, narrow))!;
        expect(got.slice(0, 2)).toEqual(['memory:read', 'secrets:manage']);
        for (const w of PLACE) expect(got).toContain(w);
        expect(new Set(got).size).toBe(got.length);
        expect(await scopesOf(storage, full)).toEqual(['*']);
        expect(await scopesOf(storage, bare)).toEqual(PLACE);
        expect(await scopesOf(storage, shared)).toEqual(['memory:read']);
    });

    it('runs once per agent: a second run changes nothing, and a word the owner removed stays removed', async () => {
        const narrow = await agent(storage, 'narrow', 'alice', ['memory:read']);
        await givePlaceDefaultToEveryAgent(storage, sold);
        await storage.updateAgent(narrow, { defaultScopes: ['memory:read'] });
        const before = await snapshot(storage);
        const again = await givePlaceDefaultToEveryAgent(storage, sold);
        expect(again.agents).toEqual([]);
        expect(await snapshot(storage)).toBe(before);
        // The approval door adds nothing either: the agent had its default.
        expect(await applyPlaceDefault(storage, sold, narrow, ['memory:read'])).toEqual(['memory:read']);
    });

    it('two processes on one database running it at once add each word once and claim each agent once', async () => {
        const gaiis: string[] = [];
        for (let i = 0; i < 12; i++) gaiis.push(await agent(storage, `a${i}`, 'alice', ['memory:read']));
        const second = new SqliteStorage(join(dir, 'node.db')) as unknown as Storage;
        try {
            const [one, two] = await Promise.all([givePlaceDefaultToEveryAgent(storage, sold), givePlaceDefaultToEveryAgent(second, sold)]);
            expect([...one.agents, ...two.agents].sort()).toEqual([...gaiis].sort());
            expect(one.agents.filter(g => two.agents.includes(g))).toEqual([]);
            for (const g of gaiis) {
                const got = (await scopesOf(storage, g))!;
                expect(new Set(got).size).toBe(got.length);
                expect(got.length).toBe(1 + PLACE.filter(w => w !== 'memory:read').length);
            }
        } finally {
            (second as unknown as { close?: () => void }).close?.();
        }
    });

    it('an agent made while no plan was set gets the words when the plan is set later', async () => {
        await givePlaceDefaultToEveryAgent(storage, unsold);
        const later = await agent(storage, 'later', 'alice', ['memory:read']);
        expect(await applyPlaceDefault(storage, unsold, later, ['memory:read'])).toEqual(['memory:read']);
        await givePlaceDefaultToEveryAgent(storage, sold);
        expect(await scopesOf(storage, later)).toContain('notifications:send');
    });
});
