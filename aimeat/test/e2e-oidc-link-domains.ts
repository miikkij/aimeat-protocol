/**
 * @file test/e2e-oidc-link-domains.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The link domains of Casdoor and Microsoft Entra sign-in (auth.casdoor_link_domains,
 *   auth.entra_link_domains; services/oidc-providers.ts makeCasdoorLinkFence, makeEntraLinkFence,
 *   routes/oauth-login.ts): an address from the provider links the sign-in to an existing account of
 *   that address only inside the provider's link domains. e2e-oauth-login.ts holds the routes with no
 *   provider configured, and test/unit/oauth-login.test.ts the fences on their own; nothing signed in
 *   through a real provider with the setting set. This suite starts a node of its own with both
 *   providers pointed at a real OpenID Connect provider over HTTPS (test/helpers/fake-oidc-idp.ts),
 *   and two accounts with verified addresses, alice@trusted.example and bob@other.example:
 *     1. Casdoor, setting empty: no domain links, so alice's sign-in goes to the new-account step;
 *     2. the operator sets trusted.example: alice's sign-in opens her account, bob's does not, and an
 *        address Casdoor marks unverified does not link inside the domain either; `*` links bob;
 *     3. Entra pinned to one tenant, setting empty: every domain links (bob opens his account);
 *     4. the operator sets trusted.example: bob's sign-in goes to the new-account step, alice's opens
 *        her account; a token from another tenant is refused with ENTRA_WRONG_TENANT.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=oidc-link-domains
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (feature audit 2026-11-19, item 4.5).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { registerOwner, setupOperator } from './helpers/owner-login.js';
import { markEmailVerified } from './helpers/verified-email.js';
import { startFakeOidcIdp, type FakeOidcIdp } from './helpers/fake-oidc-idp.js';
import { BASE as RUNNER_BASE, assert, finish, json as runnerJson, test } from './helpers/harness.js';

const PORT = Number(new URL(RUNNER_BASE).port || '40251') + 264;
const BASE = `http://localhost:${PORT}`;
const NODE_ID = 'aimeat-local-001-dev';
const ADMIN_PW = 'oidc-link-admin-pw';
const TENANT = '11111111-2222-4333-8444-555555555555';
const OTHER_TENANT = '99999999-8888-4777-8666-555555555555';
const json = (path: string, opts: RequestInit = {}) => runnerJson(`${BASE}${path}`, opts);
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

type Outcome = { kind: 'signed-in' | 'new-account' | 'error'; location: string; account?: string };

/**
 * One whole sign-in, as a browser makes it: the start sets the round's cookie and sends the browser
 * to the provider, the provider sends it back with a code, and the callback says where it goes next.
 */
async function signIn(idp: FakeOidcIdp, provider: 'casdoor' | 'entra', claims: Record<string, unknown>): Promise<Outcome> {
  const start = await fetch(`${BASE}/v1/ghii/login/${provider}`, { redirect: 'manual' });
  assert(start.status === 302, `${provider} start: ${start.status} ${await start.text().catch(() => '')}`);
  const to = new URL(start.headers.get('location') ?? '');
  const state = to.searchParams.get('state') ?? '';
  const nonce = to.searchParams.get('nonce') ?? '';
  assert(state && nonce, `the redirect to the provider carries state and nonce: ${to}`);
  const cookie = start.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const code = randomUUID();
  idp.issueCode(code, { sub: randomUUID(), nonce, ...claims });
  const back = await fetch(`${BASE}/v1/ghii/login/${provider}/callback?code=${code}&state=${encodeURIComponent(state)}`, { redirect: 'manual', headers: { Cookie: cookie } });
  await back.arrayBuffer();
  const location = back.headers.get('location') ?? '';
  assert(back.status === 302, `${provider} callback: ${back.status} ${location}`);
  if (location.includes('auth_error=')) return { kind: 'error', location };
  if (location.includes('aimeat_signup=1')) return { kind: 'new-account', location };
  // Signed in: the refresh cookie the callback set names the account it opened.
  const session = back.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => /aimeat_rt=/.test(c)).join('; ');
  assert(session.includes('aimeat_rt='), `a sign-in sets the refresh cookie: ${JSON.stringify(back.headers.getSetCookie())}`);
  const r = await json('/v1/auth/refresh', { method: 'POST', headers: { Cookie: session, 'X-AIMEAT-Refresh': '1' }, body: '{}' });
  assert(r.status === 200 && typeof r.body.data?.token === 'string', `refresh: ${r.status} ${JSON.stringify(r.body?.error)}`);
  const claimsOf = JSON.parse(Buffer.from(String(r.body.data.token).split('.')[1], 'base64url').toString('utf8')) as { owner?: string; sub?: string };
  return { kind: 'signed-in', location, account: claimsOf.owner ?? claimsOf.sub };
}

