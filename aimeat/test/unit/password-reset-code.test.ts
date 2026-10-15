/**
 * @file test/unit/password-reset-code.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description QA audit F02a-02, the unauthenticated password reset, through the real recovery
 *   routes on a SQLite store with a mail service that records what it sends:
 *   - the reset code is not built with Math.random (it comes from crypto.randomInt), and the mailed
 *     code is the code the reset accepts;
 *   - a new reset request keeps the failed attempts of the live code it replaces, so asking again
 *     does not reset the five-guess cap.
 *   The shared per-address limit is asserted over HTTP in e2e-email-delivery.
 * @usage cd aimeat && pnpm exec vitest run test/unit/password-reset-code.test.ts
 * @version-history
 *   2026-10-16 — Initial (QA audit F02a-02).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { EmailService } from '../../src/services/email.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { registerRecoveryRoutes } from '../../src/routes/ghii/recovery.js';

const NODE_ID = 'aimeat-reset-code-test';
let storage: Storage;
let config: AimeatConfig;
let server: http.Server;
let base = '';
const sent: string[] = [];

const mailer = {
  enabled: true,
  sendRaw: async (_to: string, _subject: string, _html: string, text: string) => { sent.push(text); return true; },
} as unknown as EmailService;

async function ghii(name: string): Promise<void> {
  const now = new Date().toISOString();
  await storage.createGHII({
    username: name, nodeId: NODE_ID, ghii: `${name}@${NODE_ID}`, displayName: name, verificationLevel: 1,
    ownerName: name, notificationEmail: `${name}@example.test`, emailVerifiedAt: now,
    emailHash: createHash('sha256').update(`${name}@example.test`).digest('hex'), createdAt: now, updatedAt: now,
  } as never);
}

const post = async (path: string, body: unknown) => {
  const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() as { ok: boolean; error?: { code: string } } };
};

beforeAll(async () => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
  config = { ...loadConfig().config, nodeId: NODE_ID, baseUrl: 'https://node.test' };
  const app = express();
  app.use(express.json());
  const router = express.Router();
  registerRecoveryRoutes(router, config, storage, mailer);
  app.use(router);
  server = http.createServer(app);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>(r => server.close(() => r())); });

describe('the password reset code (F02a-02)', () => {
  it('is not built with Math.random, and the mailed code is the one the reset accepts', async () => {
    await ghii('resetone');
    const random = vi.spyOn(Math, 'random');
    sent.length = 0;
    const ask = await post('/v1/ghii/password/reset-request', { username: 'resetone' });
    expect(ask.status).toBe(200);
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
    const code = /\b(\d{6})\b/.exec(sent.join('\n'))?.[1];
    expect(code).toMatch(/^[1-9]\d{5}$/);
    const reset = await post('/v1/ghii/password/reset', { username: 'resetone', code, newPassword: 'Str0ng-Reset-Pw' });
    expect(reset.status).toBe(200);
  });

  it('keeps the failed attempts of the code it replaces, so asking again does not reset the cap', async () => {
    await ghii('resettwo');
    const now = Date.now();
    await storage.createEmailVerification({
      id: 'old-code', ownerName: 'resettwo', emailHash: '', code: createHash('sha256').update('111111').digest('hex'),
      purpose: 'password_reset', status: 'pending', attempts: 4,
      expiresAt: new Date(now + 10 * 60 * 1000).toISOString(), createdAt: new Date(now - 1000).toISOString(), verifiedAt: null,
    });
    sent.length = 0;
    const ask = await post('/v1/ghii/password/reset-request', { username: 'resettwo' });
    expect(ask.status).toBe(200);
    const fresh = await storage.getActiveEmailVerification('resettwo', 'password_reset');
    expect(fresh?.id).not.toBe('old-code');
    expect(fresh?.attempts).toBe(4);

    const code = /\b(\d{6})\b/.exec(sent.join('\n'))?.[1];
    const wrong = await post('/v1/ghii/password/reset', { username: 'resettwo', code: code === '222222' ? '333333' : '222222', newPassword: 'Str0ng-Reset-Pw' });
    expect(wrong.status).toBe(400);
    // The fifth failure across both codes: even the right code is now refused.
    const right = await post('/v1/ghii/password/reset', { username: 'resettwo', code, newPassword: 'Str0ng-Reset-Pw' });
    expect(right.status).toBe(429);
    expect(right.body.error?.code).toBe('TOO_MANY_ATTEMPTS');
  });
});
