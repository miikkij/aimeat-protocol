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

await test('an offering that is not the owner\'s is REPORTED, not skipped', async () => {
    const theirs = await setupOwner('oth');
    // A listing the approver does not own must not be silently dropped from the promise.
    const r = await json(`/v1/apps/${owner.name}/${APP}/members`, {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ account: member.name, role: 'reader', offerings: [offA, 'off-does-not-exist'] }),
    });
    assert(r.status === 200, `approve ${r.status}`);
    const acc = r.body.data.access;
    assert(acc.failed.length === 1, `the bad one is named: ${JSON.stringify(acc.failed)}`);
    assert(acc.failed[0].offeringId === 'off-does-not-exist', 'by id');
    assert(acc.unchanged.length === 1, 'and the good one still stands');
    void theirs;
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
await test('a declared carry plan makes a bare approval actually carry the member', async () => {
    const plan = await json(`/v1/apps/${owner.name}/${APP}/members/plan`, {
        method: 'PUT', headers: auth(owner.token),
        body: JSON.stringify({ roles: { member: [offA, offB], guest: [] } }),
    });
    assert(plan.status === 200, `the plan is declarable: ${plan.status} ${JSON.stringify(plan.body?.error)}`);
    assert(plan.body.data.plan.roles.member.length === 2, `and reads back: ${JSON.stringify(plan.body.data.plan.roles)}`);

    // A stranger, approved the way the panel approves: a role and nothing else.
    const newcomer = await setupOwner('carry');
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

console.log(`\napp member roster E2E: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);

