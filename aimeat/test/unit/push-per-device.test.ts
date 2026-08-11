/**
 * @file push-per-device.test.ts
 * @description AUDIT H-8, the two halves that are the same table. (1) The push routes carried
 *   requireAuth() and nothing else, so every agent, ecosystem app and app-grant token issued for the
 *   account could reach the owner's notification stream; they now require `push:manage`, which an
 *   owner-role session passes on its role. (2) The table was keyed on ownerName and the write was an
 *   upsert, so a second subscription REPLACED the person's own: their browser went silent and every
 *   notification went to whatever endpoint subscribed last.
 *
 *   Drives the real pushRouter against real SQLite with real signed tokens, so the gate under test
 *   is the one that runs in production rather than a re-statement of it.
 * @structure
 *   - beforeAll(): in-memory SQLite, node keys, the router on a loopback HTTP server
 *   - token(): mint an owner / agent / app-grant credential
 *   - describes: the scope gate · one row per device · cross-owner isolation · unsubscribe
 * @usage cd aimeat && pnpm exec vitest run test/unit/push-per-device.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-11 — Initial (security audit H-8: scope gate + one subscription per device).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import Database from 'better-sqlite3';
import { rmSync, existsSync } from 'node:fs';
import { pushRouter } from '../../src/routes/push.js';
import { createPushService } from '../../src/services/push.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { initNodeKeys, issueJWT } from '../../src/auth/jwt.js';
import { initSessionAuth } from '../../src/auth/middleware.js';

const NODE_ID = 'aimeat-local-001-dev';

/**
 * Loopback endpoints, so validateOutboundUrl (the H-8 half that shipped on 2026-08-10) answers from
 * its allow-private branch instead of asking DNS. This suite is about the gate and the key, and its
 * refusals of a bad destination are covered in e2e-security.ts.
 */
const LAPTOP = 'https://127.0.0.1/push/laptop';
const PHONE = 'https://127.0.0.1/push/phone';
const KEYS = { p256dh: 'test-p256dh', auth: 'test-auth' };

