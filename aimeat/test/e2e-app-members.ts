/**
 * @file e2e-app-members.ts
 * @description The node-owned member roster: approve, ask, remove, and the three things an app could
 *   never do for itself. Each of those three is asserted as an OBSERVED effect rather than a return
 *   code, because all three failed silently in the app-side versions this replaces: the notification
 *   went to the wrong person, the roster was served to the world, and a removal left free access
 *   behind. A 200 proved none of them.
 * @usage pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-app-members
 * @version-history
 *   v1.0.0 — 2026-07-30 — Initial (TARGET-055 phase 2).
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.AIMEAT_NODE_ID ?? 'aimeat-local-001-dev';

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
    const name = `am${label}${Date.now().toString(36)}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'AM', password: 'AmTest1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1200));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'AM', password: 'AmTest1234' }) });
    }
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const tok = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: name, password: 'AmTest1234' }) });
    assert(tok.status === 200, `login ${tok.status}`);
    return { name, token: tok.body.data.token as string };
}

console.log('\n=== AIMEAT app member roster E2E ===\n');

let owner: Awaited<ReturnType<typeof setupOwner>>;
let member: Awaited<ReturnType<typeof setupOwner>>;
let stranger: Awaited<ReturnType<typeof setupOwner>>;
const APP = 'roster-demo.html';
let appId = '';
const bell = async (t: string) => ((await json('/v1/notifications', { headers: auth(t) })).body.data.notifications as any[]) ?? [];

await test('setup: an owner publishes an app, and two other accounts exist', async () => {
    owner = await setupOwner('own');
    member = await setupOwner('mem');
    stranger = await setupOwner('str');
    appId = `${owner.name}/${APP}`;
    const pub = await json('/v1/apps', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({
            filename: APP, name: 'Roster demo', description: 'roster e2e',
            content: Buffer.from('<!doctype html><title>roster</title><p>hi', 'utf8').toString('base64'),
        }),
    });
    assert(pub.status === 200 || pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
});

await test('the roster starts empty, and only the OWNER may read it', async () => {
    const mine = await json(`/v1/apps/${owner.name}/${APP}/members`, { headers: auth(owner.token) });
    assert(mine.status === 200, `owner read ${mine.status}: ${JSON.stringify(mine.body?.error)}`);
    assert(mine.body.data.members.length === 0, 'a new app carries nobody');

    // Cross-owner (Rule 10): another account must not see who is a member.
    const theirs = await json(`/v1/apps/${owner.name}/${APP}/members`, { headers: auth(stranger.token) });
    assert(theirs.status === 403, `a stranger reading the roster must be refused, got ${theirs.status}`);
});

await test('asking for access notifies the OWNER, which is the direction an extension cannot reach', async () => {
    const before = (await bell(owner.token)).length;
    const ask = await json(`/v1/apps/${owner.name}/${APP}/members/requests`, {
        method: 'POST', headers: auth(member.token),
        body: JSON.stringify({ note: 'I run a pharmacy and need the registry' }),
    });
    assert(ask.status === 201, `ask ${ask.status}: ${JSON.stringify(ask.body?.error)}`);

    const notes = await bell(owner.token);
    const req = notes.filter(n => n.type === 'app_member_request');
    assert(req.length === 1, `the owner is told once, got ${req.length} (bell was ${before})`);
    assert(req[0].title.includes(member.name), `and by whom: ${req[0].title}`);
    assert(req[0].body.includes('pharmacy'), `carrying what they said: ${req[0].body}`);

    // The APPLICANT must not be the one notified — that was the old failure mode exactly.
    const theirs = (await bell(member.token)).filter(n => n.type === 'app_member_request');
    assert(theirs.length === 0, 'the person asking already knows they asked; their own bell stays clean');

    const seen = await json(`/v1/apps/${owner.name}/${APP}/members`, { headers: auth(owner.token) });
    assert(seen.body.data.requests.length === 1, `and it is waiting in the roster: ${JSON.stringify(seen.body.data.requests)}`);
});

await test('approving notifies the MEMBER, and consumes the request', async () => {
    const ok = await json(`/v1/apps/${owner.name}/${APP}/members`, {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ account: member.name, role: 'member', note: 'approved in the panel' }),
    });
    assert(ok.status === 201, `approve ${ok.status}: ${JSON.stringify(ok.body?.error)}`);
    assert(ok.body.data.member.role === 'member', `role recorded: ${JSON.stringify(ok.body.data.member)}`);
    assert(!!ok.body.data.member.since, 'and when it started');

    const notes = (await bell(member.token)).filter(n => n.type === 'app_member_approved');
    assert(notes.length === 1, `the approved person is told once, got ${notes.length}`);

    const roster = await json(`/v1/apps/${owner.name}/${APP}/members`, { headers: auth(owner.token) });
    assert(roster.body.data.members.length === 1, 'one member');
    assert(roster.body.data.requests.length === 0, 'and the ask is gone rather than sitting there answered');
});

await test('a member reads their OWN standing, and an agent of theirs gets the same answer', async () => {
    const mine = await json(`/v1/apps/${owner.name}/${APP}/members/me`, { headers: auth(member.token) });
    assert(mine.status === 200 && mine.body.data.role === 'member', `own standing: ${JSON.stringify(mine.body.data)}`);

    // The row is keyed to the PERSON, so an agent must resolve to it without a second entry.
    const da = await json('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ agent_name: 'hand', owner: member.name }) });
    const v = await json('/v1/agents/verify', { method: 'POST', body: JSON.stringify({ user_code: da.body.data.user_code, action: 'approve', scopes: ['memory:read'], owner_token: member.token }) });
    assert(v.status === 200, `verify ${v.status}`);
    const t = await json('/v1/agents/device-token', { method: 'POST', body: JSON.stringify({ device_code: da.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
    const agentTok = t.body.token as string;

    const asAgent = await json(`/v1/apps/${owner.name}/${APP}/members/me`, { headers: auth(agentTok) });
    assert(asAgent.status === 200, `agent read ${asAgent.status}`);
    assert(asAgent.body.data.role === 'member',
        `the agent of a member IS that member, got ${JSON.stringify(asAgent.body.data.role)}`);
});

await test('a stranger cannot approve, remove, or decline — only the owner decides', async () => {
    const cases: [string, RequestInit][] = [
        [`/v1/apps/${owner.name}/${APP}/members`, { method: 'POST', body: JSON.stringify({ account: stranger.name, role: 'member' }) }],
        [`/v1/apps/${owner.name}/${APP}/members/${member.name}`, { method: 'DELETE' }],
        [`/v1/apps/${owner.name}/${APP}/members/requests/${member.name}`, { method: 'DELETE' }],
    ];
    for (const [path, opts] of cases) {
        const r = await json(path, { ...opts, headers: auth(stranger.token) });
        assert(r.status === 403, `${opts.method} ${path} by a stranger must be 403, got ${r.status}`);
    }
    const roster = await json(`/v1/apps/${owner.name}/${APP}/members`, { headers: auth(owner.token) });
    assert(roster.body.data.members.length === 1, 'and nothing they tried landed');
    assert(roster.body.data.members[0].owner === member.name.toLowerCase(), 'the one real member is untouched');
});

await test('the roster is NOT readable without a token, which is what moving it off ext memory bought', async () => {
    const anon = await json(`/v1/apps/${owner.name}/${APP}/members`);
    assert(anon.status === 401 || anon.status === 403, `anonymous roster read must be refused, got ${anon.status}`);
    // And it is not sitting in a world-readable namespace under some other name either.
    const viaMemory = await json(`/v1/memory/app-member/appmember.${owner.name.toLowerCase()}-roster-demo-html.${member.name.toLowerCase()}`);
    assert(viaMemory.status !== 200, `the record must not be served by the public memory door, got ${viaMemory.status}`);
});

await test('a role change does not re-announce the approval, and keeps the join date', async () => {
    const before = await json(`/v1/apps/${owner.name}/${APP}/members/me`, { headers: auth(member.token) });
    const since = before.body.data.member.since;

    const up = await json(`/v1/apps/${owner.name}/${APP}/members`, {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ account: member.name, role: 'admin' }),
    });
    assert(up.status === 200 && up.body.data.created === false, `a change is not a creation: ${up.status} ${up.body.data.created}`);
    assert(up.body.data.member.role === 'admin', 'the new role is recorded');
    assert(up.body.data.member.since === since, `and the join date survives it: ${up.body.data.member.since} vs ${since}`);

    const notes = (await bell(member.token)).filter(n => n.type === 'app_member_approved');
    assert(notes.length === 1, `promoting is not being approved again, got ${notes.length} approval bells`);
});

await test('removing tells them, and takes them off the list', async () => {
    const gone = await json(`/v1/apps/${owner.name}/${APP}/members/${member.name}`, { method: 'DELETE', headers: auth(owner.token) });
    assert(gone.status === 200, `remove ${gone.status}: ${JSON.stringify(gone.body?.error)}`);

    const notes = (await bell(member.token)).filter(n => n.type === 'app_member_revoked');
    assert(notes.length === 1, `the removed person is told, got ${notes.length}`);

    const roster = await json(`/v1/apps/${owner.name}/${APP}/members`, { headers: auth(owner.token) });
    assert(roster.body.data.members.length === 0, 'and the roster is empty again');

    const mine = await json(`/v1/apps/${owner.name}/${APP}/members/me`, { headers: auth(member.token) });
    assert(mine.body.data.role === null, `their own standing reflects it too: ${JSON.stringify(mine.body.data.role)}`);

    const twice = await json(`/v1/apps/${owner.name}/${APP}/members/${member.name}`, { method: 'DELETE', headers: auth(owner.token) });
    assert(twice.status === 404, `removing nobody is a 404 rather than a cheerful 200, got ${twice.status}`);
});

await test('the owner is not a member of their own app, and cannot ask to be', async () => {
    const self = await json(`/v1/apps/${owner.name}/${APP}/members`, {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ account: owner.name, role: 'admin' }),
    });
    assert(self.status === 400, `a row for the owner is refused rather than kept in step forever, got ${self.status}`);

    const ask = await json(`/v1/apps/${owner.name}/${APP}/members/requests`, { method: 'POST', headers: auth(owner.token), body: JSON.stringify({}) });
    assert(ask.status === 400, `and they have nobody to ask, got ${ask.status}`);

    const me = await json(`/v1/apps/${owner.name}/${APP}/members/me`, { headers: auth(owner.token) });
    assert(me.body.data.isOwner === true && me.body.data.role === 'owner', `but they read as the owner: ${JSON.stringify(me.body.data)}`);
});

console.log(`\napp member roster E2E: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);
