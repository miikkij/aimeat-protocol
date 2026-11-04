/**
 * @file test/unit/ephemeral-claims-two-process.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two processes of one node over one database share their one-time values and their
 *   counters (codebase analysis 2026-11-03, high-availability stage 2, items 2.3 and 2.4):
 *   - an MCP OAuth authorization code issued on A is redeemed on B, and only once;
 *   - a request nonce and an older-format signed message accepted on A are refused on B;
 *   - a presigned upload address issued on A is accepted on B;
 *   - N processes do not allow N times a limit: the per-account mail limit, the AI call limit, the
 *     wrong admin password count and the sign-in tarpit are counted once for the node.
 *
 *   "A process" is a fresh copy of the module graph (vi.resetModules) with its OWN storage instance
 *   on one database: on SQLite two connections to one file, on PostgreSQL two pools on one test
 *   database, so nothing one process holds in memory is seen by the other. Before 2026-11-04 every
 *   one of these was a Map in the process, and each assertion below that names B failed.
 *
 *   The storage contract of EphemeralClaimRepository (both providers, one case each) is at the end.
 * @usage
 *   cd aimeat && pnpm exec vitest run test/unit/ephemeral-claims-two-process.test.ts
 *   cd aimeat && node --env-file=.env.test.postgres-kysely --import tsx node_modules/vitest/vitest.mjs run test/unit/ephemeral-claims-two-process.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, HA stage 2).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair as joseKeyPair } from 'jose';
import { requirePostgresWhenAsked } from './postgres-arm.js';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair, sign } from '../../src/auth/keypair.js';

requirePostgresWhenAsked('ephemeral-claims-two-process');

type TestStorage = Storage & { close(): void | Promise<void> };
const RUN = randomUUID().slice(0, 8);
const NODE_ID = `two-proc-${RUN}`;
const BASE_URL = 'https://node.test';
const MCP_RESOURCE = `${BASE_URL}/v1/mcp`;
const OWNER = `tp${RUN}`;
const GAII = `claude#${OWNER}@${NODE_ID}`;

const config = {
  ...loadConfig().config, nodeId: NODE_ID, baseUrl: BASE_URL,
  adminPassword: 'the-right-one', adminAuthRateLimitMax: 5, adminAuthRateLimitWindowMs: 60_000,
  loginTarpitEnabled: true, loginTarpitFreeFailures: 4, loginTarpitBlockAfter: 4,
  loginTarpitStepMs: 10, loginTarpitMaxDelayMs: 10, loginTarpitWindowMs: 60_000, loginTarpitMaxConcurrent: 50,
} as AimeatConfig;

let nodeKeys: { publicKey: string; privateKey: string };
let agentKeys: { publicKey: string; privateKey: string };
let uploadKeys: { privateKey: CryptoKey; publicKey: CryptoKey };

/** One node process: its own module graph over its own storage instance. */
async function bootProcess(storage: Storage) {
  vi.resetModules();
  (await import('../../src/utils/gaii.js')).setThisNodeId(null);
  const jwt = await import('../../src/auth/jwt.js');
  await jwt.initNodeKeys(nodeKeys.publicKey, nodeKeys.privateKey);
  jwt.initRevocationStorage(storage, NODE_ID);
  (await import('../../src/auth/middleware.js')).initSessionAuth(storage, config);
  await (await import('../../src/services/stats.js')).initStats();
  const upload = await import('../../src/services/upload-token.js');
  upload.initUploadTokenKeys(uploadKeys.privateKey, uploadKeys.publicKey);
  const { registerOAuthRoutes } = await import('../../src/mcp/oauth.js');
  const { loginTarpit } = await import('../../src/middleware/login-tarpit.js');
  const app = express();
  app.use(express.json());
  const router = express.Router();
  registerOAuthRoutes(router, config, storage);
  app.use(router);
  // A credential route that refuses every guess, behind the tarpit, as the sign-in routes mount it.
  app.post('/guess', loginTarpit(config), (_req, res) => { res.status(401).json({ ok: false }); });
  const server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return {
    server,
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    upload,
    signed: await import('../../src/services/signed-node-request.js'),
    limits: await import('../../src/services/account-limits.js'),
    admin: await import('../../src/services/admin-password.js'),
  };
}
type Proc = Awaited<ReturnType<typeof bootProcess>>;

async function call(base: string, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; } catch { return { status: res.status, body: text }; }
}

