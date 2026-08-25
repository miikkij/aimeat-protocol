/**
 * @file test/e2e-surface-layout.ts
 * @description E2E for the surface layouts: which blocks this node's front page and its members'
 *   home are built from. Covers the built-in fallback, the block catalogue, every refusal on the
 *   write path, the free-form passages and where they are NOT readable, the reserved keys that stop
 *   the generic portal-memory doors reaching a layout, versions and restore, and the all-or-nothing
 *   rule on a multi-surface import.
 *
 *   Three of these matter more than the rest and are worth keeping even if the suite is ever
 *   trimmed: a refused write must leave the previous layout exactly as it was, a free-form passage
 *   must not appear in the unauthenticated /v1/site/sync feed, and the generic portal-memory doors
 *   must refuse a layout key — that last one is what stops an operator clearing their node's home by
 *   pressing the delete cross beside a JSON blob they did not recognise.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=surface-layout
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial suite.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

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

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

async function registerOwner(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: status ${reg.status}: ${JSON.stringify(reg.body)}`);
    const priv = reg.body.data.private_key;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(priv, name + NODE_ID + timestamp);
    const { body } = await json('/v1/auth/token', {
        method: 'POST', body: JSON.stringify({ owner: name, timestamp, signature }),
    });
    assert(body.ok === true, `token ${name}: ${JSON.stringify(body.error)}`);
    return body.data.token;
}

// ─── State ───
let opToken = '';
let memberToken = '';
const opName = `testlayoutop${Date.now()}`;
const memberName = `testlayoutuser${Date.now()}`;

const op = (opts: RequestInit = {}): RequestInit => ({
    ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${opToken}` },
});
const member = (opts: RequestInit = {}): RequestInit => ({
    ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${memberToken}` },
});

/** A layout that is valid on the home surface, so each refusal test breaks exactly one thing. */
const GOOD_HOME = {
    v: 1,
    blocks: [
        { id: 'home.nameplate', key: 'home.nameplate' },
        { id: 'home.feed', key: 'home.feed', props: { limit: 4 } },
    ],
};

async function homeBlockIds(): Promise<string[]> {
    const { body } = await json('/v1/site/layout/home', op());
    return (body.data?.layout?.blocks ?? []).map((b: any) => b.id);
}

console.log('\n=== AIMEAT Surface Layout E2E Test ===\n');
console.log('Setup');

await test('Register operator owner (first owner is auto-operator)', async () => {
    opToken = await registerOwner(opName);
    assert(opToken.length > 0, 'got operator token');
});

await test('Register an ordinary member', async () => {
    memberToken = await registerOwner(memberName);
    assert(memberToken.length > 0, 'got member token');
});

// ─── The built-in layout ───
console.log('\nThe built-in layout');

await test('GET /v1/site/layout/portal — public, and answers before anything is configured', async () => {
    const { status, body } = await json('/v1/site/layout/portal');
    assert(status === 200, `status ${status}`);
    assert(body.ok === true, `ok: ${JSON.stringify(body.error)}`);
    assert(body.data.source === 'default', `source ${body.data.source}`);
    assert(body.data.degraded === false, 'a fresh node is not degraded');
    assert(Array.isArray(body.data.layout.blocks) && body.data.layout.blocks.length > 0,
        'the built-in portal layout is not empty');
});

await test('GET /v1/site/layout/home without a session → 401', async () => {
    const { status } = await json('/v1/site/layout/home');
    assert(status === 401, `expected 401, got ${status}`);
});

await test('GET /v1/site/layout/home — any member of this node may read their own page', async () => {
    const { status, body } = await json('/v1/site/layout/home', member());
    assert(status === 200, `status ${status}`);
    assert(body.data.layout.surface === 'home', 'surface named');
    assert(body.data.layout.blocks.length > 0, 'the built-in home layout is not empty');
});

await test('GET /v1/site/layout/nonsense → 404 rather than a guess', async () => {
    const { status, body } = await json('/v1/site/layout/nonsense', op());
    assert(status === 404, `expected 404, got ${status}`);
    assert(body.error?.code === 'SURFACE_NOT_FOUND', `code ${body.error?.code}`);
});

// ─── The block catalogue ───
console.log('\nThe block catalogue');

await test('GET /v1/site/blocks?surface=home — lists blocks with the settings they take', async () => {
    const { status, body } = await json('/v1/site/blocks?surface=home', op());
    assert(status === 200, `status ${status}`);
    const ids = body.data.blocks.map((b: any) => b.id);
    assert(ids.includes('home.feed'), 'home.feed is offered');
    assert(ids.includes('common.freeform'), 'the free-form block is offered');
    assert(!ids.includes('portal.gallery'), 'a portal block is not offered on home');
    const feed = body.data.blocks.find((b: any) => b.id === 'home.feed');
    assert(feed.props?.limit?.type === 'number', 'the feed declares its limit setting');
    assert(typeof feed.summary === 'string' && feed.summary.length > 10, 'each block says what it is');
    assert(feed.label_key === 'surface.blocks.home.feed.label', `label key ${feed.label_key}`);
});

