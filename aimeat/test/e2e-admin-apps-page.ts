/**
 * @file test/e2e-admin-apps-page.ts
 * @description E2E for the reads and writes behind the admin Applications page: the moderation
 *   listing every operator decision is made from, taking an app off the wall and putting it back,
 *   the narrow search-engine block beside the wide take-down, and the refusals.
 *
 *   THE ASSERTION THAT MATTERS is that the listing carries what the page counts and shows. Four
 *   states look alike on a list and mean different things — the operator took it down, the owner
 *   parked it, it is behind a code, search engines are not told about it — and the page can only
 *   separate them if every row says which. The picture is the newest of those: an operator was
 *   choosing whether to take an app off the wall without a way to look at it.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=admin-apps-page
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial, with the page in the poster face.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

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
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

async function owner(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status}`);
    const priv = reg.body.data.private_key;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(priv, name + NODE_ID + ts) }),
    });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}

/** Publish one small app in the maker's name, the way the publish route takes it. */
async function publish(token: string, filename: string, name: string, body: string) {
    const res = await json('/v1/apps', {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({
            filename,
            content: Buffer.from(`<!doctype html><title>${name}</title><body>${body}</body>`, 'utf8').toString('base64'),
            // A new app is refused without a description, and the catalogue reads this one.
            description: `${name}, published by the apps-page suite so an operator has something to moderate.`,
            manifest: { name },
        }),
    });
    assert(res.status === 200 || res.status === 201, `publish ${filename}: ${res.status}: ${JSON.stringify(res.body.error)}`);
    return res.body.data;
}

console.log('\n🧪 Admin Applications page — the listing every moderation decision is made from\n');

const operatorName = `apop${Date.now()}`;
const makerName = `apmaker${Date.now()}`;
let operatorToken = '';
let makerToken = '';
const APP = 'suite-app.html';

await test('Register the operator and someone who publishes an app', async () => {
    operatorToken = await owner(operatorName);
    makerToken = await owner(makerName);
    const roles = (tok: string) => JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()).roles as string[];
    assert(roles(operatorToken).includes('operator'), 'the first owner is the operator');
    assert(!roles(makerToken).includes('operator'), 'the second is not');
    await publish(makerToken, APP, 'Suite App', 'Hello from the suite.');
});

// ── What the page's first section counts, and its table prints ───────────────

await test('Every row carries what the page separates the four states by', async () => {
    const { status, body } = await json('/v1/admin/apps', { headers: auth(operatorToken) });
    assert(status === 200, `status ${status}`);
    const app = (body.data.apps as any[]).find(a => a.filename === APP);
    assert(!!app, 'the app just published is listed');
    for (const field of ['operator_hidden', 'parked', 'protected', 'operator_seo_blocked']) {
        assert(typeof app[field] === 'boolean', `${field} is missing, so the page cannot tell that state from the others`);
    }
    assert(typeof app.downloads === 'number' && typeof app.forks === 'number',
        'the table prints how often it was opened and how many forks it has');
    assert(typeof app.size === 'number' && typeof app.created_at === 'string',
        'the size and the publish date are what the strip and the last column read');
    assert(typeof app.download_url === 'string' && app.download_url.includes(APP),
        'without the address the page cannot offer to open the app it is moderating');
    assert('screenshot_url' in app,
        'screenshot_url must be present (null when there is none), or the copy scan cannot show the two apps');
});

await test('A fresh app is on the wall: nothing hidden, parked, coded or blocked', async () => {
    const { body } = await json('/v1/admin/apps', { headers: auth(operatorToken) });
    const app = (body.data.apps as any[]).find(a => a.filename === APP);
    assert(app.operator_hidden === false && app.parked === false, 'up on the wall');
    assert(app.protected === false && app.operator_seo_blocked === false, 'no code, not blocked');
});

// ── Taking it off the wall, and putting it back ─────────────────────────────

await test('Taking it down records the reason, who did it, and when', async () => {
    const res = await json(`/v1/admin/apps/${encodeURIComponent(makerName)}/${encodeURIComponent(APP)}/moderate`, {
        method: 'POST',
        headers: auth(operatorToken),
        body: JSON.stringify({ hidden: true, reason: 'Copies another app without a fork link' }),
    });
    assert(res.status === 200, `status ${res.status}: ${JSON.stringify(res.body.error)}`);
    const { body } = await json('/v1/admin/apps', { headers: auth(operatorToken) });
    const app = (body.data.apps as any[]).find(a => a.filename === APP);
    assert(app.operator_hidden === true, 'the row is marked');
    assert(app.operator_hide_reason === 'Copies another app without a fork link',
        'the reason the owner reads, and the one the page prints under the name');
    assert(app.operator_hidden_by === operatorName && typeof app.operator_hidden_at === 'string',
        'who and when, which is the whole of the moderation log at the foot of the page');
});

