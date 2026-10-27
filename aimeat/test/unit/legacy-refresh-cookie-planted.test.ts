/**
 * @file test/unit/legacy-refresh-cookie-planted.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description During the refresh-cookie migration window an https node read one `aimeat_rt` value,
 *   which a same-site app origin can write for the apex: its author's own session then signed a
 *   signed-out visitor in to the author's account (secaudit2026oct26,
 *   owner-session:legacy-refresh-cookie-accepted-from-app-origin). A token this node issued for the
 *   `__Host-` cookie is now never read under the old name on https.
 *   The uses that stay: a browser that holds a cookie from before the rename, or from a plain-http
 *   answer, moves to `__Host-aimeat_rt`; plain http keeps the old name; the `__Host-` cookie refreshes.
 * @usage pnpm exec vitest run test/unit/legacy-refresh-cookie-planted.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { Request, Response } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { initNodeKeys } from '../../src/auth/jwt.js';
import {
  establishOwnerSession, refreshOwnerSession, readRefreshCookie, hashToken, REFRESH_COOKIE, LEGACY_REFRESH_COOKIE,
} from '../../src/services/owner-session.js';

const DAY = 86_400_000;
let storage: Storage;
// The window is open, as on a node inside its first 30 days with the renamed cookie.
const config = { ...loadConfig().config, nodeId: 'aimeat-legacy-rt-test', refreshCookieLegacyUntil: '2999-12-31' } as AimeatConfig;

function req(cookie: string, https = true): Request {
  return {
    headers: { cookie, 'x-aimeat-refresh': '1', 'user-agent': 'test', ...(https ? { 'x-forwarded-proto': 'https' } : {}) },
    secure: false, ip: '127.0.0.1',
  } as unknown as Request;
}

function recorder() {
  const set: Array<{ name: string; value: string }> = [];
  const res = {
    cookie(name: string, value: string) { set.push({ name, value }); return res; },
    clearCookie() { return res; },
  };
  return { res: res as unknown as Response, set };
}

/** Sign in over https or plain http; answers the refresh token the browser got and its cookie name. */
async function signIn(owner: string, https: boolean): Promise<{ name: string; value: string }> {
  const { res, set } = recorder();
  await establishOwnerSession(storage, config, req('', https), res, { owner, roles: ['owner'] });
  return set[0]!;
}

beforeAll(async () => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
  const kp = await generateKeyPair();
  await initNodeKeys(kp.publicKey, kp.privateKey);
  for (const name of ['author', 'visitor']) {
    await storage.createOwner({ name, displayName: name, publicKey: kp.publicKey, roles: ['owner'], createdAt: new Date(Date.now() - 90 * DAY).toISOString() } as never);
  }
});

describe('an old-name refresh cookie on https', () => {
  it('a token issued for the __Host- cookie is not read, and does not refresh, under aimeat_rt', async () => {
    const author = await signIn('author', true);
    expect(author.name).toBe(REFRESH_COOKIE);
    const planted = req(`${LEGACY_REFRESH_COOKIE}=${author.value}`);
    expect(readRefreshCookie(planted, config)).toBeNull();
    const { res, set } = recorder();
    const out = await refreshOwnerSession(storage, config, planted, res);
    expect(out.ok).toBe(false);
    expect(set.map(c => c.name)).not.toContain(REFRESH_COOKIE);
  });

  it('usage: a browser that holds its cookie from before the rename moves to __Host-aimeat_rt', async () => {
    const raw = randomBytes(32).toString('hex');
    const iso = new Date(Date.now() - 15 * DAY).toISOString();
    await storage.createOwnerSession({
      sessionId: randomUUID(), gaii: 'visitor', owner: 'visitor', issuedAt: iso, refreshTokenHash: hashToken(raw),
      idleExpiresAt: new Date(Date.now() + 15 * DAY).toISOString(), absoluteExpiresAt: new Date(Date.now() + 60 * DAY).toISOString(),
      lastUsedAt: iso, deviceLabel: 'test', userAgent: 'test',
    });
    const { res, set } = recorder();
    const out = await refreshOwnerSession(storage, config, req(`${LEGACY_REFRESH_COOKIE}=${raw}`), res);
    expect(out.ok).toBe(true);
    expect(set.map(c => c.name)).toContain(REFRESH_COOKIE);
  });

  it('usage: a cookie a plain-http answer set moves to __Host-aimeat_rt on its first https refresh', async () => {
    const old = await signIn('visitor', false);
    expect(old.name).toBe(LEGACY_REFRESH_COOKIE);
    const { res, set } = recorder();
    const out = await refreshOwnerSession(storage, config, req(`${LEGACY_REFRESH_COOKIE}=${old.value}`), res);
    expect(out.ok).toBe(true);
    expect(set.map(c => c.name)).toContain(REFRESH_COOKIE);
  });

  it('usage: the __Host- cookie refreshes again and again, and plain http keeps the old name', async () => {
    let cookie = await signIn('visitor', true);
    for (let i = 0; i < 3; i++) {
      const { res, set } = recorder();
      const out = await refreshOwnerSession(storage, config, req(`${REFRESH_COOKIE}=${cookie.value}`), res);
      expect(out.ok).toBe(true);
      cookie = set.find(c => c.name === REFRESH_COOKIE)!;
    }
    const plain = await signIn('visitor', false);
    const { res, set } = recorder();
    expect((await refreshOwnerSession(storage, config, req(`${LEGACY_REFRESH_COOKIE}=${plain.value}`, false), res)).ok).toBe(true);
    expect(set.map(c => c.name)).toContain(LEGACY_REFRESH_COOKIE);
  });
});
