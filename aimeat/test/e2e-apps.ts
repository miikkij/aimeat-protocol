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
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.etc.sha512Sync = (...m: Uint8Array[]) =>
    new Uint8Array(createHash('sha512').update(ed.etc.concatBytes(...m)).digest());

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
        body: JSON.stringify({ filename: FORK_NAME, content: b64(src), name: 'Versions Demo (fork)', category: 'utility', tags: ['demo'] }),
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
        body: JSON.stringify({ filename: FILENAME, content: b64('<h1>owner B</h1>'), name: 'B copy', category: 'utility', tags: [] }),
    }));
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.version_number === 1, `B's first publish is v1 in B's own bucket, got ${body.data.version_number}`);
    // A's record keeps its own (higher) version history — unaffected by B.
    const aVersions = await json(`/v1/apps/${ownerName}/${FILENAME}/versions`);
    assert((aVersions.body.data?.versions ?? []).length === 3, `owner A's version history intact (3), got ${(aVersions.body.data?.versions ?? []).length}`);
    const bDownload = await fetch(`${BASE}/v1/apps/${ownerBName}/${FILENAME}`);
    assert((await bDownload.text()) === '<h1>owner B</h1>', "B's namespace serves B's content");
});

// ── Summary ──
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
