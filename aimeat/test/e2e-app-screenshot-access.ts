/**
 * @file test/e2e-app-screenshot-access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The screenshot of an app that opens for fewer people follows who may open it
 *   (secaudit2026oct31w2 round 10, W2-12, the developer's ruling 1 of 2026-10-31).
 *     - Attack: a caller the app does not open for gets the app's own refusal at
 *       GET /v1/apps/:owner/:filename/screenshot (401 without an account, 403 for an account outside
 *       the organism), and the public catalogue row has no screenshot address for them.
 *     - Usage kept: an app anyone may open serves its screenshot to anyone with `public` caching; the
 *       owner and an account the app opens for read it with their session; the owner's listing hands
 *       an address that loads with no session (an <img>), and the icon stays public.
 *     - The setting: `screenshot_public` through PATCH /v1/apps/:filename and aimeat_app_manage
 *       action settings shows the screenshot to everyone and back again; a screenshot grant of one
 *       app does not show another app's.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-app-screenshot-access
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (secaudit2026oct31w2 round 10, W2-12).
 */
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}: ${(e as Error).message}`); }
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit & { token?: string } = {}): Promise<{ status: number; body: any }> {
    const { token, ...rest } = opts;
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            ...rest,
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(rest.headers ?? {}) },
        });
        if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        const text = await res.text();
        let body: any;
        try { body = JSON.parse(text); } catch { body = { _raw: text }; }
        return { status: res.status, body };
    }
}

/** A picture request as an <img> sends it: no session unless a token is named. */
async function shot(path: string, token?: string): Promise<{ status: number; cache: string; code?: string }> {
    const res = await fetch(`${BASE}${path}`, { headers: { Accept: 'image/avif,image/webp,image/*,*/*;q=0.8', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    const ct = res.headers.get('content-type') ?? '';
    const code = ct.includes('json') ? ((await res.json()) as any)?.error?.code : (await res.arrayBuffer(), undefined);
    return { status: res.status, cache: res.headers.get('cache-control') ?? '', code };
}

const short = (v: unknown) => String(JSON.stringify(v)).slice(0, 240);
const stamp = Date.now().toString(36).slice(-5);
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const OPEN = `shot-open-${stamp}.html`;
const SIGNED = `shot-signed-${stamp}.html`;
const ORG = `shot-org-${stamp}.html`;

let owner: RegisteredOwner;
let other: RegisteredOwner;
let organismId = '';
const shotPath = (file: string) => `/v1/apps/${owner.name}/${file}/screenshot`;

async function publish(file: string): Promise<void> {
    const r = await json('/v1/apps', {
        method: 'POST', token: owner.token,
        body: JSON.stringify({ filename: file, content: Buffer.from(`<h1>${file}</h1>`).toString('base64'), name: file, description: 'A page with a screenshot.', category: 'utility', tags: [], screenshot: PNG, screenshot_mime_type: 'image/png' }),
    });
    assert(r.status === 201, `publish ${file}: ${r.status} ${short(r.body?.error)}`);
}

const patch = (file: string, body: Record<string, unknown>) => json(`/v1/apps/${file}`, { method: 'PATCH', token: owner.token, body: JSON.stringify(body) });

console.log('\n=== APP SCREENSHOT ACCESS E2E ===\n');

await test('fixture: an app open to anyone, one for signed-in people, one listed for one organism, each with a screenshot', async () => {
    owner = await registerOwner(BASE, `shown${stamp}`);
    other = await registerOwner(BASE, `shoth${stamp}`);
    const org = await json('/v1/organisms', { method: 'POST', token: owner.token, body: JSON.stringify({ name: `Shot place ${stamp}`, description: 'organism for the screenshot suite', type: 'community' }) });
    assert(org.status === 201, `organism: ${org.status} ${short(org.body)}`);
    organismId = org.body.data.organism.id;
    for (const f of [OPEN, SIGNED, ORG]) await publish(f);
    const s = await patch(SIGNED, { open_to: 'signed-in', listing: 'unlisted' });
    assert(s.status === 200, `signed-in: ${s.status} ${short(s.body?.error)}`);
    const o = await patch(ORG, { open_to: `organism:${organismId}`, listing: 'listed' });
    assert(o.status === 200, `organism: ${o.status} ${short(o.body?.error)}`);
});

console.log('\nThe attack: callers the app does not open for');

await test('no account: the signed-in app\'s screenshot answers 401 SIGN_IN_REQUIRED, as the app does', async () => {
    const r = await shot(shotPath(SIGNED));
    assert(r.status === 401 && r.code === 'SIGN_IN_REQUIRED', `anonymous screenshot: ${short(r)}`);
});

await test('an account outside the organism: the organism app\'s screenshot answers 403 ACCESS_DENIED', async () => {
    const r = await shot(shotPath(ORG), other.token);
    assert(r.status === 403 && r.code === 'ACCESS_DENIED', `outsider screenshot: ${short(r)}`);
});

await test('the public catalogue row of the listed organism app carries no screenshot address for an outsider', async () => {
    const anon = await json(`/v1/apps?q=${encodeURIComponent('shot-org-' + stamp)}&limit=50`);
    const row = (anon.body.data?.apps ?? []).find((a: any) => a.filename === ORG);
    assert(row, `the listed app is in the catalogue: ${short(anon.body.data?.apps?.map((a: any) => a.filename))}`);
    assert(row.screenshot_url === null, `anonymous row: ${row.screenshot_url}`);
});

console.log('\nUsage kept');

await test('usage: an app anyone may open serves its screenshot to anyone, cached public', async () => {
    const r = await shot(shotPath(OPEN));
    assert(r.status === 200 && r.cache.includes('public'), `open app screenshot: ${short(r)}`);
});

await test('usage: the owner and an account the app opens for read the screenshot with their session', async () => {
    const own = await shot(shotPath(ORG), owner.token);
    assert(own.status === 200, `owner: ${short(own)}`);
    const signedIn = await shot(shotPath(SIGNED), other.token);
    assert(signedIn.status === 200 && !signedIn.cache.includes('public'), `signed-in account: ${short(signedIn)}`);
});

let orgShotUrl = '';
await test('usage: the owner\'s own listing hands an address that loads with no session, as an <img> asks it', async () => {
    const mine = await json('/v1/apps?own=true&limit=200', { token: owner.token });
    const row = (mine.body.data?.apps ?? []).find((a: any) => a.filename === ORG);
    assert(row && typeof row.screenshot_url === 'string', `owner row: ${short(row)}`);
    orgShotUrl = row.screenshot_url;
    const r = await shot(orgShotUrl);
    assert(r.status === 200, `the owner's listed address without a session: ${short(r)}`);
    assert(row.screenshot_public === false, `the owner's row says the screenshot follows access: ${row.screenshot_public}`);
});

