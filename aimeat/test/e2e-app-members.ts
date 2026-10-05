/**
 * @file e2e-app-members.ts
 * @description The node-owned member roster: approve, ask, remove, and the three things an app could
 *   never do for itself. Each of those three is asserted as an OBSERVED effect rather than a return
 *   code, because all three failed silently in the app-side versions this replaces: the notification
 *   went to the wrong person, the roster was served to the world, and a removal left free access
 *   behind. A 200 proved none of them.
 * @usage pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-app-members
 * @version-history
 *   v1.2.0 — 2026-10-01 — IAM round 2: display names on every row and on /me, approve by email
 *     (found, invited, cancelled, and an invited address that gets a verified account), a role change
 *     told to the member in their own language, paging and search, managers and what they may not
 *     touch, the audit trail, the 7-day wait after a decline, and the app's own token setting the plan.
 *   v1.1.0 — 2026-10-01 — The roster from a chat: aimeat_app_manage's member actions on the node MCP
 *     server, with the route's permission words and the owner test, and member_me and member_request
 *     for somebody else's app.
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


// ── the role and the free access change together ────────────────────────────────────────────────
// Approving somebody without the grants underneath is a sentence with nothing behind it: the role
// opens the tabs and the first data call answers 402. Every app that sold anything wrote this loop
// itself, had to be right twice (promotion AND demotion), and one of them ran it from the browser.

let ext = '';
const OFFER_A = 'alpha', OFFER_B = 'beta';
let offA = '', offB = '';

await test('setup: the owner lists two priced capabilities', async () => {
    // An EXCHANGE listing is a projection of the app's TOOL manifest, not of a priced extension
    // action, so the fixture has to declare the tools the way a real app does.
    ext = `rosterext${Date.now().toString(36)}`;
    const manifest = [
        'metadata:', `  name: ${ext}`, '  version: 1.0.0', '  description: roster sync fixture', '  author: t',
        // Naming the app is what lets the node resolve the caller against its roster BEFORE the
        // paywall settles. Without it there is no roster to consult and `members-only` cannot apply.
        'config:', '  app:', '    type: string', `    default: ${owner.name}/${APP}`,
        'required_apis:', '  - memory', 'actions:',
        `  - id: ${OFFER_A}`, '    method: POST', `    path: /${OFFER_A}`,
        '    input: { type: object }', '    output: { type: object }', `    script: ${OFFER_A}.js`,
        `  - id: ${OFFER_B}`, '    method: POST', `    path: /${OFFER_B}`,
        '    input: { type: object }', '    output: { type: object }', `    script: ${OFFER_B}.js`,
    ].join('\n');
    const scripts = {
        [`${OFFER_A}.js`]: 'export default async function () { return { ok: true }; }',
        [`${OFFER_B}.js`]: 'export default async function () { return { ok: true }; }',
    };
    const inst = await json('/v1/extensions', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ manifest, scripts }) });
    assert(inst.status === 200 || inst.status === 201, `install ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
    assert((await json(`/v1/extensions/${ext}/activate`, { method: 'POST', headers: auth(owner.token), body: '{}' })).status === 200, 'activate');

    const schema = { type: 'object', properties: { q: { type: 'string' } } };
    const tools = [
        { name: OFFER_A, description: 'first', action_id: `ext:${ext}:${OFFER_A}`, inputSchema: schema, outputSchema: schema, price: { morsels: 5 }, exchange: true },
        { name: OFFER_B, description: 'second', action_id: `ext:${ext}:${OFFER_B}`, inputSchema: schema, outputSchema: schema, price: { morsels: 7 }, exchange: true },
    ];
    const put = await json('/v1/memory', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ key: `apps.${APP}.tools`, visibility: 'public', value: { version: 1, tools } }),
    });
    assert(put.status === 200 || put.status === 201, `tool manifest ${put.status}: ${JSON.stringify(put.body?.error)}`);

    const listed = await json('/v1/exchange/offerings', { headers: auth(owner.token) });
    const mine = (listed.body.data.offerings as any[]).filter(o => o.providerOwner === owner.name);
    offA = mine.find(o => o.action === OFFER_A)?.offeringId ?? '';
    offB = mine.find(o => o.action === OFFER_B)?.offeringId ?? '';
    assert(!!offA && !!offB, `both are listed: ${JSON.stringify(mine.map(o => o.action))}`);
});

const carried = async (account: string) => {
    const r = await json(`/v1/exchange/grants?app_id=${encodeURIComponent(appId)}`, { headers: auth(owner.token) });
    // The view names these `consumer_gaii` and `state`; reading `consumer`/`status` finds nothing
    // and would have made a working sync look broken.
    return ((r.body.data.grants as any[]) ?? []).filter(g => String(g.consumer_gaii).toLowerCase().includes(account.toLowerCase()) && g.state === 'active');
};

await test('approving with offerings carries them, and says so rather than answering a bare ok', async () => {
    const ok = await json(`/v1/apps/${owner.name}/${APP}/members`, {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ account: member.name, role: 'member', offerings: [offA, offB] }),
    });
    assert(ok.status === 201, `approve ${ok.status}: ${JSON.stringify(ok.body?.error)}`);
    const acc = ok.body.data.access;
    assert(!!acc, 'the answer reports what access actually happened');
    assert(acc.granted.length === 2, `both listings carried: ${JSON.stringify(acc)}`);
    assert(acc.failed.length === 0, `and nothing failed quietly: ${JSON.stringify(acc.failed)}`);
    assert((await carried(member.name)).length === 2, 'the node agrees two grants are live');
});

await test('a demotion WITHDRAWS what the smaller role no longer covers, in the same call', async () => {
    const down = await json(`/v1/apps/${owner.name}/${APP}/members`, {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ account: member.name, role: 'reader', offerings: [offA] }),
    });
    assert(down.status === 200, `demote ${down.status}: ${JSON.stringify(down.body?.error)}`);
    const acc = down.body.data.access;
    assert(acc.revoked.length === 1, `the dropped listing is withdrawn: ${JSON.stringify(acc)}`);
    assert(acc.unchanged.length === 1, 'and the kept one is left alone rather than churned');
    assert(acc.granted.length === 0, 'nothing new was issued');
    const live = await carried(member.name);
    assert(live.length === 1, `one grant remains, got ${live.length}`);
});

await test('an offering that does not exist is REPORTED, not skipped', async () => {
    // A listing id the node has never heard of must not be silently dropped from the promise.
    const r = await json(`/v1/apps/${owner.name}/${APP}/members`, {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ account: member.name, role: 'reader', offerings: [offA, 'off-does-not-exist'] }),
    });
    assert(r.status === 200, `approve ${r.status}`);
    const acc = r.body.data.access;
    assert(acc.failed.length === 1, `the bad one is named: ${JSON.stringify(acc.failed)}`);
    assert(acc.failed[0].offeringId === 'off-does-not-exist', 'by id');
    assert(acc.unchanged.length === 1, 'and the good one still stands');
});

/** A second provider with a real listed offering of their own, so "not yours" is testable. */
async function providerWithOffering(label: string): Promise<{ owner: Awaited<ReturnType<typeof setupOwner>>; offeringId: string }> {
    const them = await setupOwner(label);
    const theirExt = `otherext${Date.now().toString(36)}`;
    const action = 'theirtool';
    const manifest = [
        'metadata:', `  name: ${theirExt}`, '  version: 1.0.0', '  description: other provider fixture', '  author: t',
        'required_apis:', '  - memory', 'actions:',
        `  - id: ${action}`, '    method: POST', `    path: /${action}`,
        '    input: { type: object }', '    output: { type: object }', `    script: ${action}.js`,
    ].join('\n');
    const inst = await json('/v1/extensions', {
        method: 'POST', headers: auth(them.token),
        body: JSON.stringify({ manifest, scripts: { [`${action}.js`]: 'export default async function () { return { ok: true }; }' } }),
    });
    assert(inst.status === 200 || inst.status === 201, `their install ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
    assert((await json(`/v1/extensions/${theirExt}/activate`, { method: 'POST', headers: auth(them.token), body: '{}' })).status === 200, 'their activate');

    const schema = { type: 'object', properties: { q: { type: 'string' } } };
    const theirApp = `otherapp${Date.now().toString(36)}.html`;
    const put = await json('/v1/memory', {
        method: 'POST', headers: auth(them.token),
        body: JSON.stringify({
            key: `apps.${theirApp}.tools`, visibility: 'public',
            value: { version: 1, tools: [{ name: action, description: 'theirs', action_id: `ext:${theirExt}:${action}`, inputSchema: schema, outputSchema: schema, price: { morsels: 9 }, exchange: true }] },
        }),
    });
    assert(put.status === 200 || put.status === 201, `their manifest ${put.status}: ${JSON.stringify(put.body?.error)}`);

    const listed = await json('/v1/exchange/offerings', { headers: auth(them.token) });
    const theirs = (listed.body.data.offerings as any[]).find(o => o.providerOwner === them.name && o.action === action);
    assert(!!theirs, `their offering is listed: ${JSON.stringify((listed.body.data.offerings as any[]).map(o => `${o.providerOwner}/${o.action}`))}`);
    return { owner: them, offeringId: theirs.offeringId };
}

await test('an offering that belongs to ANOTHER PROVIDER is refused, not carried on their tab', async () => {
    // The test above passes a nonexistent id, which hits the "no such listed offering" branch. The
    // cross-provider branch — `o.providerOwner !== input.providerOwner` in services/grant-sync.ts —
    // was exercised by nothing: this file registered a second owner for it and then never used them
    // (`void theirs`). Delete that comparison and an app owner approves a member onto ANOTHER
    // provider's listing; issueGrant runs with the REAL provider's ghii, so the member calls free on
    // a stranger's tab. The old test still sees failed.length === 1 from the nonexistent id and
    // passes.
    const other = await providerWithOffering('xprov');
    // A fresh account, so the carry state of `member` — which the next test reads — is untouched.
    const newbie = await setupOwner('xmem');

    const r = await json(`/v1/apps/${owner.name}/${APP}/members`, {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ account: newbie.name, role: 'reader', offerings: [other.offeringId] }),
    });
    // 201: this is the account's FIRST approval, so the roster row is created rather than updated.
    assert(r.status === 201, `approve ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const acc = r.body.data.access;
    assert((acc.granted ?? []).every((g: any) => g.offeringId !== other.offeringId),
        `the app owner carried a member onto another provider's listing: ${JSON.stringify(acc.granted)}`);
    assert((acc.failed ?? []).some((f: any) => f.offeringId === other.offeringId),
        `and it was not even reported: ${JSON.stringify(acc)}`);

    // And no grant exists against the other provider, which is where the bill would have landed.
    const theirGrants = await json('/v1/exchange/grants', { headers: auth(other.owner.token) });
    const rows = (theirGrants.body.data?.grants ?? theirGrants.body.data?.entitlements ?? []) as any[];
    assert(!rows.some(g => g.consumer_gaii === `${newbie.name}@${NODE_ID}` || g.consumerGaii === `${newbie.name}@${NODE_ID}`),
        `a grant was issued on the other provider's account: ${JSON.stringify(rows.slice(0, 3))}`);
});

await test('removing the member takes the carried access with them', async () => {
    assert((await carried(member.name)).length === 1, 'they are carried before the removal');
    const gone = await json(`/v1/apps/${owner.name}/${APP}/members/${member.name}`, { method: 'DELETE', headers: auth(owner.token) });
    assert(gone.status === 200, `remove ${gone.status}`);
    const live = await carried(member.name);
    assert(live.length === 0,
        `a removed member must not keep calling free on the owner's tab, ${live.length} grant(s) survived`);
});


// ── the extension gate reads the node roster, without the roster leaving the node ───────────────
// A gate needs the role. The roster is private and must stay that way, so the node resolves the
// caller BEFORE the sandbox starts and hands the answer in. The extension keeps only the capability
// vocabulary, which is the half that is genuinely per-app.

let gateExt = '';

await test('setup: an extension declares which app it gates', async () => {
    gateExt = `gate${Date.now().toString(36)}`;
    const manifest = [
        'metadata:', `  name: ${gateExt}`, '  version: 1.0.0', '  description: reads the node roster', '  author: t',
        'config:', `  app:`, '    type: string', `    default: ${appId}`,
        'required_apis:', '  - memory', 'actions:',
        '  - id: whoami', '    method: POST', '    path: /whoami',
        '    input: { type: object }', '    output: { type: object }', '    script: whoami.js',
    ].join('\n');
    // The gate keeps the vocabulary and reads the ROLE from the caller the node resolved.
    const scripts = {
        'whoami.js': [
            'const CAPS = { member: ["read"], admin: ["read", "write"] };',
            'export default async function (ctx) {',
            '  const m = ctx.caller && ctx.caller.member;',
            '  const role = (ctx.caller && ctx.caller.isAppOwner) ? "owner" : (m ? m.role : null);',
            '  const caps = role === "owner" ? ["*"] : (CAPS[role] || []);',
            '  return { role: role, caps: caps, since: m ? m.since : null, isAppOwner: !!(ctx.caller && ctx.caller.isAppOwner) };',
            '}',
        ].join('\n'),
    };
    const inst = await json('/v1/extensions', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ manifest, scripts }) });
    assert(inst.status === 200 || inst.status === 201, `install ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
    assert((await json(`/v1/extensions/${gateExt}/activate`, { method: 'POST', headers: auth(owner.token), body: '{}' })).status === 200, 'activate');
});

const whoami = async (token: string) => (await json(`/v1/ext/${gateExt}/whoami`, { method: 'POST', headers: auth(token), body: '{}' })).body.data;

await test('a stranger gets no role, and the roster never left the node to tell them so', async () => {
    const r = await whoami(stranger.token);
    assert(r.role === null, `a stranger holds nothing: ${JSON.stringify(r)}`);
    assert(r.caps.length === 0, 'and reaches nothing');
});

await test('an approved member is seen by the gate, with the role the OWNER set', async () => {
    const ok = await json(`/v1/apps/${owner.name}/${APP}/members`, {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ account: stranger.name, role: 'member' }),
    });
    assert(ok.status === 201, `approve ${ok.status}: ${JSON.stringify(ok.body?.error)}`);

    const r = await whoami(stranger.token);
    assert(r.role === 'member', `the gate sees the role the node holds: ${JSON.stringify(r)}`);
    assert(r.caps.includes('read'), `and maps it to its OWN vocabulary: ${JSON.stringify(r.caps)}`);
    assert(!!r.since, 'carrying when it started');
});

await test('the member\'s AGENT is that member inside the sandbox too', async () => {
    const da = await json('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ agent_name: 'gatebot', owner: stranger.name }) });
    const v = await json('/v1/agents/verify', { method: 'POST', body: JSON.stringify({ user_code: da.body.data.user_code, action: 'approve', scopes: ['memory:read'], owner_token: stranger.token }) });
    assert(v.status === 200, `verify ${v.status}`);
    const t = await json('/v1/agents/device-token', { method: 'POST', body: JSON.stringify({ device_code: da.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });

    const r = await whoami(t.body.token as string);
    assert(r.role === 'member',
        `the agent of a member resolves to its human's row, with no second entry: ${JSON.stringify(r)}`);
});