await test('GET /v1/site/blocks?surface=bogus → 422', async () => {
    const { status } = await json('/v1/site/blocks?surface=bogus', op());
    assert(status === 422, `expected 422, got ${status}`);
});

await test('GET /v1/site/blocks with a non-operator token → 403', async () => {
    const { status } = await json('/v1/site/blocks?surface=home', member());
    assert(status === 403, `expected 403, got ${status}`);
});

// ─── Writing ───
console.log('\nWriting a layout');

await test('PUT /v1/site/layout/home — stores it, and reads back in order', async () => {
    const put = await json('/v1/site/layout/home', op({ method: 'PUT', body: JSON.stringify(GOOD_HOME) }));
    assert(put.status === 200, `status ${put.status}: ${JSON.stringify(put.body.error)}`);
    const { body } = await json('/v1/site/layout/home', op());
    assert(body.data.source === 'stored', `source ${body.data.source}`);
    assert(body.data.degraded === false, 'not degraded');
    const ids = body.data.layout.blocks.map((b: any) => b.id);
    assert(JSON.stringify(ids) === JSON.stringify(['home.nameplate', 'home.feed']), `order ${ids}`);
    assert(body.data.layout.blocks[1].props.limit === 4, 'the setting survived');
});

await test('PUT without a token → 401', async () => {
    const { status } = await json('/v1/site/layout/home', { method: 'PUT', body: JSON.stringify(GOOD_HOME) });
    assert(status === 401, `expected 401, got ${status}`);
});

await test('PUT with a non-operator token → 403', async () => {
    const { status } = await json('/v1/site/layout/home', member({ method: 'PUT', body: JSON.stringify(GOOD_HOME) }));
    assert(status === 403, `expected 403, got ${status}`);
});

await test('PUT an unknown block → 422, and the message names it', async () => {
    const { status, body } = await json('/v1/site/layout/home', op({
        method: 'PUT', body: JSON.stringify({ v: 1, blocks: [{ id: 'home.nope', key: 'x' }] }),
    }));
    assert(status === 422, `expected 422, got ${status}`);
    assert(String(body.error?.message).includes('home.nope'), `message: ${body.error?.message}`);
});

await test('PUT a portal block onto home → 422, and the message names the surface', async () => {
    const { status, body } = await json('/v1/site/layout/home', op({
        method: 'PUT', body: JSON.stringify({ v: 1, blocks: [{ id: 'portal.gallery', key: 'g' }] }),
    }));
    assert(status === 422, `expected 422, got ${status}`);
    assert(String(body.error?.message).includes('home surface'), `message: ${body.error?.message}`);
});

await test('PUT two blocks sharing a key → 422', async () => {
    const { status } = await json('/v1/site/layout/home', op({
        method: 'PUT',
        body: JSON.stringify({ v: 1, blocks: [{ id: 'home.feed', key: 's' }, { id: 'home.trust', key: 's' }] }),
    }));
    assert(status === 422, `expected 422, got ${status}`);
});

await test('PUT a setting of the wrong type → 422, and the message names the setting', async () => {
    const { status, body } = await json('/v1/site/layout/home', op({
        method: 'PUT',
        body: JSON.stringify({ v: 1, blocks: [{ id: 'home.feed', key: 'f', props: { limit: 'lots' } }] }),
    }));
    assert(status === 422, `expected 422, got ${status}`);
    assert(String(body.error?.message).includes('limit'), `message: ${body.error?.message}`);
});

await test('PUT an empty layout → 422 rather than storing a blank page', async () => {
    const { status } = await json('/v1/site/layout/home', op({ method: 'PUT', body: JSON.stringify({ v: 1, blocks: [] }) }));
    assert(status === 422, `expected 422, got ${status}`);
});

await test('A refused write leaves the previous layout exactly as it was', async () => {
    const before = await homeBlockIds();
    await json('/v1/site/layout/home', op({
        method: 'PUT',
        body: JSON.stringify({ v: 1, blocks: [{ id: 'home.trust', key: 't' }, { id: 'home.nope', key: 'n' }] }),
    }));
    const after = await homeBlockIds();
    assert(JSON.stringify(before) === JSON.stringify(after), `layout changed: ${before} → ${after}`);
});

// ─── Free-form passages ───
console.log('\nFree-form passages');

