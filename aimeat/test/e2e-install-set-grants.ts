/**
 * @file e2e-install-set-grants.ts
 * @description An install set records the owner's grant for each app it installs (the purchase is the
 *   approval, Jouni 2026-10-04), the owner's welcome link opens the set's landing app signed in, and
 *   that app then signs in through the silent bridge with no consent screen. Beside it: the visible
 *   consent flow never treats a package-installed app as the owner's own, the authorize route carries
 *   the create-account hint, and the sign-in routes refuse a request from an app.
 * @structure
 *   - Setup: one node with an app origin; a vendor publishes an app package (it declares two scopes)
 *     and an install bundle that lists it
 *   - Phase 1: the plan shows grant_apps and landing; the apply records the grant for the app
 *   - Phase 2: the welcome link opens the landing app, and the app signs in silently with the scopes
 *     it declares; asking for more goes to the consent screen
 *   - Phase 3: a revoke stays revoked when the set is applied again; grant_apps:false records nothing
 *   - Phase 4: the visible flow marks the app package_app and carries prompt=create
 *   - Phase 5: sign-in and registration from an app (app Origin, isolated frame, app Host) answer 403
 *     APP_ORIGIN_SIGN_IN; the node's own callers and the SAML form post are untouched; with the
 *     setting off the same request is let through
 *   - Phase 6: an owner installing a package: someone else's package records no grant unless the
 *     owner chooses grant_apps, the owner's own package approves its app, an agent approves no scope
 *     it lacks, and a grant_apps that is not a boolean is refused
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-install-set-grants
 * @version-history
 *   v1.2.0 — 2026-10-05 — Phase 3: an apply into an account that existed before leaves the operator
 *     trail (operator_acted) in its feed, and the first apply, which created it, leaves none
 *     (secaudit 2026-10, S4).
 *   v1.1.0 — 2026-10-04 — Phase 6: the owner's own install (Jouni: installing it is approving it).
 *   v1.0.0 — 2026-10-04 — Initial.
 */

import { createHash, randomBytes } from 'node:crypto';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import type { AimeatConfig } from '../src/config.js';
import type { Server } from 'node:http';
import type { Storage } from '../src/storage/interface.js';
import { setActiveEmailService, type EmailService } from '../src/services/email.js';
import { hostRequest } from './helpers/host-request.js';
import { sign } from '../src/auth/keypair.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

// 40752: no other suite names it.
const PORT = 40752;
const BASE = `http://127.0.0.1:${PORT}`;
const APP_HOST = 'apps.aimeat.test';
const ts = Date.now() % 1000000;
const NODE_ID = `aimeat-test-001-isgrant${ts}`;
const SCOPES = 'memory:read storage:read';

