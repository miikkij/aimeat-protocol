/**
 * @file test/e2e-publish-upstreams.ts
 * @description The publishing half of outbound connections, driven end to end against upstreams
 *   answered inside this process: Mastodon's media upload and its transcode wait, YouTube's
 *   resumable session and the resume query that follows an interruption, Bluesky's createRecord,
 *   LinkedIn's two-step image, X's refusals, and the metric reader behind each one.
 *
 *   WHY IT HAD NEVER BEEN TESTED. Every recipe in services/connections/publish.ts addresses its
 *   provider with a literal — `https://www.googleapis.com/upload/youtube/v3/videos`,
 *   `https://api.linkedin.com/rest/posts`, `https://bsky.social/xrpc/...` — and the only publish a
 *   suite had ever driven was the stand-in provider's, which has a base-URL knob. So the three
 *   hundred lines that decide whether a video is resumed or resent, whether a refusal is final, and
 *   whether a number came from the platform or was invented, had never been executed by anything.
 *   This suite replaces `globalThis.fetch`, which is safeFetch's last act before the wire, so the
 *   real service code runs with no request leaving the machine.
 *
 *   THE TWO THINGS IT IS ACTUALLY ABOUT. A provider refusing the CONTENT is final and a provider
 *   being unreachable is not, and every recipe here is asserted on which of the two it produced —
 *   `rejected` never retries, `failed` may. And a number nobody reported is null rather than zero,
 *   because a dashboard that averages invented zeros lies confidently.
 *
 *   IT BOOTS THE NODE IN PROCESS, the pattern of e2e-mail-connections, on its own port and its own
 *   SQLite file in a temp directory. Nothing here touches a shared node.
 * @structure boot (env, node, fake upstreams) · helpers · 15 phases, from the Mastodon media upload
 *   to who may publish at all
 * @usage cd aimeat && node --import tsx test/e2e-publish-upstreams.ts
 * @version-history
 *   v1.0.0 — 2026-09-08 — Initial.
 */
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { RecordedCall } from './helpers/fake-mail-upstreams.js';

const PORT = parseInt(process.env.E2E_PUBLISH_PORT ?? '40317', 10);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = mkdtempSync(join(tmpdir(), 'aimeat-publish-e2e-'));

// Read by loadConfig below, so they are set BEFORE it is called. The client credentials are what
// turn `enabled: false, disabledReason: 'no client credentials'` into a connectable provider.
Object.assign(process.env, {
  AIMEAT_PORT: String(PORT),
  AIMEAT_NODE_ID: 'aimeat-local-001-dev',
  AIMEAT_DEV_MODE: 'true',
  AIMEAT_TEST_MODE: 'true',
  AIMEAT_ANONYMOUS: 'true',
  AIMEAT_LOG_LEVEL: 'error',
  // The logger reads LOG_LEVEL, not the AIMEAT_ one beside it, so both are set: this suite drives
  // failure paths that log a warning each, and the assertions are the report.
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'error',
  AIMEAT_STORAGE: 'sqlite',
  AIMEAT_SQLITE_PATH: join(TMP, 'publish.db'),
  AIMEAT_ALLOW_PRIVATE_EGRESS: 'true',
  AIMEAT_CONNECTIONS_ENABLED: 'true',
  AIMEAT_CONNECT_GOOGLE_CLIENT_ID: 'google-client-id',
  AIMEAT_CONNECT_GOOGLE_CLIENT_SECRET: 'google-client-secret',
  AIMEAT_CONNECT_LINKEDIN_CLIENT_ID: 'linkedin-client-id',
  AIMEAT_CONNECT_LINKEDIN_CLIENT_SECRET: 'linkedin-client-secret',
  AIMEAT_CONNECT_X_CLIENT_ID: 'x-client-id',
  AIMEAT_CONNECT_X_CLIENT_SECRET: 'x-client-secret',
  // The stand-in provider stays OUT: its recipe has a base-URL knob and is already covered, and its
  // presence would let a test pass against something no real node runs.
  AIMEAT_CONNECT_FAKE_BASE_URL: '',
  AIMEAT_CONNECT_REDIRECT_URI: `${BASE}/v1/connections/callback`,
  AIMEAT_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  AIMEAT_ADMIN_PASSWORD: process.env.AIMEAT_ADMIN_PASSWORD ?? randomBytes(12).toString('base64url'),
  AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '200',
  AIMEAT_LOGIN_RATE_LIMIT_MAX: '200',
  AIMEAT_RL_GLOBAL: '10000',
  AIMEAT_RL_AUTH: '1000',
  AIMEAT_RL_MEMORY: '1000',
});

const { createServer } = await import('../src/server.js');
const { loadConfig } = await import('../src/config.js');
const { buildOutboundProviders, findProvider } = await import('../src/services/connections/providers.js');
const { requireEncryptionKey, sealCredential } = await import('../src/services/connections/credential.js');
const { readMetrics } = await import('../src/services/connections/metrics.js');
const { installFakeUpstreams } = await import('./helpers/fake-mail-upstreams.js');
type ConnectionCredential = import('../src/models/connection-schemas.js').ConnectionCredential;
type ConnectionRecord = import('../src/models/connection-schemas.js').ConnectionRecord;
type PublishAttempt = import('../src/models/connection-schemas.js').PublishAttempt;

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

/** One full authorization round, returning this owner's connections after it. */
async function connect(bearer: string, provider: string, opts: { instance?: string } = {}): Promise<any[]> {
  const start = await api('/v1/connections/start', {
    bearer,
    body: { provider, mode: 'personal', return_url: '/profile#access', ...(opts.instance ? { instance: opts.instance } : {}) },
  });
  assert(start.status === 200 && start.data?.ok, `start ${provider}: ${start.status} ${start.data?.error?.message}`);
  const state = start.data.data.state as string;
  const cb = await fetch(`${BASE}/v1/connections/callback?state=${encodeURIComponent(state)}&code=code-${provider}`, { redirect: 'manual' });
  assert(cb.status === 302, `callback ${provider}: ${cb.status} ${await cb.text()}`);
  const list = await api('/v1/connections', { method: 'GET', bearer });
  return list.data.data.connections as any[];
}

const APP_REDIRECT = 'http://localhost:9933/callback';

