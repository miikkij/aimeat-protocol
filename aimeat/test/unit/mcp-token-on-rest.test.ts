/**
 * @file test/unit/mcp-token-on-rest.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A token issued for this node's MCP endpoint (`aud = <base>/v1/mcp`, RFC 8707) on the REST
 *   routes: refused from 4.0.0 with 401 `invalid_token`, accepted before 4.0.0 with the Deprecation
 *   headers and counted (`deprecated_use_by_type.mcp_token_on_rest`). The MCP endpoint takes it in
 *   both. The three MCP tools that reach REST routes over loopback with the session's bearer
 *   (aimeat_invoke, aimeat_capabilities_invoke, aimeat_app_tool_invoke) keep working at 4.0.0 for a
 *   session signed in with such a token, and still refuse a session that lacks the scope the route
 *   asks for: the loopback request carries the node's own pass (src/auth/loopback-pass.ts) and the
 *   caller's own token.
 *
 *   Drives the real global auth middleware, the real MCP endpoint (mcpRouter), the memory routes and
 *   the extension routes against in-memory SQLite, listening on the port the loopback calls go to,
 *   with the running version switched per test: a 4.0.0 run and a 3.26.1 run of the same code.
 * @usage cd aimeat && pnpm exec vitest run test/unit/mcp-token-on-rest.test.ts
 * @version-history
 *   v1.0.1 — 2026-10-13 — aimeat_app_tool_invoke is not offered to a caller without ext:invoke, which the
 *     tool now declares (wish-aimeat-app-tool-invoke-ilmoittaa-vain-exchange-write-vaikka-); the route's
 *     refusal is still asserted through aimeat_capabilities_invoke.
 *   v1.0.0 — 2026-10-12 — Initial (wish-mcp-tokeni-ei-kelpaa-rest-reiteill-4-0-0-sta-ensin-kolme-mcp).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';

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
import { initSessionAuth, optionalAuth } from '../../src/auth/middleware.js';
import { getStats, initStats } from '../../src/services/stats.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { mcpRouter } from '../../src/mcp/index.js';
import { memoryRouter } from '../../src/routes/memory.js';
import { extensionsRouter } from '../../src/routes/extensions.js';
import { runCapabilityAggregation } from '../../src/services/capability-aggregator.js';
import { LOOPBACK_PASS_HEADER, mintLoopbackPass, revokeLoopbackPass } from '../../src/auth/loopback-pass.js';

const NODE_ID = 'aimeat-mcp-token-rest-test';
const BASE_URL = 'https://node.test';
const MCP_RESOURCE = `${BASE_URL}/v1/mcp`;
const SELLER = 'restseller';
const BUYER = 'restbuyer';
const EXT = `tokenecho${randomBytes(3).toString('hex')}`;
const APP_FILE = 'token-echo.html';
const CAPABILITY = `ext:${EXT}:echo`;

/** Every word the three tools and their loopback routes ask for. */
const FULL_SCOPES = ['memory:read', 'memory:write', 'work:request', 'exchange:write', 'ext:invoke', 'social:read'];
/** The tools' own words, without the words the loopback routes ask for (memory:write, ext:invoke). */
const LIMITED_SCOPES = ['memory:read', 'work:request', 'exchange:write', 'social:read'];

