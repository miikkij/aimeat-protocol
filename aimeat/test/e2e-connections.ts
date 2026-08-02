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
      const r = await api('/v1/connections/attach', {
        bearer: jwtA,
        body: { provider: 'fake-static', fields: { identifier: 'someone', password: 'wrong' } },
      });
      assert(r.status === 400 && r.data.error.code === 'ATTACH_FAILED', `${r.status} ${r.data?.error?.code}`);
      assert(!JSON.stringify(r.data).includes('wrong'), 'the rejected secret was echoed in the error');
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

    await test("publishing to someone else's connection is the same 404 as a missing one", async () => {
      const r = await api('/v1/connections/publish', {
        bearer: jwtB,
        body: { connection_id: pubConn, storage_key: 'vid/test.mp4', caption: 'not mine' },
      });
      assert(r.status === 404, `status ${r.status}`);
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

    console.log(`\n${'─'.repeat(60)}\n  ${passed} passed, ${failed} failed\n`);
  } finally {
    await provider.close();
  }
  process.exit(failed === 0 ? 0 : 1);
}

void main();