console.log('\n=== Casdoor and Entra link domains, through a real provider ===\n');

const dir = mkdtempSync(join(tmpdir(), 'aimeat-oidc-'));
let idp!: FakeOidcIdp;
let child: ChildProcess | null = null;
let opToken = '';

const setDomains = async (path: string, value: string) => {
  const r = await json('/v1/admin/config', { method: 'PUT', headers: auth(opToken), body: JSON.stringify({ changes: [{ path, value }] }) });
  assert(r.status === 200 && !(r.body.data.errors ?? []).length, `set ${path}=${value}: ${r.status} ${JSON.stringify(r.body)}`);
};

try {
  console.log('Setup');
  await test('A node with Casdoor and Entra (one tenant) pointed at a real provider, and two accounts with verified addresses', async () => {
    idp = await startFakeOidcIdp(dir);
    const db = await ownNodeDb(`oidc-${PORT}`, { sqlitePath: join(dir, 'oidc.db') });
    child = spawn('node', [...nodeEntryArgs(), 'start', ...db.args], {
      cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env, ...db.env, ...idp.nodeEnv(),
        AIMEAT_PORT: String(PORT), AIMEAT_BASE_URL: BASE, AIMEAT_NODE_ID: NODE_ID, AIMEAT_NODE_TYPE: 'full',
        AIMEAT_ADMIN_PASSWORD: ADMIN_PW, AIMEAT_ANONYMOUS: 'false',
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000', AIMEAT_LOGIN_RATE_LIMIT_MAX: '1000',
        AIMEAT_GOOGLE_OAUTH_ENABLED: 'false',
        AIMEAT_CASDOOR_OAUTH_ENABLED: 'true', AIMEAT_CASDOOR_OAUTH_ENDPOINT: `https://localhost:${idp.port}`,
        AIMEAT_CASDOOR_OAUTH_CLIENT_ID: 'casdoor-e2e', AIMEAT_CASDOOR_OAUTH_CLIENT_SECRET: 'casdoor-e2e-secret',
        AIMEAT_CASDOOR_OAUTH_REDIRECT_URI: '', AIMEAT_CASDOOR_LINK_DOMAINS: '',
        AIMEAT_ENTRA_OAUTH_ENABLED: 'true', AIMEAT_ENTRA_OAUTH_TENANT: TENANT, AIMEAT_ENTRA_ALLOWED_TENANTS: '',
        AIMEAT_ENTRA_OAUTH_CLIENT_ID: 'entra-e2e', AIMEAT_ENTRA_OAUTH_CLIENT_SECRET: 'entra-e2e-secret',
        AIMEAT_ENTRA_OAUTH_REDIRECT_URI: '', AIMEAT_ENTRA_LINK_DOMAINS: '',
      },
    });
    let out = '';
    child.stdout?.on('data', (d) => { out += d; });
    child.stderr?.on('data', (d) => { out += d; });
    await waitForServer(child, BASE, { label: `the OIDC node on port ${PORT}` });
    const op = await setupOperator(BASE, ADMIN_PW, 'oidcop');
    opToken = op.token;
    await registerOwner(BASE, 'alice');
    await registerOwner(BASE, 'bob');
    const at = { sqlitePath: db.dbUrl || db.sqlitePath, nodeId: NODE_ID };
    await markEmailVerified('alice', 'alice@trusted.example', at);
    await markEmailVerified('bob', 'bob@other.example', at);
    // Discovery runs after the start, through the network: wait until both providers answer.
    for (const p of ['casdoor', 'entra']) {
      const deadline = Date.now() + 30_000;
      let status = 0;
      while (Date.now() < deadline) {
        status = (await fetch(`${BASE}/v1/ghii/login/${p}`, { redirect: 'manual' })).status;
        if (status === 302) break;
        await new Promise((r) => setTimeout(r, 300));
      }
      assert(status === 302, `${p} discovery did not finish (${status})\n--- node output ---\n${out.slice(-2000)}`);
    }
  });

  console.log('\n1. Casdoor, no link domain');
  await test('1. With the setting empty, alice\'s verified Casdoor address does not link: she goes to the new-account step', async () => {
    const o = await signIn(idp, 'casdoor', { email: 'alice@trusted.example', email_verified: true, name: 'Alice' });
    assert(o.kind === 'new-account', `expected the new-account step, got ${o.kind}: ${o.location}`);
  });

  console.log('\n2. Casdoor, trusted.example');
  await test('2a. The operator sets trusted.example: alice\'s Casdoor sign-in opens her account', async () => {
    await setDomains('auth.casdoor_link_domains', 'trusted.example');
    const o = await signIn(idp, 'casdoor', { email: 'alice@trusted.example', email_verified: true });
    assert(o.kind === 'signed-in' && o.account === 'alice', `expected alice signed in, got ${o.kind} ${o.account}: ${o.location}`);
  });

  await test('2b. FAILURE: bob\'s address is outside the domain, so it does not link', async () => {
    const o = await signIn(idp, 'casdoor', { email: 'bob@other.example', email_verified: true });
    assert(o.kind === 'new-account', `expected the new-account step, got ${o.kind}: ${o.location}`);
  });

  await test('2c. FAILURE: an address Casdoor marks unverified does not link inside the domain either', async () => {
    const o = await signIn(idp, 'casdoor', { email: 'alice@trusted.example', email_verified: false });
    assert(o.kind === 'new-account', `expected the new-account step, got ${o.kind}: ${o.location}`);
  });

  await test('2d. With `*` every domain links: bob\'s Casdoor sign-in opens his account', async () => {
    await setDomains('auth.casdoor_link_domains', '*');
    const o = await signIn(idp, 'casdoor', { email: 'bob@other.example', email_verified: true });
    assert(o.kind === 'signed-in' && o.account === 'bob', `expected bob signed in, got ${o.kind} ${o.account}: ${o.location}`);
  });

  console.log('\n3. Entra, one tenant, no link domain');
  await test('3. Behind one tenant with the setting empty every domain links: bob\'s Entra sign-in opens his account', async () => {
    const o = await signIn(idp, 'entra', { email: 'bob@other.example', tid: TENANT, name: 'Bob' });
    assert(o.kind === 'signed-in' && o.account === 'bob', `expected bob signed in, got ${o.kind} ${o.account}: ${o.location}`);
  });

  console.log('\n4. Entra, trusted.example');
  await test('4a. The operator sets trusted.example: bob\'s Entra address no longer links', async () => {
    await setDomains('auth.entra_link_domains', 'trusted.example');
    const o = await signIn(idp, 'entra', { email: 'bob@other.example', tid: TENANT });
    assert(o.kind === 'new-account', `expected the new-account step, got ${o.kind}: ${o.location}`);
  });

  await test('4b. alice\'s Entra address inside the domain opens her account', async () => {
    const o = await signIn(idp, 'entra', { preferred_username: 'alice@trusted.example', tid: TENANT });
    assert(o.kind === 'signed-in' && o.account === 'alice', `expected alice signed in, got ${o.kind} ${o.account}: ${o.location}`);
  });

  await test('4c. FAILURE: a token from another tenant is refused with ENTRA_WRONG_TENANT, whatever its address', async () => {
    const o = await signIn(idp, 'entra', { email: 'alice@trusted.example', tid: OTHER_TENANT });
    assert(o.kind === 'error' && o.location.includes('auth_error=ENTRA_WRONG_TENANT'), `expected ENTRA_WRONG_TENANT, got ${o.kind}: ${o.location}`);
  });
} finally {
  if (child) {
    const c = child as ChildProcess;
    c.kill('SIGKILL');
    if (c.exitCode === null && c.signalCode === null) await once(c, 'exit');
  }
  await idp?.close();
  rmSync(dir, { recursive: true, force: true });
}

finish();