let storage: Storage;
let config: AimeatConfig;
let server: http.Server;
let base = '';
let sellerToken = '';
let actorGaii = '';
let actorMcp = '';
let limitedMcp = '';
let actorPlain = '';

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: any; headers: Headers }> {
    const res = await fetch(`${base}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* an SSE body stays text */ }
    return { status: res.status, body: parsed, headers: res.headers };
}

const bearer = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

/** One MCP JSON-RPC request. Returns the HTTP status and the message with this id. */
async function rpc(token: string, sessionId: string | null, method: string, params: Record<string, unknown>, id: number): Promise<{ status: number; sessionId: string | null; message: any }> {
    const res = await fetch(`${base}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...bearer(token),
            ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const text = await res.text();
    let message: any = null;
    if (res.headers.get('content-type')?.includes('text/event-stream')) {
        const messages = text.split('\n').filter(l => l.startsWith('data: ')).map(l => JSON.parse(l.slice(6)));
        message = messages.find(m => m.id === id) ?? messages[0] ?? null;
    } else if (text) {
        try { message = JSON.parse(text); } catch { message = text; }
    }
    return { status: res.status, sessionId: res.headers.get('mcp-session-id') ?? sessionId, message };
}

/** Open an MCP session with this bearer and call one tool. */
async function callTool(token: string, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string; data: any }> {
    const init = await rpc(token, null, 'initialize', {
        protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'mcp-token-rest-test', version: '1.0.0' },
    }, 1);
    expect(init.status, JSON.stringify(init.message)).toBe(200);
    const out = await rpc(token, init.sessionId, 'tools/call', { name, arguments: args }, 2);
    await fetch(`${base}/v1/mcp`, { method: 'DELETE', headers: { ...bearer(token), 'mcp-session-id': init.sessionId ?? '' } }).catch(() => undefined);
    const text: string = out.message?.result?.content?.[0]?.text ?? JSON.stringify(out.message?.error ?? out.message);
    let data: any = null;
    try { data = JSON.parse(text); } catch { /* a refusal sentence */ }
    return { isError: out.message?.result?.isError === true || !!out.message?.error, text, data };
}

function restUses(): number {
    const snap = getStats()!.snapshot() as unknown as Record<string, Record<string, number> | undefined>;
    return Number(snap.deprecated_use_by_type?.mcp_token_on_rest ?? 0);
}

async function seedOwner(name: string): Promise<void> {
    const now = new Date().toISOString();
    const keys = await generateKeyPair();
    await storage.createOwner({ name, displayName: name, publicKey: keys.publicKey, roles: ['owner'], createdAt: now } as never);
    await storage.createGHII({
        username: name, nodeId: NODE_ID, ghii: `${name}@${NODE_ID}`, displayName: name,
        ownerName: name, totpEnabled: false, verificationLevel: 0, createdAt: now, updatedAt: now,
    } as never);
}

async function seedAgent(owner: string, name: string, scopes: string[]): Promise<string> {
    const now = new Date().toISOString();
    const keys = await generateKeyPair();
    const gaii = `${name}#${owner}@${NODE_ID}`;
    await storage.createAgent({
        name, owner, gaii, publicKey: keys.publicKey, trustScore: 50,
        morselBalance: 0, capabilities: [], defaultScopes: scopes, createdAt: now, lastSeen: now,
    } as never);
    return gaii;
}

/** An access token as the MCP OAuth token grant writes one: bound to the MCP endpoint. */
function mcpToken(gaii: string, owner: string, scopes: string[]): Promise<string> {
    return issueJWT({ sub: gaii, owner, node: NODE_ID, roles: ['agent'], scopes, mcp_client: 'mcp-token-rest-test', aud: MCP_RESOURCE } as never, 600);
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

    await seedOwner(SELLER);
    await seedOwner(BUYER);
    actorGaii = await seedAgent(BUYER, 'claude', FULL_SCOPES);
    const limitedGaii = await seedAgent(BUYER, 'narrow', LIMITED_SCOPES);
    actorMcp = await mcpToken(actorGaii, BUYER, FULL_SCOPES);
    limitedMcp = await mcpToken(limitedGaii, BUYER, LIMITED_SCOPES);
    // The same agent with a token from device authorization: no audience.
    actorPlain = await issueJWT({ sub: actorGaii, owner: BUYER, node: NODE_ID, roles: ['agent'], scopes: FULL_SCOPES } as never, 600);
    sellerToken = await issueJWT({ sub: SELLER, owner: SELLER, node: NODE_ID, roles: ['owner'] } as never, 3600);

    // The order server.ts mounts them in: request context, then the global auth middleware.
    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware());
    app.use(optionalAuth());
    app.use(mcpRouter(config, storage, new Map()));
    app.use(memoryRouter(config, storage));
    app.use(extensionsRouter(config, storage));
    server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const port = (server.address() as AddressInfo).port;
    base = `http://127.0.0.1:${port}`;
    // The loopback calls go to config.port, so it names this server.
    config.port = port;

    // The seller's extension, its capability, and a public app-tool manifest over it.
    v.version = '4.0.0';
    const manifest = JSON.stringify({
        metadata: { name: EXT, version: '1.0.0', description: 'Token echo fixture', author: 'unit' },
        actions: [{ id: 'echo', method: 'POST', path: '/echo', script: 'echo' }],
        config: { public_access: { default: true } }, limits: { timeout_ms: 5000, max_api_calls: 1 },
    });
    const install = await call('POST', '/v1/extensions', {
        manifest,
        scripts: { echo: 'export default async function(ctx,input){return {input,caller:ctx.caller.gaii,scopes:ctx.caller.scopes};}' },
    }, bearer(sellerToken));
    expect(install.status, JSON.stringify(install.body?.error)).toBe(201);
    const activate = await call('POST', `/v1/extensions/${EXT}/activate`, {}, bearer(sellerToken));
    expect(activate.status, JSON.stringify(activate.body?.error)).toBe(200);
    await runCapabilityAggregation(config, storage);
    expect(await storage.getCapability(CAPABILITY)).toBeTruthy();
    const tool = {
        name: 'echo', action_id: CAPABILITY,
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    };
    const saved = await call('POST', '/v1/memory', {
        key: `apps.${APP_FILE}.tools`, visibility: 'public', value: { version: 1, tools: [tool] },
    }, bearer(sellerToken));
    expect(saved.status, JSON.stringify(saved.body?.error)).toBe(201);
}, 60_000);

