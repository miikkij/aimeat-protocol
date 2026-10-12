/**
 * @file test/unit/workspace-delete-bin.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Deleting workspace records puts them in the deleted-memory bin on both interfaces, and
 *   the MCP tool asks memory:delete (ruling decision-4-0-0-siivouksen-23-avointa-p-t-st-suositusten-mukaan,
 *   item 9).
 *
 *   Before the ruling the two disagreed: aimeat_workspace_object_delete put the keys in the bin and
 *   asked memory:purge, and its REST twin POST /v1/organisms/{id}/workspace/records/delete asked
 *   memory:purge and removed the rows for good (storage.bulkDeleteMemory), so nothing came back.
 *
 *   - an agent holding memory:delete and not memory:purge deletes records over REST, and the keys are
 *     in its bin;
 *   - the same agent puts a key back over MCP with aimeat_memory_restore, and the record reads again;
 *   - aimeat_workspace_object_delete names memory:delete, and is offered to that agent;
 *   - the true purges stay on memory:purge: removing a whole workspace (DELETE /v1/organisms/{id}/workspace).
 *
 *   Drives the real organisms router and the real MCP endpoint against in-memory SQLite.
 * @usage cd aimeat && pnpm exec vitest run test/unit/workspace-delete-bin.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-12 — Initial.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, OrganismRecord, OrganismMembershipRecord } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { initNodeKeys, initRevocationStorage, issueJWT } from '../../src/auth/jwt.js';
import { initSessionAuth } from '../../src/auth/middleware.js';
import { initStats } from '../../src/services/stats.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { organismsRouter } from '../../src/routes/organisms.js';
import { mcpRouter } from '../../src/mcp/index.js';
import { requiredScopesForTool } from '../../src/tool-catalog/scopes.js';

const NODE_ID = 'aimeat-ws-bin-test';
const OWNER = 'binowner';
const OWNER_GHII = `${OWNER}@${NODE_ID}`;
// A UUID, as on a real node: the write guard's key pattern reads only that shape.
const ORG = 'c58d1f3b-2222-4333-8444-a55566667777';
const WS = 'ws-bin';
const ROOT = `organism.${ORG}.w.${WS}`;
const NS = 'shared.notes';
const DELETER = `deleter#${OWNER}@${NODE_ID}`;

let storage: Storage;
let config: AimeatConfig;
let server: http.Server;
let base = '';
let deleterToken = '';

const now = (): string => new Date().toISOString();

async function put(ownerGaii: string, key: string, value: unknown): Promise<void> {
    const prev = await storage.getMemory(ownerGaii, key);
    await storage.setMemory({
        key, ownerGaii, value, visibility: 'private', tags: [], ttlHours: null,
        version: (prev?.version ?? 0) + 1, createdAt: prev?.createdAt ?? now(), updatedAt: now(),
    });
}

async function agentToken(name: string, scopes: string[]): Promise<string> {
    const gaii = `${name}#${OWNER}@${NODE_ID}`;
    const keys = await generateKeyPair();
    await storage.createAgent({
        name, owner: OWNER, gaii, publicKey: keys.publicKey, trustScore: 50, morselBalance: 0, capabilities: [],
        defaultScopes: scopes, createdAt: now(), lastSeen: now(),
    } as never);
    const sessionId = `sess-${name}`;
    await storage.createSession({ sessionId, gaii, owner: OWNER, issuedAt: now(), expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    return issueJWT({ sub: gaii, owner: OWNER, node: NODE_ID, roles: ['agent'], scopes }, 3600, sessionId);
}

async function rest(method: string, path: string, token: string, body?: unknown): Promise<{ status: number; body: any }> {
    const res = await fetch(`${base}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: parsed };
}

/** One JSON-RPC message to /v1/mcp; the answer may come as JSON or as one SSE event. */
async function mcpPost(token: string, message: Record<string, unknown>, sessionId?: string): Promise<{ sessionId: string | null; result: any }> {
    const res = await fetch(`${base}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`,
            ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
        },
        body: JSON.stringify(message),
    });
    const text = await res.text();
    const dataLine = text.split('\n').find(l => l.startsWith('data: '));
    let parsed: any = null;
    try { parsed = JSON.parse(dataLine ? dataLine.slice(6) : text); } catch { parsed = text; }
    return { sessionId: res.headers.get('mcp-session-id'), result: parsed };
}

/** An MCP session for this bearer: initialize, then the initialized notification. */
async function mcpSession(token: string): Promise<string> {
    const init = await mcpPost(token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'ws-bin-test', version: '1.0.0' } } });
    expect(init.sessionId, JSON.stringify(init.result)).toBeTruthy();
    await mcpPost(token, { jsonrpc: '2.0', method: 'notifications/initialized' }, init.sessionId!);
    return init.sessionId!;
}

