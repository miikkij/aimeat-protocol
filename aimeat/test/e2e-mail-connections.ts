/**
 * @file test/e2e-mail-connections.ts
 * @description The mail half of outbound connections, driven end to end against upstreams answered
 *   inside this process: the authorization round for Gmail and Outlook, every resource a mailbox
 *   declares, the alias list, the two send transports, the refresh, and the sentence a person is
 *   given when a connection can no longer be used.
 *
 *   WHY IT HAD NEVER BEEN TESTED. The mail providers address their upstreams with module constants
 *   — `https://gmail.googleapis.com/gmail/v1/users/me`, `https://graph.microsoft.com/v1.0/me`,
 *   `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` — and each provider's OAuth
 *   endpoints are literals inside its own `endpoints()` closure. There is no base-URL knob to point
 *   at a local stand-in the way `fake` has one, so eleven of sixteen functions in providers-mail.ts,
 *   four of six in send-mail.ts and the endpoints closures of five more providers had never been
 *   executed by anything. This suite replaces `globalThis.fetch`, which is safeFetch's last act
 *   before the wire, so the real service code runs with no request leaving the machine.
 *
 *   IT BOOTS THE NODE IN PROCESS, the pattern of e2e-attachment-sweep and e2e-money-audit, on its
 *   own port and its own SQLite file in a temp directory. Nothing here touches a shared node.
 * @structure boot (env, node, fake upstreams) · helpers · 16 phases, from discovery to the advice a
 *   dead connection gives
 * @usage cd aimeat && node --import tsx test/e2e-mail-connections.ts
 * @version-history
 *   v1.0.0 — 2026-09-08 — Initial.
 */
import { randomBytes, createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { RecordedCall } from './helpers/fake-mail-upstreams.js';

const PORT = parseInt(process.env.E2E_MAIL_PORT ?? '40286', 10);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = mkdtempSync(join(tmpdir(), 'aimeat-mail-e2e-'));
const TENANT = 'contoso-test-directory';

// Every one of these is read by loadConfig below, so they are set BEFORE it is called. The client
// credentials are what turn `enabled: false, disabledReason: 'no client credentials'` into a
// provider that can actually be connected.
Object.assign(process.env, {
  AIMEAT_PORT: String(PORT),
  AIMEAT_NODE_ID: 'aimeat-local-001-dev',
  AIMEAT_DEV_MODE: 'true',
  AIMEAT_TEST_MODE: 'true',
  AIMEAT_ANONYMOUS: 'true',
  AIMEAT_LOG_LEVEL: 'error',
  // The logger reads LOG_LEVEL, not the AIMEAT_ one beside it, so both are set: this suite
  // deliberately drives failure paths that log a warning each, and the assertions are the report.
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'error',
  AIMEAT_STORAGE: 'sqlite',
  AIMEAT_SQLITE_PATH: join(TMP, 'mail.db'),
  AIMEAT_ALLOW_PRIVATE_EGRESS: 'true',
  AIMEAT_CONNECTIONS_ENABLED: 'true',
  AIMEAT_CONNECT_GOOGLE_CLIENT_ID: 'google-client-id',
  AIMEAT_CONNECT_GOOGLE_CLIENT_SECRET: 'google-client-secret',
  AIMEAT_CONNECT_MICROSOFT_CLIENT_ID: 'microsoft-client-id',
  AIMEAT_CONNECT_MICROSOFT_CLIENT_SECRET: 'microsoft-client-secret',
  AIMEAT_CONNECT_MICROSOFT_TENANT: TENANT,
  AIMEAT_CONNECT_LINKEDIN_CLIENT_ID: 'linkedin-client-id',
  AIMEAT_CONNECT_LINKEDIN_CLIENT_SECRET: 'linkedin-client-secret',
  AIMEAT_CONNECT_X_CLIENT_ID: 'x-client-id',
  AIMEAT_CONNECT_X_CLIENT_SECRET: 'x-client-secret',
  // The stand-in provider stays OUT, so the provider list is exactly the nine a real node offers.
  AIMEAT_CONNECT_FAKE_BASE_URL: '',
  AIMEAT_CONNECT_REDIRECT_URI: `${BASE}/v1/connections/callback`,
  AIMEAT_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  AIMEAT_ADMIN_PASSWORD: process.env.AIMEAT_ADMIN_PASSWORD ?? randomBytes(12).toString('base64url'),
  AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '200',
  AIMEAT_LOGIN_RATE_LIMIT_MAX: '200',
  AIMEAT_OUTBOUND_DAILY_LIMIT: '200',
  AIMEAT_RL_GLOBAL: '10000',
  AIMEAT_RL_AUTH: '1000',
  AIMEAT_RL_MEMORY: '1000',
});

const { createServer } = await import('../src/server.js');
const { loadConfig } = await import('../src/config.js');
const { buildOutboundProviders, findProvider } = await import('../src/services/connections/providers.js');
const { requireEncryptionKey, sealCredential } = await import('../src/services/connections/credential.js');
const { listSendAsAliases, resolveMailboxSender, sendThroughMailbox } = await import('../src/services/connections/send-mail.js');
const { readResource } = await import('../src/services/connections/read.js');
const { ensureFreshCredential } = await import('../src/services/connections/refresh.js');
const { installFakeUpstreams } = await import('./helpers/fake-mail-upstreams.js');
type ConnectionCredential = import('../src/models/connection-schemas.js').ConnectionCredential;
type ConnectionRecord = import('../src/models/connection-schemas.js').ConnectionRecord;

const { config } = loadConfig({});
config.port = PORT;
const NODE_ID = config.nodeId;
const { app, storage } = await createServer(config);
// `ready` and `disconnect` are on the providers rather than on the Storage interface, which is why
// both are reached through a cast here, exactly as the other in-process suites reach them.
await (storage as { ready?: Promise<unknown> }).ready;
const server = await new Promise<Server>((resolve) => { const s = app.listen(PORT, '127.0.0.1', () => resolve(s)); });

const { up, restore } = installFakeUpstreams();
const KEY = requireEncryptionKey(config)!;
const ctx = { config, storage, providers: buildOutboundProviders(config), key: KEY };

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: boolean, msg: string): void { if (!cond) throw new Error(msg); }

