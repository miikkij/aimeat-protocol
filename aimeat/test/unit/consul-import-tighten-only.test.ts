/**
 * @file test/unit/consul-import-tighten-only.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description POST /v1/admin/consul/import and the settings an AI may only make stricter
 *   (secaudit2026nov08 round 14, admin-config/consul-import-skips-tighten-only-rule-for-ai-caller).
 *   The operator's agent (operator:admin) imports Consul's values, except a value that would make a
 *   tighten-only setting looser than it runs: that one is left as it is, in the running config and the
 *   database, and the answer names it with the reason. A stricter Consul value and every ordinary one
 *   are imported. The use kept: the operator in person imports every value, as before.
 * @usage pnpm exec vitest run test/unit/consul-import-tighten-only.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08 round 14).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { adminConfigRouter } from '../../src/routes/admin-config.js';
import type { ConsulConfigService } from '../../src/services/consul-config.js';

const NODE_ID = 'aimeat-consul-import-test';
const OP = 'consulop';
const AGENT = `keeper#${OP}@${NODE_ID}`;

let dir = '';
let storage: Storage;
let config: AimeatConfig;
let server: http.Server;
let base = '';
let opToken = '';
let agentToken = '';
let consulValues: Record<string, string> = {};

const consul: ConsulConfigService = {
  loadAll: async () => ({ ...consulValues }),
  startWatching: () => {}, stopWatching: () => {}, set: async () => {}, health: async () => true,
};

async function session(id: string, gaii: string): Promise<void> {
  const now = new Date();
  await storage.createSession({ sessionId: id, gaii, owner: OP, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3_600_000).toISOString() });
}

beforeAll(async () => {
  setThisNodeId(null);
  // A file database: an in-memory one stores no setting rows (supportsConfigPersistence).
  dir = mkdtempSync(join(tmpdir(), 'aimeat-consul-import-'));
  storage = new SqliteStorage(join(dir, 'node.db')) as unknown as Storage;
  config = { ...loadConfig().config, nodeId: NODE_ID, baseUrl: 'https://node.test' };
  const nodeKeys = await generateKeyPair();
  await initNodeKeys(nodeKeys.publicKey, nodeKeys.privateKey);
  initSessionAuth(storage, config);
  initRevocationStorage(storage, NODE_ID);
  await initStats();
  const now = new Date().toISOString();
  const keys = await generateKeyPair();
  await storage.createOwner({ name: OP, displayName: OP, publicKey: keys.publicKey, roles: ['owner', 'operator'], createdAt: now } as never);
  await storage.createAgent({
    name: 'keeper', owner: OP, gaii: AGENT, publicKey: keys.publicKey, trustScore: 50, morselBalance: 0, capabilities: [],
    defaultScopes: ['operator:admin'], createdAt: now, lastSeen: now,
  } as never);
  await session('s-op', OP);
  opToken = await issueJWT({ sub: OP, owner: OP, node: NODE_ID, roles: ['owner', 'operator'] }, 3600, 's-op');
  await session('s-agent', AGENT);
  agentToken = await issueJWT({ sub: AGENT, owner: OP, node: NODE_ID, roles: ['agent'], scopes: ['operator:admin'] }, 3600, 's-agent');

  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware());
  app.use(adminConfigRouter(config, storage, undefined, consul));
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  server?.closeAllConnections();
  await new Promise((r) => server.close(() => r(null)));
  setThisNodeId(null);
  try { (storage as unknown as { close?: () => void }).close?.(); rmSync(dir, { recursive: true, force: true }); } catch { /* the temp folder goes with the OS's cleanup */ }
});

beforeEach(async () => {
  // The operator set these in person; Consul still holds an older, looser lockout and two-step value.
  config.signInLockout = 'on';
  config.twoStepRequired = 'operators';
  await storage.setConfigValue('auth.sign_in_lockout', 'on');
  await storage.setConfigValue('auth.two_step_required', 'operators');
  consulValues = { 'auth.sign_in_lockout': 'off', 'auth.two_step_required': 'everyone', 'auth.access_ttl_seconds': '1800' };
});

const row = async (path: string): Promise<string | undefined> => (await storage.getAllConfigValues())[path];

async function importAs(token: string): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(`${base}/v1/admin/consul/import`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json() as { data: Record<string, unknown> };
  return { status: res.status, data: body.data };
}

describe('the operator\'s agent imports from Consul', () => {
  it('does not put back a looser value of a tighten-only setting, and names it', async () => {
    const r = await importAs(agentToken);
    expect(r.status).toBe(200);
    expect(config.signInLockout).toBe('on');
    expect(await row('auth.sign_in_lockout')).toBe('on');
    const held = r.data.held_back as Array<{ path: string; reason: string }>;
    expect(held.map(h => h.path)).toEqual(['auth.sign_in_lockout']);
    expect(held[0].reason).toContain('an AI does not make it');
    expect(held[0].reason).toContain('admin Config page');
  });

  it('imports a stricter value and every ordinary one', async () => {
    const r = await importAs(agentToken);
    expect(config.twoStepRequired).toBe('everyone');
    expect(await row('auth.two_step_required')).toBe('everyone');
    expect(await row('auth.access_ttl_seconds')).toBe('1800');
    expect(r.data.imported).toBe(2);
  });
});

describe('usage: the operator in person', () => {
  it('imports every value, as before', async () => {
    const r = await importAs(opToken);
    expect(r.status).toBe(200);
    expect(config.signInLockout).toBe('off');
    expect(await row('auth.sign_in_lockout')).toBe('off');
    expect(r.data.imported).toBe(3);
    expect(r.data.held_back).toBeUndefined();
  });
});
