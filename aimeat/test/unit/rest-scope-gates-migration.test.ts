/**
 * @file test/unit/rest-scope-gates-migration.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one-time grant that goes with the REST scope gates of 4.0.0
 *   (services/rest-scope-gates-migration.ts).
 *
 *   - An existing agent that reads the owner's installs (GET /v1/instances, which asked nothing before)
 *     keeps reading them on 4.0.0 after the grant, and is refused there without it.
 *   - The grant writes only the new word (packages:read). An agent never gains a word that already
 *     existed (task:write, organism:invite and the rest), because each of those opens other routes and
 *     tools its owner did not grant.
 *   - A wildcard agent, a `packages:*` agent and an agent with no recorded scope list are left alone.
 *   - An active ecosystem app gets the word; a pending one does not. An app grant does not: it follows
 *     its app's own declaration, and the next refresh would trim a word written here.
 *   - It runs once per node: a second run changes nothing, and an agent made after the run, or one
 *     whose owner took the word away, does not get it back.
 * @usage cd aimeat && pnpm exec vitest run test/unit/rest-scope-gates-migration.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-12 — Initial (wish-rest-reitit-ilman-scope-tarkistusta-agentti-p-see-kaikkeen).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const v = vi.hoisted(() => ({ version: '4.0.0' }));
vi.mock('../../src/utils/version.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getSoftwareVersion: () => v.version,
}));

import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { initNodeKeys, initRevocationStorage, issueJWT } from '../../src/auth/jwt.js';
import { initSessionAuth } from '../../src/auth/middleware.js';
import { initStats } from '../../src/services/stats.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { instancesRouter } from '../../src/routes/instances.js';
import { migrateRestScopeGatesOnce, REST_SCOPE_GATES_KEY } from '../../src/services/rest-scope-gates-migration.js';

const NODE_ID = 'aimeat-rest-scope-migration';
const OWNER = 'migrationowner';
const gaii = (name: string): string => `${name}#${OWNER}@${NODE_ID}`;

let storage: Storage;
let config: AimeatConfig;
let server: http.Server;
let base = '';

async function makeAgent(name: string, scopes: string[] | undefined): Promise<void> {
    const now = new Date().toISOString();
    const keys = await generateKeyPair();
    await storage.createAgent({
        name, owner: OWNER, gaii: gaii(name), publicKey: keys.publicKey, trustScore: 50, morselBalance: 0, capabilities: [],
        ...(scopes ? { defaultScopes: scopes } : {}), createdAt: now, lastSeen: now,
    } as never);
}

async function scopesOf(name: string): Promise<string[] | undefined> {
    return (await storage.getAgent(gaii(name)))?.defaultScopes;
}

async function listInstancesAs(name: string): Promise<number> {
    const now = new Date();
    const sessionId = `sess-${name}-${Math.random().toString(36).slice(2)}`;
    await storage.createSession({ sessionId, gaii: gaii(name), owner: OWNER, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 600_000).toISOString() });
    // The token carries the agent's scopes at mint; requireAuth narrows to the record's current list (AUTH-08).
    const token = await issueJWT({ sub: gaii(name), owner: OWNER, node: NODE_ID, roles: ['agent'], scopes: (await scopesOf(name)) ?? [] }, 600, sessionId);
    const res = await fetch(`${base}/v1/instances`, { headers: { Authorization: `Bearer ${token}` } });
    return res.status;
}

beforeAll(async () => {
    v.version = '4.0.0';
    setThisNodeId(null);
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    config = { ...loadConfig().config, nodeId: NODE_ID, baseUrl: 'https://node.test' };
    const nodeKeys = await generateKeyPair();
    await initNodeKeys(nodeKeys.publicKey, nodeKeys.privateKey);
    initSessionAuth(storage, config);
    initRevocationStorage(storage, NODE_ID);
    await initStats();
    const ownerKeys = await generateKeyPair();
    await storage.createOwner({ name: OWNER, displayName: OWNER, publicKey: ownerKeys.publicKey, roles: ['owner'], createdAt: new Date().toISOString() } as never);

    await makeAgent('reader', ['memory:read', 'memory:write']);
    await makeAgent('wild', ['*']);
    await makeAgent('pkgs', ['packages:*']);
    await makeAgent('nolist', undefined);

    const now = new Date().toISOString();
    await storage.createAppGrant({
        grantId: 'grant-1', app: `${OWNER}/notes.html`, appName: 'Notes', appOrigin: 'https://notes.node.test', owner: OWNER,
        gaii: `${OWNER}@${NODE_ID}`, scopes: ['memory:read'], refreshTokenHash: null, createdAt: now, lastUsedAt: null, revoked: false,
    });
    for (const [app, status] of [['radio', 'active'], ['pending', 'pending']] as const) {
        await storage.createEcosystemApp({
            app, owner: OWNER, geai: `eco:${app}#${OWNER}@${NODE_ID}`, publicKey: 'pk', scopes: ['memory:write'], status, morselBalance: 0,
            createdAt: now, updatedAt: now, lastSeen: now,
        } as never);
    }

    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware());
    app.use(instancesRouter(config, storage));
    server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
    server?.closeAllConnections();
    await new Promise((r) => server.close(() => r(null)));
    setThisNodeId(null);
});

describe('the one-time grant of the REST scope gates', () => {
    it('before it, an existing agent that reads the installs is refused on 4.0.0', async () => {
        expect(await listInstancesAs('reader')).toBe(403);
    });

    it('gives packages:read to every agent and active ecosystem app that lacks it, and records the run', async () => {
        const result = await migrateRestScopeGatesOnce(storage, NODE_ID);
        expect(result.ran).toBe(true);
        expect(result.agents).toEqual([gaii('reader')]);
        expect(await scopesOf('reader')).toEqual(['memory:read', 'memory:write', 'packages:read']);
        // An app grant follows its app's declaration and a refresh would trim the word; it is left alone.
        expect((await storage.listAppGrants()).find(g => g.grantId === 'grant-1')!.scopes).toEqual(['memory:read']);
        expect(result.ecosystemApps).toEqual([`eco:radio#${OWNER}@${NODE_ID}`]);
        expect((await storage.getEcosystemApp(`eco:pending#${OWNER}@${NODE_ID}`))!.scopes).toEqual(['memory:write']);
        expect(await storage.getMemory(`system@${NODE_ID}`, REST_SCOPE_GATES_KEY)).not.toBeNull();
    });

    it('after it, the same agent keeps reading the installs on 4.0.0', async () => {
        expect(await listInstancesAs('reader')).toBe(200);
    });

    it('never writes a word that already existed: the agent gains nothing for the other gated routes', async () => {
        const held = (await scopesOf('reader'))!;
        for (const word of ['task:write', 'task:read', 'organism:invite', 'organism:read', 'ext:invoke', 'commerce:buy', 'agent:write', 'workflow:write']) {
            expect(held).not.toContain(word);
        }
    });

    it('leaves a wildcard agent, a packages:* agent and an agent with no recorded list alone', async () => {
        expect(await scopesOf('wild')).toEqual(['*']);
        expect(await scopesOf('pkgs')).toEqual(['packages:*']);
        expect(await scopesOf('nolist')).toBeUndefined();
    });

    it('runs once: a second run changes nothing, and an agent made later or narrowed by its owner does not get the word', async () => {
        await makeAgent('later', ['memory:read']);
        await storage.updateAgent(gaii('reader'), { defaultScopes: ['memory:read', 'memory:write'] });
        const again = await migrateRestScopeGatesOnce(storage, NODE_ID);
        expect(again.ran).toBe(false);
        expect(await scopesOf('later')).toEqual(['memory:read']);
        expect(await scopesOf('reader')).toEqual(['memory:read', 'memory:write']);
        expect(await listInstancesAs('later')).toBe(403);
    });
});