await test('the app OWNER is seen as the owner, not as a member of their own app', async () => {
    const r = await whoami(owner.token);
    assert(r.isAppOwner === true, `the owner is recognised: ${JSON.stringify(r)}`);
    assert(r.role === 'owner' && r.caps.includes('*'), 'and reaches everything without a roster row');
});

await test('removing the member is visible to the gate on the very next call', async () => {
    const gone = await json(`/v1/apps/${owner.name}/${APP}/members/${stranger.name}`, { method: 'DELETE', headers: auth(owner.token) });
    assert(gone.status === 200, `remove ${gone.status}`);
    const r = await whoami(stranger.token);
    assert(r.role === null && r.caps.length === 0,
        `a removed member is refused immediately rather than until some cache expires: ${JSON.stringify(r)}`);
});

await test('an extension that declares NO app is unaffected, and keeps whatever it already did', async () => {
    const plain = `plain${Date.now().toString(36)}`;
    const manifest = [
        'metadata:', `  name: ${plain}`, '  version: 1.0.0', '  description: declares no app', '  author: t',
        'required_apis:', '  - memory', 'actions:',
        '  - id: whoami', '    method: POST', '    path: /whoami',
        '    input: { type: object }', '    output: { type: object }', '    script: whoami.js',
    ].join('\n');
    const scripts = { 'whoami.js': 'export default async function (ctx) { return { member: (ctx.caller && ctx.caller.member) ?? null, isAppOwner: !!(ctx.caller && ctx.caller.isAppOwner) }; }' };
    const inst = await json('/v1/extensions', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ manifest, scripts }) });
    assert(inst.status === 200 || inst.status === 201, `install ${inst.status}`);
    assert((await json(`/v1/extensions/${plain}/activate`, { method: 'POST', headers: auth(owner.token), body: '{}' })).status === 200, 'activate');

    const r = (await json(`/v1/ext/${plain}/whoami`, { method: 'POST', headers: auth(owner.token), body: '{}' })).body.data;
    assert(r.member === null && r.isAppOwner === false,
        `no declaration means no membership resolution, not a wrong one: ${JSON.stringify(r)}`);
});


// ── the bell carries the decision, not just the news ────────────────────────────────────────────
// A notification that only says "somebody asked" makes the owner go and find the panel. The buttons
// are set by the NODE, never by an app: an inline api action runs with the RECIPIENT's authority
// when clicked, which is why the public notifications route refuses client-supplied actions.

await test('the request notification carries working Approve and Decline buttons', async () => {
    const asker = await setupOwner('bel');
    await json(`/v1/apps/${owner.name}/${APP}/members/requests`, {
        method: 'POST', headers: auth(asker.token), body: JSON.stringify({ note: 'let me in' }),
    });
    const note = (await bell(owner.token)).filter(n => n.type === 'app_member_request')
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    assert(!!note, 'the owner was told');
    const actions = note.actions ?? [];
    assert(actions.length === 2, `two decisions offered, got ${actions.length}: ${JSON.stringify(actions.map((a: any) => a.id))}`);

    const approve = actions.find((a: any) => a.id === 'approve');
    const decline = actions.find((a: any) => a.id === 'decline');
    assert(!!approve && !!decline, 'approve and decline');
    // The node does not own the role vocabulary, so the button must SAY which role it grants.
    assert(/Approve as \w+/.test(approve.label), `the label names the role: ${approve.label}`);
    assert(approve.kind === 'api' && approve.method === 'POST', `approve is a real call: ${JSON.stringify(approve)}`);
    assert(approve.body.account === asker.name.toLowerCase(), `aimed at the right person: ${JSON.stringify(approve.body)}`);
    assert(decline.confirm === true, 'declining asks first, because it is the one that ends something');

    // Both endpoints are same-node paths, which is what the action guard requires.
    for (const a of [approve, decline]) {
        assert(a.endpoint.startsWith('/') && !a.endpoint.startsWith('//'), `same-node path: ${a.endpoint}`);
    }

    // Clicking Approve is exactly this call with the OWNER's token — verify it lands.
    const clicked = await json(approve.endpoint, {
        method: approve.method, headers: auth(owner.token), body: JSON.stringify(approve.body),
    });
    assert(clicked.status === 201, `the approve button's call works: ${clicked.status} ${JSON.stringify(clicked.body?.error)}`);
    const roster = await json(`/v1/apps/${owner.name}/${APP}/members`, { headers: auth(owner.token) });
    assert((roster.body.data.members as any[]).some(m => m.owner === asker.name.toLowerCase()),
        'and the person is a member afterwards');

    // A stranger clicking the same endpoint is still refused: the button carries no authority of its own.
    const stolen = await json(approve.endpoint, {
        method: approve.method, headers: auth(stranger.token), body: JSON.stringify(approve.body),
    });
    assert(stolen.status === 403, `the endpoint is not made public by being named in a bell, got ${stolen.status}`);
});

await test('the suggested role is read from the roster, not guessed', async () => {
    // The app above now has members holding a role; a fresh asker's button should offer that role.
    const asker2 = await setupOwner('bl2');
    await json(`/v1/apps/${owner.name}/${APP}/members/requests`, {
        method: 'POST', headers: auth(asker2.token), body: JSON.stringify({}),
    });
    const note = (await bell(owner.token)).filter(n => n.type === 'app_member_request')
        .find(n => n.title.includes(asker2.name));
    assert(!!note, 'the second ask rang too');
    const approve = (note.actions ?? []).find((a: any) => a.id === 'approve');
    const roster = await json(`/v1/apps/${owner.name}/${APP}/members`, { headers: auth(owner.token) });
    const roles = (roster.body.data.members as any[]).map(m => m.role);
    assert(roles.includes(approve.body.role),
        `the offered role is one the app actually uses (${JSON.stringify(roles)}), got ${approve.body.role}`);
});


// ── the spec becomes the gate ───────────────────────────────────────────────────────────────────
// Six gates on this node were forks of one package and every difference between them was hand-typed.
// A generated gate cannot drift, so the thing worth proving is that the generated one INSTALLS and
// DECIDES correctly — not that a string was produced.

await test('a declared IAM spec generates a gate that installs and runs', async () => {
    const { defineAppIam } = await import('../src/services/iam/define-app-iam.js');
    const design = defineAppIam({
        appId: `${owner.name}/${APP}`,
        author: owner.name,
        levels: [
            { level: 0, key: 'admin', label: 'Admin', capabilities: ['*'] },
            { level: 10, key: 'member', label: 'Member', capabilities: ['read', 'write'] },
            { level: 20, key: 'guest', label: 'Guest', capabilities: ['read'] },
        ],
        commands: [
            { id: 'doc.read', description: 'Read a document', capability: 'read', tier: 'read' },
            { id: 'doc.write', description: 'Write one', capability: 'write', tier: 'write' },
            { id: 'doc.purge', description: 'Delete everything', capability: 'admin', tier: 'irreversible' },
        ],
    });
    assert(design.ok === true, `design validates: ${JSON.stringify(design)}`);
    const gen = (design as any).extension;
    assert(!!gen, 'naming the app produces the installable gate, not just payloads');
    assert(gen.name === `${owner.name.toLowerCase()}-${APP.replace('.html', '')}-iam`.replace(/[^a-z0-9-]/g, '-'),
        `the name is derived from the app: ${gen.name}`);

    const inst = await json('/v1/extensions', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ manifest: gen.manifest, scripts: gen.scripts }),
    });
    assert(inst.status === 200 || inst.status === 201, `the generated manifest installs: ${inst.status} ${JSON.stringify(inst.body?.error)}`);
    assert((await json(`/v1/extensions/${gen.name}/activate`, { method: 'POST', headers: auth(owner.token), body: '{}' })).status === 200, 'activate');

    // The schemas must ARRIVE — three of the six live gates advertise none, which is why an agent
    // could not discover them, and that came from a key the parser ignores.
    const det = await json(`/v1/extensions/${gen.name}`, { headers: auth(owner.token) });
    const check = (det.body.data.extension ?? det.body.data).actions.find((a: any) => a.id === 'check');
    const props = (check.inputSchema ?? check.input_schema)?.properties ?? {};
    assert(!!props.permission && !!props.command, `the generated gate advertises its shape: ${JSON.stringify(props)}`);
    assert(Array.isArray(props.permission.enum) && props.permission.enum.includes('write'),
        `and names the capabilities it knows: ${JSON.stringify(props.permission.enum)}`);

    const call = async (token: string, body: Record<string, unknown>) =>
        (await json(`/v1/ext/${gen.name}/check`, { method: 'POST', headers: auth(token), body: JSON.stringify(body) })).body.data;

    // The OWNER reaches everything without a roster row.
    const asOwner = await call(owner.token, { permission: 'write' });
    assert(asOwner.allowed === true && asOwner.isOwner === true, `owner: ${JSON.stringify(asOwner)}`);

    // A stranger holds nothing, and the gate keeps NO roster of its own to be wrong about it.
    const nobody = await setupOwner('gen');
    const asNobody = await call(nobody.token, { permission: 'read' });
    assert(asNobody.allowed === false && asNobody.role === null, `stranger: ${JSON.stringify(asNobody)}`);

    // Approving them on the NODE is what changes the gate's answer — no sync, no second write.
    await json(`/v1/apps/${owner.name}/${APP}/members`, {
        method: 'POST', headers: auth(owner.token), body: JSON.stringify({ account: nobody.name, role: 'member' }),
    });
    const asMember = await call(nobody.token, { permission: 'write' });
    assert(asMember.allowed === true && asMember.role === 'member' && asMember.level === 10,
        `an approval on the node reaches the generated gate: ${JSON.stringify(asMember)}`);
    const denied = await call(nobody.token, { command: 'doc.purge' });
    assert(denied.allowed === false && denied.tier === 'irreversible',
        `a member is refused the irreversible command but still learns its tier: ${JSON.stringify(denied)}`);

    // Discovery: an agent asks what it may run rather than guessing from a catalogue.
    const list = (await json(`/v1/ext/${gen.name}/commands`, { method: 'POST', headers: auth(nobody.token), body: '{}' })).body.data;
    assert(list.commands.length === 3, `all commands listed: ${list.commands.length}`);
    const purge = list.commands.find((c: any) => c.id === 'doc.purge');
    const write = list.commands.find((c: any) => c.id === 'doc.write');
    assert(write.allowed === true && purge.allowed === false,
        `each is marked for THIS caller: ${JSON.stringify(list.commands.map((c: any) => [c.id, c.allowed]))}`);
    assert(purge.needsConfirmation === true, 'and the irreversible one asks for a human');

    // Removing them on the node is visible immediately, with nothing to keep in step.
    await json(`/v1/apps/${owner.name}/${APP}/members/${nobody.name}`, { method: 'DELETE', headers: auth(owner.token) });
    const after = await call(nobody.token, { permission: 'read' });
    assert(after.allowed === false && after.role === null,
        `a removal reaches the gate on the next call: ${JSON.stringify(after)}`);
});

await test('the generated gate stores NOTHING, so it has nothing to leak', async () => {
    const { generateIamExtension } = await import('../src/services/iam/generate-extension.js');
    const gen = generateIamExtension({
        appId: `${owner.name}/${APP}`,
        levels: [{ level: 0, key: 'admin', label: 'A', capabilities: ['*'] }],
        commands: [{ id: 'x', description: 'x', capability: 'admin', tier: 'read' }],
    });
    for (const [file, src] of Object.entries(gen.scripts)) {
        assert(!/memory\.set/.test(src as string), `${file} writes no memory`);
        assert(!/assignments/.test(src as string), `${file} keeps no roster`);
    }
});

// ── a public tier survives the move ──────────────────────────────────────────────────────────────
// The roster moving to the node must not shut an app's front door. NUOTTA lets anyone signed in read
// its guides and only charges for the corpus, so a gate that can only say "member or nothing" would
// have turned every visitor into a refusal the moment it was regenerated.
await test('defaultRole: a signed-in stranger holds the public tier, an anonymous caller holds nothing', async () => {
    const { generateIamExtension } = await import('../src/services/iam/generate-extension.js');
    const APP2 = 'public-tier.html';
    await json('/v1/apps', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ filename: APP2, description: 'public tier gate', content: Buffer.from('<html>x</html>').toString('base64') }),
    });
    const gen = generateIamExtension({
        appId: `${owner.name}/${APP2}`,
        author: owner.name,
        defaultRole: 'guest',
        levels: [
            { level: 0, key: 'admin', label: 'Admin', capabilities: ['*'] },
            { level: 10, key: 'member', label: 'Member', capabilities: ['corpus', 'guides'] },
            { level: 90, key: 'guest', label: 'Guest', capabilities: ['guides'] },
        ],
        commands: [
            { id: 'guides.read', description: 'Read the guides', capability: 'guides', tier: 'read' },
            { id: 'corpus.search', description: 'Search the corpus', capability: 'corpus', tier: 'read' },
        ],
    });
    const inst = await json('/v1/extensions', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ manifest: gen.manifest, scripts: gen.scripts }),
    });
    assert(inst.status === 200 || inst.status === 201, `installs: ${inst.status} ${JSON.stringify(inst.body?.error)}`);
    assert((await json(`/v1/extensions/${gen.name}/activate`, { method: 'POST', headers: auth(owner.token), body: '{}' })).status === 200, 'activate');

    const stranger = await setupOwner('pub');
    const call = async (token: string, body: Record<string, unknown>) =>
        (await json(`/v1/ext/${gen.name}/check`, { method: 'POST', headers: auth(token), body: JSON.stringify(body) })).body.data;

    // The whole point: on no roster row, and still holding the public tier.
    const guides = await call(stranger.token, { permission: 'guides' });
    assert(guides.allowed === true && guides.role === 'guest' && guides.via === 'default' && guides.member === false,
        `a signed-in stranger holds the public tier: ${JSON.stringify(guides)}`);

    // And no further: a default is a front door, not a membership.
    const corpus = await call(stranger.token, { permission: 'corpus' });
    assert(corpus.allowed === false, `the paid capability is still refused: ${JSON.stringify(corpus)}`);

    // Discovery agrees with the gate rather than listing everything as callable.
    const list = (await json(`/v1/ext/${gen.name}/commands`, { method: 'POST', headers: auth(stranger.token), body: '{}' })).body.data;
    const byId = Object.fromEntries(list.commands.map((c: { id: string; allowed: boolean }) => [c.id, c.allowed]));
    assert(byId['guides.read'] === true && byId['corpus.search'] === false,
        `discovery marks the public one open and the paid one shut: ${JSON.stringify(byId)}`);

    // Approving them lifts the tier, with nothing to sync.
    await json(`/v1/apps/${owner.name}/${APP2}/members`, {
        method: 'POST', headers: auth(owner.token), body: JSON.stringify({ account: stranger.name, role: 'member' }),
    });
    const asMember = await call(stranger.token, { permission: 'corpus' });
    assert(asMember.allowed === true && asMember.role === 'member' && asMember.via === 'owner' && asMember.member === true,
        `an approval overrides the default: ${JSON.stringify(asMember)}`);

    // Removing them drops back to the public tier rather than to nothing, which is what keeps a
    // revoked member able to see what they lost and ask again.
    await json(`/v1/apps/${owner.name}/${APP2}/members/${stranger.name}`, { method: 'DELETE', headers: auth(owner.token) });
    const after = await call(stranger.token, { permission: 'guides' });
    assert(after.allowed === true && after.role === 'guest',
        `removal falls back to the public tier: ${JSON.stringify(after)}`);
});

