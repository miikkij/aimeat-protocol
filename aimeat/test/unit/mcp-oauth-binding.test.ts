/**
 * @file test/unit/mcp-oauth-binding.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP OAuth from 4.0.0 requires PKCE (S256) and a resource indicator (RFC 8707), and binds
 *   the access token to this node's MCP endpoint as its audience. Before 4.0.0 a request without PKCE,
 *   without a resource, or a token without an audience is accepted and counted (GET /v1/stats,
 *   `mcp_oauth_legacy`). A token whose audience names another resource is refused in every version.
 *
 *   Drives the real OAuth routes and the real MCP endpoint (mcpRouter) against in-memory SQLite, with
 *   the running version switched per test: a 4.0.0 run and a 3.x run of the same code.
 * @usage cd aimeat && pnpm exec vitest run test/unit/mcp-oauth-binding.test.ts
 * @version-history
 *   v1.1.0 — 2026-10-13 — namesMcpResource pinned directly: what it accepts, what it refuses, and the
 *     long slash run that made its regex trim quadratic (code scanning alert 1733).
 *   v1.0.0 — 2026-10-12 — Initial (wish-mcp-oauth-vaatii-pkce-n-ja-sitoo-tokenin-mcp-osoitteeseen).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';

const v = vi.hoisted(() => ({ version: '4.0.0' }));
vi.mock('../../src/utils/version.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getSoftwareVersion: () => v.version,
}));

import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair, sign } from '../../src/auth/keypair.js';
import { getNodeCryptoKeys, initNodeKeys, initRevocationStorage, issueJWT } from '../../src/auth/jwt.js';
import { initSessionAuth } from '../../src/auth/middleware.js';
import { getStats, initStats } from '../../src/services/stats.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { mcpRouter } from '../../src/mcp/index.js';
import { namesMcpResource } from '../../src/mcp/oauth-binding.js';

const NODE_ID = 'aimeat-mcp-oauth-test';
const BASE_URL = 'https://node.test';
const MCP_RESOURCE = `${BASE_URL}/v1/mcp`;
const OWNER = 'pkceowner';
const GAII = `claude#${OWNER}@${NODE_ID}`;

let storage: Storage;
let config: AimeatConfig;
let server: http.Server;
let base = '';
let agentPrivateKey = '';
let clientId = '';
let clientSecret = '';

function pkcePair(): { verifier: string; challenge: string } {
    const verifier = randomBytes(32).toString('base64url');
    return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

function claimsOf(jwt: string): Record<string, unknown> {
    return JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString('utf-8')) as Record<string, unknown>;
}

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
    const res = await fetch(`${base}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* an SSE body stays text */ }
    return { status: res.status, body: parsed };
}

/** GET /v1/mcp/authorize over the signature path, which answers the code as JSON. */
async function authorize(extra: Record<string, string>): Promise<{ status: number; body: any }> {
    const timestamp = new Date().toISOString();
    const signature = await sign(agentPrivateKey, GAII + NODE_ID + timestamp);
    const qs = new URLSearchParams({ response_type: 'code', client_id: clientId, gaii: GAII, signature, timestamp, ...extra });
    return call('GET', `/v1/mcp/authorize?${qs}`);
}

async function token(body: Record<string, string>): Promise<{ status: number; body: any }> {
    return call('POST', '/v1/mcp/token', { client_id: clientId, client_secret: clientSecret, ...body });
}

