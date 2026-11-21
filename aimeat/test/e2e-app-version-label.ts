/**
 * @file test/e2e-app-version-label.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where an app's display version comes from when the publish names none.
 *
 *   WHY. A publish that named no `version` carried the previous label forward, so a page whose own
 *   head said 1.2.0 went live labelled 1.1.0 and the builder found out from the catalogue (appdev
 *   pitfalls publish/upload-publish-keeps-old-version-label, publish/draft-publish-keeps-old-version).
 *   Now `<meta name="aimeat-app-version">` in the page is read when the call names none, a version
 *   the call names still wins, and a publish that names none, reads none and stores changed bytes
 *   says so in `app_hints` (services/app/version-label.ts, curated pitfall display-version-carried).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=app-version-label
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (pitfall round A6).
 */
import { registerOwner } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`✅ ${name}`); }
    catch (e) { failed++; console.log(`❌ ${name}: ${(e as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) } });
    const text = await res.text();
    try { return { status: res.status, body: JSON.parse(text) }; } catch { return { status: res.status, body: text }; }
}
const b64 = (html: string) => Buffer.from(html, 'utf8').toString('base64');
const page = (body: string, head = '') => `<!DOCTYPE html><html><head><title>Label</title>${head}</head><body>${body}</body></html>`;
const meta = (v: string) => `<meta name="aimeat-app-version" content="${v}">`;

let owner: { name: string; token: string };
const APP = `label-${Date.now().toString(36)}.html`;

async function publish(content: string, extra: Record<string, unknown> = {}) {
    return json('/v1/apps', {
        method: 'POST', headers: { Authorization: `Bearer ${owner.token}` },
        body: JSON.stringify({ filename: APP, content: b64(content), description: 'Display version label probe.', ...extra }),
    });
}
const carriedHint = (body: any) => ((body.data?.app_hints ?? []) as any[]).find(h => h.pitfall === 'display-version-carried');

await test('0. an owner', async () => {
    owner = await registerOwner(BASE, `alice${Date.now().toString(36)}`);
    assert(typeof owner.token === 'string', 'no token');
});

await test('1. A first publish that names a version keeps it and says nothing about the label', async () => {
    const r = await publish(page('<p>one</p>'), { version: '1.1.0' });
    assert(r.status === 201, `publish ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(r.body.data.manifest.version === '1.1.0', `version ${r.body.data.manifest.version}`);
    assert(!carriedHint(r.body), 'no label warning on a stated version');
});

await test('2. A publish that names none takes the version the page\'s head names', async () => {
    const r = await publish(page('<p>two</p>', meta('1.2.0')));
    assert(r.status === 201, `publish ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(r.body.data.manifest.version === '1.2.0', `the page's 1.2.0 should be the label, got ${r.body.data.manifest.version}`);
    assert(!carriedHint(r.body), 'no label warning when the page names the version');
});

await test('3. A version the call names wins over the page\'s', async () => {
    const r = await publish(page('<p>three</p>', meta('1.2.0')), { version: '1.3.0' });
    assert(r.status === 201 && r.body.data.manifest.version === '1.3.0', `stated version: ${r.body.data?.manifest?.version}`);
});

await test('4. Changed bytes under a carried label are said in app_hints, with how to set the version', async () => {
    const r = await publish(page('<p>four, and different</p>'));
    assert(r.status === 201, `publish ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(r.body.data.manifest.version === '1.3.0', `the label is carried as before: ${r.body.data.manifest.version}`);
    const hint = carriedHint(r.body);
    assert(hint && hint.severity === 'warn', `a carried-label warning is expected: ${JSON.stringify(r.body.data.app_hints)}`);
    assert(String(hint.message).includes('1.3.0') && String(hint.message).includes('aimeat-app-version'), `the message names the label and the meta: ${hint.message}`);
    assert(hint.url === '/v1/appdev/pitfalls/display-version-carried', `url ${hint.url}`);
});

await test('5. The same bytes again carry the label without a warning', async () => {
    const r = await publish(page('<p>four, and different</p>'));
    assert(r.status === 201 && !carriedHint(r.body), `identical bytes should not warn: ${JSON.stringify(r.body.data?.app_hints)}`);
});

await test('6. A page meta that is not a version is not used, and the warning says why', async () => {
    const r = await publish(page('<p>six</p>', meta('version one point four!')));
    assert(r.status === 201, `publish ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(r.body.data.manifest.version === '1.3.0', `an unusable meta must not become the label: ${r.body.data.manifest.version}`);
    const hint = carriedHint(r.body);
    assert(hint && String(hint.message).includes('not a display version'), `the warning names the bad meta: ${JSON.stringify(r.body.data.app_hints)}`);
    await json(`/v1/apps/${owner.name}/${APP}`, { method: 'DELETE', headers: { Authorization: `Bearer ${owner.token}` } });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
