/**
 * @file test/unit/verified-app-agent-scopes.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The "app" agent that e-mail verification creates (POST /v1/ghii/verify-email,
 *   routes/ghii/web-verify.ts) holds the node's default agent scopes, so the token the door hands out
 *   can act (ruling decision-4-0-0-siivouksen-23-avointa-p-t-st-suositusten-mukaan, item 10).
 *
 *   Before the fix the agent record had no scope list. The token claimed the default scopes, and the
 *   route layer narrows a token to its agent record's current list (auth/effective-scopes.ts), so every
 *   scope-gated route refused it: SCOPE_DENIED, "Agent scopes: []".
 *
 *   Drives the real verify-email route and the real memory routes against in-memory SQLite.
 * @usage cd aimeat && pnpm exec vitest run test/unit/verified-app-agent-scopes.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-12 — Initial.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';

import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { initNodeKeys, initRevocationStorage } from '../../src/auth/jwt.js';
import { initSessionAuth } from '../../src/auth/middleware.js';
import { initStats } from '../../src/services/stats.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { emailHashOf } from '../../src/services/owner-provisioning.js';
import { registerWebVerifyRoutes } from '../../src/routes/ghii/web-verify.js';
import { memoryRouter } from '../../src/routes/memory.js';

const NODE_ID = 'aimeat-verified-app-agent-test';
const OWNERS = ['verifyowner', 'oldappowner'] as const;

let storage: Storage;
let config: AimeatConfig;
let server: http.Server;
let base = '';

async function call(method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; body: any }> {
    const res = await fetch(`${base}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: parsed };
}

/** A pending registration verification with a code the test knows, as POST /v1/ghii/register-web writes one. */
async function seedVerification(owner: string, code: string): Promise<string> {
    const id = randomBytes(16).toString('hex');
    await storage.createEmailVerification({
        id,
        ownerName: owner,
        emailHash: emailHashOf(`${owner}@example.test`),
        code: createHash('sha256').update(code).digest('hex'),
        purpose: 'registration',
        status: 'pending',
        attempts: 0,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString(),
        verifiedAt: null,
    });
    return id;
}

beforeAll(async () => {
    setThisNodeId(null);
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    config = { ...loadConfig().config, nodeId: NODE_ID, baseUrl: 'https://node.test' };
    const nodeKeys = await generateKeyPair();
    await initNodeKeys(nodeKeys.publicKey, nodeKeys.privateKey);
    initSessionAuth(storage, config);
    initRevocationStorage(storage, NODE_ID);
    await initStats();

    const now = new Date().toISOString();
    for (const owner of OWNERS) {
        const keys = await generateKeyPair();
        await storage.createOwner({ name: owner, displayName: owner, publicKey: keys.publicKey, roles: ['owner'], createdAt: now } as never);
        await storage.createGHII({
            username: owner, nodeId: NODE_ID, ghii: `${owner}@${NODE_ID}`, displayName: owner,
            ownerName: owner, totpEnabled: false, verificationLevel: 0, createdAt: now, updatedAt: now,
        } as never);
    }
    // An "app" agent made by an earlier verification, before the fix: no scope list of its own.
    const oldKeys = await generateKeyPair();
    await storage.createAgent({
        name: 'app', owner: 'oldappowner', gaii: `app#oldappowner@${NODE_ID}`, publicKey: oldKeys.publicKey,
        trustScore: 50, morselBalance: 0, capabilities: [], createdAt: now, lastSeen: now,
    } as never);

    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware());
    const ghiiRoutes = express.Router();
    registerWebVerifyRoutes(ghiiRoutes, config, storage, undefined, undefined, (_req, _res, next) => next());
    app.use(ghiiRoutes);
    app.use(memoryRouter(config, storage));
    server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
    server?.closeAllConnections();
    await new Promise((r) => server.close(() => r(null)));
    setThisNodeId(null);
});

describe('the app agent e-mail verification creates', () => {
    it('is created with the node default agent scopes, and its token reads memory (memory:read is a default scope)', async () => {
        const id = await seedVerification('verifyowner', '482915');
        const v = await call('POST', '/v1/ghii/verify-email', { verification_id: id, code: '482915' });
        expect(v.status, JSON.stringify(v.body?.error)).toBe(200);
        expect(config.defaultAgentScopes).toContain('memory:read');
        const read = await call('GET', '/v1/memory?limit=1', undefined, v.body.data.token as string);
        expect(read.status, JSON.stringify(read.body?.error)).toBe(200);
        const agent = await storage.getAgent(`app#verifyowner@${NODE_ID}`);
        expect(agent?.defaultScopes).toEqual(config.defaultAgentScopes);
    });

    it('an app agent an earlier verification left with no scope list gets the default scopes at the next verification', async () => {
        const id = await seedVerification('oldappowner', '557301');
        const v = await call('POST', '/v1/ghii/verify-email', { verification_id: id, code: '557301' });
        expect(v.status, JSON.stringify(v.body?.error)).toBe(200);
        expect((await storage.getAgent(`app#oldappowner@${NODE_ID}`))?.defaultScopes).toEqual(config.defaultAgentScopes);
        const read = await call('GET', '/v1/memory?limit=1', undefined, v.body.data.token as string);
        expect(read.status, JSON.stringify(read.body?.error)).toBe(200);
    });

    it('the token stays an agent credential: a word outside the defaults is still refused', async () => {
        const id = await seedVerification('verifyowner', '730114');
        const v = await call('POST', '/v1/ghii/verify-email', { verification_id: id, code: '730114' });
        expect(v.status).toBe(200);
        const claims = JSON.parse(Buffer.from(String(v.body.data.token).split('.')[1]!, 'base64url').toString('utf-8'));
        expect(claims.roles).toEqual(['agent']);
        expect(claims.scopes).not.toContain('*');
    });
});
