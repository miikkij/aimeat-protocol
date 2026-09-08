/**
 * @file e2e-app-dev-grant.ts
 * @description The development right: the owner saying who, other than themselves, may build one of
 *   their apps. Phase 1 and 2 of the shared-app work, so what is asserted here is the GRANT and the
 *   refusals around it, plus one thing that has to still be true afterwards.
 *
 *   The last group is the point of the file. Nothing about where an app write LANDS is meant to have
 *   changed yet: both doors now ask one function instead of two copies, and with nobody else's app
 *   named the answer has to be the caller's own bucket, exactly as before. A holder of a full
 *   development right publishing today still lands in their OWN catalogue, because no door accepts a
 *   target owner yet. That assertion is what makes the next phase a change rather than a discovery.
 * @usage pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-app-dev-grant
 * @version-history
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

async function publish(token: string, filename: string, body: string) {
    return json('/v1/apps', {
        method: 'POST', headers: auth(token),
        body: JSON.stringify({ filename, name: 'Dev grant demo', description: 'dev grant e2e', content: html(body) }),
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

// ── What must NOT have changed yet ────────────────────────────────────────────────────────────────

await test('the owner still publishes their own app exactly as before', async () => {
    const before = await json(`/v1/apps/${owner.name}/${APP}/versions`, { headers: auth(owner.token) });
    const n = (before.body.data.versions as any[]).length;
    const pub = await publish(owner.token, APP, 'v2');
    assert(pub.status === 200 || pub.status === 201, `re-publish ${pub.status}`);
    const after = await json(`/v1/apps/${owner.name}/${APP}/versions`, { headers: auth(owner.token) });
    assert((after.body.data.versions as any[]).length === n + 1, 'a version was added to the owner\'s own app');
});

await test('a full development right does not yet reach the other owner\'s catalogue', async () => {
    // Phase 3 is what opens the doors to a named target owner. Until then a holder publishing the
    // same filename is publishing THEIR OWN app, and the assertion exists so that turning phase 3 on
    // is a visible change here rather than something discovered in production.
    const ownerBefore = await json(`/v1/apps/${owner.name}/${APP}/versions`, { headers: auth(owner.token) });
    const n = (ownerBefore.body.data.versions as any[]).length;

    const pub = await publish(builder.token, APP, 'from the builder');
    assert(pub.status === 200 || pub.status === 201, `builder publish ${pub.status}`);

    const mine = await json(`/v1/apps/${builder.name}/${APP}/versions`, { headers: auth(builder.token) });
    assert(mine.status === 200, 'it landed in the builder\'s own catalogue');
    const ownerAfter = await json(`/v1/apps/${owner.name}/${APP}/versions`, { headers: auth(owner.token) });
    assert((ownerAfter.body.data.versions as any[]).length === n, 'and the owner\'s app was untouched');
});

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