let config: AimeatConfig;
let storage: Storage;
let server: Server;
let adminPw = '';

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const ownerKeys = new Map<string, string>();
async function setupOwner(name: string): Promise<string> {
    const reg = await json('/v1/admin/setup/register', { method: 'POST', headers: { 'X-Admin-Password': adminPw }, body: JSON.stringify({ name }) });
    assert(reg.status === 200 && reg.body.ok === true, `register ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    ownerKeys.set(name, reg.body.private_key);
    const tok = await json('/v1/admin/setup/token', { method: 'POST', headers: { 'X-Admin-Password': adminPw }, body: JSON.stringify({ owner: name, private_key: reg.body.private_key }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.token as string;
}

const mails: { to: string; method: string; args: unknown[] }[] = [];
const captureMail = new Proxy({ enabled: true } as Record<string | symbol, unknown>, {
    get: (target, prop) => {
        if (prop in target) return target[prop];
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        return async (to: string, ...args: unknown[]) => { mails.push({ to, method: prop, args }); return true; };
    },
}) as unknown as EmailService;

/** The sign-in link in the welcome mail to `email`. */
function welcomeLink(email: string): string {
    const m = mails.filter(x => x.to === email && x.method === 'sendRaw').pop();
    assert(!!m, `a welcome mail to ${email}`);
    const text = String(m!.args[2] ?? '');
    const link = /https?:\/\/\S+\/v1\/ghii\/magic-link\/open\?\S+/.exec(text)?.[0];
    assert(!!link, `a sign-in link in the mail: ${text.slice(0, 300)}`);
    return link!;
}

/** A browser opening a link: no redirect followed, the refresh cookie kept. */
async function openInBrowser(url: string): Promise<{ status: number; location: string; rt: string | null }> {
    const res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
    const h = res.headers as Headers & { getSetCookie?: () => string[] };
    const cookies = typeof h.getSetCookie === 'function' ? h.getSetCookie() : [res.headers.get('set-cookie') ?? ''];
    const rt = cookies.map(c => /(?:^|;\s*)aimeat_rt=([^;]*)/.exec(c)?.[1]).find(Boolean) ?? null;
    return { status: res.status, location: res.headers.get('location') ?? '', rt: rt ? decodeURIComponent(rt) : null };
}

/** The silent bridge as the apex bridge page calls it: the session cookie and the app's origin. */
async function silent(origin: string, scope: string, rt: string) {
    const res = await fetch(`${BASE}/v1/auth/app-grant-silent?origin=${encodeURIComponent(origin)}&scope=${encodeURIComponent(scope)}`,
        { headers: { Cookie: `aimeat_rt=${encodeURIComponent(rt)}` } });
    return (await res.json() as any).data as { ok: boolean; error?: string; reason?: string; scope?: string; own?: boolean; grant_id?: string };
}

const APP_HTML = `<!DOCTYPE html><html><head><title>Shop</title><meta name="aimeat-scopes" content="${SCOPES}"></head><body>shop</body></html>`;
const MANIFEST = { objectTypes: [{ name: 'order', schemaRef: 'schema:order@1', namespace: 'orders', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode: 'records' }] };

let opsToken = '';
let vendorToken = '';
let shopGroup = '';
let setupGroup = '';
const ACME = `acme${ts}`;
const ACME_EMAIL = `acme${ts}@example.org`;
let appTarget = '';
let appOrigin = '';
let acmeRt = '';

const installSet = (extra: Record<string, unknown> = {}) => ({
    spec: 'aimeat.install-set/1',
    bundle: { group_id: setupGroup },
    owner: { name: ACME, email: ACME_EMAIL },
    landing: { group_id: shopGroup, app: 'app-shop' },
    ...extra,
});

console.log('\n=== AIMEAT Install Set Grants E2E ===\n');
console.log('Setup');

await test('Boot a node with an app origin, an operator and a vendor', async () => {
    adminPw = randomBytes(16).toString('base64url');
    process.env.AIMEAT_PORT = String(PORT);
    process.env.AIMEAT_DEV_MODE = 'true';
    process.env.AIMEAT_TEST_MODE = 'true';
    process.env.AIMEAT_ADMIN_PASSWORD = adminPw;
    process.env.AIMEAT_NODE_ID = NODE_ID;
    process.env.AIMEAT_BASE_URL = BASE;
    process.env.AIMEAT_STORAGE = 'memory';
    ({ config } = loadConfig({}));
    Object.assign(config, {
        port: PORT, nodeId: NODE_ID, baseUrl: BASE, devMode: true, testMode: true, adminPassword: adminPw,
        storageProvider: 'memory', packagesEnabled: true, packageCreateRole: 'owner',
        appHost: APP_HOST, appOriginEnabled: true, appOriginSignInRefuse: true,
        // Phase 6 makes six accounts through the admin setup routes, which allow five a minute.
        adminAuthRateLimitMax: 100,
    });
    const made = await createServer(config);
    storage = made.storage;
    server = await new Promise<Server>((resolve) => { const s = made.app.listen(PORT, '127.0.0.1', () => resolve(s)); });
    opsToken = await setupOwner(`ops${ts}`);
    vendorToken = await setupOwner(`vendor${ts}`);
    setActiveEmailService(captureMail);
});

await test('The vendor publishes an app package that declares two scopes, and a bundle that lists it', async () => {
    const shop = await json('/v1/packages', {
        method: 'POST', headers: auth(vendorToken),
        body: JSON.stringify({ name: `shop${ts}`, description: 'A shop app', category: 'utility', visibility: 'public',
            components: [{ id: 'app-shop', type: 'app', label: 'Shop', content: APP_HTML, dependencies: [] }] }),
    });
    assert(shop.status === 201, `shop: ${shop.status} ${JSON.stringify(shop.body)}`);
    shopGroup = shop.body.data.packageGroupId;
    const bundle = {
        spec: 'aimeat.install-bundle/1', name: 'Shop setup',
        packages: [{ group_id: shopGroup, mode: 'managed' }],
        organisms: [{ key: 'team', name: 'Team', workspaces: [{ key: 'orders', name: 'Orders', manifest: MANIFEST }] }],
        agents: [],
    };
    const setup = await json('/v1/packages', {
        method: 'POST', headers: auth(vendorToken),
        body: JSON.stringify({ name: `setup${ts}`, description: 'The shop setup', category: 'utility', visibility: 'public',
            components: [{ id: 'install-bundle', type: 'memory', label: 'Install bundle', content: JSON.stringify(bundle), dependencies: [] }] }),
    });
    assert(setup.status === 201, `bundle: ${setup.status} ${JSON.stringify(setup.body)}`);
    setupGroup = setup.body.data.packageGroupId;
});

console.log('\nPhase 1 — The plan and the apply');

await test('A landing app the bundle does not list is refused, naming the field', async () => {
    const r = await json('/v1/install-sets/apply', { method: 'POST', headers: auth(opsToken),
        body: JSON.stringify({ install_set: installSet({ landing: { group_id: 'other::x', app: 'app-shop' } }), dry_run: true }) });
    assert(r.status === 400 && /landing/.test(r.body.error?.message ?? ''), `expected 400 on landing: ${r.status} ${JSON.stringify(r.body)}`);
});

await test('The plan says the set records the app grants and names the landing app', async () => {
    const r = await json('/v1/install-sets/apply', { method: 'POST', headers: auth(opsToken), body: JSON.stringify({ install_set: installSet(), dry_run: true }) });
    assert(r.status === 200, `plan: ${r.status} ${JSON.stringify(r.body)}`);
    const plan = r.body.data.plan;
    assert(plan.grant_apps === true, `grant_apps: ${JSON.stringify(plan)}`);
    assert(plan.landing?.group_id === shopGroup && plan.landing?.app === 'app-shop', `landing: ${JSON.stringify(plan.landing)}`);
});

await test('The apply records the owner\'s grant for the installed app, for exactly the scopes it declares', async () => {
    const r = await json('/v1/install-sets/apply', { method: 'POST', headers: auth(opsToken), body: JSON.stringify({ install_set: installSet() }) });
    assert(r.status === 201, `apply: ${r.status} ${JSON.stringify(r.body)}`);
    const grants = r.body.data.record.app_grants ?? {};
    const keys = Object.keys(grants);
    assert(keys.length === 1 && keys[0].startsWith(`${ACME}/`), `one grant for an app of ${ACME}: ${JSON.stringify(grants)}`);
    appTarget = keys[0];
    assert(grants[appTarget].result === 'granted', `granted: ${JSON.stringify(grants[appTarget])}`);
    assert([...grants[appTarget].scopes].sort().join(' ') === SCOPES.split(' ').sort().join(' '), `the declared scopes: ${JSON.stringify(grants[appTarget].scopes)}`);
    const filename = appTarget.slice(appTarget.indexOf('/') + 1);
    assert(r.body.data.record.landing_path === `/v1/apps/${ACME}/${filename}?mode=inline`, `the record names the landing path: ${r.body.data.record.landing_path}`);
    const row = await storage.getAppGrantByOwnerAndApp(ACME, appTarget);
    assert(!!row && !row.revoked, `a live grant row for ${appTarget}`);
});

console.log('\nPhase 2 — The welcome link and the silent sign-in');

await test('The owner\'s welcome link opens the landing app, signed in', async () => {
    const link = welcomeLink(ACME_EMAIL);
    const filename = appTarget.slice(appTarget.indexOf('/') + 1);
    assert(link.includes(`redirect=${encodeURIComponent(`/v1/apps/${ACME}/${filename}?mode=inline`)}`), `the link carries the landing app: ${link}`);
    const opened = await openInBrowser(link);
    assert(opened.status === 302 && !!opened.rt, `opened: ${opened.status} rt=${!!opened.rt}`);
    assert(opened.location === `${BASE}/v1/apps/${ACME}/${filename}?mode=inline`, `lands on the app: ${opened.location}`);
    acmeRt = opened.rt!;
    // The landing address sends the browser on to the app's own origin.
    const hop = await fetch(opened.location, { redirect: 'manual' });
    const to = hop.headers.get('location') ?? '';
    assert(hop.status === 301 && new URL(to).hostname.endsWith(`.${APP_HOST}`), `to the app origin: ${hop.status} ${to}`);
    appOrigin = new URL(to).origin;
});

await test('The installed app signs in silently, with no consent screen, for the scopes it declares', async () => {
    const r = await silent(appOrigin, SCOPES, acmeRt);
    assert(r.ok === true && r.own === false, `silent: ${JSON.stringify(r)}`);
    assert(SCOPES.split(' ').every(s => (r.scope ?? '').split(' ').includes(s)), `scopes: ${r.scope}`);
});

await test('The same app asking for a scope the purchase did not cover goes to the consent screen', async () => {
    const r = await silent(appOrigin, `${SCOPES} memory:write`, acmeRt);
    assert(r.ok === false && r.error === 'consent_required' && r.reason === 'app_updated', `widening: ${JSON.stringify(r)}`);
});

console.log('\nPhase 3 — Revoke, apply again, and a set that records nothing');

await test('A grant the owner revoked stays revoked when the set is applied again', async () => {
    const row = await storage.getAppGrantByOwnerAndApp(ACME, appTarget);
    await storage.updateAppGrant(row!.grantId, { revoked: true });
    const again = await json('/v1/install-sets/apply', { method: 'POST', headers: auth(opsToken), body: JSON.stringify({ install_set: installSet() }) });
    assert(again.status === 201, `apply again: ${again.status} ${JSON.stringify(again.body)}`);
    assert(again.body.data.record.app_grants[appTarget].result === 'granted', `the record keeps the first grant: ${JSON.stringify(again.body.data.record.app_grants)}`);
    assert(!(await storage.getAppGrantByOwnerAndApp(ACME, appTarget)), 'no live grant came back');
    const r = await silent(appOrigin, SCOPES, acmeRt);
    assert(r.ok === false && r.error === 'consent_required', `asks again: ${JSON.stringify(r)}`);
});

await test('An apply into an account that existed before leaves the operator trail in its feed; the first apply, which made it, did not (secaudit 2026-10, S4)', async () => {
    // The first apply created ACME's account, so it welcomed them and wrote no trail; the second apply
    // above was into an account that existed, and the operator acting there is news for its holder.
    const events = await storage.listAccountEvents({ ownerGhii: `${ACME}@${NODE_ID}`, limit: 200 });
    const acted = events.filter((e: any) => e.kind === 'operator_acted' && e.data?.area === 'install-set');
    assert(acted.length === 1, `one operator_acted event for the second apply, got ${acted.length}: ${JSON.stringify(events.map((e: any) => e.kind))}`);
    assert(acted[0].data.action === 'apply' && !!acted[0].data.set && acted[0].data.apps === '1',
        `it names the set and the app given permissions: ${JSON.stringify(acted[0].data)}`);
});

await test('A set with grant_apps:false records no grant', async () => {
    const beta = `beta${ts}`;
    const r = await json('/v1/install-sets/apply', { method: 'POST', headers: auth(opsToken),
        body: JSON.stringify({ install_set: installSet({ owner: { name: beta, email: `${beta}@example.org` }, grant_apps: false }) }) });
    assert(r.status === 201, `apply: ${r.status} ${JSON.stringify(r.body)}`);
    assert(!r.body.data.record.app_grants, `no app_grants: ${JSON.stringify(r.body.data.record.app_grants)}`);
    assert((await storage.listAppGrantsByOwner(beta)).length === 0, 'no grant rows');
});

console.log('\nPhase 4 — The visible consent flow');

await test('The authorize request marks a package-installed app package_app and carries prompt=create', async () => {
    const verifier = randomBytes(32).toString('base64url');
    const q = new URLSearchParams({
        app: appTarget, response_type: 'code', response_mode: 'web_message', scope: SCOPES, redirect_uri: `${appOrigin}/`,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', prompt: 'create',
    });
    const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    const req = /req=([^&]+)/.exec(res.headers.get('location') ?? '')?.[1];
    assert(res.status === 302 && !!req, `authorize: ${res.status} ${res.headers.get('location')}`);
    const pending = await json(`/v1/app-grants/request/${req}`);
    assert(pending.body.data.package_app === true, `package_app: ${JSON.stringify(pending.body.data)}`);
    assert(pending.body.data.prompt === 'create', `prompt: ${pending.body.data.prompt}`);
    assert(pending.body.data.app_owner === ACME && pending.body.data.origin_bound === true, 'the owner and the origin binding as before');
});

console.log('\nPhase 5 — No sign-in from an app');

const login = (headers: Record<string, string>) => json('/v1/ghii/login', { method: 'POST', headers, body: JSON.stringify({ username: ACME, password: 'Wrong-pass-1234' }) });
// The install set made this account with the sign-in link and no password, so a request the guard
// lets through is answered by the password route itself: 400 NO_PASSWORD.
const reachedRoute = (r: { status: number; body: any }) => r.status === 400 && r.body.error?.code === 'NO_PASSWORD';

await test('A password sign-in with an app Origin is refused before the password is read', async () => {
    const r = await login({ Origin: `http://shop.${APP_HOST}` });
    assert(r.status === 403 && r.body.error?.code === 'APP_ORIGIN_SIGN_IN', `expected 403 APP_ORIGIN_SIGN_IN: ${r.status} ${JSON.stringify(r.body)}`);
    assert(/AIMEAT\.auth\.signIn\(\)/.test(r.body.error?.message ?? ''), 'the refusal names signIn()');
});

