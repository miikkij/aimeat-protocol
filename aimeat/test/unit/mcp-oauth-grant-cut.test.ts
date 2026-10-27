/**
 * @file test/unit/mcp-oauth-grant-cut.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An MCP OAuth grant ends at the agent's credential cut (a key rotation, a device
 *   takeover, an agent delete, an account deactivation) whatever is in flight at that moment
 *   (secaudit2026oct26):
 *   - authorization-code-outlives-agent-credential-cut: a code issued before the cut redeems into
 *     nothing after it;
 *   - refresh-rotation-loses-grant-lineage: a refresh that read the agent before the cut and wrote its
 *     rotated row after the cut's delete leaves no row that keeps minting, and two redemptions of one
 *     refresh token mint once.
 *   The uses that stay: a code redeemed with no cut in between, a code issued after a rotation with
 *   the new key, and a client that refreshes again and again with nothing revoked.
 *
 *   Drives the real OAuth routes (mcpRouter) against in-memory SQLite. The cut is written into the
 *   store exactly as the rekey route, the agent delete and the deactivation write it.
 * @usage cd aimeat && pnpm exec vitest run test/unit/mcp-oauth-grant-cut.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair, sign } from '../../src/auth/keypair.js';
import { initNodeKeys, initRevocationStorage } from '../../src/auth/jwt.js';
import { initSessionAuth } from '../../src/auth/middleware.js';
import { initStats } from '../../src/services/stats.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { mcpRouter } from '../../src/mcp/index.js';

const NODE_ID = 'aimeat-mcp-grant-cut-test';
const BASE_URL = 'https://node.test';
const MCP_RESOURCE = `${BASE_URL}/v1/mcp`;
const OWNER = 'cutowner';
const GAII = `claude#${OWNER}@${NODE_ID}`;

let real: Storage;
let server: http.Server;
let base = '';
let agentPrivateKey = '';
let clientId = '';
let clientSecret = '';

/** Hooks the test arms for one call: run `after` once the store answered, before the route goes on. */
const hooks: { afterGetAgent?: () => Promise<void>; slowRefreshRead?: number } = {};

