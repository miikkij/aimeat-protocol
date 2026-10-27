/**
 * @file test/unit/recovery-address-and-reset-cap.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two leads of secaudit2026oct26 on the recovery routes, through the real routes on a
 *   SQLite store with a mail service that records who it mails:
 *   - email-confirm-binds-hash-not-current-recovery-address: a code confirms the address it was sent
 *     to only while that address is still the account's recovery address, and the reset code and the
 *     username go only to an address the person proved;
 *   - password-reset-attempt-cap-read-then-write: overlapping wrong guesses of one reset code are each
 *     counted, so no more than five of them are compared.
 *   The uses that stay: verify then confirm one address, then reset to it; a correct code after four
 *   wrong ones still resets; the username goes to the proven address.
 * @usage pnpm exec vitest run test/unit/recovery-address-and-reset-cap.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { EmailService } from '../../src/services/email.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { registerRecoveryRoutes } from '../../src/routes/ghii/recovery.js';

const NODE_ID = 'aimeat-recovery-binding-test';
const hashOf = (email: string) => createHash('sha256').update(email.toLowerCase().trim()).digest('hex');

interface Mail { to: string; kind: 'verify' | 'reset' | 'username'; code?: string }

let storage: Storage;
let server: http.Server;
let base = '';
let mails: Mail[] = [];
let forwarded = 0;

const mailer = {
  enabled: true,
  sendVerificationCode: async (to: string, code: string) => { mails.push({ to, kind: 'verify', code }); return true; },
  sendRaw: async (to: string, _s: string, _h: string, text: string) => {
    mails.push({ to, kind: 'reset', code: /\b(\d{6})\b/.exec(text)?.[1] }); return true;
  },
  sendNotification: async (to: string) => { mails.push({ to, kind: 'username' }); return true; },
} as unknown as EmailService;

/** An account holder in person, as the session middleware would have resolved it. */
function signedInAs(name: string) {
  return (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const who = req.headers['x-test-owner'];
    if (typeof who === 'string' && who === name) {
      (req as unknown as { auth: unknown }).auth = { sub: name, owner: name, roles: ['owner'], scopes: [] };
    }
    next();
  };
}

async function start(wrap?: (s: Storage) => Storage, owner = 'alice') {
  const real = new SqliteStorage(':memory:') as unknown as Storage;
  storage = real;
  const config: AimeatConfig = { ...loadConfig().config, nodeId: NODE_ID, baseUrl: 'https://node.test' };
  const app = express();
  // Each request names its own client address, so the routes' per-address limits (3 in 10 minutes)
  // do not decide what these tests measure.
  app.set('trust proxy', true);
  app.use(express.json());
  app.use(signedInAs(owner));
  const router = express.Router();
  registerRecoveryRoutes(router, config, wrap ? wrap(real) : real, mailer);
  app.use(router);
  server = http.createServer(app);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function account(name: string, email: string): Promise<void> {
  const now = new Date().toISOString();
  await storage.createGHII({
    username: name, nodeId: NODE_ID, ghii: `${name}@${NODE_ID}`, displayName: name, verificationLevel: 1,
    ownerName: name, notificationEmail: email, emailVerifiedAt: now, emailHash: hashOf(email), createdAt: now, updatedAt: now,
  } as never);
}

const post = async (path: string, body: unknown, owner?: string) => {
  forwarded += 1;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Forwarded-For': `198.51.100.${forwarded % 250}` };
  if (owner) headers['x-test-owner'] = owner;
  const r = await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() as { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } } };
};

beforeEach(() => { mails = []; });
afterEach(async () => { await new Promise<void>(r => server.close(() => r())); });