/** An MCP `initialize` with this bearer: the status says whether the endpoint took the token. */
async function initialize(bearer: string): Promise<number> {
    const res = await fetch(`${base}/v1/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${bearer}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'pkce-test', version: '1.0.0' } } }),
    });
    await res.text();
    return res.status;
}

/** A session token signed with this node's key, as an MCP OAuth mint writes one, with or without `aud`. */
async function mcpToken(aud?: string): Promise<string> {
    const builder = new SignJWT({ owner: OWNER, node: NODE_ID, roles: ['agent'], scopes: ['memory:read'], mcp_client: 'pkce-test', iat_ms: Date.now() })
        .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
        .setSubject(GAII)
        .setIssuedAt()
        .setExpirationTime('10m');
    if (aud) builder.setAudience(aud);
    return builder.sign(getNodeCryptoKeys().privateKey);
}

function legacyCount(kind: string): number {
    const snap = getStats()!.snapshot() as unknown as Record<string, Record<string, number> | undefined>;
    return Number(snap.mcp_oauth_legacy_by_type?.[kind] ?? 0);
}

beforeAll(async () => {
    setThisNodeId(null);
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    config = { ...loadConfig().config, nodeId: NODE_ID, baseUrl: BASE_URL };
    const nodeKeys = await generateKeyPair();
    await initNodeKeys(nodeKeys.publicKey, nodeKeys.privateKey);
    initSessionAuth(storage, config);
    initRevocationStorage(storage, NODE_ID);
    await initStats();

    const now = new Date().toISOString();
    const ownerKeys = await generateKeyPair();
    await storage.createOwner({ name: OWNER, displayName: OWNER, publicKey: ownerKeys.publicKey, roles: ['owner'], createdAt: now } as never);
    await storage.createGHII({
        username: OWNER, nodeId: NODE_ID, ghii: `${OWNER}@${NODE_ID}`, displayName: OWNER,
        ownerName: OWNER, totpEnabled: false, verificationLevel: 0, createdAt: now, updatedAt: now,
    } as never);
    const agentKeys = await generateKeyPair();
    agentPrivateKey = agentKeys.privateKey;
    await storage.createAgent({
        name: 'claude', owner: OWNER, gaii: GAII, publicKey: agentKeys.publicKey, trustScore: 50,
        morselBalance: 0, capabilities: [], defaultScopes: ['memory:read'], createdAt: now, lastSeen: now,
    } as never);

    const app = express();
    app.use(express.json());
    app.use(mcpRouter(config, storage, new Map()));
    server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const reg = await call('POST', '/v1/mcp/register', { client_name: 'pkce-test' });
    clientId = reg.body.client_id;
    clientSecret = reg.body.client_secret;
}, 60_000);

afterAll(async () => {
    server?.closeAllConnections();
    await new Promise((r) => server.close(() => r(null)));
    setThisNodeId(null);
});

describe('MCP OAuth on a 4.0.0 node', () => {
    beforeEach(() => { v.version = '4.0.0'; });

    it('refuses an authorization request without code_challenge', async () => {
        const r = await authorize({ resource: MCP_RESOURCE });
        expect(r.status).toBe(400);
        expect(r.body.error).toBe('invalid_request');
    });

    it('refuses an authorization request without a resource', async () => {
        const { challenge } = pkcePair();
        const r = await authorize({ code_challenge: challenge, code_challenge_method: 'S256' });
        expect(r.status).toBe(400);
        expect(r.body.error).toBe('invalid_target');
    });

    it('refuses a resource that is not this node\'s MCP endpoint', async () => {
        const { challenge } = pkcePair();
        const r = await authorize({ code_challenge: challenge, code_challenge_method: 'S256', resource: 'https://other.example/v1/mcp' });
        expect(r.status).toBe(400);
        expect(r.body.error).toBe('invalid_target');
    });

    it('refuses a token request without the matching verifier', async () => {
        const { challenge } = pkcePair();
        const a = await authorize({ code_challenge: challenge, code_challenge_method: 'S256', resource: MCP_RESOURCE });
        expect(a.status).toBe(200);
        const t = await token({ grant_type: 'authorization_code', code: a.body.code, code_verifier: pkcePair().verifier });
        expect(t.status).toBe(400);
        expect(t.body.error).toBe('invalid_grant');
    });

    it('issues a token bound to the MCP endpoint for a PKCE + resource flow, and the endpoint takes it', async () => {
        const { verifier, challenge } = pkcePair();
        const a = await authorize({ code_challenge: challenge, code_challenge_method: 'S256', resource: MCP_RESOURCE });
        expect(a.status).toBe(200);
        const t = await token({ grant_type: 'authorization_code', code: a.body.code, code_verifier: verifier, resource: MCP_RESOURCE });
        expect(t.status).toBe(200);
        expect(claimsOf(t.body.access_token).aud).toBe(MCP_RESOURCE);
        expect(await initialize(t.body.access_token)).toBe(200);

        const r = await token({ grant_type: 'refresh_token', refresh_token: t.body.refresh_token, resource: MCP_RESOURCE });
        expect(r.status).toBe(200);
        expect(claimsOf(r.body.access_token).aud).toBe(MCP_RESOURCE);
    });

    it('refuses at the MCP endpoint a token whose audience names another resource', async () => {
        expect(await initialize(await mcpToken('https://other.example/v1/mcp'))).toBe(401);
    });

    it('refuses at the MCP endpoint an MCP OAuth token without an audience', async () => {
        expect(await initialize(await mcpToken())).toBe(401);
    });
});

describe('MCP OAuth on a 3.x node', () => {
    beforeEach(() => { v.version = '3.26.1'; });

    it('accepts a flow without PKCE or resource, binds the token anyway, and counts both', async () => {
        const noPkce = legacyCount('no_pkce');
        const noResource = legacyCount('no_resource');
        const a = await authorize({});
        expect(a.status).toBe(200);
        const t = await token({ grant_type: 'authorization_code', code: a.body.code });
        expect(t.status).toBe(200);
        expect(claimsOf(t.body.access_token).aud).toBe(MCP_RESOURCE);
        expect(legacyCount('no_pkce')).toBe(noPkce + 1);
        expect(legacyCount('no_resource')).toBe(noResource + 1);
    });

    it('accepts an MCP OAuth token without an audience and counts it', async () => {
        const before = legacyCount('no_audience');
        expect(await initialize(await mcpToken())).toBe(200);
        expect(legacyCount('no_audience')).toBe(before + 1);
    });

    it('still refuses a token whose audience names another resource', async () => {
        expect(await initialize(await mcpToken('https://other.example/v1/mcp'))).toBe(401);
    });

    it('does not count an agent token that was never an MCP OAuth token', async () => {
        const before = legacyCount('no_audience');
        const agentJwt = await issueJWT({ sub: GAII, owner: OWNER, node: NODE_ID, roles: ['agent'], scopes: ['memory:read'] }, 600);
        expect(await initialize(agentJwt)).toBe(200);
        expect(legacyCount('no_audience')).toBe(before);
    });

    it('advertises S256 and resource indicators in the authorization server metadata', async () => {
        const r = await call('GET', '/.well-known/oauth-authorization-server');
        expect(r.body.code_challenge_methods_supported).toEqual(['S256']);
        expect(r.body.resource_indicators_supported).toBe(true);
        const prm = await call('GET', '/.well-known/oauth-protected-resource/v1/mcp');
        expect(prm.body.resource).toBe(MCP_RESOURCE);
    });
});

describe('namesMcpResource', () => {
    const cfg = { baseUrl: `${BASE_URL}/` } as AimeatConfig;

    it('names the MCP endpoint, its aliases and the origin, with any run of trailing slashes and outer whitespace', () => {
        for (const value of [
            BASE_URL, `${BASE_URL}/`, `${BASE_URL}////`,
            MCP_RESOURCE, `${MCP_RESOURCE}/`, `${MCP_RESOURCE}${'/'.repeat(50)}`, `  ${MCP_RESOURCE}//  `,
            `${BASE_URL}/mcp`, `${BASE_URL}/mcp/`,
            `${BASE_URL}/v2/mcp/agent`, `${BASE_URL}/v2/mcp/owner///`,
        ]) expect(namesMcpResource(cfg, value), value).toBe(true);
    });

    it('does not name another resource, a role that is not lowercase letters, or a slash run with text after it', () => {
        for (const value of [
            '', '/', 'https://other.example/v1/mcp', `${BASE_URL}/v1/mcpx`, `${BASE_URL}/v2/mcp`, `${BASE_URL}/v2/mcp/`,
            `${BASE_URL}/v2/mcp/Agent`, `${BASE_URL}/v2/mcp/agent/x`, `${MCP_RESOURCE}/ /`, `${MCP_RESOURCE}//x`,
        ]) expect(namesMcpResource(cfg, value), value).toBe(false);
    });

    it('answers in linear time on a client-supplied resource that ends in a long slash run with one character after it', () => {
        // The input that makes `replace(/\/+$/, '')` retry from every slash before it fails: about
        // three seconds at 100k slashes, and the value arrives from the client as `resource`.
        const hostile = `${MCP_RESOURCE}${'/'.repeat(100_000)}x`;
        const started = Date.now();
        expect(namesMcpResource(cfg, hostile)).toBe(false);
        expect(Date.now() - started).toBeLessThan(250);
    });
});