// ── an approval has to CARRY, not just label ────────────────────────────────────────
// The panel's Approve button passes a role and no offerings, because the person clicking it should
// not have to know listing ids. Without a declared plan that approval set a role and carried
// nothing: the panel said "approved" and the member was billed at list price on every call. The two
// disagreeing is worse than either alone, so the plan is declared once and applied from then on.
await test('the carry plan is the APP OWNER\'s declaration — a stranger can neither read nor write it', async () => {
    // Every PUT and the only GET of /members/plan in this file is made with owner.token. Delete the
    // `if (!c.isOwner) return 403` from both handlers in routes/app-members.ts and a stranger PUTs
    // `{roles:{}, access:'free'}` on somebody else's paid app — every priced action goes free — or
    // sets rosterVisibility:'members' and joins to read the private roster. All 36 tests stay green.
    const write = await json(`/v1/apps/${owner.name}/${APP}/members/plan`, {
        method: 'PUT', headers: auth(stranger.token),
        body: JSON.stringify({ roles: { member: [] }, access: 'free' }),
    });
    assert(write.status === 403, `a stranger rewrote the carry plan: ${write.status} ${JSON.stringify(write.body?.error)}`);

    const read = await json(`/v1/apps/${owner.name}/${APP}/members/plan`, { headers: auth(stranger.token) });
    assert(read.status === 403, `a stranger read the carry plan: ${read.status}`);

    // Anonymous is refused too — the plan names what an approval is worth, and a paid app's pricing
    // stance is not public.
    const anon = await json(`/v1/apps/${owner.name}/${APP}/members/plan`);
    assert(anon.status === 401 || anon.status === 403, `anonymous read of the plan: ${anon.status}`);
});

await test('a declared carry plan makes a bare approval actually carry the member', async () => {
    const plan = await json(`/v1/apps/${owner.name}/${APP}/members/plan`, {
        method: 'PUT', headers: auth(owner.token),
        body: JSON.stringify({ roles: { member: [offA, offB], guest: [] } }),
    });
    assert(plan.status === 200, `the plan is declarable: ${plan.status} ${JSON.stringify(plan.body?.error)}`);
    assert(plan.body.data.plan.roles.member.length === 2, `and reads back: ${JSON.stringify(plan.body.data.plan.roles)}`);

    // A stranger, approved the way the panel approves: a role and nothing else.
    const newcomer = stranger;
    const approved = await json(`/v1/apps/${owner.name}/${APP}/members`, {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ account: newcomer.name, role: 'member' }),
    });
    assert(approved.status === 200 || approved.status === 201, `approve: ${approved.status} ${JSON.stringify(approved.body?.error)}`);
    assert(approved.body.data.member.offerings.length === 2,
        `the plan filled in what the approval did not name: ${JSON.stringify(approved.body.data.member.offerings)}`);
    assert((approved.body.data.access?.granted ?? []).length === 2,
        `and the grants were actually issued: ${JSON.stringify(approved.body.data.access)}`);

    // A role with an empty plan carries nothing, and moving somebody to it TAKES the grants back
    // rather than leaving the provider paying for a tier the member no longer holds.
    const demoted = await json(`/v1/apps/${owner.name}/${APP}/members`, {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ account: newcomer.name, role: 'guest' }),
    });
    assert((demoted.body.data.access?.revoked ?? []).length === 2,
        `a demotion withdraws what the old role carried: ${JSON.stringify(demoted.body.data.access)}`);
    assert(demoted.body.data.member.offerings.length === 0,
        `and the record agrees: ${JSON.stringify(demoted.body.data.member.offerings)}`);

    // An explicit list still wins: a caller who names offerings meant them.
    const explicit = await json(`/v1/apps/${owner.name}/${APP}/members`, {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ account: newcomer.name, role: 'member', offerings: [offA] }),
    });
    assert(explicit.body.data.member.offerings.length === 1,
        `an explicit list overrides the plan: ${JSON.stringify(explicit.body.data.member.offerings)}`);

    await json(`/v1/apps/${owner.name}/${APP}/members/${newcomer.name}`, { method: 'DELETE', headers: auth(owner.token) });
});

// ── the gate declares its own vocabulary ─────────────────────────────────────────────
// The owner's panel has to render a role select. Where the gate could not say which roles exist, the
// app had to retype them — and NUOTTA did not, so the select rendered empty and Approve posted no
// role at all, which the node refused with a 400. A gate that enforces a vocabulary should state it.
await test('the generated gate states its role vocabulary, and versions where it is told to', async () => {
    const { generateIamExtension } = await import('../src/services/iam/generate-extension.js');
    const APP3 = 'vocab.html';
    await json('/v1/apps', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ filename: APP3, description: 'vocabulary gate', content: Buffer.from('<html>x</html>').toString('base64') }),
    });
    const gen = generateIamExtension({
        appId: `${owner.name}/${APP3}`,
        author: owner.name,
        defaultRole: 'guest',
        version: '2.4.0',
        levels: [
            { level: 0, key: 'admin', label: 'Admin', capabilities: ['*'] },
            { level: 10, key: 'member', label: 'Member', capabilities: ['corpus'] },
            { level: 90, key: 'guest', label: 'Guest', capabilities: ['guides'] },
        ],
        commands: [{ id: 'corpus.search', description: 'Search', capability: 'corpus', tier: 'read' }],
    });
    const inst = await json('/v1/extensions', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ manifest: gen.manifest, scripts: gen.scripts }),
    });
    assert(inst.status === 200 || inst.status === 201, `installs: ${inst.status} ${JSON.stringify(inst.body?.error)}`);
    assert((await json(`/v1/extensions/${gen.name}/activate`, { method: 'POST', headers: auth(owner.token), body: '{}' })).status === 200, 'activate');

    // A regenerated gate must not read as a rollback in the extension list.
    const det = await json(`/v1/extensions/${gen.name}`, { headers: auth(owner.token) });
    const rec = det.body.data.extension ?? det.body.data;
    assert(String(rec.version) === '2.4.0', `the version it was told to publish as: ${rec.version}`);

    // The vocabulary itself.
    const stranger = await setupOwner('vocab');
    const vocab = (await json(`/v1/ext/${gen.name}/roles`, {
        method: 'POST', headers: auth(stranger.token), body: '{}',
    })).body.data;
    assert(!!vocab && !!vocab.roles, `the gate answers its vocabulary: ${JSON.stringify(vocab)}`);
    assert(Object.keys(vocab.roles).sort().join(',') === 'admin,guest,member',
        `every role, with its capabilities: ${JSON.stringify(vocab.roles)}`);
    assert(vocab.defaultRole === 'guest', `and what a stranger holds: ${vocab.defaultRole}`);
    // Assignable is not the same as existing: approving somebody into the role they already hold by
    // default is an act with no effect, so the panel should not offer it.
    assert(vocab.assignable.sort().join(',') === 'admin,member',
        `what an owner may hand out excludes the default: ${JSON.stringify(vocab.assignable)}`);
    assert(vocab.labels.member === 'Member', `labels survive for the UI: ${JSON.stringify(vocab.labels)}`);

    // The vocabulary is public; the ROSTER is not. That split is the whole reason this is safe.
    // "Open" here means not owner-only, NOT anonymous: this node authenticates every extension call,
    // and a description that said otherwise would be the kind of false promise this target exists to
    // remove. A signed-in stranger reading it (above) is the actual guarantee.
    const anon = await json(`/v1/ext/${gen.name}/roles`, { method: 'POST', body: '{}' });
    assert(anon.status === 401, `an extension call still needs a principal: ${anon.status}`);
    const rosterAnon = await json(`/v1/apps/${owner.name}/${APP3}/members`);
    assert(rosterAnon.status === 401 || rosterAnon.status === 403,
        `the roster still refuses an unauthenticated read: ${rosterAnon.status}`);
});

// ── a roster a member may read, redacted ───────────────────────────────────────────
// Shut by default is right for a paid service. It is wrong for an app where seeing each other IS the
// product: a club board renders by reading each member's own posts, so a roster only the owner can
// read leaves every member looking at an empty page.
await test('rosterVisibility members: a member reads the roster, and only the part that is theirs to see', async () => {
    const APP4 = 'boardish.html';
    await json('/v1/apps', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ filename: APP4, description: 'roster visibility', content: Buffer.from('<html>x</html>').toString('base64') }),
    });
    const insider = member;
    const outsider = stranger;

    // Shut by default, even for a member.
    await json(`/v1/apps/${owner.name}/${APP4}/members`, {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ account: insider.name, role: 'editor', note: 'private note about them' }),
    });
    const shut = await json(`/v1/apps/${owner.name}/${APP4}/members`, { headers: auth(insider.token) });
    assert(shut.status === 403, `default is owner-only even for a member: ${shut.status}`);

    await json(`/v1/apps/${owner.name}/${APP4}/members/plan`, {
        method: 'PUT', headers: auth(owner.token),
        body: JSON.stringify({ roles: {}, rosterVisibility: 'members' }),
    });

    // Now a member sees the list — but not the owner's notes about people.
    const open = await json(`/v1/apps/${owner.name}/${APP4}/members`, { headers: auth(insider.token) });
    assert(open.status === 200, `a member reads it: ${open.status} ${JSON.stringify(open.body?.error)}`);
    const row = open.body.data.members.find((m: { owner: string }) => m.owner === insider.name.toLowerCase());
    assert(!!row, `and finds the roster in it: ${JSON.stringify(open.body.data.members)}`);
    assert(row.note === undefined && row.approvedBy === undefined && row.offerings === undefined,
        `the owner's own columns are not handed over: ${JSON.stringify(row)}`);
    assert(open.body.data.requests.length === 0 && open.body.data.redacted === true,
        `pending requests are nobody else's business, and the answer says it is redacted: ${JSON.stringify(open.body.data)}`);

    // Opening it to MEMBERS is not opening it to everyone.
    const strangerRead = await json(`/v1/apps/${owner.name}/${APP4}/members`, { headers: auth(outsider.token) });
    assert(strangerRead.status === 403, `a non-member is still refused: ${strangerRead.status}`);
    const anonRead = await json(`/v1/apps/${owner.name}/${APP4}/members`);
    assert(anonRead.status === 401 || anonRead.status === 403, `and so is an anonymous caller: ${anonRead.status}`);

    // The owner keeps the full view.
    const asOwner = await json(`/v1/apps/${owner.name}/${APP4}/members`, { headers: auth(owner.token) });
    const full = asOwner.body.data.members.find((m: { owner: string }) => m.owner === insider.name.toLowerCase());
    assert(full.note === 'private note about them', `the owner still sees their own note: ${JSON.stringify(full)}`);
});

// ── a tier above another holds everything it holds ────────────────────────────────────
// NUOTTA declared guest:['guides'] and member:[everything else], and a literal reading gave the
// paying member no access to the introduction a passer-by could read. Nobody decided that; it fell
// out of listing each tier separately, which is how anyone would write it.
await test('capabilities accumulate down the ladder: a member holds what a guest holds', async () => {
    const { generateIamExtension } = await import('../src/services/iam/generate-extension.js');
    const APP5 = 'ladder.html';
    await json('/v1/apps', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ filename: APP5, description: 'ladder', content: Buffer.from('<html>x</html>').toString('base64') }),
    });
    const gen = generateIamExtension({
        appId: `${owner.name}/${APP5}`, author: owner.name, defaultRole: 'guest', version: '1.0.0',
        levels: [
            { level: 0, key: 'admin', label: 'Admin', capabilities: ['*'] },
            // Written the natural way: each tier lists only what is NEW at that tier.
            { level: 10, key: 'member', label: 'Member', capabilities: ['corpus'] },
            { level: 20, key: 'guest', label: 'Guest', capabilities: ['guides'] },
        ],
        commands: [
            { id: 'guides.read', description: 'Read the guides', capability: 'guides', tier: 'read' },
            { id: 'corpus.search', description: 'Search the corpus', capability: 'corpus', tier: 'read' },
        ],
    });
    await json('/v1/extensions', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ manifest: gen.manifest, scripts: gen.scripts }),
    });
    await json(`/v1/extensions/${gen.name}/activate`, { method: 'POST', headers: auth(owner.token), body: '{}' });

    const ladderMember = member;
    await json(`/v1/apps/${owner.name}/${APP5}/members`, {
        method: 'POST', headers: auth(owner.token), body: JSON.stringify({ account: ladderMember.name, role: 'member' }),
    });
    const call = async (body: Record<string, unknown>) =>
        (await json(`/v1/ext/${gen.name}/check`, { method: 'POST', headers: auth(ladderMember.token), body: JSON.stringify(body) })).body.data;

    // The whole point: the paying tier is not locked out of the free one.
    const guides = await call({ permission: 'guides' });
    assert(guides.allowed === true, `a member holds what a guest holds: ${JSON.stringify(guides)}`);
    const corpus = await call({ permission: 'corpus' });
    assert(corpus.allowed === true, `and its own tier too: ${JSON.stringify(corpus)}`);

    // The vocabulary states the accumulated set, so a UI painting from it agrees with the gate.
    const vocab = (await json(`/v1/ext/${gen.name}/roles`, { method: 'POST', headers: auth(ladderMember.token), body: '{}' })).body.data;
    assert(vocab.roles.member.includes('guides') && vocab.roles.member.includes('corpus'),
        `the declared vocabulary accumulates too: ${JSON.stringify(vocab.roles)}`);
    assert(vocab.roles.guest.length === 1, `and a weaker tier gains nothing from a stronger one: ${JSON.stringify(vocab.roles.guest)}`);

    // Discovery agrees with the gate, which is what an agent reads before calling anything.
    const list = (await json(`/v1/ext/${gen.name}/commands`, { method: 'POST', headers: auth(ladderMember.token), body: '{}' })).body.data;
    const byId = Object.fromEntries(list.commands.map((c: { id: string; allowed: boolean }) => [c.id, c.allowed]));
    assert(byId['guides.read'] === true && byId['corpus.search'] === true,
        `discovery marks both open for a member: ${JSON.stringify(byId)}`);
});