await test('From the isolated frame (Origin: null) registration and refresh are refused too', async () => {
    const reg = await json('/v1/ghii', { method: 'POST', headers: { Origin: 'null' }, body: JSON.stringify({ username: `x${ts}`, display_name: 'x', password: 'Strong-pass-1234' }) });
    assert(reg.status === 403 && reg.body.error?.code === 'APP_ORIGIN_SIGN_IN', `register: ${reg.status} ${JSON.stringify(reg.body)}`);
    const ref = await json('/v1/auth/refresh', { method: 'POST', headers: { Origin: 'null', 'X-AIMEAT-Refresh': '1', Cookie: `aimeat_rt=${encodeURIComponent(acmeRt)}` } });
    assert(ref.status === 403 && ref.body.error?.code === 'APP_ORIGIN_SIGN_IN', `refresh: ${ref.status} ${JSON.stringify(ref.body)}`);
});

await test('A sign-in that arrives on an app host is refused', async () => {
    const res = await hostRequest(BASE, '/v1/ghii/login', `shop.${APP_HOST}:${PORT}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: ACME, password: 'Wrong-pass-1234' }),
    });
    assert(res.status === 403 && res.json<any>().error?.code === 'APP_ORIGIN_SIGN_IN', `app host: ${res.status} ${res.body.slice(0, 200)}`);
});

await test('The node\'s own callers are untouched: no Origin, the apex Origin, and the SAML form post', async () => {
    const none = await login({});
    assert(reachedRoute(none), `no Origin reaches the password route: ${none.status} ${JSON.stringify(none.body.error)}`);
    const apex = await login({ Origin: BASE });
    assert(reachedRoute(apex), `the apex Origin reaches the password route: ${apex.status} ${JSON.stringify(apex.body.error)}`);
    const acs = await json('/v1/ghii/login/saml/nope/acs', { method: 'POST', headers: { Origin: 'null' }, body: '{}' });
    assert(acs.body.error?.code !== 'APP_ORIGIN_SIGN_IN', `the SAML form post is not refused here: ${acs.status} ${JSON.stringify(acs.body)}`);
});

await test('With the setting off, the same request from an app is let through (logged only)', async () => {
    config.appOriginSignInRefuse = false;
    try {
        const r = await login({ Origin: `http://shop.${APP_HOST}` });
        assert(reachedRoute(r), `reaches the password route: ${r.status} ${JSON.stringify(r.body.error)}`);
    } finally { config.appOriginSignInRefuse = true; }
});

