/**
 * @file test/unit/mcp-protocol-version.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The MCP revisions the node's server card states are the revisions its MCP endpoint
 *   serves, on the real routers over in-memory SQLite.
 *
 *   Both cards (the node's, routes/wellknown.ts, and an app origin's, routes/subdomain-origin-docs.ts)
 *   read MCP_PROTOCOL_VERSION and MCP_SERVED_REVISIONS (src/mcp/protocol-version.ts), a literal
 *   because `pnpm check:protocol-versions` reads it out of the source. This test binds that literal
 *   to what server/discover names on the 2026-07-28 code path, and the list to that plus what
 *   `initialize` negotiates on the session path, so an SDK upgrade that moves either fails here on
 *   the day of the upgrade. Until 2026-10-19 the cards said 2025-06-18 while SDK 1.31.0 negotiated
 *   2025-11-25.
 * @usage cd aimeat && pnpm exec vitest run test/unit/mcp-protocol-version.test.ts
 * @version-history
 *   v1.1.0 — 2026-10-20 — Bound to server/discover (2026-07-28) and initialize (2025-era) both, and
 *     the cards' supportedProtocolVersions (MCP SDK v2 migration step 8).
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   v1.0.0 — 2026-10-19 — Initial (wish-mcp-2026-07-28-ja-sdk-v2-siirtym-suunnitelma-palvelinkortin-,
 *     the server-card half).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/server';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { initNodeKeys, initRevocationStorage, issueJWT } from '../../src/auth/jwt.js';
import { initSessionAuth } from '../../src/auth/middleware.js';
import { initStats } from '../../src/services/stats.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { wellknownRouter } from '../../src/routes/wellknown.js';
import { mcpRouter } from '../../src/mcp/index.js';
import { MCP_PROTOCOL_VERSION, MCP_SERVED_REVISIONS } from '../../src/mcp/protocol-version.js';

const NODE_ID = 'aimeat-mcp-protocol-version-test';
const OWNER = 'pvowner';
const GHII = `${OWNER}@${NODE_ID}`;
const AGENT = `claude#${OWNER}@${NODE_ID}`;

let storage: Storage;
let config: AimeatConfig;
let server: http.Server;
let base = '';
let agentToken = '';

/** The revision `initialize` answers for a client asking for `asked`. */
async function negotiated(asked: string): Promise<string> {
    const res = await fetch(`${base}/v1/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            jsonrpc: '2.0', id: 1, method: 'initialize',
            params: { protocolVersion: asked, capabilities: {}, clientInfo: { name: 'protocol-version-test', version: '1.0.0' } },
        }),
    });
    const text = await res.text();
    let json: { result?: { protocolVersion?: string } } = {};
    try { json = JSON.parse(text); } catch {
        const line = text.split('\n').find(l => l.startsWith('data: '));
        if (line) json = JSON.parse(line.slice(6));
    }
    if (!json.result?.protocolVersion) throw new Error(`initialize answered ${res.status}: ${text.slice(0, 300)}`);
    return json.result.protocolVersion;
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

    const now = new Date();
    const ownerKeys = await generateKeyPair();
    await storage.createOwner({ name: OWNER, displayName: OWNER, publicKey: ownerKeys.publicKey, roles: ['owner'], createdAt: now.toISOString() } as never);
    await storage.createGHII({
        username: OWNER, nodeId: NODE_ID, ghii: GHII, displayName: OWNER,
        ownerName: OWNER, totpEnabled: false, verificationLevel: 0, createdAt: now.toISOString(), updatedAt: now.toISOString(),
    } as never);
    const agentKeys = await generateKeyPair();
    await storage.createAgent({
        name: 'claude', owner: OWNER, gaii: AGENT, publicKey: agentKeys.publicKey, trustScore: 50,
        morselBalance: 0, capabilities: [], defaultScopes: ['memory:read'], createdAt: now.toISOString(), lastSeen: now.toISOString(),
    } as never);
    await storage.createSession({ sessionId: 'pv-agent-session', gaii: AGENT, owner: OWNER, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3_600_000).toISOString() });
    agentToken = await issueJWT({ sub: AGENT, owner: OWNER, node: NODE_ID, roles: ['agent'], scopes: ['memory:read'] }, 3600, 'pv-agent-session');

    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware());
    app.use(wellknownRouter(config, storage));
    app.use(mcpRouter(config, storage, new Map()));
    server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
    server?.closeAllConnections();
    await new Promise((r) => server.close(() => r(null)));
    setThisNodeId(null);
});

/** The revisions server/discover names on the 2026-07-28 code path. */
async function discovered(): Promise<string[]> {
    const res = await fetch(`${base}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${agentToken}`,
            'MCP-Protocol-Version': MCP_PROTOCOL_VERSION, 'Mcp-Method': 'server/discover',
        },
        body: JSON.stringify({
            jsonrpc: '2.0', id: 1, method: 'server/discover',
            params: { _meta: { 'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION, 'io.modelcontextprotocol/clientCapabilities': {} } },
        }),
    });
    const json = await res.json() as { result?: { supportedVersions?: string[] } };
    if (!json.result?.supportedVersions) throw new Error(`server/discover answered ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    return json.result.supportedVersions;
}

describe('the MCP revision on the server card', () => {
    it('is the highest revision server/discover names, the one the declaration literal holds', async () => {
        const modern = await discovered();
        expect(modern).toContain(MCP_PROTOCOL_VERSION);
        expect([...modern].sort().at(-1)).toBe(MCP_PROTOCOL_VERSION);
    });

    it('lists every served revision: the 2026-07-28 path and what initialize negotiates on the session path', async () => {
        const highestSession = await negotiated('2099-01-01');
        expect(highestSession).toBe(LATEST_PROTOCOL_VERSION);
        expect(await negotiated('2025-03-26')).toBe('2025-03-26');
        expect(MCP_SERVED_REVISIONS[0]).toBe(MCP_PROTOCOL_VERSION);
        expect(MCP_SERVED_REVISIONS).toEqual(expect.arrayContaining([...(await discovered()), ...SUPPORTED_PROTOCOL_VERSIONS]));
        for (const path of ['/.well-known/mcp.json', '/.well-known/mcp/server-card.json']) {
            const card = await (await fetch(`${base}${path}`)).json() as { protocolVersion?: string; supportedProtocolVersions?: string[] };
            expect(card.protocolVersion, path).toBe(MCP_PROTOCOL_VERSION);
            expect(card.supportedProtocolVersions, path).toEqual([...MCP_SERVED_REVISIONS]);
            expect(card.supportedProtocolVersions, path).toContain(highestSession);
        }
    });
});
