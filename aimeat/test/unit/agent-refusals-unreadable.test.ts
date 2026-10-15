/**
 * @file test/unit/agent-refusals-unreadable.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Feature-list audit #30, what an agent was refused:
 *   - when the refusal notes cannot be read, GET /v1/agents answers `refusals: null` and
 *     `refusals_unreadable: true` on every agent row instead of an empty list, which read as "nothing
 *     was refused"; a healthy read still answers a list and no marker. Through the real agents router
 *     with a real owner token. aimeat_agents_list builds its rows with the same two helpers
 *     (readOwnerAgentAccessOrMarker, agentAccessFields), asserted here directly;
 *   - a refusal still inside its one-minute write window is written by the shutdown flush
 *     (flushProcessBuffers), which before this change never flushed the refusal notes.
 * @usage cd aimeat && pnpm exec vitest run test/unit/agent-refusals-unreadable.test.ts
 * @version-history
 *   2026-10-15 — Initial (feature-list audit #30).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { initNodeKeys, initRevocationStorage, issueJWT } from '../../src/auth/jwt.js';
import { initSessionAuth } from '../../src/auth/middleware.js';
import { initStats } from '../../src/services/stats.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { agentsRouter } from '../../src/routes/agents.js';
import {
  readOwnerAgentAccessOrMarker, agentAccessFields, AGENT_ACCESS_UNREADABLE,
  initAgentRefusals, noteAgentRefusal, agentRefusalsKey,
} from '../../src/services/agent-refusals.js';
import { flushProcessBuffers } from '../../src/server-bootstrap/process-buffers.js';

const NODE_ID = 'aimeat-refusals-unreadable-test';
const OWNER = 'refowner';
const OWNER_GHII = `${OWNER}@${NODE_ID}`;
const gaii = (name: string): string => `${name}#${OWNER_GHII}`;

let storage: Storage;
let config: AimeatConfig;
let server: http.Server;
let base = '';
let ownerToken = '';
/** When true, the list read of the refusal notes throws, as a failing database would. */
let breakNotes = false;

beforeAll(async () => {
  setThisNodeId(null);
  storage = new SqliteStorage(':memory:') as unknown as Storage;
  const original = storage.listMemory.bind(storage);
  storage.listMemory = (async (owner: string, opts?: { prefix?: string }) => {
    if (breakNotes && opts?.prefix === 'audit.agents.') throw new Error('database unavailable');
    return original(owner, opts as never);
  }) as typeof storage.listMemory;
  config = { ...loadConfig().config, nodeId: NODE_ID, baseUrl: 'https://node.test' };
  const nodeKeys = await generateKeyPair();
  await initNodeKeys(nodeKeys.publicKey, nodeKeys.privateKey);
  initSessionAuth(storage, config);
  initRevocationStorage(storage, NODE_ID);
  await initStats();
  initAgentRefusals(storage);

  const now = new Date().toISOString();
  const ownerKeys = await generateKeyPair();
  await storage.createOwner({ name: OWNER, displayName: OWNER, publicKey: ownerKeys.publicKey, roles: ['owner'], createdAt: now } as never);
  for (const name of ['scout', 'writer']) {
    const keys = await generateKeyPair();
    await storage.createAgent({
      name, owner: OWNER, gaii: gaii(name), publicKey: keys.publicKey, trustScore: 50, morselBalance: 0, capabilities: [],
      defaultScopes: ['memory:read'], createdAt: now, lastSeen: now,
    } as never);
  }
  await storage.createSession({ sessionId: 'sess-owner', gaii: OWNER, owner: OWNER, issuedAt: now, expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
  ownerToken = await issueJWT({ sub: OWNER, owner: OWNER, node: NODE_ID, roles: ['owner'] }, 3600, 'sess-owner');

  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware());
  app.use(agentsRouter(config, storage));
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  server?.closeAllConnections();
  await new Promise((r) => server.close(() => r(null)));
  setThisNodeId(null);
});

async function listAgents(): Promise<Array<Record<string, unknown>>> {
  const res = await fetch(`${base}/v1/agents`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  expect(res.status).toBe(200);
  const body = await res.json() as { data: { agents: Array<Record<string, unknown>> } };
  return body.data.agents;
}

describe('GET /v1/agents when the refusal notes cannot be read', () => {
  it('answers a list and no marker when the read works', async () => {
    breakNotes = false;
    const agents = await listAgents();
    expect(agents.length).toBe(2);
    for (const a of agents) {
      expect(Array.isArray(a.refusals)).toBe(true);
      expect(a).not.toHaveProperty('refusals_unreadable');
    }
  });

  it('answers refusals null and refusals_unreadable true on every row when the read fails', async () => {
    breakNotes = true;
    try {
      const agents = await listAgents();
      expect(agents.length).toBe(2);
      for (const a of agents) {
        expect(a.refusals).toBeNull();
        expect(a.scope_request).toBeNull();
        expect(a.refusals_unreadable).toBe(true);
      }
    } finally {
      breakNotes = false;
    }
  });
});

describe('the helpers aimeat_agents_list builds its rows with', () => {
  it('a failed read is the marker, never an empty map', async () => {
    breakNotes = true;
    try {
      const access = await readOwnerAgentAccessOrMarker(storage, OWNER_GHII, 'test');
      expect(access).toBe(AGENT_ACCESS_UNREADABLE);
      expect(agentAccessFields(['memory:read'], access, 'scout')).toEqual({ refusals: null, scope_request: null, refusals_unreadable: true });
    } finally {
      breakNotes = false;
    }
  });

  it('a working read gives the ordinary fields', async () => {
    const access = await readOwnerAgentAccessOrMarker(storage, OWNER_GHII, 'test');
    expect(access).not.toBe(AGENT_ACCESS_UNREADABLE);
    expect(agentAccessFields(['memory:read'], access, 'scout')).toEqual({ refusals: [], scope_request: null });
  });
});

describe('the shutdown flush writes the refusals still waiting in their window', () => {
  it('flushProcessBuffers writes a refusal counted inside the one-minute window', async () => {
    const auth = { sub: gaii('writer'), roles: ['agent'] };
    // The first refusal is written at once; the second falls inside the window and waits for its timer.
    noteAgentRefusal(auth, ['memory:write'], false, 'PUT /v1/memory/:key');
    noteAgentRefusal(auth, ['memory:write'], false, 'PUT /v1/memory/:key');

    await flushProcessBuffers();

    const rec = await storage.getMemory(OWNER_GHII, agentRefusalsKey('writer'));
    const entries = (rec?.value as { entries: Array<{ count: number }> }).entries;
    expect(entries.length).toBe(1);
    expect(entries[0].count).toBe(2);
  });
});