const WITH_PASSAGE = {
    layout: {
        home: {
            v: 1,
            blocks: [
                { id: 'home.nameplate', key: 'home.nameplate' },
                {
                    id: 'common.freeform', key: 'freeform.helpdesk',
                    titles: { en: 'Who to ask' },
                    body: '## Who to ask\n\nPayroll questions go to **Anna Virtanen**.',
                },
            ],
            meta: { note: 'Department home' },
        },
    },
};

await test('POST /v1/site/layout-import — one paste, with the words inline on the block', async () => {
    const { status, body } = await json('/v1/site/layout-import', op({ method: 'POST', body: JSON.stringify(WITH_PASSAGE) }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body.error)}`);
    assert(body.data.surfaces_written.includes('home'), 'home was written');
});

await test('The passage comes back with the layout, and the layout itself does not carry the prose', async () => {
    const { body } = await json('/v1/site/layout/home', op());
    assert(body.data.freeform['freeform.helpdesk']?.includes('Anna Virtanen'), 'the words came back');
    assert(!JSON.stringify(body.data.layout).includes('Anna Virtanen'), 'the layout holds a reference, not the prose');
    const block = body.data.layout.blocks.find((b: any) => b.key === 'freeform.helpdesk');
    assert(block?.titles?.en === 'Who to ask', 'the operator heading survived');
});

await test('The passage is NOT in the unauthenticated /v1/site/sync feed', async () => {
    const { status, body } = await json('/v1/site/sync');
    assert(status === 200, `status ${status}`);
    const dumped = JSON.stringify(body.data.memory_keys ?? []);
    assert(!dumped.includes('Anna Virtanen'), 'a department passage must not be readable without a session');
    assert(!dumped.includes('site/free.'), 'the passage key is outside the mirrored prefix');
});

await test('A passage carrying a script tag → 422, named, and nothing stored', async () => {
    const before = await homeBlockIds();
    const { status, body } = await json('/v1/site/layout-import', op({
        method: 'POST',
        body: JSON.stringify({
            layout: {
                home: {
                    v: 1,
                    blocks: [
                        { id: 'home.nameplate', key: 'home.nameplate' },
                        { id: 'common.freeform', key: 'freeform.bad', body: 'hello <script>steal()</script>' },
                    ],
                },
            },
        }),
    }));
    assert(status === 422, `expected 422, got ${status}`);
    assert(String(body.error?.message).includes('<script>'), `message: ${body.error?.message}`);
    assert(JSON.stringify(await homeBlockIds()) === JSON.stringify(before), 'the layout was left alone');
});

await test('POST /v1/site/freeform with an unusable name → 422', async () => {
    const { status } = await json('/v1/site/freeform', op({
        method: 'POST', body: JSON.stringify({ key: 'Not A Slug', body: 'hello' }),
    }));
    assert(status === 422, `expected 422, got ${status}`);
});

await test('POST /v1/site/freeform with a non-operator token → 403', async () => {
    const { status } = await json('/v1/site/freeform', member({
        method: 'POST', body: JSON.stringify({ key: 'note', body: 'hello' }),
    }));
    assert(status === 403, `expected 403, got ${status}`);
});

// ─── The reserved keys ───
console.log('\nThe reserved keys');

await test('POST /v1/site/memory cannot overwrite a layout → 422 MEMORY_RESERVED', async () => {
    const { status, body } = await json('/v1/site/memory', op({
        method: 'POST', body: JSON.stringify({ key: 'portal/layout.home', value: 'junk' }),
    }));
    assert(status === 422, `expected 422, got ${status}`);
    assert(body.error?.code === 'MEMORY_RESERVED', `code ${body.error?.code}`);
});

await test('DELETE /v1/site/memory cannot delete a layout → 422, and the layout is still there', async () => {
    const { status } = await json('/v1/site/memory/' + encodeURIComponent('portal/layout.home'), op({ method: 'DELETE' }));
    assert(status === 422, `expected 422, got ${status}`);
    const { body } = await json('/v1/site/layout/home', op());
    assert(body.data.source === 'stored', 'the layout survived the delete attempt');
});

await test('POST /v1/site/import cannot smuggle a layout past the validator → 422', async () => {
    const { status, body } = await json('/v1/site/import', op({
        method: 'POST', body: JSON.stringify({ memory: { 'portal/layout.home': 'junk' } }),
    }));
    assert(status === 422, `expected 422, got ${status}`);
    assert(body.error?.code === 'MEMORY_RESERVED', `code ${body.error?.code}`);
});

await test('An ordinary portal record still goes through both doors', async () => {
    const set = await json('/v1/site/memory', op({
        method: 'POST', body: JSON.stringify({ key: 'portal/about', value: 'We are a department.' }),
    }));
    assert(set.status === 200, `set status ${set.status}`);
    const del = await json('/v1/site/memory/' + encodeURIComponent('portal/about'), op({ method: 'DELETE' }));
    assert(del.status === 200, `delete status ${del.status}`);
});

// ─── Versions ───
console.log('\nVersions and restore');

await test('GET versions — every write leaves the one it replaced', async () => {
    const { status, body } = await json('/v1/site/layout/home/versions', op());
    assert(status === 200, `status ${status}`);
    assert(Array.isArray(body.data.versions) && body.data.versions.length > 0, 'there is history');
});

await test('POST restore — an earlier layout comes back', async () => {
    await json('/v1/site/layout/home', op({ method: 'PUT', body: JSON.stringify(GOOD_HOME) }));
    const marker = { v: 1, blocks: [{ id: 'home.trust', key: 'only-trust' }] };
    await json('/v1/site/layout/home', op({ method: 'PUT', body: JSON.stringify(marker) }));
    assert(JSON.stringify(await homeBlockIds()) === JSON.stringify(['home.trust']), 'the marker layout is live');

    const { body } = await json('/v1/site/layout/home/versions', op());
    const versions = body.data.versions.map((v: any) => v.version).sort((a: number, b: number) => b - a);
    // The newest archived version is the one the marker replaced: GOOD_HOME.
    const restore = await json('/v1/site/layout/home/restore', op({
        method: 'POST', body: JSON.stringify({ version: versions[0] }),
    }));
    assert(restore.status === 200, `restore status ${restore.status}: ${JSON.stringify(restore.body.error)}`);
    const ids = await homeBlockIds();
    assert(JSON.stringify(ids) === JSON.stringify(['home.nameplate', 'home.feed']), `restored to ${ids}`);
});

await test('POST restore of a version that does not exist → 404', async () => {
    const { status } = await json('/v1/site/layout/home/restore', op({ method: 'POST', body: JSON.stringify({ version: 99999 }) }));
    assert(status === 404, `expected 404, got ${status}`);
});

await test('POST restore without naming a version → 422', async () => {
    const { status } = await json('/v1/site/layout/home/restore', op({ method: 'POST', body: JSON.stringify({}) }));
    assert(status === 422, `expected 422, got ${status}`);
});

// ─── Import is all or nothing ───
console.log('\nImport is all or nothing');

await test('One bad surface in a paste leaves the other one untouched', async () => {
    const beforePortal = await json('/v1/site/layout/portal');
    const beforeSource = beforePortal.body.data.source;
    const { status } = await json('/v1/site/layout-import', op({
        method: 'POST',
        body: JSON.stringify({
            layout: {
                portal: { v: 1, blocks: [{ id: 'portal.hero', key: 'portal.hero' }] },
                home: { v: 1, blocks: [{ id: 'home.nope', key: 'x' }] },
            },
        }),
    }));
    assert(status === 422, `expected 422, got ${status}`);
    const afterPortal = await json('/v1/site/layout/portal');
    assert(afterPortal.body.data.source === beforeSource,
        `the portal was written despite the refusal (${beforeSource} → ${afterPortal.body.data.source})`);
});

await test('POST /v1/site/layout-import naming a surface this node lacks → 422', async () => {
    const { status } = await json('/v1/site/layout-import', op({
        method: 'POST', body: JSON.stringify({ layout: { basement: { v: 1, blocks: [] } } }),
    }));
    assert(status === 422, `expected 422, got ${status}`);
});

// ─── Back to the built-in one ───
console.log('\nBack to the built-in one');

await test('POST reset — the built-in layout becomes a stored one to edit', async () => {
    const { status, body } = await json('/v1/site/layout/home/reset', op({ method: 'POST' }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body.error)}`);
    assert(body.data.source === 'stored', 'reset leaves something to edit');
    assert(body.data.layout.blocks.length > 2, 'and it is the full built-in layout');
});

await test('DELETE — the surface goes back to having no stored layout at all', async () => {
    const { status } = await json('/v1/site/layout/home', op({ method: 'DELETE' }));
    assert(status === 200, `status ${status}`);
    const { body } = await json('/v1/site/layout/home', op());
    assert(body.data.source === 'default', `source ${body.data.source}`);
});

// ─── Cleanup ───
console.log('\nCleanup');

await test('Leave both surfaces on their built-in layouts', async () => {
    for (const surface of ['home', 'home-onboarding', 'portal']) {
        await json(`/v1/site/layout/${surface}`, op({ method: 'DELETE' }));
    }
    const { body } = await json('/v1/site/layout/portal');
    assert(body.data.source === 'default', 'portal is back to the built-in layout');
});

// ─── Summary ───
console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