afterAll(async () => {
    server?.closeAllConnections();
    await new Promise((r) => server.close(() => r(null)));
    setThisNodeId(null);
});

describe('an MCP-bound token on a REST route, on a 4.0.0 node', () => {
    beforeEach(() => { v.version = '4.0.0'; });

    it('is refused with 401 invalid_token', async () => {
        const r = await call('GET', '/v1/memory?limit=1', undefined, bearer(actorMcp));
        expect(r.status).toBe(401);
        expect(r.body.error.code).toBe('INVALID_TOKEN');
        expect(r.headers.get('www-authenticate') ?? '').toContain('error="invalid_token"');
    });

    it('is taken by the MCP endpoint', async () => {
        const init = await rpc(actorMcp, null, 'initialize', {
            protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'mcp-token-rest-test', version: '1.0.0' },
        }, 1);
        expect(init.status).toBe(200);
        expect(init.message?.result?.serverInfo).toBeTruthy();
    });

    it('is refused with a pass the node never minted, and with a pass minted for another token', async () => {
        const forged = await call('GET', '/v1/memory?limit=1', undefined, { ...bearer(actorMcp), [LOOPBACK_PASS_HEADER]: randomBytes(24).toString('base64url') });
        expect(forged.status).toBe(401);
        const other = mintLoopbackPass(limitedMcp);
        try {
            const r = await call('GET', '/v1/memory?limit=1', undefined, { ...bearer(actorMcp), [LOOPBACK_PASS_HEADER]: other });
            expect(r.status).toBe(401);
        } finally { revokeLoopbackPass(other); }
    });

    it('is accepted with the pass the node minted for this token, and not after the pass ends', async () => {
        const pass = mintLoopbackPass(actorMcp);
        const r = await call('GET', '/v1/memory?limit=1', undefined, { ...bearer(actorMcp), [LOOPBACK_PASS_HEADER]: pass });
        expect(r.status, JSON.stringify(r.body?.error)).toBe(200);
        expect(r.headers.get('deprecation')).toBeNull();
        revokeLoopbackPass(pass);
        const after = await call('GET', '/v1/memory?limit=1', undefined, { ...bearer(actorMcp), [LOOPBACK_PASS_HEADER]: pass });
        expect(after.status).toBe(401);
    });

    it('leaves a token without an audience alone', async () => {
        const r = await call('GET', '/v1/memory?limit=1', undefined, bearer(actorPlain));
        expect(r.status, JSON.stringify(r.body?.error)).toBe(200);
        expect(r.headers.get('deprecation')).toBeNull();
    });
});

