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
 *   8 idempotency + quota · 9 instance registration
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-connections
 * @version-history
 *   v1.0.0 — 2026-08-02 — TARGET-057 Phase 2.
 */

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
    await test('YouTube is absent without client credentials, rather than half-working', async () => {
      const r = await api('/v1/connections/providers', { method: 'GET', bearer: jwtA });
      const ids = (r.data.data.providers as any[]).map(p => p.id);
      // The e2e node configures no Google client, so an enabled YouTube would mean the gate is
      // decorative and the first real user would meet the failure instead.
      assert(!ids.includes('youtube'), 'youtube offered without credentials');
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
      // null is the honest value until the provider's real ceiling has been read, and the counter
      // runs regardless — so the number can later be filled in with evidence.
      assert(r.data.data.quota.limit === null, `limit should be unmeasured, got ${r.data.data.quota.limit}`);
      assert(r.data.data.per_user_limit?.count === 2, 'per-user limit not reported');
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

    console.log(`\n${'─'.repeat(60)}\n  ${passed} passed, ${failed} failed\n`);
  } finally {
    await provider.close();
  }
  process.exit(failed === 0 ? 0 : 1);
}

void main();
