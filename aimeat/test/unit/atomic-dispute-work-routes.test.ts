/**
 * @file test/unit/atomic-dispute-work-routes.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two or three calls at the same moment on the work and dispute routes that move morsels:
 *   accept-partial, accept-fault, open dispute, reject, deliver and the work expiry job. Each work item
 *   releases its escrow once and each dispute is resolved once, so the morsels move once whatever the
 *   number of concurrent calls (secaudit2026oct22, dispute-resolution-without-cas and
 *   work-status-transition-without-cas).
 *
 *   The routes are the real ones (workRouter, disputesRouter) on an HTTP server in this process, over a
 *   real storage of both providers. A storage wrapper holds the reads of one work item or dispute in
 *   pairs: the first two reads of a key wait for each other, then the next two, and so on (a timer ends
 *   the wait when the second read never comes). So every call in flight reads the status before any of
 *   them writes, on both backends. Without the wrapper SQLite answers at once and a test of an
 *   unconditional write passes by luck (docs/pitfalls.md, better-sqlite3 entry).
 *
 *   Runs on SQLite in memory, and on PostgreSQL too when DATABASE_URL is set (names carry a run tag).
 * @usage cd aimeat && pnpm exec vitest run test/unit/atomic-dispute-work-routes.test.ts
 *   cd aimeat && node --env-file=.env.test.postgres-kysely --import tsx node_modules/vitest/vitest.mjs run test/unit/atomic-dispute-work-routes.test.ts
 * @version-history
 *   2026-10-25 — Initial (secaudit2026oct22, dispute-resolution-without-cas, work-status-transition-without-cas).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { requirePostgresWhenAsked } from './postgres-arm.js';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage, WorkRecord } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { initNodeKeys, initRevocationStorage, issueJWT } from '../../src/auth/jwt.js';
import { initSessionAuth } from '../../src/auth/middleware.js';
import { initStats } from '../../src/services/stats.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { workRouter } from '../../src/routes/work.js';
import { disputesRouter } from '../../src/routes/disputes.js';
import { runWorkTimeoutJob } from '../../src/services/core-jobs.js';

requirePostgresWhenAsked('atomic-dispute-work-routes');

type TestStorage = Storage & { close(): void | Promise<void> };
const names = ['sqlite', ...(process.env.DATABASE_URL ? ['postgres-kysely'] : [])] as const;
const RUN = randomUUID().slice(0, 8);
const NODE_ID = `atomic-dw-${RUN}`;
const READS = new Set(['getWork', 'getDispute', 'getDisputeByTrackingCode']);
const START = 100;

/** A storage whose reads of the held keys answer in pairs: two readers of a key wait for each other. */
function paired(inner: Storage) {
  let held = new Set<string>();
  const waiting = new Map<string, () => void>();
  // A frozen key answers getWork with the copy given: a call whose read came before a write that
  // another call committed in the meantime.
  const frozen = new Map<string, WorkRecord>();
  const proxy = new Proxy(inner, {
    get(target, prop) {
      const v = Reflect.get(target, prop, target) as unknown;
      if (typeof v !== 'function') return v;
      const name = String(prop);
      const fn = (v as (...a: unknown[]) => unknown).bind(target);
      if (!READS.has(name)) return fn;
      return async (key: string, ...rest: unknown[]) => {
        if (name === 'getWork' && frozen.has(key)) return { ...frozen.get(key)! };
        const out = await fn(key, ...rest);
        if (!held.has(key)) return out;
        const other = waiting.get(key);
        if (other) { waiting.delete(key); other(); return out; }
        await new Promise<void>(resolve => {
          const timer = setTimeout(() => { if (waiting.get(key) === done) waiting.delete(key); resolve(); }, 400);
          const done = () => { clearTimeout(timer); resolve(); };
          waiting.set(key, done);
        });
        return out;
      };
    },
  }) as Storage;
  return {
    storage: proxy,
    hold(...keys: string[]): void { held = new Set(keys); },
    freezeAs(key: string, rec: WorkRecord): void { frozen.set(key, rec); },
    clear(): void { held = new Set(); waiting.clear(); frozen.clear(); },
  };
}