// ── seats and terms: the two axes the spec named and nobody had built ───────────────────
await test('seats: an approval past the last seat is refused and says how many are taken', async () => {
    const APP6 = 'seated.html';
    await json('/v1/apps', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ filename: APP6, description: 'seats', content: Buffer.from('<html>x</html>').toString('base64') }),
    });
    await json(`/v1/apps/${owner.name}/${APP6}/members/plan`, {
        method: 'PUT', headers: auth(owner.token),
        body: JSON.stringify({ roles: {}, seats: { member: 1 } }),
    });
    const first = member;
    const second = stranger;
    const ok = await json(`/v1/apps/${owner.name}/${APP6}/members`, {
        method: 'POST', headers: auth(owner.token), body: JSON.stringify({ account: first.name, role: 'member' }),
    });
    assert(ok.status === 200 || ok.status === 201, `the first seat fills: ${ok.status}`);

    const full = await json(`/v1/apps/${owner.name}/${APP6}/members`, {
        method: 'POST', headers: auth(owner.token), body: JSON.stringify({ account: second.name, role: 'member' }),
    });
    assert(full.status === 409 && full.body.error.code === 'SEATS_FULL',
        `the second is refused rather than quietly made: ${full.status} ${JSON.stringify(full.body?.error)}`);
    assert(/1/.test(full.body.error.message), `and the refusal says how many: ${full.body.error.message}`);

    // A seat holder is not taking a NEW seat, so renewing them must not hit the cap.
    const renew = await json(`/v1/apps/${owner.name}/${APP6}/members`, {
        method: 'POST', headers: auth(owner.token), body: JSON.stringify({ account: first.name, role: 'member', note: 'renewed' }),
    });
    assert(renew.status === 200 || renew.status === 201, `a renewal is not a new seat: ${renew.status}`);

    // Freeing the seat lets the next person in, which is what makes it a queue and not a wall.
    await json(`/v1/apps/${owner.name}/${APP6}/members/${first.name}`, { method: 'DELETE', headers: auth(owner.token) });
    const after = await json(`/v1/apps/${owner.name}/${APP6}/members`, {
        method: 'POST', headers: auth(owner.token), body: JSON.stringify({ account: second.name, role: 'member' }),
    });
    assert(after.status === 200 || after.status === 201, `the freed seat is usable: ${after.status}`);
});

await test('terms: a membership lapses on the clock, and the sweep takes the free access back', async () => {
    const APP7 = 'termed.html';
    await json('/v1/apps', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ filename: APP7, description: 'terms', content: Buffer.from('<html>x</html>').toString('base64') }),
    });
    await json(`/v1/apps/${owner.name}/${APP7}/members/plan`, {
        method: 'PUT', headers: auth(owner.token),
        body: JSON.stringify({ roles: { member: [offA] }, terms: { member: { days: 30, renewal: 'self-serve' } } }),
    });
    const sub = member;   // reuse: each new account is a login, and the limiter is real
    const made = await json(`/v1/apps/${owner.name}/${APP7}/members`, {
        method: 'POST', headers: auth(owner.token), body: JSON.stringify({ account: sub.name, role: 'member' }),
    });
    const rec = made.body.data.member;
    assert(!!rec.expiresAt, `the declared term is applied without the caller naming it: ${JSON.stringify(rec)}`);
    assert(rec.renewal === 'self-serve', `and how it is meant to continue is recorded: ${rec.renewal}`);
    const days = Math.round((new Date(rec.expiresAt).getTime() - Date.now()) / 86400_000);
    assert(days === 30, `counted from now, not from some earlier date: ${days} days`);
    assert((made.body.data.access?.granted ?? []).length === 1, `and it carries: ${JSON.stringify(made.body.data.access)}`);

    // While it runs, they are a member.
    const live = await json(`/v1/apps/${owner.name}/${APP7}/members/me`, { headers: auth(sub.token) });
    assert(live.body.data.member !== null && live.body.data.role === 'member', `live: ${JSON.stringify(live.body.data)}`);

    // Now end the term by hand and watch the CLOCK decide, with no sweep involved.
    await json(`/v1/apps/${owner.name}/${APP7}/members`, {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ account: sub.name, role: 'member', expiresAt: new Date(Date.now() - 1000).toISOString() }),
    });
    const lapsed = await json(`/v1/apps/${owner.name}/${APP7}/members/me`, { headers: auth(sub.token) });
    assert(lapsed.body.data.member === null && lapsed.body.data.role === null,
        `a lapsed term stops reaching the app immediately, whatever the sweep is doing: ${JSON.stringify(lapsed.body.data)}`);

    // The grants, though, are still live — which is exactly why a sweep has to exist.
    const sweep = await json(`/v1/apps/${owner.name}/${APP7}/members/sweep`, { method: 'POST', headers: auth(owner.token), body: '{}' });
    const swept = sweep.body.data;
    assert(swept.swept >= 1 && swept.revoked >= 1,
        `the sweep withdraws what the lapsed membership was carrying: ${JSON.stringify(swept)}`);

    // And it is the OWNER's act: nobody else may run it over somebody else's app.
    const refused = await json(`/v1/apps/${owner.name}/${APP7}/members/sweep`, { method: 'POST', headers: auth(stranger.token), body: '{}' });
    assert(refused.status === 403, `a stranger cannot sweep somebody else's roster: ${refused.status}`);

    const gone = await json(`/v1/apps/${owner.name}/${APP7}/members`, { headers: auth(owner.token) });
    assert(!gone.body.data.members.some((m: { owner: string }) => m.owner === sub.name.toLowerCase()),
        'and the row goes, so the seat count is not wrong afterwards');
});

// ── members-only refuses BEFORE the till opens ───────────────────────────────────
// "Only my members get in, money or no money" is a real product position. LÄÄKE took it inside its
// own action scripts, where the paywall had already settled by the time the refusal ran — so somebody
// who took a contract and PAID was told they were not on the list, and kept neither the answer nor
// the money. The stance has to be taken before the charge.
await test('access members-only: an outsider holding an entitlement is refused, and not charged', async () => {
    // A member and an outsider, both holding an entitlement for the priced action.
    await json(`/v1/apps/${owner.name}/${APP}/members`, {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ account: member.name, role: 'member', offerings: [offA] }),
    });
    await json('/v1/exchange/grants', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ consumer: stranger.name, offering_id: offA, note: 'outsider with a contract' }),
    });

    const call = async (token: string) =>
        await json(`/v1/ext/${ext}/${OFFER_A}`, { method: 'POST', headers: auth(token), body: '{}' });

    // MEMBERS-FREE (the default): both get in. The member is carried; the outsider settles theirs.
    await json(`/v1/apps/${owner.name}/${APP}/members/plan`, {
        method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ roles: {}, access: 'members-free' }),
    });
    assert((await call(member.token)).status === 200, 'open: a member gets in');
    assert((await call(stranger.token)).status === 200, 'open: an outsider holding an entitlement gets in');

    // MEMBERS-ONLY: the outsider is refused, and the refusal is a REFUSAL, not a receipt.
    await json(`/v1/apps/${owner.name}/${APP}/members/plan`, {
        method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ roles: {}, access: 'members-only' }),
    });
    const shut = await call(stranger.token);
    assert(shut.status === 403 && shut.body.error.code === 'MEMBERS_ONLY',
        `an outsider is refused even holding money: ${shut.status} ${JSON.stringify(shut.body?.error)}`);
    assert(/not been charged/.test(shut.body.error.message), `and told so: ${shut.body.error.message}`);
    // The link has to name the route that exists. A pattern on "members/request" matched the old
    // ".../members/request" too, which answered 404, so this assertion never caught it.
    const askHint = ((shut.body.hints?.next_actions ?? []) as any[]).find(h => h.method === 'POST');
    assert(!!askHint && /\/members\/requests$/.test(String(askHint.url)),
        `with somewhere to go that exists: ${JSON.stringify(shut.body.hints)}`);

    // The member is untouched by the stance — that is the whole point of it.
    assert((await call(member.token)).status === 200, 'members-only: a member still gets in');
    // And the owner, who is nobody's customer.
    assert((await call(owner.token)).status === 200, 'members-only: the owner still gets in');

    // Put it back so the rest of the suite sees the default.
    await json(`/v1/apps/${owner.name}/${APP}/members/plan`, {
        method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ roles: {}, access: 'members-free' }),
    });
    await json(`/v1/apps/${owner.name}/${APP}/members/${member.name}`, { method: 'DELETE', headers: auth(owner.token) });
});

// ── free: nobody pays, including the customer who already contracted ──────────────────
// Turning the price off has to reach the people already paying. A contract settles at its agreed
// price wherever the gate is consulted, so a check placed after it would keep charging exactly the
// group most likely to hold one — quietly, because nothing about their call would look different.
await test('access free: nobody pays, not the stranger and not the contract holder', async () => {
    const APP8 = 'freebie.html';
    await json('/v1/apps', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ filename: APP8, description: 'free mode', content: Buffer.from('<html>x</html>').toString('base64') }),
    });
    // An extension that names APP8, so the node has a plan to consult.
    const fext = `freeext${Date.now().toString(36)}`;
    const manifest = [
        'metadata:', `  name: ${fext}`, '  version: 1.0.0', '  description: free-mode fixture', '  author: t',
        'config:', '  app:', '    type: string', `    default: ${owner.name}/${APP8}`,
        'required_apis:', '  - memory', 'actions:',
        '  - id: ask', '    method: POST', '    path: /ask',
        '    input: { type: object }', '    output: { type: object }', '    script: ask.js',
        '    commercial: { payMoney: { amount: 5000, currency: EUR } }',
    ].join(String.fromCharCode(10));
    const inst = await json('/v1/extensions', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ manifest, scripts: { 'ask.js': 'export default async function () { return { ok: true }; }' } }),
    });
    assert(inst.status === 200 || inst.status === 201, `install: ${inst.status} ${JSON.stringify(inst.body?.error)}`);
    await json(`/v1/extensions/${fext}/activate`, { method: 'POST', headers: auth(owner.token), body: '{}' });

    const call = async (token: string) =>
        await json(`/v1/ext/${fext}/ask`, { method: 'POST', headers: auth(token), body: '{}' });

    // Priced by default: a stranger has to pay.
    const priced = await call(stranger.token);
    assert(priced.status === 402, `while it is priced, a stranger pays: ${priced.status}`);

    // Now the owner makes it free.
    await json(`/v1/apps/${owner.name}/${APP8}/members/plan`, {
        method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ roles: {}, access: 'free' }),
    });
    assert((await call(stranger.token)).status === 200, 'free: a stranger with no contract gets in, unpaid');
    assert((await call(member.token)).status === 200, 'free: so does anybody else');
    assert((await call(owner.token)).status === 200, 'free: and the owner, as always');

    // Nothing was settled for the stranger — free is free, not "billed to somebody else".
    const grants = await json(`/v1/exchange/grants?app_id=${encodeURIComponent(`${owner.name}/${APP8}`)}`, { headers: auth(owner.token) });
    const theirs = (grants.body.data.grants as { consumer_gaii: string }[] ?? [])
        .filter(g => g.consumer_gaii.startsWith(stranger.name));
    assert(theirs.length === 0, `and no entitlement was invented to pay for it: ${JSON.stringify(theirs)}`);
});

// ── the third group: everybody who turned up ─────────────────────────────────────
// An app with members has three groups and the roster only ever named two: approved, and asking.
// The third is everybody else who actually came, and they are the ones an owner most wants to see —
// a roster says who you already said yes to, this says who is there to say yes TO. The shared panel
// has rendered an empty "turned up, holds no role" section since it was written.
await test('guests: turning up is recorded, and one person appears in exactly one place', async () => {
    const APP9 = 'guestbook.html';
    await json('/v1/apps', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ filename: APP9, description: 'guests', content: Buffer.from('<html>x</html>').toString('base64') }),
    });
    const roster = async () => (await json(`/v1/apps/${owner.name}/${APP9}/members`, { headers: auth(owner.token) })).body.data;
    const me = async (token: string) => await json(`/v1/apps/${owner.name}/${APP9}/members/me`, { headers: auth(token) });

    assert((await roster()).seen.length === 0, 'nobody has turned up yet');

    // Somebody asks where they stand, which is what an app does when it loads.
    await me(stranger.token);
    const afterVisit = await roster();
    const guest = afterVisit.seen.find((v: { owner: string }) => v.owner === stranger.name.toLowerCase());
    assert(!!guest, `they are on the guest list: ${JSON.stringify(afterVisit.seen)}`);
    assert(guest.visits === 1 && !!guest.firstSeen && !!guest.lastSeen, `with when and how often: ${JSON.stringify(guest)}`);

    // Looking again inside the window is the same visit. A page that re-renders must not turn one
    // person into a hundred, and it must not write on every call either.
    await me(stranger.token);
    await me(stranger.token);
    const again = (await roster()).seen.find((v: { owner: string }) => v.owner === stranger.name.toLowerCase());
    assert(again.visits === 1, `a repeat look inside the window is the same visit: ${JSON.stringify(again)}`);

    // The OWNER is not a guest in their own app.
    await me(owner.token);
    assert(!(await roster()).seen.some((v: { owner: string }) => v.owner === owner.name.toLowerCase()),
        'the owner is not a guest in their own app');

    // Asking for access moves them out of the guest list and into the queue — one person, one place.
    await json(`/v1/apps/${owner.name}/${APP9}/members/requests`, {
        method: 'POST', headers: auth(stranger.token), body: JSON.stringify({ note: 'let me in' }),
    });
    const queued = await roster();
    assert(queued.requests.length === 1, `they are in the queue: ${JSON.stringify(queued.requests)}`);
    assert(!queued.seen.some((v: { owner: string }) => v.owner === stranger.name.toLowerCase()),
        `and no longer listed as merely present: ${JSON.stringify(queued.seen)}`);

    // Approving them moves them once more, and leaves nothing behind in the other two lists.
    await json(`/v1/apps/${owner.name}/${APP9}/members`, {
        method: 'POST', headers: auth(owner.token), body: JSON.stringify({ account: stranger.name, role: 'member' }),
    });
    const approved = await roster();
    assert(approved.members.some((m: { owner: string }) => m.owner === stranger.name.toLowerCase()), 'approved');
    assert(approved.seen.length === 0 && approved.requests.length === 0,
        `and gone from both other lists: seen=${JSON.stringify(approved.seen)} requests=${JSON.stringify(approved.requests)}`);

    // A member is not a guest either, however often they come back.
    await me(stranger.token);
    assert((await roster()).seen.length === 0, 'a member looking again is not recorded as a guest');

    // The owner can dismiss a guest, and it is not a block: they come back on their next visit.
    await json(`/v1/apps/${owner.name}/${APP9}/members/${stranger.name}`, { method: 'DELETE', headers: auth(owner.token) });
    await me(stranger.token);
    assert((await roster()).seen.length === 1, 'removed from the roster, they are a visitor again');
    const dismissed = await json(`/v1/apps/${owner.name}/${APP9}/members/seen/${stranger.name}`, {
        method: 'DELETE', headers: auth(owner.token),
    });
    assert(dismissed.status === 200, `the owner can dismiss one: ${dismissed.status}`);
    assert((await roster()).seen.length === 0, 'and the list is clear');

    // The guest list is the owner's. It is personal data about other people.
    const nosy = await json(`/v1/apps/${owner.name}/${APP9}/members`, { headers: auth(stranger.token) });
    assert(nosy.status === 403, `a stranger cannot read who else has been here: ${nosy.status}`);
});

