/**
 * @file test/unit/mcp-legacy-session-cap.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The caps on 2025-era MCP sessions (mcp/legacy-sessions.ts; mcp.legacy_sessions_per_principal
 *   and mcp.legacy_sessions_total), codebase analysis 2026-11-03, item C5, on the real MCP router over
 *   in-memory SQLite.
 *
 *   - Under the caps every session keeps working (the defaults are far above what a client opens).
 *   - Past the per-principal cap a new session closes that principal's least recently used one, whose
 *     next request gets the spec's 404 (re-initialize); the others keep working.
 *   - Past the node cap the least recently used session of anyone goes, never the new one.
 *   - 0 is no limit.
 * @usage cd aimeat && pnpm exec vitest run test/unit/mcp-legacy-session-cap.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item C5).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

vi.mock('../../src/utils/logger.js', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  const quiet: unknown = new Proxy({}, { get: () => () => quiet });
  return { ...real, logger: quiet };
});

import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { initNodeKeys, initRevocationStorage, issueJWT } from '../../src/auth/jwt.js';
import { initSessionAuth } from '../../src/auth/middleware.js';
import { initStats } from '../../src/services/stats.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { mcpRouter } from '../../src/mcp/index.js';

const NODE_ID = 'aimeat-session-cap-test';
const OWNER = 'capowner';
const AGENTS = ['alpha', 'beta'].map(n => `${n}#${OWNER}@${NODE_ID}`);
let config: AimeatConfig;
let server: http.Server;
let base = '';
const tokens: string[] = [];

beforeAll(async () => {
  setThisNodeId(null);
  const storage = new SqliteStorage(':memory:') as unknown as Storage;
  config = { ...loadConfig().config, nodeId: NODE_ID, baseUrl: 'https://node.test', mcpLegacySessionsPerPrincipal: 2, mcpLegacySessionsTotal: 3 };
  const keys = await generateKeyPair();
  await initNodeKeys(keys.publicKey, keys.privateKey);
  initSessionAuth(storage, config);
  initRevocationStorage(storage, NODE_ID);
  await initStats();
  const now = new Date();
  await storage.createOwner({ name: OWNER, displayName: OWNER, publicKey: keys.publicKey, roles: ['owner'], createdAt: new Date(now.getTime() - 60_000).toISOString() } as never);
  await storage.createGHII({ username: OWNER, nodeId: NODE_ID, ghii: `${OWNER}@${NODE_ID}`, displayName: OWNER, ownerName: OWNER, totpEnabled: false, verificationLevel: 0, createdAt: now.toISOString(), updatedAt: now.toISOString() } as never);
  for (const [i, gaii] of AGENTS.entries()) {
    await storage.createAgent({ name: gaii.split('#')[0], owner: OWNER, gaii, publicKey: keys.publicKey, trustScore: 50, morselBalance: 0, capabilities: [], defaultScopes: ['memory:read'], createdAt: new Date(now.getTime() - 60_000).toISOString(), lastSeen: now.toISOString() } as never);
    await storage.createSession({ sessionId: `cap-${i}`, gaii, owner: OWNER, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3_600_000).toISOString() });
    tokens.push(await issueJWT({ sub: gaii, owner: OWNER, node: NODE_ID, roles: ['agent'], scopes: ['memory:read'] }, 3600, `cap-${i}`));
  }
  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware());
  app.use(mcpRouter(config, storage, new Map()));
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  server?.closeAllConnections();
  await new Promise((r) => server.close(() => r(null)));
  setThisNodeId(null);
});

const headers = (token: string, session?: string) => ({
  'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`,
  ...(session ? { 'mcp-session-id': session } : {}),
});

/** A 2025-era initialize: answers the new session's id. */
async function open(token: string): Promise<string> {
  const res = await fetch(`${base}/v1/mcp`, {
    method: 'POST', headers: headers(token),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cap-test', version: '1.0.0' } } }),
  });
  await res.text();
  const id = res.headers.get('mcp-session-id');
  if (!id) throw new Error(`initialize answered ${res.status} without a session`);
  return id;
}

/** The status a tools/list on `session` answers: 200 while it lives, 404 once it is gone. */
async function use(token: string, session: string): Promise<number> {
  const res = await fetch(`${base}/v1/mcp`, {
    method: 'POST', headers: { ...headers(token, session), 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  });
  await res.text();
  return res.status;
}

const tick = () => new Promise(r => setTimeout(r, 5));
/** Alpha's two sessions the first case leaves open, least recently used first. */
let alphaPair: [string, string] = ['', ''];

describe('2025-era MCP session caps (codebase analysis 2026-11-03, C5)', () => {
  it('past the per-principal cap the least recently used session of that principal closes; the others work', async () => {
    const a1 = await open(tokens[0]); await tick();
    const a2 = await open(tokens[0]); await tick();
    expect(await use(tokens[0], a1)).toBe(200); await tick();   // a1 is now the more recently used
    const a3 = await open(tokens[0]);
    expect(await use(tokens[0], a2)).toBe(404);
    expect(await use(tokens[0], a1)).toBe(200); await tick();
    expect(await use(tokens[0], a3)).toBe(200); await tick();
    alphaPair = [a1, a3];
  }, 60_000);

  it('past the node cap the least recently used session of anyone closes, never the new one; 0 is no limit', async () => {
    config.mcpLegacySessionsPerPrincipal = 0;
    // Open now: alpha's a1 and a3 from the case above, a1 the less recently used. Total cap 3.
    const [a1, a3] = alphaPair;
    const b1 = await open(tokens[1]); await tick();
    const b2 = await open(tokens[1]);
    expect(await use(tokens[0], a1)).toBe(404);
    expect(await use(tokens[0], a3)).toBe(200);
    expect(await use(tokens[1], b1)).toBe(200);
    expect(await use(tokens[1], b2)).toBe(200);
    config.mcpLegacySessionsTotal = 0;
    const b3 = await open(tokens[1]);
    for (const s of [b1, b2, b3]) expect(await use(tokens[1], s)).toBe(200);
    expect(await use(tokens[0], a3)).toBe(200);
  }, 60_000);
});
