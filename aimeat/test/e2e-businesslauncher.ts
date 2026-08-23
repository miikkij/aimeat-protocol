/**
 * @file e2e-businesslauncher.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The BUSINESSLAUNCHER package, installed the way a person installs it: four
 *   components in one transaction, the apps' references rewritten to this instance's names, and the
 *   crew-defs the back office ships still on the record afterwards.
 *
 *   The claim about consent is checked here rather than asserted in prose: the dry run creates
 *   nothing, and the install is ONE call. If a second approval ever creeps into this path, the
 *   count in the first case moves and this suite says so.
 * @structure seed → dry run creates nothing → install → components + rewrites → crews → shop opens
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=businesslauncher
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial (TARGET-070).
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: unknown) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as Record<string, never> : { _raw: await res.text() } as never;
    return { status: res.status, body: body as Record<string, never> };
}
const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

console.log('\n=== BUSINESSLAUNCHER package E2E ===\n');

const owner = `blaunch${Date.now()}`;
let ownerToken = '';
let groupId = '';
let installed: Array<{ componentId: string; type: string; registeredAs: string }> = [];
let instanceId = '';

// ─── Setup ──────────────────────────────────────────────────────────
console.log('Setup');

await test('Register the owner (first = operator)', async () => {
    const { status, body } = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: owner, display_name: 'Shop owner', password: 'Pw-shop-12345' }),
    });
    assert(status === 201 || status === 200, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
});

await test('Sign in', async () => {
    const { status, body } = await json('/v1/ghii/login', {
        method: 'POST',
        body: JSON.stringify({ username: owner, password: 'Pw-shop-12345' }),
    });
    assert(status === 200, `Expected 200, got ${status}`);
    ownerToken = (body.data as unknown as { token: string }).token;
    assert(!!ownerToken, 'no owner token');
});

// The example packages are seeded when the node boots, so there is nothing to do here but check
// that the shop is among them — which is also the assertion that it registered at all.
await test('The shop package is in the catalogue', async () => {
    const { status, body } = await json('/v1/packages?status=published', { headers: authed(ownerToken) });
    assert(status === 200, `Expected 200, got ${status}`);
    const pkgs = (body.data as unknown as { packages: Array<{ name: string; packageGroupId: string }> }).packages ?? [];
    const found = pkgs.find(p => p.name === 'businesslauncher');
    assert(!!found, `businesslauncher not among: ${pkgs.map(p => p.name).join(', ')}`);
    groupId = found!.packageGroupId;
});

// ─── The one approval ───────────────────────────────────────────────
console.log('\nInstalling');

await test('A dry run shows the whole plan and creates nothing', async () => {
    const before = await json('/v1/apps', { headers: authed(ownerToken) });
    const appsBefore = ((before.body.data as unknown as { apps: unknown[] }).apps ?? []).length;

    const { status, body } = await json(`/v1/packages/${encodeURIComponent(groupId)}/install`, {
        method: 'POST',
        headers: authed(ownerToken),
        body: JSON.stringify({ dry_run: true }),
    });
    assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
    const plan = body.data as unknown as { dry_run: boolean; componentCount: number; installOrder: string[] };
    assert(plan.dry_run === true, 'not marked as a dry run');
    assert(plan.componentCount === 4, `Expected 4 components, got ${plan.componentCount}`);
    // The engine and the lib must come before the apps, or the apps keep the author's short names.
    assert(plan.installOrder.indexOf('ext-shop') < plan.installOrder.indexOf('app-shop'),
        `extension must install before the shop app: ${plan.installOrder.join(' → ')}`);
    assert(plan.installOrder.indexOf('cortex-shop') < plan.installOrder.indexOf('app-back-office'),
        `cortex must install before the back office: ${plan.installOrder.join(' → ')}`);

    const after = await json('/v1/apps', { headers: authed(ownerToken) });
    const appsAfter = ((after.body.data as unknown as { apps: unknown[] }).apps ?? []).length;
    assert(appsBefore === appsAfter, `the dry run created ${appsAfter - appsBefore} app(s)`);
});

await test('One call installs the whole corner', async () => {
    const { status, body } = await json(`/v1/packages/${encodeURIComponent(groupId)}/install`, {
        method: 'POST',
        headers: authed(ownerToken),
        body: JSON.stringify({ label: 'My shop' }),
    });
    assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
    installed = (body.data as unknown as { installedComponents: typeof installed }).installedComponents;
    instanceId = (body.data as unknown as { id: string }).id;
    assert(installed.length === 4, `Expected 4 installed components, got ${installed.length}`);
    const kinds = installed.map(c => c.type).sort();
    assert(JSON.stringify(kinds) === JSON.stringify(['app', 'app', 'cortex', 'extension']),
        `Unexpected component types: ${kinds.join(', ')}`);
});

// ─── What actually landed ───────────────────────────────────────────
console.log('\nWhat landed');

await test('The shop engine is live, with its three actions', async () => {
    const ext = installed.find(c => c.type === 'extension')!;
    const { status, body } = await json(`/v1/extensions/${encodeURIComponent(ext.registeredAs)}`, { headers: authed(ownerToken) });
    assert(status === 200, `Expected 200, got ${status}`);
    const rec = (body.data as unknown as { extension: { status: string; actions: Array<{ id: string }> } }).extension;
    assert(rec.status === 'active', `Expected an active extension, got ${rec.status}`);
    const ids = rec.actions.map(a => a.id).sort();
    assert(JSON.stringify(ids) === JSON.stringify(['admin', 'release', 'reserve']), `Unexpected actions: ${ids.join(', ')}`);
});

await test("The apps point at THIS instance's engine, not the author's short name", async () => {
    const ext = installed.find(c => c.type === 'extension')!;
    const shop = installed.find(c => c.componentId === 'app-shop')!;
    const res = await fetch(`${BASE}/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(shop.registeredAs)}`);
    const html = await res.text();
    assert(res.status === 200, `Expected 200 serving the shop app, got ${res.status}`);
    // The cortex lib carries the ext references; the app carries the cortex path.
    const cortex = installed.find(c => c.type === 'cortex')!;
    assert(html.includes(`/v1/cortex/${cortex.registeredAs}/`), 'the app still points at the author\'s cortex name');
    assert(!html.includes('/v1/cortex/businesslauncher-shop/'), 'the author\'s short cortex name survived the rewrite');
    assert(ext.registeredAs !== 'businesslauncher-shop', 'the extension kept its unscoped name');
});

await test('The back office brought its agents with it', async () => {
    const { status, body } = await json('/v1/apps', { headers: authed(ownerToken) });
    assert(status === 200, `Expected 200, got ${status}`);
    const back = installed.find(c => c.componentId === 'app-back-office')!;
    const apps = (body.data as unknown as { apps: Array<{ filename: string; manifest: { cortex?: { agents?: Array<{ agent_name: string }> } } }> }).apps;
    const row = apps.find(a => a.filename === back.registeredAs);
    assert(!!row, 'the back office is not in the catalogue listing');
    const agents = row!.manifest.cortex?.agents ?? [];
    const names = agents.map(a => a.agent_name).sort();
    assert(JSON.stringify(names) === JSON.stringify(['pricer', 'scout', 'shopkeeper']),
        `Expected the three shipped crews, got: ${names.join(', ') || '(none)'}`);
});

await test('A stranger can open the shop front without an account', async () => {
    const shop = installed.find(c => c.componentId === 'app-shop')!;
    const res = await fetch(`${BASE}/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(shop.registeredAs)}`);
    assert(res.status === 200, `Expected 200 with no auth, got ${res.status}`);
    const html = await res.text();
    assert(html.includes('aimeat-scopes'), 'the shop app declares no scopes');
});

// ─── The fence ──────────────────────────────────────────────────────
// One principal proves the feature and cannot prove the boundary: delete a check and the cases
// above stay green. These are the refusals.
console.log('\nThe fence');

const stranger = `blaunchx${Date.now()}`;
let strangerToken = '';

await test('A second person registers and signs in', async () => {
    await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: stranger, display_name: 'Someone else', password: 'Pw-other-12345' }),
    });
    const { status, body } = await json('/v1/ghii/login', {
        method: 'POST',
        body: JSON.stringify({ username: stranger, password: 'Pw-other-12345' }),
    });
    assert(status === 200, `Expected 200, got ${status}`);
    strangerToken = (body.data as unknown as { token: string }).token;
    assert(!!strangerToken, 'no token for the second person');
});

await test('They cannot uninstall somebody else\'s shop', async () => {
    const { status } = await json(`/v1/instances/${encodeURIComponent(instanceId)}`, {
        method: 'DELETE',
        headers: authed(strangerToken),
    });
    assert(status === 403 || status === 404, `Expected 403 or 404, got ${status}`);
});

// The shop belongs to whoever installed it from the first second, because the node resolves that
// from the extension's own record. There is no claim step to win, which is the point: a claim would
// leave a window between the install and the owner opening the back office.
await test('They cannot rename somebody else\'s shop', async () => {
    const ext = installed.find(c => c.type === 'extension')!;
    const { body } = await json(`/v1/ext/${encodeURIComponent(ext.registeredAs)}/admin`, {
        method: 'POST',
        headers: authed(strangerToken),
        body: JSON.stringify({ op: 'configure', name: 'Mine now' }),
    });
    const out = (body.data as unknown as { result?: { ok: boolean; error?: string } })?.result
        ?? (body.data as unknown as { ok: boolean; error?: string });
    assert(out && out.ok === false, `Expected a refusal, got ${JSON.stringify(out)}`);
    assert(String(out.error || '').includes('owner'), `Expected the reason to name ownership, got: ${out.error}`);
});

await test('They cannot put anything on somebody else\'s shelf', async () => {
    const ext = installed.find(c => c.type === 'extension')!;
    const { body } = await json(`/v1/ext/${encodeURIComponent(ext.registeredAs)}/admin`, {
        method: 'POST',
        headers: authed(strangerToken),
        body: JSON.stringify({ op: 'set_stock', units: { mug: 999 } }),
    });
    const out = (body.data as unknown as { result?: { ok: boolean; error?: string } })?.result
        ?? (body.data as unknown as { ok: boolean; error?: string });
    assert(out && out.ok === false, `Expected a refusal, got ${JSON.stringify(out)}`);
    assert(String(out.error || '').includes('owner'), `Expected the reason to name ownership, got: ${out.error}`);
});

await test('Installing needs an account at all', async () => {
    const { status } = await json(`/v1/packages/${encodeURIComponent(groupId)}/install`, {
        method: 'POST',
        body: JSON.stringify({ label: 'no thanks' }),
    });
    assert(status === 401, `Expected 401 with no token, got ${status}`);
});

// ─── Cleanup ────────────────────────────────────────────────────────
console.log('\nCleanup');
await json(`/v1/owners/${stranger}?cascade=true`, { method: 'DELETE', headers: authed(strangerToken) });
await json(`/v1/owners/${owner}?cascade=true`, { method: 'DELETE', headers: authed(ownerToken) });

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