// Approving a member does two things, and the second is what needs a permission: syncGrantsForMember
// issues the exchange grants that let that person call what the owner SELLS without being billed —
// the same act as POST /v1/exchange/grants, which has always demanded `exchange:grant`. The isOwner
// test inside these routes is not that check: it compares the caller's OWNER ACCOUNT NAME, and the
// comment beside it says so ("an agent acting for the app's owner administers as the owner does"),
// so before 2026-09-04 an agent or an app grant approved for one unrelated word approved members,
// handed them free access to the owner's paid capabilities, and removed them again.
await test('an agent of the owner needs exchange:grant to approve or remove a member', async () => {
    const da = await json('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ agent_name: 'rosterhand', owner: owner.name }) });
    const v = await json('/v1/agents/verify', { method: 'POST', body: JSON.stringify({ user_code: da.body.data.user_code, action: 'approve', scopes: ['memory:read'], owner_token: owner.token }) });
    assert(v.status === 200, `verify ${v.status}`);
    const t = await json('/v1/agents/device-token', { method: 'POST', body: JSON.stringify({ device_code: da.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
    const mute = t.body.token as string;

    // Read the roster as it stands rather than assuming who is on it — earlier tests in this suite
    // add and remove people, and what is under test is that this agent changes nothing.
    const rosterOf = async () => {
        const r = await json(`/v1/apps/${owner.name}/${APP}/members`, { headers: auth(owner.token) });
        assert(r.status === 200, `roster ${r.status}`);
        return ((r.body.data.members ?? []) as any[]).map(m => m.owner).sort();
    };
    const before = await rosterOf();
    assert(before.length > 0, 'this assertion needs somebody on the roster to try to remove');

    const approve = await json(`/v1/apps/${owner.name}/${APP}/members`, {
        method: 'POST', headers: auth(mute), body: JSON.stringify({ account: stranger.name, role: 'member' }),
    });
    assert(approve.status === 403, `an agent without exchange:grant approved a member: ${approve.status} ${JSON.stringify(approve.body?.error)}`);
    assert(approve.body.error.code === 'SCOPE_DENIED', `refused for the wrong reason: ${JSON.stringify(approve.body.error)}`);

    const remove = await json(`/v1/apps/${owner.name}/${APP}/members/${before[0]}`, {
        method: 'DELETE', headers: auth(mute),
    });
    assert(remove.status === 403, `an agent without exchange:grant removed a member: ${remove.status}`);

    // The refusals refused rather than half-acting: the roster is exactly as it was.
    const after = await rosterOf();
    assert(JSON.stringify(after) === JSON.stringify(before),
        `the roster moved under a refused agent: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);

    // And the owner's own session still does both — owner sessions bypass scopes, so what the gate
    // costs is a machine acting unasked, not the person using their own Members screen.
    const asOwner = await json(`/v1/apps/${owner.name}/${APP}/members`, {
        method: 'POST', headers: auth(owner.token), body: JSON.stringify({ account: stranger.name, role: 'member' }),
    });
    assert(asOwner.status === 200 || asOwner.status === 201, `the owner was refused their own roster: ${asOwner.status} ${JSON.stringify(asOwner.body?.error)}`);
    await json(`/v1/apps/${owner.name}/${APP}/members/${stranger.name}`, { method: 'DELETE', headers: auth(owner.token) });
});

// ── 2026-10-01: the IAM defect round ────────────────────────────────────────────────────────────────

/** An agent of `who` holding only `scopes`, through the device flow every agent uses. */
async function agentOf(who: { name: string; token: string }, scopes: string[]): Promise<string> {
    const da = await json('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ agent_name: `iam${Date.now() % 100000}`, owner: who.name }) });
    await json('/v1/agents/verify', { method: 'POST', body: JSON.stringify({ user_code: da.body.data.user_code, action: 'approve', scopes, owner_token: who.token }) });
    const t = await json('/v1/agents/device-token', { method: 'POST', body: JSON.stringify({ device_code: da.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
    // The device-token answer is the OAuth shape, not the node's envelope.
    const token = (t.body?.access_token ?? t.body?.data?.access_token) as string | undefined;
    assert(!!token, `agent token: ${JSON.stringify(t.body?.error ?? t.status)}`);
    return token as string;
}

/** The token an app on the app origin holds for `user`: role 'app', bound to `app`, with `scope`. */
async function appTokenFor(user: { token: string }, app: string, scope: string): Promise<string> {
    const { createHash, randomBytes } = await import('node:crypto');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const redirect = 'http://localhost:9911/callback';
    const q = new URLSearchParams({ app, response_type: 'code', scope, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256' });
    const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    const rid = decodeURIComponent(/req=([^&]+)/.exec(res.headers.get('location') ?? '')?.[1] ?? '');
    const con = await json('/v1/app-grants/authorize-consent', { method: 'POST', headers: auth(user.token), body: JSON.stringify({ request_id: rid }) });
    assert(!!con.body?.data?.redirect_url, `consent: ${JSON.stringify(con.body?.error ?? con.body)}`);
    const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
    const tok = await json('/v1/app-grants/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect }) });
    assert(!!tok.body?.data?.access_token, `app token: ${JSON.stringify(tok.body?.error ?? tok.body)}`);
    return tok.body.data.access_token as string;
}

await test('a token granted for an unrelated word cannot read the roster or decide on anybody', async () => {
    const mute = await agentOf(owner, ['memory:read']);
    const base = `/v1/apps/${owner.name}/${APP}/members`;
    const reads = [
        await json(base, { headers: auth(mute) }),
        await json(`${base}/plan`, { headers: auth(mute) }),
    ];
    for (const r of reads) {
        assert(r.status === 403 && r.body.error.code === 'SCOPE_DENIED', `a memory:read agent read the roster: ${r.status} ${JSON.stringify(r.body?.error)}`);
    }
    const acts = [
        await json(`${base}/requests/${stranger.name}`, { method: 'DELETE', headers: auth(mute) }),
        await json(`${base}/seen/${stranger.name}`, { method: 'DELETE', headers: auth(mute) }),
        await json(`${base}/sweep`, { method: 'POST', headers: auth(mute) }),
    ];
    for (const r of acts) {
        assert(r.status === 403 && r.body.error.code === 'SCOPE_DENIED', `a memory:read agent changed the roster: ${r.status} ${JSON.stringify(r.body?.error)}`);
    }
    // An agent that holds the word still reads, so the gate is a word and not a wall.
    const reader = await agentOf(owner, ['app:write']);
    const ok = await json(base, { headers: auth(reader) });
    assert(ok.status === 200, `an app:write agent of the owner reads the roster: ${ok.status} ${JSON.stringify(ok.body?.error)}`);
});

await test('the app\'s own token manages its roster without exchange:grant; another app\'s token does not', async () => {
    const own = await appTokenFor(owner, `${owner.name}/${APP}`, 'memory:read');
    const read = await json(`/v1/apps/${owner.name}/${APP}/members`, { headers: auth(own) });
    assert(read.status === 200, `the app's own token reads its roster: ${read.status} ${JSON.stringify(read.body?.error)}`);
    const ok = await json(`/v1/apps/${owner.name}/${APP}/members`, {
        method: 'POST', headers: auth(own),
        body: JSON.stringify({ account: stranger.name, role: 'member', offerings: ['not-in-the-plan'] }),
    });
    assert(ok.status === 200 || ok.status === 201, `the app's own token approves: ${ok.status} ${JSON.stringify(ok.body?.error)}`);
    assert(!(ok.body.data.member.offerings as string[]).includes('not-in-the-plan'),
        `an app token cannot name offerings of its own: ${JSON.stringify(ok.body.data.member.offerings)}`);
    const rm = await json(`/v1/apps/${owner.name}/${APP}/members/${stranger.name}`, { method: 'DELETE', headers: auth(own) });
    assert(rm.status === 200, `the app's own token removes: ${rm.status} ${JSON.stringify(rm.body?.error)}`);

    // A token bound to a DIFFERENT app of the same owner is a different app's code.
    const other = 'roster-other.html';
    await json('/v1/apps', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({
        filename: other, name: 'Other', description: 'other app', content: Buffer.from('<!doctype html><p>o', 'utf8').toString('base64') }) });
    const foreign = await appTokenFor(owner, `${owner.name}/${other}`, 'memory:read');
    const no = await json(`/v1/apps/${owner.name}/${APP}/members`, { headers: auth(foreign) });
    assert(no.status === 403 && no.body.error.code === 'SCOPE_DENIED', `another app's token read this roster: ${no.status} ${JSON.stringify(no.body?.error)}`);

    // A member signed in to the same app holds a token of this app, and is still not the owner.
    const theirs = await appTokenFor(member, `${owner.name}/${APP}`, 'memory:read');
    const notOwner = await json(`/v1/apps/${owner.name}/${APP}/members`, {
        method: 'POST', headers: auth(theirs), body: JSON.stringify({ account: stranger.name, role: 'member' }),
    });
    assert(notOwner.status === 403 && notOwner.body.error.code === 'FORBIDDEN', `a member approved somebody: ${notOwner.status}`);
    const asked = await json(`/v1/apps/${owner.name}/${APP}/members/me`, { headers: auth(theirs) });
    assert(asked.status === 200, `and reads their own standing through it: ${asked.status}`);
});

await test('a roster call on an app that does not exist is refused and records nothing', async () => {
    const ghost = `/v1/apps/${owner.name}/no-such-app.html/members`;
    const before = (await bell(owner.token)).filter(n => n.type === 'app_member_request').length;
    const ask = await json(`${ghost}/requests`, { method: 'POST', headers: auth(stranger.token), body: JSON.stringify({ note: 'x' }) });
    assert(ask.status === 404, `asking for a made-up app was accepted: ${ask.status}`);
    const me = await json(`${ghost}/me`, { headers: auth(stranger.token) });
    assert(me.status === 404, `standing on a made-up app answered ${me.status}`);
    const after = (await bell(owner.token)).filter(n => n.type === 'app_member_request').length;
    assert(after === before, `the owner was notified about a made-up app: ${before} -> ${after}`);
});

await test('an approval refuses a role the library reads as the owner or as everything, an unknown account and a bad date', async () => {
    const base = `/v1/apps/${owner.name}/${APP}/members`;
    for (const role of ['owner', '*', 'bad role']) {
        const r = await json(base, { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ account: stranger.name, role }) });
        assert(r.status === 400, `role "${role}" was accepted: ${r.status}`);
    }
    const ghost = await json(base, { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ account: `nobody${Date.now()}`, role: 'member' }) });
    assert(ghost.status === 404, `an account nobody holds was approved: ${ghost.status}`);
    const date = await json(base, { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ account: stranger.name, role: 'member', expiresAt: 'next tuesday' }) });
    assert(date.status === 400, `an unreadable date was accepted: ${date.status}`);
    const roster = await json(base, { headers: auth(owner.token) });
    assert(!(roster.body.data.members as any[]).some(m => m.owner === stranger.name), 'and nothing was written');
});

await test('a member reads their own standing without the owner\'s note on it', async () => {
    const base = `/v1/apps/${owner.name}/${APP}/members`;
    const ok = await json(base, { method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ account: stranger.name, role: 'member', note: 'only the owner reads this' }) });
    assert(ok.status === 200 || ok.status === 201, `approve ${ok.status}: ${JSON.stringify(ok.body?.error)}`);
    const me = await json(`${base}/me`, { headers: auth(stranger.token) });
    assert(me.status === 200 && !!me.body.data.member, `standing ${me.status}: ${JSON.stringify(me.body?.data)}`);
    assert(!('note' in me.body.data.member) && !('approvedBy' in me.body.data.member),
        `the owner's records reached the member: ${JSON.stringify(me.body.data.member)}`);
    await json(`${base}/${stranger.name}`, { method: 'DELETE', headers: auth(owner.token) });
});

await test('removing a member keeps the development right the owner gave them', async () => {
    const base = `/v1/apps/${owner.name}/${APP}`;
    await json(`${base}/members`, { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ account: stranger.name, role: 'member' }) });
    const g = await json(`${base}/dev-grants/${stranger.name}`, { method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ level: 'drafter' }) });
    assert(g.status === 200, `grant ${g.status}: ${JSON.stringify(g.body?.error)}`);
    const rm = await json(`${base}/members/${stranger.name}`, { method: 'DELETE', headers: auth(owner.token) });
    assert(rm.status === 200, `remove ${rm.status}`);
    const grants = await json(`${base}/dev-grants`, { headers: auth(owner.token) });
    assert((grants.body.data.grants as any[]).some(x => x.account === stranger.name || x.owner === stranger.name),
        `the development right went with the membership: ${JSON.stringify(grants.body.data.grants)}`);
    const me = await json(`${base}/members/me`, { headers: auth(stranger.token) });
    assert(!me.body.data.member || !me.body.data.member.role, `and they are no longer a member: ${JSON.stringify(me.body.data.member)}`);
    await json(`${base}/dev-grants/${stranger.name}`, { method: 'DELETE', headers: auth(owner.token) });
});

// ── 2026-10-01: the roster from a chat (aimeat_app_manage on the node MCP server) ─────────────────
//
// The member actions reach the same routes over loopback with the session's own bearer, so what is
// under test is that an agent gets exactly what REST gives it: the work done, the permission word
// asked, and another owner's app refused.

interface McpSession { token: string; sessionId?: string }
let rpcId = 0;
async function mcpRpc(session: McpSession, method: string, params: Record<string, any> = {}): Promise<any> {
    const id = ++rpcId;
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${session.token}`,
            ...(session.sessionId ? { 'mcp-session-id': session.sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) session.sessionId = sid;
    if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
        const msgs = (await res.text()).split('\n').filter(l => l.startsWith('data: '))
            .map(l => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean);
        return msgs.find((m: any) => m.id === id) ?? msgs[0] ?? {};
    }
    return await res.json();
}
async function mcpSession(token: string): Promise<McpSession> {
    const session: McpSession = { token };
    await mcpRpc(session, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'e2e-app-members', version: '1.0.0' } });
    return session;
}
async function manage(session: McpSession, args: Record<string, unknown>): Promise<{ isError: boolean; data: any; text: string }> {
    const body = await mcpRpc(session, 'tools/call', { name: 'aimeat_app_manage', arguments: args });
    const text = body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body ?? {});
    let data: any;
    try { data = JSON.parse(text); } catch { data = { _text: text }; }
    return { isError: body?.result?.isError === true || body?.error !== undefined, data, text };
}

const CHAT_APP = 'roster-chat.html';
const chatRoster = async () => {
    const r = await json(`/v1/apps/${owner.name}/${CHAT_APP}/members`, { headers: auth(owner.token) });
    assert(r.status === 200, `roster ${r.status}: ${JSON.stringify(r.body?.error)}`);
    return r.body.data as { members: any[]; requests: any[]; seen: any[] };
};

await test('setup: the owner publishes a second app for the chat cases', async () => {
    const pub = await json('/v1/apps', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ filename: CHAT_APP, name: 'Roster chat', description: 'roster over MCP',
            content: Buffer.from('<!doctype html><title>chat</title><p>c', 'utf8').toString('base64') }),
    });
    assert(pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
});

await test('MCP: an agent of the owner with exchange:grant lists the roster, approves and removes from a chat', async () => {
    const s = await mcpSession(await agentOf(owner, ['app:write', 'exchange:grant']));
    const list = await manage(s, { action: 'members', filename: CHAT_APP });
    assert(!list.isError, `members: ${list.text}`);
    assert(Array.isArray(list.data.members) && list.data.members.length === 0, `a new app carries nobody: ${list.text}`);

    const before = (await bell(stranger.token)).filter(n => n.type === 'app_member_approved' && String(n.title).includes('roster-chat')).length;
    const set = await manage(s, { action: 'member_set', filename: CHAT_APP, account: stranger.name, role: 'member', note: 'approved from a chat', days: 30 });
    assert(!set.isError, `member_set: ${set.text}`);
    assert(set.data.created === true && set.data.member?.role === 'member', `approved as member: ${set.text}`);
    assert(typeof set.data.member?.expiresAt === 'string' && Date.parse(set.data.member.expiresAt) > Date.now() + 29 * 86400_000,
        `days reached the route as a term: ${JSON.stringify(set.data.member)}`);
    // Observed effects, not the answer: the row is on the roster REST reads, and the person was told.
    assert((await chatRoster()).members.some(m => m.owner === stranger.name), 'the approval is on the roster');
    const after = (await bell(stranger.token)).filter(n => n.type === 'app_member_approved' && String(n.title).includes('roster-chat')).length;
    assert(after === before + 1, `the approved person is told once: ${before} -> ${after}`);

    const rm = await manage(s, { action: 'member_remove', filename: CHAT_APP, account: stranger.name });
    assert(!rm.isError && rm.data.removed === true, `member_remove: ${rm.text}`);
    assert(!(await chatRoster()).members.some(m => m.owner === stranger.name), 'and the removal took them off it');

    const again = await manage(s, { action: 'member_remove', filename: CHAT_APP, account: stranger.name });
    assert(again.isError && again.text.startsWith('NOT_FOUND'), `removing nobody is the route's 404: ${again.text}`);
});

