/**
 * @file test/unit/device-return-proof-order.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description POST /v1/agents/device-authorize marks a proven return before the pending request is
 *   written. It wrote the request first and verified the proof after, so for that interval the pending
 *   list and the consent card read the agent's return as a new device taking it over, and an approval
 *   in it recorded a takeover. The nightly sweep caught the interval on PostgreSQL
 *   (e2e-device-return-clients, the Dify return, 2026-10-31). Through the real agents router; the
 *   storage's createDeviceAuth is wrapped to read the mark the moment the row exists.
 * @usage cd aimeat && pnpm exec vitest run test/unit/device-return-proof-order.test.ts
 * @version-history
 *   2026-10-31 — Initial (nightly sweep, e2e-device-return-clients).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, DeviceAuthorizationRecord } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair, sign } from '../../src/auth/keypair.js';
import { initNodeKeys, initRevocationStorage } from '../../src/auth/jwt.js';
import { initSessionAuth } from '../../src/auth/middleware.js';
import { initStats } from '../../src/services/stats.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { agentsRouter } from '../../src/routes/agents.js';
import { returnProofMessageV2, returnProven } from '../../src/services/device-return-proof.js';

const NODE_ID = 'aimeat-return-order-test';
const OWNER = 'retowner';
const OWNER_GHII = `${OWNER}@${NODE_ID}`;
const AGENT = 'scout';
const GAII = `${AGENT}#${OWNER_GHII}`;

let storage: Storage;
let config: AimeatConfig;
let server: http.Server;
let base = '';
let agentPrivateKey = '';
/** What the pending list would have answered for each request at the moment its row was written. */
const provenAtWrite = new Map<string, boolean>();

beforeAll(async () => {
  setThisNodeId(null);
  storage = new SqliteStorage(':memory:') as unknown as Storage;
  const create = storage.createDeviceAuth.bind(storage);
  storage.createDeviceAuth = (async (rec: DeviceAuthorizationRecord) => {
    const done = await create(rec);
    provenAtWrite.set(rec.userCode, await returnProven(storage, OWNER_GHII, rec.userCode, GAII));
    return done;
  }) as typeof storage.createDeviceAuth;
  config = { ...loadConfig().config, nodeId: NODE_ID, baseUrl: 'https://node.test' };
  const nodeKeys = await generateKeyPair();
  await initNodeKeys(nodeKeys.publicKey, nodeKeys.privateKey);
  initSessionAuth(storage, config);
  initRevocationStorage(storage, NODE_ID);
  await initStats();

  const now = new Date().toISOString();
  const ownerKeys = await generateKeyPair();
  await storage.createOwner({ name: OWNER, displayName: OWNER, publicKey: ownerKeys.publicKey, roles: ['owner'], createdAt: now } as never);
  const keys = await generateKeyPair();
  agentPrivateKey = keys.privateKey;
  await storage.createAgent({
    name: AGENT, owner: OWNER, gaii: GAII, publicKey: keys.publicKey, trustScore: 50, morselBalance: 0, capabilities: [],
    defaultScopes: ['memory:read'], createdAt: now, lastSeen: now,
  } as never);

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

async function deviceAuthorize(proof?: { signed_at: string; signature: string }) {
  const res = await fetch(`${base}/v1/agents/device-authorize`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner: OWNER, agent_name: AGENT, ...(proof ? { proof } : {}) }),
  });
  expect(res.status).toBe(200);
  return (await res.json() as { data: { user_code: string; return_proof?: string } }).data;
}

describe('a device-authorize request that proves the agent is coming back', () => {
  it('is a proven return from the moment its pending row exists', async () => {
    const signedAt = new Date().toISOString();
    const signature = await sign(agentPrivateKey, returnProofMessageV2(NODE_ID, OWNER, AGENT, signedAt));
    const data = await deviceAuthorize({ signed_at: signedAt, signature });
    expect(data.return_proof).toBe('verified');
    expect(provenAtWrite.get(data.user_code)).toBe(true);
  });

  it('use kept: a request with no proof is still written, and is not a proven return', async () => {
    const data = await deviceAuthorize();
    expect(provenAtWrite.get(data.user_code)).toBe(false);
    expect(await returnProven(storage, OWNER_GHII, data.user_code, GAII)).toBe(false);
  });
});
