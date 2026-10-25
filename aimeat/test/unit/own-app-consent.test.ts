/**
 * @file test/unit/own-app-consent.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's own app signs in silently on the bridge (GET /v1/auth/app-grant-silent),
 *   except for the words its grant lacks when another account published the live version or the
 *   owner narrowed the grant by hand: those go to the owner's one-press consent, listed
 *   (services/own-app-consent.ts; secaudit2026oct22, own-app-silent-ignores-publisher-and-owner-
 *   narrowing). Drives the real appGrantsRouter over in-memory SQLite, and reads the grant from
 *   storage rather than trusting the reply.
 * @usage cd aimeat && pnpm exec vitest run test/unit/own-app-consent.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { appGrantsRouter } from '../../src/routes/app-grants.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { initNodeKeys } from '../../src/auth/jwt.js';
import { initSessionAuth } from '../../src/auth/middleware.js';
import type { Storage } from '../../src/storage/interface.js';

const NODE_ID = 'aimeat-local-001-dev';
const APP_HOST = 'apps.aimeat.test';
const OWNER = 'oacowner';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

interface SilentReply { ok: boolean; error?: string; reason?: string; why?: string; added?: string; published_by?: string; scope?: string }

describe('the owner\'s own app asks its owner for new words a delegate or a hand narrowing put in question', () => {
  let storage: SqliteStorage;
  let server: http.Server;
  let base: string;
  let config: AimeatConfig;
  let cookie = '';
  let version = 0;

  /** A new live version of `file`, published by `by`. */
  async function publish(file: string, by: string | undefined): Promise<void> {
    const html = Buffer.from('<!DOCTYPE html><html><body>app</body></html>');
    await (storage as unknown as Storage).createApp({
      ownerGaii: `${OWNER}@${NODE_ID}`, ownerName: OWNER, filename: file, versionNumber: ++version,
      manifest: { name: file, description: '', version: '1.0.0', category: 'utility', tags: [], authorDisplay: OWNER, usesCortex: [], ...(by ? { publishedBy: by } : {}) },
      mimeType: 'text/html', size: html.length, data: html, createdAt: new Date().toISOString(),
    });
  }

  async function site(sub: string, file: string): Promise<void> {
    const now = new Date().toISOString();
    await storage.createSubdomainSite({ subdomain: sub, kind: 'app', target: `${OWNER}/${file}`, enabled: true, createdBy: `${OWNER}@${NODE_ID}`, createdAt: now, updatedAt: now });
  }

  async function silent(sub: string, scope: string): Promise<SilentReply> {
    const url = `${base}/v1/auth/app-grant-silent?origin=${encodeURIComponent(`https://${sub}.${APP_HOST}`)}&scope=${encodeURIComponent(scope)}`;
    const res = await fetch(url, { headers: { Cookie: `aimeat_rt=${encodeURIComponent(cookie)}` } });
    return (await res.json() as { data: SilentReply }).data;
  }

  const grantOf = async (file: string) => (await storage.getAppGrantByOwnerAndApp(OWNER, `${OWNER}/${file}`))?.scopes.slice().sort();

  beforeAll(async () => {
    storage = new SqliteStorage(':memory:');
    config = { ...loadConfig().config, nodeId: NODE_ID, appHost: APP_HOST };
    const kp = await generateKeyPair();
    await initNodeKeys(kp.publicKey, kp.privateKey);
    initSessionAuth(storage, config);
    const app = express();
    app.use(express.json());
    app.use(appGrantsRouter(config, storage));
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    config.baseUrl = base;

    const now = new Date(Date.now() - 60_000).toISOString();
    const okp = await generateKeyPair();
    await storage.createOwner({ name: OWNER, displayName: OWNER, publicKey: okp.publicKey, roles: ['owner'], createdAt: now });
    await storage.createGHII({ username: OWNER, nodeId: NODE_ID, ghii: `${OWNER}@${NODE_ID}`, displayName: OWNER, ownerName: OWNER, totpEnabled: false, verificationLevel: 0, createdAt: now, updatedAt: now });
    cookie = randomBytes(32).toString('hex');
    const far = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
    await storage.createOwnerSession({ sessionId: `sess-${randomBytes(8).toString('hex')}`, gaii: `${OWNER}@${NODE_ID}`, owner: OWNER, issuedAt: now, refreshTokenHash: sha256(cookie), idleExpiresAt: far, absoluteExpiresAt: far, lastUsedAt: now });
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    storage.close();
  });

  it('a version another account published asks for the word the grant lacks, and the grant keeps what it had', async () => {
    await site('oacdeleg', 'deleg.html');
    await publish('deleg.html', `${OWNER}@${NODE_ID}`);
    expect((await silent('oacdeleg', 'memory:read')).ok).toBe(true);
    await publish('deleg.html', `bobdev@${NODE_ID}`);
    const r = await silent('oacdeleg', 'memory:read memory:write');
    expect(r).toMatchObject({ ok: false, error: 'consent_required', reason: 'app_updated', why: 'publisher_version', added: 'memory:write', published_by: `bobdev@${NODE_ID}` });
    expect(await grantOf('deleg.html')).toEqual(['memory:read']);
    // What the grant already holds still signs in silently on that version.
    expect((await silent('oacdeleg', 'memory:read')).ok).toBe(true);
  });

  it('a word the owner took away by hand is asked for again, not given back', async () => {
    await site('oacnarrow', 'narrow.html');
    await publish('narrow.html', `${OWNER}@${NODE_ID}`);
    expect((await silent('oacnarrow', 'memory:read memory:write')).ok).toBe(true);
    const g = await storage.getAppGrantByOwnerAndApp(OWNER, `${OWNER}/narrow.html`);
    await storage.updateAppGrant(g!.grantId, { scopes: ['memory:read'], scopesFixedAt: new Date().toISOString() });
    const r = await silent('oacnarrow', 'memory:read memory:write');
    expect(r).toMatchObject({ ok: false, error: 'consent_required', why: 'owner_narrowed', added: 'memory:write' });
    expect(await grantOf('narrow.html')).toEqual(['memory:read']);
  });

  it('designed use: a version the owner, the owner\'s agent, or a publish before the stamp made, adds a word silently', async () => {
    await site('oacown', 'own.html');
    await publish('own.html', `${OWNER}@${NODE_ID}`);
    expect((await silent('oacown', 'memory:read')).ok).toBe(true);
    await publish('own.html', `claude#${OWNER}@${NODE_ID}`);
    const byAgent = await silent('oacown', 'memory:read memory:write');
    expect(byAgent.ok).toBe(true);
    expect(await grantOf('own.html')).toEqual(['memory:read', 'memory:write']);
    await publish('own.html', undefined);
    expect((await silent('oacown', 'memory:read memory:write storage:read')).ok).toBe(true);
    expect(await grantOf('own.html')).toEqual(['memory:read', 'memory:write', 'storage:read']);
  });
});