/** Two storage instances on one database, per provider that this run has. */
async function databases(): Promise<Array<{ name: string; a: TestStorage; b: TestStorage; dispose(): Promise<void> }>> {
  const out: Array<{ name: string; a: TestStorage; b: TestStorage; dispose(): Promise<void> }> = [];
  const dir = mkdtempSync(join(tmpdir(), 'aimeat-two-proc-'));
  const file = join(dir, 'node.db');
  const sa = await createStorage({ provider: 'sqlite', sqlitePath: file }) as TestStorage;
  const sb = await createStorage({ provider: 'sqlite', sqlitePath: file }) as TestStorage;
  out.push({ name: 'sqlite', a: sa, b: sb, async dispose() { await sa.close(); await sb.close(); rmSync(dir, { recursive: true, force: true }); } });
  if (process.env.DATABASE_URL) {
    const pa = await createStorage({ provider: 'postgres-kysely', dbUrl: process.env.DATABASE_URL }) as TestStorage;
    const pb = await createStorage({ provider: 'postgres-kysely', dbUrl: process.env.DATABASE_URL }) as TestStorage;
    out.push({ name: 'postgres-kysely', a: pa, b: pb, async dispose() { await pa.close(); await pb.close(); } });
  }
  return out;
}

let dbs: Awaited<ReturnType<typeof databases>> = [];

beforeAll(async () => {
  nodeKeys = await generateKeyPair();
  agentKeys = await generateKeyPair();
  const kp = await joseKeyPair('EdDSA', { extractable: true });
  uploadKeys = { privateKey: kp.privateKey as CryptoKey, publicKey: kp.publicKey as CryptoKey };
  dbs = await databases();
  for (const { a } of dbs) {
    const now = new Date().toISOString();
    await a.createOwner({ name: OWNER, displayName: OWNER, publicKey: nodeKeys.publicKey, roles: ['owner'], createdAt: now } as never);
    await a.createGHII({
      username: OWNER, nodeId: NODE_ID, ghii: `${OWNER}@${NODE_ID}`, displayName: OWNER,
      ownerName: OWNER, totpEnabled: false, verificationLevel: 0, createdAt: now, updatedAt: now,
    } as never);
    await a.createAgent({
      name: 'claude', owner: OWNER, gaii: GAII, publicKey: agentKeys.publicKey, trustScore: 50,
      morselBalance: 0, capabilities: [], defaultScopes: ['memory:read'], createdAt: now, lastSeen: now,
    } as never);
  }
}, 120_000);

afterAll(async () => {
  for (const { a, dispose } of dbs) {
    await a.deleteAgent(GAII).catch(() => false);
    await a.deleteOwner(OWNER).catch(() => false);
    await dispose();
  }
});

