/**
 * @file test/e2e-connections-social.ts
 * @description The LÄHETIN social desk work of 2026-10-15, end to end against upstreams answered
 *   inside this process: a Facebook Page (the page token behind the sign-in, text, photo and video),
 *   Instagram (the token wrapped in `data`, the 60-day token and its renewal, a picture Instagram
 *   FETCHES from the node's own short-lived address), Reddit (duration=permanent, the User-Agent
 *   rule, a subreddit post), X articles and threads, Mastodon text with no file, and the replies
 *   reader on every network that has one, LinkedIn's refusal included.
 *
 *   It boots the node in process on its own port and its own database on the run's backend
 *   (test/helpers/own-node-db.ts), the pattern of e2e-publish-upstreams, and replaces
 *   globalThis.fetch (helpers/fake-social-upstreams.ts), so the real service code runs and nothing
 *   leaves the machine.
 * @structure boot · helpers · phases 0-12
 * @usage cd aimeat && node --import tsx test/e2e-connections-social.ts
 * @version-history
 *   v1.1.0 — 2026-10-16 — Phase 10 holds who may read an owner's publish history and replies: an
 *     agent only on connections:read-as-owner, and never another owner's items.
 *   v1.0.1 — 2026-10-16 — The node this suite starts follows the run's backend
 *     (test/helpers/own-node-db.ts); it was SQLite on both runs (QA audit P1-02).
 *   v1.0.0 — 2026-10-15 — Initial.
 */
