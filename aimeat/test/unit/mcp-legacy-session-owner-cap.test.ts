/**
 * @file test/unit/mcp-legacy-session-owner-cap.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The 2025-era MCP session caps between accounts (mcp/legacy-sessions.ts;
 *   secaudit2026nov08 round 14, mcp-legacy-session-node-cap-evicts-other-owners), on the real MCP
 *   router over in-memory SQLite, with small caps on this test's own node.
 *
 *   - Past the node cap, the session closed is the least recently used one of the owner holding the
 *     most sessions: one owner's agents do not close another owner's idle session.
 *   - Past mcp.legacy_sessions_per_owner, a new session closes that owner's least recently used one,
 *     whichever of their agents holds it; other owners keep theirs.
 *   - test/unit/mcp-legacy-session-cap.test.ts keeps the per-principal and single-owner cases.
 * @usage cd aimeat && pnpm exec vitest run test/unit/mcp-legacy-session-owner-cap.test.ts
 * @version-history
 *   2026-11-08 — Initial (secaudit2026nov08 round 14).
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

const NODE_ID = 'aimeat-session-owner-cap-test';
/** Owner one has three agents, owner two has one. */
const AGENTS: Array<[string, string]> = [['alpha', 'ownerone'], ['beta', 'ownerone'], ['gamma', 'ownerone'], ['zeta', 'ownertwo']];
let config: AimeatConfig;
let server: http.Server;
let base = '';
const tokens: Record<string, string> = {};

beforeAll(async () => {
  setThisNodeId(null);
  const storage = new SqliteStorage(':memory:') as unknown as Storage;
  config = {
    ...loadConfig().config, nodeId: NODE_ID, baseUrl: 'https://node.test',
    mcpLegacySessionsPerPrincipal: 2, mcpLegacySessionsPerOwner: 0, mcpLegacySessionsTotal: 4,
  };
  const keys = await generateKeyPair();
  await initNodeKeys(keys.publicKey, keys.privateKey);
  initSessionAuth(storage, config);
  initRevocationStorage(storage, NODE_ID);
  await initStats();
  const now = new Date();
  for (const owner of ['ownerone', 'ownertwo']) {
    await storage.createOwner({ name: owner, displayName: owner, publicKey: keys.publicKey, roles: ['owner'], createdAt: new Date(now.getTime() - 60_000).toISOString() } as never);
    await storage.createGHII({ username: owner, nodeId: NODE_ID, ghii: `${owner}@${NODE_ID}`, displayName: owner, ownerName: owner, totpEnabled: false, verificationLevel: 0, createdAt: now.toISOString(), updatedAt: now.toISOString() } as never);
  }
  for (const [i, [name, owner]] of AGENTS.entries()) {
    const gaii = `${name}#${owner}@${NODE_ID}`;
    await storage.createAgent({ name, owner, gaii, publicKey: keys.publicKey, trustScore: 50, morselBalance: 0, capabilities: [], defaultScopes: ['memory:read'], createdAt: new Date(now.getTime() - 60_000).toISOString(), lastSeen: now.toISOString() } as never);
    await storage.createSession({ sessionId: `ocap-${i}`, gaii, owner, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3_600_000).toISOString() });
    tokens[name] = await issueJWT({ sub: gaii, owner, node: NODE_ID, roles: ['agent'], scopes: ['memory:read'] }, 3600, `ocap-${i}`);
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

async function open(agent: string): Promise<string> {
  const res = await fetch(`${base}/v1/mcp`, {
    method: 'POST', headers: headers(tokens[agent]),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'owner-cap-test', version: '1.0.0' } } }),
  });
  await res.text();
  const id = res.headers.get('mcp-session-id');
  if (!id) throw new Error(`initialize answered ${res.status} without a session`);
  return id;
}

async function use(agent: string, session: string): Promise<number> {
  const res = await fetch(`${base}/v1/mcp`, {
    method: 'POST', headers: { ...headers(tokens[agent], session), 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  });
  await res.text();
  return res.status;
}

const tick = () => new Promise(r => setTimeout(r, 5));

describe('2025-era MCP session caps between accounts (secaudit2026nov08 round 14)', () => {
  it('past the node cap, the owner holding the most sessions loses one; another owner\'s idle session stays', async () => {
    const z1 = await open('zeta'); await tick();          // owner two, the least recently used of all
    const a1 = await open('alpha'); await tick();
    const a2 = await open('alpha'); await tick();
    const b1 = await open('beta'); await tick();          // four open: the node cap
    const b2 = await open('beta');                        // owner one now holds four of five
    expect(await use('zeta', z1)).toBe(200);
    expect(await use('alpha', a1)).toBe(404);             // owner one's least recently used
    for (const [agent, s] of [['alpha', a2], ['beta', b1], ['beta', b2]] as const) expect(await use(agent, s)).toBe(200);
    // Leave the node empty of owner one's sessions for the next case.
    config.mcpLegacySessionsTotal = 0;
    for (const [agent, s] of [['alpha', a2], ['beta', b1], ['beta', b2]] as const) {
      await fetch(`${base}/v1/mcp`, { method: 'DELETE', headers: headers(tokens[agent], s) });
    }
    await fetch(`${base}/v1/mcp`, { method: 'DELETE', headers: headers(tokens.zeta, z1) });
  }, 60_000);

  it('past the per-owner cap a new session closes that owner\'s least recently used one, whichever agent holds it', async () => {
    config.mcpLegacySessionsPerOwner = 3;
    const z1 = await open('zeta'); await tick();
    const a1 = await open('alpha'); await tick();
    const b1 = await open('beta'); await tick();
    const g1 = await open('gamma'); await tick();         // owner one at three
    const g2 = await open('gamma');                       // past it: owner one's oldest (alpha's) closes
    expect(await use('alpha', a1)).toBe(404);
    for (const [agent, s] of [['beta', b1], ['gamma', g1], ['gamma', g2], ['zeta', z1]] as const) expect(await use(agent, s)).toBe(200);
    config.mcpLegacySessionsPerOwner = 0;
    const g3 = await open('gamma'); await tick();
    expect(await use('beta', b1)).toBe(200);              // 0 is no limit
    expect(await use('gamma', g3)).toBe(200);
  }, 60_000);
});