interface Call { status: number; data: any }
async function api(path: string, opts: { method?: string; body?: unknown; bearer?: string } = {}): Promise<Call> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`;
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'POST', headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    redirect: 'manual',
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* redirect or plain text */ }
  return { status: res.status, data };
}

const readVia = (bearer: string, id: string, resource: string, params: Record<string, unknown> = {}): Promise<Call> =>
  api(`/v1/connections/${id}/read/${resource}`, { bearer, body: params });

/** The newest upstream request matching a predicate. Throws rather than returning undefined. */
function lastUpstream(pred: (c: RecordedCall) => boolean): RecordedCall {
  for (let i = up.calls.length - 1; i >= 0; i--) if (pred(up.calls[i])) return up.calls[i];
  throw new Error('no upstream call matched');
}

async function registerAndLogin(username: string, password: string): Promise<string> {
  const reg = await api('/v1/ghii', { body: { username, display_name: username, password } });
  assert(reg.status === 201 && reg.data?.ok, `register ${username}: ${reg.status} ${JSON.stringify(reg.data?.error)}`);
  const login = await api('/v1/ghii/login', { body: { username, password } });
  assert(login.status === 200 && login.data?.ok, `login ${username}: ${login.status}`);
  return login.data.data.token as string;
}

/** One full authorization round, returning the authorize URL and this owner's connections after it. */
async function connect(bearer: string, provider: string, opts: { instance?: string } = {}): Promise<{ authorizeUrl: string; connections: any[] }> {
  const start = await api('/v1/connections/start', {
    bearer,
    body: { provider, mode: 'personal', return_url: '/profile#access', ...(opts.instance ? { instance: opts.instance } : {}) },
  });
  assert(start.status === 200 && start.data?.ok, `start ${provider}: ${start.status} ${start.data?.error?.message}`);
  const state = start.data.data.state as string;
  const cb = await fetch(`${BASE}/v1/connections/callback?state=${encodeURIComponent(state)}&code=code-${provider}`, { redirect: 'manual' });
  assert(cb.status === 302, `callback ${provider}: ${cb.status} ${await cb.text()}`);
  const list = await api('/v1/connections', { method: 'GET', bearer });
  return { authorizeUrl: start.data.data.authorize_url as string, connections: list.data.data.connections as any[] };
}

const APP_REDIRECT = 'http://localhost:9933/callback';

/** Publish a throwaway app for `owner` and begin an app-grant round asking for `scopes`. */
async function startAppGrant(ownerBearer: string, ownerName: string, scopes: string[], verifier: string): Promise<Response> {
  const filename = `mail-gate-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.html`;
  const pub = await api('/v1/apps', {
    bearer: ownerBearer,
    body: {
      filename, content: Buffer.from('<!DOCTYPE html><html><body>gate</body></html>', 'utf8').toString('base64'),
      name: 'Mail gate probe', description: 'scope gate probe', category: 'tool',
    },
  });
  assert(pub.status === 201, `publish probe app: ${pub.status} ${pub.data?.error?.message}`);
  const q = new URLSearchParams({
    app: `${ownerName}/${filename}`, response_type: 'code', scope: scopes.join(' '),
    redirect_uri: APP_REDIRECT, state: 'x',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
  });
  return fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
}

/** An app-grant bearer carrying exactly `scopes` — role 'app', which never gets the owner bypass. */
async function grantAppToken(ownerBearer: string, ownerName: string, scopes: string[]): Promise<string> {
  const verifier = randomBytes(32).toString('base64url');
  const auth = await startAppGrant(ownerBearer, ownerName, scopes, verifier);
  assert(auth.status === 302, `authorize: ${auth.status}`);
  const requestId = decodeURIComponent(/req=([^&]+)/.exec(auth.headers.get('location') ?? '')![1]);
  const consent = await api('/v1/app-grants/authorize-consent', { bearer: ownerBearer, body: { request_id: requestId } });
  assert(consent.status === 200 && consent.data?.ok, `consent: ${consent.status}`);
  const code = new URL(consent.data.data.redirect_url as string).searchParams.get('code') ?? '';
  const tok = await api('/v1/app-grants/token', {
    body: { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: APP_REDIRECT },
  });
  assert(tok.status === 200 && tok.data?.ok, `app token: ${tok.status}`);
  return tok.data.data.access_token as string;
}

/** A connection row written straight into the store, for the states an authorization cannot produce. */
async function seed(id: string, provider: string, credential: ConnectionCredential, over: Partial<ConnectionRecord> = {}): Promise<string> {
  const now = new Date().toISOString();
  await storage.createConnection({
    id, principal: ownerGhii, mode: 'personal', provider, instance: null,
    accountLabel: up.mailbox, externalId: id,
    credential: sealCredential(credential, KEY), credentialShape: credential.shape,
    scopes: [], expiresAt: null, status: 'active', lastOkAt: now, lastError: null,
    providerClientId: null, createdAt: now, updatedAt: now, ...over,
  } as ConnectionRecord);
  return id;
}

/** Push a real connection's expiry inside the refresh skew, so the next use must renew. */
async function expireSoon(id: string): Promise<void> {
  const conn = (await storage.getConnection(id))!;
  await storage.updateConnectionCredential(conn.id, conn.credential, new Date(Date.now() + 1000).toISOString());
}

const stamp = Date.now();
const owner = `mx${stamp}`;
const ownerGhii = `${owner}@${NODE_ID}`;
const stranger = `mz${stamp}`;
const PW = 'M4ilConnPw!';
const RECIPIENT = `recipient-${stamp}@example.test`;

let jwt = '', jwtB = '';
let gmailRead = '', gmailSend = '', msRead = '', msSend = '', xConn = '', liConn = '';
let contactId = '';

console.log('\n=== AIMEAT MAIL CONNECTIONS — the upstreams nothing had ever reached ===\n');

try {
  console.log('Phase 0 — Owners');
  await test('two owners register and log in', async () => {
    jwt = await registerAndLogin(owner, PW);
    jwtB = await registerAndLogin(stranger, PW);
    assert(!!jwt && !!jwtB, 'no tokens');
  });

  console.log('\nPhase 1 — The four mail providers exist, and say why when they do not');
  await test('all four are advertised once their client credentials are present', async () => {
    const r = await api('/v1/connections/providers', { method: 'GET', bearer: jwt });
    const ids = (r.data.data.providers as any[]).map((p) => p.id);
    for (const id of ['google-mail', 'google-mail-send', 'microsoft-mail', 'microsoft-mail-send']) {
      assert(ids.includes(id), `${id} absent: ${ids.join(',')}`);
    }
    const meta = (r.data.data.providers as any[]).find((p) => p.id === 'google-mail');
    assert(meta.nodeConfigured === true, 'google-mail claims the node holds no client');
    assert(meta.capabilities.includes('read-mail'), `capabilities ${meta.capabilities.join(',')}`);
  });
  await test('with no client credentials each of the four names the keys that are missing', async () => {
    const bare = buildOutboundProviders({
      connectionsEnabled: true, connectGoogleClientId: '', connectGoogleClientSecret: '',
      connectMicrosoftClientId: '', connectMicrosoftClientSecret: '', connectMicrosoftTenant: 'common',
      connectRedirectUri: '', connectFakeBaseUrl: '',
    } as never);
    for (const [id, key] of [
      ['google-mail', 'GOOGLE'], ['google-mail-send', 'GOOGLE'],
      ['microsoft-mail', 'MICROSOFT'], ['microsoft-mail-send', 'MICROSOFT'],
    ]) {
      const p = findProvider(bare, id);
      assert(p?.enabled === false, `${id} enabled with no credentials`);
      assert((p?.disabledReason ?? '').includes(key), `${id} unhelpful reason: ${p?.disabledReason}`);
    }
  });
  await test('the capability switch beats the credentials', async () => {
    const off = buildOutboundProviders({
      connectionsEnabled: false, connectGoogleClientId: 'id', connectGoogleClientSecret: 'secret',
      connectMicrosoftClientId: 'id', connectMicrosoftClientSecret: 'secret', connectMicrosoftTenant: 'common',
      connectRedirectUri: '', connectFakeBaseUrl: '',
    } as never);
    const p = findProvider(off, 'microsoft-mail');
    assert(p?.enabled === false && (p?.disabledReason ?? '').includes('AIMEAT_CONNECTIONS_ENABLED'),
      `reason ${p?.disabledReason}`);
  });

  console.log('\nPhase 2 — The Gmail read round');
  await test('a full round connects the mailbox the provider named', async () => {
    const { authorizeUrl, connections } = await connect(jwt, 'google-mail');
    const conn = connections.find((c) => c.provider === 'google-mail');
    assert(!!conn, `no google-mail connection: ${JSON.stringify(connections)}`);
    assert(conn.accountLabel === up.mailbox, `label ${conn.accountLabel}`);
    assert(conn.status === 'active', `status ${conn.status}`);
    gmailRead = conn.id;

    const u = new URL(authorizeUrl);
    assert(u.host === 'accounts.google.com', `authorize host ${u.host}`);
    // Google returns no refresh token at all without these two, and the failure is silent.
    assert(u.searchParams.get('access_type') === 'offline', 'access_type=offline missing');
    assert(u.searchParams.get('prompt') === 'consent', 'prompt=consent missing');
    assert(u.searchParams.get('code_challenge_method') === 'S256', 'PKCE challenge missing');
    assert(u.searchParams.get('scope') === 'https://www.googleapis.com/auth/gmail.readonly',
      `scope ${u.searchParams.get('scope')}`);
  });
  await test('the secret went in the token BODY, and the identity came from the Gmail profile', async () => {
    const token = lastUpstream((c) => c.host === 'oauth2.googleapis.com' && c.path === '/token');
    assert(token.body.includes('client_secret=google-client-secret'), 'no client_secret in the body');
    assert(token.headers.authorization === undefined, 'a body-auth provider sent an Authorization header');
    const profile = lastUpstream((c) => c.host === 'gmail.googleapis.com' && c.path.endsWith('/profile'));
    assert(profile.headers.authorization?.startsWith('Bearer at-') === true, `auth header ${profile.headers.authorization}`);
  });

  console.log('\nPhase 3 — Every Gmail resource, through the read door');
  await test('the message list clamps the count and carries the query and the page token', async () => {
    const r = await readVia(jwt, gmailRead, 'messages', { limit: 500, query: 'from:acme', page_token: 'p2' });
    assert(r.status === 200, `${r.status} ${r.data?.error?.message}`);
    assert(Array.isArray(r.data.data.data.messages), 'no messages came back');
    const u = new URL(lastUpstream((c) => c.path === '/gmail/v1/users/me/messages').url);
    assert(u.searchParams.get('maxResults') === '100', `maxResults ${u.searchParams.get('maxResults')}`);
    assert(u.searchParams.get('q') === 'from:acme', `q ${u.searchParams.get('q')}`);
    assert(u.searchParams.get('pageToken') === 'p2', `pageToken ${u.searchParams.get('pageToken')}`);
  });
  await test('no count at all is the fallback, not zero', async () => {
    await readVia(jwt, gmailRead, 'messages', {});
    const u = new URL(lastUpstream((c) => c.path === '/gmail/v1/users/me/messages').url);
    assert(u.searchParams.get('maxResults') === '25', `maxResults ${u.searchParams.get('maxResults')}`);
    assert(!u.searchParams.has('q'), 'an empty query was sent as a parameter');
  });
  await test('one message comes back full by default and raw when asked', async () => {
    const full = await readVia(jwt, gmailRead, 'message', { id: 'm1' });
    assert(full.status === 200 && Array.isArray(full.data.data.data.payload.headers), 'no full message');
    assert(new URL(lastUpstream((c) => c.path === '/gmail/v1/users/me/messages/m1').url)
      .searchParams.get('format') === 'full', 'format was not full');
    const raw = await readVia(jwt, gmailRead, 'message', { id: 'm1', format: 'raw' });
    assert(typeof raw.data.data.data.raw === 'string', 'no raw message');
    assert(new URL(lastUpstream((c) => c.path === '/gmail/v1/users/me/messages/m1').url)
      .searchParams.get('format') === 'raw', 'format was not raw');
  });
  await test('an id that is not a Gmail id is refused before a token is spent', async () => {
    const before = up.calls.length;
    const r = await readVia(jwt, gmailRead, 'message', { id: '../../../evil' });
    assert(r.status === 400 && r.data.error.code === 'BAD_PARAMETERS', `${r.status} ${r.data?.error?.code}`);
    assert(up.calls.length === before, 'a refused parameter still reached the provider');
  });
  await test('an attachment is fetched by reference, and both ids are checked', async () => {
    const ok = await readVia(jwt, gmailRead, 'attachment', { message_id: 'm1', attachment_id: 'att-1' });
    assert(ok.status === 200 && typeof ok.data.data.data.data === 'string', `${ok.status}`);
    const badMsg = await readVia(jwt, gmailRead, 'attachment', { message_id: 'no/slashes', attachment_id: 'att-1' });
    assert(badMsg.status === 400 && /which message/.test(badMsg.data.error.message), `${badMsg.status}`);
    const badAtt = await readVia(jwt, gmailRead, 'attachment', { message_id: 'm1', attachment_id: '' });
    assert(badAtt.status === 400 && /which attachment/.test(badAtt.data.error.message), `${badAtt.status}`);
  });
  await test('the profile and the verified sender addresses are readable on the read scope alone', async () => {
    const profile = await readVia(jwt, gmailRead, 'profile');
    assert(profile.data.data.data.emailAddress === up.mailbox, 'profile did not name the mailbox');
    const sendAs = await readVia(jwt, gmailRead, 'sendAs');
    assert(sendAs.status === 200 && sendAs.data.data.data.sendAs.length === 3, 'sendAs did not answer');
    assert(lastUpstream((c) => c.host === 'gmail.googleapis.com').path.endsWith('/settings/sendAs'), 'wrong sendAs path');
  });
  await test('a resource the provider does not offer is named against the ones it does', async () => {
    const r = await readVia(jwt, gmailRead, 'calendar');
    assert(r.status === 400 && r.data.error.code === 'NO_SUCH_RESOURCE', `${r.status} ${r.data?.error?.code}`);
    assert(/messages/.test(r.data.error.message), `the refusal offers nothing: ${r.data.error.message}`);
  });
  await test('a connection granted a narrower scope is refused BY US, not by Google', async () => {
    // A second mailbox, connected with a scope Google narrowed. The refusal names the fix rather
    // than letting the provider answer 403 about nothing the person can act on.
    up.mailbox = `narrow-${stamp}@mail.example.test`;
    up.nextGrantedScope = 'https://www.googleapis.com/auth/gmail.metadata';
    const { connections } = await connect(jwt, 'google-mail');
    up.nextGrantedScope = null;
    const narrow = connections.find((c) => c.accountLabel === up.mailbox)!;
    up.mailbox = 'owner@mail.example.test';
    const before = up.calls.length;
    const r = await readVia(jwt, narrow.id, 'messages', {});
    assert(r.status === 403 && r.data.error.code === 'MISSING_PERMISSION', `${r.status} ${r.data?.error?.code}`);
    assert(up.calls.length === before, 'a scope-refused read still spent a request');
  });

  console.log('\nPhase 4 — Outlook: the tenant is in the path, and offline_access is a scope');
  await test('the Microsoft round authorizes against the configured directory', async () => {
    const { authorizeUrl, connections } = await connect(jwt, 'microsoft-mail');
    const conn = connections.find((c) => c.provider === 'microsoft-mail');
    assert(!!conn, 'no microsoft-mail connection');
    msRead = conn.id;
    assert(conn.accountLabel === up.mailbox, `label ${conn.accountLabel}`);
    const u = new URL(authorizeUrl);
    assert(u.pathname === `/${TENANT}/oauth2/v2.0/authorize`, `authorize path ${u.pathname}`);
    // Exactly inverted from Google: the scope carries it and the parameters must NOT be sent.
    assert(!u.searchParams.has('access_type'), 'Microsoft was sent access_type, which it ignores');
    assert((u.searchParams.get('scope') ?? '').includes('offline_access'), 'offline_access missing from the scopes');
    assert((u.searchParams.get('scope') ?? '').includes('User.Read'), 'User.Read missing, so there is no identity');
    const token = lastUpstream((c) => c.host === 'login.microsoftonline.com');
    assert(token.path === `/${TENANT}/oauth2/v2.0/token`, `token path ${token.path}`);
  });
  await test('the Graph message list searches OR filters, never both', async () => {
    await readVia(jwt, msRead, 'messages', { limit: 999, query: 'invoice', filter: "isRead eq false" });
    const searched = new URL(lastUpstream((c) => c.path === '/v1.0/me/messages').url);
    assert(searched.searchParams.get('$top') === '100', `$top ${searched.searchParams.get('$top')}`);
    assert(searched.searchParams.get('$search') === '"invoice"', `$search ${searched.searchParams.get('$search')}`);
    assert(!searched.searchParams.has('$filter'), 'both $search and $filter were sent, which Graph 400s');

    await readVia(jwt, msRead, 'messages', { filter: 'isRead eq false', page_token: 'nx' });
    const filtered = new URL(lastUpstream((c) => c.path === '/v1.0/me/messages').url);
    assert(filtered.searchParams.get('$filter') === 'isRead eq false', `$filter ${filtered.searchParams.get('$filter')}`);
    assert(filtered.searchParams.get('$skiptoken') === 'nx', `$skiptoken ${filtered.searchParams.get('$skiptoken')}`);
  });
  await test('a Graph message and attachment are readable, and their ids are checked', async () => {
    const msg = await readVia(jwt, msRead, 'message', { id: 'AAMkAGI2=' });
    assert(msg.status === 200 && msg.data.data.data.subject.startsWith('Invoice'), `${msg.status}`);
    const att = await readVia(jwt, msRead, 'attachment', { message_id: 'AAMkAGI2=', attachment_id: 'AAA=' });
    assert(att.status === 200 && typeof att.data.data.data.contentBytes === 'string', `${att.status}`);
    const bad = await readVia(jwt, msRead, 'message', { id: 'not/an/id' });
    assert(bad.status === 400 && bad.data.error.code === 'BAD_PARAMETERS', `${bad.status}`);
  });
  await test('the Graph profile is /me itself', async () => {
    const r = await readVia(jwt, msRead, 'profile');
    assert(r.data.data.data.mail === up.mailbox, 'profile did not name the mailbox');
    assert(lastUpstream((c) => c.host === 'graph.microsoft.com').path === '/v1.0/me', 'the profile was read from a sub-path');
  });

  console.log('\nPhase 5 — The two sending connections');
  await test('Gmail sending identifies itself through userinfo, not the mail profile', async () => {
    const mark = up.mark();
    const { connections } = await connect(jwt, 'google-mail-send');
    gmailSend = connections.find((c) => c.provider === 'google-mail-send')!.id;
    const since = up.since(mark);
    assert(since.some((c) => c.host === 'www.googleapis.com' && c.path === '/oauth2/v3/userinfo'),
      'the send connection did not read userinfo');
    assert(!since.some((c) => c.host === 'gmail.googleapis.com'),
      'gmail.send asked for the mail profile, which answers 403 with a valid token');
  });
  await test('Outlook sending identifies itself through Graph, in the same directory', async () => {
    const { connections } = await connect(jwt, 'microsoft-mail-send');
    msSend = connections.find((c) => c.provider === 'microsoft-mail-send')!.id;
    assert(lastUpstream((c) => c.host === 'login.microsoftonline.com').path === `/${TENANT}/oauth2/v2.0/token`,
      'the send half authorized against a different directory');
  });

  console.log('\nPhase 6 — The addresses a mailbox may send as');
  await test('the alias list is read through the sibling READ connection and drops the unverified', async () => {
    const res = await listSendAsAliases(ctx, ownerGhii, gmailSend);
    assert(!('code' in res), `refused: ${JSON.stringify(res)}`);
    const ok = res as { addresses: string[]; primary: string | null };
    assert(ok.addresses.includes('billing@mail.example.test'), `addresses ${ok.addresses.join(',')}`);
    assert(!ok.addresses.includes('pending@mail.example.test'), 'an unverified alias was offered');
    assert(ok.primary === 'owner@mail.example.test', `primary ${ok.primary}`);
  });
  await test('a mailbox the provider will not answer for is ALIAS_READ_FAILED, not an empty list', async () => {
    up.sendAsStatus = 503;
    const res = await listSendAsAliases(ctx, ownerGhii, gmailSend);
    up.sendAsStatus = null;
    assert('code' in res && res.code === 'ALIAS_READ_FAILED', `got ${JSON.stringify(res)}`);
  });
  await test('a send connection with no reading sibling says so instead of guessing', async () => {
    const orphan = await seed('orphan-send-1', 'google-mail-send', { shape: 'oauth2', accessToken: 'at-x' },
      { accountLabel: 'someone-else@mail.example.test' });
    const res = await listSendAsAliases(ctx, ownerGhii, orphan);
    assert('code' in res && res.code === 'NO_ALIAS_SOURCE', `got ${JSON.stringify(res)}`);
  });

  console.log('\nPhase 7 — Which mailbox, and may this caller use it');
  await test('a READ connection asked to send is refused with the sentence that names the fix', async () => {
    const res = await resolveMailboxSender(ctx, ownerGhii, gmailRead);
    assert('code' in res && res.code === 'MAILBOX_CANNOT_SEND', `got ${JSON.stringify(res)}`);
  });
  await test("someone else's mailbox and a missing one answer identically", async () => {
    const notYours = await resolveMailboxSender(ctx, `${stranger}@${NODE_ID}`, gmailSend);
    const missing = await resolveMailboxSender(ctx, ownerGhii, 'no-such-connection');
    assert('code' in notYours && notYours.code === 'NO_SUCH_MAILBOX', `not-yours: ${JSON.stringify(notYours)}`);
    assert(JSON.stringify(notYours) === JSON.stringify(missing), 'the two refusals differ, which enumerates connections');
  });
  await test('a mailbox waiting to be reconnected is refused before anything is composed', async () => {
    const parked = await seed('parked-send-1', 'google-mail-send', { shape: 'oauth2', accessToken: 'at-x' },
      { status: 'needs_reauth', lastError: 'the provider no longer accepts this authorization' });
    const res = await resolveMailboxSender(ctx, ownerGhii, parked);
    assert('code' in res && res.code === 'MAILBOX_NEEDS_REAUTH', `got ${JSON.stringify(res)}`);
    assert('message' in res && /no longer accepts/.test(res.message), `the reason was dropped: ${JSON.stringify(res)}`);
  });
  await test('an alias the provider has not verified is refused, with the ones it has', async () => {
    const res = await resolveMailboxSender(ctx, ownerGhii, gmailSend, 'pending@mail.example.test');
    assert('code' in res && res.code === 'ALIAS_NOT_VERIFIED', `got ${JSON.stringify(res)}`);
    assert('message' in res && /billing@mail.example.test/.test(res.message), 'the verified list was not offered');
  });
  await test('a verified alias resolves to itself, and no alias to the account address', async () => {
    const alias = await resolveMailboxSender(ctx, ownerGhii, gmailSend, 'billing@mail.example.test');
    assert(!('code' in alias) && alias.fromAddress === 'billing@mail.example.test', `got ${JSON.stringify(alias)}`);
    const plain = await resolveMailboxSender(ctx, ownerGhii, gmailSend);
    assert(!('code' in plain) && plain.fromAddress === up.mailbox, `got ${JSON.stringify(plain)}`);
  });

  console.log('\nPhase 8 — Sending through Gmail, from the outbound door');
  await test('a saved contact is the only recipient there is', async () => {
    const r = await api('/v1/outbound/contacts', { bearer: jwt, body: { name: 'Recipient', email: RECIPIENT } });
    assert(r.status === 201, `contact: ${r.status} ${r.data?.error?.message}`);
    contactId = r.data.data.contact.id as string;
  });
  await test('the message leaves as RFC 5322 through the mailbox, carrying every field it was given', async () => {
    const r = await api('/v1/outbound/send', {
      bearer: jwt,
      body: {
        contact_id: contactId, kind: 'transactional',
        subject: 'Kuukausiraportti', body: 'Tässä raportti.',
        connection_id: gmailSend, from_alias: 'billing@mail.example.test',
        reply_to: 'desk@example.test', ai_disclosure: 'ai-generated',
      },
    });
    assert(r.status === 200 && r.data.data.status === 'sent', `send: ${r.status} ${JSON.stringify(r.data?.error)}`);
    assert(r.data.data.channel === 'email', `channel ${r.data.data.channel}`);
    const raw = up.lastGmailRaw;
    assert(/^Subject: Kuukausiraportti/m.test(raw), 'the subject is not the message\'s Subject header');
    assert(raw.includes(RECIPIENT), 'the recipient is not in the message');
    assert(/^Reply-To: .*desk@example\.test/m.test(raw), 'Reply-To is missing');
    assert(/^X-AI-Disclosure: ai-generated/mi.test(raw), 'the disclosure header is missing');
    assert(/^From: .*billing@mail\.example\.test/m.test(raw), `the alias is not the From: ${raw.split('\r\n')[0]}`);
  });

  console.log('\nPhase 9 — Sending through Outlook, as a Graph message');
  await test('Graph is handed a JSON message with the recipient, the reply-to and the header', async () => {
    const r = await api('/v1/outbound/send', {
      bearer: jwt,
      body: {
        contact_id: contactId, kind: 'transactional',
        subject: 'Monthly report', body: 'Here it is.',
        connection_id: msSend, reply_to: 'desk@example.test', ai_disclosure: 'ai-assisted',
      },
    });
    assert(r.status === 200 && r.data.data.status === 'sent', `send: ${r.status} ${JSON.stringify(r.data?.error)}`);
    const sent = up.lastGraphSend!;
    assert(sent.message.subject === 'Monthly report', `subject ${sent.message.subject}`);
    assert(sent.message.toRecipients?.[0].emailAddress?.address === RECIPIENT, 'wrong recipient');
    assert(sent.message.replyTo?.[0].emailAddress?.address === 'desk@example.test', 'no replyTo');
    assert(sent.message.internetMessageHeaders?.some((h) => h.name === 'X-AI-Disclosure' && h.value === 'ai-assisted') === true,
      `headers ${JSON.stringify(sent.message.internetMessageHeaders)}`);
    assert(sent.saveToSentItems === true, 'it would not land in their Sent Items');
    // Deliberately absent: Mail.Send sends as the signed-in mailbox, and setting `from` is an
    // Exchange permission an administrator grants rather than a scope this can request.
    assert(!('from' in sent.message), 'Graph was sent a from address it may refuse');
  });

  console.log('\nPhase 10 — A file on the message, on both transports');
  await test('Gmail gets the attachment inside the MIME it composes', async () => {
    const res = await sendThroughMailbox(ctx,
      { connectionId: gmailSend, provider: 'google-mail-send', fromAddress: up.mailbox, accountAddress: up.mailbox },
      {
        to: RECIPIENT, subject: 'With a file', html: '<p>hi</p>', text: 'hi',
        fromName: 'The Sender',
        attachments: [{ filename: 'invoice.pdf', content: Buffer.from('%PDF-1.4 fake'), contentType: 'application/pdf' }],
      });
    assert(res.ok, `send failed: ${res.error}`);
    assert(up.lastGmailRaw.includes('invoice.pdf'), 'the attachment name is not in the message');
    assert(up.lastGmailRaw.includes(Buffer.from('%PDF-1.4 fake').toString('base64')), 'the attachment bytes are not in the message');
    assert(/^From: The Sender/m.test(up.lastGmailRaw), 'the display name was dropped');
  });
  await test('Graph gets the same file as base64 contentBytes', async () => {
    const res = await sendThroughMailbox(ctx,
      { connectionId: msSend, provider: 'microsoft-mail-send', fromAddress: up.mailbox, accountAddress: up.mailbox },
      {
        to: RECIPIENT, subject: 'With a file', html: '<p>hi</p>', text: 'hi',
        attachments: [{ filename: 'invoice.pdf', content: Buffer.from('%PDF-1.4 fake'), contentType: 'application/pdf' }],
      });
    assert(res.ok, `send failed: ${res.error}`);
    const att = up.lastGraphSend!.message.attachments![0];
    assert(att.name === 'invoice.pdf' && att.contentType === 'application/pdf', `attachment ${JSON.stringify(att)}`);
    assert(Buffer.from(att.contentBytes ?? '', 'base64').toString('utf8') === '%PDF-1.4 fake', 'the bytes did not survive');
  });

  console.log('\nPhase 11 — What the provider refusing means');
  const refusals: Array<[number, string]> = [[401, 'MAILBOX_NOT_PERMITTED'], [403, 'MAILBOX_NOT_PERMITTED'], [429, 'MAILBOX_RATE_LIMITED'], [500, 'MAILBOX_HTTP_500']];
  for (const [status, code] of refusals) {
    await test(`Gmail answering ${status} is recorded as ${code}`, async () => {
      up.nextSendStatus = status;
      const res = await sendThroughMailbox(ctx,
        { connectionId: gmailSend, provider: 'google-mail-send', fromAddress: up.mailbox, accountAddress: up.mailbox },
        { to: RECIPIENT, subject: 's', html: '<p>h</p>', text: 'h' });
      assert(!res.ok && res.error === code, `expected ${code}, got ${JSON.stringify(res)}`);
    });
  }
  await test('Graph answering 429 is the same code, because the mapping is shared', async () => {
    up.nextSendStatus = 429;
    const res = await sendThroughMailbox(ctx,
      { connectionId: msSend, provider: 'microsoft-mail-send', fromAddress: up.mailbox, accountAddress: up.mailbox },
      { to: RECIPIENT, subject: 's', html: '<p>h</p>', text: 'h' });
    assert(!res.ok && res.error === 'MAILBOX_RATE_LIMITED', `got ${JSON.stringify(res)}`);
  });

  console.log('\nPhase 12 — The other providers, and where each one puts its secret');
  await test('Mastodon registers at the instance once and authorizes against it', async () => {
    const { authorizeUrl, connections } = await connect(jwt, 'mastodon', { instance: 'mastodon.social' });
    assert(up.stats.instanceRegistrations === 1, `registrations ${up.stats.instanceRegistrations}`);
    assert(new URL(authorizeUrl).toString().startsWith('https://mastodon.social/oauth/authorize'), `authorize ${authorizeUrl}`);
    const conn = connections.find((c) => c.provider === 'mastodon')!;
    assert(conn.accountLabel === '@tester@mastodon.social', `label ${conn.accountLabel}`);
    assert(lastUpstream((c) => c.host === 'mastodon.social' && c.path === '/oauth/token').method === 'POST',
      'no token exchange at the instance');
  });
  await test('YouTube reaches the channel list, which is why it asks for the readonly scope too', async () => {
    const { connections } = await connect(jwt, 'youtube');
    const conn = connections.find((c) => c.provider === 'youtube')!;
    assert(conn.accountLabel === 'The Test Channel', `label ${conn.accountLabel}`);
    assert(lastUpstream((c) => c.host === 'www.googleapis.com').path === '/youtube/v3/channels', 'the channel was not read');
  });
  await test('LinkedIn is asked without PKCE and identified through OIDC userinfo', async () => {
    const { authorizeUrl, connections } = await connect(jwt, 'linkedin');
    assert(!new URL(authorizeUrl).searchParams.has('code_challenge'), 'LinkedIn was sent a PKCE challenge it does not document');
    const conn = connections.find((c) => c.provider === 'linkedin')!;
    liConn = conn.id;
    assert(conn.accountLabel === 'A Member', `label ${conn.accountLabel}`);
    assert(lastUpstream((c) => c.host === 'www.linkedin.com').path === '/oauth/v2/accessToken', 'wrong token endpoint');
  });
  await test('X authenticates at the token endpoint with Basic, and never puts the secret in the body', async () => {
    const { connections } = await connect(jwt, 'x');
    const conn = connections.find((c) => c.provider === 'x')!;
    xConn = conn.id;
    assert(conn.accountLabel === '@testhandle', `label ${conn.accountLabel}`);
    const token = lastUpstream((c) => c.host === 'api.x.com' && c.path === '/2/oauth2/token');
    const header = token.headers.authorization ?? '';
    assert(header.startsWith('Basic '), `no Basic header: ${header}`);
    assert(Buffer.from(header.slice(6), 'base64').toString() === 'x-client-id:x-client-secret',
      `the header decoded to ${Buffer.from(header.slice(6), 'base64').toString()}`);
    assert(!token.body.includes('x-client-secret'), 'the secret was ALSO put in the body');
    assert(token.body.includes('client_id=x-client-id'), 'client_id must still be in the body');
  });
  await test('Bluesky has no OAuth endpoints, so revoking it is local and says so', async () => {
    const attach = await api('/v1/connections/attach', {
      bearer: jwt, body: { provider: 'bluesky', fields: { identifier: 'tester.bsky.social', password: 'app-pw-1234' } },
    });
    assert(attach.status === 201, `attach: ${attach.status} ${attach.data?.error?.message}`);
    const id = attach.data.data.connection.id as string;
    const del = await api(`/v1/connections/${id}`, { method: 'DELETE', bearer: jwt });
    assert(del.status === 200 && del.data.data.revoked === true, `revoke: ${del.status}`);
    assert(del.data.data.told_provider === false, 'a provider with no revoke endpoint was reported as told');
  });
  await test('Google was told about a revocation, because it offers a way to be told', async () => {
    const before = up.stats.revocations;
    const narrow = (await storage.listConnections({ principal: ownerGhii, provider: 'google-mail' }))
      .find((c) => c.accountLabel.startsWith('narrow-'))!;
    const del = await api(`/v1/connections/${narrow.id}`, { method: 'DELETE', bearer: jwt });
    assert(del.status === 200 && del.data.data.told_provider === true, `revoke: ${del.status}`);
    assert(up.stats.revocations === before + 1, 'the provider recorded no revocation');
  });

  console.log('\nPhase 13 — Publishing, for the two recipes a mail suite can reach');
  await test('an X post goes out as text and comes back as a permalink', async () => {
    const r = await api('/v1/connections/publish', {
      bearer: jwt, body: { connection_id: xConn, caption: `hello from the suite ${stamp}` },
    });
    assert(r.status === 200, `publish: ${r.status} ${r.data?.error?.message}`);
    assert(r.data.data.url === 'https://x.com/testhandle/status/1900000000000000001', `url ${r.data.data.url}`);
    assert((up.lastXPost as { text?: string }).text === `hello from the suite ${stamp}`, 'the caption did not arrive');
  });
  await test("LinkedIn's little-text markup is escaped rather than posted raw", async () => {
    const r = await api('/v1/connections/publish', {
      bearer: jwt, body: { connection_id: liConn, caption: `Report (Q3) for @acme ~ ${stamp}` },
    });
    assert(r.status === 200, `publish: ${r.status} ${r.data?.error?.message}`);
    const commentary = (up.lastLinkedinPost as { commentary?: string }).commentary ?? '';
    assert(commentary.includes('\\(Q3\\)'), `brackets were not escaped: ${commentary}`);
    assert(commentary.includes('\\@acme'), `the at-sign was not escaped: ${commentary}`);
    assert(r.data.data.url === 'https://www.linkedin.com/feed/update/urn:li:share:777/', `url ${r.data.data.url}`);
  });

  console.log('\nPhase 14 — Two words for two acts');
  await test('outbound:send alone cannot reach a connected mailbox', async () => {
    const appToken = await grantAppToken(jwt, owner, ['outbound:send']);
    const r = await api('/v1/outbound/send', {
      bearer: appToken,
      body: { contact_id: contactId, kind: 'transactional', subject: 's', body: 'b', connection_id: gmailSend },
    });
    assert(r.status === 403 && r.data.error.code === 'SCOPE_REQUIRED', `${r.status} ${r.data?.error?.code}`);
  });
  await test('with connections:use as well, the same request goes', async () => {
    const appToken = await grantAppToken(jwt, owner, ['outbound:send', 'connections:use']);
    const r = await api('/v1/outbound/send', {
      bearer: appToken,
      body: { contact_id: contactId, kind: 'transactional', subject: 'scoped', body: 'b', connection_id: gmailSend },
    });
    assert(r.status === 200 && r.data.data.status === 'sent', `${r.status} ${JSON.stringify(r.data?.error)}`);
  });
  await test('an app holding connections:use can name a connection AND read through it', async () => {
    const appToken = await grantAppToken(jwt, owner, ['connections:use']);
    const list = await api('/v1/connections', { method: 'GET', bearer: appToken });
    assert(list.status === 200, `an app that may publish cannot name a connection: ${list.status}`);
    const r = await readVia(appToken, gmailRead, 'messages', {});
    assert(r.status === 200, `${r.status} ${r.data?.error?.message}`);
  });
  await test('an app holding neither word cannot read a mailbox', async () => {
    const appToken = await grantAppToken(jwt, owner, ['memory:read']);
    const r = await readVia(appToken, gmailRead, 'messages', {});
    assert(r.status === 403, `the mailbox was read without connections:use: ${r.status}`);
  });
  await test('connections:read is not a word an app may ask for at all', async () => {
    // TODAY'S BEHAVIOUR, asserted rather than assumed. APP_GRANTABLE_SCOPES
    // (src/routes/app-grant-vocabulary.ts:56-59) carries `connections:use` and deliberately not
    // `connections:read` or `connections:write`, so the authorize round refuses the word instead of
    // issuing a token that could not use it. An app therefore reaches the connection LIST through
    // requireAnyScope('connections:read','connections:use') and never through the first word.
    const auth = await startAppGrant(jwt, owner, ['connections:read'], 'a-verifier');
    assert(auth.status === 400, `connections:read was accepted for an app: ${auth.status}`);
  });

  console.log('\nPhase 15 — Renewing a token that is about to die');
  await test('a token inside the skew is replaced, and the new refresh token is kept', async () => {
    const before = up.stats.refreshes;
    await expireSoon(gmailRead);
    const r = await readVia(jwt, gmailRead, 'profile');
    assert(r.status === 200, `the read after a refresh failed: ${r.status} ${r.data?.error?.message}`);
    assert(up.stats.refreshes === before + 1, `expected 1 refresh, got ${up.stats.refreshes - before}`);
    const conn = (await storage.getConnection(gmailRead))!;
    assert(new Date(conn.expiresAt!).getTime() > Date.now() + 60_000, `expiry did not move: ${conn.expiresAt}`);
    const refresh = lastUpstream((c) => c.host === 'oauth2.googleapis.com' && c.body.includes('grant_type=refresh_token'));
    assert(refresh.body.includes('client_secret=google-client-secret'), 'the refresh authenticated differently from the exchange');
  });
  await test('a second renewal presents the ROTATED token, never the retired one', async () => {
    const stale = up.stats.staleRefreshAttempts;
    await expireSoon(gmailRead);
    await readVia(jwt, gmailRead, 'profile');
    assert(up.stats.staleRefreshAttempts === stale, `an already-retired token was presented ${up.stats.staleRefreshAttempts - stale} time(s)`);
  });
  await test('two overlapping renewals reach the provider ONCE', async () => {
    await expireSoon(gmailRead);
    const before = up.stats.refreshes;
    const stale = up.stats.staleRefreshAttempts;
    up.refreshDelayMs = 400;
    const [a, b] = await Promise.all([ensureFreshCredential(ctx, gmailRead), ensureFreshCredential(ctx, gmailRead)]);
    up.refreshDelayMs = 0;
    assert(a.ok && b.ok, `a caller failed: ${JSON.stringify([a, b])}`);
    assert(up.stats.refreshes === before + 1, `the provider performed ${up.stats.refreshes - before} refreshes`);
    assert(up.stats.staleRefreshAttempts === stale, 'a retired token was presented');
    assert(a.ok && b.ok && a.credential.accessToken === b.credential.accessToken, 'the two callers hold different tokens');
  });
  await test('the Outlook renewal goes to the directory that issued the token', async () => {
    await expireSoon(msRead);
    const r = await readVia(jwt, msRead, 'profile');
    assert(r.status === 200, `${r.status} ${r.data?.error?.message}`);
    assert(lastUpstream((c) => c.host === 'login.microsoftonline.com').path === `/${TENANT}/oauth2/v2.0/token`,
      'the refresh renewed against a different directory');
  });
  await test('a grant the provider no longer honours parks the connection instead of retrying', async () => {
    const dead = await seed('dead-refresh-1', 'google-mail',
      { shape: 'oauth2', accessToken: 'at-dead', refreshToken: 'rt-dead' },
      { expiresAt: new Date(Date.now() + 1000).toISOString() });
    up.breakRefresh = true;
    const r = await ensureFreshCredential(ctx, dead);
    up.breakRefresh = false;
    assert(!r.ok && r.code === 'NEEDS_REAUTH', `got ${JSON.stringify(r)}`);
    const parked = await storage.getConnection(dead);
    assert(parked?.status === 'needs_reauth' && !!parked.lastError, `status ${parked?.status}`);
  });
  await test('an expiring token with nothing to renew it with is finished, and says so', async () => {
    const noRt = await seed('no-refresh-1', 'google-mail', { shape: 'oauth2', accessToken: 'at-only' },
      { expiresAt: new Date(Date.now() + 1000).toISOString() });
    const r = await ensureFreshCredential(ctx, noRt);
    assert(!r.ok && r.code === 'NEEDS_REAUTH', `got ${JSON.stringify(r)}`);
    const parked = await storage.getConnection(noRt);
    assert(parked?.lastError === 'no refresh token; reconnect this account', `reason ${parked?.lastError}`);
  });

  console.log('\nPhase 16 — What a dead connection tells the person');
  await test('a connection that is not here says exactly that', async () => {
    const r = await readResource(ctx, 'nothing-by-that-name', 'messages', {});
    assert(!r.ok && r.code === 'NOT_FOUND', `got ${JSON.stringify(r)}`);
    assert(!r.ok && r.message === 'That connection is not here. It may have been removed.', `advice: ${!r.ok ? r.message : ''}`);
  });
  await test('a switched-off connection is told to be connected again', async () => {
    const revoked = await seed('revoked-1', 'google-mail', { shape: 'oauth2', accessToken: 'at-x' });
    await storage.setConnectionStatus(revoked, 'revoked', null);
    const r = await readResource(ctx, revoked, 'messages', {});
    assert(!r.ok && r.code === 'REVOKED', `got ${JSON.stringify(r)}`);
    assert(!r.ok && /Connect the account again/.test(r.message), `advice: ${!r.ok ? r.message : ''}`);
  });
  await test('a credential this node can no longer open is reconnect advice, not a 500', async () => {
    const now = new Date().toISOString();
    await storage.createConnection({
      id: 'unreadable-1', principal: ownerGhii, mode: 'personal', provider: 'google-mail', instance: null,
      accountLabel: up.mailbox, externalId: 'unreadable-1',
      // Ciphertext from a key this node does not hold: a rotated key, or a restored backup.
      credential: 'aaaaaaaaaaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:cccccccc',
      credentialShape: 'oauth2', scopes: [], expiresAt: null, status: 'active',
      lastOkAt: now, lastError: null, providerClientId: null, createdAt: now, updatedAt: now,
    } as ConnectionRecord);
    const r = await readResource(ctx, 'unreadable-1', 'messages', {});
    assert(!r.ok && r.code === 'UNREADABLE', `got ${JSON.stringify(r)}`);
    assert(!r.ok && /cannot be read any more/.test(r.message), `advice: ${!r.ok ? r.message : ''}`);
    assert((await storage.getConnection('unreadable-1'))?.status === 'needs_reauth', 'it was not parked');
  });
  await test('any other failure carries the provider reason into the advice', async () => {
    const dead = await seed('advice-default-1', 'google-mail',
      { shape: 'oauth2', accessToken: 'at-x', refreshToken: 'rt-x' },
      { expiresAt: new Date(Date.now() + 1000).toISOString() });
    up.breakRefresh = true;
    const r = await readResource(ctx, dead, 'messages', {});
    up.breakRefresh = false;
    assert(!r.ok && r.code === 'NEEDS_REAUTH', `got ${JSON.stringify(r)}`);
    assert(!r.ok && /This connection cannot be used right now: .*Connecting the account again/.test(r.message),
      `advice: ${!r.ok ? r.message : ''}`);
  });
} finally {
  restore();
  server.close();
  await (storage as { disconnect?: () => Promise<void> }).disconnect?.();
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* Windows may still hold the file */ }
}

console.log(`\n═══ MAIL CONNECTIONS: ${passed} passed, ${failed} failed (${passed + failed} total) ═══\n`);
process.exit(failed > 0 ? 1 : 0);
