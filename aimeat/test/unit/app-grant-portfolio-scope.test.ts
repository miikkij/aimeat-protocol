/**
 * @file app-grant-portfolio-scope.test.ts
 * @description AUDIT H-9: what a token minted for a PORTFOLIO origin is allowed to carry. The silent
 *   SSO bridge (GET /v1/auth/app-grant-silent) used to take the own-app branch for a portfolio and
 *   grant whatever the page asked for, and a portfolio page writes that ask itself: the SDK reads the
 *   FIRST <meta name="aimeat-scopes"> while the node appends its own last, and a page can skip the
 *   SDK and build the /app-silent.html iframe with any ?scope= it likes. The node already publishes
 *   the ceiling for that origin (memory:read) in its protected-resource metadata and in the meta it
 *   injects into every portfolio; these tests hold the bridge to it.
 *
 *   Drives the real appGrantsRouter against real in-memory SQLite, and checks the resulting token at
 *   the real requireScope gate rather than trusting the reply's `scope` string.
 * @structure
 *   - seedPortfolioOwner(): owner + GHII + enabled portfolio config + portfolio HTML + a live session
 *   - silent(): the bridge call the apex page makes, with the session cookie
 *   - describe blocks: the portfolio cap · app targets unaffected · cross-owner · legacy grants
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-grant-portfolio-scope.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-10 — Initial (security audit H-9, step 7c: portfolio silent-grant ceiling).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { appGrantsRouter, PORTFOLIO_GRANT_SCOPES } from '../../src/routes/app-grants.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { initNodeKeys } from '../../src/auth/jwt.js';
import { initSessionAuth, requireAuth, requireScope } from '../../src/auth/middleware.js';
import { PORTFOLIO_HTML_KEY, PORTFOLIO_CONFIG_KEY } from '../../src/routes/portfolio.js';

const NODE_ID = 'aimeat-local-001-dev';
const PORTFOLIO_HOST = 'portfolio.aimeat.test';
const APP_HOST = 'apps.aimeat.test';

/** Everything a portfolio page could name in one ask: the widest request that still passes the
 *  grantable-scope vocabulary, which is what an attacker-controlled meta tag would carry. */
const WIDE_ASK = 'memory:read memory:write memory:delete storage:read storage:write ai:use contract:spend';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** The `scopes` claim actually inside the issued JWT — the reply's `scope` string is only a label. */
function tokenScopes(jwt: string): string[] {
  const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf-8'));
  return payload.scopes as string[];
}

interface SilentReply {
  ok: boolean;
  error?: string;
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  grant_id?: string;
  app?: string;
  own?: boolean;
}

