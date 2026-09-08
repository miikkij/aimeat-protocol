/**
 * @file e2e-app-dev-grant.ts
 * @description The development right: the owner saying who, other than themselves, may build one of
 *   their apps: the grant, the refusals around it, and the rung actually reaching their catalogue.
 *
 *   The last group is the point of the file: a rung actually reaching somebody else's catalogue, and
 *   every edge around it. A publish that names an owner lands in THEIR bucket and not the caller's,
 *   a rung that stops short is refused with the rung it holds named, the price is refused whatever
 *   the rung, and a revoked right stops the next call. The owner publishing their own app is
 *   asserted in the same group, because that is the path every other app on the node still takes.
 * @usage pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-app-dev-grant
 * @version-history
 *   v1.1.0 — 2026-09-08 — Phase 3: the doors accept a target owner, so the suite stops asserting
 *     that the right reaches nothing and starts asserting what it reaches.
 *   v1.0.0 — 2026-09-08 — Initial.
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
    const name = `dg${label}${Date.now().toString(36)}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'DG', password: 'DgTest1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1200));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'DG', password: 'DgTest1234' }) });
    }
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const tok = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: name, password: 'DgTest1234' }) });
    assert(tok.status === 200, `login ${tok.status}`);
    return { name, token: tok.body.data.token as string };
}

const html = (s: string) => Buffer.from(`<!doctype html><meta name="viewport" content="width=device-width"><h1>${s}</h1>`).toString('base64');

async function publish(token: string, filename: string, body: string, extra: Record<string, unknown> = {}) {
    return json('/v1/apps', {
        method: 'POST', headers: auth(token),
        body: JSON.stringify({ filename, name: 'Dev grant demo', description: 'dev grant e2e', content: html(body), ...extra }),
    });
}

console.log('\n=== AIMEAT app development right E2E ===\n');

let owner: Awaited<ReturnType<typeof setupOwner>>;
let builder: Awaited<ReturnType<typeof setupOwner>>;
let stranger: Awaited<ReturnType<typeof setupOwner>>;
const APP = 'devgrant-demo.html';
const grantPath = (o: string, who: string) => `/v1/apps/${o}/${APP}/dev-grants/${who}`;

await test('setup: an owner publishes an app; two other accounts exist', async () => {
    owner = await setupOwner('own');
    builder = await setupOwner('bld');
    stranger = await setupOwner('str');
    const pub = await publish(owner.token, APP, 'v1');
    assert(pub.status === 200 || pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
});

// ── Giving it ─────────────────────────────────────────────────────────────────────────────────────

await test('the owner invites somebody to build the app', async () => {
    const r = await json(grantPath(owner.name, builder.name), {
        method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ level: 'publisher' }),
    });
    assert(r.status === 200, `grant ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(r.body.data.level === 10, `publisher is rung 10 (got ${r.body.data.level})`);
    assert(r.body.data.carries.includes('publish'), 'a publisher may publish');
    assert(!r.body.data.carries.includes('operate'), 'and may not touch how the app is offered');
});

await test('the roster of builders names them, and says what no rung ever carries', async () => {
    const r = await json(`/v1/apps/${owner.name}/${APP}/dev-grants`, { headers: auth(owner.token) });
    assert(r.status === 200, `list ${r.status}`);
    assert(r.body.data.grants.length === 1, `one builder (got ${r.body.data.grants.length})`);
    assert(r.body.data.grants[0].account === builder.name, 'and it is the one who was invited');
    assert(r.body.data.levels.length === 3, 'the three rungs are published rather than hardcoded by clients');
    assert(Array.isArray(r.body.data.never) && r.body.data.never.length === 3,
        'and the three acts no rung carries are named out loud');
});

await test('the person invited is told, in words that say what they may do', async () => {
    const bell = (await json('/v1/notifications', { headers: auth(builder.token) })).body.data.notifications as any[];
    const note = (bell ?? []).find(n => n.type === 'app_dev_grant');
    assert(!!note, 'the builder has a notification about it');
    assert(String(note.body).includes('publish'), `it says what they may do (got "${note.body}")`);
});

// ── Refusing it ───────────────────────────────────────────────────────────────────────────────────

await test('a stranger cannot see who may build somebody else\'s app', async () => {
    const r = await json(`/v1/apps/${owner.name}/${APP}/dev-grants`, { headers: auth(stranger.token) });
    assert(r.status === 403, `expected 403, got ${r.status}`);
});

await test('a stranger cannot invite anybody to build it either', async () => {
    const r = await json(grantPath(owner.name, stranger.name), {
        method: 'PUT', headers: auth(stranger.token), body: JSON.stringify({ level: 'full' }),
    });
    assert(r.status === 403, `expected 403, got ${r.status}`);
    const after = await json(`/v1/apps/${owner.name}/${APP}/dev-grants`, { headers: auth(owner.token) });
    assert(after.body.data.grants.length === 1, 'and nothing was written by the attempt');
});

await test('a builder cannot pass the right on to somebody else', async () => {
    // The one act that would turn a grant into a key nobody can trace. A builder is not the owner,
    // so the same refusal covers it: there is no rung that admits this door.
    const r = await json(grantPath(owner.name, stranger.name), {
        method: 'PUT', headers: auth(builder.token), body: JSON.stringify({ level: 'drafter' }),
    });
    assert(r.status === 403, `expected 403, got ${r.status}`);
});

await test('a name nobody answers to is refused rather than stored', async () => {
    const r = await json(grantPath(owner.name, 'nobodyhere9999'), {
        method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ level: 'full' }),
    });
    assert(r.status === 404, `expected 404, got ${r.status}`);
});

await test('so is a grant on an app that does not exist', async () => {
    const r = await json(`/v1/apps/${owner.name}/no-such-app.html/dev-grants/${builder.name}`, {
        method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ level: 'full' }),
    });
    assert(r.status === 404, `expected 404, got ${r.status}`);
});

await test('a rung that is not a rung is refused, and the answer names the real ones', async () => {
    const r = await json(grantPath(owner.name, builder.name), {
        method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ level: 'owner' }),
    });
    assert(r.status === 400, `expected 400, got ${r.status}`);
    assert(String(r.body.error?.message).includes('full'), 'the refusal names the levels that exist');
});

await test('the owner cannot grant it to themselves', async () => {
    const r = await json(grantPath(owner.name, owner.name), {
        method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ level: 'full' }),
    });
    assert(r.status === 400, `expected 400, got ${r.status}`);
});

// ── Across every app ──────────────────────────────────────────────────────────────────────────────

await test('an owner can open all their apps to one person, in one place', async () => {
    const r = await json(`/v1/app-dev-grants/${builder.name}`, {
        method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ level: 'drafter' }),
    });
    assert(r.status === 200, `blanket grant ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const list = await json('/v1/app-dev-grants', { headers: auth(owner.token) });
    assert(list.status === 200, `blanket list ${list.status}`);
    assert(list.body.data.grants.length === 1, `one blanket grant (got ${list.body.data.grants.length})`);
    assert(list.body.data.grants[0].grantee === builder.name, 'and it names the right person');
});

await test('somebody else\'s blanket list is their own, never yours', async () => {
    const list = await json('/v1/app-dev-grants', { headers: auth(builder.token) });
    assert(list.status === 200, `list ${list.status}`);
    // The builder HOLDS a grant; they have GIVEN none. This door answers what you have given.
    assert(list.body.data.grants.length === 0, `nothing given by the builder (got ${list.body.data.grants.length})`);
});

await test('and it can be taken back in one act', async () => {
    const r = await json(`/v1/app-dev-grants/${builder.name}`, { method: 'DELETE', headers: auth(owner.token) });
    assert(r.status === 200 && r.body.data.revoked === true, `revoke ${r.status}`);
    const list = await json('/v1/app-dev-grants', { headers: auth(owner.token) });
    assert(list.body.data.grants.length === 0, 'the list is empty afterwards');
});

// ── Taking it back ────────────────────────────────────────────────────────────────────────────────

await test('the right comes off without taking the membership with it', async () => {
    // The person is made an ordinary member first, so the revoke has something to leave behind.
    const m = await json(`/v1/apps/${owner.name}/${APP}/members`, {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ account: builder.name, role: 'subscriber' }),
    });
    assert(m.status === 200 || m.status === 201, `approve ${m.status}: ${JSON.stringify(m.body?.error)}`);

    const r = await json(grantPath(owner.name, builder.name), { method: 'DELETE', headers: auth(owner.token) });
    assert(r.status === 200 && r.body.data.revoked === true, `revoke ${r.status}`);

    const grants = await json(`/v1/apps/${owner.name}/${APP}/dev-grants`, { headers: auth(owner.token) });
    assert(grants.body.data.grants.length === 0, 'nobody may build it now');
    const roster = await json(`/v1/apps/${owner.name}/${APP}/members`, { headers: auth(owner.token) });
    const still = (roster.body.data.members as any[]).find(x => x.owner === builder.name);
    assert(!!still && still.role === 'subscriber', 'and they are still a member of it');
});

await test('a role change at the roster door does not quietly revoke the right', async () => {
    await json(grantPath(owner.name, builder.name), {
        method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ level: 'full' }),
    });
    const m = await json(`/v1/apps/${owner.name}/${APP}/members`, {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ account: builder.name, role: 'editor' }),
    });
    assert(m.status === 200 || m.status === 201, `role change ${m.status}`);
    const grants = await json(`/v1/apps/${owner.name}/${APP}/dev-grants`, { headers: auth(owner.token) });
    assert(grants.body.data.grants.length === 1, 'the right is still there after the role changed');
    assert(grants.body.data.grants[0].levelName === 'full', 'and it is still the rung that was given');
});

// -- Building somebody else's app ------------------------------------------------------------------

await test('the owner still publishes their own app exactly as before', async () => {
    const before = await json(`/v1/apps/${owner.name}/${APP}/versions`, { headers: auth(owner.token) });
    const n = (before.body.data.versions as any[]).length;
    const pub = await publish(owner.token, APP, 'v2', { roadmap: 'A second version, for the version count.' });
    assert(pub.status === 200 || pub.status === 201, `re-publish ${pub.status}`);
    const after = await json(`/v1/apps/${owner.name}/${APP}/versions`, { headers: auth(owner.token) });
    assert((after.body.data.versions as any[]).length === n + 1, "a version was added to the owner's own app");
});

await test("a full right publishes INTO the owner's catalogue, not the builder's own", async () => {
    const before = await json(`/v1/apps/${owner.name}/${APP}/versions`, { headers: auth(owner.token) });
    const n = (before.body.data.versions as any[]).length;

    const pub = await json('/v1/apps', {
        method: 'POST', headers: auth(builder.token),
        body: JSON.stringify({
            filename: APP, owner: owner.name, name: 'Dev grant demo',
            description: 'published by the builder', content: html('from the builder'),
            roadmap: 'The builder published this one.',
        }),
    });
    assert(pub.status === 200 || pub.status === 201, `delegated publish ${pub.status}: ${JSON.stringify(pub.body?.error)}`);

    const after = await json(`/v1/apps/${owner.name}/${APP}/versions`, { headers: auth(owner.token) });
    assert((after.body.data.versions as any[]).length === n + 1, "the OWNER's app gained the version");
    const mine = await json(`/v1/apps/${builder.name}/${APP}`, {});
    assert(mine.status === 404, `and nothing landed in the builder's own catalogue (got ${mine.status})`);
});

await test("the builder writes the owner's draft through the path that names them", async () => {
    const w = await json(`/v1/apps/${owner.name}/${APP}/draft/write`, {
        method: 'POST', headers: auth(builder.token),
        body: JSON.stringify({ content: '<p>a line from the builder</p>', mode: 'append' }),
    });
    assert(w.status === 200, `draft write ${w.status}: ${JSON.stringify(w.body?.error)}`);
    const read = await json(`/v1/apps/${owner.name}/${APP}/draft`, { headers: auth(owner.token) });
    assert(read.status === 200, 'and the owner can read the draft that resulted');
});

await test('a stranger with no right is refused, and the app is untouched', async () => {
    const before = await json(`/v1/apps/${owner.name}/${APP}/versions`, { headers: auth(owner.token) });
    const n = (before.body.data.versions as any[]).length;
    const pub = await json('/v1/apps', {
        method: 'POST', headers: auth(stranger.token),
        body: JSON.stringify({ filename: APP, owner: owner.name, name: 'x', description: 'x', content: html('nope') }),
    });
    assert(pub.status === 403, `expected 403, got ${pub.status}`);
    const after = await json(`/v1/apps/${owner.name}/${APP}/versions`, { headers: auth(owner.token) });
    assert((after.body.data.versions as any[]).length === n, 'no version was added by the attempt');
});

await test('a name nobody answers to is a 404, not a new catalogue', async () => {
    const pub = await json('/v1/apps', {
        method: 'POST', headers: auth(builder.token),
        body: JSON.stringify({ filename: APP, owner: 'nobodyhere9999', name: 'x', description: 'x', content: html('nope') }),
    });
    assert(pub.status === 404, `expected 404, got ${pub.status}`);
});

await test('a drafter may write the draft and may not publish it', async () => {
    const set = await json(grantPath(owner.name, builder.name), {
        method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ level: 'drafter' }),
    });
    assert(set.status === 200, `narrow to drafter ${set.status}`);

    const w = await json(`/v1/apps/${owner.name}/${APP}/draft/write`, {
        method: 'POST', headers: auth(builder.token),
        body: JSON.stringify({ content: '<p>still allowed</p>', mode: 'append' }),
    });
    assert(w.status === 200, `draft write ${w.status}`);

    const pub = await json(`/v1/apps/${owner.name}/${APP}/publish-draft`, {
        method: 'POST', headers: auth(builder.token), body: JSON.stringify({}),
    });
    assert(pub.status === 403, `expected 403 on publish-draft, got ${pub.status}`);
    assert(String(pub.body.error?.message).includes('drafter'), 'and the refusal names the rung they hold');
});

await test('no rung carries what the app costs', async () => {
    await json(grantPath(owner.name, builder.name), {
        method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ level: 'full' }),
    });
    const pub = await json('/v1/apps', {
        method: 'POST', headers: auth(builder.token),
        body: JSON.stringify({
            filename: APP, owner: owner.name, name: 'Dev grant demo', description: 'x',
            content: html('priced'), price_morsels: 500,
        }),
    });
    assert(pub.status === 403, `expected 403, got ${pub.status}`);
    assert(String(pub.body.error?.message).toLowerCase().includes('price'), 'and it says why');
});

await test('a publisher may not touch how the app is offered', async () => {
    await json(grantPath(owner.name, builder.name), {
        method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ level: 'publisher' }),
    });
    // `parked` is not presentation: it decides whether anybody can reach the app at all.
    const patch = await json(`/v1/apps/${APP}`, {
        method: 'PATCH', headers: auth(builder.token),
        body: JSON.stringify({ owner: owner.name, parked: true }),
    });
    assert(patch.status === 403, `expected 403, got ${patch.status}`);

    const rename = await json(`/v1/apps/${APP}`, {
        method: 'PATCH', headers: auth(builder.token),
        body: JSON.stringify({ owner: owner.name, description: 'renamed by the builder' }),
    });
    assert(rename.status === 200, `but a description IS presentation (got ${rename.status})`);
});

await test('taking the right back stops the next publish', async () => {
    const r = await json(grantPath(owner.name, builder.name), { method: 'DELETE', headers: auth(owner.token) });
    assert(r.status === 200, `revoke ${r.status}`);
    const pub = await json('/v1/apps', {
        method: 'POST', headers: auth(builder.token),
        body: JSON.stringify({ filename: APP, owner: owner.name, name: 'x', description: 'x', content: html('after revoke') }),
    });
    assert(pub.status === 403, `expected 403 after revoke, got ${pub.status}`);
});

await test('a blanket right reaches an app that has no roster row of its own', async () => {
    const OTHER = 'devgrant-second.html';
    const made = await publish(owner.token, OTHER, 'second app');
    assert(made.status === 200 || made.status === 201, `publish second app ${made.status}`);

    const before = await json(`/v1/apps/${owner.name}/${OTHER}/versions`, { headers: auth(owner.token) });
    const n = (before.body.data.versions as any[]).length;

    await json(`/v1/app-dev-grants/${builder.name}`, {
        method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ level: 'publisher' }),
    });
    const pub = await json('/v1/apps', {
        method: 'POST', headers: auth(builder.token),
        body: JSON.stringify({
            filename: OTHER, owner: owner.name, name: 'Second', description: 'x',
            content: html('blanket'), roadmap: 'Reached through the blanket right.',
        }),
    });
    assert(pub.status === 200 || pub.status === 201, `blanket publish ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
    const after = await json(`/v1/apps/${owner.name}/${OTHER}/versions`, { headers: auth(owner.token) });
    assert((after.body.data.versions as any[]).length === n + 1, "the owner's second app gained the version");
});

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