console.log('\nPhase 6 — An owner installs a package themselves');

const installPkg = (token: string, group: string, body: Record<string, unknown> = {}) =>
    json(`/v1/packages/${encodeURIComponent(group)}/install`, { method: 'POST', headers: auth(token), body: JSON.stringify(body) });
const appOf = (out: { body: any }) => (out.body.data.installedComponents as any[]).find(c => c.type === 'app').registeredAs as string;

/** An agent of `owner` with exactly `scopes`, and its token. */
async function agentToken(ownerToken: string, owner: string, name: string, scopes: string[]): Promise<string> {
    const reg = await json('/v1/agents', { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ name, owner, capabilities: ['memory'], mode: 'interactive', scopes }) });
    assert(reg.status === 201, `agent ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const stamp = new Date().toISOString();
    const signature = await sign(reg.body.data.private_key, gaii + stamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: stamp, signature }) });
    assert(tok.body.ok === true, `agent token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}

await test('The dry run of someone else\'s package names what each app asks for, and that the apps will ask', async () => {
    const cara = await setupOwner(`cara${ts}`);
    const r = await installPkg(cara, shopGroup, { dry_run: true });
    assert(r.status === 200, `dry run: ${r.status} ${JSON.stringify(r.body)}`);
    assert(r.body.data.app_approval?.own_package === false && r.body.data.app_approval?.grant_apps_default === false, `app_approval: ${JSON.stringify(r.body.data.app_approval)}`);
    const app = r.body.data.capabilities.apps[0];
    assert(app && SCOPES.split(' ').every(s => app.scopes.includes(s)), `the app's scopes: ${JSON.stringify(app)}`);
});