describe.each(names)('%s: work and dispute calls at the same moment move morsels once', (provider) => {
  let inner: TestStorage;
  let ctl: ReturnType<typeof paired>;
  let config: AimeatConfig;
  let server: http.Server;
  let base = '';
  const tag = provider === 'sqlite' ? 's' : 'p';
  const R = `adwr${RUN}${tag}`;
  const P = `adwp${RUN}${tag}`;
  const RG = `${R}@${NODE_ID}`;
  const PG = `${P}@${NODE_ID}`;
  const tokens: Record<string, string> = {};

  const call = async (who: string, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
    const res = await fetch(`${base}${path}`, {
      method, headers: { Authorization: `Bearer ${tokens[who]}`, 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: parsed };
  };
  const balance = async (ghii: string): Promise<number> => (await inner.getGHII(ghii))?.morselBalance ?? 0;
  const setBalance = async (ghii: string, n: number): Promise<void> => {
    const cur = await balance(ghii);
    if (cur > n) await inner.debitBalance(ghii, cur - n);
    if (cur < n) await inner.creditBalance(ghii, n - cur);
  };

  /** A work item between R and P, in `status`, with toll 10 and fee 1 held in escrow. */
  async function work(status: string, ttlMs = 3_600_000): Promise<string> {
    const tc = `tc-${randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    const rec: WorkRecord = {
      trackingCode: tc, status, actionId: `act-${RUN}`, providerGaii: PG, requesterGaii: RG, input: {},
      cost: { toll: 10, networkFee: 1, total: 11, inEscrow: 11 },
      ttlExpiresAt: new Date(Date.now() + ttlMs).toISOString(), createdAt: now, updatedAt: now,
    };
    await inner.createWork(rec);
    return tc;
  }

  /** Delivered work with an open dispute on it, and a partial offer of `offer` morsels when given. */
  async function disputed(offer?: number): Promise<{ tc: string; id: string }> {
    const tc = await work('delivered');
    const opened = await call(R, 'POST', `/v1/work/${tc}/dispute`, { reason: 'The output is wrong.' });
    expect(opened.status).toBe(201);
    if (offer !== undefined) {
      const offered = await call(P, 'POST', `/v1/work/${tc}/offer-partial`, { refund_morsels: offer, message: 'Half back.' });
      expect(offered.status).toBe(200);
    }
    return { tc, id: opened.body.data.dispute_id as string };
  }

  beforeAll(async () => {
    inner = await createStorage({
      provider: provider === 'sqlite' ? 'sqlite' : 'postgres-kysely', sqlitePath: ':memory:', dbUrl: process.env.DATABASE_URL,
    }) as TestStorage;
    ctl = paired(inner);
    setThisNodeId(NODE_ID);
    config = { ...loadConfig().config, nodeId: NODE_ID, baseUrl: 'https://node.test' } as AimeatConfig;
    const nodeKeys = await generateKeyPair();
    await initNodeKeys(nodeKeys.publicKey, nodeKeys.privateKey);
    initSessionAuth(inner, config);
    initRevocationStorage(inner, NODE_ID);
    await initStats();
    const now = new Date();
    for (const name of [R, P]) {
      const keys = await generateKeyPair();
      await inner.createOwner({ name, displayName: name, publicKey: keys.publicKey, roles: ['owner'], createdAt: now.toISOString() } as never);
      await inner.createGHII({
        username: name, nodeId: NODE_ID, ghii: `${name}@${NODE_ID}`, displayName: name, verificationLevel: 0,
        ownerName: name, morselBalance: START, createdAt: now.toISOString(), updatedAt: now.toISOString(),
      } as never);
      const sessionId = `sess-${name}`;
      await inner.createSession({ sessionId, gaii: name, owner: name, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3_600_000).toISOString() });
      tokens[name] = await issueJWT({ sub: name, owner: name, node: NODE_ID, roles: ['owner'] }, 3600, sessionId);
    }
    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware());
    app.use(disputesRouter(config, ctl.storage));
    app.use(workRouter(config, ctl.storage, new Map()));
    server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    server?.closeAllConnections();
    await new Promise((r) => server.close(() => r(null)));
    for (const name of [R, P]) {
      await inner.deleteGHII(`${name}@${NODE_ID}`).catch(() => false);
      await inner.deleteOwner(name).catch(() => false);
    }
    setThisNodeId(null);
    await inner.close();
  });

  it('three accept-partial calls at once: one resolves the dispute and the refund moves once', async () => {
    const { tc, id } = await disputed(5);
    await setBalance(PG, 50); await setBalance(RG, 50);
    ctl.hold(tc, id);
    const out = await Promise.all([1, 2, 3].map(() => call(R, 'POST', `/v1/work/${tc}/accept-partial`)));
    ctl.clear();
    expect(out.map(o => o.status).sort()).toEqual([200, 404, 404]);
    for (const o of out.filter(x => x.status === 404)) expect(o.body.error.code).toBe('DISPUTE_CLOSED');
    expect(await balance(RG)).toBe(55);
    expect(await balance(PG)).toBe(45);
    expect((await inner.getDispute(id))?.status).toBe('resolved');
    expect((await inner.getWork(tc))?.status).toBe('settled');
  });

  it('accept-fault and accept-partial at once: one of them resolves the dispute', async () => {
    const { tc, id } = await disputed(5);
    await setBalance(PG, 50); await setBalance(RG, 50);
    ctl.hold(tc, id);
    const out = await Promise.all([
      call(P, 'POST', `/v1/work/${tc}/accept-fault`),
      call(R, 'POST', `/v1/work/${tc}/accept-partial`),
    ]);
    ctl.clear();
    expect(out.map(o => o.status).sort()).toEqual([200, 404]);
    // Whichever won, the pair holds what it held: the refund left the provider once.
    expect((await balance(RG)) + (await balance(PG))).toBe(100);
    expect([55, 60]).toContain(await balance(RG));
  });

  it('a provider whose balance is short leaves the dispute open for the next try', async () => {
    const { tc, id } = await disputed(5);
    await setBalance(PG, 2); await setBalance(RG, 50);
    const short = await call(R, 'POST', `/v1/work/${tc}/accept-partial`);
    expect(short.status).toBe(409);
    expect(short.body.error.code).toBe('PROVIDER_BALANCE_SHORT');
    expect((await inner.getDispute(id))?.status).toBe('open');
    expect((await inner.getWork(tc))?.status).toBe('disputed');
    await setBalance(PG, 50);
    const again = await call(R, 'POST', `/v1/work/${tc}/accept-partial`);
    expect(again.status).toBe(200);
    expect(await balance(RG)).toBe(55);
  });

  it('two disputes opened at once on one delivery: one opens, the other is refused', async () => {
    const tc = await work('delivered');
    ctl.hold(tc);
    const out = await Promise.all([1, 2].map(() => call(R, 'POST', `/v1/work/${tc}/dispute`, { reason: 'The output is wrong.' })));
    ctl.clear();
    expect(out.map(o => o.status).sort()).toEqual([201, 409]);
  });

  it('two rejects at once on pending work: the escrow returns to the requester once', async () => {
    const tc = await work('pending');
    await setBalance(RG, 50);
    ctl.hold(tc);
    const out = await Promise.all([1, 2].map(() => call(P, 'POST', `/v1/work/${tc}/reject`, { reason: 'Busy.' })));
    ctl.clear();
    expect(out.map(o => o.status).sort()).toEqual([200, 409]);
    expect(await balance(RG)).toBe(61);
    expect((await inner.getWork(tc))?.status).toBe('cancelled');
  });

  it('two delivers at once on accepted work: the provider is paid the toll once', async () => {
    const tc = await work('accepted');
    await setBalance(PG, 50);
    ctl.hold(tc);
    const out = await Promise.all([1, 2].map(i => call(P, 'POST', `/v1/work/${tc}/deliver`, { output: { n: i } })));
    ctl.clear();
    expect(out.map(o => o.status).sort()).toEqual([200, 409]);
    expect(await balance(PG)).toBe(60);
    expect((await inner.getWork(tc))?.status).toBe('delivered');
  });

  it('a deliver and the expiry job at once: the escrow is paid out or returned, never both', async () => {
    const tc = await work('accepted', 300);
    await setBalance(PG, 50); await setBalance(RG, 50);
    await new Promise(r => setTimeout(r, 350));
    ctl.hold(tc);
    const [delivered] = await Promise.all([
      call(P, 'POST', `/v1/work/${tc}/deliver`, { output: { n: 1 } }),
      runWorkTimeoutJob(config, ctl.storage),
    ]);
    ctl.clear();
    const status = (await inner.getWork(tc))?.status;
    if (delivered.status === 200) {
      expect(status).toBe('delivered');
      expect(await balance(PG)).toBe(60);
      expect(await balance(RG)).toBe(50);
    } else {
      expect(delivered.status).toBe(409);
      expect(status).toBe('expired');
      expect(await balance(PG)).toBe(50);
      expect(await balance(RG)).toBe(61);
    }
  });

  it('a progress call whose read came before a delivery does not reopen the delivered item', async () => {
    const tc = await work('accepted');
    await setBalance(PG, 50);
    const stale = (await inner.getWork(tc))!;
    expect((await call(P, 'POST', `/v1/work/${tc}/deliver`, { output: { n: 1 } })).status).toBe(200);
    expect(await balance(PG)).toBe(60);
    // The progress call read 'accepted' before the delivery committed and writes after it.
    ctl.freezeAs(tc, stale);
    const late = await call(P, 'POST', `/v1/work/${tc}/progress`);
    ctl.clear();
    expect(late.status).toBe(409);
    expect((await inner.getWork(tc))?.status).toBe('delivered');
    expect((await call(P, 'POST', `/v1/work/${tc}/deliver`, { output: { n: 2 } })).status).toBe(409);
    expect(await balance(PG)).toBe(60);
  });

  it('an accept whose read came before a reject does not reopen the refunded item', async () => {
    const tc = await work('pending');
    await setBalance(PG, 50); await setBalance(RG, 50);
    const stale = (await inner.getWork(tc))!;
    expect((await call(P, 'POST', `/v1/work/${tc}/reject`, { reason: 'Busy.' })).status).toBe(200);
    expect(await balance(RG)).toBe(61);
    // The accept read 'pending' before the reject committed and writes after it.
    ctl.freezeAs(tc, stale);
    const late = await call(P, 'POST', `/v1/work/${tc}/accept`);
    ctl.clear();
    expect(late.status).toBe(409);
    expect((await inner.getWork(tc))?.status).toBe('cancelled');
    expect((await call(P, 'POST', `/v1/work/${tc}/deliver`, { output: { n: 1 } })).status).toBe(409);
    expect(await balance(PG)).toBe(50);
  });

  it('designed use: accept, progress, deliver and rate one at a time work as before', async () => {
    const tc = await work('pending');
    await setBalance(PG, 50);
    const accepted = await call(P, 'POST', `/v1/work/${tc}/accept`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.status).toBe('accepted');
    const started = await call(P, 'POST', `/v1/work/${tc}/progress`);
    expect(started.status).toBe(200);
    expect(started.body.data.status).toBe('in_progress');
    const delivered = await call(P, 'POST', `/v1/work/${tc}/deliver`, { output: { ok: true } });
    expect(delivered.status).toBe(200);
    expect(await balance(PG)).toBe(60);
    const rated = await call(R, 'POST', `/v1/work/${tc}/rate`, { rating: 'positive', comment: 'Good.' });
    expect(rated.status).toBe(200);
    expect(rated.body.data.status).toBe('rated');
    expect((await call(P, 'POST', `/v1/work/${tc}/progress`)).status).toBe(409);
    expect((await call(P, 'POST', `/v1/work/${tc}/accept`)).status).toBe(409);
  });

  it('designed use: one call at a time still resolves, rejects, delivers and expires', async () => {
    const a = await disputed(4);
    await setBalance(PG, 50); await setBalance(RG, 50);
    expect((await call(R, 'POST', `/v1/work/${a.tc}/accept-partial`)).status).toBe(200);
    expect(await balance(RG)).toBe(54);
    const b = await disputed();
    expect((await call(P, 'POST', `/v1/work/${b.tc}/escalate`)).status).toBe(200);
    expect((await call(R, 'POST', `/v1/work/${b.tc}/withdraw-dispute`)).status).toBe(200);
    expect((await inner.getDispute(b.id))?.status).toBe('resolved');
    const c = await work('pending');
    expect((await call(P, 'POST', `/v1/work/${c}/accept`)).status).toBe(200);
    expect((await call(P, 'POST', `/v1/work/${c}/deliver`, { output: { ok: true } })).status).toBe(200);
    const d = await work('pending', 100);
    await new Promise(r => setTimeout(r, 150));
    await runWorkTimeoutJob(config, inner);
    expect((await inner.getWork(d))?.status).toBe('expired');
  });
});