describe('Portfolio silent grants are capped at the published ceiling (H-9)', () => {
  let storage: SqliteStorage;
  let server: http.Server;
  let base: string;
  let config: AimeatConfig;
  const cookies: Record<string, string> = {};

  /** Owner + GHII + an enabled, published portfolio + a live login session (cookie in `cookies`). */
  async function seedPortfolioOwner(username: string, withPortfolio = true): Promise<void> {
    const now = new Date().toISOString();
    const kp = await generateKeyPair();
    await storage.createOwner({ name: username, displayName: username, publicKey: kp.publicKey, roles: ['owner'], createdAt: now });
    await storage.createGHII({
      username, nodeId: NODE_ID, ghii: `${username}@${NODE_ID}`, displayName: username,
      ownerName: username, totpEnabled: false, verificationLevel: 0, createdAt: now, updatedAt: now,
    });
    if (withPortfolio) {
      // No agent on this account, so the portfolio lives under the owner's own GHII.
      const gaii = `${username}@${NODE_ID}`;
      await storage.setMemory({
        key: PORTFOLIO_CONFIG_KEY, ownerGaii: gaii, value: { enabled: true },
        visibility: 'owner', tags: ['portfolio'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
      });
      const html = Buffer.from('<!DOCTYPE html><html><head></head><body>portfolio</body></html>', 'utf-8');
      await storage.createStorageFile({
        key: PORTFOLIO_HTML_KEY, ownerGaii: gaii, visibility: 'public',
        mimeType: 'text/html', size: html.length, data: html, createdAt: now,
      });
    }
    const raw = randomBytes(32).toString('hex');
    const far = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
    await storage.createOwnerSession({
      sessionId: `sess-${randomBytes(8).toString('hex')}`, gaii: `${username}@${NODE_ID}`, owner: username,
      issuedAt: now, refreshTokenHash: sha256(raw), idleExpiresAt: far, absoluteExpiresAt: far, lastUsedAt: now,
    });
    cookies[username] = raw;
  }

  /** The bridge call the apex page makes on behalf of an origin, with that owner's session cookie. */
  async function silent(origin: string, scope: string, asOwner: string | null): Promise<SilentReply> {
    const headers: Record<string, string> = {};
    if (asOwner) headers['Cookie'] = `aimeat_rt=${encodeURIComponent(cookies[asOwner])}`;
    const url = `${base}/v1/auth/app-grant-silent?origin=${encodeURIComponent(origin)}&scope=${encodeURIComponent(scope)}`;
    const res = await fetch(url, { headers });
    const body = await res.json() as { data: SilentReply };
    return body.data;
  }

  beforeAll(async () => {
    storage = new SqliteStorage(':memory:');
    config = {
      ...loadConfig().config, nodeId: NODE_ID,
      appHost: APP_HOST, portfolioHost: PORTFOLIO_HOST, portfolioOriginEnabled: true,
    };
    const kp = await generateKeyPair();
    await initNodeKeys(kp.publicKey, kp.privateKey);
    initSessionAuth(storage, config);

    const app = express();
    app.use(express.json());
    app.use(appGrantsRouter(config, storage));
    // Two probes standing in for the real doors an app token reaches: the scope gate is the thing
    // that decides, so the cap is proven against it rather than against the reply's scope string.
    app.get('/probe/read', requireAuth(), requireScope('memory:read'), (_req, res) => { res.json({ ok: true }); });
    app.get('/probe/write', requireAuth(), requireScope('memory:write'), (_req, res) => { res.json({ ok: true }); });

    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    config.baseUrl = base;

    await seedPortfolioOwner('pfowner');
    await seedPortfolioOwner('pfstranger', false);
    await storage.createSubdomainSite({
      subdomain: 'ownapp', kind: 'app', target: 'pfowner/app-a.html', enabled: true,
      createdBy: `pfowner@${NODE_ID}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    storage.close();
  });

  it('the owner asking wide on their OWN portfolio origin gets memory:read and nothing more', async () => {
    const r = await silent(`https://pfowner.${PORTFOLIO_HOST}`, WIDE_ASK, 'pfowner');
    expect(r.ok).toBe(true);
    expect(r.own).toBe(true);
    expect(r.scope).toBe('memory:read');
    expect(tokenScopes(r.access_token!)).toEqual([...PORTFOLIO_GRANT_SCOPES]);
    // The stored grant is capped too, so the Access tab and every later refresh agree with the token.
    const grant = await storage.getAppGrantByOwnerAndApp('pfowner', 'portfolio:pfowner');
    expect(grant!.scopes).toEqual([...PORTFOLIO_GRANT_SCOPES]);
  });

  it('a portfolio asking for nothing gets the ceiling, not the four-scope app default', async () => {
    const r = await silent(`https://pfowner.${PORTFOLIO_HOST}`, '', 'pfowner');
    expect(r.ok).toBe(true);
    expect(r.scope).toBe('memory:read');
  });

  it('a portfolio asking ONLY for scopes above the ceiling still gets exactly the ceiling', async () => {
    const r = await silent(`https://pfowner.${PORTFOLIO_HOST}`, 'memory:write storage:write', 'pfowner');
    expect(r.ok).toBe(true);
    expect(tokenScopes(r.access_token!)).toEqual([...PORTFOLIO_GRANT_SCOPES]);
  });

  it('the capped token is refused at a memory:write door and accepted at a memory:read door', async () => {
    const r = await silent(`https://pfowner.${PORTFOLIO_HOST}`, WIDE_ASK, 'pfowner');
    const auth = { Authorization: `Bearer ${r.access_token}` };
    expect((await fetch(`${base}/probe/write`, { headers: auth })).status).toBe(403);
    expect((await fetch(`${base}/probe/read`, { headers: auth })).status).toBe(200);
  });

  it('an APP origin is untouched by the cap: the owner\'s own app still gets what it asks for', async () => {
    const r = await silent(`https://ownapp.${APP_HOST}`, 'memory:read memory:write', 'pfowner');
    expect(r.ok).toBe(true);
    expect(tokenScopes(r.access_token!).sort()).toEqual(['memory:read', 'memory:write']);
  });

  it('another owner on someone else\'s portfolio origin gets no token at all', async () => {
    const r = await silent(`https://pfowner.${PORTFOLIO_HOST}`, WIDE_ASK, 'pfstranger');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('consent_required');
    expect(r.access_token).toBeUndefined();
  });

  it('a portfolio grant written before the cap cannot refresh itself back into a wide token', async () => {
    // The shape a pre-H-9 silent call left behind: a live portfolio grant carrying the page's ask.
    const rawRefresh = randomBytes(32).toString('hex');
    const now = new Date().toISOString();
    await storage.createAppGrant({
      grantId: `appgrant-${randomBytes(8).toString('hex')}`, app: 'portfolio:pfstranger',
      appName: "pfstranger's portfolio", appOrigin: `https://pfstranger.${PORTFOLIO_HOST}`,
      owner: 'pfstranger', gaii: `pfstranger@${NODE_ID}`,
      scopes: ['memory:read', 'memory:write', 'storage:write', 'ai:use'],
      refreshTokenHash: sha256(rawRefresh), createdAt: now, lastUsedAt: now, revoked: false,
    });
    const res = await fetch(`${base}/v1/app-grants/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: rawRefresh }),
    });
    const body = await res.json() as { data: { scope: string; access_token: string } };
    expect(res.status).toBe(200);
    expect(body.data.scope).toBe('memory:read');
    expect(tokenScopes(body.data.access_token)).toEqual([...PORTFOLIO_GRANT_SCOPES]);
  });
});
