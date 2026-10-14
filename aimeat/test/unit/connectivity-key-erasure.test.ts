/**
 * @file connectivity-key-erasure.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connectivity-key rows after the routes that used them were removed, against real
 *   in-memory SQLite.
 *
 *   POST /v1/auth/connectivity-key and POST /v1/agents/connect were removed on 2026-10-14
 *   (feature-list audit row 202). The OTK table stays, so rows minted before the removal can still
 *   sit in a database. Two things are pinned here: a stored key creates no agent through the
 *   registration router, and deleteOwner still deletes an account's rows under the bare name as
 *   well as under the GHII (secaudit 2026-10-10 C0), so an erased account leaves none behind.
 * @usage cd aimeat && pnpm exec vitest run test/unit/connectivity-key-erasure.test.ts
 * @version-history
 *   v2.0.0 — 2026-10-14 — The connect route is gone: the two cases that drove it are replaced by one
 *     that asserts a stored, valid key answers 404 and creates no agent. The erasure case stays.
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

describe('connectivity-key rows after the routes were removed', () => {
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

  it('a stored, valid key creates no agent: POST /v1/agents/connect is not served', async () => {
    await createOwner('dave', iso(-HOUR));
    await createKey('otk-current', `dave@${NODE_ID}`, 'dave', iso(0));
    const res = await fetch(`${base}/v1/agents/connect`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectivity_key: 'otk-current', agent_name: 'fresh' }),
    });
    expect(res.status).toBe(404);
    expect(await storage.getAgent(`fresh#dave@${NODE_ID}`)).toBeNull();
    // Nothing consumed the row either: the route that burned it is gone.
    expect((await storage.getOtk('otk-current'))?.used).toBe(false);
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