await test('MCP: an agent of the owner holding only memory:read is refused the roster, and nothing is written', async () => {
    const s = await mcpSession(await agentOf(owner, ['memory:read']));
    const set = await manage(s, { action: 'member_set', filename: CHAT_APP, account: stranger.name, role: 'member' });
    assert(set.isError && set.text.startsWith('SCOPE_DENIED'), `member_set without exchange:grant: ${set.text}`);
    const list = await manage(s, { action: 'members', filename: CHAT_APP });
    assert(list.isError && list.text.startsWith('SCOPE_DENIED'), `members without app:write: ${list.text}`);
    const decline = await manage(s, { action: 'member_decline', filename: CHAT_APP, account: stranger.name });
    assert(decline.isError && decline.text.startsWith('SCOPE_DENIED'), `member_decline without app:manage: ${decline.text}`);
    assert(!(await chatRoster()).members.some(m => m.owner === stranger.name), 'the refused approval wrote nothing');
});

await test('MCP: a non-owner reads their standing and asks to join from a chat; the owner\'s agent declines', async () => {
    const theirs = await mcpSession(await agentOf(stranger, ['social:write']));
    const me = await manage(theirs, { action: 'member_me', owner: owner.name, filename: CHAT_APP });
    assert(!me.isError, `member_me: ${me.text}`);
    assert(me.data.isOwner === false && me.data.role === null && me.data.requested === null, `a stranger with no ask: ${me.text}`);

    const noOwner = await manage(theirs, { action: 'member_request', filename: CHAT_APP });
    assert(noOwner.isError && noOwner.text.startsWith('INVALID_INPUT') && noOwner.text.includes('owner'), `asking needs the app's owner: ${noOwner.text}`);

    const ask = await manage(theirs, { action: 'member_request', owner: owner.name, filename: CHAT_APP, note: 'asked from a chat' });
    assert(!ask.isError && ask.data.recorded === true, `member_request: ${ask.text}`);
    const told = (await bell(owner.token)).filter(n => n.type === 'app_member_request' && String(n.body).includes('asked from a chat'));
    assert(told.length === 1, `the owner is told once, with the note: ${told.length}`);
    assert((await chatRoster()).requests.some(r => r.owner === stranger.name), 'the ask waits on the roster');

    const pending = await manage(theirs, { action: 'member_me', owner: owner.name, filename: CHAT_APP });
    assert(pending.data.requested?.state === 'pending', `and they read it back: ${pending.text}`);

    // Cross-owner: holding the word does not make somebody else's app theirs.
    const intruder = await mcpSession(await agentOf(stranger, ['exchange:grant', 'app:write']));
    const self = await manage(intruder, { action: 'member_set', owner: owner.name, filename: CHAT_APP, account: stranger.name, role: 'member' });
    assert(self.isError && self.text.startsWith('FORBIDDEN'), `a stranger's agent approved itself into another owner's app: ${self.text}`);
    const peek = await manage(intruder, { action: 'members', owner: owner.name, filename: CHAT_APP });
    assert(peek.isError && peek.text.startsWith('FORBIDDEN'), `and read its roster: ${peek.text}`);

    const ownersAgent = await mcpSession(await agentOf(owner, ['app:manage']));
    const no = await manage(ownersAgent, { action: 'member_decline', filename: CHAT_APP, account: stranger.name });
    assert(!no.isError && no.data.declined === true, `member_decline: ${no.text}`);
    const declined = await manage(theirs, { action: 'member_me', owner: owner.name, filename: CHAT_APP });
    assert(declined.data.requested?.state === 'declined', `the applicant reads the decision: ${declined.text}`);
});

await test('MCP: the owner\'s agent sets and reads the plan, sweeps, and clears a visitor', async () => {
    const s = await mcpSession(await agentOf(owner, ['app:write', 'app:manage', 'commerce:sell', 'exchange:grant']));
    const set = await manage(s, { action: 'member_plan_set', filename: CHAT_APP, roles: { member: [] }, seats: { member: 5 },
        terms: { member: { days: 30, renewal: 'manual' } }, roster_visibility: 'members' });
    assert(!set.isError, `member_plan_set: ${set.text}`);
    const got = await manage(s, { action: 'member_plan_get', filename: CHAT_APP });
    assert(!got.isError, `member_plan_get: ${got.text}`);
    assert(got.data.plan?.rosterVisibility === 'members' && got.data.plan?.seats?.member === 5 && got.data.plan?.terms?.member?.days === 30,
        `the plan the chat set is the plan the route keeps: ${got.text}`);

    const sweep = await manage(s, { action: 'member_sweep', filename: CHAT_APP });
    assert(!sweep.isError && typeof sweep.data.swept === 'number', `member_sweep: ${sweep.text}`);

    // A signed-in person who opens the app with no role is a visitor; reading /me is that visit.
    const visitor = await setupOwner('vis');
    await json(`/v1/apps/${owner.name}/${CHAT_APP}/members/me`, { headers: auth(visitor.token) });
    const seen = await manage(s, { action: 'members', filename: CHAT_APP });
    assert((seen.data.seen as any[]).some(v => v.owner === visitor.name), `the visitor is listed: ${seen.text}`);
    const gone = await manage(s, { action: 'member_dismiss', filename: CHAT_APP, account: visitor.name });
    assert(!gone.isError && gone.data.dismissed === true, `member_dismiss: ${gone.text}`);
    assert(!(await chatRoster()).seen.some(v => v.owner === visitor.name), 'and is off the list');

    const sellerless = await mcpSession(await agentOf(owner, ['app:write']));
    const refused = await manage(sellerless, { action: 'member_plan_set', filename: CHAT_APP, roles: { member: [] } });
    assert(refused.isError && refused.text.startsWith('SCOPE_DENIED'), `setting the plan needs commerce:sell: ${refused.text}`);
});

// ── 2026-10-02: the development right from a chat. "Let Jouni develop this app too" had no tool:
// the owner's AI could neither give the right nor name the page that gives it. ──────────────────────

async function callTool(session: McpSession, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; data: any; text: string }> {
    const body = await mcpRpc(session, 'tools/call', { name, arguments: args });
    const text = body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body ?? {});
    let data: any;
    try { data = JSON.parse(text); } catch { data = { _text: text }; }
    return { isError: body?.result?.isError === true || body?.error !== undefined, data, text };
}

await test('MCP: the owner\'s agent lets another person build the app from a chat; their agent finds it and drafts; the right is taken back', async () => {
    const s = await mcpSession(await agentOf(owner, ['app:write', 'app:manage']));
    const before = (await bell(stranger.token)).filter(n => n.type === 'app_dev_grant').length;

    const set = await manage(s, { action: 'builder_set', filename: CHAT_APP, account: stranger.name, dev_level: 'drafter', note: 'from a chat' });
    assert(!set.isError, `builder_set: ${set.text}`);
    assert(set.data.granted === true && set.data.levelName === 'drafter', `granted at drafter: ${set.text}`);
    assert(typeof set.data.next === 'string' && set.data.next.includes('building: true') && set.data.next.includes(`owner: "${owner.name}"`),
        `the answer says what the invited person's AI does next: ${set.text}`);
    assert(typeof set.data.page?.url === 'string' && set.data.page.url.endsWith('/v1/profile?tab=apps'), `and names the settings page: ${set.text}`);
    const after = (await bell(stranger.token)).filter(n => n.type === 'app_dev_grant').length;
    assert(after === before + 1, `the invited person is told once: ${before} -> ${after}`);

    const list = await manage(s, { action: 'builders', filename: CHAT_APP });
    assert(!list.isError, `builders: ${list.text}`);
    assert((list.data.grants as any[]).some(g => g.account === stranger.name && g.levelName === 'drafter'), `the right is listed: ${list.text}`);
    assert(Array.isArray(list.data.allApps) && typeof list.data.page?.url === 'string', `with the all-apps list and the page: ${list.text}`);

    // The other side: what their agent does with the answer's `next`.
    const theirs = await mcpSession(await agentOf(stranger, ['app:write']));
    const found = await callTool(theirs, 'aimeat_app_list', { building: true });
    assert(!found.isError && (found.data.apps as any[]).some(a => a.filename === CHAT_APP && a.building_for === owner.name),
        `the invited agent finds the app it may build: ${found.text}`);
    const html = Buffer.from('<!doctype html><title>chat</title><p>drafted by a builder', 'utf8').toString('base64');
    const draft = await callTool(theirs, 'aimeat_app_draft_save', { filename: CHAT_APP, owner: owner.name, content_base64: html });
    assert(!draft.isError, `the invited agent writes the owner's draft: ${draft.text}`);

    const rm = await manage(s, { action: 'builder_remove', filename: CHAT_APP, account: stranger.name });
    assert(!rm.isError && rm.data.revoked === true, `builder_remove: ${rm.text}`);
    const again = await callTool(theirs, 'aimeat_app_draft_save', { filename: CHAT_APP, owner: owner.name, content_base64: html });
    assert(again.isError, `after the revoke the draft is refused: ${again.text}`);
    await json(`/v1/apps/${owner.name}/${CHAT_APP}/draft`, { method: 'DELETE', headers: auth(owner.token) });
});

await test('MCP: builder_set is the owner\'s alone, needs app:manage, and an unknown account says how to find the right one', async () => {
    const intruder = await mcpSession(await agentOf(stranger, ['app:write', 'app:manage']));
    const self = await manage(intruder, { action: 'builder_set', filename: CHAT_APP, account: stranger.name, dev_level: 'full' });
    // Without an owner field the call names the caller's own catalogue, which holds no such app.
    assert(self.isError && /^(FORBIDDEN|NOT_FOUND)/.test(self.text), `a stranger's agent cannot give itself a right: ${self.text}`);
    const peek = await manage(intruder, { action: 'builders', filename: CHAT_APP });
    assert(peek.isError, `nor read who builds another owner's app: ${peek.text}`);

    const reader = await mcpSession(await agentOf(owner, ['app:write']));
    const noWord = await manage(reader, { action: 'builder_set', filename: CHAT_APP, account: stranger.name, dev_level: 'drafter' });
    assert(noWord.isError && noWord.text.startsWith('SCOPE_DENIED'), `builder_set without app:manage: ${noWord.text}`);

    const s = await mcpSession(await agentOf(owner, ['app:manage']));
    const nobody = await manage(s, { action: 'builder_set', filename: CHAT_APP, account: 'zz-nobody-here', dev_level: 'drafter' });
    assert(nobody.isError && nobody.text.startsWith('NOT_FOUND') && nobody.text.includes('aimeat_contact_resolve_email'),
        `an unknown account names how to find the right name: ${nobody.text}`);
    const builders = (await json(`/v1/apps/${owner.name}/${CHAT_APP}/dev-grants`, { headers: auth(owner.token) })).body.data.grants as any[];
    assert(!builders.some(g => g.account === stranger.name), `nothing refused was written: ${JSON.stringify(builders)}`);
});

// ── 2026-10-01: IAM round 2 — display names, approve by email and invitations, role-change
// notices, paging, managers, the audit trail, the decline wait, notices in the member's language,
// and the app's own token setting the plan ────────────────────────────────────────────────────────

const R2 = 'roster-r2.html';
const r2 = () => `/v1/apps/${owner.name}/${R2}/members`;
let r2member: Awaited<ReturnType<typeof setupOwner>>;
let r2mgr: Awaited<ReturnType<typeof setupOwner>>;
let r2asker: Awaited<ReturnType<typeof setupOwner>>;
let r2org = '';
const R2_CODE = 'SuperSecret99';

/** An account whose email is VERIFIED, made the one e2e-safe way there is: an organism code key. */
async function provisionWithEmail(email: string, label: string): Promise<{ name: string; code: string }> {
    assert(!!r2org, 'the round 2 setup made the organism the code keys are minted in');
    const name = `amr2${label}${Date.now().toString(36)}`;
    const mint = await json(`/v1/organisms/${r2org}/invitations/code`, { method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ email, username: name, code: R2_CODE, display_name: `R2 ${label}` }) });
    assert(mint.status === 201, `code key ${mint.status}: ${JSON.stringify(mint.body?.error)}`);
    return { name, code: R2_CODE };
}

await test('setup: the owner publishes an app for round 2, makes an organism for code keys, and three more accounts exist', async () => {
    const pub = await json('/v1/apps', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ filename: R2, name: 'Roster round 2', description: 'roster round 2',
            content: Buffer.from('<!doctype html><title>r2</title><p>r2', 'utf8').toString('base64') }),
    });
    assert(pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
    const org = await json('/v1/organisms', { method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ name: `R2 org ${Date.now()}`, type: 'project', join_policy: 'invite_only', visibility: 'public' }) });
    assert(org.status === 201, `organism ${org.status}: ${JSON.stringify(org.body?.error)}`);
    r2org = org.body.data.organism.id as string;
    r2member = await setupOwner('r2m');
    r2mgr = await setupOwner('r2g');
    r2asker = await setupOwner('r2a');
});

await test('A1: every roster row and /me carry the public display name; a plain member still cannot read the roster', async () => {
    const ask = await json(`${r2()}/requests`, { method: 'POST', headers: auth(r2member.token), body: JSON.stringify({ note: 'r2' }) });
    assert(ask.status === 201, `ask ${ask.status}`);
    const before = await json(r2(), { headers: auth(owner.token) });
    const req = (before.body.data.requests as any[]).find(r => r.owner === r2member.name);
    assert(req?.displayName === 'AM', `the request row is named: ${JSON.stringify(req)}`);
    const ok = await json(r2(), { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ account: r2member.name, role: 'member' }) });
    assert(ok.status === 201, `approve ${ok.status}: ${JSON.stringify(ok.body?.error)}`);
    const after = await json(r2(), { headers: auth(owner.token) });
    const row = (after.body.data.members as any[]).find(m => m.owner === r2member.name);
    assert(row?.displayName === 'AM', `the member row is named: ${JSON.stringify(row)}`);
    assert(after.body.data.canManage === true && after.body.data.isOwner === true, `the owner manages: ${JSON.stringify(after.body.data)}`);
    const me = await json(`${r2()}/me`, { headers: auth(r2member.token) });
    assert(me.body.data.displayName === 'AM' && me.body.data.canManage === false, `own standing: ${JSON.stringify(me.body.data)}`);
    const ownerMe = await json(`${r2()}/me`, { headers: auth(owner.token) });
    assert(ownerMe.body.data.canManage === true, `the owner's own standing says it manages: ${JSON.stringify(ownerMe.body.data)}`);
    const peek = await json(r2(), { headers: auth(r2member.token) });
    assert(peek.status === 403, `a plain member read an owner-only roster: ${peek.status}`);
});

