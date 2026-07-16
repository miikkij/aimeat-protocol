/**
 * @file e2e-apps.ts
 * @description E2E tests for the App Catalog version lifecycle: inline publish,
 *   agent-publishes-into-owner-bucket, version history, fetch a specific version,
 *   "restore" (re-publish an older version as the new latest), "fork" (copy a
 *   version into a new app), the backward-compat full-GHII owner download
 *   fallback, the missing-version failure mode, and cross-owner isolation (one
 *   owner cannot publish/delete inside another owner's app namespace). These back
 *   the catalog UI's Versions / Restore / Fork controls, which compose only these
 *   endpoints.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=e2e-apps
 * @version-history
 *   v1.0.0 — 2026-06-05 — initial: versions, restore, fork, GHII fallback, 404
 *   v1.1.0 — 2026-06-09 — add Phase 5 cross-owner isolation: a second owner
 *     cannot delete into / overwrite the first owner's app namespace.
 *   v1.2.0 — 2026-06-20 — add Phase 6 screenshots: owner sets/replaces an app's
 *     screenshot via POST .../screenshot (no re-publish), listing flips
 *     has_screenshot, 400 on empty body, 403 for a different non-operator owner.
 *   v1.3.0 — 2026-06-20 — add Phase 7 description requirement: new app without a
 *     description → 400; carried forward on update. Fork/owner-B publishes now send one.
 *   v1.4.0 — 2026-06-20 — add Phase 8 clear-screenshot: owner DELETE flips has_screenshot
 *     to false + GET 404s; a different non-operator owner gets 403.
 *   v1.5.0 — 2026-06-20 — add Phase 9 parked apps: PATCH { parked } hides an app from the
 *     anonymous catalogue while the owner still sees it (and a different owner does not); direct
 *     download still works; re-publish inherits parked; cross-owner park 404s; parked-only PATCH
 *     preserves the access code; unpark restores public visibility.
 *   v1.6.0 — 2026-06-24 — add Phase 10 inline badge: GET ?mode=inline appends the node-branded
 *     "publish your own app" badge (skips when the app origin 301s); raw download stays byte-exact.
 *   v1.7.0 — 2026-06-26 — add Phase 9b rename in place: PATCH { name, description } edits the latest
 *     version's manifest without re-publishing (no new version), the download URL is unchanged, the
 *     listing reflects the new name; empty/over-long values 400; cross-owner rename 404s.
 *   v1.8.0 — 2026-07-14 — add Phase 11 Agent Face: Accept: text/markdown (and ?format=md) on the
 *     app URL serves converted HTML + the agent-affordances footer; a PUBLIC
 *     apps.{filename}.agentface record replaces the converted body; a non-public face behaves
 *     exactly like no face; Accept: text/html stays byte-exact; markdown headers asserted.
 *   v1.9.0 — 2026-07-14 — add Phase 12 aimeat-agentface served library: served as JS, carries the
 *     convention key + public-visibility write + the unauthenticated/missing-auth errors, and is
 *     listed in the /v1/libs catalogue.
 *   v1.10.0 — 2026-07-16 — Phase 10 regression: badge injection must survive '</body>' inside app
 *     JavaScript (last-match injection; first-match silently broke such apps).
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ownerName = `appstest${Date.now() % 100000}`;
const agentName = 'appsagent';
const FILENAME = 'versions-demo.html';

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

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

function authed(opts: RequestInit = {}): RequestInit {
    return { ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${ownerToken}` } };
}
function agentAuthed(opts: RequestInit = {}): RequestInit {
    return { ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${agentToken}` } };
}

const b64 = (html: string) => Buffer.from(html, 'utf8').toString('base64');
const HTML_V1 = '<!DOCTYPE html><html><body><h1>version one</h1></body></html>';
const HTML_V2 = '<!DOCTYPE html><html><body><h1>version two</h1></body></html>';

// ── State ──
let ownerPrivKey = '';
let ownerToken = '';
let agentGaii = '';
let agentPrivKey = '';
let agentToken = '';

console.log('\n=== App Catalog Versions/Restore/Fork E2E Tests ===\n');
console.log('Phase 0: Setup');

await test('Register test owner', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    ownerPrivKey = body.data.private_key;
    assert(typeof ownerPrivKey === 'string' && ownerPrivKey.length > 0, 'got private key');
});

await test('Get owner token', async () => {
    const timestamp = new Date().toISOString();
    const signature = await signMsg(ownerPrivKey, ownerName + NODE_ID + timestamp);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: ownerName, timestamp, signature }),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    ownerToken = body.data?.token;
    assert(typeof ownerToken === 'string', 'got owner token');
});

await test('Register test agent', async () => {
    const { status, body } = await json('/v1/agents', authed({
        method: 'POST',
        body: JSON.stringify({ name: agentName, owner: ownerName, capabilities: ['actions'], scopes: ['*'], model: 'test-model' }),
    }));
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    agentGaii = body.data.agent.gaii;
    agentPrivKey = body.data.private_key;
    assert(typeof agentGaii === 'string', 'got agent gaii');
});

await test('Get agent token', async () => {
    const timestamp = new Date().toISOString();
    const signature = await signMsg(agentPrivKey, agentGaii + timestamp);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agentGaii, timestamp, signature }),
    });
    assert(body.ok === true, `agent token: ${JSON.stringify(body.error)}`);
    agentToken = body.data?.token;
    assert(typeof agentToken === 'string', 'got agent token');
});

// ── Phase 1: publish + version history ──
console.log('\nPhase 1: Publish & version history');

await test('Owner publishes v1 (inline)', async () => {
    const { status, body } = await json('/v1/apps', authed({
        method: 'POST',
        body: JSON.stringify({ filename: FILENAME, content: b64(HTML_V1), name: 'Versions Demo', description: 'demo', category: 'utility', tags: ['demo'] }),
    }));
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.version_number === 1, `expected v1, got ${body.data.version_number}`);
});

await test('Agent publishes v2 into the SAME owner bucket', async () => {
    const { status, body } = await json('/v1/apps', agentAuthed({
        method: 'POST',
        body: JSON.stringify({ filename: FILENAME, content: b64(HTML_V2), name: 'Versions Demo', description: 'demo v2', category: 'utility', tags: ['demo'] }),
    }));
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.version_number === 2, `agent publish should increment to v2, got ${body.data.version_number}`);
});

await test('Catalog listing exposes the app under the bare owner name', async () => {
    const { body } = await json('/v1/apps?limit=200');
    const apps = body.data?.apps ?? [];
    const mine = apps.find((a: any) => a.filename === FILENAME);
    assert(!!mine, 'app present in listing');
    assert(mine.owner === ownerName, `listing owner should be bare "${ownerName}", got "${mine.owner}" (catalog "my apps" filter keys on this)`);
    assert(mine.version_number === 2, `listing shows latest version 2, got ${mine.version_number}`);
});

await test('GET /versions returns both versions, newest first', async () => {
    const { status, body } = await json(`/v1/apps/${ownerName}/${FILENAME}/versions`);
    assert(status === 200, `status ${status}`);
    const versions = body.data?.versions ?? [];
    assert(versions.length === 2, `expected 2 versions, got ${versions.length}`);
    assert(versions[0].version_number === 2 && versions[1].version_number === 1, 'sorted newest-first');
});

await test('GET ?version=1 returns the original v1 content', async () => {
    const res = await fetch(`${BASE}/v1/apps/${ownerName}/${FILENAME}?version=1`);
    assert(res.status === 200, `status ${res.status}`);
    const text = await res.text();
    assert(text === HTML_V1, 'v1 body matches what was published');
});

// ── Phase 2: restore ──
console.log('\nPhase 2: Restore (re-publish an older version as new latest)');

await test('Restore v1 → becomes v3, older versions preserved', async () => {
    // Mirror the UI: fetch the old version, then re-publish its content inline.
    const old = await (await fetch(`${BASE}/v1/apps/${ownerName}/${FILENAME}?version=1`)).text();
    const { status, body } = await json('/v1/apps', authed({
        method: 'POST',
        body: JSON.stringify({ filename: FILENAME, content: b64(old), name: 'Versions Demo', category: 'utility', tags: ['demo'] }),
    }));
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.version_number === 3, `restore should publish v3, got ${body.data.version_number}`);

    const latest = await (await fetch(`${BASE}/v1/apps/${ownerName}/${FILENAME}`)).text();
    assert(latest === HTML_V1, 'latest now serves the restored v1 content');

    const { body: vbody } = await json(`/v1/apps/${ownerName}/${FILENAME}/versions`);
    assert((vbody.data?.versions ?? []).length === 3, 'all three versions retained');
});

// ── Phase 3: fork ──
console.log('\nPhase 3: Fork (copy a version into a new app)');

const FORK_NAME = 'versions-demo-fork.html';
await test('Fork v2 into a new filename → fresh app at v1', async () => {
    const src = await (await fetch(`${BASE}/v1/apps/${ownerName}/${FILENAME}?version=2`)).text();
    const { status, body } = await json('/v1/apps', authed({
        method: 'POST',
        body: JSON.stringify({ filename: FORK_NAME, content: b64(src), name: 'Versions Demo (fork)', description: 'a fork of the demo', category: 'utility', tags: ['demo'] }),
    }));
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.version_number === 1, `fork is a new app at v1, got ${body.data.version_number}`);

    const forked = await (await fetch(`${BASE}/v1/apps/${ownerName}/${FORK_NAME}`)).text();
    assert(forked === HTML_V2, 'fork carries the v2 content it was copied from');
});

// ── Phase 4: backward-compat & failure modes ──
console.log('\nPhase 4: Backward-compat & failures');

await test('Legacy full-GHII owner segment still resolves (fallback)', async () => {
    const res = await fetch(`${BASE}/v1/apps/${encodeURIComponent(ownerName + '@' + NODE_ID)}/${FILENAME}`);
    assert(res.status === 200, `expected 200 via bare-prefix fallback, got ${res.status}`);
    const text = await res.text();
    assert(text === HTML_V1, 'fallback serves the current latest content');
});

await test('GET a non-existent version returns 404', async () => {
    const { status, body } = await json(`/v1/apps/${ownerName}/${FILENAME}?version=999`);
    assert(status === 404, `expected 404, got ${status}: ${JSON.stringify(body)}`);
});

await test('GET unknown owner returns 404', async () => {
    const { status } = await json(`/v1/apps/nobody-here/${FILENAME}`);
    assert(status === 404, `expected 404, got ${status}`);
});

// ── Phase 5: cross-owner isolation ──
// Apps are owner-scoped and the owner is derived from the authenticated identity
// (never a client param). A different owner must not be able to reach into the
// first owner's app namespace — publish keys on the caller's own owner, and the
// delete sweep keys on the caller's own owner name.
console.log('\nPhase 5: Cross-owner isolation');

const ownerBName = `appsother${Date.now() % 100000}`;
let ownerBToken = '';

await test('Register a second owner and get a token', async () => {
    const reg = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: ownerBName, public_key: 'placeholder' }),
    });
    assert(reg.status === 201, `register status ${reg.status}: ${JSON.stringify(reg.body)}`);
    const bPriv = reg.body.data.private_key;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(bPriv, ownerBName + NODE_ID + timestamp);
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: ownerBName, timestamp, signature }),
    });
    assert(tok.body.ok === true, `token: ${JSON.stringify(tok.body.error)}`);
    ownerBToken = tok.body.data?.token;
    assert(typeof ownerBToken === 'string', 'got owner B token');
});

function bAuthed(opts: RequestInit = {}): RequestInit {
    return { ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${ownerBToken}` } };
}

await test("Owner B cannot delete owner A's app (404, not authorized into A's namespace)", async () => {
    const { status } = await json(`/v1/apps/${FILENAME}`, bAuthed({ method: 'DELETE' }));
    assert(status === 404, `delete in another owner's namespace must 404, got ${status}`);
    // A's app must still resolve untouched.
    const res = await fetch(`${BASE}/v1/apps/${ownerName}/${FILENAME}`);
    assert(res.status === 200, `owner A's app still present, got ${res.status}`);
});

await test("Owner B publishing the same filename creates B's OWN record, not a write into A's", async () => {
    const { status, body } = await json('/v1/apps', bAuthed({
        method: 'POST',
        body: JSON.stringify({ filename: FILENAME, content: b64('<h1>owner B</h1>'), name: 'B copy', description: 'owner B copy', category: 'utility', tags: [] }),
    }));
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.version_number === 1, `B's first publish is v1 in B's own bucket, got ${body.data.version_number}`);
    // A's record keeps its own (higher) version history — unaffected by B.
    const aVersions = await json(`/v1/apps/${ownerName}/${FILENAME}/versions`);
    assert((aVersions.body.data?.versions ?? []).length === 3, `owner A's version history intact (3), got ${(aVersions.body.data?.versions ?? []).length}`);
    const bDownload = await fetch(`${BASE}/v1/apps/${ownerBName}/${FILENAME}`);
    assert((await bDownload.text()) === '<h1>owner B</h1>', "B's namespace serves B's content");
});

// ── Phase 6: screenshots (set/replace without re-publishing) ──
// Backs the screenshot worker + manual override: an owner (or operator) sets an app's
// screenshot via a dedicated endpoint, no re-publish; a different non-operator owner cannot.
console.log('\nPhase 6: Screenshots');

const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

await test('Owner sets a screenshot for their own app without re-publishing', async () => {
    const { status, body } = await json(`/v1/apps/${ownerName}/${FILENAME}/screenshot`, authed({
        method: 'POST',
        body: JSON.stringify({ screenshot: PNG_1x1, screenshot_mime_type: 'image/png' }),
    }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(typeof body.data?.screenshot_url === 'string', 'returns screenshot_url');
});

await test('GET screenshot now serves the image and listing flips has_screenshot', async () => {
    const res = await fetch(`${BASE}/v1/apps/${ownerName}/${FILENAME}/screenshot`);
    assert(res.status === 200, `screenshot GET status ${res.status}`);
    assert((res.headers.get('content-type') ?? '').startsWith('image/'), 'served as an image');
    const list = await json('/v1/apps?limit=200');
    const mine = (list.body.data?.apps ?? []).find((a: any) => a.filename === FILENAME && a.owner === ownerName);
    assert(!!mine && mine.has_screenshot === true, 'listing now reports has_screenshot=true');
});

await test('Setting a screenshot with no image data is rejected (400)', async () => {
    const { status } = await json(`/v1/apps/${ownerName}/${FILENAME}/screenshot`, authed({
        method: 'POST',
        body: JSON.stringify({}),
    }));
    assert(status === 400, `expected 400, got ${status}`);
});

await test("A different non-operator owner cannot set another owner's screenshot (403)", async () => {
    const { status } = await json(`/v1/apps/${ownerName}/${FILENAME}/screenshot`, bAuthed({
        method: 'POST',
        body: JSON.stringify({ screenshot: PNG_1x1 }),
    }));
    assert(status === 403, `expected 403, got ${status}`);
});

// ── Phase 7: description required on a NEW app; carried forward on update ──
console.log('\nPhase 7: Description requirement');

const DESC_FILE = 'desc-required.html';
await test('Publishing a NEW app without a description is rejected (400)', async () => {
    const { status, body } = await json('/v1/apps', authed({
        method: 'POST',
        body: JSON.stringify({ filename: DESC_FILE, content: b64('<h1>no desc</h1>'), name: 'No Desc', category: 'utility', tags: [] }),
    }));
    assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
});

await test('Same app publishes once a description is provided (201)', async () => {
    const { status, body } = await json('/v1/apps', authed({
        method: 'POST',
        body: JSON.stringify({ filename: DESC_FILE, content: b64('<h1>with desc</h1>'), name: 'No Desc', description: 'now it has one', category: 'utility', tags: [] }),
    }));
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.version_number === 1, `first version, got ${body.data.version_number}`);
});

await test('Re-publishing WITHOUT a description keeps the existing one (carry-forward)', async () => {
    const { status } = await json('/v1/apps', authed({
        method: 'POST',
        body: JSON.stringify({ filename: DESC_FILE, content: b64('<h1>v2</h1>'), name: 'No Desc', category: 'utility', tags: [] }),
    }));
    assert(status === 201, `update without description should succeed via carry-forward, got ${status}`);
    const { body } = await json('/v1/apps?limit=200');
    const mine = (body.data?.apps ?? []).find((a: any) => a.filename === DESC_FILE && a.owner === ownerName);
    assert(mine?.manifest?.description === 'now it has one', `description carried forward, got "${mine?.manifest?.description}"`);
});

// ── Phase 8: clear screenshot (queues a batch recapture) ──
console.log('\nPhase 8: Clear screenshot');

await test("A different non-operator owner cannot clear another owner's screenshot (403)", async () => {
    const { status } = await json(`/v1/apps/${ownerName}/${FILENAME}/screenshot`, bAuthed({ method: 'DELETE' }));
    assert(status === 403, `expected 403, got ${status}`);
});

await test('Owner clears their screenshot; listing flips has_screenshot to false and GET 404s', async () => {
    const set = await json(`/v1/apps/${ownerName}/${FILENAME}/screenshot`, authed({
        method: 'POST', body: JSON.stringify({ screenshot: PNG_1x1 }),
    }));
    assert(set.status === 200, `precondition (set screenshot) status ${set.status}`);
    const del = await json(`/v1/apps/${ownerName}/${FILENAME}/screenshot`, authed({ method: 'DELETE' }));
    assert(del.status === 200, `clear status ${del.status}: ${JSON.stringify(del.body)}`);
    assert(del.body.data?.cleared === true, 'returns cleared:true');
    const list = await json('/v1/apps?limit=200');
    const mine = (list.body.data?.apps ?? []).find((a: any) => a.filename === FILENAME && a.owner === ownerName);
    assert(!!mine && mine.has_screenshot === false, 'listing now reports has_screenshot=false');
    const gone = await fetch(`${BASE}/v1/apps/${ownerName}/${FILENAME}/screenshot`);
    assert(gone.status === 404, `screenshot GET now 404, got ${gone.status}`);
});

// ── Phase 9: parked apps (hide from the public catalogue, stay owner-usable) ──
// Parking sets a flag that drops the app out of the public listing/search while
// keeping it visible to its owner (and downloadable by direct URL — hide-only scope).
console.log('\nPhase 9: Parked apps');

const PARK_FILE = 'park-demo.html';

await test('Owner publishes an app to park', async () => {
    const { status } = await json('/v1/apps', authed({
        method: 'POST',
        body: JSON.stringify({ filename: PARK_FILE, content: b64('<h1>park me</h1>'), name: 'Park Demo', description: 'will be parked', category: 'utility', tags: [] }),
    }));
    assert(status === 201, `publish status ${status}`);
    // Visible in the anonymous catalogue before parking.
    const list = await json('/v1/apps?limit=200');
    const mine = (list.body.data?.apps ?? []).find((a: any) => a.filename === PARK_FILE && a.owner === ownerName);
    assert(!!mine, 'app present in public listing before parking');
    assert(mine.parked === false, `parked flag false before parking, got ${mine.parked}`);
});

await test('PATCH { parked: true } parks the app (200, parked=true)', async () => {
    const { status, body } = await json(`/v1/apps/${PARK_FILE}`, authed({
        method: 'PATCH', body: JSON.stringify({ parked: true }),
    }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.parked === true, `response parked=true, got ${body.data?.parked}`);
});

await test('Parked app is HIDDEN from the anonymous public catalogue', async () => {
    const list = await json('/v1/apps?limit=200');
    const mine = (list.body.data?.apps ?? []).find((a: any) => a.filename === PARK_FILE && a.owner === ownerName);
    assert(!mine, 'parked app must not appear in the anonymous listing');
});

await test('Parked app IS still visible to its owner (authenticated listing)', async () => {
    const list = await json('/v1/apps?limit=200', authed());
    const mine = (list.body.data?.apps ?? []).find((a: any) => a.filename === PARK_FILE && a.owner === ownerName);
    assert(!!mine, "owner's own parked app appears in their authenticated listing");
    assert(mine.parked === true, `owner sees parked=true, got ${mine.parked}`);
});

await test("Parked app is NOT visible to a DIFFERENT authenticated owner", async () => {
    const list = await json('/v1/apps?limit=200', bAuthed());
    const seen = (list.body.data?.apps ?? []).find((a: any) => a.filename === PARK_FILE && a.owner === ownerName);
    assert(!seen, "another owner must not see A's parked app");
});

await test('Parked app is still downloadable by direct URL (hide-only scope)', async () => {
    const res = await fetch(`${BASE}/v1/apps/${ownerName}/${PARK_FILE}`);
    assert(res.status === 200, `direct download still works, got ${res.status}`);
    assert((await res.text()) === '<h1>park me</h1>', 'serves the parked app content');
});

await test('Re-publishing a parked app KEEPS it parked (inherited state)', async () => {
    const { status } = await json('/v1/apps', authed({
        method: 'POST',
        body: JSON.stringify({ filename: PARK_FILE, content: b64('<h1>park me v2</h1>'), name: 'Park Demo', category: 'utility', tags: [] }),
    }));
    assert(status === 201, `re-publish status ${status}`);
    const anon = await json('/v1/apps?limit=200');
    assert(!(anon.body.data?.apps ?? []).some((a: any) => a.filename === PARK_FILE && a.owner === ownerName), 'still hidden from anonymous listing after update');
    const own = await json('/v1/apps?limit=200', authed());
    const mine = (own.body.data?.apps ?? []).find((a: any) => a.filename === PARK_FILE && a.owner === ownerName);
    assert(mine?.parked === true, 'owner still sees it parked after a re-publish');
});

await test("Another owner cannot park A's app (PATCH → 404)", async () => {
    const { status } = await json(`/v1/apps/${PARK_FILE}`, bAuthed({
        method: 'PATCH', body: JSON.stringify({ parked: true }),
    }));
    assert(status === 404, `cross-owner park must 404, got ${status}`);
});

await test('PATCH { parked: false } unparks → app reappears in the public catalogue', async () => {
    const { status, body } = await json(`/v1/apps/${PARK_FILE}`, authed({
        method: 'PATCH', body: JSON.stringify({ parked: false }),
    }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.parked === false, `response parked=false, got ${body.data?.parked}`);
    const list = await json('/v1/apps?limit=200');
    const mine = (list.body.data?.apps ?? []).find((a: any) => a.filename === PARK_FILE && a.owner === ownerName);
    assert(!!mine, 'unparked app is back in the anonymous listing');
    assert(mine.parked === false, 'reported as not parked');
});

await test('A parked-only PATCH does not clear an existing access code', async () => {
    // Set an access code, then park with a parked-only body, and confirm protection survives.
    const code = await json(`/v1/apps/${PARK_FILE}`, authed({ method: 'PATCH', body: JSON.stringify({ access_code: 'secret123' }) }));
    assert(code.status === 200 && code.body.data?.protected === true, 'access code set');
    const park = await json(`/v1/apps/${PARK_FILE}`, authed({ method: 'PATCH', body: JSON.stringify({ parked: true }) }));
    assert(park.status === 200, `park status ${park.status}`);
    assert(park.body.data?.protected === true, 'access code preserved through a parked-only PATCH');
    assert(park.body.data?.parked === true, 'app is parked');
    // Clean up: unpark + remove the code so later reads are unaffected.
    await json(`/v1/apps/${PARK_FILE}`, authed({ method: 'PATCH', body: JSON.stringify({ parked: false, access_code: '' }) }));
});

// ── Phase 9b: rename / edit-details in place (no re-publish, URL unchanged) ──
// PATCH { name, description } edits the latest version's manifest. The display
// name is metadata; the URL is keyed off owner/filename, so the link never moves.
console.log('\nPhase 9b: rename / edit details in place');

await test('Capture version count before rename (rename must NOT add a version)', async () => {
    const { body } = await json(`/v1/apps/${ownerName}/${PARK_FILE}/versions`);
    const count = (body.data?.versions ?? []).length;
    assert(count >= 1, `expected at least one version, got ${count}`);
    // stash on a module-scoped via closure variable
    (globalThis as any).__renameVersionCount = count;
});

await test('PATCH { name } renames in place (200, response carries the new name)', async () => {
    const { status, body } = await json(`/v1/apps/${PARK_FILE}`, authed({
        method: 'PATCH', body: JSON.stringify({ name: 'Renamed App' }),
    }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.name === 'Renamed App', `response name "Renamed App", got "${body.data?.name}"`);
});

await test('The download URL is unchanged after rename (link still works, same content)', async () => {
    const res = await fetch(`${BASE}/v1/apps/${ownerName}/${PARK_FILE}`, { redirect: 'manual' });
    if (res.status === 301) { console.log('    (app origin on — direct download 301s; covered elsewhere)'); return; }
    assert(res.status === 200, `download still 200 after rename, got ${res.status}`);
    assert((await res.text()) === '<h1>park me v2</h1>', 'serves the same content under the same URL');
});

await test('Catalog listing reflects the new name', async () => {
    const { body } = await json('/v1/apps?limit=200', authed());
    const mine = (body.data?.apps ?? []).find((a: any) => a.filename === PARK_FILE && a.owner === ownerName);
    assert(!!mine, 'app still listed');
    assert(mine.manifest?.name === 'Renamed App', `listing shows the new name, got "${mine.manifest?.name}"`);
});

await test('Rename did NOT create a new version', async () => {
    const { body } = await json(`/v1/apps/${ownerName}/${PARK_FILE}/versions`);
    const count = (body.data?.versions ?? []).length;
    assert(count === (globalThis as any).__renameVersionCount, `version count unchanged (was ${(globalThis as any).__renameVersionCount}, now ${count})`);
});

await test('PATCH { name, description } updates both fields at once', async () => {
    const { status, body } = await json(`/v1/apps/${PARK_FILE}`, authed({
        method: 'PATCH', body: JSON.stringify({ name: 'Renamed Again', description: 'a fresh description' }),
    }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.name === 'Renamed Again', `name updated, got "${body.data?.name}"`);
    assert(body.data?.description === 'a fresh description', `description updated, got "${body.data?.description}"`);
});

await test('PATCH { name: "" } is rejected (400, name cannot be empty)', async () => {
    const { status } = await json(`/v1/apps/${PARK_FILE}`, authed({
        method: 'PATCH', body: JSON.stringify({ name: '   ' }),
    }));
    assert(status === 400, `empty name must 400, got ${status}`);
});

await test('PATCH { description: "" } is rejected (400, description cannot be empty)', async () => {
    const { status } = await json(`/v1/apps/${PARK_FILE}`, authed({
        method: 'PATCH', body: JSON.stringify({ description: '   ' }),
    }));
    assert(status === 400, `empty description must 400, got ${status}`);
});

await test('PATCH { name } over 120 chars is rejected (400)', async () => {
    const { status } = await json(`/v1/apps/${PARK_FILE}`, authed({
        method: 'PATCH', body: JSON.stringify({ name: 'x'.repeat(121) }),
    }));
    assert(status === 400, `over-long name must 400, got ${status}`);
});

await test("Another owner cannot rename A's app (PATCH → 404)", async () => {
    const { status } = await json(`/v1/apps/${PARK_FILE}`, bAuthed({
        method: 'PATCH', body: JSON.stringify({ name: 'hijacked' }),
    }));
    assert(status === 404, `cross-owner rename must 404, got ${status}`);
});

// ── Phase 10: inline "publish your own app" badge ──
// An inline-served HTML app gets a node-branded "back home · publish your own app"
// badge appended (apps.ts injectAimeatBadge) so a shared-link visitor has a way home
// + a publish CTA. The raw download (attachment) must stay byte-exact (no badge).
console.log('\nPhase 10: inline publish-your-own-app badge');

await test('GET ?mode=inline appends the AIMEAT badge', async () => {
    const res = await fetch(`${BASE}/v1/apps/${ownerName}/${FILENAME}?mode=inline`, { redirect: 'manual' });
    // If the app origin is provisioned this 301s instead (covered by e2e-app-origin); skip then.
    if (res.status === 301) { console.log('    (app origin on — inline 301s; badge covered by app-origin serving)'); return; }
    assert(res.status === 200, `status ${res.status}`);
    const text = await res.text();
    assert(text.includes('id="aimeat-app-badge"'), 'inline body carries the badge element');
    assert(text.includes('Publish your own app'), 'badge shows the publish CTA');
    assert(/<\/body\s*>\s*$/i.test(text.trim()) === false || text.indexOf('aimeat-app-badge') < text.lastIndexOf('</body>'), 'badge injected before </body>');
});

// Regression: apps whose JS contains the literal string '</body>' (e.g. building/exporting
// HTML in template strings) were killed by first-match badge injection — the badge markup
// landed inside the JS string, a silent SyntaxError. Injection must target the LAST </body>.
const TRAP_FILE = 'body-trap-demo.html';
const TRAP_JS_STRING = 'var doc = "<html><body>hi</body></html>";';
const TRAP_HTML = '<!DOCTYPE html><html><body><h1>trap</h1><script>' + TRAP_JS_STRING + 'console.log(doc);</script></body></html>';

await test("Badge injection survives '</body>' inside app JavaScript (last-match)", async () => {
    const pub = await json('/v1/apps', authed({
        method: 'POST',
        body: JSON.stringify({ filename: TRAP_FILE, content: b64(TRAP_HTML), name: 'Body Trap Demo', description: 'JS contains </body>', category: 'utility', tags: [] }),
    }));
    assert(pub.status === 201 || pub.status === 200, `publish status ${pub.status}: ${JSON.stringify(pub.body)}`);
    const res = await fetch(`${BASE}/v1/apps/${ownerName}/${TRAP_FILE}?mode=inline`, { redirect: 'manual' });
    if (res.status === 301) { console.log('    (app origin on — inline 301s; badge covered by app-origin serving)'); return; }
    assert(res.status === 200, `inline status ${res.status}`);
    const text = await res.text();
    assert(text.includes(TRAP_JS_STRING), 'the JS string containing </body> is byte-intact (badge not injected into it)');
    assert(text.includes('id="aimeat-app-badge"'), 'badge element present');
    assert(text.indexOf('id="aimeat-app-badge"') > text.indexOf(TRAP_JS_STRING), 'badge lands after the script, at the real closing tag');
});

await test('Raw download (no mode) stays byte-exact — no badge', async () => {
    const res = await fetch(`${BASE}/v1/apps/${ownerName}/${FILENAME}`);
    assert(res.status === 200, `status ${res.status}`);
    const text = await res.text();
    assert(!text.includes('aimeat-app-badge'), 'attachment download is unmodified (no badge)');
});

// ── Phase 11: Agent Face (markdown read-surface for agents) ──
// A request that prefers text/markdown on the app URL serves the app's agent face: the PUBLIC
// apps.{filename}.agentface memory record when declared, else the app HTML converted to markdown.
// Both variants carry the node-generated "## Agent affordances" footer. A non-public face must be
// indistinguishable from no face (anonymous reads — no existence disclosure). Browsers keep HTML.
console.log('\nPhase 11: Agent Face (markdown read-surface)');

const FACE_KEY = `apps.${FILENAME}.agentface`;
const FACE_MD = '# Versions Demo — agent view\n\nCurrent state lives in public records.\n';
const mdHeaders = { Accept: 'text/markdown' };

await test('No face declared: Accept: text/markdown serves converted HTML + affordances footer', async () => {
    const res = await fetch(`${BASE}/v1/apps/${ownerName}/${FILENAME}`, { headers: mdHeaders });
    assert(res.status === 200, `status ${res.status}`);
    const text = await res.text();
    // Latest content is the restored v1 shell: <h1>version one</h1> → "# version one"
    assert(text.includes('# version one'), `converted body carries the app heading, got: ${text.slice(0, 120)}`);
    assert(text.includes('## Agent affordances'), 'affordances footer present');
    assert(text.includes(`/v1/apps/${encodeURIComponent(ownerName)}/${encodeURIComponent(FILENAME)}/webmcp`), 'footer links the WebMCP tool listing');
    assert(text.includes(`/v1/apps/${encodeURIComponent(ownerName)}/${encodeURIComponent(FILENAME)}/skills`), 'footer links the bound skills');
    assert(text.includes('/auth.md'), 'footer links agent registration (/auth.md)');
});

await test('Markdown response headers: content-type, Vary: Accept, x-markdown-tokens', async () => {
    const res = await fetch(`${BASE}/v1/apps/${ownerName}/${FILENAME}`, { headers: mdHeaders });
    assert(res.status === 200, `status ${res.status}`);
    assert((res.headers.get('content-type') ?? '').startsWith('text/markdown'), `content-type text/markdown, got ${res.headers.get('content-type')}`);
    assert((res.headers.get('vary') ?? '').toLowerCase().includes('accept'), `Vary includes Accept, got ${res.headers.get('vary')}`);
    const tokens = parseInt(res.headers.get('x-markdown-tokens') ?? '', 10);
    assert(Number.isFinite(tokens) && tokens > 0, `x-markdown-tokens is a positive count, got ${res.headers.get('x-markdown-tokens')}`);
});

await test('?format=md serves the markdown variant without an Accept header', async () => {
    const res = await fetch(`${BASE}/v1/apps/${ownerName}/${FILENAME}?format=md`);
    assert(res.status === 200, `status ${res.status}`);
    assert((res.headers.get('content-type') ?? '').startsWith('text/markdown'), 'served as markdown');
    assert((await res.text()).includes('## Agent affordances'), 'affordances footer present');
});

await test('A PUBLIC agentface record replaces the converted body (footer still appended)', async () => {
    const write = await json('/v1/memory', authed({
        method: 'POST',
        body: JSON.stringify({ key: FACE_KEY, value: FACE_MD, visibility: 'public' }),
    }));
    assert(write.status === 200 || write.status === 201, `face write status ${write.status}: ${JSON.stringify(write.body)}`);
    const res = await fetch(`${BASE}/v1/apps/${ownerName}/${FILENAME}`, { headers: mdHeaders });
    assert(res.status === 200, `status ${res.status}`);
    const text = await res.text();
    assert(text.includes('# Versions Demo — agent view'), 'serves the declared face markdown');
    assert(!text.includes('# version one'), 'converted HTML body no longer served');
    assert(text.includes('## Agent affordances'), 'affordances footer appended to the declared face too');
});

await test("A non-public face ('owner' visibility) behaves exactly like no face", async () => {
    const write = await json('/v1/memory', authed({
        method: 'POST',
        body: JSON.stringify({ key: FACE_KEY, value: FACE_MD, visibility: 'owner' }),
    }));
    assert(write.status === 200 || write.status === 201, `face rewrite status ${write.status}: ${JSON.stringify(write.body)}`);
    const res = await fetch(`${BASE}/v1/apps/${ownerName}/${FILENAME}`, { headers: mdHeaders });
    assert(res.status === 200, `status ${res.status}`);
    const text = await res.text();
    assert(!text.includes('# Versions Demo — agent view'), 'non-public face content is NOT served');
    assert(text.includes('# version one'), 'falls back to converted HTML (indistinguishable from no face)');
    assert(text.includes('## Agent affordances'), 'affordances footer present on the fallback');
});

await test('Accept: text/html keeps exactly today\'s behavior (byte-exact HTML, no markdown headers)', async () => {
    const res = await fetch(`${BASE}/v1/apps/${ownerName}/${FILENAME}`, { headers: { Accept: 'text/html' } });
    assert(res.status === 200, `status ${res.status}`);
    assert((res.headers.get('content-type') ?? '').includes('html'), `content-type html, got ${res.headers.get('content-type')}`);
    assert(res.headers.get('x-markdown-tokens') === null, 'no x-markdown-tokens on the HTML response');
    assert((await res.text()) === HTML_V1, 'HTML body byte-exact (raw download unchanged)');
});

// ── Phase 12: aimeat-agentface served library (Agent Face phase 2) ──
// The publish library is node-served like the other app libs (aimeat-webmcp.js precedent):
// assert it serves as JavaScript, carries the convention key + public write, and is catalogued.
console.log('\nPhase 12: aimeat-agentface served library');

await test('GET /v1/libs/aimeat-agentface.js serves the library as JavaScript', async () => {
    const res = await fetch(`${BASE}/v1/libs/aimeat-agentface.js`);
    assert(res.status === 200, `status ${res.status}`);
    assert((res.headers.get('content-type') ?? '').includes('javascript'), `content-type ${res.headers.get('content-type')}`);
    const src = await res.text();
    assert(src.includes(".agentface"), 'writes the convention key apps.{filename}.agentface');
    assert(src.includes("visibility: 'public'"), "publishes with visibility 'public'");
    assert(src.includes('AIMEATAgentFace'), 'exposes the AIMEATAgentFace global');
    assert(src.includes('AIMEAT.auth is required'), 'clear error when aimeat-auth is missing');
    assert(src.includes('Not signed in'), 'clear error when called unauthenticated');
});

await test('/v1/libs catalogue lists aimeat-agentface (requires aimeat-auth)', async () => {
    const { status, body } = await json('/v1/libs');
    assert(status === 200, `status ${status}`);
    const lib = (body.libraries ?? []).find((l: any) => l.name === 'aimeat-agentface');
    assert(!!lib, 'aimeat-agentface listed in the catalogue');
    assert(lib.url === '/v1/libs/aimeat-agentface.js', `url ${lib.url}`);
    assert(lib.requires === 'aimeat-auth', `requires ${lib.requires}`);
});

// ── Summary ──
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