await test('Someone else\'s package installed with no choice records no grant: each app asks on its first visit', async () => {
    const owner = `dora${ts}`;
    const token = await setupOwner(owner);
    const r = await installPkg(token, shopGroup);
    assert(r.status === 201 && !r.body.data.app_grants, `install: ${r.status} ${JSON.stringify(r.body.data?.app_grants)}`);
    assert(!(await storage.getAppGrantByOwnerAndApp(owner, `${owner}/${appOf(r)}`)), 'no grant row');
});

await test('Someone else\'s package installed with grant_apps:true approves its app for the declared scopes', async () => {
    const owner = `emil${ts}`;
    const token = await setupOwner(owner);
    const r = await installPkg(token, shopGroup, { grant_apps: true });
    const target = `${owner}/${appOf(r)}`;
    assert(r.status === 201 && r.body.data.app_grants?.[target]?.result === 'granted', `install: ${r.status} ${JSON.stringify(r.body.data?.app_grants)}`);
    const row = await storage.getAppGrantByOwnerAndApp(owner, target);
    assert(!!row && SCOPES.split(' ').every(s => row.scopes.includes(s)), `grant row: ${JSON.stringify(row?.scopes)}`);
});

await test('The owner\'s own package approves its app with no choice given', async () => {
    const owner = `finn${ts}`;
    const token = await setupOwner(owner);
    const pub = await json('/v1/packages', { method: 'POST', headers: auth(token),
        body: JSON.stringify({ name: `mine${ts}`, description: 'My app', category: 'utility', visibility: 'private',
            components: [{ id: 'app-mine', type: 'app', label: 'Mine', content: APP_HTML, dependencies: [] }] }) });
    assert(pub.status === 201, `publish: ${pub.status} ${JSON.stringify(pub.body)}`);
    const dry = await installPkg(token, pub.body.data.packageGroupId, { dry_run: true });
    assert(dry.body.data.app_approval?.own_package === true && dry.body.data.app_approval?.grant_apps_default === true, `own dry run: ${JSON.stringify(dry.body.data.app_approval)}`);
    const r = await installPkg(token, pub.body.data.packageGroupId);
    const target = `${owner}/${appOf(r)}`;
    assert(r.status === 201 && r.body.data.app_grants?.[target]?.result === 'granted', `install: ${r.status} ${JSON.stringify(r.body.data?.app_grants)}`);
});