describe('Push subscriptions: who may register one, and whose device it replaces (H-8)', () => {
  let storage: SqliteStorage;
  let server: http.Server;
  let base: string;
  let egressBefore: string | undefined;

  /** A signed credential of the shape the named principal presents. */
  async function token(opts: { sub: string; owner: string; roles: string[]; scopes: string[] }): Promise<string> {
    return issueJWT({ sub: opts.sub, owner: opts.owner, node: NODE_ID, roles: opts.roles, scopes: opts.scopes }, 3600);
  }

  async function call(path: string, jwt: string, init: RequestInit = {}): Promise<{ status: number; body: { data?: Record<string, unknown>; error?: { code: string } } }> {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    return { status: res.status, body: await res.json() as { data?: Record<string, unknown>; error?: { code: string } } };
  }

  const subscribe = (jwt: string, endpoint: string, extra: Record<string, unknown> = {}) =>
    call('/v1/push/subscribe', jwt, { method: 'POST', body: JSON.stringify({ endpoint, keys: KEYS, ...extra }) });

  const endpointsOf = async (owner: string) =>
    (await storage.listPushSubscriptionsByOwner(owner)).map(s => s.endpoint).sort();

  let ownerJwt = '';
  let bobJwt = '';
  let agentJwt = '';
  let scopedAgentJwt = '';
  let appJwt = '';

  beforeAll(async () => {
    egressBefore = process.env.AIMEAT_ALLOW_PRIVATE_EGRESS;
    process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = 'true';

    storage = new SqliteStorage(':memory:');
    const config: AimeatConfig = { ...loadConfig().config, nodeId: NODE_ID };
    const kp = await generateKeyPair();
    await initNodeKeys(kp.publicKey, kp.privateKey);
    initSessionAuth(storage, config);

    const now = new Date().toISOString();
    for (const name of ['alice', 'bob']) {
      await storage.createOwner({ name, displayName: name, publicKey: kp.publicKey, roles: ['owner'], createdAt: now });
    }

    const app = express();
    app.use(express.json());
    app.use(pushRouter(config, storage, createPushService(config, storage)));
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

    ownerJwt = await token({ sub: `alice@${NODE_ID}`, owner: 'alice', roles: ['owner'], scopes: [] });
    bobJwt = await token({ sub: `bob@${NODE_ID}`, owner: 'bob', roles: ['owner'], scopes: [] });
    agentJwt = await token({ sub: `bot#alice@${NODE_ID}`, owner: 'alice', roles: ['agent'], scopes: ['memory:read', 'memory:write', 'notifications:send'] });
    scopedAgentJwt = await token({ sub: `helper#alice@${NODE_ID}`, owner: 'alice', roles: ['agent'], scopes: ['push:manage'] });
    appJwt = await token({ sub: `alice/app.html`, owner: 'alice', roles: ['app'], scopes: ['memory:read', 'notifications:send'] });
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    storage.close();
    if (egressBefore === undefined) delete process.env.AIMEAT_ALLOW_PRIVATE_EGRESS;
    else process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = egressBefore;
  });

  describe('the scope gate', () => {
    it('an agent without push:manage cannot register a device, however else it is scoped', async () => {
      const r = await subscribe(agentJwt, LAPTOP);
      expect(r.status).toBe(403);
      expect(r.body.error?.code).toBe('SCOPE_DENIED');
      expect(await endpointsOf('alice')).toEqual([]);
    });

    it('notifications:send does not open this door: an app grant is refused (H-2 principal)', async () => {
      const r = await subscribe(appJwt, LAPTOP);
      expect(r.status).toBe(403);
      expect(r.body.error?.code).toBe('SCOPE_DENIED');
    });

    it('unsubscribe and test are gated the same way', async () => {
      expect((await call('/v1/push/subscribe', agentJwt, { method: 'DELETE' })).status).toBe(403);
      expect((await call('/v1/push/test', agentJwt, { method: 'POST' })).status).toBe(403);
    });

    it('the owner\'s own browser is unaffected: an owner session passes on its role', async () => {
      const r = await subscribe(ownerJwt, LAPTOP);
      expect(r.status).toBe(201);
      expect(await endpointsOf('alice')).toEqual([LAPTOP]);
    });

    it('an agent the owner granted push:manage may register one too', async () => {
      const r = await subscribe(scopedAgentJwt, PHONE);
      expect(r.status).toBe(201);
      expect(await endpointsOf('alice')).toEqual([LAPTOP, PHONE].sort());
    });
  });

  describe('one row per device', () => {
    it('the second device does not evict the first — both keep receiving', async () => {
      // Both were registered above, by two different principals of the same owner.
      const rows = await storage.listPushSubscriptionsByOwner('alice');
      expect(rows).toHaveLength(2);
      expect(rows.every(r => r.ownerName === 'alice')).toBe(true);
    });

    it('the same device subscribing again refreshes its keys instead of adding a row', async () => {
      const r = await call('/v1/push/subscribe', ownerJwt, {
        method: 'POST',
        body: JSON.stringify({ endpoint: LAPTOP, keys: { p256dh: 'rotated', auth: 'rotated' } }),
      });
      expect(r.status).toBe(201);
      const rows = await storage.listPushSubscriptionsByOwner('alice');
      expect(rows).toHaveLength(2);
      expect(rows.find(x => x.endpoint === LAPTOP)!.keys.p256dh).toBe('rotated');
    });

    it('a body naming another owner writes nothing into that owner\'s stream', async () => {
      const r = await subscribe(bobJwt, 'https://127.0.0.1/push/bob', { ownerName: 'alice', owner: 'alice' });
      expect(r.status).toBe(201);
      expect(await endpointsOf('bob')).toEqual(['https://127.0.0.1/push/bob']);
      // Alice still has exactly her own two devices: the row is keyed on the TOKEN's owner.
      expect(await endpointsOf('alice')).toEqual([LAPTOP, PHONE].sort());
    });
  });

  describe('unsubscribe', () => {
    it('naming an endpoint removes that device only', async () => {
      const r = await call('/v1/push/subscribe', ownerJwt, { method: 'DELETE', body: JSON.stringify({ endpoint: PHONE }) });
      expect(r.status).toBe(200);
      expect(r.body.data?.endpoint).toBe(PHONE);
      expect(await endpointsOf('alice')).toEqual([LAPTOP]);
    });

    it('naming nothing removes every device of the account (what a client with no body means)', async () => {
      const r = await call('/v1/push/subscribe', ownerJwt, { method: 'DELETE' });
      expect(r.status).toBe(200);
      expect(await endpointsOf('alice')).toEqual([]);
      // And it stops at the account boundary.
      expect(await endpointsOf('bob')).toEqual(['https://127.0.0.1/push/bob']);
    });

    it('removing a device that is not there is a 404, not a silent success', async () => {
      const r = await call('/v1/push/subscribe', ownerJwt, { method: 'DELETE', body: JSON.stringify({ endpoint: LAPTOP }) });
      expect(r.status).toBe(404);
    });
  });
});

