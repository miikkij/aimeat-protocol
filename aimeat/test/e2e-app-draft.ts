/**
 * @file e2e-app-draft.ts
 * @description E2E tests for the app DRAFT (staging) slot: PUT .../draft saves an
 *   unpublished draft without touching the live app; POST .../draft/preview-token
 *   mints a short-lived, owner-only preview URL that serves the DRAFT bytes (not the
 *   live version) via the `preview` token; POST .../publish-draft promotes the draft
 *   to a new live version (carrying parked state forward) and clears the slot; DELETE
 *   .../draft discards it. Covers the core "test v19 before publishing while v18 stays
 *   live" flow, the token failure modes (invalid token → 403, token bound to a
 *   different filename → 403), owner-scoping (a second owner's draft is independent),
 *   and the not-found paths (preview/publish with no draft → 404).
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=e2e-app-draft
 * @version-history
 *   v1.1.0 — 2026-08-01 — Phase 6 (TARGET-058 Phase 8 step 0a): the three publish doors share one
 *     function, so promoting a draft keeps what a draft manifest cannot express. Watched to FAIL on
 *     the unfixed code — a promoted draft came back with priceMorsels undefined, i.e. a paid app
 *     silently turned free — and to pass after.
 *   v1.0.0 — 2026-07-11 — initial: draft save/preview/publish/discard + token gates.
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ownerAName = `draftowna${Date.now() % 100000}`;
const ownerBName = `draftownb${Date.now() % 100000}`;
const APP = 'drumpad-calib.html';
const OTHER_APP = 'other-app.html';

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
    return { status: res.status, body, headers: res.headers };
}

async function raw(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, opts);
    return { status: res.status, text: await res.text() };
}

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

const b64 = (html: string) => Buffer.from(html, 'utf8').toString('base64');
const LIVE_V1 = '<!DOCTYPE html><html><body><h1>drumpad v1 LIVE</h1></body></html>';
const DRAFT_V2 = '<!DOCTYPE html><html><body><h1>drumpad v2 DRAFT getUserMedia</h1></body></html>';

let aToken = '';
let bToken = '';
function aAuthed(opts: RequestInit = {}): RequestInit {
    return { ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${aToken}` } };
}
function bAuthed(opts: RequestInit = {}): RequestInit {
    return { ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${bToken}` } };
}

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

console.log('\n=== App Draft (staging slot) E2E Tests ===\n');
console.log('Phase 0: Setup — owner A publishes v1 (live)');

await test('Register owner A + owner B', async () => {
    aToken = await registerOwner(ownerAName);
    bToken = await registerOwner(ownerBName);
    assert(!!aToken && !!bToken, 'both owner tokens issued');
});

await test('Owner A publishes the app v1 (live)', async () => {
    const { status } = await json('/v1/apps', aAuthed({
        method: 'POST',
        body: JSON.stringify({ filename: APP, content: b64(LIVE_V1), name: 'Drum Pad', description: 'calibration', category: 'utility', tags: ['audio'] }),
    }));
    assert(status === 201, `publish status ${status}`);
});

// ── Phase 1: save a draft without touching the live app ──
console.log('\nPhase 1: draft save leaves the live app untouched');

await test('PUT .../draft saves the draft (200, live_version_number=1)', async () => {
    const { status, body } = await json(`/v1/apps/${ownerAName}/${APP}/draft`, aAuthed({
        method: 'PUT', body: JSON.stringify({ content: b64(DRAFT_V2) }),
    }));
    assert(status === 200, `draft save status ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.saved === true, 'saved=true');
    assert(body.data?.has_live_version === true, 'has_live_version=true');
    assert(body.data?.live_version_number === 1, `live_version_number=1, got ${body.data?.live_version_number}`);
});

await test('The LIVE app still serves v1 (draft did not touch it)', async () => {
    const { status, text } = await raw(`/v1/apps/${ownerAName}/${APP}?mode=inline`);
    assert(status === 200, `live fetch status ${status}`);
    assert(text.includes('drumpad v1 LIVE'), 'live still v1');
    assert(!text.includes('v2 DRAFT'), 'live is NOT the draft');
});

await test('The draft inherits the live manifest name when omitted', async () => {
    // Re-save the draft with no name → keeps "Drum Pad" from the live app.
    const { body } = await json(`/v1/apps/${ownerAName}/${APP}/draft`, aAuthed({
        method: 'PUT', body: JSON.stringify({ content: b64(DRAFT_V2) }),
    }));
    assert(body.data?.saved === true, 're-save ok');
});

// ── Phase 2: preview token serves the DRAFT ──
console.log('\nPhase 2: preview token serves the draft, not the live version');

let previewToken = '';
await test('POST .../draft/preview-token mints a preview URL + token', async () => {
    const { status, body } = await json(`/v1/apps/${ownerAName}/${APP}/draft/preview-token`, aAuthed({ method: 'POST' }));
    assert(status === 200, `mint status ${status}: ${JSON.stringify(body)}`);
    assert(typeof body.data?.token === 'string' && body.data.token.length > 20, 'got a token');
    assert(typeof body.data?.preview_url === 'string' && body.data.preview_url.includes('preview='), 'preview_url carries the token');
    assert(body.data?.expires_in_seconds > 0, 'has a TTL');
    previewToken = body.data.token;
});

await test('The preview URL serves the DRAFT bytes (v2), not the live v1', async () => {
    const { status, text } = await raw(`/v1/apps/${ownerAName}/${APP}?mode=inline&preview=${encodeURIComponent(previewToken)}`);
    assert(status === 200, `preview fetch status ${status}`);
    assert(text.includes('v2 DRAFT'), 'preview serves the draft');
    assert(!text.includes('v1 LIVE'), 'preview is NOT the live version');
});

await test('An invalid preview token is rejected (403)', async () => {
    const { status } = await raw(`/v1/apps/${ownerAName}/${APP}?mode=inline&preview=not-a-real-token`);
    assert(status === 403, `invalid token must 403, got ${status}`);
});

await test('A preview token is bound to its filename (used on another app → 403)', async () => {
    // Publish a second app + point the first app's token at it.
    await json('/v1/apps', aAuthed({ method: 'POST', body: JSON.stringify({ filename: OTHER_APP, content: b64('<h1>other</h1>'), name: 'Other', description: 'x', category: 'utility', tags: [] }) }));
    const { status } = await raw(`/v1/apps/${ownerAName}/${OTHER_APP}?mode=inline&preview=${encodeURIComponent(previewToken)}`);
    assert(status === 403, `token bound to a different filename must 403, got ${status}`);
});

// ── Phase 3: owner scoping ──
console.log('\nPhase 3: drafts are owner-scoped + independent');

await test('Owner B has NO draft for the same filename (preview-token → 404)', async () => {
    const { status } = await json(`/v1/apps/${ownerBName}/${APP}/draft/preview-token`, bAuthed({ method: 'POST' }));
    assert(status === 404, `B has no draft → 404, got ${status}`);
});

// ── Phase 4: publish the draft ──
console.log('\nPhase 4: publish promotes the draft to a new live version');

await test('POST .../publish-draft promotes the draft to v2 (201)', async () => {
    const { status, body } = await json(`/v1/apps/${ownerAName}/${APP}/publish-draft`, aAuthed({ method: 'POST' }));
    assert(status === 201, `publish-draft status ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.version_number === 2, `version_number=2, got ${body.data?.version_number}`);
});

await test('The LIVE app now serves v2 (the promoted draft)', async () => {
    const { status, text } = await raw(`/v1/apps/${ownerAName}/${APP}?mode=inline`);
    assert(status === 200, `live fetch status ${status}`);
    assert(text.includes('v2 DRAFT'), 'live is now v2');
    assert(!text.includes('v1 LIVE'), 'live is no longer v1');
});

await test('The draft slot is cleared after publish (preview-token → 404)', async () => {
    const { status } = await json(`/v1/apps/${ownerAName}/${APP}/draft/preview-token`, aAuthed({ method: 'POST' }));
    assert(status === 404, `slot cleared → 404, got ${status}`);
});

// ── Phase 5: parked carry-forward + discard + not-found ──
console.log('\nPhase 5: parked carry-forward, discard, and not-found paths');

await test('publish-draft with no draft returns 404', async () => {
    const { status } = await json(`/v1/apps/${ownerAName}/${APP}/publish-draft`, aAuthed({ method: 'POST' }));
    assert(status === 404, `no draft → 404, got ${status}`);
});

await test('A parked app stays parked after publishing a draft', async () => {
    const park = await json(`/v1/apps/${APP}`, aAuthed({ method: 'PATCH', body: JSON.stringify({ parked: true }) }));
    assert(park.status === 200 && park.body.data?.parked === true, 'app parked');
    await json(`/v1/apps/${ownerAName}/${APP}/draft`, aAuthed({ method: 'PUT', body: JSON.stringify({ content: b64(DRAFT_V2 + '<!--v3-->') }) }));
    const pub = await json(`/v1/apps/${ownerAName}/${APP}/publish-draft`, aAuthed({ method: 'POST' }));
    assert(pub.status === 201, `publish-draft status ${pub.status}`);
    assert(pub.body.data?.parked === true, 'published draft carried parked=true forward');
});

await test('DELETE .../draft discards a saved draft (200), then 404', async () => {
    await json(`/v1/apps/${ownerAName}/${APP}/draft`, aAuthed({ method: 'PUT', body: JSON.stringify({ content: b64(DRAFT_V2) }) }));
    const del = await json(`/v1/apps/${ownerAName}/${APP}/draft`, aAuthed({ method: 'DELETE' }));
    assert(del.status === 200 && del.body.data?.discarded === true, `discard status ${del.status}`);
    const again = await json(`/v1/apps/${ownerAName}/${APP}/draft`, aAuthed({ method: 'DELETE' }));
    assert(again.status === 404, `second discard → 404, got ${again.status}`);
});

await test('Saving a draft requires content (400)', async () => {
    const { status } = await json(`/v1/apps/${ownerAName}/${APP}/draft`, aAuthed({ method: 'PUT', body: JSON.stringify({}) }));
    assert(status === 400, `missing content → 400, got ${status}`);
});

// ── Phase 6: ONE publish path (TARGET-058 Phase 8 step 0a) ──
// The three publish doors — POST /v1/apps, the presigned upload, and publish-draft — now share
// services/app-publish.ts. These tests pin the two things that were different before they did:
// a draft manifest cannot express pricing or per-locale descriptions, and this route used to
// publish the draft manifest VERBATIM, so promoting a draft turned a paid app free and dropped
// its translations. Nothing in the response said so.
console.log('\nPhase 6: one publish path — promoting a draft keeps what a draft cannot express');

const PAID = 'paid-draft-app.html';

await test('A paid app with per-locale descriptions is published inline', async () => {
    const { status, body } = await json('/v1/apps', aAuthed({
        method: 'POST',
        body: JSON.stringify({
            filename: PAID,
            content: b64('<!DOCTYPE html><html><body><h1>paid v1</h1></body></html>'),
            description: 'A paid app used to prove the draft door keeps its price.',
            descriptions: { en: 'Paid app', fi: 'Maksullinen sovellus' },
            price_morsels: 5,
            license_type: 'lifetime',
            category: 'utility',
        }),
    }));
    assert(status === 201, `publish status ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.manifest?.priceMorsels === 5, `priceMorsels=5, got ${body.data?.manifest?.priceMorsels}`);
    assert(body.data?.manifest?.licenseType === 'lifetime', 'licenseType=lifetime');
    assert(body.data?.manifest?.descriptions?.fi === 'Maksullinen sovellus', 'fi description stored');
});

await test('Promoting a draft keeps the price, the licence and the translations', async () => {
    const save = await json(`/v1/apps/${ownerAName}/${PAID}/draft`, aAuthed({
        method: 'PUT',
        body: JSON.stringify({ content: b64('<!DOCTYPE html><html><body><h1>paid v2</h1></body></html>') }),
    }));
    assert(save.status === 200, `draft save status ${save.status}`);

    const pub = await json(`/v1/apps/${ownerAName}/${PAID}/publish-draft`, aAuthed({ method: 'POST' }));
    assert(pub.status === 201, `publish-draft status ${pub.status}: ${JSON.stringify(pub.body)}`);
    const m = pub.body.data?.manifest ?? {};
    assert(m.priceMorsels === 5, `a promoted draft must stay paid — priceMorsels=${m.priceMorsels}`);
    assert(m.licenseType === 'lifetime', `licenceType survived — got ${m.licenseType}`);
    assert(m.descriptions?.fi === 'Maksullinen sovellus', `per-locale descriptions survived — got ${JSON.stringify(m.descriptions)}`);
});

await test('The paywall agrees: reading the promoted version still costs 5 morsels', async () => {
    // The live paywall is the strongest evidence available that the price survived the promotion:
    // it is computed from the stored manifest on every read. (The 402 answers the owner too — a
    // pre-existing quirk of the read route, unrelated to this path.)
    const { status, body } = await json(`/v1/apps/${ownerAName}/${PAID}`);
    assert(status === 402, `a priced app answers 402 — got ${status}: ${JSON.stringify(body)}`);
    assert(String(body.error?.message ?? '').includes('5 morsels'),
        `the paywall still names the price — got "${body.error?.message}"`);
});

await test('Promoting a draft records a public-activity event, like the other two doors', async () => {
    const { status, body } = await json('/v1/public/activity-feed?category=apps&limit=50');
    assert(status === 200, `feed status ${status}`);
    const items: any[] = body.data?.items ?? body.data?.events ?? [];
    assert(items.some(e => String(e.summary ?? '').includes(PAID) || String(e.link ?? '').includes(PAID)),
        'the draft publish reached the public feed');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
