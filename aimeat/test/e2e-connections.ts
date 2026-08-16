/**
 * @file e2e-connections.ts
 * @description E2E for outbound connections (TARGET-057): the authorization round, the credential
 *   never leaving the node, the delegation gates, and the three failures that only appear under
 *   real conditions.
 *
 *   THE PROVIDER IS A REAL HTTP SERVER, not a mock, and it rotates its refresh token the way real
 *   ones do. That is what makes the concurrency assertions mean anything: against a stub that keeps
 *   returning the same token, the single-flight guard could be deleted without a test going red.
 *
 *   Three assertions here are the reason the suite exists, because each covers a failure that looks
 *   fine on the happy path:
 *     - two overlapping refreshes hit the provider ONCE, and it records zero stale attempts
 *     - a replayed callback produces no second connection
 *     - a repeated publish returns the first attempt's outcome instead of starting a second
 * @structure Phase 0 owners · 1 discovery + capability gate · 2 the round · 3 credential never
 *   leaves · 4 cross-owner 404s · 5 refresh + single flight · 6 revoke · 7 delegations + gates ·
 *   8 idempotency + quota · 9 instance registration · 14 history + reach · 15 spaces (workspace
 *   membership IS the access) · 16 reading numbers back · 17 publishing later
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-connections
 * @version-history
 *   v1.3.0 — 2026-08-17 — E2E quality, connections :945 and :405. Phase 13 ran synthetic principals
 *     through guards the TEST built, which proves the middleware behaves and nothing about which guard
 *     each route mounts; 13b drives the real doors with a real app-grant bearer holding connections:use,
 *     and reads the connection back after the refused DELETE. And the delegated publish path — app_id
 *     plus action, the branch where the one-gesture stop and the per-publisher cap live — had never
 *     been taken by any test: its cap, its stop and its fixed parameters are now enforced against real
 *     publishes, the last of them at the gate because the test provider ignores params.
 *   v1.2.1 — 2026-08-12 — The attach-refusal check probed with the password 'wrong', which the error
 *     envelope's own support hint carries as ordinary prose, so the "secret was not echoed"
 *     assertion failed on a response that had leaked nothing. The probe is a sentinel now.
 *   v1.2.0 — 2026-08-08 — Three guards for the silences a production user actually met: a send that
 *     failed can be sent again (its own dead row used to answer "already sent" forever), the
 *     double-post guard still holds for one that landed, a scheduled fire that published nothing is
 *     reported rather than logged green, and `read-metrics` is advertised only where numbers can come
 *     back.
 *   v1.1.0 — 2026-08-02 — LÄHETIN. Phase 15: a space is an organism workspace — asserts the three
 *     states an app cannot be trusted to draw (outsider refused, ungranted organism member sees an
 *     EMPTY space, grantee sees the content), that one grant opens exactly one workspace, and that a
 *     space grant never lends the grantor's connection. Phase 17: publishing later is a KIND on the
 *     scheduler this node already had, not a second queue — the fire goes through the same
 *     idempotency gate an immediate publish does.
 *   v1.0.0 — 2026-08-02 — TARGET-057 Phase 2.
 */

import { randomBytes, createHash } from 'node:crypto';
import { startFakeProvider, type FakeProvider } from './helpers/fake-oauth-provider.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const FAKE_PORT = Number(new URL(process.env.AIMEAT_CONNECT_FAKE_BASE_URL ?? 'http://127.0.0.1:40388').port);

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: boolean, msg: string): void { if (!cond) throw new Error(msg); }

interface Call { status: number; data: any }
async function api(path: string, opts: { method?: string; body?: any; bearer?: string; redirect?: RequestRedirect } = {}): Promise<Call> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.bearer) headers.Authorization = 'Bearer ' + opts.bearer;
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'POST', headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    redirect: opts.redirect ?? 'manual',
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* redirect or plain text */ }
  return { status: res.status, data };
}

async function registerAndLogin(username: string, password: string): Promise<string> {
  const reg = await api('/v1/ghii', { body: { username, display_name: username, password } });
  assert(reg.status === 201 && reg.data?.ok, `register ${username} failed: ${reg.status}`);
  const login = await api('/v1/ghii/login', { body: { username, password } });
  assert(login.status === 200 && login.data?.ok, `login ${username} failed: ${login.status}`);
  return login.data.data.token;
}

/** Drive one full round and return the connection the node created. */
async function connect(bearer: string, subject: string, mode: 'personal' | 'shared' = 'personal'): Promise<any> {
  const start = await api('/v1/connections/start', { bearer, body: { provider: 'fake', mode, return_url: '/profile#access' } });
  assert(start.status === 200 && start.data?.ok, `start failed: ${start.status} ${start.data?.error?.message}`);
  const state = start.data.data.state as string;
  const res = await fetch(`${BASE}/v1/connections/callback?state=${encodeURIComponent(state)}&code=code-${subject}`, { redirect: 'manual' });
  assert(res.status === 302, `callback did not redirect: ${res.status} ${await res.text()}`);
  const list = await api('/v1/connections', { method: 'GET', bearer });
  return { state, connections: list.data.data.connections as any[] };
}

/**
 * Publish a throwaway app for `owner` and drive the full app-grant flow to a token carrying `scopes`.
 *
 * An app token is role 'app', which is a DIFFERENT principal class from an owner session: it never
 * satisfies a role gate and never receives the owner's scope bypass. Asserting an app's limits with
 * an owner token proves nothing about the app.
 */
async function grantAppToken(ownerBearer: string, owner: string, scopes: string[]): Promise<string> {
  const filename = `lahetin-gate-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.html`;
  const redirect = 'http://localhost:9933/callback';
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  const pub = await api('/v1/apps', {
    bearer: ownerBearer,
    body: {
      filename,
      content: Buffer.from('<!DOCTYPE html><html><body>gate</body></html>', 'utf8').toString('base64'),
      name: 'Gate probe', description: 'app-grant gate probe', category: 'tool',
    },
  });
  assert(pub.status === 201, `publish probe app: ${pub.status} ${pub.data?.error?.message}`);

  const q = new URLSearchParams({
    app: `${owner}/${filename}`, response_type: 'code', scope: scopes.join(' '),
    redirect_uri: redirect, state: 'x', code_challenge: challenge, code_challenge_method: 'S256',
  });
  const auth = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
  assert(auth.status === 302, `authorize: ${auth.status}`);
  const requestId = decodeURIComponent(/req=([^&]+)/.exec(auth.headers.get('location') ?? '')![1]);

  const consent = await api('/v1/app-grants/authorize-consent', {
    bearer: ownerBearer, body: { request_id: requestId },
  });
  assert(consent.status === 200 && consent.data?.ok, `consent: ${consent.status}`);
  const code = new URL(consent.data.data.redirect_url as string).searchParams.get('code') ?? '';

  const tok = await api('/v1/app-grants/token', {
    body: { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect },
  });
  assert(tok.status === 200 && tok.data?.ok, `app token: ${tok.status}`);
  return tok.data.data.access_token as string;
}

