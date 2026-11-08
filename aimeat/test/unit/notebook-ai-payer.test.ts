/**
 * @file test/unit/notebook-ai-payer.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who pays for the notebook AI routes (POST /v1/librarian/classify, /plan, /distribute)
 *   when an agent or an outside app calls them on ai:use (secaudit2026nov08 round 14,
 *   aimeat/notebook-ai/payer-is-caller-identity-not-owner). The owner pays, with the agent or the app
 *   named, as POST /v1/ai/complete does (services/caller-facts.ts payerOfPrincipal): the planner gets
 *   the owner GHII and caller `agent` with the agent's name, or caller `app` with `eco:<app>`, and no
 *   starter allowance is opened under the agent's or the app's own identity. The use kept: the owner
 *   in person is the payer and the caller, as before.
 *   The planner runs for real (prepareAiCall); the completion itself is a spy, so no provider is called.
 * @usage pnpm exec vitest run test/unit/notebook-ai-payer.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08 round 14).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const completeSpy = vi.fn();
vi.mock('../../src/services/ai/completion.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/services/ai/completion.js')>();
  return {
    ...real,
    completeForOwner: (...args: unknown[]) => {
      completeSpy(...args);
      return Promise.resolve({ text: '{"suggestions":[],"steps":[],"chunks":[]}', model: 'openrouter/free', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }, provenance: null, cost: 0 });
    },
  };
});

import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, GHIIRecord } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { initNodeKeys, initRevocationStorage, issueJWT } from '../../src/auth/jwt.js';
import { initSessionAuth } from '../../src/auth/middleware.js';
import { initStats } from '../../src/services/stats.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { loadCatalog } from '../../src/services/ai/catalog/store.js';
import { librarianRouter } from '../../src/routes/librarian.js';

const NODE_ID = 'aimeat-notebook-payer-test';
const OWNER = 'nora';
const OWNER_GHII = `${OWNER}@${NODE_ID}`;
const AGENT = `scout#${OWNER_GHII}`;
const GEAI = `eco:helpdesk#${OWNER_GHII}`;

let storage: Storage;
let config: AimeatConfig;
let server: http.Server;
let base = '';
const tokens: Record<'owner' | 'agent' | 'eco', string> = { owner: '', agent: '', eco: '' };

async function session(id: string, gaii: string): Promise<void> {
  const now = new Date();
  await storage.createSession({ sessionId: id, gaii, owner: OWNER, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3_600_000).toISOString() });
}

beforeAll(async () => {
  setThisNodeId(null);
  storage = new SqliteStorage(':memory:') as unknown as Storage;
  config = {
    ...loadConfig().config, nodeId: NODE_ID, baseUrl: 'https://node.test',
    openrouterInstanceKey: 'sk-node-never-sent', chatFreeAllowanceUsd: 1, aiNodeKeyWhenSpent: 'refuse',
    modelFreeFallback: 'openrouter/free', aiRegionMode: '',
  } as AimeatConfig;
  const nodeKeys = await generateKeyPair();
  await initNodeKeys(nodeKeys.publicKey, nodeKeys.privateKey);
  initSessionAuth(storage, config);
  initRevocationStorage(storage, NODE_ID);
  await initStats();
  await loadCatalog(storage, config);

  const now = new Date().toISOString();
  const keys = await generateKeyPair();
  await storage.createOwner({ name: OWNER, displayName: OWNER, publicKey: keys.publicKey, roles: ['owner'], createdAt: now } as never);
  await storage.createGHII({ username: OWNER, nodeId: NODE_ID, ghii: OWNER_GHII, displayName: OWNER, verificationLevel: 0, ownerName: OWNER, createdAt: now, updatedAt: now, totpEnabled: false } as GHIIRecord);
  await storage.createAgent({
    name: 'scout', owner: OWNER, gaii: AGENT, publicKey: keys.publicKey, trustScore: 50, morselBalance: 0, capabilities: [],
    defaultScopes: ['ai:use', 'memory:read'], createdAt: now, lastSeen: now,
  } as never);
  await storage.createEcosystemApp({
    app: 'helpdesk', owner: OWNER, geai: GEAI, publicKey: 'pk', scopes: ['ai:use'], status: 'active', morselBalance: 0, createdAt: now, lastSeen: now,
  } as never);

  await session('s-owner', OWNER);
  tokens.owner = await issueJWT({ sub: OWNER, owner: OWNER, node: NODE_ID, roles: ['owner'] }, 3600, 's-owner');
  await session('s-agent', AGENT);
  tokens.agent = await issueJWT({ sub: AGENT, owner: OWNER, node: NODE_ID, roles: ['agent'], scopes: ['ai:use', 'memory:read'] }, 3600, 's-agent');
  await session('s-eco', GEAI);
  tokens.eco = await issueJWT({ sub: GEAI, owner: OWNER, node: NODE_ID, roles: ['ecosystem'], scopes: ['ai:use'], eco_app: 'helpdesk' }, 3600, 's-eco');

  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware());
  app.use(librarianRouter(config, storage));
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  server?.closeAllConnections();
  await new Promise((r) => server.close(() => r(null)));
  setThisNodeId(null);
});

beforeEach(() => { completeSpy.mockClear(); });

async function post(path: string, who: keyof typeof tokens): Promise<number> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${tokens[who]}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Meeting with Bob on Friday about the budget.' }),
  });
  await res.text();
  return res.status;
}

/** The identity the completion was paid by, and who it names as asking. */
function paidBy(): { gaii: string; caller?: string; agent?: string; verifiedApp?: string } {
  expect(completeSpy).toHaveBeenCalledTimes(1);
  const [, , gaii, opts] = completeSpy.mock.calls[0] as [unknown, unknown, string, { caller?: string; agent?: string; verifiedApp?: string }];
  return { gaii, caller: opts.caller, agent: opts.agent, verifiedApp: opts.verifiedApp };
}

const allowanceOf = async (gaii: string) => (await storage.getMemory(gaii, `ai-usage.allowance.${gaii}`))?.value ?? null;

describe('an agent on ai:use', () => {
  for (const path of ['/v1/librarian/classify', '/v1/librarian/plan', '/v1/librarian/distribute']) {
    it(`${path} is paid by the owner, with the agent named`, async () => {
      await post(path, 'agent');
      expect(paidBy()).toMatchObject({ gaii: OWNER_GHII, caller: 'agent', agent: 'scout' });
    });
  }

  it('opens no allowance of its own on the node key', async () => {
    await post('/v1/librarian/classify', 'agent');
    expect(await allowanceOf(AGENT)).toBeNull();
  });
});

describe('an outside app on ai:use', () => {
  it('is paid by the owner, with the app named as the asking app', async () => {
    await post('/v1/librarian/classify', 'eco');
    expect(paidBy()).toMatchObject({ gaii: OWNER_GHII, caller: 'app', verifiedApp: 'eco:helpdesk' });
    expect(await allowanceOf(GEAI)).toBeNull();
  });
});

describe('usage: the owner in person', () => {
  it('pays and asks as the owner, as before', async () => {
    await post('/v1/librarian/plan', 'owner');
    expect(paidBy()).toMatchObject({ gaii: OWNER_GHII, caller: 'owner' });
    expect(paidBy().agent).toBeUndefined();
  });
});