await test('An agent approves no app a scope it does not hold: the app is left to ask', async () => {
    const owner = `gail${ts}`;
    const token = await setupOwner(owner);
    const agent = await agentToken(token, owner, 'installer', ['packages:write', 'packages:install-code', 'memory:read']);
    const r = await installPkg(agent, shopGroup, { grant_apps: true });
    assert(r.status === 201, `install: ${r.status} ${JSON.stringify(r.body)}`);
    const target = `${owner}/${appOf(r)}`;
    const step = r.body.data.app_grants?.[target];
    assert(step?.result === 'skipped' && /storage:read/.test(step.detail ?? ''), `skipped, naming storage:read: ${JSON.stringify(step)}`);
    assert(!(await storage.getAppGrantByOwnerAndApp(owner, target)), 'no grant row');
});

await test('The package sheet names what each app asks for, which the Packages page shows beside the choice', async () => {
    const r = await json(`/v1/packages/${encodeURIComponent(shopGroup)}`, { headers: auth(opsToken) });
    const access = r.body.data?.sheet?.appAccess ?? [];
    assert(r.status === 200 && access.length === 1, `appAccess: ${r.status} ${JSON.stringify(r.body.data?.sheet)}`);
    assert(access[0].declared === true && SCOPES.split(' ').every((s: string) => access[0].scopes.includes(s)), `the declared scopes: ${JSON.stringify(access[0])}`);
});

await test('grant_apps that is not true or false is refused', async () => {
    const r = await installPkg(opsToken, shopGroup, { grant_apps: 'yes' });
    assert(r.status === 400 && /grant_apps/.test(r.body.error?.message ?? ''), `expected 400: ${r.status} ${JSON.stringify(r.body)}`);
});

server.close();
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