describe.each(['sqlite', 'postgres-kysely'].filter(n => n === 'sqlite' || !!process.env.DATABASE_URL))('two processes on %s', (name) => {
  let A: Proc;
  let B: Proc;
  let clientId = '';
  let clientSecret = '';

  beforeAll(async () => {
    const db = dbs.find(d => d.name === name)!;
    A = await bootProcess(db.a);
    B = await bootProcess(db.b);
    const reg = await call(A.base, 'POST', '/v1/mcp/register', { client_name: `two-proc-${name}` });
    clientId = reg.body.client_id;
    clientSecret = reg.body.client_secret;
  }, 180_000);

  afterAll(async () => {
    for (const p of [A, B]) {
      p?.server.closeAllConnections();
      await new Promise((r) => p?.server.close(() => r(null)) ?? r(null));
    }
  });

  it('an OAuth authorization code issued on A is redeemed on B, and only once', async () => {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const timestamp = new Date().toISOString();
    const signature = await sign(agentKeys.privateKey, GAII + NODE_ID + timestamp);
    const qs = new URLSearchParams({
      response_type: 'code', client_id: clientId, gaii: GAII, signature, timestamp,
      code_challenge: challenge, code_challenge_method: 'S256', resource: MCP_RESOURCE,
    });
    const issued = await call(A.base, 'GET', `/v1/mcp/authorize?${qs}`);
    expect(issued.status, JSON.stringify(issued.body)).toBe(200);
    const redeem = { grant_type: 'authorization_code', code: issued.body.code, code_verifier: verifier, resource: MCP_RESOURCE, client_id: clientId, client_secret: clientSecret };

    const onB = await call(B.base, 'POST', '/v1/mcp/token', redeem);
    expect(onB.status, JSON.stringify(onB.body)).toBe(200);
    expect(typeof onB.body.access_token).toBe('string');

    const againOnA = await call(A.base, 'POST', '/v1/mcp/token', redeem);
    expect(againOnA.status).toBe(400);
    expect(againOnA.body.error).toBe('invalid_grant');

    // The signature that minted the code was spent on A: the same signed URL on B is refused.
    const replay = await call(B.base, 'GET', `/v1/mcp/authorize?${qs}`);
    expect(replay.status).toBe(401);
  });

  it('a request nonce accepted on A is refused on B', async () => {
    const keys = await generateKeyPair();
    const signer = { getNodeKey: async () => keys } as unknown as Storage;
    const fields = { purpose: `two-proc-${name}` };
    const opts = { thisNodeId: NODE_ID, fields, keyOf: () => ({ publicKey: keys.publicKey }), missingMessage: 'missing', badSignatureMessage: 'bad' };
    const h = await A.signed.signNodeRequest(signer, { nodeId: `peer-${RUN}` } as never, NODE_ID, fields);
    expect(await A.signed.checkNodeRequest(h, opts)).toEqual({ ok: true, nodeId: `peer-${RUN}` });
    expect(await B.signed.checkNodeRequest(h, opts)).toMatchObject({ ok: false, code: 'REPLAYED' });
  });

  it('an older-format signed message received on A is refused on B', async () => {
    const at = new Date().toISOString();
    const sig = randomBytes(64).toString('base64');
    expect(await A.signed.signedMessageRefusalOnNode(`peer-${RUN}`, at, sig)).toBeNull();
    expect((await B.signed.signedMessageRefusalOnNode(`peer-${RUN}`, at, sig))?.code).toBe('REPLAYED');
  });

  it('a presigned upload address issued on A is accepted on B', async () => {
    const handle = await A.upload.generateUploadToken({ sub: `${OWNER}@${NODE_ID}`, utype: 'storage', meta: {}, maxBytes: 10, contentType: 'text/plain' }, 600);
    expect(handle).toMatch(/^u_/);
    const db = dbs.find(d => d.name === name)!;
    const verified = await B.upload.verifyUploadToken(handle, db.b);
    expect(verified.sub).toBe(`${OWNER}@${NODE_ID}`);
    // Spent once for the node: the same address on A is refused.
    await expect(A.upload.verifyUploadToken(handle, db.a)).rejects.toMatchObject({ code: 'TOKEN_USED' });
  });

  it('the per-account mail limit is counted once for two processes, not twice', async () => {
    const account = `mail-${RUN}-${name}@${NODE_ID}`;
    let allowed = 0;
    let refusal: { ok: boolean; retryAfterSec?: number } | null = null;
    for (let i = 0; i < 40; i++) {
      const turn = await (i % 2 === 0 ? A : B).limits.takeMailSendOnNode(account);
      if (turn.ok) allowed++;
      else refusal ??= turn;
    }
    expect(allowed).toBe(A.limits.MAIL_SEND_LIMIT.max);
    expect(refusal?.retryAfterSec).toBeGreaterThan(0);
  });

  it('the AI call limit is counted once for two processes, not twice', async () => {
    const cfg = { rateLimits: { openrouter: { windowMs: 60_000, max: 3 } } };
    const owner = `ai-${RUN}-${name}@${NODE_ID}`;
    const answers: boolean[] = [];
    for (let i = 0; i < 6; i++) answers.push((await (i % 2 === 0 ? A : B).limits.takeAiCallOnNode(cfg, i % 3 === 0 ? owner : `claude#${owner}`)).ok);
    expect(answers).toEqual([true, true, true, false, false, false]);
    await expect(B.limits.requireAiCallTurnOnNode(cfg, owner, undefined)).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    await expect(A.limits.requireAiCallTurnOnNode(cfg, owner, 'exempt')).resolves.toBeUndefined();
  });

  it('wrong admin passwords are counted once for two processes, and the right one is then refused on either', async () => {
    const address = `10.9.${RUN.length}.${name.length}`;
    for (let i = 0; i < 5; i++) expect((await (i % 2 === 0 ? A : B).admin.checkAdminPasswordOnNode(config, address, `guess-${i}`)).kind).toBe('wrong');
    const right = await B.admin.checkAdminPasswordOnNode(config, address, 'the-right-one');
    expect(right).toMatchObject({ kind: 'limited', max: 5, windowSec: 60 });
    expect((await A.admin.checkAdminPasswordOnNode(config, address, 'the-right-one')).kind).toBe('limited');
    expect((await A.admin.checkAdminPasswordOnNode(config, `${address}.9`, 'the-right-one')).kind).toBe('ok');
  });

  it('the sign-in tarpit walls an address after its failures on both processes together', async () => {
    const answers: number[] = [];
    for (let i = 0; i < 4; i++) answers.push((await call((i % 2 === 0 ? A : B).base, 'POST', '/guess', { username: 'x' })).status);
    expect(answers).toEqual([401, 401, 401, 401]);
    const walled = await call(B.base, 'POST', '/guess', { username: 'x' });
    expect(walled.status).toBe(429);
    expect(walled.body.error.code).toBe('TOO_MANY_ATTEMPTS');
    expect((await call(A.base, 'POST', '/guess', { username: 'x' })).status).toBe(429);
  });
});