await test('A taken-down app is gone from the public catalogue', async () => {
    const { body } = await json('/v1/apps');
    const found = (body.data?.apps ?? []).some((a: any) => a.filename === APP);
    assert(!found, 'the public listing does not carry it');
});

await test('Putting it back clears the mark and the reason', async () => {
    const res = await json(`/v1/admin/apps/${encodeURIComponent(makerName)}/${encodeURIComponent(APP)}/moderate`, {
        method: 'POST', headers: auth(operatorToken), body: JSON.stringify({ hidden: false }),
    });
    assert(res.status === 200, `status ${res.status}`);
    const { body } = await json('/v1/admin/apps', { headers: auth(operatorToken) });
    const app = (body.data.apps as any[]).find(a => a.filename === APP);
    assert(app.operator_hidden === false, 'back on the wall');
});

// ── The narrow one: still published, just not findable ──────────────────────

await test('The search-engine block leaves the app published and usable', async () => {
    const res = await json(`/v1/admin/apps/${encodeURIComponent(makerName)}/${encodeURIComponent(APP)}/seo-block`, {
        method: 'POST', headers: auth(operatorToken), body: JSON.stringify({ blocked: true, reason: 'e2e' }),
    });
    assert(res.status === 200, `status ${res.status}: ${JSON.stringify(res.body.error)}`);
    const { body } = await json('/v1/admin/apps', { headers: auth(operatorToken) });
    const app = (body.data.apps as any[]).find(a => a.filename === APP);
    assert(app.operator_seo_blocked === true, 'blocked');
    assert(app.operator_hidden === false && app.parked === false,
        'and still on the wall, which is the difference the page has to state');
    const pub = await json('/v1/apps');
    assert((pub.body.data?.apps ?? []).some((a: any) => a.filename === APP), 'still in the public catalogue');
});

await test('The same door lifts it again', async () => {
    const res = await json(`/v1/admin/apps/${encodeURIComponent(makerName)}/${encodeURIComponent(APP)}/seo-block`, {
        method: 'POST', headers: auth(operatorToken), body: JSON.stringify({ blocked: false }),
    });
    assert(res.status === 200, `status ${res.status}`);
    const { body } = await json('/v1/admin/apps', { headers: auth(operatorToken) });
    assert((body.data.apps as any[]).find(a => a.filename === APP).operator_seo_blocked === false, 'lifted');
});

// ── The scan behind section 03 ──────────────────────────────────────────────

await test('The copy scan answers with the two kinds separated', async () => {
    const { status, body } = await json('/v1/admin/apps/similar', { headers: auth(operatorToken) });
    assert(status === 200, `status ${status}`);
    assert(Array.isArray(body.data.watermarkHits), 'the evidence list');
    assert(Array.isArray(body.data.suspiciousPairs), 'the signal list');
    assert(typeof body.data.scanned === 'number', 'how many were read, which the page prints under them');
});

// ── The refusals ────────────────────────────────────────────────────────────

await test('The maker cannot see the moderation listing', async () => {
    const { status } = await json('/v1/admin/apps', { headers: auth(makerToken) });
    assert(status === 403, `expected 403, got ${status}`);
});

await test('The maker cannot take their own app down as an operator', async () => {
    const { status } = await json(`/v1/admin/apps/${encodeURIComponent(makerName)}/${encodeURIComponent(APP)}/moderate`, {
        method: 'POST', headers: auth(makerToken), body: JSON.stringify({ hidden: true }),
    });
    assert(status === 403, `expected 403, got ${status}`);
});

await test('Nobody at all may delete an app without a session', async () => {
    const { status } = await json(`/v1/admin/apps/${encodeURIComponent(makerName)}/${encodeURIComponent(APP)}`, { method: 'DELETE' });
    assert(status === 401, `expected 401, got ${status}`);
});

await test('The operator can delete it, and then it is gone from the listing', async () => {
    const res = await json(`/v1/admin/apps/${encodeURIComponent(makerName)}/${encodeURIComponent(APP)}`, {
        method: 'DELETE', headers: auth(operatorToken),
    });
    assert(res.status === 200, `status ${res.status}: ${JSON.stringify(res.body.error)}`);
    const { body } = await json('/v1/admin/apps', { headers: auth(operatorToken) });
    assert(!(body.data.apps as any[]).some(a => a.filename === APP), 'gone for good, which is why it sits behind the row menu');
});

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