import { randomBytes, createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import * as ed from '@noble/ed25519';
import { BROWSER_START, roundCookie } from './helpers/oauth-round.js';
import { ownNodeDb } from './helpers/own-node-db.js';

// A fixed own port, like the other in-process suites: the runner takes it under its port lock.
const PORT = parseInt(process.env.E2E_SOCIAL_PORT ?? '28327', 10);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = mkdtempSync(join(tmpdir(), 'aimeat-social-e2e-'));

Object.assign(process.env, {
  AIMEAT_PORT: String(PORT),
  AIMEAT_BASE_URL: BASE,
  AIMEAT_NODE_ID: 'aimeat-local-001-dev',
  AIMEAT_DEV_MODE: 'true',
  AIMEAT_TEST_MODE: 'true',
  AIMEAT_ANONYMOUS: 'false',
  AIMEAT_LOG_LEVEL: 'error',
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'error',
  AIMEAT_ALLOW_PRIVATE_EGRESS: 'true',
  AIMEAT_CONNECTIONS_ENABLED: 'true',
  AIMEAT_CONNECT_GOOGLE_CLIENT_ID: 'google-client-id',
  AIMEAT_CONNECT_GOOGLE_CLIENT_SECRET: 'google-client-secret',
  AIMEAT_CONNECT_LINKEDIN_CLIENT_ID: 'linkedin-client-id',
  AIMEAT_CONNECT_LINKEDIN_CLIENT_SECRET: 'linkedin-client-secret',
  AIMEAT_CONNECT_X_CLIENT_ID: 'x-client-id',
  AIMEAT_CONNECT_X_CLIENT_SECRET: 'x-client-secret',
  AIMEAT_CONNECT_FACEBOOK_CLIENT_ID: 'fb-app-id',
  AIMEAT_CONNECT_FACEBOOK_CLIENT_SECRET: 'fb-app-secret',
  AIMEAT_CONNECT_FACEBOOK_CONFIG_ID: '424242',
  AIMEAT_CONNECT_INSTAGRAM_CLIENT_ID: 'ig-app-id',
  AIMEAT_CONNECT_INSTAGRAM_CLIENT_SECRET: 'ig-app-secret',
  AIMEAT_CONNECT_REDDIT_CLIENT_ID: 'rd-client-id',
  AIMEAT_CONNECT_REDDIT_CLIENT_SECRET: 'rd-client-secret',
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
const { installSocialUpstreams } = await import('./helpers/fake-social-upstreams.js');

const { config } = loadConfig({});
Object.assign(config, (await ownNodeDb(String(PORT), { sqlitePath: join(TMP, 'social.db') })).config);
config.port = PORT;
const { app, storage } = await createServer(config);
await (storage as { ready?: Promise<unknown> }).ready;
const server = await new Promise<Server>((resolve) => { const s = app.listen(PORT, '127.0.0.1', () => resolve(s)); });
const { up, restore } = installSocialUpstreams();

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); } catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

interface Call { status: number; data: any }
async function api(path: string, opts: { method?: string; body?: unknown; bearer?: string } = {}): Promise<Call> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`;
  const res = await fetch(`${BASE}${path}`, { method: opts.method ?? 'POST', headers, body: opts.body ? JSON.stringify(opts.body) : undefined, redirect: 'manual' });
  let data: any;
  try { data = await res.json(); } catch { data = null; /* a plain-text answer or a redirect */ }
  return { status: res.status, data };
}

async function registerAndLogin(username: string, password: string): Promise<string> {
  const reg = await api('/v1/ghii', { body: { username, display_name: username, password } });
  assert(reg.status === 201, `register ${username}: ${reg.status}`);
  const login = await api('/v1/ghii/login', { body: { username, password } });
  assert(login.status === 200, `login ${username}: ${login.status}`);
  return login.data.data.token as string;
}

/** One authorization round as the owner's browser makes it. Returns the callback answer too. */
async function connect(bearer: string, provider: string, extra: Record<string, string> = {}): Promise<{ cb: Response; authorizeUrl: string; list: any[] }> {
  const res = await fetch(`${BASE}/v1/connections/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}`, ...BROWSER_START },
    body: JSON.stringify({ provider, mode: 'personal', return_url: '/profile#access', ...extra }),
  });
  const start = await res.json() as any;
  assert(res.status === 200, `start ${provider}: ${res.status} ${start?.error?.message}`);
  const cb = await fetch(`${BASE}/v1/connections/callback?state=${encodeURIComponent(start.data.state)}&code=code-${provider}`, {
    redirect: 'manual', headers: { Cookie: roundCookie(res) },
  });
  const list = (await api('/v1/connections', { method: 'GET', bearer })).data.data.connections as any[];
  return { cb, authorizeUrl: start.data.authorize_url as string, list };
}

const stamp = Date.now();
const owner = `sx${stamp}`;
const PW = 'S0cialPw!x';
let jwt = '', jwtB = '';
let fbConn = '', igConn = '', rdConn = '', xConn = '', mastoConn = '', bskyConn = '', ytConn = '', liConn = '';
const attempt: Record<string, string> = {};
let n = 0;
const cap = (what: string): string => `${what} ${stamp}-${++n}`;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('a real enough jpeg body')]);
const PNG = Buffer.from('\x89PNG\r\n\x1a\nfake png', 'binary');
const CLIP = Buffer.from('a short clip', 'utf8');

async function store(key: string, mime: string, bytes: Buffer): Promise<void> {
  const r = await api('/v1/storage', { bearer: jwt, body: { key, visibility: 'private', mime_type: mime, data: bytes.toString('base64') } });
  assert(r.status === 201, `storage put ${key}: ${r.status}`);
}
const publish = (body: Record<string, unknown>, bearer = jwt): Promise<Call> => api('/v1/connections/publish', { bearer, body });
const replies = (id: string, bearer = jwt): Promise<Call> => api(`/v1/connections/attempts/${id}/replies`, { bearer });
const metrics = (id: string): Promise<Call> => api(`/v1/connections/attempts/${id}/metrics`, { bearer: jwt });

console.log('\n=== AIMEAT CONNECTIONS — Facebook, Instagram, Reddit, X long form, replies ===\n');

try {
  console.log('Phase 0 — two owners and the files');
  await test('owners register, files are stored', async () => {
    jwt = await registerAndLogin(owner, PW);
    jwtB = await registerAndLogin(`sy${stamp}`, PW);
    await store('soc/pic.jpg', 'image/jpeg', JPEG);
    await store('soc/pic.png', 'image/png', PNG);
    await store('soc/clip.mp4', 'video/mp4', CLIP);
  });

  console.log('\nPhase 1 — discovery names the three new providers by what they can do');
  await test('facebook, instagram and reddit are listed with honest capabilities', async () => {
    const r = await api('/v1/connections/providers', { method: 'GET', bearer: jwt });
    const by = new Map((r.data.data.providers as any[]).map((p) => [p.id, p]));
    for (const id of ['facebook', 'instagram', 'reddit']) assert(by.get(id)?.nodeConfigured === true, `${id} not configured`);
    assert(!by.get('instagram').capabilities.includes('publish-post'), 'Instagram claims a text post it cannot make');
    assert(by.get('instagram').capabilities.includes('publish-image'), 'Instagram does not say it publishes a picture');
    assert(!by.get('reddit').capabilities.includes('publish-video'), 'Reddit claims video');
    for (const id of ['mastodon', 'bluesky', 'youtube', 'x', 'facebook', 'instagram', 'reddit']) {
      assert(by.get(id).capabilities.includes('read-replies'), `${id} does not say it reads replies`);
    }
    assert(!by.get('linkedin').capabilities.includes('read-replies'), 'LinkedIn claims a replies read it cannot do');
  });

  console.log('\nPhase 2 — Facebook: the page token behind the sign-in');
  await test('the authorize address joins scopes with commas and carries the login configuration', async () => {
    const res = await fetch(`${BASE}/v1/connections/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}`, ...BROWSER_START },
      body: JSON.stringify({ provider: 'facebook', mode: 'personal' }),
    });
    const u = new URL((await res.json() as any).data.authorize_url);
    assert(u.hostname === 'www.facebook.com' && /\/v\d+\.0\/dialog\/oauth$/.test(u.pathname), `authorize ${u}`);
    assert(u.searchParams.get('scope')!.split(',').includes('pages_manage_posts'), `scope ${u.searchParams.get('scope')}`);
    assert(u.searchParams.get('config_id') === '424242', 'no config_id');
    assert(!u.searchParams.has('code_challenge'), 'PKCE sent to a dialog that does not take it');
  });
  await test('connecting stores the PAGE, named by its name, with the page token', async () => {
    const { cb, list } = await connect(jwt, 'facebook');
    assert(cb.status === 302, `callback ${cb.status} ${await cb.text()}`);
    const c = list.find((x) => x.provider === 'facebook');
    assert(c?.accountLabel === 'AIMEAT Test Page', `label ${c?.accountLabel}`);
    fbConn = c.id;
    const row = await storage.getConnection(fbConn);
    assert(row!.externalId === '1001' && row!.expiresAt === null, `external ${row!.externalId} expires ${row!.expiresAt}`);
    const ex = up.last((x) => x.path.endsWith('/oauth/access_token') && x.url.includes('fb_exchange_token'));
    assert(ex.url.includes('client_secret=fb-app-secret'), 'the long-lived exchange did not carry the app secret');
  });
  await test('with several pages, `account` chooses one by name, and an unknown name connects nothing', async () => {
    up.pages = [{ id: '1001', name: 'AIMEAT Test Page', access_token: 'p1' }, { id: '2002', name: 'Second Page', access_token: 'p2' }];
    const chosen = await connect(jwt, 'facebook', { account: 'second page' });
    assert(chosen.cb.status === 302, `callback ${chosen.cb.status}`);
    assert(chosen.list.some((x) => x.provider === 'facebook' && x.accountLabel === 'Second Page'), 'second page not connected');
    const before = chosen.list.length;
    const wrong = await connect(jwt, 'facebook', { account: 'No Such Page' });
    assert(wrong.cb.status === 400 && /no page named/i.test(await wrong.cb.text()), `callback ${wrong.cb.status}`);
    assert(wrong.list.length === before, 'a connection appeared for a page nobody manages');
    up.pages = [{ id: '1001', name: 'AIMEAT Test Page', access_token: 'page-token-1001' }];
  });

  console.log('\nPhase 3 — Facebook: text, photo, video, and which refusals are final');
  await test('a text post with a link goes to /feed with the page token in the header', async () => {
    const r = await publish({ connection_id: fbConn, caption: cap('fb text'), params: { link: 'https://aimeat.io' } });
    assert(r.status === 200 && r.data.data.attempt.status === 'done', `${r.status} ${r.data?.error?.message}`);
    assert(/^https:\/\/www\.facebook\.com\/1001_\d+$/.test(r.data.data.url), `url ${r.data.data.url}`);
    const call = up.last((x) => x.path.endsWith('/1001/feed'));
    const form = new URLSearchParams(call.body);
    assert(form.get('link') === 'https://aimeat.io' && call.headers.authorization === 'Bearer page-token-1001', 'feed call shape');
    attempt.fb = r.data.data.attempt.id;
  });
  await test('a JPEG goes to /photos as a file with a caption; a video goes to the graph-video host', async () => {
    const p = await publish({ connection_id: fbConn, storage_key: 'soc/pic.jpg', caption: cap('fb photo') });
    assert(p.status === 200, `photo ${p.status} ${p.data?.error?.message}`);
    const photo = up.last((x) => x.path.endsWith('/1001/photos'));
    assert(photo.form?.get('caption') && photo.form.get('source'), 'photo multipart lacks caption or source');
    const v = await publish({ connection_id: fbConn, storage_key: 'soc/clip.mp4', caption: cap('fb video'), params: { title: 'Demo' } });
    assert(v.status === 200 && /\/1001\/videos\/\d+$/.test(v.data.data.url), `video ${v.status} ${v.data?.data?.url}`);
    assert(up.last((x) => x.path.endsWith('/1001/videos')).host === 'graph-video.facebook.com', 'video went to the wrong host');
  });
  await test('Meta code 190 is final (reconnect); a rate limit is temporary', async () => {
    up.metaError = { status: 400, code: 190 };
    const dead = await publish({ connection_id: fbConn, caption: cap('fb dead token') });
    assert(dead.status === 502 && dead.data.error.code === 'REJECTED' && /connect the account again/.test(dead.data.error.message), `${dead.status} ${dead.data?.error?.code}`);
    up.metaError = { status: 400, code: 4 };
    const busy = await publish({ connection_id: fbConn, caption: cap('fb busy') });
    assert(busy.status === 502 && busy.data.error.code === 'PUBLISH_FAILED', `${busy.status} ${busy.data?.error?.code}`);
  });
  await test('a page post reports reactions, comments and shares, and its comments read back', async () => {
    const m = await metrics(attempt.fb!);
    assert(m.status === 200, `metrics ${m.status} ${m.data?.error?.message}`);
    const s = m.data.data.sample;
    assert(s.likes === 14 && s.comments === 5 && s.shares === 2 && s.impressions === null, `sample ${JSON.stringify(s)}`);
    const r = await replies(attempt.fb!);
    assert(r.status === 200, `replies ${r.status} ${r.data?.error?.message}`);
    const list = r.data.data.replies as any[];
    assert(list.length === 2 && list[0].author === 'Maija' && list[1].author === 'someone' && list[1].parentId === 'c1', `replies ${JSON.stringify(list)}`);
  });

  console.log('\nPhase 4 — Instagram: the wrapped token, the 60 days, the professional account');
  await test('connecting reads the token from `data`, extends it, and names the account', async () => {
    const { cb, list } = await connect(jwt, 'instagram');
    assert(cb.status === 302, `callback ${cb.status} ${await cb.text()}`);
    const c = list.find((x) => x.provider === 'instagram');
    assert(c?.accountLabel === '@aimeat_test', `label ${c?.accountLabel}`);
    igConn = c.id;
    const row = await storage.getConnection(igConn);
    const days = (new Date(row!.expiresAt!).getTime() - Date.now()) / 86_400_000;
    assert(row!.externalId === '17840000001' && days > 59 && days < 61, `external ${row!.externalId}, ${days} days`);
  });
  await test('a personal Instagram account is refused at connect, with the fix in the sentence', async () => {
    up.igAccountType = 'PERSONAL';
    const { cb } = await connect(jwtB, 'instagram');
    up.igAccountType = 'BUSINESS';
    assert(cb.status === 400 && /professional/.test(await cb.text()), `callback ${cb.status}`);
  });

  console.log('\nPhase 5 — Instagram: the picture it fetches from the node');
  await test('a JPEG is fetched from the node\'s own address, waited for, published, and the address closes', async () => {
    up.igPollsInProgress = 1;
    const r = await publish({ connection_id: igConn, storage_key: 'soc/pic.jpg', caption: cap('ig pic'), params: { alt: 'a picture' } });
    assert(r.status === 200 && r.data.data.attempt.status === 'done', `${r.status} ${r.data?.error?.message}`);
    assert(up.igFetched?.status === 200 && up.igFetched.bytes === JPEG.length && up.igFetched.type === 'image/jpeg', `fetched ${JSON.stringify(up.igFetched)}`);
    assert(r.data.data.url === 'https://www.instagram.com/p/TESTCODE/#media=17900000000000001', `url ${r.data.data.url}`);
    const made = JSON.parse(up.last((x) => /\/media$/.test(x.path) && x.method === 'POST').body);
    assert(made.alt_text === 'a picture', 'alt text not sent');
    const after = await fetch(made.image_url);
    assert(after.status === 404, `the media address still answers ${after.status} after the publish`);
    attempt.ig = r.data.data.attempt.id;
  });
  await test('text alone and a PNG are refused for good, each saying why', async () => {
    const t = await publish({ connection_id: igConn, caption: cap('ig text') });
    assert(t.data.error.code === 'REJECTED' && /picture or a video/.test(t.data.error.message), `text ${t.data?.error?.message}`);
    const p = await publish({ connection_id: igConn, storage_key: 'soc/pic.png', caption: cap('ig png') });
    assert(p.data.error.code === 'REJECTED' && /JPEG/.test(p.data.error.message), `png ${p.data?.error?.message}`);
  });
  await test('likes and comments come back, and the comments with their replies', async () => {
    const m = await metrics(attempt.ig!);
    assert(m.status === 200 && m.data.data.sample.likes === 21 && m.data.data.sample.shares === 3, `metrics ${JSON.stringify(m.data)}`);
    const r = await replies(attempt.ig!);
    const list = r.data.data.replies as any[];
    assert(list.length === 2 && list[1].parentId === 'ig1' && list[0].authorHandle === '@fan_one', `replies ${JSON.stringify(list)}`);
  });
  await test('a week before the 60 days end, the next use renews the token', async () => {
    const row = await storage.getConnection(igConn);
    await storage.updateConnectionCredential(igConn, row!.credential, new Date(Date.now() + 3 * 86_400_000).toISOString());
    const before = up.igRefreshes;
    const m = await metrics(attempt.ig!);
    assert(m.status === 200 && up.igRefreshes === before + 1, `refreshes ${up.igRefreshes - before}`);
    const days = (new Date((await storage.getConnection(igConn))!.expiresAt!).getTime() - Date.now()) / 86_400_000;
    assert(days > 59, `renewed to ${days} days`);
  });

  console.log('\nPhase 6 — Reddit: a permanent grant, the User-Agent, a subreddit post');
  await test('the round asks for duration=permanent and the token call carries Basic auth and a User-Agent', async () => {
    const { cb, authorizeUrl, list } = await connect(jwt, 'reddit');
    assert(cb.status === 302, `callback ${cb.status} ${await cb.text()}`);
    assert(new URL(authorizeUrl).searchParams.get('duration') === 'permanent', `authorize ${authorizeUrl}`);
    const tok = up.last((x) => x.path === '/api/v1/access_token');
    assert(/^Basic /.test(tok.headers.authorization ?? '') && /aimeat/.test(tok.headers['user-agent'] ?? ''), `token headers ${JSON.stringify(tok.headers)}`);
    const c = list.find((x) => x.provider === 'reddit');
    assert(c?.accountLabel === 'u/aimeat_official', `label ${c?.accountLabel}`);
    rdConn = c.id;
  });
  await test('a text post goes to the named subreddit; no subreddit and a file are final refusals', async () => {
    const r = await publish({ connection_id: rdConn, caption: cap('Hello r/aimeat\nWhat we build'), params: { subreddit: 'r/aimeat' } });
    assert(r.status === 200 && r.data.data.url === 'https://www.reddit.com/r/aimeat/comments/abc123/hello/', `${r.status} ${r.data?.data?.url} ${r.data?.error?.message}`);
    const form = new URLSearchParams(up.last((x) => x.path === '/api/submit').body);
    assert(form.get('sr') === 'aimeat' && form.get('kind') === 'self' && form.get('title')!.startsWith('Hello r/aimeat'), `form ${form}`);
    attempt.rd = r.data.data.attempt.id;
    const none = await publish({ connection_id: rdConn, caption: cap('no sub') });
    assert(none.data.error.code === 'REJECTED' && /subreddit/.test(none.data.error.message), `none ${none.data?.error?.message}`);
    const file = await publish({ connection_id: rdConn, storage_key: 'soc/pic.jpg', caption: cap('rd file'), params: { subreddit: 'aimeat' } });
    assert(file.data.error.code === 'REJECTED', `file ${file.data?.error?.code}`);
  });
  await test('RATELIMIT is temporary, a missing subreddit is final', async () => {
    up.redditErrors = [['RATELIMIT', 'you are doing that too much', 'ratelimit']];
    const slow = await publish({ connection_id: rdConn, caption: cap('rd slow'), params: { subreddit: 'aimeat' } });
    assert(slow.data.error.code === 'PUBLISH_FAILED', `slow ${slow.data?.error?.code}`);
    up.redditErrors = [['SUBREDDIT_NOEXIST', 'that subreddit does not exist', 'sr']];
    const gone = await publish({ connection_id: rdConn, caption: cap('rd gone'), params: { subreddit: 'nosuch' } });
    assert(gone.data.error.code === 'REJECTED' && /SUBREDDIT_NOEXIST/.test(gone.data.error.message), `gone ${gone.data?.error?.message}`);
  });
  await test('score and comments come back, and the comment tree flattens with its parents', async () => {
    const m = await metrics(attempt.rd!);
    assert(m.status === 200 && m.data.data.sample.likes === 42 && m.data.data.sample.comments === 3, `metrics ${JSON.stringify(m.data)}`);
    const r = await replies(attempt.rd!);
    const list = r.data.data.replies as any[];
    assert(list.length === 2, `replies ${list.length}`);
    const reply = list.find((x) => x.id === 't1_k2');
    assert(reply?.parentId === 't1_k1' && reply.authorHandle === 'u/aimeat_official', `reply ${JSON.stringify(reply)}`);
  });

  console.log('\nPhase 7 — X: an article and a thread');
  await test('an article is a draft of headed blocks, then published', async () => {
    xConn = (await connect(jwt, 'x')).list.find((x) => x.provider === 'x').id;
    const body = '# What AIMEAT does\nYour AI keeps what you taught it.\n\n## Three things\n- memory you own\n- agents\n1. one\n2. two';
    const r = await publish({ connection_id: xConn, caption: cap(body), params: { format: 'article', title: 'AIMEAT in five minutes' } });
    assert(r.status === 200 && r.data.data.url === 'https://x.com/aimeat/status/1999999999999999999', `${r.status} ${r.data?.data?.url} ${r.data?.error?.message}`);
    const blocks = (up.xArticle!.content_state as any).blocks as any[];
    const types = blocks.map((b) => b.type);
    assert(types[0] === 'header-one' && types.includes('header-two') && types.includes('unordered-list-item') && types.includes('ordered-list-item'), `types ${types}`);
    const noTitle = await publish({ connection_id: xConn, caption: cap('x untitled'), params: { format: 'article' } });
    assert(noTitle.data.error.code === 'REJECTED' && /title/.test(noTitle.data.error.message), 'an untitled article was not refused');
  });
  await test('a thread chains each part to the one before', async () => {
    up.xTweets = [];
    const r = await publish({ connection_id: xConn, caption: cap('one\n---\ntwo\n---\nthree'), params: { format: 'thread' } });
    assert(r.status === 200, `${r.status} ${r.data?.error?.message}`);
    assert(up.xTweets.length === 3 && !(up.xTweets[0] as any).reply, 'first part replies to something');
    assert((up.xTweets[2] as any).reply.in_reply_to_tweet_id === '1900000000000000002', `chain ${JSON.stringify(up.xTweets[2])}`);
    attempt.x = r.data.data.attempt.id;
  });
  await test('a thread that breaks half way is final, and says which parts are already public', async () => {
    up.xTweets = []; up.xFailAtPart = { part: 2, status: 403 };
    const r = await publish({ connection_id: xConn, caption: cap('a\n---\nb\n---\nc'), params: { format: 'thread' } });
    up.xFailAtPart = null;
    assert(r.data.error.code === 'REJECTED' && /Parts 1-1 are public/.test(r.data.error.message), `${r.data?.error?.message}`);
  });

  console.log('\nPhase 8 — Mastodon posts a sentence with no file');
  await test('a text-only status goes out (it was refused until 2026-10-15)', async () => {
    mastoConn = (await connect(jwt, 'mastodon', { instance: 'mastodon.social' })).list.find((x) => x.provider === 'mastodon').id;
    const r = await publish({ connection_id: mastoConn, caption: cap('just words') });
    assert(r.status === 200 && r.data.data.url === 'https://mastodon.social/@aimeat/1130001', `${r.status} ${r.data?.error?.message}`);
    assert(!new URLSearchParams(up.last((x) => x.path === '/api/v1/statuses').body).has('media_ids[]'), 'a medium was named');
    attempt.masto = r.data.data.attempt.id;
  });

  console.log('\nPhase 9 — replies on the other networks, in one shape');
  await test('Mastodon: HTML becomes text, newest first, the parent named', async () => {
    const list = (await replies(attempt.masto!)).data.data.replies as any[];
    assert(list[0].text === 'Samaa mieltä' && list[0].parentId === '1130002' && list[1].text === 'Hyvä & selkeä' && list[1].parentId === null, `${JSON.stringify(list)}`);
  });
  await test('Bluesky: the nested replies flatten, a blocked one is skipped', async () => {
    const at = await api('/v1/connections/attach', { bearer: jwt, body: { provider: 'bluesky', fields: { identifier: 'aimeat.bsky.social', password: 'app-pw-1234' } } });
    bskyConn = at.data.data.connection.id;
    const p = await publish({ connection_id: bskyConn, caption: cap('bsky') });
    const list = (await replies(p.data.data.attempt.id)).data.data.replies as any[];
    assert(list.length === 2 && list.some((x) => x.parentId === 'at://did:plc:r1/app.bsky.feed.post/r1'), `${JSON.stringify(list)}`);
    assert(list.find((x) => x.authorHandle === 'r1.bsky.social').url === 'https://bsky.app/profile/r1.bsky.social/post/r1', 'bsky url');
  });
  await test('YouTube: a thread and its reply; an old connection is told to reconnect', async () => {
    ytConn = (await connect(jwt, 'youtube')).list.find((x) => x.provider === 'youtube').id;
    const id = `yt-${stamp}`;
    await storage.openPublishAttempt({ id, idempotencyKey: id, publisher: `${owner}@${config.nodeId}`, connectionId: ytConn, delegationId: null, storageKey: '', status: 'in_flight' });
    await storage.updatePublishAttempt(id, { status: 'done', externalRef: 'https://youtu.be/abcDEF12345' });
    const list = (await replies(id)).data.data.replies as any[];
    assert(list.length === 2 && list[1].parentId === 'yc1' && list[0].likes === 7, `${JSON.stringify(list)}`);
    up.youtubeCommentsRefusal = 'insufficientPermissions';
    const old = await replies(id);
    assert(old.status === 409 && old.data.error.code === 'NOT_READABLE' && /Connect the YouTube account again/.test(old.data.error.message), `${old.status} ${old.data?.error?.message}`);
  });
  await test('X: the conversation, with handles from the expansion and a note about seven days', async () => {
    const r = await replies(attempt.x!);
    const list = r.data.data.replies as any[];
    assert(list.length === 2 && list[0].authorHandle === '@dev_one' && list[1].parentId === '2001', `${JSON.stringify(list)}`);
    assert(/seven days/.test(r.data.data.note), `note ${r.data.data.note}`);
  });
  await test('LinkedIn: a permanent refusal that says why, never an empty list', async () => {
    liConn = (await connect(jwt, 'linkedin')).list.find((x) => x.provider === 'linkedin').id;
    const p = await publish({ connection_id: liConn, caption: cap('li') });
    const r = await replies(p.data.data.attempt.id);
    assert(r.status === 409 && /select partners/.test(r.data.error.message), `${r.status} ${r.data?.error?.message}`);
  });

  console.log('\nPhase 10 — who may read replies');
  await test('another owner reading an item of this owner gets the same 404 as a missing one', async () => {
    const theirs = await replies(attempt.fb!, jwtB);
    const missing = await replies('no-such-attempt', jwtB);
    assert(theirs.status === 404 && missing.status === 404 && theirs.data.error.message === missing.data.error.message, `${theirs.status} ${missing.status}`);
  });
  await test('an app granted neither connections:use nor read-through is refused the replies read', async () => {
    // connections:read is not grantable to an app at all, so the probe holds an unrelated word.
    const tok = await grantAppToken(['memory:read']);
    const r = await replies(attempt.fb!, tok);
    assert(r.status === 403, `status ${r.status}`);
  });
  await test('an agent without connections:read-as-owner sees none of its owner\'s items', async () => {
    const tok = await agentToken(`noread${stamp % 100000}`, ['connections:read', 'connections:read-through']);
    const hist = await api('/v1/connections/attempts', { method: 'GET', bearer: tok });
    assert(hist.status === 200 && (hist.data.data.attempts as any[]).length === 0, `history ${hist.status} ${JSON.stringify(hist.data?.data)}`);
    const r = await replies(attempt.fb!, tok);
    assert(r.status === 404, `replies ${r.status}`);
  });
  await test('an agent on connections:read-as-owner lists its owner\'s items and reads their replies', async () => {
    const tok = await agentToken(`ownread${stamp % 100000}`, ['connections:read', 'connections:read-through', 'connections:read-as-owner']);
    const hist = await api('/v1/connections/attempts', { method: 'GET', bearer: tok });
    const items = hist.data?.data?.attempts as any[];
    const fb = items?.find((x) => x.id === attempt.fb);
    assert(hist.status === 200 && fb && fb.holder === 'owner', `history ${hist.status} ${JSON.stringify(items?.slice(0, 2))}`);
    const r = await replies(attempt.fb!, tok);
    assert(r.status === 200 && (r.data.data.replies as any[]).length === 2, `replies ${r.status} ${r.data?.error?.message}`);
  });
  await test('read-as-owner never reaches another owner\'s items', async () => {
    const regB = await api('/v1/agents', { bearer: jwtB, body: { name: `bread${stamp % 100000}`, owner: `sy${stamp}`, display_name: 'b', capabilities: [], scopes: ['connections:read', 'connections:read-through', 'connections:read-as-owner'] } });
    assert(regB.status === 201, `create agent of B: ${regB.status} ${JSON.stringify(regB.data?.error)}`);
    const tok = await tokenFor(regB.data.data.agent.gaii, regB.data.data.private_key);
    const r = await replies(attempt.fb!, tok);
    assert(r.status === 404, `replies ${r.status}`);
  });

  console.log('\nPhase 11 — the media address');
  await test('an address nothing is held at answers 404', async () => {
    const r = await fetch(`${BASE}/v1/connections/media/${randomBytes(32).toString('base64url')}/x.jpg`);
    assert(r.status === 404, `status ${r.status}`);
  });
} finally {
  restore();
  console.log(`\n═══ CONNECTIONS SOCIAL: ${passed} passed, ${failed} failed (${passed + failed} total) ═══\n`);
  server.close();
  await (storage as { disconnect?: () => Promise<void> }).disconnect?.();
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* Windows may still hold the SQLite file */ }
}

/** An agent of the first owner with exactly `scopes`, and its session JWT. */
async function agentToken(name: string, scopes: string[]): Promise<string> {
  const created = await api('/v1/agents', { bearer: jwt, body: { name, owner, display_name: name, capabilities: [], scopes } });
  assert(created.status === 201, `create agent ${name}: ${created.status} ${JSON.stringify(created.data?.error)}`);
  return tokenFor(created.data.data.agent.gaii as string, created.data.data.private_key as string);
}

/** An agent's session JWT from its key, as the device flow's agent signs in. */
async function tokenFor(gaii: string, privB64: string): Promise<string> {
  const ts = new Date().toISOString();
  const sig = await ed.signAsync(new TextEncoder().encode(gaii + ts), Buffer.from(privB64, 'base64'));
  const tok = await api('/v1/auth/token', { body: { gaii, timestamp: ts, signature: Buffer.from(sig).toString('base64') } });
  assert(tok.data?.ok === true, `agent token: ${JSON.stringify(tok.data?.error)}`);
  return tok.data.data.token as string;
}

/** An app-grant bearer carrying exactly `scopes`: role 'app', which never gets the owner bypass. */
async function grantAppToken(scopes: string[]): Promise<string> {
  const redirect = 'http://localhost:9933/callback';
  const verifier = randomBytes(32).toString('base64url');
  const filename = `social-gate-${Date.now()}.html`;
  const pub = await api('/v1/apps', { bearer: jwt, body: { filename, content: Buffer.from('<!DOCTYPE html><html><body>g</body></html>').toString('base64'), name: 'Gate probe', description: 'probe', category: 'tool' } });
  assert(pub.status === 201, `publish probe app: ${pub.status}`);
  const q = new URLSearchParams({
    app: `${owner}/${filename}`, response_type: 'code', scope: scopes.join(' '), redirect_uri: redirect, state: 'x',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
  });
  const auth = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
  const location = auth.headers.get('location') ?? '';
  const req = /req=([^&]+)/.exec(location);
  assert(req, `authorize answered ${auth.status} ${location || await auth.text()}`);
  const requestId = decodeURIComponent(req[1]!);
  const consent = await api('/v1/app-grants/authorize-consent', { bearer: jwt, body: { request_id: requestId } });
  const code = new URL(consent.data.data.redirect_url as string).searchParams.get('code') ?? '';
  const tok = await api('/v1/app-grants/token', { body: { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect } });
  assert(tok.status === 200, `app token: ${tok.status}`);
  return tok.data.data.access_token as string;
}

process.exit(failed > 0 ? 1 : 0);