describe('a confirmed code binds the address that is the recovery address now', () => {
  it('a code for an address that is no longer the recovery address does not mark the current one proven', async () => {
    await start();
    await account('alice', 'alice-old@example.test');
    const b = await post('/v1/ghii/email/verify', { email: 'alice-b@example.test' }, 'alice');
    expect(b.status).toBe(200);
    const c = await post('/v1/ghii/email/verify', { email: 'alice-c@example.test' }, 'alice');
    expect(c.status).toBe(200);
    const codeB = mails.find(m => m.to === 'alice-b@example.test')?.code;
    const confirm = await post('/v1/ghii/email/confirm', { code: codeB, verification_id: b.body.data?.verification_id }, 'alice');
    expect(confirm.status).toBe(409);
    expect(confirm.body.error?.code).toBe('EMAIL_CHANGED');
    mails = [];
    await post('/v1/ghii/password/reset-request', { username: 'alice' });
    expect(mails.filter(m => m.kind === 'reset')).toEqual([]);
  });

  it('the username and the reset code go only to the address the person proved', async () => {
    await start();
    await account('alice', 'alice-old@example.test');
    // The recovery address changes to one nobody proved, while the old proof stays on the account.
    await storage.updateGHII(`alice@${NODE_ID}`, { notificationEmail: 'alice-new@example.test' });
    await post('/v1/ghii/account/recover', { email: 'alice-old@example.test' });
    await post('/v1/ghii/password/reset-request', { username: 'alice' });
    expect(mails).toEqual([]);
  });

  it('usage: verify then confirm one address, and the reset code goes there and resets', async () => {
    await start();
    await account('alice', 'alice-old@example.test');
    const b = await post('/v1/ghii/email/verify', { email: 'alice-b@example.test' }, 'alice');
    const codeB = mails.find(m => m.to === 'alice-b@example.test')?.code;
    const confirm = await post('/v1/ghii/email/confirm', { code: codeB, verification_id: b.body.data?.verification_id }, 'alice');
    expect(confirm.status).toBe(200);
    mails = [];
    await post('/v1/ghii/password/reset-request', { username: 'alice' });
    const reset = mails.find(m => m.kind === 'reset');
    expect(reset?.to).toBe('alice-b@example.test');
    const done = await post('/v1/ghii/password/reset', { username: 'alice', code: reset?.code, newPassword: 'Str0ng-Reset-Pw' });
    expect(done.status).toBe(200);
  });

  it('usage: the username goes to the proven address', async () => {
    await start();
    await account('alice', 'alice-old@example.test');
    await post('/v1/ghii/account/recover', { email: 'alice-old@example.test' });
    expect(mails).toEqual([{ to: 'alice-old@example.test', kind: 'username' }]);
  });
});

describe('the five-guess cap of a reset code holds for overlapping guesses', () => {
  /** A store whose read of the pending code answers after a pause, as a database round trip does. */
  const slowRead = (s: Storage): Storage => new Proxy(s, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if (prop === 'getActiveEmailVerification') {
        return async (...args: unknown[]) => {
          const out = await (v as (...a: unknown[]) => Promise<unknown>).apply(target, args);
          await new Promise(r => setTimeout(r, 40));
          return out;
        };
      }
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });

  it('twelve overlapping wrong guesses: five are compared, the rest are refused as too many', async () => {
    await start(slowRead);
    await account('bob', 'bob@example.test');
    await post('/v1/ghii/password/reset-request', { username: 'bob' });
    const code = mails.find(m => m.kind === 'reset')?.code ?? '';
    const wrong = code === '222222' ? '333333' : '222222';
    const answers = await Promise.all(Array.from({ length: 12 }, () =>
      post('/v1/ghii/password/reset', { username: 'bob', code: wrong, newPassword: 'Str0ng-Reset-Pw' })));
    const codes = answers.map(a => a.body.error?.code);
    expect(codes.filter(c => c === 'INVALID_CODE').length).toBeLessThanOrEqual(5);
    expect(codes.filter(c => c === 'TOO_MANY_ATTEMPTS').length).toBeGreaterThanOrEqual(7);
    const right = await post('/v1/ghii/password/reset', { username: 'bob', code, newPassword: 'Str0ng-Reset-Pw' });
    expect(right.body.error?.code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('usage: a correct code after four wrong ones still resets the password, once', async () => {
    await start(slowRead);
    await account('bob', 'bob@example.test');
    await post('/v1/ghii/password/reset-request', { username: 'bob' });
    const code = mails.find(m => m.kind === 'reset')?.code ?? '';
    const wrong = code === '222222' ? '333333' : '222222';
    for (let i = 0; i < 4; i++) {
      const w = await post('/v1/ghii/password/reset', { username: 'bob', code: wrong, newPassword: 'Str0ng-Reset-Pw' });
      expect(w.body.error?.code).toBe('INVALID_CODE');
    }
    const right = await post('/v1/ghii/password/reset', { username: 'bob', code, newPassword: 'Str0ng-Reset-Pw' });
    expect(right.status).toBe(200);
    const again = await post('/v1/ghii/password/reset', { username: 'bob', code, newPassword: 'Str0ng-Reset-Pw2' });
    expect(again.status).toBe(400);
  });
});