await test('usage: the icon stays public for the access-limited app', async () => {
    const r = await shot(`/v1/apps/${owner.name}/${ORG}/icon`);
    assert(r.status !== 401 && r.status !== 403, `icon: ${short(r)}`);
});

console.log('\nThe setting');

await test('a screenshot grant of one app does not show another app\'s screenshot', async () => {
    const token = new URL(orgShotUrl, BASE).searchParams.get('shot');
    assert(token, `the address carries a grant: ${orgShotUrl}`);
    const r = await shot(`${shotPath(SIGNED)}?shot=${encodeURIComponent(token)}`);
    assert(r.status === 401, `another app's grant: ${short(r)}`);
});

await test('PATCH screenshot_public: true shows the screenshot to everyone, false takes it back', async () => {
    const on = await patch(SIGNED, { screenshot_public: true });
    assert(on.status === 200 && on.body.data?.screenshot_public === true, `on: ${on.status} ${short(on.body?.data ?? on.body?.error)}`);
    const r = await shot(shotPath(SIGNED));
    assert(r.status === 200 && r.cache.includes('public'), `after on: ${short(r)}`);
    const off = await patch(SIGNED, { screenshot_public: false });
    assert(off.status === 200 && off.body.data?.screenshot_public === false, `off: ${off.status} ${short(off.body?.data ?? off.body?.error)}`);
    assert((await shot(shotPath(SIGNED))).status === 401, 'after off the screenshot still shows to anyone');
});

await test('PATCH screenshot_public refuses a value that is not a boolean, and writes nothing', async () => {
    const r = await patch(SIGNED, { screenshot_public: 'yes' });
    assert(r.status === 400 && r.body.error?.code === 'INVALID_INPUT', `bad value: ${r.status} ${short(r.body?.error)}`);
});

await test('aimeat_app_manage action settings sets screenshot_public through the owner\'s agent', async () => {
    const agent = await makeAgent(BASE, owner, ['app:read', 'app:write']);
    const s = await openSession(BASE, agent.token, 'e2e-app-screenshot-access');
    const on = await callTool(s, 'aimeat_app_manage', { action: 'settings', filename: ORG, screenshot_public: true });
    assert(!on.isError && on.data?.screenshot_public === true, `tool on: ${on.text.slice(0, 240)}`);
    assert((await shot(shotPath(ORG), other.token)).status === 200, 'an outsider does not see a screenshot shown to everyone');
    const anon = await json(`/v1/apps?q=${encodeURIComponent('shot-org-' + stamp)}&limit=50`);
    const row = (anon.body.data?.apps ?? []).find((a: any) => a.filename === ORG);
    assert(row?.screenshot_url === shotPath(ORG), `anonymous row after on: ${row?.screenshot_url}`);
    const off = await callTool(s, 'aimeat_app_manage', { action: 'settings', filename: ORG, screenshot_public: false });
    assert(!off.isError && off.data?.screenshot_public === false, `tool off: ${off.text.slice(0, 240)}`);
});

await test('a new version keeps the owner\'s choice', async () => {
    assert((await patch(SIGNED, { screenshot_public: true })).status === 200, 'set');
    await publish(SIGNED);
    assert((await shot(shotPath(SIGNED))).status === 200, 'the republished version lost the choice');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
