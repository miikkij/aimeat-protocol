/**
 * @file test/unit/request-identity-reads.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How many times one request asks storage about its own caller, per request kind, on
 *   the real middleware chain (request id, optionalAuth, CORS, the MCP router) over in-memory SQLite.
 *
 *   WHY. The auth chain asked storage the same question about the caller again and again inside one
 *   request: an agent's MCP tool call read the agent record five times and the owner three times
 *   before the tool ran (codebase analysis 2026-11-03, item C2; efficiency.md E4). The request memo
 *   (services/request-memo.ts) answers a repeat read of the agent, the owner and the account from the
 *   first read of the same request, and the MCP endpoint takes the sign-in check optionalAuth already
 *   made. This test holds the numbers: a new read in the auth chain fails it.
 *
 *   THE ANSWERS STAY THE SAME. Every request kind is also asked for its answer (status and body), and
 *   a write in the middle of a request makes the next read go to storage (the memo forgets).
 * @usage cd aimeat && pnpm exec vitest run test/unit/request-identity-reads.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item C2).
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
import { initSessionAuth, optionalAuth, requireAuth } from '../../src/auth/middleware.js';
import { initStats } from '../../src/services/stats.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { corsMiddleware } from '../../src/middleware/cors.js';
import { mcpRouter } from '../../src/mcp/index.js';
import { MCP_PROTOCOL_VERSION } from '../../src/mcp/protocol-version.js';
import { installRequestMemo } from '../../src/services/request-memo.js';

const NODE_ID = 'aimeat-request-reads-test';
const OWNER = 'readsowner';
const GHII = `${OWNER}@${NODE_ID}`;
const AGENT = `claude#${OWNER}@${NODE_ID}`;
const ORIGIN = 'https://some-app.example';

/** The questions about the caller that this test counts. */
const IDENTITY_READS = ['getAgent', 'getOwner', 'getGHIIByOwner', 'isSessionRevoked'] as const;

let raw: SqliteStorage;
let storage: Storage;
let config: AimeatConfig;
let server: http.Server;
let base = '';
let agentToken = '';
let ownerToken = '';
const calls = new Map<string, number>();
/** Set by the probe route: a write in the middle of a request, between two memo reads. */
let probeWrites = false;

function counted(target: SqliteStorage): Storage {
  return new Proxy(target, {
    get(t, prop, receiver) {
      const orig = Reflect.get(t, prop, receiver);
      if (typeof orig !== 'function' || typeof prop !== 'string') return orig;
      return (...args: unknown[]) => {
        calls.set(prop, (calls.get(prop) ?? 0) + 1);
        return (orig as (...a: unknown[]) => unknown).apply(t, args);
      };
    },
  }) as unknown as Storage;
}

function identityReads(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of IDENTITY_READS) out[m] = calls.get(m) ?? 0;
  return out;
}
const sum = (r: Record<string, number>) => Object.values(r).reduce((s, n) => s + n, 0);

beforeAll(async () => {
  setThisNodeId(null);
  raw = new SqliteStorage(':memory:');
  storage = counted(raw);
  installRequestMemo(storage);
  config = { ...loadConfig().config, nodeId: NODE_ID, baseUrl: 'https://node.test', corsAllowedOrigins: ['*'], anonymousMode: false };
  const nodeKeys = await generateKeyPair();
  await initNodeKeys(nodeKeys.publicKey, nodeKeys.privateKey);
  initSessionAuth(storage, config);
  initRevocationStorage(storage, NODE_ID);
  await initStats();

  const now = new Date();
  const ownerKeys = await generateKeyPair();
  await raw.createOwner({ name: OWNER, displayName: OWNER, publicKey: ownerKeys.publicKey, roles: ['owner'], createdAt: new Date(now.getTime() - 60_000).toISOString() } as never);
  await raw.createGHII({
    username: OWNER, nodeId: NODE_ID, ghii: GHII, displayName: OWNER,
    ownerName: OWNER, totpEnabled: false, verificationLevel: 0, createdAt: now.toISOString(), updatedAt: now.toISOString(),
  } as never);
  const agentKeys = await generateKeyPair();
  await raw.createAgent({
    name: 'claude', owner: OWNER, gaii: AGENT, publicKey: agentKeys.publicKey, trustScore: 50,
    morselBalance: 0, capabilities: [], defaultScopes: ['memory:read'], createdAt: new Date(now.getTime() - 60_000).toISOString(), lastSeen: now.toISOString(),
  } as never);
  await raw.createSession({ sessionId: 'reads-agent-session', gaii: AGENT, owner: OWNER, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3_600_000).toISOString() });
  await raw.createSession({ sessionId: 'reads-owner-session', gaii: OWNER, owner: OWNER, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3_600_000).toISOString() });
  agentToken = await issueJWT({ sub: AGENT, owner: OWNER, node: NODE_ID, roles: ['agent'], scopes: ['memory:read'] }, 3600, 'reads-agent-session');
  ownerToken = await issueJWT({ sub: OWNER, owner: OWNER, node: NODE_ID, roles: ['owner'] }, 3600, 'reads-owner-session');

  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware());
  app.use(optionalAuth());
  app.use(corsMiddleware(config, () => storage));
  // A REST route behind requireAuth, as most routes are; it answers who the caller is.
  app.get('/probe', requireAuth(), async (req, res) => {
    if (probeWrites) {
      // A write of the caller's own agent record in the middle of the request: the next read sees it.
      await storage.updateAgent(AGENT, { description: 'changed in the request' } as never);
      const { memoGetAgent } = await import('../../src/services/request-memo.js');
      const agent = await memoGetAgent(storage, AGENT);
      res.json({ sub: req.auth!.sub, scopes: req.auth!.scopes, description: (agent as { description?: string } | null)?.description ?? null });
      return;
    }
    res.json({ sub: req.auth!.sub, scopes: req.auth!.scopes });
  });
  app.use(mcpRouter(config, storage, new Map()));
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  server?.closeAllConnections();
  await new Promise((r) => server.close(() => r(null)));
  setThisNodeId(null);
});

