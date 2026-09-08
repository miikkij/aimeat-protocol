/**
 * @file e2e-app-roadmap.ts
 * @description The app's roadmap, the publish gate that fills it, and the listing that answers
 *   "what am I helping build".
 *
 *   The gate is the interesting one and it is asserted from both sides, because the whole decision
 *   is that the two sides differ: publishing your own app without saying what changed is a HINT in
 *   the answer, and doing it to an app somebody else helps build is a REFUSAL. The reasoning is that
 *   D2 refuses to fail a publish over a practice whose only beneficiary is the publisher, and on a
 *   shared app the person who loses by the silence is somebody else.
 * @usage pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-app-roadmap
 * @version-history
 *   v1.0.0 — 2026-09-08 — Initial. Phases 4, 5 and 6 of the shared-app work.
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}: ${(e as Error).message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function setupOwner(label: string) {
    const name = `rm${label}${Date.now().toString(36)}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'RM', password: 'RmTest1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1200));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'RM', password: 'RmTest1234' }) });
    }
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const tok = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: name, password: 'RmTest1234' }) });
    assert(tok.status === 200, `login ${tok.status}`);
    return { name, token: tok.body.data.token as string };
}

const html = (s: string) => Buffer.from(`<!doctype html><meta name="viewport" content="width=device-width"><h1>${s}</h1>`).toString('base64');

async function publish(token: string, filename: string, body: string, extra: Record<string, unknown> = {}) {
    return json('/v1/apps', {
        method: 'POST', headers: auth(token),
        body: JSON.stringify({ filename, name: 'Roadmap demo', description: 'roadmap e2e', content: html(body), ...extra }),
    });
}

console.log('\n=== AIMEAT app roadmap E2E ===\n');

let owner: Awaited<ReturnType<typeof setupOwner>>;
let builder: Awaited<ReturnType<typeof setupOwner>>;
let stranger: Awaited<ReturnType<typeof setupOwner>>;
const APP = 'roadmap-demo.html';
const road = () => `/v1/apps/${owner.name}/${APP}/roadmap`;

await test('setup: an owner with an app, a builder and a stranger', async () => {
    owner = await setupOwner('own');
    builder = await setupOwner('bld');
    stranger = await setupOwner('str');
    const pub = await publish(owner.token, APP, 'v1');
    assert(pub.status === 200 || pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
});

// ── Publishing alone ──────────────────────────────────────────────────────────────────────────────

await test('publishing your own app without a line is allowed, and says so', async () => {
    const pub = await publish(owner.token, APP, 'v2');
    assert(pub.status === 200 || pub.status === 201, `publish ${pub.status}`);
    assert(typeof pub.body.data.roadmap_hint === 'string', 'the answer carries a hint rather than a refusal');
    assert(pub.body.data.roadmap_hint.includes('required'), 'and it says where it WOULD be required');
});

await test('a line carried on the publish lands on the roadmap with its version', async () => {
    const pub = await publish(owner.token, APP, 'v3', { roadmap: 'The heading fits a phone now.' });
    assert(pub.status === 200 || pub.status === 201, `publish ${pub.status}`);
    assert(pub.body.data.roadmap_hint === undefined, 'and there is nothing left to hint about');

    const r = await json(road(), { headers: auth(owner.token) });
    assert(r.status === 200, `read ${r.status}`);
    const done = (r.body.data.roadmap.entries as any[]).filter(e => e.state === 'done');
    assert(done.length === 1, `one done line (got ${done.length})`);
    assert(done[0].what === 'The heading fits a phone now.', 'in the words that were sent');
    assert(done[0].version === pub.body.data.version_number, 'stamped with the version it became');
});

// ── Wishes ────────────────────────────────────────────────────────────────────────────────────────

await test('anybody signed in may leave a wish', async () => {
    const r = await json(road(), {
        method: 'POST', headers: auth(stranger.token),
        body: JSON.stringify({ what: 'It would be good if it remembered my last search.' }),
    });
    assert(r.status === 201, `wish ${r.status}: ${JSON.stringify(r.body?.error)}`);
});

await test('but nobody outside the build says a thing IS done', async () => {
    const r = await json(road(), {
        method: 'POST', headers: auth(stranger.token),
        body: JSON.stringify({ what: 'I fixed it myself.', state: 'done' }),
    });
    assert(r.status === 403, `expected 403, got ${r.status}`);
});

await test('the wishes are the build\'s until the owner opens them', async () => {
    const outside = await json(road(), { headers: auth(stranger.token) });
    assert(outside.status === 200, `read ${outside.status}`);
    const states = (outside.body.data.roadmap.entries as any[]).map(e => e.state);
    assert(!states.includes('wanted'), 'a reader outside the build sees the changelog only');
    assert(states.includes('done'), 'and does see the changelog');

    const open = await json(road(), {
        method: 'PATCH', headers: auth(owner.token), body: JSON.stringify({ wanted_visibility: 'everyone' }),
    });
    assert(open.status === 200, `open ${open.status}`);
    const after = await json(road(), { headers: auth(stranger.token) });
    assert((after.body.data.roadmap.entries as any[]).some(e => e.state === 'wanted'), 'and now they see the wishes too');
});

await test('somebody may withdraw their own wish, and not somebody else\'s', async () => {
    const mine = await json(road(), {
        method: 'POST', headers: auth(stranger.token),
        body: JSON.stringify({ what: 'Actually never mind this one.' }),
    });
    const id = (mine.body.data.roadmap.entries as any[])[0].id;

    const notYours = await json(`${road()}/${id}`, { method: 'DELETE', headers: auth(builder.token) });
    assert(notYours.status === 403, `expected 403 for somebody else's wish, got ${notYours.status}`);

    const yours = await json(`${road()}/${id}`, { method: 'DELETE', headers: auth(stranger.token) });
    assert(yours.status === 200 && yours.body.data.removed === true, `withdraw ${yours.status}`);
});

await test('the owner prunes anything on the list', async () => {
    const left = await json(road(), {
        method: 'POST', headers: auth(stranger.token), body: JSON.stringify({ what: 'One more idea.' }),
    });
    const id = (left.body.data.roadmap.entries as any[])[0].id;
    const r = await json(`${road()}/${id}`, { method: 'DELETE', headers: auth(owner.token) });
    assert(r.status === 200 && r.body.data.removed === true, `owner prune ${r.status}`);
});

// ── Publishing together ───────────────────────────────────────────────────────────────────────────

await test('once somebody else builds it, a publish with no line is REFUSED', async () => {
    const grant = await json(`/v1/apps/${owner.name}/${APP}/dev-grants/${builder.name}`, {
        method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ level: 'publisher' }),
    });
    assert(grant.status === 200, `grant ${grant.status}`);

    const pub = await publish(owner.token, APP, 'v4');
    assert(pub.status === 400, `expected 400, got ${pub.status}`);
    assert(pub.body.error?.code === 'ROADMAP_REQUIRED', `and it says which gate (got ${pub.body.error?.code})`);
});

await test('the refusal happens before anything is published', async () => {
    const versions = await json(`/v1/apps/${owner.name}/${APP}/versions`, { headers: auth(owner.token) });
    const n = (versions.body.data.versions as any[]).length;
    await publish(owner.token, APP, 'v4 again');
    const after = await json(`/v1/apps/${owner.name}/${APP}/versions`, { headers: auth(owner.token) });
    assert((after.body.data.versions as any[]).length === n, 'no version appeared from a refused publish');
});

await test('the same publish with a line goes through', async () => {
    const pub = await publish(owner.token, APP, 'v4', { roadmap: 'Search remembers the last thing you typed.' });
    assert(pub.status === 200 || pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
});

await test('and the builder publishing into the owner\'s app owes the same line', async () => {
    const bare = await json('/v1/apps', {
        method: 'POST', headers: auth(builder.token),
        body: JSON.stringify({ filename: APP, owner: owner.name, name: 'Roadmap demo', description: 'x', content: html('by the builder') }),
    });
    assert(bare.status === 400, `expected 400, got ${bare.status}`);

    const withLine = await json('/v1/apps', {
        method: 'POST', headers: auth(builder.token),
        body: JSON.stringify({
            filename: APP, owner: owner.name, name: 'Roadmap demo', description: 'x',
            content: html('by the builder'), roadmap: 'The empty state says what to do next.',
        }),
    });
    assert(withLine.status === 200 || withLine.status === 201, `with a line ${withLine.status}: ${JSON.stringify(withLine.body?.error)}`);

    const r = await json(road(), { headers: auth(owner.token) });
    const done = (r.body.data.roadmap.entries as any[]).filter(e => e.state === 'done');
    assert(done[0].what === 'The empty state says what to do next.', 'the owner reads what the builder did');
});

// ── The listing ───────────────────────────────────────────────────────────────────────────────────

await test('the apps you help build are their own answer, never mixed into your own', async () => {
    const own = await json('/v1/apps?own=true', { headers: auth(builder.token) });
    assert(own.status === 200, `own list ${own.status}`);
    assert((own.body.data.apps as any[]).every(a => a.owner === builder.name),
        'the builder\'s own list has only their own apps');

    const building = await json('/v1/apps?building=true', { headers: auth(builder.token) });
    assert(building.status === 200, `building list ${building.status}`);
    const row = (building.body.data.apps as any[]).find(a => a.filename === APP);
    assert(!!row, 'the app they were invited to build is there');
    assert(row.building_for === owner.name, `and it says whose it is (got ${row.building_for})`);
    assert(row.dev_level_name === 'publisher', `and at which rung (got ${row.dev_level_name})`);
});

await test('somebody who builds nothing gets an empty answer, not everybody\'s apps', async () => {
    const r = await json('/v1/apps?building=true', { headers: auth(stranger.token) });
    assert(r.status === 200, `list ${r.status}`);
    assert((r.body.data.apps as any[]).length === 0, `expected nothing, got ${(r.body.data.apps as any[]).length}`);
});

await test('and it needs a signed-in caller', async () => {
    const r = await json('/v1/apps?building=true');
    assert(r.status === 401, `expected 401, got ${r.status}`);
});

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
