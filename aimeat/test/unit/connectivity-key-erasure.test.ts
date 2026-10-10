/**
 * @file connectivity-key-erasure.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description secaudit 2026-10-10 C0: a connectivity key does not outlive the account that minted
 *   it, against real in-memory SQLite.
 *
 *   Keys minted before 2026-10-10 were stored under the bare account name, which the erasure cascade
 *   did not delete. A deleted username is released for reuse, so POST /v1/agents/connect created an
 *   agent under whoever registered the name next. Two of the three fixes are pinned here: deleteOwner
 *   deletes the rows under the bare name as well as under the GHII, and the connect route refuses a
 *   key older than the owner record it names (the rows already in databases). The mint storing the
 *   GHII and the whole path over HTTP are in test/e2e-account-doors.ts (49, 49b), on both backends.
 * @usage cd aimeat && pnpm exec vitest run test/unit/connectivity-key-erasure.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-10 — Initial (secaudit 2026-10-10 C0).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express, { Router } from 'express';
import http from 'node:http';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, OtkRecord } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { registerRegistrationRoutes } from '../../src/routes/agents/registration.js';

const NODE_ID = 'aimeat-unit-otk-001';
const HOUR = 60 * 60_000;

let storage: Storage;
let server: http.Server;
let base: string;

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

async function createOwner(name: string, createdAt: string): Promise<void> {
  await storage.createOwner({ name, publicKey: 'placeholder', roles: ['owner'], createdAt } as never);
  await storage.createGHII({
    username: name, nodeId: NODE_ID, ghii: `${name}@${NODE_ID}`, displayName: name,
    verificationLevel: 0, ownerName: name, createdAt, updatedAt: createdAt,
  } as never);
}

async function createKey(key: string, ownerGaii: string, owner: string, createdAt: string): Promise<void> {
  const otk: OtkRecord = {
    key, ownerGaii, action: 'register_agent',
    params: { owner, agent_name: null, description: null },
    expiresAt: iso(365 * 24 * HOUR), initial: true, used: false, usedAt: null, sessionId: null, createdAt,
  };
  await storage.createOtk(otk);
}

async function connect(key: string, agentName: string): Promise<{ status: number; body: { error?: { code?: string }; data?: { private_key?: string } } }> {
  const res = await fetch(`${base}/v1/agents/connect`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectivity_key: key, agent_name: agentName }),
  });
  return { status: res.status, body: await res.json() as never };
}

describe('connectivity keys and owner erasure (secaudit 2026-10-10 C0)', () => {
  beforeAll(async () => {
    const config = { ...loadConfig().config, nodeId: NODE_ID } as AimeatConfig;
    const app = express();
    app.use(express.json());
    const router = Router();
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    // The last argument locates the consent page, which no case here serves.
    registerRegistrationRoutes(router, config, storage, process.cwd());
    app.use(router);
    server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('refuses a key minted before the owner record it names was created', async () => {
    await createOwner('alice', iso(0));
    // A row left by the previous holder of the name, stored under the bare name as before the fix.
    await createKey('otk-old-holder', 'alice', 'alice', iso(-HOUR));
    const r = await connect('otk-old-holder', 'inherited');
    expect(r.status).toBe(404);
    expect(r.body.error?.code).toBe('INVALID_KEY');
    expect(r.body.data?.private_key).toBeUndefined();
    expect(await storage.getAgent(`inherited#alice@${NODE_ID}`)).toBeNull();
  });

  it('accepts a key minted after the owner record was created', async () => {
    await createOwner('dave', iso(-HOUR));
    await createKey('otk-current', `dave@${NODE_ID}`, 'dave', iso(0));
    const r = await connect('otk-current', 'fresh');
    expect(r.status).toBe(201);
    expect(typeof r.body.data?.private_key).toBe('string');
    expect(await storage.getAgent(`fresh#dave@${NODE_ID}`)).not.toBeNull();
  });

  it('deleteOwner deletes the keys stored under the bare account name and under the GHII', async () => {
    await createOwner('bob', iso(-HOUR));
    await createKey('otk-bare', 'bob', 'bob', iso(0));
    await createKey('otk-ghii', `bob@${NODE_ID}`, 'bob', iso(0));
    await createOwner('carol', iso(-HOUR));
    await createKey('otk-other', 'carol', 'carol', iso(0));

    expect(await storage.deleteOwner('bob')).toBe(true);

    expect(await storage.getOtk('otk-bare')).toBeNull();
    expect(await storage.getOtk('otk-ghii')).toBeNull();
    // Another account's key stays.
    expect(await storage.getOtk('otk-other')).not.toBeNull();
  });
});