/** One modern (2026-07-28) MCP request, answered as JSON or as one SSE event. */
async function modernMcp(method: string, params: Record<string, unknown>, name?: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${base}/v1/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${agentToken}`,
      'MCP-Protocol-Version': MCP_PROTOCOL_VERSION, 'Mcp-Method': method, ...(name ? { 'Mcp-Name': name } : {}),
      'User-Agent': 'request-reads-test',
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method,
      params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION, 'io.modelcontextprotocol/clientCapabilities': {} } },
    }),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text); } catch {
    const line = text.split('\n').find(l => l.startsWith('data: '));
    if (line) json = JSON.parse(line.slice(6));
  }
  return { status: res.status, json };
}

/** Let the work a request left running (contact records, lastSeen) finish before counting starts. */
const settle = () => new Promise(r => setTimeout(r, 150));

describe('identity reads per request (codebase analysis 2026-11-03, C2)', () => {
  it('an agent\'s MCP tool call asks storage about its caller at most 4 times, with the same answer', async () => {
    // Warm-up: the first request per agent writes the contact records; the count is for the next one.
    await modernMcp('tools/call', { name: 'aimeat_memory_list', arguments: {} }, 'aimeat_memory_list');
    await settle();
    calls.clear();
    const r = await modernMcp('tools/call', { name: 'aimeat_memory_list', arguments: {} }, 'aimeat_memory_list');
    const reads = identityReads();
    expect(r.status).toBe(200);
    expect(r.json.error).toBeUndefined();
    expect((r.json.result as { isError?: boolean } | undefined)?.isError ?? false).toBe(false);
    // Before the memo: getAgent 5, getOwner 3, getGHIIByOwner 1, isSessionRevoked 2 (11 of 13 storage
    // calls). Measured after: 1 each (4 of 6).
    const all = JSON.stringify(Object.fromEntries(calls));    expect(reads.getAgent, all).toBeLessThanOrEqual(1);
    expect(reads.getOwner, all).toBeLessThanOrEqual(1);
    expect(sum(reads), all).toBeLessThanOrEqual(4);
  });

  it('an agent\'s REST request from an app origin asks storage about its caller at most 4 times, with the same answer', async () => {
    await settle();
    calls.clear();
    const res = await fetch(`${base}/probe`, { headers: { Authorization: `Bearer ${agentToken}`, Origin: ORIGIN } });
    const reads = identityReads();
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(await res.json()).toEqual({ sub: AGENT, scopes: ['memory:read'] });
    // Before the memo: getAgent 3, getOwner 1, getGHIIByOwner 1, isSessionRevoked 1 (6). After: 4.
    expect(reads.getAgent, JSON.stringify(reads)).toBeLessThanOrEqual(1);
    expect(sum(reads), JSON.stringify(reads)).toBeLessThanOrEqual(4);
  });

  it('an owner\'s REST request asks storage about its caller at most 2 times, with the same answer', async () => {
    await settle();
    calls.clear();
    const res = await fetch(`${base}/probe`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    const reads = identityReads();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sub: OWNER, scopes: [] });
    expect(sum(reads), JSON.stringify(reads)).toBeLessThanOrEqual(2);
  });

  it('a write in the request makes the next read go to storage', async () => {
    probeWrites = true;
    try {
      const res = await fetch(`${base}/probe`, { headers: { Authorization: `Bearer ${agentToken}` } });
      expect(res.status).toBe(200);
      expect((await res.json() as { description: string | null }).description).toBe('changed in the request');
    } finally {
      probeWrites = false;
    }
  });

  it('FAILURE: a revoked session is refused on the MCP endpoint as before', async () => {
    const now = new Date();
    await raw.createSession({ sessionId: 'reads-dead-session', gaii: AGENT, owner: OWNER, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3_600_000).toISOString() });
    const dead = await issueJWT({ sub: AGENT, owner: OWNER, node: NODE_ID, roles: ['agent'], scopes: ['memory:read'] }, 3600, 'reads-dead-session');
    await raw.revokeSession('reads-dead-session');
    const res = await fetch(`${base}/v1/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${dead}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(res.status).toBe(401);
  });
});