let rpcId = 10;
async function callTool(token: string, sessionId: string, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
    const r = await mcpPost(token, { jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }, sessionId);
    const content = r.result?.result?.content ?? [];
    return { isError: r.result?.result?.isError === true || !!r.result?.error, text: content.map((c: { text?: string }) => c.text ?? '').join('\n') || JSON.stringify(r.result?.error ?? r.result) };
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

    const ownerKeys = await generateKeyPair();
    await storage.createOwner({ name: OWNER, displayName: OWNER, publicKey: ownerKeys.publicKey, roles: ['owner'], createdAt: now() } as never);
    await storage.createGHII({
        username: OWNER, nodeId: NODE_ID, ghii: OWNER_GHII, displayName: OWNER, ownerName: OWNER,
        verificationLevel: 0, totpEnabled: false, createdAt: now(), updatedAt: now(),
    } as never);
    await storage.createOrganism({
        id: ORG, name: 'Bin', description: 'x', type: 'project', interests: [],
        creatorGhii: OWNER_GHII, admins: [OWNER_GHII], members: [OWNER_GHII], agentGaiis: [],
        boardId: 'board-bin', joinPolicy: 'open', maxMembers: 100, visibility: 'public',
        moderationConfig: { flagsEnabled: true, autoHideThreshold: 5, appealsEnabled: false },
        memoryNamespace: `organism.${ORG}`, createdAt: now(), updatedAt: now(),
    } as OrganismRecord);
    await storage.createMembership({ id: 'mem-owner', organismId: ORG, ghii: OWNER, role: 'creator', status: 'active', joinedAt: now() } as OrganismMembershipRecord);
    await put(OWNER_GHII, `organism.${ORG}.meta.workspaces`, { workspaces: [{ id: WS, name: 'Bin', createdBy: OWNER }] });
    await put(OWNER_GHII, `${ROOT}.meta.manifest`, {
        manifestVersion: '1', id: WS, name: 'Bin', kind: 'workspace', status: 'active',
        objectTypes: [{ name: 'note', namespace: NS, backing: 'memory', mode: 'records' }],
    });

    // The agent that deletes: memory:delete, the undoable delete, and not memory:purge.
    deleterToken = await agentToken('deleter', ['memory:read', 'memory:write', 'memory:delete', 'organism:read', 'organism:write']);
    for (const id of ['n1', 'n2', 'n3']) {
        await put(DELETER, `${ROOT}.${NS}.${id}`, { id, body: `note ${id}` });
        await put(DELETER, `${ROOT}.${NS}.${id}.latest`, { id, body: `note ${id}` });
    }

    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware());
    app.use(organismsRouter(config, storage));
    app.use(mcpRouter(config, storage, new Map()));
    server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
    server?.closeAllConnections();
    await new Promise((r) => server.close(() => r(null)));
    setThisNodeId(null);
});

describe('workspace records deleted over REST go to the bin, and come back over MCP', () => {
    it('aimeat_workspace_object_delete asks memory:delete, not memory:purge', () => {
        expect(requiredScopesForTool('aimeat_workspace_object_delete')).toEqual(['memory:delete']);
    });

    it('an agent holding memory:delete (not memory:purge) deletes records over REST, and the keys are in its bin', async () => {
        const r = await rest('POST', `/v1/organisms/${ORG}/workspace/records/delete`, deleterToken, { ws: WS, namespace: NS, ids: ['n1', 'n2'] });
        expect(r.status, JSON.stringify(r.body?.error)).toBe(200);
        expect(r.body.data.deleted.map((d: { id: string }) => d.id).sort()).toEqual(['n1', 'n2']);
        expect(await storage.getMemory(DELETER, `${ROOT}.${NS}.n1.latest`)).toBeNull();
        const binned = (await storage.listDeletedMemory(DELETER)).map(m => m.key).sort();
        expect(binned).toEqual([`${ROOT}.${NS}.n1`, `${ROOT}.${NS}.n1.latest`, `${ROOT}.${NS}.n2`, `${ROOT}.${NS}.n2.latest`]);
        // n3 was not named and is untouched.
        expect(await storage.getMemory(DELETER, `${ROOT}.${NS}.n3.latest`)).not.toBeNull();
    });

    it('aimeat_memory_restore over MCP puts a key back, and the record reads again', async () => {
        const session = await mcpSession(deleterToken);
        const restored = await callTool(deleterToken, session, 'aimeat_memory_restore', { key: `${ROOT}.${NS}.n1.latest` });
        expect(restored.isError, restored.text).toBe(false);
        expect(restored.text).toContain('"restored": true');
        expect((await storage.getMemory(DELETER, `${ROOT}.${NS}.n1.latest`))?.value).toEqual({ id: 'n1', body: 'note n1' });
        expect((await storage.listDeletedMemory(DELETER)).map(m => m.key)).not.toContain(`${ROOT}.${NS}.n1.latest`);
    });

    it('the MCP tool is offered to that agent and puts its keys in the bin too', async () => {
        const session = await mcpSession(deleterToken);
        const listed = await mcpPost(deleterToken, { jsonrpc: '2.0', id: ++rpcId, method: 'tools/list', params: {} }, session);
        const names = (listed.result?.result?.tools ?? []).map((t: { name: string }) => t.name);
        expect(names).toContain('aimeat_workspace_object_delete');
        const del = await callTool(deleterToken, session, 'aimeat_workspace_object_delete', { organism_id: ORG, ws: WS, namespace: NS, id: 'n3' });
        expect(del.isError, del.text).toBe(false);
        expect((await storage.listDeletedMemory(DELETER)).map(m => m.key)).toContain(`${ROOT}.${NS}.n3.latest`);
    });

    it('removing a whole workspace for good still asks memory:purge', async () => {
        const r = await rest('DELETE', `/v1/organisms/${ORG}/workspace?ws=${WS}`, deleterToken);
        expect(r.status).toBe(403);
        expect(JSON.stringify(r.body)).toContain('memory:purge');
    });
});