describe.each(['sqlite', 'postgres-kysely'].filter(n => n === 'sqlite' || !!process.env.DATABASE_URL))('EphemeralClaimRepository on %s', (name) => {
  const k = `contract-${RUN}`;
  const storage = (): Storage => dbs.find(d => d.name === name)!.a;

  it('put, get, take and delete a value', async () => {
    const s = storage();
    await s.putEphemeralClaim(k, 'v1', 'payload-1', 5_000);
    expect(await s.getEphemeralClaim(k, 'v1')).toEqual({ payload: 'payload-1', expiresAt: 5_000 });
    await s.putEphemeralClaim(k, 'v1', 'payload-2', 6_000);
    expect(await s.takeEphemeralClaim(k, 'v1')).toEqual({ payload: 'payload-2', expiresAt: 6_000 });
    expect(await s.takeEphemeralClaim(k, 'v1')).toBeNull();
    expect(await s.getEphemeralClaim(k, 'v1')).toBeNull();
    await s.putEphemeralClaim(k, 'v2', 'p', 7_000);
    expect(await s.deleteEphemeralClaim(k, 'v2')).toBe(true);
    expect(await s.deleteEphemeralClaim(k, 'v2')).toBe(false);
  });

  it('spend a value once until it expires, and count the valid ones', async () => {
    const s = storage();
    const now = Date.now();
    expect(await s.spendEphemeralClaim(`${k}-spend`, 'n1', now + 1_000, now)).toBe(true);
    expect(await s.spendEphemeralClaim(`${k}-spend`, 'n1', now + 1_000, now + 999)).toBe(false);
    expect(await s.spendEphemeralClaim(`${k}-spend`, 'n1', now + 5_000, now + 1_000)).toBe(true);
    expect(await s.spendEphemeralClaim(`${k}-spend`, 'n2', now + 10, now)).toBe(true);
    expect(await s.countEphemeralClaims(`${k}-spend`, now)).toBe(2);
    expect(await s.countEphemeralClaims(`${k}-spend`, now + 10)).toBe(1);
  });

  it('count in a fixed window and in a sliding one, and sweep what ended', async () => {
    const s = storage();
    const now = 1_000_000;
    const fixed = { now, windowMs: 100, staleBefore: now, sliding: false };
    expect(await s.bumpEphemeralCounter(`${k}-c`, 'f', fixed)).toEqual({ count: 1, expiresAt: now + 100 });
    expect(await s.bumpEphemeralCounter(`${k}-c`, 'f', { ...fixed, now: now + 50, staleBefore: now + 50 })).toEqual({ count: 2, expiresAt: now + 100 });
    expect(await s.bumpEphemeralCounter(`${k}-c`, 'f', { ...fixed, now: now + 100, staleBefore: now + 100 })).toEqual({ count: 3, expiresAt: now + 100 });
    expect(await s.bumpEphemeralCounter(`${k}-c`, 'f', { ...fixed, now: now + 101, staleBefore: now + 101 })).toEqual({ count: 1, expiresAt: now + 201 });
    const sliding = { now, windowMs: 100, staleBefore: now, sliding: true };
    expect(await s.bumpEphemeralCounter(`${k}-c`, 's', sliding)).toEqual({ count: 1, expiresAt: now + 100 });
    expect(await s.bumpEphemeralCounter(`${k}-c`, 's', { ...sliding, now: now + 60, staleBefore: now + 60 })).toEqual({ count: 2, expiresAt: now + 160 });
    expect(await s.readEphemeralCounter(`${k}-c`, 's')).toEqual({ count: 2, expiresAt: now + 160 });
    expect(await s.readEphemeralCounter(`${k}-c`, 'none')).toBeNull();
    expect(await s.sweepEphemeralClaims(now + 170)).toBeGreaterThanOrEqual(1);
    expect(await s.readEphemeralCounter(`${k}-c`, 's')).toBeNull();
    expect(await s.readEphemeralCounter(`${k}-c`, 'f')).toEqual({ count: 1, expiresAt: now + 201 });
    await s.sweepEphemeralClaims(now + 1_000);
  });
});