/**
 * The upgrade path, which is the risky half of a key change: a self-hosted database created before
 * 2026-08-11 has push_subscriptions keyed on ownerName alone, and SQLite cannot re-key a table with
 * ALTER. Boot rebuilds it. If that rebuild is wrong the node does not start, so it is tested against
 * a real file database carrying a real pre-existing row.
 */
describe('an existing SQLite database is re-keyed on boot (H-8)', () => {
  const PATH = `./test/.push-upgrade-${process.pid}.db`;

  afterAll(() => {
    for (const suffix of ['', '-wal', '-shm']) {
      const p = PATH + suffix;
      if (existsSync(p)) { try { rmSync(p); } catch { /* the file is this test's own scratch */ } }
    }
  });

  it('carries the old row over and accepts a second device beside it', async () => {
    const old = new Database(PATH);
    old.exec(`CREATE TABLE push_subscriptions (
      ownerName TEXT PRIMARY KEY, endpoint TEXT NOT NULL, keys TEXT NOT NULL DEFAULT '{}',
      createdAt TEXT NOT NULL, lastUsedAt TEXT NOT NULL)`);
    const now = new Date().toISOString();
    old.prepare('INSERT INTO push_subscriptions VALUES (?, ?, ?, ?, ?)')
      .run('carol', 'https://127.0.0.1/push/old', JSON.stringify(KEYS), now, now);
    old.close();

    // Constructing the storage runs initializeSchema, which is where the rebuild lives.
    const storage = new SqliteStorage(PATH);
    try {
      const carried = await storage.listPushSubscriptionsByOwner('carol');
      expect(carried).toHaveLength(1);
      expect(carried[0].endpoint).toBe('https://127.0.0.1/push/old');
      expect(carried[0].keys.p256dh).toBe(KEYS.p256dh);

      await storage.createPushSubscription({
        ownerName: 'carol', endpoint: 'https://127.0.0.1/push/new', keys: KEYS, createdAt: now, lastUsedAt: now,
      });
      expect((await storage.listPushSubscriptionsByOwner('carol')).map(s => s.endpoint).sort())
        .toEqual(['https://127.0.0.1/push/new', 'https://127.0.0.1/push/old']);

      // Idempotent: a second boot on the already-rebuilt file must not rebuild or lose anything.
      const reopened = new SqliteStorage(PATH);
      try {
        expect(await reopened.listPushSubscriptionsByOwner('carol')).toHaveLength(2);
      } finally {
        reopened.close();
      }
    } finally {
      storage.close();
    }
  });
});
