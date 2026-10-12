/**
 * @file e2e-package-withdraw.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Withdrawing a bad version (T6 of https://aimeat-pages.apps.aimeat.io/#org=fbb51de5-56d5-4143-9871-b998a1187655&ws=ws-mq664uyfz21&doc=doc-mv44ppuzmw8e; phase 5). An author
 *   publishes a package with an extension and an app; another owner installs it; the author withdraws
 *   the version with a reason. The installed copy's extension is switched off, its owner is told once,
 *   and nothing serves the version again. The customer-node path (a copy on another node, acted on by
 *   its daily check) is in e2e-package-sale.ts.
 * @structure
 *   - Setup: the author, the installer, a package with an extension and an app, installed
 *   - Phase 1: refusals: a short reason, someone else's package
 *   - Phase 2: the withdrawal: the extension off, the owner told once, the version served no more
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=package-withdraw
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial (package sale design, phase 5).
 */
import { registerOwner } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
const authed = (token: string) => ({ Authorization: `Bearer ${token}` });
async function newOwner(name: string): Promise<string> {
    return (await registerOwner(BASE, name)).token;
}

const stamp = Date.now() % 1000000;
const author = `wdauthor${stamp}`;
const holder = `wdholder${stamp}`;
let authorToken = '';
let holderToken = '';
let groupId = '';
let version = '';
let extName = '';
const EXT = `wdext${stamp}`;
const manifest = ['metadata:', `  name: ${EXT}`, '  version: 1.0.0', '  description: Answers ping', '  author: e2e',
    'actions:', '  - id: ping', '    method: POST', '    path: /ping', '    script: ping'].join('\n');

console.log('\n═══ Package withdraw E2E ═══');
console.log('\nSetup');

await test('The author publishes a public package with an extension and an app, and another owner installs it', async () => {
    authorToken = await newOwner(author);
    holderToken = await newOwner(holder);
    const pub = await json('/v1/packages', {
        method: 'POST', headers: authed(authorToken),
        body: JSON.stringify({ name: `wdpack${stamp}`, description: 'A withdraw fixture', category: 'utility', visibility: 'public', status: 'published', components: [
            { id: EXT, type: 'extension', label: EXT, dependencies: [], content: JSON.stringify({ manifest, scripts: { ping: 'export default async function(){ return { ok: true }; }' } }) },
            { id: 'wd-app.html', type: 'app', label: 'App', dependencies: [], content: '<!DOCTYPE html><html><head><title>wd</title></head><body>wd</body></html>' },
        ] }),
    });
    assert(pub.status === 201, `publish: ${pub.status} ${JSON.stringify(pub.body)}`);
    groupId = pub.body.data.packageGroupId;
    version = pub.body.data.version;
    const inst = await json(`/v1/packages/${encodeURIComponent(groupId)}/install`, { method: 'POST', headers: authed(holderToken), body: JSON.stringify({ label: 'Mine' }) });
    assert(inst.status === 201, `install: ${inst.status} ${JSON.stringify(inst.body)}`);
    extName = (inst.body.data.installedComponents as any[]).find(c => c.type === 'extension').registeredAs;
    const ext = await json(`/v1/extensions/${encodeURIComponent(extName)}`);
    assert(ext.body.data.extension.status === 'active', `active after install: ${JSON.stringify(ext.body.data.extension?.status)}`);
});

const withdraw = (token: string, reason: string) => json(`/v1/packages/${encodeURIComponent(groupId)}/versions/${encodeURIComponent(version)}/withdraw`, {
    method: 'POST', headers: authed(token), body: JSON.stringify({ reason }),
});

console.log('\nPhase 1 — Refusals');

await test('A reason too short to tell an owner anything is refused', async () => {
    const r = await withdraw(authorToken, 'bad');
    assert(r.status === 400 && r.body.error?.code === 'INVALID_INPUT', `expected 400: ${r.status} ${JSON.stringify(r.body)}`);
});

await test('Another owner cannot withdraw the author\'s version', async () => {
    const r = await withdraw(holderToken, 'I do not like this version at all.');
    assert(r.status === 403, `expected 403, got ${r.status} ${JSON.stringify(r.body)}`);
});

console.log('\nPhase 2 — The withdrawal');

const REASON = 'The ping action sends the secret key in plain text. Version 2 fixes it.';
await test('The author withdraws the version: the copy\'s extension is off and its owner is told once, with the reason', async () => {
    const r = await withdraw(authorToken, REASON);
    assert(r.status === 200 && r.body.data.withdrawal.version === version && r.body.data.copies_here === 1, `withdraw: ${r.status} ${JSON.stringify(r.body)}`);
    const ext = await json(`/v1/extensions/${encodeURIComponent(extName)}`);
    assert(ext.body.data.extension.status === 'inactive', `switched off: ${JSON.stringify(ext.body.data.extension?.status)}`);
    const notes = await json('/v1/notifications?limit=100', { headers: authed(holderToken) });
    const told = (notes.body.data.notifications as any[]).filter(n => n.type === 'package_version_withdrawn');
    assert(told.length === 1 && String(told[0].body).includes(REASON), `told once: ${JSON.stringify(told)}`);
});

await test('Nothing serves the version again, and withdrawing it twice is refused', async () => {
    const again = await json(`/v1/packages/${encodeURIComponent(groupId)}/install`, { method: 'POST', headers: authed(holderToken), body: JSON.stringify({ label: 'Again' }) });
    assert(again.status === 404, `install refused: ${again.status} ${JSON.stringify(again.body)}`);
    const twice = await withdraw(authorToken, REASON);
    assert(twice.status === 409 && twice.body.error?.code === 'ALREADY_WITHDRAWN', `twice: ${twice.status} ${JSON.stringify(twice.body)}`);
});

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