async function main(): Promise<void> {
  const stamp = Date.now();
  const pw = 'Conn3ctionPw!';
  const userA = `cxa${stamp}`;
  const userB = `cxb${stamp}`;

  let provider: FakeProvider;
  try {
    provider = await startFakeProvider(FAKE_PORT);
  } catch (err) {
    console.error(`\n  Could not start the fake provider on :${FAKE_PORT} — ${(err as Error).message}`);
    process.exit(1);
  }

  let jwtA = '', jwtB = '';
  let connA = '';

  try {
    console.log('\nPhase 0 — Owners');
    await test('register + login two owners', async () => {
      jwtA = await registerAndLogin(userA, pw);
      jwtB = await registerAndLogin(userB, pw);
      assert(!!jwtA && !!jwtB, 'no tokens');
    });

    console.log('\nPhase 1 — Discovery');
    await test('the test provider is offered when configured', async () => {
      const r = await api('/v1/connections/providers', { method: 'GET', bearer: jwtA });
      assert(r.status === 200, `status ${r.status}`);
      const ids = (r.data.data.providers as any[]).map(p => p.id);
      assert(ids.includes('fake'), `fake provider absent: ${ids.join(',')}`);
    });
    await test('a provider with no client credentials is not advertised, and says why', async () => {
      // Built in-process with an EMPTY config rather than asserted against the running node's
      // provider list. The earlier version of this test checked that YouTube was absent from
      // discovery, which passed only on a machine with no Google credentials in .env and started
      // failing the moment the developer added theirs — an assertion about the environment wearing
      // the costume of an assertion about the gate. Same family as the OAuth-login e2e that
      // 302s instead of 503ing when a local Google client happens to be configured.
      const { buildOutboundProviders, listProviderMeta, findProvider } = await import('../src/services/connections/providers.js');
      const bare = buildOutboundProviders({
        connectionsEnabled: true, connectGoogleClientId: '', connectGoogleClientSecret: '',
        connectRedirectUri: '', connectFakeBaseUrl: '',
      } as any);
      // The contract CHANGED when principals could bring their own app: a provider the node has no
      // client for is still advertised, marked as not node-configured, because hiding it would let
      // an operator decision to skip registering an app silently remove a choice from every user.
      // What must NOT change is that it stays unusable to anyone who has not brought one.
      const meta = listProviderMeta(bare).find(p => p.id === 'youtube');
      assert(meta !== undefined, 'youtube missing from discovery entirely');
      assert(meta!.nodeConfigured === false, 'youtube claims the node has a client for it');
      const yt = findProvider(bare, 'youtube');
      assert(yt?.enabled === false, 'youtube enabled with no client credentials');
      // The reason travels with the refusal: "disabled" alone leaves an operator nothing to act on.
      assert(/CLIENT_ID/.test(yt?.disabledReason ?? ''), `unhelpful reason: ${yt?.disabledReason}`);
    });
    await test('the whole capability off means nothing is advertised at all', async () => {
      const { buildOutboundProviders, listProviderMeta } = await import('../src/services/connections/providers.js');
      const off = buildOutboundProviders({
        connectionsEnabled: false, connectGoogleClientId: 'id', connectGoogleClientSecret: 'secret',
        connectRedirectUri: '', connectFakeBaseUrl: 'http://127.0.0.1:1',
      } as any);
      assert(listProviderMeta(off).length === 0, 'providers advertised while the capability is off');
    });
    await test('discovery never leaks a client secret', async () => {
      const r = await api('/v1/connections/providers', { method: 'GET', bearer: jwtA });
      assert(!JSON.stringify(r.data).includes('fake-secret'), 'client secret present in discovery');
    });
    await test('an unknown provider is 404, a bad instance is 400', async () => {
      const unknown = await api('/v1/connections/start', { bearer: jwtA, body: { provider: 'nope' } });
      assert(unknown.status === 404, `unknown provider: ${unknown.status}`);
      const bad = await api('/v1/connections/start', { bearer: jwtA, body: { provider: 'mastodon', instance: 'http://127.0.0.1' } });
      assert(bad.status === 400 && bad.data?.error?.code === 'BAD_INSTANCE', `bad instance: ${bad.status} ${bad.data?.error?.code}`);
    });

    console.log('\nPhase 2 — The authorization round');
    await test('a full round creates one connection with the provider-supplied label', async () => {
      const { connections } = await connect(jwtA, 'alpha');
      assert(connections.length === 1, `expected 1 connection, got ${connections.length}`);
      assert(connections[0].accountLabel === 'Test account alpha',
        `label came from somewhere else: ${connections[0].accountLabel}`);
      assert(connections[0].status === 'active', `status ${connections[0].status}`);
      connA = connections[0].id;
    });
    await test('the node sent a PKCE verifier it never put in the URL', async () => {
      // The provider refuses an exchange without code_verifier, so a successful round above IS the
      // proof that the node kept one and sent it.
      assert(provider.stats.tokenExchanges >= 1, 'no exchange reached the provider');
    });
    await test('re-authorising the same account UPDATES rather than duplicating', async () => {
      const { connections } = await connect(jwtA, 'alpha');
      assert(connections.length === 1, `re-auth created a duplicate: ${connections.length} connections`);
    });
    await test('a second account at the same provider is a second connection', async () => {
      const { connections } = await connect(jwtA, 'beta');
      assert(connections.length === 2, `expected 2, got ${connections.length}`);
    });
    await test('a replayed callback creates nothing', async () => {
      const start = await api('/v1/connections/start', { bearer: jwtA, body: { provider: 'fake' } });
      const state = start.data.data.state as string;
      const first = await fetch(`${BASE}/v1/connections/callback?state=${state}&code=code-gamma`, { redirect: 'manual' });
      assert(first.status === 302, `first callback: ${first.status}`);
      const before = (await api('/v1/connections', { method: 'GET', bearer: jwtA })).data.data.connections.length;
      const replay = await fetch(`${BASE}/v1/connections/callback?state=${state}&code=code-gamma`, { redirect: 'manual' });
      assert(replay.status === 400, `a replayed state was accepted: ${replay.status}`);
      const after = (await api('/v1/connections', { method: 'GET', bearer: jwtA })).data.data.connections.length;
      assert(before === after, `replay created a connection: ${before} → ${after}`);
    });
    await test('a state nobody started is refused', async () => {
      const r = await fetch(`${BASE}/v1/connections/callback?state=made-up&code=code-x`, { redirect: 'manual' });
      assert(r.status === 400, `status ${r.status}`);
    });

    console.log('\nPhase 3 — The credential never leaves');
    await test('no response carries a token, a refresh token or ciphertext', async () => {
      const list = await api('/v1/connections', { method: 'GET', bearer: jwtA });
      const blob = JSON.stringify(list.data);
      assert(!/\bat-[0-9a-f]{8}/.test(blob), 'an access token appeared in a response');
      assert(!/\brt-[0-9a-f]{8}/.test(blob), 'a refresh token appeared in a response');
      assert(!blob.includes('credential'), 'the credential field was projected');
      assert(!blob.includes('scopes'), 'provider scopes were projected to the caller');
    });

    console.log('\nPhase 4 — Absent and not-yours answer the same');
    await test("owner B cannot see owner A's connections", async () => {
      const r = await api('/v1/connections', { method: 'GET', bearer: jwtB });
      assert(r.data.data.connections.length === 0, "B saw A's connections");
    });
    await test("owner B revoking A's connection is 404, identical to a missing one", async () => {
      const notYours = await api(`/v1/connections/${connA}`, { method: 'DELETE', bearer: jwtB });
      const missing = await api('/v1/connections/00000000-0000-0000-0000-000000000000', { method: 'DELETE', bearer: jwtB });
      assert(notYours.status === 404 && missing.status === 404, `${notYours.status} / ${missing.status}`);
      assert(JSON.stringify(notYours.data.error) === JSON.stringify(missing.data.error),
        'the two 404s differ, which enumerates other people\'s connections');
    });
    await test("A's connection survived B's attempt", async () => {
      const r = await api('/v1/connections', { method: 'GET', bearer: jwtA });
      assert((r.data.data.connections as any[]).some(c => c.id === connA), 'the connection was removed by a stranger');
    });

    console.log('\nPhase 5 — Refresh, and the concurrency it must survive');
    // Driven through the SERVICE rather than over HTTP, because the guard lives there and no route
    // refreshes as a side effect. An earlier version of this phase called the listing endpoint
    // twice and asserted that no stale refresh happened — which passed because nothing refreshed at
    // all. A test that cannot fail is not evidence.
    await test('two concurrent refreshes hit the provider ONCE and never present a retired token', async () => {
      const { ensureFreshCredential } = await import('../src/services/connections/refresh.js');
      const { sealCredential } = await import('../src/services/connections/credential.js');
      const { buildOutboundProviders } = await import('../src/services/connections/providers.js');
      const { SqliteStorage } = await import('../src/storage/providers/sqlite/index.js');

      const key = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');
      const cfg = {
        nodeId: 'test', baseUrl: BASE, connectionsEnabled: true,
        connectGoogleClientId: '', connectGoogleClientSecret: '', connectRedirectUri: '',
        connectFakeBaseUrl: provider.baseUrl,
      } as any;
      const storage = new SqliteStorage(':memory:');
      const ctx = { config: cfg, storage: storage as any, providers: buildOutboundProviders(cfg), key };

      // A real grant from the real provider, so the refresh token is one it will actually rotate.
      const form = new URLSearchParams({
        grant_type: 'authorization_code', code: 'code-racer', code_verifier: 'v',
        client_id: 'fake-client', client_secret: 'fake-secret', redirect_uri: `${BASE}/v1/connections/callback`,
      });
      const tok = await (await fetch(`${provider.baseUrl}/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString(),
      })).json() as any;

      const now = new Date().toISOString();
      await storage.createConnection({
        id: 'race-1', principal: 'racer@test', mode: 'personal', provider: 'fake', instance: null,
        accountLabel: 'Racer', externalId: 'racer',
        credential: sealCredential({ shape: 'oauth2', accessToken: tok.access_token, refreshToken: tok.refresh_token }, key),
        credentialShape: 'oauth2', scopes: ['publish'],
        // Already inside the refresh skew, so BOTH callers want a refresh.
        expiresAt: new Date(Date.now() + 1000).toISOString(),
        status: 'active', lastOkAt: now, lastError: null, createdAt: now, updatedAt: now,
      });

      // The delay is what creates a genuine overlap: without it the first caller can finish before
      // the second starts, and the race never happens.
      provider.refreshDelayMs = 400;
      const before = provider.stats.refreshes;
      const beforeStale = provider.stats.staleRefreshAttempts;

      const [a, b] = await Promise.all([
        ensureFreshCredential(ctx, 'race-1'),
        ensureFreshCredential(ctx, 'race-1'),
      ]);
      provider.refreshDelayMs = 0;

      assert(a.ok && b.ok, `a caller failed: ${JSON.stringify([a, b])}`);
      // Exactly one. Two would mean both refreshed, which is the failure the guard exists for.
      assert(provider.stats.refreshes === before + 1,
        `expected 1 refresh, the provider performed ${provider.stats.refreshes - before}`);
      assert(provider.stats.staleRefreshAttempts === beforeStale,
        `the provider was handed an already-retired refresh token ${provider.stats.staleRefreshAttempts - beforeStale} time(s)`);
      // Both callers must end up with the SAME live token; the loser reads the winner's result
      // rather than carrying the one that was just retired.
      assert(a.ok && b.ok && a.credential.accessToken === b.credential.accessToken,
        'the two callers hold different tokens, so one of them is retired');
      storage.close();
    });

    await test('a dead grant parks the connection in needs_reauth rather than retrying forever', async () => {
      const { ensureFreshCredential } = await import('../src/services/connections/refresh.js');
      const { sealCredential } = await import('../src/services/connections/credential.js');
      const { buildOutboundProviders } = await import('../src/services/connections/providers.js');
      const { SqliteStorage } = await import('../src/storage/providers/sqlite/index.js');

      const key = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');
      const cfg = { nodeId: 'test', baseUrl: BASE, connectionsEnabled: true, connectGoogleClientId: '', connectGoogleClientSecret: '', connectRedirectUri: '', connectFakeBaseUrl: provider.baseUrl } as any;
      const storage = new SqliteStorage(':memory:');
      const ctx = { config: cfg, storage: storage as any, providers: buildOutboundProviders(cfg), key };
      const now = new Date().toISOString();
      await storage.createConnection({
        id: 'dead-1', principal: 'dead@test', mode: 'personal', provider: 'fake', instance: null,
        accountLabel: 'Dead', externalId: 'dead',
        credential: sealCredential({ shape: 'oauth2', accessToken: 'at-x', refreshToken: 'rt-gone' }, key),
        credentialShape: 'oauth2', scopes: [], expiresAt: new Date(Date.now() + 1000).toISOString(),
        status: 'active', lastOkAt: now, lastError: null, createdAt: now, updatedAt: now,
      });
      provider.breakRefresh = true;
      const r = await ensureFreshCredential(ctx, 'dead-1');
      provider.breakRefresh = false;
      assert(!r.ok && r.code === 'NEEDS_REAUTH', `expected NEEDS_REAUTH, got ${JSON.stringify(r)}`);
      const parked = await storage.getConnection('dead-1');
      assert(parked?.status === 'needs_reauth', `status is ${parked?.status}`);
      assert(!!parked?.lastError, 'no reason was recorded for the owner');
      storage.close();
    });

    console.log('\nPhase 6 — Revoking means revoking');
    await test('revoke tells the provider and removes locally', async () => {
      const { connections } = await connect(jwtB, 'bravo');
      const id = connections[0].id;
      const beforeRevocations = provider.stats.revocations;
      const r = await api(`/v1/connections/${id}`, { method: 'DELETE', bearer: jwtB });
      assert(r.status === 200 && r.data.data.revoked === true, `revoke: ${r.status}`);
      assert(r.data.data.told_provider === true, 'the provider was not told');
      assert(provider.stats.revocations === beforeRevocations + 1, 'the provider recorded no revocation');
      const after = await api('/v1/connections', { method: 'GET', bearer: jwtB });
      assert(after.data.data.connections.length === 0, 'the connection survived its own revocation');
    });

    console.log('\nPhase 7 — Delegations');
    let sharedId = '', delId = '';
    await test('a shared channel accepts a delegation; a personal connection does not', async () => {
      const shared = await connect(jwtA, 'channel', 'shared');
      sharedId = (shared.connections as any[]).find(c => c.mode === 'shared').id;
      const personalId = connA;
      const refused = await api(`/v1/connections/${personalId}/delegations`, {
        bearer: jwtA, body: { app_id: 'app:x', action: 'publish-video' },
      });
      assert(refused.status === 400 && refused.data.error.code === 'NOT_A_SHARED_CHANNEL',
        `personal connection accepted a delegation: ${refused.status}`);
      const ok = await api(`/v1/connections/${sharedId}/delegations`, {
        bearer: jwtA,
        body: {
          app_id: 'app:funvids', action: 'publish-video',
          fixed: { visibility: 'unlisted' }, per_user_limit: { count: 2, window_hours: 24 },
          moderation: 'auto',
        },
      });
      assert(ok.status === 201, `delegation create: ${ok.status} ${ok.data?.error?.message}`);
      delId = ok.data.data.delegation.id;
    });
    await test('an action the provider does not have is refused by name', async () => {
      const r = await api(`/v1/connections/${sharedId}/delegations`, {
        bearer: jwtA, body: { app_id: 'app:x', action: 'launch-rocket' },
      });
      assert(r.status === 400 && r.data.error.code === 'UNKNOWN_ACTION', `${r.status} ${r.data?.error?.code}`);
    });
    await test('the one-gesture stop flips and flips back', async () => {
      const off = await api(`/v1/connections/delegations/${delId}`, { method: 'PATCH', bearer: jwtA, body: { enabled: false } });
      assert(off.status === 200 && off.data.data.delegation.enabled === false, `disable: ${off.status}`);
      const on = await api(`/v1/connections/delegations/${delId}`, { method: 'PATCH', bearer: jwtA, body: { enabled: true } });
      assert(on.status === 200 && on.data.data.delegation.enabled === true, `enable: ${on.status}`);
    });
    await test("owner B cannot touch A's delegation", async () => {
      const r = await api(`/v1/connections/delegations/${delId}`, { method: 'PATCH', bearer: jwtB, body: { enabled: false } });
      assert(r.status === 404, `status ${r.status}`);
      const still = await api(`/v1/connections/delegations/${delId}/quota`, { method: 'GET', bearer: jwtA });
      assert(still.status === 200, 'A lost access to their own delegation');
    });

    console.log('\nPhase 8 — Quota is readable before it bites');
    await test('quota reports the window and the per-user limit', async () => {
      const r = await api(`/v1/connections/delegations/${delId}/quota`, { method: 'GET', bearer: jwtA });
      assert(r.status === 200, `status ${r.status}`);
      assert(r.data.data.quota.windowHours === 24, 'window missing');
      // null for the TEST provider specifically: it has no published allowance to state. A real
      // provider's ceiling belongs in its descriptor once it has been READ rather than guessed —
      // see the YouTube assertion below.
      assert(r.data.data.quota.limit === null, `limit should be unmeasured, got ${r.data.data.quota.limit}`);
      assert(r.data.data.per_user_limit?.count === 2, 'per-user limit not reported');
    });

    await test('YouTube\'s shared ceiling is the measured one, not the one the console shows', async () => {
      // Six, from the project's own quota page: a 10,000-unit daily budget, 1,600 units per upload.
      // That same page advertises "Video Uploads per day: 100", which is NOT the binding limit and
      // is wrong by a factor of sixteen — so this asserts the number that actually holds, and would
      // go red if someone later replaced it with the one that looks right.
      const { buildOutboundProviders, findProvider } = await import('../src/services/connections/providers.js');
      const list = buildOutboundProviders({
        connectionsEnabled: true, connectGoogleClientId: 'id', connectGoogleClientSecret: 'secret',
        connectRedirectUri: '', connectFakeBaseUrl: '',
      } as any);
      const yt = findProvider(list, 'youtube');
      assert(yt?.sharedDailyLimit === 6, `expected 6, got ${yt?.sharedDailyLimit}`);
    });

    console.log('\nPhase 9 — Lazy per-instance registration');
    await test('the node registers at an instance once and reuses it', async () => {
      // Driven against the fake provider's Mastodon-shaped endpoint. The normaliser refuses IP
      // literals, so the full browser round for an instance-scoped provider is proven in phase 4
      // against a real Mastodon; what is proven HERE is the registration + convergence over a real
      // network call.
      const { registerAtInstance } = await import('../src/services/connections/instance.js');
      const { SqliteStorage } = await import('../src/storage/providers/sqlite/index.js');
      const storage = new SqliteStorage(':memory:');
      const key = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');
      const app = { name: 'AIMEAT', redirectUri: `${BASE}/v1/connections/callback`, scopes: ['write'], website: BASE };
      const first = await registerAtInstance(storage as any, key, 'mastodon', provider.baseUrl, app);
      assert(!('error' in first), `first registration failed: ${JSON.stringify(first)}`);
      const second = await registerAtInstance(storage as any, key, 'mastodon', provider.baseUrl, app);
      assert(!('error' in second), 'second registration failed');
      assert((first as any).clientId === (second as any).clientId,
        'the second user registered again instead of reusing the first registration');
      storage.close();
    });

    console.log('\nPhase 10 — Supplied credentials (no authorization round)');
    await test('every advertised provider can actually be connected somehow', async () => {
      // The check that would have caught Bluesky being listed with no route: a provider offered in
      // discovery must have EITHER an authorization round or a set of attach fields. Advertising
      // one with neither is a Connect button that cannot work.
      const r = await api('/v1/connections/providers', { method: 'GET', bearer: jwtA });
      const bad = (r.data.data.providers as any[]).filter(p =>
        p.credentialShape === 'oauth2' ? false : !Array.isArray(p.attachFields) || p.attachFields.length === 0);
      assert(bad.length === 0, `advertised but unconnectable: ${bad.map(p => p.id).join(', ')}`);
    });
    await test('every capability a provider advertises has a recipe behind it', async () => {
      // The OTHER half of the Bluesky bug. A provider can be perfectly connectable and still list a
      // capability nothing implements, which fails at publish time -- after the account is linked,
      // the file is uploaded and the user believes it worked. Checked against the registry with
      // every provider configured, so it does not depend on which keys this machine happens to have.
      const { buildOutboundProviders } = await import('../src/services/connections/providers.js');
      const { RECIPES_FOR_TEST } = await import('../src/services/connections/publish.js');
      const all = buildOutboundProviders({
        connectionsEnabled: true,
        connectGoogleClientId: 'x', connectGoogleClientSecret: 'x',
        connectLinkedinClientId: 'x', connectLinkedinClientSecret: 'x',
        connectFakeBaseUrl: '', connectRedirectUri: 'https://example.test/cb',
      } as any);
      const missing = all.filter(p => p.capabilities.length > 0 && !RECIPES_FOR_TEST[p.id]);
      assert(missing.length === 0, `advertises a capability with no recipe: ${missing.map(p => p.id).join(', ')}`);
    });

    await test('LinkedIn is offered once its keys are present, and is shaped for its own flow', async () => {
      const { buildOutboundProviders, findProvider } = await import('../src/services/connections/providers.js');
      const withKeys = buildOutboundProviders({
        connectionsEnabled: true,
        connectGoogleClientId: '', connectGoogleClientSecret: '',
        connectLinkedinClientId: 'id', connectLinkedinClientSecret: 'secret',
        connectFakeBaseUrl: '', connectRedirectUri: 'https://example.test/cb',
      } as any);
      const li = findProvider(withKeys, 'linkedin');
      assert(li !== null && li.enabled, 'LinkedIn is not offered even with credentials');
      assert(li!.credentialShape === 'oauth2', `shape ${li!.credentialShape}`);
      assert(typeof li!.endpoints(null).authorize === 'string', 'no authorize endpoint');
      // NOT a detail: LinkedIn does not document a code_challenge, and sending one fails at consent.
      assert(li!.pkce === false, 'LinkedIn must not be asked for PKCE');
      // The YouTube lesson: asking for the write scope alone and then reading identity is a 403.
      assert(li!.scopes.includes('openid') && li!.scopes.includes('w_member_social'),
        `scopes ${li!.scopes.join(' ')}`);
      // It must NOT claim video, because the recipe refuses video on purpose.
      assert(!li!.capabilities.includes('publish-video'), 'LinkedIn claims video it cannot do');

      const without = buildOutboundProviders({
        connectionsEnabled: true,
        connectGoogleClientId: '', connectGoogleClientSecret: '',
        connectLinkedinClientId: '', connectLinkedinClientSecret: '',
        connectFakeBaseUrl: '', connectRedirectUri: 'https://example.test/cb',
      } as any);
      const off = findProvider(without, 'linkedin');
      assert(off !== null && !off.enabled && (off.disabledReason ?? '').includes('LINKEDIN'),
        'with no keys LinkedIn should be present but disabled, saying which keys are missing');
    });

    await test('the client secret goes where each provider wants it, and only there', async () => {
      // The trap this exists for: X requires HTTP Basic and answers a body-carried secret with a 401
      // that names nothing. Both halves are checked, because sending the secret in BOTH places is
      // the "fix" that appears to work and quietly leaks the secret into a form body.
      const { tokenRequest } = await import('../src/services/connections/providers.js');
      const client = { clientId: 'the-id', clientSecret: 'the-secret' };

      const basic = tokenRequest({ tokenAuth: 'basic' } as any, client, { grant_type: 'refresh_token' });
      assert(typeof basic.headers.Authorization === 'string', 'a basic provider got no Authorization header');
      const decoded = Buffer.from(basic.headers.Authorization.replace('Basic ', ''), 'base64').toString();
      assert(decoded === 'the-id:the-secret', `header decoded to ${decoded}`);
      assert(!basic.body.includes('the-secret'), 'the secret was ALSO put in the body');
      assert(basic.body.includes('client_id=the-id'), 'client_id must still be in the body');

      const body = tokenRequest({ tokenAuth: 'body' } as any, client, { grant_type: 'refresh_token' });
      assert(body.headers.Authorization === undefined, 'a body provider got an Authorization header');
      assert(body.body.includes('client_secret=the-secret'), 'the secret is missing from the body');
    });

    await test('X is shaped for its own flow once its keys are present', async () => {
      const { buildOutboundProviders, findProvider } = await import('../src/services/connections/providers.js');
      const withKeys = buildOutboundProviders({
        connectionsEnabled: true,
        connectGoogleClientId: '', connectGoogleClientSecret: '',
        connectLinkedinClientId: '', connectLinkedinClientSecret: '',
        connectXClientId: 'id', connectXClientSecret: 'secret',
        connectFakeBaseUrl: '', connectRedirectUri: 'https://example.test/cb',
      } as any);
      const px = findProvider(withKeys, 'x');
      assert(px !== null && px.enabled, 'X is not offered even with credentials');
      assert(px!.pkce === true, 'X requires PKCE');
      assert(px!.tokenAuth === 'basic', 'X must authenticate at the token endpoint with Basic');
      // Without offline.access X issues no refresh token and the connection dies in two hours,
      // silently -- the same shape as Google's access_type=offline.
      assert(px!.scopes.includes('offline.access'), 'X without offline.access cannot renew');
      assert(px!.scopes.includes('users.read'), 'X needs users.read to know whose account this is');
      assert(!px!.capabilities.includes('publish-video'), 'X claims video it cannot do');
    });

    await test('a supplied credential connects the account', async () => {
      const before = provider.stats.sessionMints;
      const r = await api('/v1/connections/attach', {
        bearer: jwtA,
        body: { provider: 'fake-static', fields: { identifier: 'someone', password: 'good-secret' } },
      });
      assert(r.status === 201, `attach: ${r.status} ${r.data?.error?.message}`);
      assert(r.data.data.connection.accountLabel === '@someone', `label ${r.data.data.connection.accountLabel}`);
      assert(provider.stats.sessionMints === before + 1, 'the provider minted no session');
    });
    await test('the supplied secret is never echoed back', async () => {
      const list = await api('/v1/connections', { method: 'GET', bearer: jwtA });
      assert(!JSON.stringify(list.data).includes('good-secret'), 'the secret appeared in a response');
    });
    await test('a wrong secret is refused with something the user can act on', async () => {
      // The rejected secret is a sentinel, not a word. It used to be 'wrong', which the error
      // envelope's own support hint contains as ordinary prose ("subject":"What went wrong"), so
      // the echo check failed on a response that had leaked nothing. A value that cannot occur in
      // English is what makes the assertion mean what it says.
      const badSecret = 'zzq-not-the-secret-8f3a1c';
      const r = await api('/v1/connections/attach', {
        bearer: jwtA,
        body: { provider: 'fake-static', fields: { identifier: 'someone', password: badSecret } },
      });
      assert(r.status === 400 && r.data.error.code === 'ATTACH_FAILED', `${r.status} ${r.data?.error?.code}`);
      assert(!JSON.stringify(r.data).includes(badSecret), 'the rejected secret was echoed in the error');
    });
    await test('a missing field is named, not swallowed', async () => {
      const r = await api('/v1/connections/attach', {
        bearer: jwtA, body: { provider: 'fake-static', fields: { identifier: 'someone' } },
      });
      assert(r.status === 400 && r.data.error.code === 'MISSING_FIELD', `${r.status} ${r.data?.error?.code}`);
    });
    await test('an OAuth provider refuses to be attached, and vice versa', async () => {
      // The two paths must not overlap: attaching an OAuth provider would skip its consent screen.
      const wrongWay = await api('/v1/connections/attach', {
        bearer: jwtA, body: { provider: 'fake', fields: { identifier: 'x', password: 'y' } },
      });
      assert(wrongWay.status === 400 && wrongWay.data.error.code === 'NEEDS_AUTHORIZATION',
        `attach accepted an OAuth provider: ${wrongWay.status} ${wrongWay.data?.error?.code}`);
      const otherWay = await api('/v1/connections/start', { bearer: jwtA, body: { provider: 'fake-static' } });
      assert(otherWay.status === 400 && otherWay.data.error.code === 'NOT_AN_OAUTH_PROVIDER',
        `start accepted a supplied-credential provider: ${otherWay.status}`);
    });
    await test('a dead session is re-minted from the stored secret, without asking again', async () => {
      const { ensureFreshCredential } = await import('../src/services/connections/refresh.js');
      const { sealCredential } = await import('../src/services/connections/credential.js');
      const { buildOutboundProviders } = await import('../src/services/connections/providers.js');
      const { SqliteStorage } = await import('../src/storage/providers/sqlite/index.js');
      const key = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');
      const cfg = { nodeId: 'test', baseUrl: BASE, connectionsEnabled: true, connectGoogleClientId: '', connectGoogleClientSecret: '', connectRedirectUri: '', connectFakeBaseUrl: provider.baseUrl } as any;
      const storage = new SqliteStorage(':memory:');
      const ctx = { config: cfg, storage: storage as any, providers: buildOutboundProviders(cfg), key };
      const now = new Date().toISOString();
      await storage.createConnection({
        id: 'sess-1', principal: 'sess@test', mode: 'personal', provider: 'fake-static', instance: null,
        accountLabel: '@someone', externalId: 'did:test:someone',
        // A session whose refresh token is already dead, but whose secret still works. This is the
        // case the ordering fix exists for: checking for a refresh token first would park it.
        credential: sealCredential({
          shape: 'session', accessToken: 'at-dead', refreshToken: 'rt-dead',
          extra: { appPassword: 'good-secret', identifier: 'someone', pds: provider.baseUrl, did: 'did:test:someone' },
        }, key),
        credentialShape: 'session', scopes: [],
        expiresAt: new Date(Date.now() + 1000).toISOString(),
        status: 'active', lastOkAt: now, lastError: null, createdAt: now, updatedAt: now,
      });
      const before = provider.stats.sessionMints;
      const r = await ensureFreshCredential(ctx, 'sess-1');
      assert(r.ok, `re-mint failed: ${JSON.stringify(r)}`);
      assert(provider.stats.sessionMints === before + 1, 'no new session was minted from the stored secret');
      const healed = await storage.getConnection('sess-1');
      assert(healed?.status === 'active', `status ${healed?.status}`);
      storage.close();
    });

    console.log('\nPhase 11 — Publishing');
    // Against the test provider's publish endpoint, so the whole route -- gate, credential, recipe,
    // outcome, attempt update -- is exercised without posting to anyone's real account.
    let pubConn = '';
    await test('a publish reaches the provider and records where it landed', async () => {
      const fresh = await connect(jwtA, 'publisher');
      pubConn = (fresh.connections as any[]).find(c => c.accountLabel === 'Test account publisher').id;
      // A stored file, because a publish carries bytes.
      const put = await api('/v1/storage', {
        bearer: jwtA,
        body: {
          key: 'vid/test.mp4', visibility: 'private', mime_type: 'video/mp4',
          data: Buffer.from('not really a video, but real bytes').toString('base64'),
        },
      });
      assert(put.status === 200 || put.status === 201, `storage put: ${put.status} ${put.data?.error?.message}`);

      const before = provider.stats.publishes;
      const r = await api('/v1/connections/publish', {
        bearer: jwtA,
        body: { connection_id: pubConn, storage_key: 'vid/test.mp4', caption: 'hello from the e2e' },
      });
      assert(r.status === 200, `publish: ${r.status} ${r.data?.error?.message}`);
      assert(provider.stats.publishes === before + 1, 'the provider recorded no publish');
      assert(typeof r.data.data.url === 'string' && r.data.data.url.length > 0, 'no url came back');
      assert(r.data.data.attempt.status === 'done', `attempt status ${r.data.data.attempt.status}`);
      assert(r.data.data.attempt.externalRef === r.data.data.url, 'the attempt does not carry where it landed');
      assert(provider.stats.lastPublishBytes > 0, 'the provider received no bytes');
    });

    await test('the same publish twice reaches the provider ONCE', async () => {
      // The double-post this whole mechanism exists to prevent, through the real route.
      const before = provider.stats.publishes;
      const r = await api('/v1/connections/publish', {
        bearer: jwtA,
        body: { connection_id: pubConn, storage_key: 'vid/test.mp4', caption: 'hello from the e2e' },
      });
      assert(r.status === 200, `replay: ${r.status}`);
      assert(r.data.data.replay === true, 'the repeat was not recognised as a replay');
      assert(provider.stats.publishes === before, `the provider was asked to publish ${provider.stats.publishes - before} more time(s)`);
    });

    await test('a refused CONTENT is rejected permanently, not retried', async () => {
      provider.rejectContent = true;
      const r = await api('/v1/connections/publish', {
        bearer: jwtA,
        body: { connection_id: pubConn, storage_key: 'vid/test.mp4', caption: 'a different caption entirely' },
      });
      provider.rejectContent = false;
      assert(r.status === 502 && r.data.error.code === 'REJECTED', `${r.status} ${r.data?.error?.code}`);
      // 'rejected' is the status that must never be retried; 'failed' would be.
      const attempts = await api(`/v1/connections`, { method: 'GET', bearer: jwtA });
      assert(attempts.status === 200, 'listing broke after a rejection');
    });

    await test('a send that failed can be sent again — it is not its own permanent blocker', async () => {
      // FOUND IN PRODUCTION. The idempotency key is derived from the message, so a caption that
      // failed once collided with its own dead row forever: every retry was answered "already sent"
      // and pointed at an attempt that had reached nobody. LÄHETIN drew that as an orange
      // "already sent — the original result:" followed by nothing, and there was no way out of it
      // from the app. The guard exists to prevent a DOUBLE post, and a row that published nothing
      // cannot become one.
      const caption = 'a caption that fails once and must be sendable afterwards';

      provider.rejectContent = true;
      const first = await api('/v1/connections/publish', {
        bearer: jwtA, body: { connection_id: pubConn, storage_key: 'vid/test.mp4', caption },
      });
      provider.rejectContent = false;
      assert(first.status === 502, `the first send should have failed: ${first.status}`);

      const before = provider.stats.publishes;
      const again = await api('/v1/connections/publish', {
        bearer: jwtA, body: { connection_id: pubConn, storage_key: 'vid/test.mp4', caption },
      });
      assert(again.status === 200, `the retry was refused: ${again.status} ${again.data?.error?.message}`);
      assert(again.data.data.replay === false,
        'the retry of a FAILED send was answered as a replay, which is the production bug');
      assert(provider.stats.publishes === before + 1,
        `the retry never reached the provider (${provider.stats.publishes - before} publishes)`);
      assert(again.data.data.attempt.status === 'done', `retry status ${again.data.data.attempt.status}`);
      assert(!again.data.data.attempt.error, 'the reopened attempt still carries the old error');
    });

    await test('and that reopening did not weaken the double-post guard', async () => {
      // The other half: the SAME message, now that it has actually landed, must still be refused.
      // Without this the previous test would pass just as happily against a gate that was deleted.
      const caption = 'a caption that fails once and must be sendable afterwards';
      const before = provider.stats.publishes;
      const r = await api('/v1/connections/publish', {
        bearer: jwtA, body: { connection_id: pubConn, storage_key: 'vid/test.mp4', caption },
      });
      assert(r.status === 200, `${r.status}`);
      assert(r.data.data.replay === true, 'a message that DID land was published a second time');
      assert(provider.stats.publishes === before, 'the provider was asked to publish a landed message again');
    });

    await test("publishing to someone else's connection is the same 404 as a missing one", async () => {
      // NO storage_key, deliberately. This test used to send one, and B owns no such file — so the
      // route answered 404 for the FILE before the ownership check was ever reached, and the test
      // stayed green with that check deleted. It asserted the right number for the wrong reason.
      const r = await api('/v1/connections/publish', {
        bearer: jwtB,
        body: { connection_id: pubConn, caption: 'not mine' },
      });
      assert(r.status === 404, `status ${r.status}`);
    });

    /**
     * THE DELEGATED PUBLISH PATH, which nothing in this file has ever taken. Every publish here sends
     * a connection_id, which is the owner's own channel; the route's OTHER branch takes app_id plus
     * action and goes through the delegation gate instead. That gate is where the one-gesture stop
     * and the per-publisher cap live, and Phase 7 asserts both of them by reading the record back
     * rather than by trying to publish past them.
     *
     * The delegation from Phase 7 is app:funvids / publish-video on the shared channel, with a
     * per-user limit of 2 in 24 hours.
     */
    await test('a delegated publish goes through, and the per-publisher cap stops the third', async () => {
      const publish = (caption: string) => api('/v1/connections/publish', {
        bearer: jwtA,
        body: { app_id: 'app:funvids', action: 'publish-video', storage_key: 'vid/test.mp4', caption },
      });

      const before = provider.stats.publishes;
      const first = await publish(`delegated-1-${Date.now()}`);
      assert(first.status === 200, `the delegated publish was refused: ${first.status} ${first.data?.error?.code} ${first.data?.error?.message}`);
      assert(provider.stats.publishes === before + 1, 'the delegated publish never reached the provider');

      const second = await publish(`delegated-2-${Date.now()}`);
      assert(second.status === 200, `the second delegated publish was refused: ${second.status} ${second.data?.error?.code}`);

      // Two is the cap. The third is where the delegation's per_user_limit becomes a refusal instead
      // of a number in a record.
      const third = await publish(`delegated-3-${Date.now()}`);
      assert(third.status === 400, `the third publish should have been capped, got ${third.status}`);
      assert(third.data?.error?.code === 'USER_LIMIT_REACHED', `expected USER_LIMIT_REACHED, got ${third.data?.error?.code}`);
      assert(provider.stats.publishes === before + 2, 'a capped publish still reached the provider');
    });

    await test('the one-gesture stop is a refusal, not just a flag in a record', async () => {
      // Its own delegation, with no per-user cap, so that a broken stop shows up as a PUBLISH rather
      // than as the cap answering first and hiding what happened.
      const made = await api(`/v1/connections/${sharedId}/delegations`, {
        bearer: jwtA, body: { app_id: 'app:stopper', action: 'publish-video', moderation: 'auto' },
      });
      assert(made.status === 201, `delegation for the stop test: ${made.status} ${made.data?.error?.message}`);
      const stopId = made.data.data.delegation.id;

      const off = await api(`/v1/connections/delegations/${stopId}`, { method: 'PATCH', bearer: jwtA, body: { enabled: false } });
      assert(off.status === 200, `disable: ${off.status}`);

      const before = provider.stats.publishes;
      const r = await api('/v1/connections/publish', {
        bearer: jwtA,
        body: { app_id: 'app:stopper', action: 'publish-video', storage_key: 'vid/test.mp4', caption: `after-stop-${Date.now()}` },
      });
      assert(r.status === 400, `a disabled delegation should refuse, got ${r.status}`);
      assert(r.data?.error?.code === 'DELEGATION_DISABLED', `expected DELEGATION_DISABLED, got ${r.data?.error?.code}`);
      assert(provider.stats.publishes === before, 'a publish went out through a delegation that was turned off');

      // …and turning it back on lets the same request through, so the refusal is the switch.
      const on = await api(`/v1/connections/delegations/${stopId}`, { method: 'PATCH', bearer: jwtA, body: { enabled: true } });
      assert(on.status === 200, `re-enable: ${on.status}`);
      const after = await api('/v1/connections/publish', {
        bearer: jwtA,
        body: { app_id: 'app:stopper', action: 'publish-video', storage_key: 'vid/test.mp4', caption: `after-restart-${Date.now()}` },
      });
      assert(after.status === 200, `the re-enabled delegation still refuses: ${after.status} ${after.data?.error?.code}`);
    });

    await test('a missing file is refused BEFORE an attempt is opened', async () => {
      const r = await api('/v1/connections/publish', {
        bearer: jwtA,
        body: { connection_id: pubConn, storage_key: 'vid/does-not-exist.mp4', caption: 'x' },
      });
      assert(r.status === 404 && r.data.error.code === 'NO_SUCH_FILE', `${r.status} ${r.data?.error?.code}`);
    });

    await test('a spent shared allowance QUEUES rather than publishing', async () => {
      // Straight at the gate with a ceiling of zero: the route's own provider has no limit, and the
      // behaviour under a full one is what matters.
      const { openOwnPublish } = await import('../src/services/connections/publish-gate.js');
      const { SqliteStorage } = await import('../src/storage/providers/sqlite/index.js');
      const storage = new SqliteStorage(':memory:');
      const now = new Date().toISOString();
      await storage.createConnection({
        id: 'q1', principal: 'q@test', mode: 'personal', provider: 'fake', instance: null,
        accountLabel: 'Q', externalId: 'q', credential: 'x', credentialShape: 'oauth2', scopes: [],
        expiresAt: null, status: 'active', lastOkAt: now, lastError: null, createdAt: now, updatedAt: now,
      });
      const first = await openOwnPublish(storage as any,
        { publisher: 'q@test', connectionId: 'q1', storageKey: 'a.mp4', caption: 'one' }, { sharedDailyLimit: 1 });
      assert(first.ok && first.attempt.status === 'in_flight', 'the first should proceed');
      const second = await openOwnPublish(storage as any,
        { publisher: 'q@test', connectionId: 'q1', storageKey: 'b.mp4', caption: 'two' }, { sharedDailyLimit: 1 });
      assert(second.ok && second.attempt.status === 'queued',
        `expected queued, got ${second.ok ? second.attempt.status : 'refused'}`);
      storage.close();
    });

    await test('the delegation\'s FIXED parameters win over what the app asked for', async () => {
      // Observed at the gate rather than through the provider, because the test provider's recipe
      // ignores params entirely: it posts the bytes and nothing else. The merge is the whole point of
      // `fixed` — an app that asks for `public` on a channel whose owner fixed `unlisted` must not
      // get it — and a spread written the other way round would silently hand it over.
      const { openPublish } = await import('../src/services/connections/publish-gate.js');
      const { SqliteStorage } = await import('../src/storage/providers/sqlite/index.js');
      const storage = new SqliteStorage(':memory:');
      const now = new Date().toISOString();
      await storage.createConnection({
        id: 'f1', principal: 'f@test', mode: 'shared', provider: 'fake', instance: null,
        accountLabel: 'F', externalId: 'f', credential: 'x', credentialShape: 'oauth2', scopes: [],
        expiresAt: null, status: 'active', lastOkAt: now, lastError: null, createdAt: now, updatedAt: now,
      });
      await storage.upsertDelegation({
        id: 'd1', connectionId: 'f1', appId: 'app:fixer', action: 'publish-video',
        fixed: { visibility: 'unlisted', tags: ['fixed'] }, perUserLimit: null,
        moderation: 'auto', enabled: true, createdAt: now, updatedAt: now,
      });

      const gate = await openPublish(storage as any, {
        publisher: 'someone@test', appId: 'app:fixer', action: 'publish-video',
        storageKey: 'a.mp4', caption: 'one',
        params: { visibility: 'public', tags: ['asked'], alt: 'kept' },
      }, { sharedDailyLimit: null });
      assert(gate.ok, `the gate refused: ${gate.ok ? '' : gate.code}`);
      assert((gate as any).params.visibility === 'unlisted',
        `the app's visibility overrode the owner's: ${JSON.stringify((gate as any).params)}`);
      assert(JSON.stringify((gate as any).params.tags) === JSON.stringify(['fixed']),
        `a fixed array was overridden: ${JSON.stringify((gate as any).params.tags)}`);
      // …and a parameter the owner did NOT fix still travels, or `fixed` would be a whitelist.
      assert((gate as any).params.alt === 'kept', `an unfixed parameter was dropped: ${JSON.stringify((gate as any).params)}`);
      storage.close();
    });

    console.log('\nPhase 12 — A principal brings their own app');
    // WHY THIS EXISTS. Without it every user of a node reaches a provider through ONE registration:
    // the node's. To LinkedIn or X a thousand users are one application, sharing one rate limit,
    // one reputation and — on X, where pay-per-use charges the app rather than the member — one
    // bill. Someone who brings their own app spends their own.

    await test('a principal can register their own client, and the secret never comes back', async () => {
      const r = await api('/v1/connections/clients', {
        method: 'PUT', bearer: jwtA,
        body: { provider: 'fake', client_id: 'alice-own-app', client_secret: 'alice-own-secret' },
      });
      assert(r.status === 200, `put client: ${r.status} ${r.data?.error?.message}`);
      assert(r.data.data.client.clientId === 'alice-own-app', 'wrong client echoed');
      assert(!JSON.stringify(r.data).includes('alice-own-secret'), 'the secret came back in the response');
      const list = await api('/v1/connections/clients', { method: 'GET', bearer: jwtA });
      assert(list.status === 200 && (list.data.data.clients as any[]).length === 1, 'not listed back');
      assert(!JSON.stringify(list.data).includes('alice-own-secret'), 'the secret is readable from the listing');
    });

    await test("the principal's OWN client is used, not the node's", async () => {
      // Read off the authorize URL, which is where a wrong client would actually reach the provider.
      const start = await api('/v1/connections/start', {
        bearer: jwtA, body: { provider: 'fake', mode: 'personal', return_url: '/profile#access' },
      });
      assert(start.status === 200, `start: ${start.status} ${start.data?.error?.message}`);
      const url = new URL(start.data.data.authorize_url as string);
      assert(url.searchParams.get('client_id') === 'alice-own-app',
        `authorize used client_id=${url.searchParams.get('client_id')} instead of the principal's own`);
    });

    await test('another principal neither sees it nor is switched onto it', async () => {
      const list = await api('/v1/connections/clients', { method: 'GET', bearer: jwtB });
      assert(list.status === 200 && (list.data.data.clients as any[]).length === 0, "B can see A's client");
      const start = await api('/v1/connections/start', {
        bearer: jwtB, body: { provider: 'fake', mode: 'personal', return_url: '/profile#access' },
      });
      assert(start.status === 200, `B start: ${start.status}`);
      const url = new URL(start.data.data.authorize_url as string);
      assert(url.searchParams.get('client_id') !== 'alice-own-app', "B was silently put on A's application");
    });

    await test('a connection made with an own app remembers which app made it', async () => {
      const start = await api('/v1/connections/start', {
        bearer: jwtA, body: { provider: 'fake', mode: 'personal', return_url: '/profile#access' },
      });
      const cb = await fetch(
        `${BASE}/v1/connections/callback?state=${encodeURIComponent(start.data.data.state)}&code=code-ownapp`,
        { redirect: 'manual' },
      );
      assert(cb.status === 302, `callback: ${cb.status}`);
      const clients = await api('/v1/connections/clients', { method: 'GET', bearer: jwtA });
      assert((clients.data.data.clients as any[])[0].connectionCount >= 1,
        'the client reports no connections made with it');
    });

    await test('a refresh is made by the app that ISSUED the token, and fails when it is not', async () => {
      // THE REASON THE FEATURE IS SAFE TO SHIP. A refresh token belongs to the client that minted
      // it; renewing with a different one is an invalid_grant that names nothing, arriving hours
      // later and looking exactly like a revoked account.
      //
      // Both directions are asserted. The positive alone would pass even if the provider never
      // checked, so the same connection is then pointed at the NODE's client and must fail — which
      // is what proves the binding is doing the work rather than the test being generous.
      const { ensureFreshCredential } = await import('../src/services/connections/refresh.js');
      const { sealCredential } = await import('../src/services/connections/credential.js');
      const { buildOutboundProviders } = await import('../src/services/connections/providers.js');
      const { SqliteStorage } = await import('../src/storage/providers/sqlite/index.js');

      const key = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');
      const cfg = {
        nodeId: 'test', baseUrl: BASE, connectionsEnabled: true,
        connectGoogleClientId: '', connectGoogleClientSecret: '', connectRedirectUri: '',
        connectFakeBaseUrl: provider.baseUrl,
      } as any;
      const storage = new SqliteStorage(':memory:');
      const ctx = { config: cfg, storage: storage as any, providers: buildOutboundProviders(cfg), key };

      // A real grant from the test provider, obtained BY the principal's own client, so the provider
      // has recorded who owns it.
      const form = new URLSearchParams({
        grant_type: 'authorization_code', code: 'code-byoa', code_verifier: 'v',
        client_id: 'byoa-client', client_secret: 'byoa-secret', redirect_uri: `${BASE}/v1/connections/callback`,
      });
      const tok = await fetch(`${provider.baseUrl}/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString(),
      });
      const grant = await tok.json() as { access_token: string; refresh_token: string };

      const own = await storage.upsertPrincipalProviderClient({
        id: 'pc-byoa', provider: 'fake', instance: null, principal: 'byoa@test',
        clientId: 'byoa-client',
        clientSecret: sealCredential({ shape: 'oauth2', accessToken: 'byoa-secret' }, key),
        registeredAt: new Date().toISOString(),
      });

      const now = new Date().toISOString();
      const base = {
        principal: 'byoa@test', mode: 'personal' as const, provider: 'fake', instance: null,
        accountLabel: 'BYOA', externalId: 'byoa',
        credential: sealCredential(
          { shape: 'oauth2' as const, accessToken: grant.access_token, refreshToken: grant.refresh_token }, key,
        ),
        credentialShape: 'oauth2' as const, scopes: [],
        // Already expired, so ensureFreshCredential actually goes to the provider.
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
        status: 'active' as const, lastOkAt: now, lastError: null, createdAt: now, updatedAt: now,
      };
      await storage.createConnection({ ...base, id: 'byoa-1', providerClientId: own.id });

      const beforeWrong = provider.stats.wrongClientRefreshAttempts;
      const good = await ensureFreshCredential(ctx, 'byoa-1');
      assert(good.ok, `a refresh with the issuing app failed: ${good.ok ? '' : good.reason}`);
      assert(provider.stats.wrongClientRefreshAttempts === beforeWrong,
        'the renewal was attempted by the wrong application');

      // Now the same shape of connection, on a fresh grant, but pointed at the NODE's client.
      const form2 = new URLSearchParams({
        grant_type: 'authorization_code', code: 'code-byoa2', code_verifier: 'v',
        client_id: 'byoa-client', client_secret: 'byoa-secret', redirect_uri: `${BASE}/v1/connections/callback`,
      });
      const tok2 = await fetch(`${provider.baseUrl}/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form2.toString(),
      });
      const grant2 = await tok2.json() as { access_token: string; refresh_token: string };
      await storage.createConnection({
        ...base, id: 'byoa-2', providerClientId: null,
        externalId: 'byoa2',
        credential: sealCredential(
          { shape: 'oauth2' as const, accessToken: grant2.access_token, refreshToken: grant2.refresh_token }, key,
        ),
      });

      const bad = await ensureFreshCredential(ctx, 'byoa-2');
      assert(!bad.ok, 'renewing another application\u2019s token succeeded, so the provider is not checking');
      assert(provider.stats.wrongClientRefreshAttempts === beforeWrong + 1,
        'the provider did not record a wrong-client renewal, so the positive case proves nothing');
      storage.close();
    });

    await test('deleting a client that connections still depend on is REFUSED', async () => {
      const r = await api('/v1/connections/clients/fake', { method: 'DELETE', bearer: jwtA });
      assert(r.status === 409 && r.data.error.code === 'CLIENT_IN_USE',
        `expected 409 CLIENT_IN_USE, got ${r.status} ${r.data?.error?.code}`);
      // The count is in the message, so the person knows what to disconnect first.
      assert(/\d+ connected account/.test(r.data.error.message as string), 'the refusal does not say how many');
    });

    await test("deleting another principal's client is the same 404 as a missing one", async () => {
      const r = await api('/v1/connections/clients/fake', { method: 'DELETE', bearer: jwtB });
      assert(r.status === 404, `status ${r.status}`);
    });

    await test('an attach-only provider refuses a client it could never use', async () => {
      const r = await api('/v1/connections/clients', {
        method: 'PUT', bearer: jwtB,
        body: { provider: 'fake-static', client_id: 'x', client_secret: 'y' },
      });
      assert(r.status === 400 && r.data.error.code === 'NOT_AN_OAUTH_PROVIDER', `${r.status} ${r.data?.error?.code}`);
    });

    await test('a client for an unknown provider is a 404, not a stored row', async () => {
      const r = await api('/v1/connections/clients', {
        method: 'PUT', bearer: jwtB,
        body: { provider: 'not-a-provider', client_id: 'x', client_secret: 'y' },
      });
      assert(r.status === 404 && r.data.error.code === 'UNKNOWN_PROVIDER', `${r.status} ${r.data?.error?.code}`);
    });

    console.log('\nPhase 13 — What a granted app may and may not do');

    await test('an app holding only connections:use can NAME a connection but not create one', async () => {
      // Building a test app against this capability is what surfaced the hole: `connections:use`
      // let an app publish to a connection while `connections:read` (which it is deliberately never
      // granted) was the only way to learn a connection id. A permission that cannot be exercised.
      //
      // Exercised against the guard itself with synthetic principals, because minting a real app
      // grant here would test the device-auth flow rather than the rule under examination.
      const { requireAnyScope, requireScope } = await import('../src/auth/middleware.js');

      const run = (guard: any, auth: any): number | 'next' => {
        let code: number | 'next' = 'next';
        const res: any = { status: (c: number) => { code = c; return res; }, json: () => res };
        guard({ auth, method: 'GET', path: '/v1/connections', headers: {} } as any, res, () => { code = 'next'; });
        return code;
      };

      const app = { sub: 'app:x#alice@n', owner: 'alice', roles: ['app'], scopes: ['connections:use'] };
      const reader = { sub: 'a#alice@n', owner: 'alice', roles: ['agent'], scopes: ['connections:read'] };
      const stranger = { sub: 'b#alice@n', owner: 'alice', roles: ['agent'], scopes: ['memory:read'] };
      const owner = { sub: 'alice', owner: 'alice', roles: ['owner'], scopes: [] };

      const listing = requireAnyScope('connections:read', 'connections:use');
      assert(run(listing, app) === 'next', 'an app with connections:use cannot list, so it cannot name a target');
      assert(run(listing, reader) === 'next', 'connections:read no longer lists');
      assert(run(listing, owner) === 'next', 'the owner was refused their own connections');
      assert(run(listing, stranger) === 403, 'an unrelated scope was let through');

      // The other half, and the one that matters more: reading is not writing. An app must NOT be
      // able to attach an account or register an app in the owner's name — that is a human act at
      // the provider's own consent screen.
      const writing = requireScope('connections:write');
      assert(run(writing, app) === 403, 'an app with connections:use was allowed to WRITE connections');
      assert(run(writing, reader) === 403, 'a read scope was allowed to write');
    });

    /**
     * The phase above runs synthetic principals through guards the TEST constructs, so it proves the
     * middleware behaves — and nothing about which guard each route actually mounts. A route that
     * dropped its scope, or carried the wrong word, passes every assertion up there.
     *
     * This one drives the real routes with a real app-grant bearer. The distinction matters here more
     * than elsewhere: requireScope is the only middleware that stops role 'app', because the owner
     * bypass excludes it, so these doors are exactly where an app's limits are decided.
     */
    await test('the doors themselves refuse an app that holds only connections:use', async () => {
      const useOnly = await grantAppToken(jwtA, userA, ['connections:use']);

      // The read side admits it: requireAnyScope('connections:read','connections:use').
      const listed = await api('/v1/connections', { method: 'GET', bearer: useOnly });
      assert(listed.status === 200, `an app with connections:use must still LIST connections, got ${listed.status}`);

      // The write side must not. Attaching an account or registering an app in the owner's name is a
      // human act at the provider's consent screen.
      const writes: Array<{ label: string; path: string; method?: string; body?: any }> = [
        { label: 'register a client', path: '/v1/connections/clients', method: 'PUT', body: { provider: 'mastodon', client_id: 'x', client_secret: 'y' } },
        { label: 'attach an account', path: '/v1/connections/attach', body: { provider: 'mastodon', access_token: 'stolen' } },
        { label: 'start an oauth flow', path: '/v1/connections/start', body: { provider: 'mastodon' } },
        { label: 'delete a connection', path: `/v1/connections/${connA}`, method: 'DELETE' },
      ];
      const leaks: string[] = [];
      for (const w of writes) {
        const r = await api(w.path, { method: w.method ?? 'POST', bearer: useOnly, body: w.body });
        if (r.status !== 403) leaks.push(`${w.label} → ${r.status}`);
        else if (r.data?.error?.code !== 'SCOPE_DENIED') leaks.push(`${w.label} → 403 but ${r.data?.error?.code}`);
      }
      assert(leaks.length === 0, `an app holding only connections:use got past these doors: ${leaks.join(', ')}`);

      // Read back as the owner: the connection the app tried to delete is still there.
      const after = await api('/v1/connections', { method: 'GET', bearer: jwtA });
      assert((after.data?.data?.connections ?? []).some((c: any) => c.id === connA),
        `the refused DELETE removed the connection: ${JSON.stringify((after.data?.data?.connections ?? []).map((c: any) => c.id))}`);
    });

    console.log('\nPhase 14 — History, and how it did');

    let histId = '';
    await test('the ledger that stops double posts is finally readable', async () => {
      // It recorded everything ever published through this node and nothing could read it, which
      // made "publish" a write-only hole for whoever had to run the accounts.
      const r = await api('/v1/connections/attempts', { method: 'GET', bearer: jwtA });
      assert(r.status === 200, `history: ${r.status} ${r.data?.error?.message}`);
      const items = r.data.data.attempts as any[];
      assert(items.length > 0, 'nothing in the history although this suite published earlier');
      const done = items.find(i => i.status === 'done' && i.externalRef);
      assert(done !== undefined, 'no completed publish in the history');
      histId = done.id;
      // The account is joined in, because an id nobody recognises is not a history.
      assert(typeof done.accountLabel === 'string' && done.accountLabel.length > 0, 'no account label');
      assert(done.latest === null, 'a reading exists before anyone asked for one');
    });

    await test("another principal's history is their own", async () => {
      const r = await api('/v1/connections/attempts', { method: 'GET', bearer: jwtB });
      assert(r.status === 200, `B history: ${r.status}`);
      const ids = (r.data.data.attempts as any[]).map(i => i.id);
      assert(!ids.includes(histId), "B can see A's published items");
    });

    await test('reading the numbers stores a sample, and null stays null', async () => {
      const before = provider.stats.metricReads;
      const r = await api(`/v1/connections/attempts/${histId}/metrics`, { method: 'POST', bearer: jwtA });
      assert(r.status === 200, `measure: ${r.status} ${r.data?.error?.message}`);
      assert(provider.stats.metricReads === before + 1, 'the provider was not actually asked');
      const s = r.data.data.sample;
      assert(s.likes === 7 && s.comments === 2 && s.shares === 3, `got ${JSON.stringify(s)}`);
      // THE DISCIPLINE OF THIS WHOLE FEATURE. The test provider reports no impression count, and
      // that has to survive as null. A 0 here would be a measurement nobody made, and a dashboard
      // that averages invented zeros lies confidently.
      assert(s.impressions === null, `an unreported number became ${s.impressions}`);
      assert(s.raw && typeof s.raw === 'object', 'the provider\u2019s own answer was not kept');
    });

    await test('the series accumulates rather than overwrites', async () => {
      await api(`/v1/connections/attempts/${histId}/metrics`, { method: 'POST', bearer: jwtA });
      const r = await api(`/v1/connections/attempts/${histId}/metrics`, { method: 'GET', bearer: jwtA });
      assert(r.status === 200, `series: ${r.status}`);
      const samples = r.data.data.samples as any[];
      // Two readings, not one row that moved: "how did that post do" is a question about a curve,
      // and a single overwritten value can never say whether 40 likes took an hour or a month.
      assert(samples.length >= 2, `expected a growing series, got ${samples.length}`);
      assert(samples[0].fetchedAt <= samples[samples.length - 1].fetchedAt, 'the series is not oldest-first');
    });

    await test('the history carries the newest reading, not the first', async () => {
      const r = await api('/v1/connections/attempts', { method: 'GET', bearer: jwtA });
      const item = (r.data.data.attempts as any[]).find(i => i.id === histId);
      assert(item.latest !== null, 'the history shows no reading after two were taken');
      const series = await api(`/v1/connections/attempts/${histId}/metrics`, { method: 'GET', bearer: jwtA });
      const newest = (series.data.data.samples as any[]).slice(-1)[0];
      assert(item.latest.id === newest.id, 'the history is showing a stale sample');
    });

    await test('an item the platform will not report on is a 409, not a 5xx', async () => {
      // Nothing is broken and nothing is worth retrying. A 5xx would invite a retry loop, and on a
      // provider that charges per read that loop is a standing bill.
      provider.noMetrics = true;
      const r = await api(`/v1/connections/attempts/${histId}/metrics`, { method: 'POST', bearer: jwtA });
      provider.noMetrics = false;
      assert(r.status === 409 && r.data.error.code === 'NOT_MEASURABLE', `${r.status} ${r.data?.error?.code}`);
    });

    await test("measuring someone else's item is the same 404 as a missing one", async () => {
      const r = await api(`/v1/connections/attempts/${histId}/metrics`, { method: 'POST', bearer: jwtB });
      assert(r.status === 404, `status ${r.status}`);
    });

    console.log('\nPhase 15 — Spaces: workspace membership IS the access');

    // WHAT THIS PHASE IS FOR (LÄHETIN phase 0). A space is an organism workspace, and there is no
    // second roster: no app member list, no aimeat-iam. The app is open and the DATA is fenced, which
    // only holds if the NODE refuses — so every assertion here goes through the API with the wrong
    // person's token rather than through a UI that could simply be drawing less.
    //
    // The sharp one is the middle case. A non-member being refused is obvious. An organism member who
    // was never granted the workspace is the case an app gets wrong: they authenticate, they belong to
    // the organism, the request succeeds, and they must still see NOTHING.
    let spaceOrg = '', spaceWs = '', otherWs = '';
    const postKey = (org: string, ws: string, id: string) => `organism.${org}.w.${ws}.lahetin.posts.${id}.draft`;
    const readWs = (org: string, ws: string, bearer: string) =>
      api(`/v1/organisms/${org}/workspace?ws=${encodeURIComponent(ws)}`, { method: 'GET', bearer });
    /** The post ids a caller can actually see in a workspace read, drafts included. */
    const visiblePostIds = (call: Call): string[] => {
      const d = call.data?.data ?? {};
      const rows = [...((d.objects?.post ?? []) as any[]), ...((d.drafts?.post ?? []) as any[])];
      return rows.map(r => String(r?.id ?? ''));
    };

    // NO SCHEMA LOCK, deliberately. provisionWorkspace locks in `strict` mode, which forces
    // additionalProperties:false — so a lock written today would reject every record the moment a
    // later phase adds a field (a scheduled time, an attempt id), and a lock cannot be relaxed for
    // spaces that already exist. That is the same "we would have to migrate the data" cost the space
    // model exists to avoid; the shape is the app's to enforce, the fence is the node's.
    const LAHETIN_MANIFEST = {
      manifestVersion: '1.0',
      name: 'LÄHETIN',
      kind: 'lahetin-space',
      status: 'active',
      summary: 'Somejulkaisut, luonnokset ja ajastukset yhdelle tiimille.',
      objectTypes: [
        { name: 'post', namespace: 'lahetin.posts', mode: 'records', backing: 'memory', writeRole: 'member', schemaRef: 'schema:lahetin-post@1', cardinality: 'many' },
        { name: 'setting', namespace: 'lahetin.settings', mode: 'records', backing: 'memory', writeRole: 'member', schemaRef: 'schema:lahetin-setting@1', cardinality: 'one' },
      ],
    };

    await test('a space is an organism workspace, provisioned by its creator', async () => {
      // join_policy 'open' only so this suite can put B inside the organism without the email-invite
      // machinery. The app provisions 'invite_only' — being in the organism is not the point, holding
      // the workspace is, and the next test is what proves that.
      const org = await api('/v1/organisms', {
        bearer: jwtA,
        body: { name: `LÄHETIN ${stamp}`, type: 'project', visibility: 'private', join_policy: 'open' },
      });
      assert(org.status === 201, `create organism: ${org.status} ${org.data?.error?.message}`);
      spaceOrg = org.data.data.organism.id;

      const ws = await api(`/v1/organisms/${spaceOrg}/workspaces`, {
        bearer: jwtA, body: { name: 'Markkinointi', manifest: LAHETIN_MANIFEST },
      });
      assert(ws.status === 201, `create workspace: ${ws.status} ${ws.data?.error?.message}`);
      spaceWs = ws.data.data.ws;
      assert(spaceWs.startsWith('ws-'), `ws id: ${spaceWs}`);

      const draft = await api('/v1/memory', {
        bearer: jwtA,
        body: {
          key: postKey(spaceOrg, spaceWs, 'p1'),
          value: { id: 'p1', title: 'Kevätkampanja', body: 'Luonnos', channels: ['mastodon'], status: 'draft' },
          visibility: 'private',
        },
      });
      assert(draft.status === 200 || draft.status === 201, `write draft: ${draft.status} ${draft.data?.error?.message}`);

      const mine = await readWs(spaceOrg, spaceWs, jwtA);
      assert(mine.status === 200, `creator read: ${mine.status}`);
      assert(visiblePostIds(mine).includes('p1'), 'the creator cannot see their own draft');
    });

    await test('someone outside the organism is refused, not shown an empty space', async () => {
      const r = await readWs(spaceOrg, spaceWs, jwtB);
      assert(r.status === 403, `expected 403 for a non-member, got ${r.status}`);
    });

    await test('an organism member with no workspace grant sees the space and none of its content', async () => {
      // The one an app gets wrong. B is now genuinely inside the organism, so the request succeeds —
      // and the workspace is still not theirs. If this ever returns p1, the fence is decoration and
      // every space on the node leaks to everyone who joined the organism.
      const join = await api(`/v1/organisms/${spaceOrg}/join`, { bearer: jwtB, body: {} });
      assert(join.status === 200 || join.status === 201, `join: ${join.status} ${join.data?.error?.message}`);

      const r = await readWs(spaceOrg, spaceWs, jwtB);
      assert(r.status === 200, `member read: ${r.status}`);
      const seen = visiblePostIds(r);
      assert(seen.length === 0, `an ungranted member read ${seen.length} post(s): ${seen.join(',')}`);
      assert(r.data.data.manifest === null, 'an ungranted member was handed the manifest');
    });

    await test('discovery names the workspace and still says the content is not theirs', async () => {
      // Being able to SEE that a space exists is what makes "ask for access" possible at all; being
      // able to read it is the separate thing. access:'none' is the app's cue to offer the request.
      const r = await api(`/v1/organisms/${spaceOrg}/workspaces`, { method: 'GET', bearer: jwtB });
      assert(r.status === 200, `list workspaces: ${r.status}`);
      const row = (r.data.data.workspaces as any[]).find(w => w.id === spaceWs);
      assert(row !== undefined, 'the workspace is invisible to a member of its organism');
      assert(row.access === 'none', `expected access 'none', got '${row.access}'`);
    });

    await test('the grant is what opens it, and it opens exactly one workspace', async () => {
      const grant = await api(`/v1/organisms/${spaceOrg}/workspace-access/grant`, {
        bearer: jwtA, body: { ws: spaceWs, grantee: userB, role: 'viewer' },
      });
      assert(grant.status === 200, `grant: ${grant.status} ${grant.data?.error?.message}`);

      const r = await readWs(spaceOrg, spaceWs, jwtB);
      assert(r.status === 200, `granted read: ${r.status}`);
      assert(visiblePostIds(r).includes('p1'), 'a granted viewer still cannot see the draft');
    });

    await test('through the APP, a viewer may read and may not write; a contributor may do both', async () => {
      // The two roles the workspace layer actually has — there is no third — asserted through the
      // door the app actually comes in by: an app-grant token (role 'app'), not an owner session.
      //
      // THAT DISTINCTION IS NOT A TEST DETAIL. A HUMAN owner session bypasses this gate entirely
      // (middleware/workspace-access.ts treats an owner-role session as the principal and skips the
      // contributor check), so writing this against jwtB would assert nothing: it passes whatever the
      // grant says. What is proven here is the gate LÄHETIN runs under. The owner-session gap is a
      // separate, wider question about the platform and is reported rather than quietly changed.
      const appToken = await grantAppToken(jwtB, userB, ['memory:read', 'memory:write', 'organism:read']);
      const asApp = (id: string) => api('/v1/memory', {
        bearer: appToken,
        body: {
          key: postKey(spaceOrg, spaceWs, id),
          value: { id, title: 'B kirjoitti', body: 'x', channels: ['mastodon'], status: 'draft' },
          visibility: 'private',
        },
      });

      const asViewer = await asApp('b-viewer');
      assert(asViewer.status === 403, `a viewer's app was allowed to write: ${asViewer.status}`);
      // ...and reading still works, because viewer means read.
      assert(visiblePostIds(await readWs(spaceOrg, spaceWs, jwtB)).includes('p1'),
        'the viewer lost read access');

      const promote = await api(`/v1/organisms/${spaceOrg}/workspace-access/grant`, {
        bearer: jwtA, body: { ws: spaceWs, grantee: userB, role: 'contributor' },
      });
      assert(promote.status === 200, `promote: ${promote.status} ${promote.data?.error?.message}`);

      const asContributor = await asApp('b-contributor');
      assert(asContributor.status === 200 || asContributor.status === 201,
        `a contributor's app could not write: ${asContributor.status} ${asContributor.data?.error?.message}`);

      // ...and the creator sees it, because a space is shared content and not a pile of private
      // notes that happen to sit next to each other.
      const seen = visiblePostIds(await readWs(spaceOrg, spaceWs, jwtA));
      assert(seen.includes('b-contributor'), "the creator cannot see a contributor's post");
    });

    await test('a second space in the same organism stays shut', async () => {
      // The acceptance criterion in words: a person in two spaces sees two spaces, and a person in one
      // sees one. Same organism, same member, one grant — so the fence is the WORKSPACE and not the
      // organism, which is the whole reason a space is a workspace rather than a tag on a record.
      const ws2 = await api(`/v1/organisms/${spaceOrg}/workspaces`, {
        bearer: jwtA, body: { name: 'Rekrytointi', manifest: LAHETIN_MANIFEST },
      });
      assert(ws2.status === 201, `create second workspace: ${ws2.status}`);
      otherWs = ws2.data.data.ws;

      const draft = await api('/v1/memory', {
        bearer: jwtA,
        body: {
          key: postKey(spaceOrg, otherWs, 'p2'),
          value: { id: 'p2', title: 'Avoin paikka', body: 'Luonnos', channels: ['bluesky'], status: 'draft' },
          visibility: 'private',
        },
      });
      assert(draft.status === 200 || draft.status === 201, `write second draft: ${draft.status}`);

      const r = await readWs(spaceOrg, otherWs, jwtB);
      assert(r.status === 200, `second space read: ${r.status}`);
      const seen = visiblePostIds(r);
      assert(seen.length === 0, `a grant on one space leaked ${seen.length} post(s) from another: ${seen.join(',')}`);

      // ...and the one they DO hold is unaffected by the refusal above.
      const still = await readWs(spaceOrg, spaceWs, jwtB);
      assert(visiblePostIds(still).includes('p1'), 'the granted space stopped working');
    });

    await test('a connection is its owner’s, and a space grant does not lend it', async () => {
      // Decision 7, asserted rather than asserted-about. B holds a viewer grant on A's space; that says
      // what may be published, never with whose account. Publishing to A's connection is still the same
      // 404 a stranger gets, because the connection belongs to the person who attached it.
      const r = await api('/v1/connections/publish', {
        bearer: jwtB, body: { connection_id: connA, caption: 'borrowed account' },
      });
      assert(r.status === 404, `a space member published through someone else's connection: ${r.status}`);
    });

    console.log('\nPhase 17 — Publishing later, on the scheduler this node already had');

    // WHAT THIS PHASE IS FOR. The browser is not open at 07:00, so somebody's clock has to tick — and
    // this node already owns one. A scheduled publish is a `ScheduledJob` of kind
    // `connections-publish`; the durable row, the DST-correct IANA timezone, the one-shot
    // (`max_runs: 1` auto-disables after the fire), the run log and `/occurrences` all come from the
    // machinery extensions and workflows already use. There is deliberately NO second queue table.
    let schedId = '';
    const inMinutes = (n: number) => {
      const d = new Date(Date.now() + n * 60_000);
      // A specific instant expressed as cron. With max_runs:1 it fires once and disables itself.
      return `${d.getUTCMinutes()} ${d.getUTCHours()} ${d.getUTCDate()} ${d.getUTCMonth() + 1} *`;
    };
    const ONE_SHOT = [{ type: 'max_runs', enabled: true, params: { limit: 1 } }];

    await test('a publish can be put on the node’s own scheduler, with the zone the author meant', async () => {
      const r = await api('/v1/schedules', {
        bearer: jwtA,
        body: {
          kind: 'connections-publish',
          cron: inMinutes(120),
          // The zone is the scheduler's own field and it is DST-correct via croner. Rebuilding it
          // beside this one is how a schedule silently moves an hour twice a year.
          timezone: 'Europe/Helsinki',
          display_name: 'Kevätkampanja',
          constraints: ONE_SHOT,
          input: { connection_id: connA, caption: `scheduled-${stamp}`, ref: 'org/ws/p1' },
        },
      });
      assert(r.status === 200 || r.status === 201, `schedule: ${r.status} ${r.data?.error?.message}`);
      const s = r.data.data.schedule ?? r.data.data;
      schedId = s.id;
      assert(!!schedId, 'no schedule id came back');
      assert(s.timezone === 'Europe/Helsinki', `the zone was not kept: ${s.timezone}`);
      assert(s.type === 'connections-publish', `kind ${s.type}`);
      // The caller's own reference rides in `input` and is never parsed by the node.
      assert((s.input as { ref?: string }).ref === 'org/ws/p1', 'the caller’s reference did not survive');
    });

    await test('it appears in the ONE schedule list the owner already had', async () => {
      // Not a separate queue view: the same aggregate that shows extension crons and agent tasks.
      const r = await api('/v1/schedules', { method: 'GET', bearer: jwtA });
      assert(r.status === 200, `list: ${r.status}`);
      const found = JSON.stringify(r.data.data).includes(schedId);
      assert(found, 'the scheduled publish is missing from /v1/schedules');
    });

    await test('scheduling to someone else’s account is the same 404 as a missing one', async () => {
      // Decision 7 on the scheduling surface: a connection belongs to the person who attached it, and
      // queueing work changes nothing about that.
      const r = await api('/v1/schedules', {
        bearer: jwtB,
        body: {
          kind: 'connections-publish', cron: inMinutes(120), timezone: 'UTC',
          constraints: ONE_SHOT, input: { connection_id: connA, caption: 'not mine' },
        },
      });
      assert(r.status === 404, `status ${r.status}`);
    });

    await test('a schedule with no connection, or a file that is not there, is refused NOW', async () => {
      // Both checked while somebody is looking at the screen. Discovering either at 07:00 is a post
      // that never appears, with nobody awake to see why.
      const noConn = await api('/v1/schedules', {
        bearer: jwtA,
        body: { kind: 'connections-publish', cron: inMinutes(120), timezone: 'UTC', constraints: ONE_SHOT, input: {} },
      });
      assert(noConn.status === 400, `missing connection_id: ${noConn.status}`);

      const noFile = await api('/v1/schedules', {
        bearer: jwtA,
        body: {
          kind: 'connections-publish', cron: inMinutes(120), timezone: 'UTC', constraints: ONE_SHOT,
          input: { connection_id: connA, storage_key: 'vid/not-there.mp4' },
        },
      });
      assert(noFile.status === 404 && noFile.data.error.code === 'NO_SUCH_FILE',
        `missing file: ${noFile.status} ${noFile.data?.error?.code}`);
    });

    await test('an unknown time zone is refused by the scheduler’s own validation', async () => {
      const r = await api('/v1/schedules', {
        bearer: jwtA,
        body: {
          kind: 'connections-publish', cron: inMinutes(120), timezone: 'Europe/Helsinky',
          constraints: ONE_SHOT, input: { connection_id: connA, caption: 'typo' },
        },
      });
      assert(r.status === 400, `expected 400 for a zone this node does not know, got ${r.status}`);
    });

    await test('when it fires it publishes exactly once, through the same gate', async () => {
      const before = provider.stats.publishes;
      const r = await api(`/v1/schedules/${schedId}/trigger`, { bearer: jwtA });
      assert(r.status === 200, `trigger: ${r.status} ${r.data?.error?.message}`);
      assert(provider.stats.publishes === before + 1,
        `the fire published ${provider.stats.publishes - before} time(s), expected 1`);

      // ...and it is in the history like any other publish, because it IS one.
      const hist = await api('/v1/connections/attempts', { method: 'GET', bearer: jwtA });
      const mine = (hist.data.data.attempts as any[]).filter(a => a.status === 'done');
      assert(mine.length > 0, 'the scheduled publish left no attempt behind');
    });

    await test('firing it again does not publish a second time, AND says so', async () => {
      // The idempotency gate, not a lock of the scheduler's own: same publisher, connection, file and
      // caption is the same key whichever door it comes through.
      const before = provider.stats.publishes;
      const r = await api(`/v1/schedules/${schedId}/trigger`, { bearer: jwtA });
      assert(provider.stats.publishes === before,
        `a second fire published again (${provider.stats.publishes - before})`);

      // And it is not silent about it. For THIS schedule the one-shot's own budget is what refuses
      // the second fire — the executor is never reached — so the honest answer is `limited` with the
      // spent cap named, not a second green run.
      assert(r.data.data.outcome === 'limited',
        `a refused second fire reported "${r.data.data.outcome}"`);
      assert(/max_runs/.test(r.data.data.reason ?? ''),
        `the refusal does not name its cause: ${JSON.stringify(r.data.data.reason)}`);

      // ...and the run log keeps it, so it is still answerable tomorrow.
      const detail = await api(`/v1/schedules/${schedId}`, { method: 'GET', bearer: jwtA });
      const runs = (detail.data.data.runs ?? []) as any[];
      assert(runs.some(x => x.result === 'skipped' && /max_runs/.test(x.errorMessage ?? '')),
        `no run in the log explains the no-op: ${JSON.stringify(runs.map(x => [x.result, x.errorMessage]))}`);
    });

    await test('the same content scheduled AND sent by hand is ONE post', async () => {
      const caption = `both-ways-${stamp}`;
      const s = await api('/v1/schedules', {
        bearer: jwtA,
        body: {
          kind: 'connections-publish', cron: inMinutes(120), timezone: 'Europe/Helsinki',
          constraints: ONE_SHOT, input: { connection_id: connA, caption },
        },
      });
      assert(s.status === 200 || s.status === 201, `schedule: ${s.status}`);
      const id = (s.data.data.schedule ?? s.data.data).id;

      const before = provider.stats.publishes;
      const now = await api('/v1/connections/publish', { bearer: jwtA, body: { connection_id: connA, caption } });
      assert(now.status === 200, `publish now: ${now.status} ${now.data?.error?.message}`);
      assert(provider.stats.publishes === before + 1, 'the immediate publish did not reach the provider');

      const fired = await api(`/v1/schedules/${id}/trigger`, { bearer: jwtA });
      assert(provider.stats.publishes === before + 1,
        `the schedule posted it a second time (${provider.stats.publishes - before} total)`);
      // One post is the right answer; a silent one is not. Whoever scheduled this has to be able to
      // find out that their 09:00 slot put nothing on the platform, and why.
      assert(fired.data.data.outcome !== 'ran',
        'the schedule reported a completed run for a post its own gate had already sent');
      assert(/already published/i.test(fired.data.data.reason ?? ''),
        `the reason does not name the cause: ${JSON.stringify(fired.data.data.reason)}`);
    });

    await test('a schedule EDITED to name someone else’s account still cannot publish to it', async () => {
      // THE ONE THAT MATTERS. `PATCH /v1/schedules/:id` replaces `input` wholesale with no
      // validation, so the create-time ownership check can be walked around by editing afterwards.
      // What must hold is the layer underneath: the publish gate compares the connection's principal
      // against the publisher and refuses. If this ever goes green by PUBLISHING, a scheduled post
      // has become a way to post to somebody else's account.
      const created = await api('/v1/schedules', {
        bearer: jwtA,
        body: {
          kind: 'connections-publish', cron: inMinutes(180), timezone: 'UTC',
          display_name: 'swap probe', constraints: ONE_SHOT,
          input: { connection_id: connA, caption: `swap-${stamp}` },
        },
      });
      assert(created.status === 200 || created.status === 201, `create: ${created.status}`);
      const id = (created.data.data.schedule ?? created.data.data).id;

      // B's own connection, made the same way A's was.
      const bConn = (await connect(jwtB, `swapee${stamp}`)).connections[0];
      assert(!!bConn?.id, 'could not set up a second principal’s connection');

      // The EDIT itself is refused, with the same 404 a stranger's connection gets anywhere else.
      const patched = await api(`/v1/schedules/${id}`, {
        method: 'PATCH', bearer: jwtA,
        body: { input: { connection_id: bConn.id, caption: `swap-${stamp}` } },
      });
      assert(patched.status === 404,
        `editing a schedule onto another principal's connection was allowed: ${patched.status}`);

      // And the wall underneath holds regardless: firing it publishes to nobody else.
      const before = provider.stats.publishes;
      await api(`/v1/schedules/${id}/trigger`, { bearer: jwtA });
      assert(provider.stats.publishes <= before + 1,
        `a swapped schedule published more than its own post (${provider.stats.publishes - before})`);

      // B's history stays empty of it: nothing was attributed to them either.
      const bHist = await api('/v1/connections/attempts', { method: 'GET', bearer: jwtB });
      const leaked = (bHist.data.data.attempts as any[]).filter(a => a.connectionId === bConn.id);
      assert(leaked.length === 0, `${leaked.length} attempt(s) landed on the other principal's connection`);
    });

    await test('an app without connections:use cannot schedule a publish', async () => {
      // The kind is gated on the same scope the immediate publish needs. Without this a memory-only
      // app could put a post on the owner's accounts by way of the scheduler.
      const weak = await grantAppToken(jwtA, userA, ['memory:read']);
      const r = await api('/v1/schedules', {
        bearer: weak,
        body: {
          kind: 'connections-publish', cron: inMinutes(120), timezone: 'UTC',
          constraints: ONE_SHOT, input: { connection_id: connA, caption: 'nope' },
        },
      });
      assert(r.status === 403, `expected 403, got ${r.status}`);
    });

    console.log('\nPhase 16 — Reading the numbers back');

    await test('a Mastodon read refused for a missing scope is PERMANENT, not a retry', async () => {
      // Found by running the real thing: mastodon.social answered 403 because the connection was
      // authorized without `read:statuses`. The node reported 502, which puts a retry button in front
      // of a person that can never work — and on a schedule would be a standing pointless call.
      // Driven against a real HTTP 403 rather than described, using the reader's own code path.
      const { readMetrics } = await import('../src/services/connections/metrics.js');
      const { buildOutboundProviders, findProvider } = await import('../src/services/connections/providers.js');
      const mastodon = findProvider(buildOutboundProviders({ connectionsEnabled: true } as any), 'mastodon')!;

      provider.mastodonForbidden = true;
      const out = await readMetrics({
        provider: mastodon,
        connection: { instance: `http://127.0.0.1:${FAKE_PORT}` } as any,
        credential: { shape: 'oauth2', accessToken: 'x' } as any,
        externalRef: `http://127.0.0.1:${FAKE_PORT}/@who/123`,
      });
      provider.mastodonForbidden = false;
      assert(!out.ok && out.permanent === true,
        `a 403 came back as ${out.ok ? 'ok' : (out.permanent ? 'permanent' : 'retryable')}`);
      assert(!out.ok && /read:statuses/.test(out.reason),
        `the refusal does not name the missing scope: ${!out.ok ? out.reason : ''}`);

      // ...and the scope is actually requested now, so a NEW connection can read its own numbers.
      assert(mastodon.scopes.includes('read:statuses'),
        `Mastodon still does not ask for read:statuses: ${mastodon.scopes.join(' ')}`);
    });

    await test('every provider that can publish either reports numbers or says why not', async () => {
      // The gap this closes: a channel with no reader would show a permanent blank in a dashboard
      // next to channels that report, and read as the worst performer rather than as unmeasured.
      const { buildOutboundProviders } = await import('../src/services/connections/providers.js');
      const { METRIC_READERS_FOR_TEST } = await import('../src/services/connections/metrics.js');
      const all = buildOutboundProviders({
        connectionsEnabled: true,
        connectGoogleClientId: 'x', connectGoogleClientSecret: 'x',
        connectLinkedinClientId: 'x', connectLinkedinClientSecret: 'x',
        connectXClientId: 'x', connectXClientSecret: 'x',
        connectFakeBaseUrl: '', connectRedirectUri: 'https://example.test/cb',
      } as any);
      const publishers = all.filter(p => p.capabilities.length > 0 && p.id !== 'fake-static');
      const missing = publishers.filter(p => !METRIC_READERS_FOR_TEST[p.id]);
      assert(missing.length === 0, `can publish but has no metric reader: ${missing.map(p => p.id).join(', ')}`);
    });

    await test('read-metrics is advertised only where numbers can actually come back', async () => {
      // The bug this closes was RENDERED, not thrown. LÄHETIN put a "read the numbers" button on a
      // LinkedIn post because it had no way to ask, and every press spent a request to be told the
      // same permanent no — which a production user read as "this app does nothing". A capability an
      // app can ASK about costs nothing; finding out by calling costs a request and, on X, money.
      const { buildOutboundProviders } = await import('../src/services/connections/providers.js');
      const { METRIC_READERS_FOR_TEST } = await import('../src/services/connections/metrics.js');
      const all = buildOutboundProviders({
        connectionsEnabled: true,
        connectGoogleClientId: 'x', connectGoogleClientSecret: 'x',
        connectLinkedinClientId: 'x', connectLinkedinClientSecret: 'x',
        connectXClientId: 'x', connectXClientSecret: 'x',
        connectFakeBaseUrl: '', connectRedirectUri: 'https://example.test/cb',
      } as any);

      const claiming = all.filter(p => p.capabilities.includes('read-metrics'));
      assert(claiming.length > 0, 'no provider advertises read-metrics, so this test proves nothing');
      const unbacked = claiming.filter(p => !METRIC_READERS_FOR_TEST[p.id]);
      assert(unbacked.length === 0, `advertises read-metrics with no reader: ${unbacked.map(p => p.id).join(', ')}`);

      // LinkedIn is pinned because its refusal is UNCONDITIONAL — the reader exists so the caller
      // gets a reason rather than silence, and it can never return a number at the Consumer tier.
      // The day analytics becomes reachable, both this line and metrics.ts have to change together.
      const li = all.find(p => p.id === 'linkedin')!;
      assert(!li.capabilities.includes('read-metrics'),
        'LinkedIn advertises read-metrics, but its reader refuses every call at this tier');
      const out = await METRIC_READERS_FOR_TEST.linkedin({} as any);
      assert(!out.ok && out.permanent === true,
        'the LinkedIn reader stopped refusing permanently — the capability list must be revisited');
    });

    console.log(`\n${'─'.repeat(60)}\n  ${passed} passed, ${failed} failed\n`);
  } finally {
    await provider.close();
  }
  process.exit(failed === 0 ? 0 : 1);
}

void main();