await test('A4 + B4: a role change tells the member in their own language; a renewal tells nobody', async () => {
    const lang = await json('/v1/ghii', { method: 'PUT', headers: auth(r2member.token), body: JSON.stringify({ locale: 'fi' }) });
    assert(lang.status === 200, `set locale ${lang.status}: ${JSON.stringify(lang.body?.error)}`);
    const changed = () => bell(r2member.token).then(n => n.filter(x => x.type === 'app_member_role_changed' && String(x.title).includes('roster-r2')));
    const up = await json(r2(), { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ account: r2member.name, role: 'writer' }) });
    assert(up.status === 200 && up.body.data.created === false, `role change ${up.status}: ${JSON.stringify(up.body?.error ?? up.body.data)}`);
    const told = await changed();
    assert(told.length === 1, `the member is told once: ${told.length}`);
    assert(told[0].title === 'Roolisi sovelluksessa roster-r2 on nyt writer', `in Finnish, naming the new role: ${told[0].title}`);
    assert(String(told[0].body).includes('member'), `and the old one: ${told[0].body}`);
    await json(r2(), { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ account: r2member.name, role: 'writer' }) });
    assert((await changed()).length === 1, 'a renewal of the same role sends nothing');
    const intruder = await json(r2(), { method: 'POST', headers: auth(stranger.token), body: JSON.stringify({ account: r2member.name, role: 'member' }) });
    assert(intruder.status === 403, `a stranger changed somebody's role: ${intruder.status}`);
    assert((await changed()).length === 1, 'and the refused change told nobody');
});

await test('A5: the roster pages each list with totals and searches by account or display name', async () => {
    const ok = await json(r2(), { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ account: r2mgr.name, role: 'member' }) });
    assert(ok.status === 201, `approve ${ok.status}`);
    const p1 = await json(`${r2()}?limit=1`, { headers: auth(owner.token) });
    assert(p1.body.data.members.length === 1 && p1.body.data.total.members === 2 && p1.body.data.limit === 1, `page 1: ${JSON.stringify(p1.body.data.total)}`);
    const p2 = await json(`${r2()}?limit=1&offset=1`, { headers: auth(owner.token) });
    assert(p2.body.data.members.length === 1 && p2.body.data.members[0].owner !== p1.body.data.members[0].owner, 'page 2 is the other one');
    const byName = await json(`${r2()}?q=${encodeURIComponent(r2member.name.toUpperCase())}`, { headers: auth(owner.token) });
    assert(byName.body.data.members.length === 1 && byName.body.data.members[0].owner === r2member.name, `by account, any case: ${JSON.stringify(byName.body.data.members)}`);
    const byDisplay = await json(`${r2()}?q=am`, { headers: auth(owner.token) });
    assert(byDisplay.body.data.total.members === 2, `by display name: ${JSON.stringify(byDisplay.body.data.total)}`);
    const none = await json(`${r2()}?q=nobody-zz-${Date.now()}`, { headers: auth(owner.token) });
    assert(none.body.data.total.members === 0 && none.body.data.members.length === 0, 'a search that matches nobody');
    const clamped = await json(`${r2()}?limit=99999`, { headers: auth(owner.token) });
    assert(clamped.status === 200 && clamped.body.data.limit === 500, `a huge limit reads as 500: ${clamped.body.data.limit}`);
});

await test('A2: approve by email finds a verified account and names it; refusals come before any lookup', async () => {
    const email = `r2found.${Date.now()}@example.com`;
    const found = await provisionWithEmail(email, 'fnd');
    const ok = await json(r2(), { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ email: email.toUpperCase(), role: 'member' }) });
    assert(ok.status === 201, `approve by email ${ok.status}: ${JSON.stringify(ok.body?.error)}`);
    assert(ok.body.data.found?.account === found.name && ok.body.data.found?.displayName === 'R2 fnd', `found: ${JSON.stringify(ok.body.data.found)}`);
    assert(ok.body.data.member?.owner === found.name && ok.body.data.created === true, `approved as that account: ${JSON.stringify(ok.body.data.member)}`);
    const both = await json(r2(), { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ email, account: found.name, role: 'member' }) });
    assert(both.status === 400, `account and email together: ${both.status}`);
    const junk = await json(r2(), { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ email: 'not-an-email', role: 'member' }) });
    assert(junk.status === 400 && junk.body.error.code === 'INVALID_INPUT', `a malformed address: ${junk.status} ${JSON.stringify(junk.body?.error)}`);
    const theirs = await json(r2(), { method: 'POST', headers: auth(stranger.token), body: JSON.stringify({ email, role: 'member' }) });
    assert(theirs.status === 403, `a stranger looked up an address through somebody else's app: ${theirs.status}`);
});

let r2inviteId = '';
await test('A2: an unknown address is invited, listed for the owner, and cancelled; a stranger cannot cancel it', async () => {
    const email = `r2inv.${Date.now()}@example.com`;
    const inv = await json(r2(), { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ email, role: 'writer', note: 'from the panel' }) });
    assert(inv.status === 201 && inv.body.data.invited === true, `invite ${inv.status}: ${JSON.stringify(inv.body?.error ?? inv.body.data)}`);
    const invite = inv.body.data.invite;
    assert(typeof invite?.id === 'string' && invite.emailShown === email && invite.role === 'writer' && !('emailHash' in invite), `invite: ${JSON.stringify(invite)}`);
    assert(typeof inv.body.data.emailSent === 'boolean', 'says whether the email left');
    r2inviteId = invite.id;
    const listed = await json(`${r2()}?q=r2inv`, { headers: auth(owner.token) });
    assert((listed.body.data.invites as any[]).some(i => i.id === invite.id) && listed.body.data.total.invites === 1, `listed: ${JSON.stringify(listed.body.data.invites)}`);
    const stolen = await json(`${r2()}/invites/${invite.id}`, { method: 'DELETE', headers: auth(stranger.token) });
    assert(stolen.status === 403, `a stranger cancelled an invitation: ${stolen.status}`);
    const cancel = await json(`${r2()}/invites/${invite.id}`, { method: 'DELETE', headers: auth(owner.token) });
    assert(cancel.status === 200 && cancel.body.data.cancelled === true, `cancel ${cancel.status}: ${JSON.stringify(cancel.body?.error)}`);
    const gone = await json(r2(), { headers: auth(owner.token) });
    assert(!(gone.body.data.invites as any[]).some(i => i.id === invite.id), 'and it is off the list');
    const again = await json(`${r2()}/invites/${invite.id}`, { method: 'DELETE', headers: auth(owner.token) });
    assert(again.status === 404, `cancelling nothing: ${again.status}`);
});

await test('A2: an invited address that gets a verified account becomes a member in the invited role, and is told', async () => {
    const email = `r2join.${Date.now()}@example.com`;
    const inv = await json(r2(), { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ email, role: 'writer' }) });
    assert(inv.status === 201 && inv.body.data.invited === true, `invite ${inv.status}`);
    const joined = await provisionWithEmail(email, 'join');
    const roster = await json(r2(), { headers: auth(owner.token) });
    const row = (roster.body.data.members as any[]).find(m => m.owner === joined.name);
    assert(row?.role === 'writer', `the new account is a writer: ${JSON.stringify(row)}`);
    assert(!(roster.body.data.invites as any[]).some(i => i.id === inv.body.data.invite.id), 'and the invitation is used up');
    const lg = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: joined.name, password: joined.code }) });
    assert(lg.status === 200, `login ${lg.status}: ${JSON.stringify(lg.body?.error)}`);
    const told = (await bell(lg.body.data.token)).filter(n => n.type === 'app_member_approved' && String(n.title).includes('roster-r2'));
    assert(told.length === 1, `the new member is told once: ${told.length}`);
});

await test('B1: a member holding a managing role manages members, but not the plan, the sweep or another manager', async () => {
    const plan = await json(`${r2()}/plan`, { method: 'PUT', headers: auth(owner.token),
        body: JSON.stringify({ roles: { member: [], writer: [], admin: [] }, manageRoles: ['admin'] }) });
    assert(plan.status === 200 && plan.body.data.plan.manageRoles?.[0] === 'admin', `plan ${plan.status}: ${JSON.stringify(plan.body?.error ?? plan.body.data.plan)}`);
    const badPlan = await json(`${r2()}/plan`, { method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ roles: { member: [] }, manageRoles: ['owner'] }) });
    assert(badPlan.status === 400, `"owner" as a managing role: ${badPlan.status}`);
    const appoint = await json(r2(), { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ account: r2mgr.name, role: 'admin' }) });
    assert(appoint.status === 200, `the owner makes a manager: ${appoint.status} ${JSON.stringify(appoint.body?.error)}`);
    const me = await json(`${r2()}/me`, { headers: auth(r2mgr.token) });
    assert(me.body.data.canManage === true, `the manager's standing: ${JSON.stringify(me.body.data)}`);
    const read = await json(r2(), { headers: auth(r2mgr.token) });
    assert(read.status === 200 && read.body.data.canManage === true && read.body.data.isOwner === false, `the manager reads the roster: ${read.status}`);

    const helper = await setupOwner('r2h');
    const other = await setupOwner('r2x');
    const add = await json(r2(), { method: 'POST', headers: auth(r2mgr.token), body: JSON.stringify({ account: helper.name, role: 'member' }) });
    assert(add.status === 201, `the manager approves: ${add.status} ${JSON.stringify(add.body?.error)}`);
    const promote = await json(r2(), { method: 'POST', headers: auth(r2mgr.token), body: JSON.stringify({ account: helper.name, role: 'admin' }) });
    assert(promote.status === 403, `the manager made a manager: ${promote.status}`);
    const second = await json(r2(), { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ account: other.name, role: 'admin' }) });
    assert(second.status === 201, `the owner makes a second manager: ${second.status}`);
    const demote = await json(r2(), { method: 'POST', headers: auth(r2mgr.token), body: JSON.stringify({ account: other.name, role: 'member' }) });
    assert(demote.status === 403, `the manager demoted another manager: ${demote.status}`);
    const oust = await json(`${r2()}/${other.name}`, { method: 'DELETE', headers: auth(r2mgr.token) });
    assert(oust.status === 403, `the manager removed another manager: ${oust.status}`);
    const setPlan = await json(`${r2()}/plan`, { method: 'PUT', headers: auth(r2mgr.token), body: JSON.stringify({ roles: { member: [] } }) });
    assert(setPlan.status === 403, `the manager set the plan: ${setPlan.status}`);
    const readPlan = await json(`${r2()}/plan`, { headers: auth(r2mgr.token) });
    assert(readPlan.status === 403, `the manager read the plan: ${readPlan.status}`);
    const sweep = await json(`${r2()}/sweep`, { method: 'POST', headers: auth(r2mgr.token) });
    assert(sweep.status === 403, `the manager swept: ${sweep.status}`);
    const still = await json(r2(), { headers: auth(owner.token) });
    assert((still.body.data.members as any[]).find(m => m.owner === other.name)?.role === 'admin', 'the other manager is untouched');
    const remove = await json(`${r2()}/${helper.name}`, { method: 'DELETE', headers: auth(r2mgr.token) });
    assert(remove.status === 200, `the manager removes a plain member: ${remove.status}`);
    const plain = await json(r2(), { method: 'POST', headers: auth(r2member.token), body: JSON.stringify({ account: helper.name, role: 'member' }) });
    assert(plain.status === 403, `a plain member approved somebody: ${plain.status}`);
});

await test('A1: the owner sees the address their own address book holds for a member; a manager sees no address', async () => {
    const email = `r2book.${Date.now()}@example.com`;
    const person = await provisionWithEmail(email, 'book');
    const ok = await json(r2(), { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ account: person.name, role: 'member' }) });
    assert(ok.status === 201, `approve ${ok.status}: ${JSON.stringify(ok.body?.error)}`);
    const before = await json(`${r2()}?q=${person.name}`, { headers: auth(owner.token) });
    const bare = (before.body.data.members as any[]).find(m => m.owner === person.name);
    assert(bare && bare.email === null, `no address before the owner saved one: ${JSON.stringify(bare)}`);
    const saved = await json('/v1/contacts', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ name: 'Book Person', email }) });
    assert(saved.status === 201 || saved.status === 200, `save the contact ${saved.status}: ${JSON.stringify(saved.body?.error)}`);
    const after = await json(`${r2()}?q=${encodeURIComponent(email)}`, { headers: auth(owner.token) });
    const row = (after.body.data.members as any[]).find(m => m.owner === person.name);
    assert(row?.email === email, `the owner's row carries the saved address, and a search by it finds the row: ${JSON.stringify(after.body.data.members)}`);
    const mgr = await json(`${r2()}?q=${person.name}`, { headers: auth(r2mgr.token) });
    const theirs = (mgr.body.data.members as any[]).find(m => m.owner === person.name);
    assert(theirs && !('email' in theirs), `a manager reads no address from the owner's address book: ${JSON.stringify(theirs)}`);
});

await test('B2: every decision is on the audit trail, newest first; a plain member and a scope-less agent are refused', async () => {
    const all = await json(`${r2()}/audit?limit=500`, { headers: auth(owner.token) });
    assert(all.status === 200, `audit ${all.status}: ${JSON.stringify(all.body?.error)}`);
    const rows = all.body.data.entries as any[];
    const actions = new Set(rows.map(r => r.action));
    for (const a of ['member.approved', 'member.role_changed', 'member.removed', 'invite.sent', 'invite.cancelled', 'plan.changed']) {
        assert(actions.has(a), `${a} is on the trail: ${JSON.stringify([...actions])}`);
    }
    assert(rows.every((r, i) => i === 0 || rows[i - 1].at >= r.at), 'newest first');
    const change = rows.find(r => r.action === 'member.role_changed' && r.account === r2member.name);
    assert(change?.from === 'member' && change?.to === 'writer' && typeof change.by === 'string', `from and to: ${JSON.stringify(change)}`);
    assert(rows.some(r => r.action === 'invite.cancelled' && r.detail?.invite === r2inviteId), 'the cancel names the invitation');
    assert(rows.filter(r => String(r.action).startsWith('invite.')).every(r => typeof r.detail?.email === 'string' && r.detail.email.includes('@')),
        `an invitation row names the address: ${JSON.stringify(rows.filter(r => String(r.action).startsWith('invite.')))}`);
    assert(!actions.has('dev.granted') && rows.every(r => !String(r.action).startsWith('legal.')), 'and only roster actions');
    const page = await json(`${r2()}/audit?limit=2`, { headers: auth(owner.token) });
    assert(page.body.data.entries.length === 2 && typeof page.body.data.nextBefore === 'string', `paged: ${JSON.stringify(page.body.data.nextBefore)}`);
    const next = await json(`${r2()}/audit?limit=2&before=${encodeURIComponent(page.body.data.nextBefore)}`, { headers: auth(owner.token) });
    assert(next.body.data.entries.every((r: any) => r.at < page.body.data.nextBefore), 'the next page is older');
    const mgr = await json(`${r2()}/audit`, { headers: auth(r2mgr.token) });
    assert(mgr.status === 200, `a manager reads the trail: ${mgr.status}`);
    const member = await json(`${r2()}/audit`, { headers: auth(r2member.token) });
    assert(member.status === 403, `a plain member read the trail: ${member.status}`);
    const theirs = await json(`${r2()}/audit`, { headers: auth(stranger.token) });
    assert(theirs.status === 403, `a stranger read the trail: ${theirs.status}`);
    const mute = await json(`${r2()}/audit`, { headers: auth(await agentOf(owner, ['memory:read'])) });
    assert(mute.status === 403 && mute.body.error.code === 'SCOPE_DENIED', `a memory:read agent read the trail: ${mute.status} ${JSON.stringify(mute.body?.error)}`);
});