/** An app-grant bearer carrying exactly `scopes` — role 'app', which never gets the owner bypass. */
async function grantAppToken(ownerBearer: string, ownerName: string, scopes: string[]): Promise<string> {
  const verifier = randomBytes(32).toString('base64url');
  const filename = `publish-gate-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.html`;
  const pub = await api('/v1/apps', {
    bearer: ownerBearer,
    body: {
      filename, content: Buffer.from('<!DOCTYPE html><html><body>gate</body></html>', 'utf8').toString('base64'),
      name: 'Publish gate probe', description: 'scope gate probe', category: 'tool',
    },
  });
  assert(pub.status === 201, `publish probe app: ${pub.status} ${pub.data?.error?.message}`);
  const q = new URLSearchParams({
    app: `${ownerName}/${filename}`, response_type: 'code', scope: scopes.join(' '),
    redirect_uri: APP_REDIRECT, state: 'x',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
  });
  const auth = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
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
async function seedConnection(
  id: string, provider: string, credential: ConnectionCredential, over: Partial<ConnectionRecord> = {},
): Promise<string> {
  const now = new Date().toISOString();
  await storage.createConnection({
    id, principal: ownerGhii, mode: 'personal', provider, instance: null,
    accountLabel: `${provider} seed`, externalId: id,
    credential: sealCredential(credential, KEY), credentialShape: credential.shape,
    scopes: [], expiresAt: null, status: 'active', lastOkAt: now, lastError: null,
    providerClientId: null, createdAt: now, updatedAt: now, ...over,
  } as ConnectionRecord);
  return id;
}

/**
 * An attempt in a finished state, written straight into the store.
 *
 * The reference is the point: each metric reader recovers its own provider's id from the URL its own
 * recipe stored, and the refusals for a reference it does not recognise are only reachable by
 * putting an unrecognisable one there.
 */
async function seedAttempt(
  connectionId: string, externalRef: string, status: PublishAttempt['status'] = 'done',
): Promise<string> {
  const id = randomUUID();
  await storage.openPublishAttempt({
    id, idempotencyKey: randomUUID(), publisher: ownerGhii, connectionId,
    delegationId: null, storageKey: '', status: 'in_flight',
  });
  await storage.updatePublishAttempt(id, { status, externalRef });
  return id;
}

const stamp = Date.now();
const owner = `px${stamp}`;
const ownerGhii = `${owner}@${NODE_ID}`;
const stranger = `pz${stamp}`;
const PW = 'Publ1shPw!';

let captions = 0;
/**
 * A caption nothing has used before.
 *
 * The idempotency key is (publisher, connection, storage key, caption), so two tests sharing a
 * caption would make the second one a replay that published nothing and asserted the first one's
 * outcome. Every publish below therefore takes its caption from here.
 */
const caption = (what: string): string => `${what} ${stamp}-${++captions}`;

// The files. BIG is over one 2 MiB chunk three times over, so the resumable loop actually iterates;
// MID is two chunks, which leaves room for the resume probe to land inside the first one.
const CLIP = Buffer.from('a small clip, but real bytes', 'utf8');
const BIG = Buffer.alloc(5 * 1024 * 1024, 0x62);
const MID = Buffer.alloc(2560 * 1024, 0x63);
const CARD = Buffer.from('\x89PNG\r\n\x1a\nfake card bytes', 'binary');
const DOC = Buffer.from('%PDF-1.4 fake', 'utf8');
const CHUNK = 8 * 256 * 1024;

async function store(key: string, mime: string, bytes: Buffer): Promise<void> {
  const r = await api('/v1/storage', {
    bearer: jwt,
    body: { key, visibility: 'private', mime_type: mime, data: bytes.toString('base64') },
  });
  assert(r.status === 201, `storage put ${key}: ${r.status} ${r.data?.error?.message}`);
}

const publish = (body: Record<string, unknown>, bearer = jwt): Promise<Call> =>
  api('/v1/connections/publish', { bearer, body });

/** POST a metric reading. The route is a POST because it spends a request, and on X real money. */
const readSample = (attemptId: string, bearer = jwt): Promise<Call> =>
  api(`/v1/connections/attempts/${attemptId}/metrics`, { bearer });

const series = (attemptId: string): Promise<Call> =>
  api(`/v1/connections/attempts/${attemptId}/metrics`, { method: 'GET', bearer: jwt });

/** One refusal, driven through the real route: set the knob, publish, read the recorded outcome. */
interface Refusal {
  name: string;
  arm: () => void;
  body: Record<string, unknown>;
  /** REJECTED is permanent and must never be retried; PUBLISH_FAILED may be. */
  code: 'REJECTED' | 'PUBLISH_FAILED';
  says: RegExp;
}

async function drive(cases: Refusal[]): Promise<void> {
  for (const c of cases) {
    await test(c.name, async () => {
      c.arm();
      const r = await publish({ ...c.body, caption: caption(c.name) });
      assert(r.status === 502, `${r.status} ${JSON.stringify(r.data?.error)}`);
      assert(r.data.error.code === c.code, `expected ${c.code}, got ${r.data.error.code}: ${r.data.error.message}`);
      assert(c.says.test(r.data.error.message), `the reason does not say what happened: ${r.data.error.message}`);
    });
  }
}

/** One metric refusal. 409 is "the platform will not tell you this"; 502 is "not right now". */
async function driveMetrics(
  cases: Array<{ name: string; arm: () => void; attempt: () => string; status: 409 | 502; says: RegExp }>,
): Promise<void> {
  for (const c of cases) {
    await test(c.name, async () => {
      c.arm();
      const r = await readSample(c.attempt());
      assert(r.status === c.status, `${r.status} ${JSON.stringify(r.data?.error)}`);
      const expected = c.status === 409 ? 'NOT_MEASURABLE' : 'METRICS_UNAVAILABLE';
      assert(r.data.error.code === expected, `expected ${expected}, got ${r.data.error.code}`);
      assert(c.says.test(r.data.error.message), `the reason does not say what happened: ${r.data.error.message}`);
    });
  }
}

let jwt = '', jwtB = '';
let mastoConn = '', ytConn = '', liConn = '', xConn = '', bskyConn = '';
let liExternalId = '';
let mastoAttempt = '', ytAttempt = '', bskyAttempt = '', liAttempt = '', xAttempt = '';

console.log('\n=== AIMEAT PUBLISH UPSTREAMS — the recipes nothing had ever run ===\n');

try {
  console.log('Phase 0 — An owner, five connected accounts and the files to publish');
  await test('two owners register and log in', async () => {
    jwt = await registerAndLogin(owner, PW);
    jwtB = await registerAndLogin(stranger, PW);
    assert(jwt.length > 0 && jwtB.length > 0, 'no tokens');
  });
  await test('the files a publish carries are stored first', async () => {
    await store('pub/clip.mp4', 'video/mp4', CLIP);
    await store('pub/big.mp4', 'video/mp4', BIG);
    await store('pub/mid.mp4', 'video/mp4', MID);
    await store('pub/card.png', 'image/png', CARD);
    await store('pub/doc.pdf', 'application/pdf', DOC);
    const list = await api('/v1/storage', { method: 'GET', bearer: jwt });
    assert((list.data.data.files as any[]).length === 5, `stored ${(list.data.data.files as any[]).length} of 5`);
  });
  await test('the four OAuth accounts and the one that hands over a secret are connected', async () => {
    const masto = await connect(jwt, 'mastodon', { instance: 'mastodon.social' });
    mastoConn = masto.find((c) => c.provider === 'mastodon')!.id;
    ytConn = (await connect(jwt, 'youtube')).find((c) => c.provider === 'youtube')!.id;
    const li = (await connect(jwt, 'linkedin')).find((c) => c.provider === 'linkedin')!;
    liConn = li.id;
    liExternalId = (await storage.getConnection(liConn))!.externalId;
    xConn = (await connect(jwt, 'x')).find((c) => c.provider === 'x')!.id;
    const attach = await api('/v1/connections/attach', {
      bearer: jwt, body: { provider: 'bluesky', fields: { identifier: 'tester.bsky.social', password: 'app-pw-1234' } },
    });
    assert(attach.status === 201, `attach bluesky: ${attach.status} ${attach.data?.error?.message}`);
    bskyConn = attach.data.data.connection.id as string;
    assert((await storage.getConnection(mastoConn))!.instance === 'https://mastodon.social',
      'the Mastodon connection does not remember its instance');
  });

  console.log('\nPhase 1 — Mastodon: the file, then the status that names it');
  await test('the file goes up as multipart with its alt text, and the status carries the media id', async () => {
    const cap = caption('mastodon with a clip');
    const r = await publish({ connection_id: mastoConn, storage_key: 'pub/clip.mp4', caption: cap, params: { alt: 'a test clip' } });
    assert(r.status === 200, `publish: ${r.status} ${r.data?.error?.message}`);
    mastoAttempt = r.data.data.attempt.id as string;
    assert(r.data.data.attempt.status === 'done', `attempt status ${r.data.data.attempt.status}`);
    assert(/^https:\/\/mastodon\.social\/@tester\/\d+$/.test(r.data.data.url), `url ${r.data.data.url}`);
    assert(r.data.data.attempt.externalRef === r.data.data.url, 'the attempt does not carry where it landed');

    const media = up.lastMastodonMedia!;
    assert(media.name === 'clip.mp4', `the file reached the instance as ${media.name}`);
    assert(media.size === CLIP.length, `${media.size} of ${CLIP.length} bytes arrived`);
    assert(media.type === 'video/mp4', `content type ${media.type}`);
    assert(media.description === 'a test clip', `description ${media.description}`);

    const form = new URLSearchParams(lastUpstream((c) => c.path === '/api/v1/statuses').body);
    assert(form.get('status') === cap, `status text ${form.get('status')}`);
    assert((form.get('media_ids[]') ?? '').startsWith('mastomedia-'),
      `the status named no medium: ${form.get('media_ids[]')}`);
  });
  await test('unlisted is what machinery posts, and a fixed value beats it', async () => {
    const quiet = new URLSearchParams(lastUpstream((c) => c.path === '/api/v1/statuses').body);
    assert(quiet.get('visibility') === 'unlisted', `visibility ${quiet.get('visibility')}`);
    const r = await publish({
      connection_id: mastoConn, storage_key: 'pub/clip.mp4',
      caption: caption('mastodon, privately'), params: { visibility: 'private' },
    });
    assert(r.status === 200, `publish: ${r.status} ${r.data?.error?.message}`);
    const loud = new URLSearchParams(lastUpstream((c) => c.path === '/api/v1/statuses').body);
    assert(loud.get('visibility') === 'private', `visibility ${loud.get('visibility')}`);
  });
  await test('no alt text sends no description at all, rather than an empty one', async () => {
    assert(up.lastMastodonMedia!.description === null,
      `an empty description was sent: ${up.lastMastodonMedia!.description}`);
  });

  console.log('\nPhase 2 — Mastodon: the transcode nobody may post through');
  await test('a 202 is waited out, and the status goes only after the instance says the video is there', async () => {
    up.mastodonTranscodePolls = 2;
    const mark = up.mark();
    const before = up.stats.mastodonMediaPolls;
    const r = await publish({ connection_id: mastoConn, storage_key: 'pub/clip.mp4', caption: caption('mastodon transcoded') });
    up.mastodonTranscodePolls = 0;
    assert(r.status === 200, `publish: ${r.status} ${r.data?.error?.message}`);
    assert(up.stats.mastodonMediaPolls === before + 2, `the medium was polled ${up.stats.mastodonMediaPolls - before} times`);
    const paths = up.since(mark).map((c) => c.path);
    const lastPoll = paths.reduce((acc, p, i) => (p.startsWith('/api/v1/media/') ? i : acc), -1);
    const posted = paths.indexOf('/api/v1/statuses');
    assert(lastPoll >= 0 && posted > lastPoll,
      `the status was posted at ${posted} and the last transcode check was at ${lastPoll}`);
  });
  await test('a processing check that fails is temporary, because the file may still be fine', async () => {
    up.mastodonTranscodePolls = 2;
    up.mastodonPollStatus = 500;
    const r = await publish({ connection_id: mastoConn, storage_key: 'pub/clip.mp4', caption: caption('mastodon stuck') });
    up.mastodonTranscodePolls = 0;
    assert(r.status === 502 && r.data.error.code === 'PUBLISH_FAILED', `${r.status} ${r.data?.error?.code}`);
    assert(/processing check failed \(HTTP 500\)/.test(r.data.error.message), `reason ${r.data.error.message}`);
  });

  console.log('\nPhase 3 — Mastodon: which refusals are final');
  await drive([
    {
      name: 'a file the instance will not take is final, and quotes what it said',
      arm: () => { up.mastodonMediaStatus = 422; },
      body: { connection_id: mastoConn, storage_key: 'pub/clip.mp4' },
      code: 'REJECTED', says: /refused the file: .*content type is invalid/,
    },
    {
      name: 'a media upload answered 401 is final: the grant is gone',
      arm: () => { up.mastodonMediaStatus = 401; },
      body: { connection_id: mastoConn, storage_key: 'pub/clip.mp4' },
      code: 'REJECTED', says: /media upload failed \(HTTP 401\)/,
    },
    {
      name: 'a media upload answered 500 is worth another attempt',
      arm: () => { up.mastodonMediaStatus = 500; },
      body: { connection_id: mastoConn, storage_key: 'pub/clip.mp4' },
      code: 'PUBLISH_FAILED', says: /media upload failed \(HTTP 500\)/,
    },
    {
      name: 'an upload that names no medium is temporary, not a rejection of the file',
      arm: () => { up.mastodonMediaNoId = true; },
      body: { connection_id: mastoConn, storage_key: 'pub/clip.mp4' },
      code: 'PUBLISH_FAILED', says: /returned no media id/,
    },
    {
      name: 'a status the instance refuses is final',
      arm: () => { up.mastodonMediaNoId = false; up.mastodonStatusStatus = 422; },
      body: { connection_id: mastoConn, storage_key: 'pub/clip.mp4' },
      code: 'REJECTED', says: /posting failed \(HTTP 422\): .*Validation failed/,
    },
    {
      name: 'a status answered 500 leaves the media uploaded and the post retryable',
      arm: () => { up.mastodonStatusStatus = 500; },
      body: { connection_id: mastoConn, storage_key: 'pub/clip.mp4' },
      code: 'PUBLISH_FAILED', says: /posting failed \(HTTP 500\)/,
    },
    {
      name: 'Mastodon with no file at all says what it needs',
      arm: () => { /* nothing to arm: the absence IS the case */ },
      body: { connection_id: mastoConn },
      code: 'REJECTED', says: /needs a file to attach/,
    },
  ]);

  console.log('\nPhase 4 — Mastodon: reading the numbers back');
  await test("the instance's own counts become a sample, and impressions stay null", async () => {
    const r = await readSample(mastoAttempt);
    assert(r.status === 200, `${r.status} ${JSON.stringify(r.data?.error)}`);
    const s = r.data.data.sample;
    assert(s.likes === 9, `likes ${s.likes}`);
    assert(s.comments === 4, `comments ${s.comments}`);
    assert(s.shares === 3, `shares ${s.shares}`);
    // Mastodon reports no impressions to an author at all. A zero here would be an invented number.
    assert(s.impressions === null, `impressions ${s.impressions}`);
    assert(s.raw.favourites_count === 9, "the provider's own answer was not kept");
    const read = lastUpstream((c) => c.host === 'mastodon.social' && /^\/api\/v1\/statuses\/\d+$/.test(c.path));
    assert(read.headers.authorization?.startsWith('Bearer ') === true, `auth header ${read.headers.authorization}`);
  });
  await test('a second reading extends the series rather than replacing it', async () => {
    await readSample(mastoAttempt);
    const r = await series(mastoAttempt);
    assert(r.status === 200, `${r.status}`);
    assert(r.data.data.samples.length === 2, `the series holds ${r.data.data.samples.length} readings`);
  });
  await driveMetrics([
    {
      name: 'a connection authorized without read:statuses is refused permanently, with the fix',
      arm: () => { up.mastodonMetricsStatus = 403; }, attempt: () => mastoAttempt,
      status: 409, says: /read:statuses.*Reconnect the account/,
    },
    {
      name: 'a status that is gone from the instance is final',
      arm: () => { up.mastodonMetricsStatus = 404; }, attempt: () => mastoAttempt,
      status: 409, says: /gone from the instance/,
    },
    {
      name: 'an instance that answers 500 is worth asking again',
      arm: () => { up.mastodonMetricsStatus = 500; }, attempt: () => mastoAttempt,
      status: 502, says: /Mastodon answered HTTP 500/,
    },
  ]);

  console.log('\nPhase 5 — YouTube: a file larger than one chunk');
  await test('the session is opened with the length and type, and the metadata YouTube keeps', async () => {
    const mark = up.mark();
    const r = await publish({
      connection_id: ytConn, storage_key: 'pub/big.mp4', caption: caption('the long one'),
      params: { title: 'A test upload', description: 'what it is', tags: ['aimeat', 'e2e'] },
    });
    assert(r.status === 200, `publish: ${r.status} ${r.data?.error?.message}`);
    ytAttempt = r.data.data.attempt.id as string;
    assert(/^https:\/\/youtu\.be\/ytvideo-\d+$/.test(r.data.data.url), `url ${r.data.data.url}`);

    const start = lastUpstream((c) => c.path === '/upload/youtube/v3/videos');
    const q = new URL(start.url).searchParams;
    assert(q.get('uploadType') === 'resumable', `uploadType ${q.get('uploadType')}`);
    assert(q.get('part') === 'snippet,status', `part ${q.get('part')}`);
    assert(start.headers['x-upload-content-length'] === String(BIG.length), `declared length ${start.headers['x-upload-content-length']}`);
    assert(start.headers['x-upload-content-type'] === 'video/mp4', `declared type ${start.headers['x-upload-content-type']}`);
    const meta = JSON.parse(start.body) as any;
    assert(meta.snippet.title === 'A test upload', `title ${meta.snippet.title}`);
    assert(meta.snippet.description === 'what it is', `description ${meta.snippet.description}`);
    assert(JSON.stringify(meta.snippet.tags) === '["aimeat","e2e"]', `tags ${JSON.stringify(meta.snippet.tags)}`);
    // unlisted rather than private: a private video renders no thumbnail and 404s for everyone else.
    assert(meta.status.privacyStatus === 'unlisted', `privacyStatus ${meta.status.privacyStatus}`);
    assert(meta.status.selfDeclaredMadeForKids === false, 'the made-for-kids declaration was not made');

    const chunks = up.since(mark).filter((c) => c.path.startsWith('/upload/session/'));
    const expected = [
      `bytes 0-${CHUNK - 1}/${BIG.length}`,
      `bytes ${CHUNK}-${2 * CHUNK - 1}/${BIG.length}`,
      `bytes ${2 * CHUNK}-${BIG.length - 1}/${BIG.length}`,
    ];
    assert(chunks.map((c) => c.headers['content-range']).join(' | ') === expected.join(' | '),
      `the ranges were ${chunks.map((c) => c.headers['content-range']).join(' | ')}`);
    assert(chunks.map((c) => c.bodyBytes).join(',') === `${CHUNK},${CHUNK},${BIG.length - 2 * CHUNK}`,
      `the chunk sizes were ${chunks.map((c) => c.bodyBytes).join(',')}`);
  });

  console.log('\nPhase 6 — YouTube: the resume, the expiry and the session that never was');
  await test('a chunk that fails is not resent blindly: YouTube is asked where it got to', async () => {
    up.youtubeSessionMode = 'fail-once';
    const mark = up.mark();
    const r = await publish({ connection_id: ytConn, storage_key: 'pub/mid.mp4', caption: caption('the resumed one') });
    up.youtubeSessionMode = 'ok';
    assert(r.status === 200, `publish: ${r.status} ${r.data?.error?.message}`);
    const seq = up.since(mark).filter((c) => c.path.startsWith('/upload/session/'));
    const expected = [
      `bytes 0-${CHUNK - 1}/${MID.length}`,
      `bytes */${MID.length}`,
      // The offset is the SERVER's number, not the client's: 1 MiB is not a chunk boundary, so a
      // client that resumed from what it thought it had sent would produce a different range here.
      `bytes ${up.youtubeResumeOffset}-${MID.length - 1}/${MID.length}`,
    ];
    assert(seq.map((c) => c.headers['content-range']).join(' | ') === expected.join(' | '),
      `the ranges were ${seq.map((c) => c.headers['content-range']).join(' | ')}`);
    const probe = seq[1];
    assert(probe.headers['content-length'] === '0', `the probe declared ${probe.headers['content-length']} bytes`);
    assert(probe.bodyBytes === 0, 'the resume probe carried a body');
  });
  await drive([
    {
      name: 'an expired session is final: the bytes are gone and starting again is the only move',
      arm: () => { up.youtubeSessionMode = 'expired'; },
      body: { connection_id: ytConn, storage_key: 'pub/mid.mp4' },
      code: 'REJECTED', says: /session expired; start again/,
    },
    {
      name: 'a start that names no session leaves nowhere to PUT, and says so',
      arm: () => { up.youtubeSessionMode = 'ok'; up.youtubeNoLocation = true; },
      body: { connection_id: ytConn, storage_key: 'pub/mid.mp4' },
      code: 'PUBLISH_FAILED', says: /returned no upload session/,
    },
    {
      name: 'a start refused 400 is the metadata, and final',
      arm: () => { up.youtubeNoLocation = false; up.youtubeStartStatus = 400; },
      body: { connection_id: ytConn, storage_key: 'pub/mid.mp4' },
      code: 'REJECTED', says: /would not start the upload \(HTTP 400\)/,
    },
    {
      name: 'a start refused 401 is the grant, and final',
      arm: () => { up.youtubeStartStatus = 401; },
      body: { connection_id: ytConn, storage_key: 'pub/mid.mp4' },
      code: 'REJECTED', says: /would not start the upload \(HTTP 401\)/,
    },
    {
      // 403 here is the daily quota: six uploads for the whole project, spent. Tomorrow it works.
      name: 'a start refused 403 is the spent quota, and tomorrow it will work',
      arm: () => { up.youtubeStartStatus = 403; },
      body: { connection_id: ytConn, storage_key: 'pub/mid.mp4' },
      code: 'PUBLISH_FAILED', says: /would not start the upload \(HTTP 403\)/,
    },
    {
      name: 'YouTube with no file at all says what it needs',
      arm: () => { /* the absence IS the case */ },
      body: { connection_id: ytConn },
      code: 'REJECTED', says: /needs a file/,
    },
  ]);

  console.log('\nPhase 7 — YouTube: the numbers, which arrive as strings');
  await test('the counts are read as numbers, and the share count YouTube never gives stays null', async () => {
    const r = await readSample(ytAttempt);
    assert(r.status === 200, `${r.status} ${JSON.stringify(r.data?.error)}`);
    const s = r.data.data.sample;
    assert(s.impressions === 4210, `impressions ${s.impressions}`);
    assert(s.likes === 87, `likes ${s.likes}`);
    assert(s.comments === 12, `comments ${s.comments}`);
    assert(s.shares === null, `YouTube reported a share count it does not have: ${s.shares}`);
    const read = lastUpstream((c) => c.path === '/youtube/v3/videos');
    assert(new URL(read.url).searchParams.get('part') === 'statistics', 'the read asked for something other than statistics');
    assert(/^ytvideo-\d+$/.test(new URL(read.url).searchParams.get('id') ?? ''),
      `the video id was not recovered from the link: ${new URL(read.url).searchParams.get('id')}`);
  });
  await driveMetrics([
    {
      name: 'a connection without youtube.readonly is refused permanently, with the reason',
      arm: () => { up.youtubeVideosStatus = 403; }, attempt: () => ytAttempt,
      status: 409, says: /youtube\.readonly/,
    },
    {
      name: 'a video with no statistics is gone or invisible, and either way final',
      arm: () => { up.youtubeNoStatistics = true; }, attempt: () => ytAttempt,
      status: 409, says: /gone, or is not visible/,
    },
    {
      name: 'YouTube answering 500 is worth asking again',
      arm: () => { up.youtubeNoStatistics = false; up.youtubeVideosStatus = 500; }, attempt: () => ytAttempt,
      status: 502, says: /YouTube answered HTTP 500/,
    },
  ]);

  console.log('\nPhase 8 — Bluesky: a record in the account\'s own repository');
  await test('the post is written to the repository the session named, and comes back as an at:// uri', async () => {
    const cap = caption('hello from the suite');
    const r = await publish({ connection_id: bskyConn, caption: cap });
    assert(r.status === 200, `publish: ${r.status} ${r.data?.error?.message}`);
    bskyAttempt = r.data.data.attempt.id as string;
    assert(/^at:\/\/did:plc:faketester\/app\.bsky\.feed\.post\/bskypost-\d+$/.test(r.data.data.url), `uri ${r.data.data.url}`);
    const call = lastUpstream((c) => c.path === '/xrpc/com.atproto.repo.createRecord');
    const body = JSON.parse(call.body) as any;
    assert(body.repo === 'did:plc:faketester', `repo ${body.repo}`);
    assert(body.collection === 'app.bsky.feed.post', `collection ${body.collection}`);
    assert(body.record.$type === 'app.bsky.feed.post', `record type ${body.record.$type}`);
    assert(body.record.text === cap, `text ${body.record.text}`);
    assert(!Number.isNaN(Date.parse(body.record.createdAt)), `createdAt ${body.record.createdAt}`);
  });
  const noDid = await seedConnection('bsky-no-did', 'bluesky', { shape: 'session', accessToken: 'at-x' });
  await drive([
    {
      name: 'a Bluesky refusal of the record is final',
      arm: () => { up.blueskyPostStatus = 400; },
      body: { connection_id: bskyConn },
      code: 'REJECTED', says: /Bluesky refused the post \(HTTP 400\)/,
    },
    {
      name: 'a Bluesky session no longer accepted is final too',
      arm: () => { up.blueskyPostStatus = 401; },
      body: { connection_id: bskyConn },
      code: 'REJECTED', says: /HTTP 401/,
    },
    {
      name: 'a Bluesky server error is worth another attempt',
      arm: () => { up.blueskyPostStatus = 500; },
      body: { connection_id: bskyConn },
      code: 'PUBLISH_FAILED', says: /HTTP 500/,
    },
    {
      name: 'a session that carries no account id cannot say whose repository to write to',
      arm: () => { /* the seeded connection IS the case */ },
      body: { connection_id: noDid },
      code: 'REJECTED', says: /no account id/,
    },
  ]);

  console.log('\nPhase 9 — Bluesky: reposts and quotes are both shares, and absent is not zero');
  await test('the counts come from the post view, and the two share kinds are summed', async () => {
    const r = await readSample(bskyAttempt);
    assert(r.status === 200, `${r.status} ${JSON.stringify(r.data?.error)}`);
    const s = r.data.data.sample;
    assert(s.likes === 12, `likes ${s.likes}`);
    assert(s.comments === 3, `comments ${s.comments}`);
    assert(s.shares === 7, `shares ${s.shares}, expected 5 reposts + 2 quotes`);
    assert(s.impressions === null, `Bluesky reported impressions it does not have: ${s.impressions}`);
    const read = new URL(lastUpstream((c) => c.path === '/xrpc/app.bsky.feed.getPostThread').url);
    assert(read.searchParams.get('depth') === '0', `depth ${read.searchParams.get('depth')}`);
    assert(read.searchParams.get('parentHeight') === '0', `parentHeight ${read.searchParams.get('parentHeight')}`);
    assert(read.searchParams.get('uri')?.startsWith('at://') === true, `uri ${read.searchParams.get('uri')}`);
  });
  await test('a post reporting neither reposts nor quotes has no share count, rather than zero', async () => {
    up.blueskyOmitShareCounts = true;
    const r = await readSample(bskyAttempt);
    up.blueskyOmitShareCounts = false;
    assert(r.status === 200, `${r.status} ${JSON.stringify(r.data?.error)}`);
    assert(r.data.data.sample.shares === null, `shares ${r.data.data.sample.shares}, which invents a measurement`);
    assert(r.data.data.sample.likes === 12, 'the counts that WERE reported were lost with it');
  });
  await driveMetrics([
    {
      name: 'a post Bluesky cannot find is final',
      arm: () => { up.blueskyThreadStatus = 404; }, attempt: () => bskyAttempt,
      status: 409, says: /that post is gone/,
    },
    {
      name: 'a uri Bluesky calls invalid is final as well',
      arm: () => { up.blueskyThreadStatus = 400; }, attempt: () => bskyAttempt,
      status: 409, says: /that post is gone/,
    },
    {
      name: 'Bluesky answering 500 is worth asking again',
      arm: () => { up.blueskyThreadStatus = 500; }, attempt: () => bskyAttempt,
      status: 502, says: /Bluesky answered HTTP 500/,
    },
  ]);

  console.log('\nPhase 10 — LinkedIn: the image, in the two steps it takes');
  await test('the upload is initialised, the bytes go where LinkedIn said, and the post names the urn', async () => {
    const r = await publish({
      connection_id: liConn, storage_key: 'pub/card.png', caption: caption('with a card'),
      params: { alt: 'the card', visibility: 'connections' },
    });
    assert(r.status === 200, `publish: ${r.status} ${r.data?.error?.message}`);
    liAttempt = r.data.data.attempt.id as string;

    const init = lastUpstream((c) => c.path === '/rest/images');
    assert(new URL(init.url).searchParams.get('action') === 'initializeUpload', `action ${new URL(init.url).search}`);
    assert(JSON.parse(init.body).initializeUploadRequest.owner === `urn:li:person:${liExternalId}`,
      `owner ${JSON.parse(init.body).initializeUploadRequest.owner}`);
    // The REST surface is versioned by a header, and an absent or stale one is a 426.
    assert(init.headers['linkedin-version'] === '202506', `LinkedIn-Version ${init.headers['linkedin-version']}`);
    assert(init.headers['x-restli-protocol-version'] === '2.0.0', `protocol version ${init.headers['x-restli-protocol-version']}`);

    assert(up.lastLinkedinImage!.bytes === CARD.length, `${up.lastLinkedinImage!.bytes} of ${CARD.length} bytes arrived`);
    assert(up.lastLinkedinImage!.contentType === 'image/png', `content type ${up.lastLinkedinImage!.contentType}`);

    const post = up.lastLinkedinPost as any;
    assert(String(post.content.media.id).startsWith('urn:li:image:'), `media ${JSON.stringify(post.content.media)}`);
    assert(post.content.media.altText === 'the card', `altText ${post.content.media.altText}`);
    // CONNECTIONS only when it was asked for: widening someone's audience by accident is not a default.
    assert(post.visibility === 'CONNECTIONS', `visibility ${post.visibility}`);
    assert(r.data.data.url === 'https://www.linkedin.com/feed/update/urn:li:share:777/', `url ${r.data.data.url}`);
  });
  await test('PUBLIC is what a post without a stated audience gets', async () => {
    const r = await publish({ connection_id: liConn, caption: caption('a plain note') });
    assert(r.status === 200, `publish: ${r.status} ${r.data?.error?.message}`);
    assert((up.lastLinkedinPost as any).visibility === 'PUBLIC', `visibility ${(up.lastLinkedinPost as any).visibility}`);
    assert(!('content' in (up.lastLinkedinPost as any)), 'a post with no file carried a media block');
  });
  await test('a successful share LinkedIn does not stamp with a urn is a success with no link', async () => {
    up.linkedinPostNoUrn = true;
    const r = await publish({ connection_id: liConn, caption: caption('unstamped') });
    up.linkedinPostNoUrn = false;
    assert(r.status === 200, `publish: ${r.status} ${r.data?.error?.message}`);
    assert(r.data.data.attempt.status === 'done', `attempt status ${r.data.data.attempt.status}`);
    // '' rather than a link: calling a successful publish a failure would invite a duplicate post.
    assert(r.data.data.attempt.externalRef === '', `externalRef ${JSON.stringify(r.data.data.attempt.externalRef)}`);
    // Asserted as a hole first, 2026-09-08: publish-run.ts v1.1.0 had guarded the REPLAY branch
    // (`externalRef || undefined`) and left the first publish returning `url: ""`, two answers for
    // one outcome, and the empty string is the one downstream drew as a link to nothing. Fixed in
    // publish-run.ts v1.2.0: no urn means no url, on the first call as on the retry.
    assert(r.data.data.url === undefined, `a share without a urn has no url, got ${JSON.stringify(r.data.data.url)}`);
  });

  console.log('\nPhase 11 — LinkedIn: what it refuses, and whether asking again could help');
  await drive([
    {
      name: 'a video is refused by name rather than posted as text without it',
      arm: () => { /* the pdf IS the case */ },
      body: { connection_id: liConn, storage_key: 'pub/doc.pdf' },
      code: 'REJECTED', says: /application\/pdf needs the Videos API/,
    },
    {
      name: 'an image upload refused 403 is the product that is not enabled, and final',
      arm: () => { up.linkedinImageInitStatus = 403; },
      body: { connection_id: liConn, storage_key: 'pub/card.png' },
      code: 'REJECTED', says: /would not start an image upload \(HTTP 403\)/,
    },
    {
      name: 'an image upload refused 500 is worth another attempt',
      arm: () => { up.linkedinImageInitStatus = 500; },
      body: { connection_id: liConn, storage_key: 'pub/card.png' },
      code: 'PUBLISH_FAILED', says: /would not start an image upload \(HTTP 500\)/,
    },
    {
      name: 'an initialisation that names no destination is temporary',
      arm: () => { up.linkedinImageInitEmpty = true; },
      body: { connection_id: liConn, storage_key: 'pub/card.png' },
      code: 'PUBLISH_FAILED', says: /without saying where to put it/,
    },
    {
      name: 'bytes LinkedIn will not store are temporary too',
      arm: () => { up.linkedinImageInitEmpty = false; up.linkedinImagePutStatus = 500; },
      body: { connection_id: liConn, storage_key: 'pub/card.png' },
      code: 'PUBLISH_FAILED', says: /rejected the image bytes \(HTTP 500\)/,
    },
    {
      name: 'a token LinkedIn no longer accepts asks for a reconnection',
      arm: () => { up.linkedinPostStatus = 401; },
      body: { connection_id: liConn },
      code: 'REJECTED', says: /needs reconnecting/,
    },
    {
      name: 'a 403 names the product an operator has to enable',
      arm: () => { up.linkedinPostStatus = 403; },
      body: { connection_id: liConn },
      code: 'REJECTED', says: /Share on LinkedIn/,
    },
    {
      name: 'a 422 is the content, and rewriting it is the only fix',
      arm: () => { up.linkedinPostStatus = 422; },
      body: { connection_id: liConn },
      code: 'REJECTED', says: /refused the content/,
    },
    {
      name: 'a 400 is the content as well',
      arm: () => { up.linkedinPostStatus = 400; },
      body: { connection_id: liConn },
      code: 'REJECTED', says: /refused the content/,
    },
    {
      name: 'anything else at LinkedIn is temporary',
      arm: () => { up.linkedinPostStatus = 503; },
      body: { connection_id: liConn },
      code: 'PUBLISH_FAILED', says: /LinkedIn post failed \(HTTP 503\)/,
    },
  ]);
  await test('LinkedIn numbers are a permanent refusal that names the gate, not a row of zeros', async () => {
    const r = await readSample(liAttempt);
    assert(r.status === 409 && r.data.error.code === 'NOT_MEASURABLE', `${r.status} ${r.data?.error?.code}`);
    assert(/Community Management/.test(r.data.error.message), `reason ${r.data.error.message}`);
    // Nothing left this process for it: the refusal is ours, so no request is spent finding out.
    assert(!up.calls.some((c) => c.host === 'api.linkedin.com' && /analytics/.test(c.path)),
      'a refusal we already knew still cost a request');
  });

  console.log('\nPhase 12 — X: the refusals, and the post that came back nameless');
  await drive([
    {
      name: 'media is refused out loud rather than dropped from the post',
      arm: () => { /* the pdf IS the case */ },
      body: { connection_id: xConn, storage_key: 'pub/doc.pdf' },
      code: 'REJECTED', says: /chunked upload endpoint/,
    },
    {
      name: 'a token X no longer accepts asks for a reconnection',
      arm: () => { up.xPostStatus = 401; },
      body: { connection_id: xConn },
      code: 'REJECTED', says: /needs reconnecting/,
    },
    {
      name: 'a 403 is X refusing the post itself',
      arm: () => { up.xPostStatus = 403; },
      body: { connection_id: xConn },
      code: 'REJECTED', says: /X refused the post/,
    },
    {
      // Nothing about the CONTENT is wrong, and the fix is to top up rather than to rewrite.
      name: 'a spent prepaid balance is not a refusal of the post',
      arm: () => { up.xPostStatus = 402; },
      body: { connection_id: xConn },
      code: 'PUBLISH_FAILED', says: /prepaid credit balance is spent/,
    },
    {
      name: 'rate limiting says the same post can be tried later',
      arm: () => { up.xPostStatus = 429; },
      body: { connection_id: xConn },
      code: 'PUBLISH_FAILED', says: /rate limiting this app/,
    },
    {
      name: 'anything else at X is temporary',
      arm: () => { up.xPostStatus = 500; },
      body: { connection_id: xConn },
      code: 'PUBLISH_FAILED', says: /X post failed \(HTTP 500\)/,
    },
  ]);
  await test('an empty post is refused here rather than at X, where it would cost a call', async () => {
    const before = up.calls.filter((c) => c.path === '/2/tweets').length;
    const r = await publish({ connection_id: xConn, caption: '   ' });
    assert(r.status === 502 && r.data.error.code === 'REJECTED', `${r.status} ${r.data?.error?.code}`);
    assert(/will not accept an empty post/.test(r.data.error.message), `reason ${r.data.error.message}`);
    assert(up.calls.filter((c) => c.path === '/2/tweets').length === before, 'an empty post still reached X');
  });
  await test('a post X accepts and does not name is a success without a permalink', async () => {
    up.xPostNoId = true;
    const r = await publish({ connection_id: xConn, caption: caption('nameless') });
    up.xPostNoId = false;
    assert(r.status === 200, `publish: ${r.status} ${r.data?.error?.message}`);
    assert(r.data.data.attempt.status === 'done', `attempt status ${r.data.data.attempt.status}`);
    assert(r.data.data.attempt.externalRef === '', `externalRef ${JSON.stringify(r.data.data.attempt.externalRef)}`);
  });

  console.log('\nPhase 13 — X: the numbers, which are charged for');
  await test('a post that landed can be measured, and the two share kinds are summed', async () => {
    const posted = await publish({ connection_id: xConn, caption: caption('measurable') });
    assert(posted.status === 200, `publish: ${posted.status} ${posted.data?.error?.message}`);
    xAttempt = posted.data.data.attempt.id as string;
    assert(posted.data.data.url === 'https://x.com/testhandle/status/1900000000000000001', `url ${posted.data.data.url}`);

    const r = await readSample(xAttempt);
    assert(r.status === 200, `${r.status} ${JSON.stringify(r.data?.error)}`);
    const s = r.data.data.sample;
    assert(s.impressions === 1840, `impressions ${s.impressions}`);
    assert(s.likes === 23, `likes ${s.likes}`);
    assert(s.comments === 5, `comments ${s.comments}`);
    assert(s.shares === 6, `shares ${s.shares}, expected 4 retweets + 2 quotes`);
    const read = lastUpstream((c) => /^\/2\/tweets\/\d+$/.test(c.path));
    assert(new URL(read.url).searchParams.get('tweet.fields') === 'public_metrics',
      `fields ${new URL(read.url).searchParams.get('tweet.fields')}`);
  });
  await driveMetrics([
    {
      name: 'a spent balance is temporary here too: the same read works once funded',
      arm: () => { up.xMetricsStatus = 402; }, attempt: () => xAttempt,
      status: 502, says: /prepaid credit balance is spent/,
    },
    {
      name: 'rate limiting is temporary',
      arm: () => { up.xMetricsStatus = 429; }, attempt: () => xAttempt,
      status: 502, says: /rate limiting this app/,
    },
    {
      name: 'a post that is gone is final',
      arm: () => { up.xMetricsStatus = 404; }, attempt: () => xAttempt,
      status: 409, says: /that post is gone/,
    },
    {
      name: 'a post X answers for without metrics is final',
      arm: () => { up.xMetricsEmpty = true; }, attempt: () => xAttempt,
      status: 409, says: /no metrics for that post/,
    },
    {
      name: 'anything else at X is worth asking again',
      arm: () => { up.xMetricsEmpty = false; up.xMetricsStatus = 500; }, attempt: () => xAttempt,
      status: 502, says: /X answered HTTP 500/,
    },
  ]);

  console.log('\nPhase 14 — A reference no reader recognises is a refusal, never a guess');
  await test('nothing published is nothing to measure, before any reader is consulted', async () => {
    const out = await readMetrics({
      provider: findProvider(ctx.providers, 'mastodon')!,
      connection: (await storage.getConnection(mastoConn))!,
      credential: { shape: 'oauth2', accessToken: 'at-x' },
      externalRef: '',
    });
    assert(!out.ok && out.permanent, `got ${JSON.stringify(out)}`);
    assert(!out.ok && /nothing to measure/.test(out.reason), `reason ${!out.ok ? out.reason : ''}`);
  });
  const strangeRefs: Array<[string, () => string, string, RegExp]> = [
    ['a Mastodon link with no status id in it', () => mastoConn, 'https://mastodon.social/@tester/', /no Mastodon status id/],
    ['a Bluesky reference that is not an at:// uri', () => bskyConn, 'https://bsky.app/profile/tester/post/abc', /not an at:\/\/ URI/],
    ['a YouTube link with no video id in it', () => ytConn, 'https://youtu.be/', /no YouTube video id/],
    ['an X link with no post id in it', () => xConn, 'https://x.com/testhandle/', /no X post id/],
  ];
  for (const [name, conn, ref, says] of strangeRefs) {
    await test(`${name} is refused rather than guessed at`, async () => {
      const attempt = await seedAttempt(conn(), ref);
      const r = await readSample(attempt);
      assert(r.status === 409 && r.data.error.code === 'NOT_MEASURABLE', `${r.status} ${r.data?.error?.code}`);
      assert(says.test(r.data.error.message), `reason ${r.data.error.message}`);
    });
  }
  await test('a provider with no reader at all says so rather than answering nothing', async () => {
    const mail = await seedConnection('mail-no-reader', 'google-mail', { shape: 'oauth2', accessToken: 'at-x' });
    const attempt = await seedAttempt(mail, 'https://mail.example.test/thread/1');
    const r = await readSample(attempt);
    assert(r.status === 409 && r.data.error.code === 'NOT_MEASURABLE', `${r.status} ${r.data?.error?.code}`);
    assert(/no way to read numbers from google-mail yet/.test(r.data.error.message), `reason ${r.data.error.message}`);
  });
  await test('an attempt that never published is refused before a request is spent', async () => {
    const attempt = await seedAttempt(xConn, '', 'failed');
    const before = up.calls.length;
    const r = await readSample(attempt);
    assert(r.status === 400 && r.data.error.code === 'NOT_PUBLISHED', `${r.status} ${r.data?.error?.code}`);
    assert(up.calls.length === before, 'a reading of nothing still reached a provider');
  });
  await test("someone else's item cannot be measured, and is not even admitted to exist", async () => {
    const r = await readSample(xAttempt, jwtB);
    assert(r.status === 404 && r.data.error.code === 'NOT_FOUND', `${r.status} ${r.data?.error?.code}`);
  });

  console.log('\nPhase 15 — Who may publish at all');
  await test('a publish with no credential is refused', async () => {
    const res = await fetch(`${BASE}/v1/connections/publish`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connection_id: bskyConn, caption: caption('uninvited') }),
    });
    assert(res.status === 401, `${res.status}`);
  });
  await test('an app without connections:use cannot publish through a connection', async () => {
    const appToken = await grantAppToken(jwt, owner, ['memory:read']);
    const r = await publish({ connection_id: bskyConn, caption: caption('unscoped') }, appToken);
    assert(r.status === 403 && r.data.error.code === 'SCOPE_DENIED', `${r.status} ${r.data?.error?.code}`);
  });
  await test('an app without connections:use cannot read the numbers either', async () => {
    const appToken = await grantAppToken(jwt, owner, ['memory:read']);
    const r = await readSample(bskyAttempt, appToken);
    assert(r.status === 403 && r.data.error.code === 'SCOPE_DENIED', `${r.status} ${r.data?.error?.code}`);
  });
  await test('an app holding connections:use publishes, and the attempt records the app as publisher', async () => {
    const appToken = await grantAppToken(jwt, owner, ['connections:use']);
    const r = await publish({ connection_id: bskyConn, caption: caption('scoped') }, appToken);
    assert(r.status === 200, `${r.status} ${JSON.stringify(r.data?.error)}`);
    assert(r.data.data.attempt.status === 'done', `attempt status ${r.data.data.attempt.status}`);
  });
  await test("another owner cannot publish through a connection that is not theirs", async () => {
    const r = await publish({ connection_id: bskyConn, caption: caption('not yours') }, jwtB);
    // Absent and not-yours answer identically, which is what keeps a 404 from enumerating connections.
    assert(r.status === 404 && r.data.error.code === 'NOT_FOUND', `${r.status} ${r.data?.error?.code}`);
  });
} finally {
  restore();
  server.close();
  await (storage as { disconnect?: () => Promise<void> }).disconnect?.();
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* Windows may still hold the file */ }
}

console.log(`\n═══ PUBLISH UPSTREAMS: ${passed} passed, ${failed} failed (${passed + failed} total) ═══\n`);
process.exit(failed > 0 ? 1 : 0);
