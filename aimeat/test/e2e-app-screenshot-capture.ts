/**
 * @file e2e-app-screenshot-capture.ts
 * @description E2E tests for POST /v1/apps/:owner/:filename/screenshot/capture — the route that
 *   renders a published app so its author can see what it shipped.
 *
 *   CI has no browser, and that is the point of most of what follows: every gate in front of the
 *   render has to answer correctly whether or not one is installed. A node without a browser must
 *   say NO_BROWSER rather than 500, a second owner must be refused before anything is rendered, and
 *   an app that was never published must be a plain 404 rather than a render attempt that fails
 *   opaquely. The render itself is verified by hand on a machine that has a browser, and that
 *   limitation is stated rather than papered over.
 *
 *   NOT covered: the per-owner hourly throttle. Reaching it means twenty real renders, which is not
 *   worth the wall-clock here, and lowering the limit would mean editing the shared test env. It is
 *   exercised by hand instead. Saying so is the point — an untested guard that nobody admits is
 *   untested reads as a tested one.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=e2e-app-screenshot-capture
 * @version-history
 *   v1.0.0 — 2026-08-16 — initial: auth, ownership, not-published, and the browserless answer.
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ownerAName = `shota${Date.now() % 100000}`;
const ownerBName = `shotb${Date.now() % 100000}`;
const APP = 'shot-target.html';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err: any) {
        failed++;
        console.error(`  ❌ ${name}: ${err.message}`);
    }
}

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

const b64 = (html: string) => Buffer.from(html, 'utf8').toString('base64');

let aToken = '';
let bToken = '';
const aAuthed = (o: RequestInit = {}): RequestInit =>
    ({ ...o, headers: { ...((o.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${aToken}` } });
const bAuthed = (o: RequestInit = {}): RequestInit =>
    ({ ...o, headers: { ...((o.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${bToken}` } });

async function registerOwner(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name} status ${reg.status}: ${JSON.stringify(reg.body)}`);
    const priv = reg.body.data.private_key;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(priv, name + NODE_ID + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp, signature }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data?.token as string;
}

const capture = (owner: string, file: string, authed: (o?: RequestInit) => RequestInit) =>
    json(`/v1/apps/${owner}/${file}/screenshot/capture`, authed({ method: 'POST', body: '{}' }));

console.log('\n=== App Screenshot Capture E2E Tests ===\n');

await test('Setup: two owners, one published app', async () => {
    aToken = await registerOwner(ownerAName);
    bToken = await registerOwner(ownerBName);
    const pub = await json('/v1/apps', aAuthed({
        method: 'POST',
        body: JSON.stringify({
            filename: APP,
            content: b64('<!DOCTYPE html><html><body><h1>Shot me</h1></body></html>'),
            name: 'Shot Target', description: 'A page to photograph.', category: 'utility',
        }),
    }));
    assert(pub.status === 201, `publish status ${pub.status}: ${JSON.stringify(pub.body)}`);
});

await test('An unauthenticated capture is refused', async () => {
    const { status } = await json(`/v1/apps/${ownerAName}/${APP}/screenshot/capture`, { method: 'POST', body: '{}' });
    assert(status === 401, `unauthenticated capture is 401, got ${status}`);
});

await test('A second owner cannot capture the first owner\'s app', async () => {
    const { status, body } = await capture(ownerAName, APP, bAuthed);
    assert(status === 403, `cross-owner capture is 403, got ${status}: ${JSON.stringify(body.error)}`);
    assert(body.error?.code === 'FORBIDDEN', `code FORBIDDEN, got ${body.error?.code}`);
});

await test('An app that was never published is a plain 404, not a failed render', async () => {
    const { status, body } = await capture(ownerAName, 'never-published.html', aAuthed);
    assert(status === 404, `unknown app is 404, got ${status}`);
    assert(body.error?.code === 'NOT_FOUND', `code NOT_FOUND, got ${body.error?.code}`);
});

await test('The owner\'s own capture answers, and says why when it cannot render', async () => {
    const { status, body } = await capture(ownerAName, APP, aAuthed);
    // CI has no browser. Both outcomes are correct; what must never happen is a 500 or a silent 0.
    // The branch is printed because a green run on a browserless machine is NOT evidence that
    // rendering works, and a suite that hides which half it exercised invites exactly that reading.
    console.log(`     ↳ ${status === 200 ? 'rendered on this machine' : `no render here (${body.error?.code})`}`);
    if (status === 200) {
        assert(body.data?.captured === true, 'captured=true');
        assert(typeof body.data?.size === 'number' && body.data.size > 0, `a real image came back (${body.data?.size} bytes)`);
        assert(String(body.data?.screenshot_url).endsWith('/screenshot'), 'the answer carries the screenshot URL');
    } else {
        assert(status === 503 || status === 502, `a browserless node answers 503/502, got ${status}: ${JSON.stringify(body.error)}`);
        assert(['NO_BROWSER', 'RENDER_FAILED'].includes(body.error?.code), `named refusal, got ${body.error?.code}`);
        assert(String(body.error?.message).length > 20, 'the refusal explains itself');
    }
});

await test('The screenshot GET stays public and unauthenticated', async () => {
    // This is what makes the URL usable as a model input, so it is worth pinning.
    const res = await fetch(`${BASE}/v1/apps/${ownerAName}/${APP}/screenshot`);
    assert(res.status === 200 || res.status === 404, `public GET answers without auth, got ${res.status}`);
});

await test('Cleanup: delete the app', async () => {
    // The delete route is owner-implicit (DELETE /v1/apps/:filename): the owner comes from the token,
    // never the path, which is why there is no owner segment here.
    const del = await json(`/v1/apps/${APP}`, aAuthed({ method: 'DELETE' }));
    assert(del.status === 200 || del.status === 204, `delete status ${del.status}: ${JSON.stringify(del.body?.error)}`);
});

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