await test('B3: a decline tells the person; asking again within 7 days is refused without ringing the owner', async () => {
    const ask = await json(`${r2()}/requests`, { method: 'POST', headers: auth(r2asker.token), body: JSON.stringify({ note: 'first ask' }) });
    assert(ask.status === 201, `ask ${ask.status}`);
    const no = await json(`${r2()}/requests/${r2asker.name}`, { method: 'DELETE', headers: auth(owner.token) });
    assert(no.status === 200 && no.body.data.declined === true && typeof no.body.data.retryAt === 'string', `decline: ${JSON.stringify(no.body?.data ?? no.body?.error)}`);
    const declinedBell = () => bell(r2asker.token).then(n => n.filter(x => x.type === 'app_member_declined' && String(x.title).includes('roster-r2')));
    assert((await declinedBell()).length === 1, 'the declined person is told once');
    const twice = await json(`${r2()}/requests/${r2asker.name}`, { method: 'DELETE', headers: auth(owner.token) });
    assert(twice.status === 200 && (await declinedBell()).length === 1, 'declining again tells nobody again');
    const asks = () => bell(owner.token).then(n => n.filter(x => x.type === 'app_member_request' && String(x.title).includes(r2asker.name)));
    const rung = (await asks()).length;
    const again = await json(`${r2()}/requests`, { method: 'POST', headers: auth(r2asker.token), body: JSON.stringify({ note: 'second ask' }) });
    assert(again.status === 429 && again.body.error.code === 'REASK_TOO_SOON', `asking again at once: ${again.status} ${JSON.stringify(again.body?.error)}`);
    assert(again.body.error.details?.retryAt === no.body.data.retryAt, `with the date: ${JSON.stringify(again.body.error.details)}`);
    assert((await asks()).length === rung, 'and the owner was not rung again');
    const me = await json(`${r2()}/me`, { headers: auth(r2asker.token) });
    assert(me.body.data.requested?.state === 'declined' && me.body.data.requested?.retryAt === no.body.data.retryAt, `own standing: ${JSON.stringify(me.body.data.requested)}`);
    const nobody = await json(`${r2()}/requests/${stranger.name}`, { method: 'DELETE', headers: auth(owner.token) });
    assert(nobody.status === 404, `declining somebody who never asked: ${nobody.status}`);
});

await test('the app\'s own token sets the plan but cannot add an offering; another app\'s token and a member\'s token are refused', async () => {
    const own = await appTokenFor(owner, `${owner.name}/${R2}`, 'memory:read');
    const set = await json(`${r2()}/plan`, { method: 'PUT', headers: auth(own),
        body: JSON.stringify({ roles: { member: [], writer: [], admin: [] }, seats: { member: 50 } }) });
    assert(set.status === 200, `the app's own token set the plan: ${set.status} ${JSON.stringify(set.body?.error)}`);
    assert(set.body.data.plan.seats.member === 50 && set.body.data.plan.manageRoles?.[0] === 'admin', `kept the managers it did not name: ${JSON.stringify(set.body.data.plan)}`);
    const carry = await json(`${r2()}/plan`, { method: 'PUT', headers: auth(own), body: JSON.stringify({ roles: { member: ['off-r2-x'] } }) });
    assert(carry.status === 403, `the app's own token added an offering: ${carry.status}`);
    const other = await appTokenFor(owner, `${owner.name}/${CHAT_APP}`, 'memory:read');
    const cross = await json(`${r2()}/plan`, { method: 'PUT', headers: auth(other), body: JSON.stringify({ roles: { member: [] } }) });
    assert(cross.status === 403 && cross.body.error.code === 'SCOPE_DENIED', `another app's token set this app's plan: ${cross.status} ${JSON.stringify(cross.body?.error)}`);
    const membersOwn = await appTokenFor(r2member, `${owner.name}/${R2}`, 'memory:read');
    const byMember = await json(`${r2()}/plan`, { method: 'PUT', headers: auth(membersOwn), body: JSON.stringify({ roles: { member: [] } }) });
    assert(byMember.status === 403 && byMember.body.error.code === 'FORBIDDEN', `a member's token of the app set the plan: ${byMember.status} ${JSON.stringify(byMember.body?.error)}`);
    const plan = await json(`${r2()}/plan`, { headers: auth(owner.token) });
    assert(plan.body.data.plan.seats.member === 50 && (plan.body.data.plan.roles.member ?? []).length === 0, 'and the refused writes changed nothing');
});

// ── 2026-10-01: the invitation carries a sign-up link. It opens the invitation page with the address
// filled in; the account it creates starts with that address confirmed and is a member at once. The
// link lives 7 days, is used once, dies with a cancel, and a new invitation replaces it. ─────────────

/** The token out of an accept address `<base>/v1/invite?token=<raw>`. */
const tokenOf = (url: string) => new URL(url).searchParams.get('token') ?? '';

await test('A2 link: an invitation answers a sign-up link when no email left, valid 7 days, describing the app', async () => {
    const email = `r2link.${Date.now()}@example.com`;
    const inv = await json(r2(), { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ email, role: 'writer' }) });
    assert(inv.status === 201 && inv.body.data.invited === true, `invite ${inv.status}: ${JSON.stringify(inv.body?.error)}`);
    assert(inv.body.data.emailSent === false, 'this node sends no mail in E2E');
    const url = inv.body.data.acceptUrl as string;
    assert(typeof url === 'string' && url.includes('/v1/invite?token='), `the link to pass on: ${url}`);
    const days = (Date.parse(inv.body.data.invite.expiresAt) - Date.now()) / 86_400_000;
    assert(days > 6.9 && days <= 7.01, `valid 7 days: ${days}`);
    const card = await json(`/v1/invitations/${tokenOf(url)}`);
    assert(card.status === 200 && card.body.data.invitation.kind === 'app', `the link describes an app invitation: ${card.status} ${JSON.stringify(card.body?.error ?? card.body.data)}`);
    assert(card.body.data.invitation.email === email && card.body.data.invitation.app?.name === 'roster-r2' && card.body.data.invitation.app?.role === 'writer',
        `the address, the app and the role: ${JSON.stringify(card.body.data.invitation)}`);
});

await test('A2 link: opening it makes the account, a member of this app at once, back in the app, the address still to verify; used once', async () => {
    const email = `r2acc.${Date.now()}@example.com`;
    // A second app's invitation to the same address. The link proves only its own app, so this one
    // waits for the address to be verified (secaudit 2026-10, APP-2).
    const other = await json(`/v1/apps/${owner.name}/${APP}/members`, { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ email, role: 'member' }) });
    assert(other.status === 201 && other.body.data.invited === true, `the other app's invitation ${other.status}: ${JSON.stringify(other.body?.error)}`);
    const inv = await json(r2(), { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ email, role: 'writer' }) });
    const token = tokenOf(inv.body.data.acceptUrl);
    const name = `amr2lnk${Date.now().toString(36)}`;
    const ok = await json(`/v1/invitations/${token}/accept`, { method: 'POST', body: JSON.stringify({ username: name, password: 'Sup3r-Secret-Pw!42' }) });
    assert(ok.status === 200 && ok.body.data.status === 'joined_app' && ok.body.data.created_account === true, `accept ${ok.status}: ${JSON.stringify(ok.body?.error ?? ok.body.data)}`);
    assert(String(ok.body.data.redirect).includes('roster-r2'), `back to the app: ${ok.body.data.redirect}`);
    assert(typeof ok.body.data.token === 'string', 'signed in');
    const roster = await json(r2(), { headers: auth(owner.token) });
    const row = (roster.body.data.members as any[]).find(m => m.owner === name);
    assert(row?.role === 'writer', `a writer at once: ${JSON.stringify(row)}`);
    assert(!(roster.body.data.invites as any[]).some(i => i.id === inv.body.data.invite.id), 'and the invitation is used up');
    const me = await json('/v1/ghii/me', { headers: auth(ok.body.data.token) });
    // Opening the link does not verify the address: the link reaches whoever holds it, the inviter
    // too when no mail left. The address is kept and gets the usual code (secaudit 2026-10, APP-2).
    assert(me.status === 200 && !me.body.data.email_verified_at && me.body.data.notification_email === email, `the address is kept, not verified: ${me.status} ${JSON.stringify(me.body?.data ?? me.body?.error).slice(0, 300)}`);
    const otherRoster = await json(`/v1/apps/${owner.name}/${APP}/members`, { headers: auth(owner.token) });
    assert(!(otherRoster.body.data.members as any[]).some(m => m.owner === name), 'the other app\'s invitation did not apply');
    assert((otherRoster.body.data.invites as any[]).some(i => i.id === other.body.data.invite.id), 'it stays open for the verified address');
    const twice = await json(`/v1/invitations/${token}/accept`, { method: 'POST', body: JSON.stringify({ username: `${name}b`, password: 'Sup3r-Secret-Pw!42' }) });
    assert(twice.status === 410 && twice.body.error.code === 'INVITE_USED', `a second use: ${twice.status} ${JSON.stringify(twice.body?.error)}`);
});

await test('A2 link: a cancel kills the link, a new invitation to the same address replaces it, a different account is refused', async () => {
    const email = `r2re.${Date.now()}@example.com`;
    const first = await json(r2(), { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ email, role: 'member' }) });
    const old = tokenOf(first.body.data.acceptUrl);
    const again = await json(r2(), { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ email, role: 'member' }) });
    assert(again.status === 201 && again.body.data.invite.id === first.body.data.invite.id, `renewed, same invitation: ${JSON.stringify(again.body.data.invite)}`);
    const fresh = tokenOf(again.body.data.acceptUrl);
    assert(fresh && fresh !== old, 'a new link');
    const dead = await json(`/v1/invitations/${old}`);
    assert(dead.status === 404, `the old link: ${dead.status}`);
    const wrong = await json(`/v1/invitations/${fresh}/accept`, { method: 'POST', headers: auth(stranger.token) });
    assert(wrong.status === 403 && wrong.body.error.code === 'EMAIL_MISMATCH', `another account took it: ${wrong.status} ${JSON.stringify(wrong.body?.error)}`);
    const cancel = await json(`${r2()}/invites/${again.body.data.invite.id}`, { method: 'DELETE', headers: auth(owner.token) });
    assert(cancel.status === 200, `cancel ${cancel.status}`);
    const gone = await json(`/v1/invitations/${fresh}`);
    assert(gone.status === 404, `the cancelled link: ${gone.status}`);
    const take = await json(`/v1/invitations/${fresh}/accept`, { method: 'POST', body: JSON.stringify({ username: `amr2c${Date.now().toString(36)}`, password: 'Sup3r-Secret-Pw!42' }) });
    assert(take.status === 404, `the cancelled link made an account: ${take.status} ${JSON.stringify(take.body?.error ?? take.body.data)}`);
});

// ── 2026-10-05: secaudit 2026-10, APP-1, APP-3 and APP-5 ─────────────────────────────────────────

await test('APP-1: the app\'s own token may not change who pays or who manages; the plan\'s offerings it may still keep', async () => {
    const own = await appTokenFor(owner, `${owner.name}/${R2}`, 'memory:read');
    const set = await json(`${r2()}/plan`, { method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ roles: { member: [] }, access: 'members-free' }) });
    assert(set.status === 200, `owner sets the plan: ${set.status} ${JSON.stringify(set.body?.error)}`);
    for (const body of [{ roles: { member: [] }, access: 'free' }, { roles: { member: [] }, manageRoles: ['member'] }, { roles: { member: [] }, rosterVisibility: 'members' }]) {
        const r = await json(`${r2()}/plan`, { method: 'PUT', headers: auth(own), body: JSON.stringify(body) });
        assert(r.status === 403 && r.body.error.code === 'FORBIDDEN', `the app's token changed ${Object.keys(body)[1]}: ${r.status} ${JSON.stringify(r.body?.error ?? r.body.data?.plan)}`);
    }
    const keep = await json(`${r2()}/plan`, { method: 'PUT', headers: auth(own), body: JSON.stringify({ roles: { member: [] }, access: 'members-free' }) });
    assert(keep.status === 200, `the same plan from the app's token: ${keep.status} ${JSON.stringify(keep.body?.error)}`);
    const plan = await json(`${r2()}/plan`, { headers: auth(owner.token) });
    assert(plan.body.data.plan?.access === 'members-free', `the access stayed the owner's: ${JSON.stringify(plan.body.data.plan)}`);
});

await test('APP-3: adding by email tells only the owner in person whether the address has an account here', async () => {
    const email = `r2probe.${Date.now()}@example.com`;
    await provisionWithEmail(email, 'prb');
    const own = await appTokenFor(owner, `${owner.name}/${R2}`, 'memory:read');
    const viaApp = await json(r2(), { method: 'POST', headers: auth(own), body: JSON.stringify({ email, role: 'member' }) });
    assert(viaApp.status === 201 && !viaApp.body.data.found && !!viaApp.body.data.invite,
        `the app's token gets an invitation and no account name: ${viaApp.status} ${JSON.stringify(viaApp.body.data ?? viaApp.body?.error)}`);
    const viaOwner = await json(r2(), { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ email, role: 'member' }) });
    assert(viaOwner.status === 201 && !!viaOwner.body.data.found, `the owner in person finds the account: ${viaOwner.status} ${JSON.stringify(viaOwner.body.data ?? viaOwner.body?.error)}`);
});

await test('APP-5: dismissing a guest who never came writes nothing to the audit log', async () => {
    const before = await json(`${r2()}/audit`, { headers: auth(owner.token) });
    const count = before.body.data?.total;
    assert(typeof count === 'number' && count > 0, `the log holds the earlier round's rows: ${JSON.stringify(before.body.data)}`);
    const r = await json(`${r2()}/seen/nobody${Date.now()}`, { method: 'DELETE', headers: auth(owner.token) });
    assert(r.status === 200 && r.body.data.dismissed === false, `a made-up guest: ${r.status} ${JSON.stringify(r.body.data)}`);
    const after = await json(`${r2()}/audit`, { headers: auth(owner.token) });
    assert(after.body.data?.total === count, `the log grew from ${count} to ${after.body.data?.total}`);
});

console.log(`\napp member roster E2E: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);

