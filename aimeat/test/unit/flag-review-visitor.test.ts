/**
 * @file test/unit/flag-review-visitor.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description PUT /v1/flags/:id refuses a visitor signed in from another node under the same name
 *   as an organism admin, and lets the admin in person review the same flag. Runs the real
 *   flagsRouter, requireAuth and verifyJWT over an in-memory SQLite store.
 *
 *   WHY HERE AND NOT IN THE E2E. A visitor session is a token whose `federated` claim is set, which
 *   only the federation sign-in mints, and an E2E node has no second node to sign in from. The other
 *   refusals of this route (the admin's agent, a plain owner, the reporter) and the operator path
 *   are test/e2e-flag-review.ts. The 2026-09-14 fix added the visitor refusal; the 2026-10-16 fix
 *   made the organism-admin branch reachable (admins[] holds bare names), which is why the control
 *   below passes at all.
 * @usage cd aimeat && pnpm exec vitest run test/unit/flag-review-visitor.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit F13-03).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

vi.mock('../../src/utils/logger.js', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, OrganismRecord, FlagRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { initNodeKeys, initRevocationStorage, issueJWT } from '../../src/auth/jwt.js';
import { initSessionAuth } from '../../src/auth/middleware.js';
import { flagsRouter } from '../../src/routes/flags.js';

const NODE = 'aimeat-unit-001-flags';
const ADMIN = 'aino';
const ORG = 'org-flagvisit';
const STAMP = '2026-10-16T00:00:00.000Z';

let storage: Storage;
let server: http.Server;
let base = '';

const flag = (id: string): FlagRecord => ({
    id, targetType: 'memory', targetId: `${ADMIN}@${NODE}::organism.${ORG}.notes`, flaggedBy: `reporter@${NODE}`,
    reason: 'inappropriate', status: 'active', createdAt: STAMP,
} as FlagRecord);

async function review(id: string, token: string): Promise<{ status: number; body: any }> {
    const res = await fetch(`${base}/v1/flags/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: 'dismissed' }),
    });
    return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    const config = { nodeId: NODE, baseUrl: 'https://node.test' } as AimeatConfig;
    const keys = await generateKeyPair();
    await initNodeKeys(keys.publicKey, keys.privateKey);
    initRevocationStorage(storage, NODE);
    initSessionAuth(storage, config);

    const ownerKeys = await generateKeyPair();
    await storage.createOwner({ name: ADMIN, displayName: ADMIN, publicKey: ownerKeys.publicKey, roles: ['owner'], createdAt: STAMP } as never);
    await storage.createGHII({
        username: ADMIN, nodeId: NODE, ghii: `${ADMIN}@${NODE}`, displayName: ADMIN, ownerName: ADMIN,
        totpEnabled: false, verificationLevel: 0, createdAt: STAMP, updatedAt: STAMP,
    } as never);
    // admins[] in the form every writer stores it: the bare account name.
    await storage.createOrganism({
        id: ORG, name: 'Flag visit', description: 'x', type: 'community', interests: [], creatorGhii: ADMIN, createdBy: ADMIN,
        owners: [ADMIN], admins: [ADMIN], members: [ADMIN], agentGaiis: [], boardId: 'b1', joinPolicy: 'invite_only',
        maxMembers: 10, visibility: 'private', moderationConfig: { flagsEnabled: true, autoHideThreshold: 5, appealsEnabled: false },
        memoryNamespace: `organism.${ORG}`, createdAt: STAMP, updatedAt: STAMP,
    } as OrganismRecord);
    await storage.createFlag(flag('flag-visitor'));
    await storage.createFlag(flag('flag-admin'));

    const app = express();
    app.use(express.json());
    app.use(flagsRouter(config, storage));
    server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
    server?.closeAllConnections();
    await new Promise((r) => server.close(() => r(null)));
});

describe('PUT /v1/flags/:id on an organism flag', () => {
    it('refuses a visitor from another node signed in under the admin\'s name (403), and the flag stays open', async () => {
        const visitor = await issueJWT({
            sub: ADMIN, owner: ADMIN, node: 'aimeat-unit-002-elsewhere', roles: ['owner'], scopes: [],
            federated: true, homeNode: 'aimeat-unit-002-elsewhere', homeUrl: 'https://elsewhere.test',
        }, 3600);
        const r = await review('flag-visitor', visitor);
        expect(r.status, JSON.stringify(r.body)).toBe(403);
        expect((await storage.getFlag('flag-visitor'))?.status).toBe('active');
    });

    it('lets the organism admin in person review the same kind of flag (the control)', async () => {
        const admin = await issueJWT({ sub: ADMIN, owner: ADMIN, node: NODE, roles: ['owner'], scopes: [] }, 3600);
        const r = await review('flag-admin', admin);
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        const stored = await storage.getFlag('flag-admin');
        expect(stored?.status).toBe('dismissed');
        expect(stored?.reviewedBy).toBe(ADMIN);
    });
});