const storage = new Proxy({} as Storage, {
    get(_t, prop) {
        const v = Reflect.get(real as object, prop, real);
        if (prop === 'getAgent') {
            return async (...args: unknown[]) => {
                const out = await (v as (...a: unknown[]) => Promise<unknown>).apply(real, args);
                const after = hooks.afterGetAgent;
                if (after) { hooks.afterGetAgent = undefined; await after(); }
                return out;
            };
        }
        if (prop === 'getOAuthRefreshToken' && hooks.slowRefreshRead) {
            return async (...args: unknown[]) => {
                const out = await (v as (...a: unknown[]) => Promise<unknown>).apply(real, args);
                await new Promise(r => setTimeout(r, hooks.slowRefreshRead));
                return out;
            };
        }
        return typeof v === 'function' ? v.bind(real) : v;
    },
});

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
    const res = await fetch(`${base}${path}`, {
        method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    try { return { status: res.status, body: JSON.parse(text) }; } catch { return { status: res.status, body: text }; }
}

/** A code over the signature path, PKCE and resource included; answers the code and its verifier. */
async function code(): Promise<{ code: string; verifier: string }> {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const timestamp = new Date().toISOString();
    const signature = await sign(agentPrivateKey, GAII + NODE_ID + timestamp);
    const qs = new URLSearchParams({
        response_type: 'code', client_id: clientId, gaii: GAII, signature, timestamp,
        code_challenge: challenge, code_challenge_method: 'S256', resource: MCP_RESOURCE,
    });
    const r = await call('GET', `/v1/mcp/authorize?${qs}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return { code: r.body.code, verifier };
}

const redeem = (c: { code: string; verifier: string }) => call('POST', '/v1/mcp/token', {
    grant_type: 'authorization_code', code: c.code, code_verifier: c.verifier, resource: MCP_RESOURCE,
    client_id: clientId, client_secret: clientSecret,
});
const refresh = (token: string) => call('POST', '/v1/mcp/token', {
    grant_type: 'refresh_token', refresh_token: token, client_id: clientId, client_secret: clientSecret, resource: MCP_RESOURCE,
});

const tick = () => new Promise(r => setTimeout(r, 5));

/** The agent as a fresh approval leaves it, with a new key; the old one is gone. */
async function freshAgent(): Promise<void> {
    await real.deleteAgent(GAII);
    await createAgent();
}

/** A new agent of that name, made when none exists (an approval under a released name). */
async function createAgent(): Promise<void> {
    const keys = await generateKeyPair();
    agentPrivateKey = keys.privateKey;
    await real.createAgent({
        name: 'claude', owner: OWNER, gaii: GAII, publicKey: keys.publicKey, trustScore: 50,
        morselBalance: 0, capabilities: [], defaultScopes: ['memory:read'], createdAt: new Date().toISOString(), lastSeen: new Date().toISOString(),
    } as never);
}

/** The key rotation, as POST /v1/agents/:gaii/rekey writes it: new key, the stamp, the refresh rows gone. */
async function rotateKey(): Promise<void> {
    const keys = await generateKeyPair();
    agentPrivateKey = keys.privateKey;
    await real.updateAgent(GAII, { publicKey: keys.publicKey, credentialsValidAfter: new Date().toISOString() });
    await real.deleteOAuthRefreshTokensByGaii(GAII);
}

beforeAll(async () => {
    setThisNodeId(null);
    real = new SqliteStorage(':memory:') as unknown as Storage;
    const config: AimeatConfig = { ...loadConfig().config, nodeId: NODE_ID, baseUrl: BASE_URL };
    const nodeKeys = await generateKeyPair();
    await initNodeKeys(nodeKeys.publicKey, nodeKeys.privateKey);
    initSessionAuth(real, config);
    initRevocationStorage(real, NODE_ID);
    await initStats();
    const now = new Date().toISOString();
    const ownerKeys = await generateKeyPair();
    await real.createOwner({ name: OWNER, displayName: OWNER, publicKey: ownerKeys.publicKey, roles: ['owner'], createdAt: now } as never);
    await real.createGHII({
        username: OWNER, nodeId: NODE_ID, ghii: `${OWNER}@${NODE_ID}`, displayName: OWNER,
        ownerName: OWNER, totpEnabled: false, verificationLevel: 0, createdAt: now, updatedAt: now,
    } as never);
    await freshAgent();
    const app = express();
    app.use(express.json());
    app.use(mcpRouter(config, storage, new Map()));
    server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const reg = await call('POST', '/v1/mcp/register', { client_name: 'grant-cut-test' });
    clientId = reg.body.client_id;
    clientSecret = reg.body.client_secret;
}, 60_000);

afterAll(async () => {
    server?.closeAllConnections();
    await new Promise((r) => server.close(() => r(null)));
    setThisNodeId(null);
});

beforeEach(async () => {
    hooks.afterGetAgent = undefined;
    hooks.slowRefreshRead = undefined;
    await real.updateOwner(OWNER, { disabledAt: null } as never);
    await freshAgent();
});

describe('an authorization code issued before the cut', () => {
    it('redeems into nothing after a key rotation', async () => {
        const c = await code();
        await tick();
        await rotateKey();
        const r = await redeem(c);
        expect(r.status).toBe(400);
        expect(r.body.error).toBe('invalid_grant');
    });

    it('redeems into nothing for a new agent registered under the same name', async () => {
        const c = await code();
        await tick();
        await freshAgent();
        const r = await redeem(c);
        expect(r.status).toBe(400);
        expect(r.body.error).toBe('invalid_grant');
    });

    it('usage: a code issued after the rotation, with the new key, redeems', async () => {
        await rotateKey();
        await tick();
        const r = await redeem(await code());
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        expect(typeof r.body.refresh_token).toBe('string');
    });

    it('usage: a code redeemed with no cut in between redeems', async () => {
        const r = await redeem(await code());
        expect(r.status, JSON.stringify(r.body)).toBe(200);
    });
});

describe('a refresh in flight across the cut', () => {
    async function grant(): Promise<string> {
        const r = await redeem(await code());
        expect(r.status).toBe(200);
        return r.body.refresh_token as string;
    }

    it('a key rotation between the agent read and the rotated row leaves no row that mints', async () => {
        const rt = await grant();
        await tick();
        hooks.afterGetAgent = async () => { await rotateKey(); await tick(); };
        const first = await refresh(rt);
        const next = typeof first.body.refresh_token === 'string' ? await refresh(first.body.refresh_token) : first;
        expect(next.status).toBe(400);
    });

    it('an agent delete between the agent read and the rotated row leaves no row for the next agent of that name', async () => {
        const rt = await grant();
        await tick();
        hooks.afterGetAgent = async () => { await real.deleteAgent(GAII); await tick(); };
        const first = await refresh(rt);
        await createAgent();
        const next = typeof first.body.refresh_token === 'string' ? await refresh(first.body.refresh_token) : first;
        expect(next.status).toBe(400);
    });

    // At this point of the refresh the token mint itself refuses the deactivated account, so this case
    // held before the fix too; it stays as the guard for the whole rule.
    it('a deactivation between the agent read and the rotated row leaves no row that mints after reactivation', async () => {
        const rt = await grant();
        await tick();
        hooks.afterGetAgent = async () => {
            await real.updateOwner(OWNER, { disabledAt: new Date().toISOString() } as never);
            await real.deleteOAuthRefreshTokensByGaii(GAII);
        };
        const first = await refresh(rt);
        await real.updateOwner(OWNER, { disabledAt: null } as never);
        const next = typeof first.body.refresh_token === 'string' ? await refresh(first.body.refresh_token) : first;
        expect(next.status).not.toBe(200);
    });

    it('two redemptions of one refresh token mint once', async () => {
        const rt = await grant();
        hooks.slowRefreshRead = 40;
        const [a, b] = await Promise.all([refresh(rt), refresh(rt)]);
        hooks.slowRefreshRead = undefined;
        expect([a.status, b.status].sort()).toEqual([200, 400]);
    });

    it('usage: a client refreshes again and again with nothing revoked', async () => {
        let rt = await grant();
        for (let i = 0; i < 4; i++) {
            const r = await refresh(rt);
            expect(r.status, JSON.stringify(r.body)).toBe(200);
            rt = r.body.refresh_token;
        }
    });
});