describe('an MCP-bound token on a REST route, on a 3.x node', () => {
    beforeEach(() => { v.version = '3.26.1'; });

    it('is accepted, answers with the Deprecation headers, and is counted', async () => {
        const before = restUses();
        const r = await call('GET', '/v1/memory?limit=1', undefined, bearer(actorMcp));
        expect(r.status, JSON.stringify(r.body?.error)).toBe(200);
        expect(r.headers.get('deprecation')).toBe('true');
        expect(r.headers.get('x-aimeat-removed-in')).toBe('4.0.0');
        expect(restUses()).toBe(before + 1);
    });

    it('is taken by the MCP endpoint, and the MCP endpoint does not count it', async () => {
        const before = restUses();
        const init = await rpc(actorMcp, null, 'initialize', {
            protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'mcp-token-rest-test', version: '1.0.0' },
        }, 1);
        expect(init.status).toBe(200);
        expect(restUses()).toBe(before);
    });

    it('the three tools reach their REST routes with the pass, so nothing is counted', async () => {
        const before = restUses();
        const invoked = await callTool(actorMcp, 'aimeat_invoke', { capability: 'aimeat_memory_write', input: { key: 'notes.counted', value: { n: 1 } } });
        expect(invoked.isError, invoked.text).toBe(false);
        const cap = await callTool(actorMcp, 'aimeat_capabilities_invoke', { id: CAPABILITY, input: { query: 'x' } });
        expect(cap.isError, cap.text).toBe(false);
        const tool = await callTool(actorMcp, 'aimeat_app_tool_invoke', { owner: SELLER, app: APP_FILE, tool: 'echo', input: { query: 'x' } });
        expect(tool.isError, tool.text).toBe(false);
        expect(restUses()).toBe(before);
    });
});

describe('the three MCP tools that reach REST routes, with an MCP OAuth token on a 4.0.0 node', () => {
    beforeEach(() => { v.version = '4.0.0'; });

    it('aimeat_invoke runs a capability as the caller', async () => {
        const out = await callTool(actorMcp, 'aimeat_invoke', { capability: 'aimeat_memory_write', input: { key: 'notes.from-invoke', value: { ok: true } } });
        expect(out.isError, out.text).toBe(false);
        const stored = await storage.getMemory(actorGaii, 'notes.from-invoke');
        expect(stored?.value).toEqual({ ok: true });
    });

    it('aimeat_invoke still refuses a caller without the scope the route asks for', async () => {
        const out = await callTool(limitedMcp, 'aimeat_invoke', { capability: 'aimeat_memory_write', input: { key: 'notes.denied', value: { ok: false } } });
        expect(out.isError).toBe(true);
        expect(out.data?.code, out.text).toBe('SCOPE_DENIED');
    });

    it('aimeat_capabilities_invoke runs an extension capability as the caller', async () => {
        const out = await callTool(actorMcp, 'aimeat_capabilities_invoke', { id: CAPABILITY, input: { query: 'cap' } });
        expect(out.isError, out.text).toBe(false);
        expect(out.data?.result?.caller).toBe(actorGaii);
        expect(out.data?.result?.input?.query).toBe('cap');
    });

    it('aimeat_capabilities_invoke still refuses a caller without ext:invoke', async () => {
        const out = await callTool(limitedMcp, 'aimeat_capabilities_invoke', { id: CAPABILITY, input: { query: 'cap' } });
        expect(out.isError).toBe(true);
        expect(out.text).toContain('ext:invoke');
    });

    it('aimeat_app_tool_invoke calls an app tool as the caller', async () => {
        const out = await callTool(actorMcp, 'aimeat_app_tool_invoke', { owner: SELLER, app: APP_FILE, tool: 'echo', input: { query: 'tool' } });
        expect(out.isError, out.text).toBe(false);
        const result = out.data?.result?.result ?? out.data?.result;
        expect(result?.caller).toBe(actorGaii);
        expect(result?.input?.query).toBe('tool');
    });

    // Since 2026-10-13 the tool declares ext:invoke beside exchange:write, so on 4.0.0 a caller without
    // it is not offered the tool at all and the call stops before the loopback route. Until then the
    // route refused it with "Scope ext:invoke required".
    it('aimeat_app_tool_invoke is not offered to a caller without ext:invoke', async () => {
        const out = await callTool(limitedMcp, 'aimeat_app_tool_invoke', { owner: SELLER, app: APP_FILE, tool: 'echo', input: { query: 'tool' } });
        expect(out.isError).toBe(true);
        expect(out.text).toContain('aimeat_app_tool_invoke not found');
        expect(out.data?.result).toBeUndefined();
    });
});
