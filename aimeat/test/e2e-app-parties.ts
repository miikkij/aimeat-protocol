/**
 * @file e2e-app-parties.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for an app's own users as outside parties (plan doc-mvwxcas3dom3, D4). The suite
 *   runs its own node with mail on, pointed at a fake SMTP server in this process, because the
 *   sign-in link reaches the person by mail and the runner's node sends none.
 *   D4.3 the setting: off refuses the signup and the owner's opening; apps-ask files a request the
 *     operator approves (another account cannot open the app, an owner cannot read the requests);
 *     on opens it; a node that shows its content to signed-in accounts only is off whatever the setting.
 *   D4.2 signup, the mailed link, verify (once), me, a sign-in link, sign-out ending every session;
 *     party data isolation (one party never reads another's collection, the shared collection is the
 *     app's), and the party token refused on node routes, on the data package reads and on another app.
 *   D4.1 the roster lists a registered party, takes an owner's party by its identity, refuses another
 *     owner's; the owner sees and removes a party, and its sign-in ends at once.
 *   D4.4, D4.5 the data map's DATAMAP_REGISTERS_UNSTATED, and finding (d) of section 12 counts an app
 *     whose signup is open and that sells.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=app-parties
 * @version-history
 *   v1.1.0 — 2026-11-01 — D4.3 over MCP: aimeat_admin_app_party_registrations lists and decides for the
 *     operator and refuses an owner's agent (WP9b; the tool did not exist, so the test fails on the old code).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D4).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { startFakeSmtp, type FakeSmtp } from './helpers/fake-smtp.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const PORT = Number(process.env.E2E_APP_PARTIES_PORT ?? 28560);
const SMTP_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PW = 'app-parties-admin-pw';
const stamp = Date.now() % 1_000_000;

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
interface Answer { status: number; body: Body; text: string }
async function call(path: string, opts: { token?: string; body?: unknown; method?: string; headers?: Record<string, string> } = {}): Promise<Answer> {
    const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), ...opts.headers },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let body: Body = { _raw: text };
    try { body = JSON.parse(text) as Body; } catch { /* a non-JSON body stays raw */ }
    return { status: res.status, body, text };
}
const show = (r: Answer) => `${r.status} ${r.text.slice(0, 400)}`;
const codeOf = (r: Answer) => r.body?.error?.code;

let node: ChildProcess | null = null;
let smtp: FakeSmtp | null = null;
let OP = { name: '', token: '' }, A = { name: '', token: '' }, C = { name: '', token: '' };
let nodeId = '';
const APP = 'market.html', OTHER = 'other.html';
const P = (suffix: string, app = APP, owner = A.name) => `/v1/apps/${owner}/${app}${suffix}`;
const setConfig = (path: string, value: unknown) => call('/v1/admin/config', { token: OP.token, method: 'PUT', body: { changes: [{ path, value }] } });
const linkIn = async (to: string): Promise<string> => {
    const mail = await smtp!.waitForMail(to, /aimeat_party_link=/, 20_000);
    const m = /aimeat_party_link=([A-Za-z0-9_%-]+)/.exec(mail.text);
    const link = m?.[1] ?? '';
    assert(link.length >= 20, `no link in the mail: ${mail.text.slice(0, 300)}`);
    return decodeURIComponent(link);
};
const publish = (token: string, filename: string) => call('/v1/apps', {
    token, body: { filename, name: filename, description: 'app parties e2e', content: Buffer.from('<!doctype html><title>m</title><p>market', 'utf8').toString('base64') },
});
let X = { token: '', name: '', ref: '' }, Y = { token: '', name: '', ref: '' };
const emailX = `x${stamp}@example.test`, emailY = `y${stamp}@example.test`;

async function startNode(): Promise<void> {
    smtp = await startFakeSmtp({ port: SMTP_PORT });
    const db = await ownNodeDb(String(PORT));
    node = spawn('node', [...nodeEntryArgs(), 'start', ...db.args, '--port', String(PORT)], {
        cwd: process.cwd(),
        env: {
            ...process.env, ...db.env,
            AIMEAT_PORT: String(PORT), AIMEAT_BASE_URL: BASE, AIMEAT_ADMIN_PASSWORD: ADMIN_PW,
            AIMEAT_ANONYMOUS: 'false',
            AIMEAT_PARTY_SELF_REGISTRATION: 'off',
            AIMEAT_SMTP_HOST: '127.0.0.1', AIMEAT_SMTP_PORT: String(SMTP_PORT), AIMEAT_SMTP_SECURE: 'false',
            AIMEAT_SMTP_REJECT_UNAUTHORIZED: 'false', AIMEAT_SMTP_FROM: 'AIMEAT Test <noreply@aimeat.test>',
            AIMEAT_DEFAULT_AGENT_SCOPES: '*',
            AIMEAT_RL_GLOBAL: '100000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000', AIMEAT_RL_MEMORY: '10000',
            AIMEAT_RL_GHII: '10000', AIMEAT_RL_OWNERS: '10000',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForServer(node, BASE, { label: 'the app parties node' });
}

async function stopAll(): Promise<void> {
    if (node) { const dying = node; node = null; dying.kill(); await Promise.race([once(dying, 'exit'), new Promise(r => setTimeout(r, 15_000))]); }
    if (smtp) { await smtp.close(); smtp = null; }
}

async function run(): Promise<void> {
    await startNode();
    console.log('\n=== AIMEAT app parties E2E ===\n');

    await test('Setup: an operator, owner A with two apps, and C', async () => {
        const op = await registerOwner(BASE, `apop${stamp}`); OP = { name: op.name, token: op.token };
        assert(op.roles?.includes('operator'), `the first owner is the operator: ${JSON.stringify(op.roles)}`);
        nodeId = op.ghii.split('@')[1]!;
        const a = await registerOwner(BASE, `apa${stamp}`); A = { name: a.name, token: a.token };
        const c = await registerOwner(BASE, `apc${stamp}`); C = { name: c.name, token: c.token };
        for (const f of [APP, OTHER]) assert([200, 201].includes((await publish(A.token, f)).status), `publish ${f}`);
        assert([200, 201].includes((await publish(C.token, APP)).status), 'C publishes an app of the same name');
    });

    console.log('\nD4.3 the setting');

    await test('D4.3 off: the signup and the owner\'s opening are refused', async () => {
        const reg = await call(P('/parties/registration'));
        assert(reg.status === 200 && reg.body.data.open === false && reg.body.data.effective === 'off', `registration: ${show(reg)}`);
        const open = await call(P('/parties/registration'), { token: A.token, method: 'PUT', body: { open: true } });
        assert(open.status === 403 && codeOf(open) === 'PARTY_REGISTRATION_OFF', `open: ${show(open)}`);
        const s = await call(P('/parties/signup'), { body: { email: emailX } });
        assert(s.status === 403 && codeOf(s) === 'PARTY_REGISTRATION_OFF', `signup: ${show(s)}`);
    });

    await test('D4.3 apps-ask: the owner asks, the operator approves; C cannot open A\'s app nor read the requests', async () => {
        assert((await setConfig('consent.party_self_registration', 'apps-ask')).status === 200, 'apps-ask');
        const ask = await call(P('/parties/registration'), { token: A.token, method: 'PUT', body: { open: true } });
        assert(ask.status === 200 && ask.body.data.registration.state === 'requested' && ask.body.data.registration.open === false, `ask: ${show(ask)}`);
        const early = await call(P('/parties/signup'), { body: { email: emailX } });
        assert(early.status === 403 && codeOf(early) === 'PARTY_REGISTRATION_CLOSED', `before approval: ${show(early)}`);
        const byC = await call(P('/parties/registration'), { token: C.token, method: 'PUT', body: { open: true } });
        assert(byC.status === 403, `C opens A's app: ${show(byC)}`);
        const notOp = await call('/v1/admin/app-party-registrations', { token: A.token });
        assert(notOp.status === 403, `A reads the requests: ${show(notOp)}`);
        const list = await call('/v1/admin/app-party-registrations', { token: OP.token });
        assert(list.status === 200 && (list.body.data.apps as Body[]).some(x => x.owner === A.name && x.state === 'requested'), `requests: ${show(list)}`);
        const ok = await call(`/v1/admin/app-party-registrations/${A.name}/${APP}`, { token: OP.token, body: { decision: 'approve' } });
        assert(ok.status === 200 && ok.body.data.registration.open === true, `approve: ${show(ok)}`);
        assert((await call(P('/parties/registration'))).body.data.open === true, 'open after approval');
    });

    await test('D4.3 over MCP: the operator lists the requests and decides one; an owner\'s agent is refused', async () => {
        const ask = await call(P('/parties/registration', OTHER), { token: A.token, method: 'PUT', body: { open: true } });
        assert(ask.status === 200 && ask.body.data.registration.state === 'requested', `ask: ${show(ask)}`);
        const opAgent = await makeAgent(BASE, OP, ['operator:admin']);
        const opSession = await openSession(BASE, opAgent.token, 'app-parties-operator');
        const ownAgent = await makeAgent(BASE, A, ['app:manage', 'party:manage']);
        const ownSession = await openSession(BASE, ownAgent.token, 'app-parties-owner');
        const refusedList = await callTool(ownSession, 'aimeat_admin_app_party_registrations', {});
        assert(refusedList.isError && /FORBIDDEN|SCOPE_DENIED/.test(refusedList.text), `an owner's agent lists: ${refusedList.text.slice(0, 300)}`);
        const refusedDecide = await callTool(ownSession, 'aimeat_admin_app_party_registrations', { action: 'decide', owner: A.name, app: OTHER, decision: 'approve' });
        assert(refusedDecide.isError && /FORBIDDEN|SCOPE_DENIED/.test(refusedDecide.text), `an owner's agent decides: ${refusedDecide.text.slice(0, 300)}`);
        assert((await call(P('/parties/registration', OTHER))).body.data.open === false, 'the refused decision changed nothing');
        const list = await callTool(opSession, 'aimeat_admin_app_party_registrations', { action: 'list' });
        assert(!list.isError && (list.data.apps as Body[]).some(x => x.owner === A.name && x.filename === OTHER && x.state === 'requested'), `the operator's list: ${list.text.slice(0, 400)}`);
        const refuse = await callTool(opSession, 'aimeat_admin_app_party_registrations', { action: 'decide', owner: A.name, app: OTHER, decision: 'refuse', reason: 'Not this one' });
        assert(!refuse.isError && refuse.data.registration?.state === 'refused', `refuse: ${refuse.text.slice(0, 400)}`);
        const again = await callTool(opSession, 'aimeat_admin_app_party_registrations', { action: 'decide', owner: A.name, app: OTHER, decision: 'approve' });
        assert(again.isError && /NOT_REQUESTED/.test(again.text), `nothing waits now: ${again.text.slice(0, 300)}`);
    });

    console.log('\nD4.2 sign up, sign in, the session');

    await test('D4.2 signup mails a link; verify opens it once and answers the session; me', async () => {
        assert((await setConfig('consent.party_self_registration', 'on')).status === 200, 'on');
        const s = await call(P('/parties/signup'), { body: { email: emailX, display_name: 'Xavier' } });
        assert(s.status === 202 && s.body.data.sent === true, `signup: ${show(s)}`);
        const link = await linkIn(emailX);
        const v = await call(P('/parties/verify'), { body: { token: link } });
        assert(v.status === 200 && v.body.data.token?.startsWith('aimeat_party_') && v.body.data.party.status === 'active', `verify: ${show(v)}`);
        X = { token: v.body.data.token, name: v.body.data.party.name, ref: v.body.data.party.party_ref };
        assert(X.name.startsWith('ap-') && X.ref === `party:${A.name}/${X.name}@${nodeId}` && v.body.data.role === 'member', `identity: ${JSON.stringify(v.body.data.party)}`);
        const again = await call(P('/parties/verify'), { body: { token: link } });
        assert(again.status === 401 && codeOf(again) === 'LINK_INVALID', `a link opens once: ${show(again)}`);
        const me = await call(P('/parties/me'), { token: X.token });
        assert(me.status === 200 && me.body.data.party.email === emailX && me.body.data.role === 'member', `me: ${show(me)}`);
        const bad = await call(P('/parties/signup'), { body: { email: 'not an address' } });
        assert(bad.status === 400, `a bad address: ${show(bad)}`);
    });

    await test('D4.2 a second signup of the address answers the same and mails a sign-in link; sign-out ends every session', async () => {
        smtp!.clear();
        const s = await call(P('/parties/signup'), { body: { email: emailX } });
        assert(s.status === 202 && s.body.data.sent === true, `the same answer: ${show(s)}`);
        const second = await call(P('/parties/verify'), { body: { token: await linkIn(emailX) } });
        assert(second.status === 200, `the sign-in link: ${show(second)}`);
        smtp!.clear();
        const none = await call(P('/parties/signin'), { body: { email: `nobody${stamp}@example.test` } });
        assert(none.status === 202, `an unknown address answers the same: ${show(none)}`);
        const out = await call(P('/parties/signout'), { token: second.body.data.token, body: {} });
        assert(out.status === 200, `signout: ${show(out)}`);
        const old = await call(P('/parties/me'), { token: X.token });
        assert(old.status === 401, `the first session ended too: ${show(old)}`);
        smtp!.clear();
        assert((await call(P('/parties/signin'), { body: { email: emailX } })).status === 202, 'signin');
        const fresh = await call(P('/parties/verify'), { body: { token: await linkIn(emailX) } });
        assert(fresh.status === 200, `signed in again: ${show(fresh)}`);
        X.token = fresh.body.data.token;
    });

    await test('D4.2 party data: each party reads its own collection only; the shared one is the app\'s', async () => {
        smtp!.clear();
        assert((await call(P('/parties/signup'), { body: { email: emailY } })).status === 202, 'Y signs up');
        const v = await call(P('/parties/verify'), { body: { token: await linkIn(emailY) } });
        assert(v.status === 200, `Y verify: ${show(v)}`);
        Y = { token: v.body.data.token, name: v.body.data.party.name, ref: v.body.data.party.party_ref };
        const put = await call(P('/party-data/cart'), { token: X.token, method: 'PUT', body: { value: { items: ['apples'] } } });
        assert(put.status === 200 && put.body.data.stored === true, `X writes: ${show(put)}`);
        const mine = await call(P('/party-data/cart'), { token: X.token });
        assert(mine.status === 200 && mine.body.data.value?.items?.[0] === 'apples', `X reads: ${show(mine)}`);
        const theirs = await call(P('/party-data/cart'), { token: Y.token });
        assert(theirs.status === 200 && theirs.body.data.value === null, `Y reads its own, empty: ${show(theirs)}`);
        assert((await call(P('/party-data-shared/prices'), { token: A.token, method: 'PUT', body: { value: { apples: 2 } } })).status === 200, 'the app shares a collection');
        const shared = await call(P('/party-data/prices?shared=true'), { token: Y.token });
        assert(shared.status === 200 && shared.body.data.value?.apples === 2, `Y reads the shared one: ${show(shared)}`);
        const partyShares = await call(P('/party-data-shared/prices'), { token: X.token, method: 'PUT', body: { value: {} } });
        assert(partyShares.status === 401, `a party writes the shared one: ${show(partyShares)}`);
        const badKey = await call(P('/party-data/..%2Fmemory'), { token: X.token });
        assert(badKey.status === 400 && codeOf(badKey) === 'INVALID_INPUT', `a key outside the collections: ${show(badKey)}`);
        const del = await call(P('/party-data/cart'), { token: X.token, method: 'DELETE' });
        assert(del.status === 200 && del.body.data.deleted === true, `delete: ${show(del)}`);
    });

    await test('D4.2 the party token is never a node session: memory, parties, the package reads and another app refuse it', async () => {
        for (const path of ['/v1/memory?prefix=app-party-data', '/v1/parties', '/v1/agents', `/v1/datapackages/${A.name}/anything`, `/v1/odata/${A.name}/anything`]) {
            const r = await call(path, { token: X.token });
            assert(r.status === 401, `${path}: ${show(r)}`);
        }
        const other = await call(P('/parties/me', OTHER), { token: X.token });
        assert(other.status === 401, `another app of A: ${show(other)}`);
        const cApp = await call(P('/parties/me', APP, C.name), { token: X.token });
        assert(cApp.status === 401, `the same filename of C: ${show(cApp)}`);
        const origin = await call(P('/parties/me'), { token: X.token, headers: { Origin: 'https://evil.example' } });
        assert(origin.status === 403 && codeOf(origin) === 'ORIGIN_MISMATCH', `another origin: ${show(origin)}`);
    });

    await test('D4 every app party route refuses a caller it is not for: no credential, another owner, a party', async () => {
        const me = await call(`/v1/apps/${A.name}/${APP}/parties/me`, { method: 'GET' });
        assert(me.status === 401, `me with no credential: ${show(me)}`);
        const out = await call(`/v1/apps/${A.name}/${APP}/parties/signout`, { method: 'POST', body: {} });
        assert(out.status === 401, `signout with no credential: ${show(out)}`);
        const getData = await call(`/v1/apps/${A.name}/${APP}/party-data/cart`, { method: 'GET' });
        assert(getData.status === 401, `read party data with no credential: ${show(getData)}`);
        const putData = await call(`/v1/apps/${A.name}/${APP}/party-data/cart`, { method: 'PUT', body: { value: {} } });
        assert(putData.status === 401, `write party data with no credential: ${show(putData)}`);
        const delData = await call(`/v1/apps/${A.name}/${APP}/party-data/cart`, { method: 'DELETE' });
        assert(delData.status === 401, `delete party data with no credential: ${show(delData)}`);
        const shared = await call(`/v1/apps/${A.name}/${APP}/party-data-shared/prices`, { method: 'PUT', body: { value: {} } });
        assert(shared.status === 401, `write the shared collection with no credential: ${show(shared)}`);
        const reg = await call(`/v1/apps/${A.name}/${APP}/parties/registration`, { method: 'PUT', token: C.token, body: { open: true } });
        assert(reg.status === 403, `C sets A's registration: ${show(reg)}`);
        const list = await call(`/v1/apps/${A.name}/${APP}/parties`, { method: 'GET', token: C.token });
        assert(list.status === 403, `C lists A's parties: ${show(list)}`);
        const rm = await call(`/v1/apps/${A.name}/${APP}/parties/${X.name}`, { method: 'DELETE', token: C.token });
        assert(rm.status === 403, `C removes A's party: ${show(rm)}`);
        const decide = await call(`/v1/admin/app-party-registrations/${A.name}/${APP}`, { method: 'POST', token: A.token, body: { decision: 'approve' } });
        assert(decide.status === 403, `A decides as the operator: ${show(decide)}`);
    });

    console.log('\nD4.1 the roster, the owner\'s view');

    await test('D4.1 the roster lists the registered party, takes the owner\'s party by identity and refuses another owner\'s', async () => {
        const roster = await call(P('/members'), { token: A.token });
        assert(roster.status === 200 && JSON.stringify(roster.body.data.members).includes(X.name), `roster: ${show(roster)}`);
        const role = await call(P('/members'), { token: A.token, body: { party: Y.ref, role: 'editor' } });
        assert(role.status === 200 && role.body.data.party === true && role.body.data.member.role === 'editor', `Y to editor: ${show(role)}`);
        const me = await call(P('/parties/me'), { token: Y.token });
        assert(me.body.data.role === 'editor', `Y's role: ${show(me)}`);
        const foreign = await call(P('/members'), { token: A.token, body: { party: `party:${C.name}/someone@${nodeId}`, role: 'member' } });
        assert(foreign.status === 403, `another owner's party: ${show(foreign)}`);
        const byC = await call(P('/members'), { token: C.token, body: { party: Y.ref, role: 'member' } });
        assert(byC.status === 403, `C sets A's roster: ${show(byC)}`);
        const own = await call('/v1/parties', { token: A.token, body: { name: `crm${stamp % 1000}`, kind: 'program' } });
        assert(own.status === 201, `A's own party: ${show(own)}`);
        const ownRole = await call(P('/members'), { token: A.token, body: { party: own.body.data.party.party_ref, role: 'reader' } });
        assert(ownRole.status === 201, `A's own party on the roster: ${show(ownRole)}`);
        const reserved = await call('/v1/parties', { token: A.token, body: { name: 'ap-forged', kind: 'program' } });
        assert(reserved.status === 400, `the ap- prefix is reserved: ${show(reserved)}`);
    });

    await test('D4.1 the owner sees the parties and removes one: its sign-in and its data end at once; C sees none of it', async () => {
        const list = await call(P('/parties'), { token: A.token });
        assert(list.status === 200 && list.body.data.total === 2 && (list.body.data.parties as Body[]).some(p => p.email === emailX), `list: ${show(list)}`);
        const byC = await call(P('/parties'), { token: C.token });
        assert(byC.status === 403, `C lists A's parties: ${show(byC)}`);
        await call(P('/party-data/notes'), { token: Y.token, method: 'PUT', body: { value: { n: 1 } } });
        const rm = await call(P(`/parties/${Y.name}`), { token: A.token, method: 'DELETE' });
        assert(rm.status === 200 && rm.body.data.data_deleted === 1, `remove: ${show(rm)}`);
        const gone = await call(P('/parties/me'), { token: Y.token });
        assert(gone.status === 401, `the removed party's token: ${show(gone)}`);
        const roster = await call(P('/members'), { token: A.token });
        assert(!JSON.stringify(roster.body.data.members).includes(Y.name), 'the removed party is on the roster');
        const ag = await makeAgent(BASE, A, ['app:write']);
        const s = await openSession(BASE, ag.token, 'app-parties-mcp');
        const mcp = await callTool(s, 'aimeat_app_manage', { action: 'parties', filename: APP });
        assert(!mcp.isError && mcp.text.includes(X.name), `MCP parties: ${mcp.text.slice(0, 300)}`);
    });

    console.log('\nD4.4, D4.5 the data map and section 12');

    await test('D4.4 the data map of an app with an open signup says whom it registers, or has the finding', async () => {
        const map = await call(`/v1/datamap/apps/${A.name}/${APP}`, { token: A.token });
        assert(map.status === 200 && JSON.stringify(map.body.data.findings ?? []).includes('DATAMAP_REGISTERS_UNSTATED'), `finding: ${show(map)}`);
        const put = await call(`/v1/datamap/apps/${A.name}/${APP}`, { token: A.token, method: 'PUT', body: {
            spec: 'aimeat.datamap/2', what: 'A market', usedFor: 'Buying and selling', form: 'group', arrangement: 'One record per person',
            machinery: [], leaves: [], held: [], elsewhere: [], registers: { who: 'buyers and sellers', keeps: ['e-mail address', 'cart'] },
        } });
        assert(put.status === 200 && !JSON.stringify(put.body.data.findings ?? []).includes('DATAMAP_REGISTERS_UNSTATED'), `stated: ${show(put)}`);
    });

    await test('D4.5 finding (d) counts the app once it sells a tool and its signup is open', async () => {
        const before = await call('/v1/admin/compliance/report', { token: OP.token });
        const d0 = (before.body.data.data_intermediation.findings as Body[]).find(f => f.id === 'app_open_registration_commerce');
        assert(d0 && !d0.items.some((i: Body) => i.app === `${A.name}/${APP}`), `before the sale: ${JSON.stringify(d0)}`);
        const tools = await call('/v1/memory', { token: A.token, body: { key: `apps.${APP}.tools`, visibility: 'public', value: {
            version: 1, updatedAt: new Date().toISOString(),
            tools: [{ name: 'listing', description: 'A listing', inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, priceMoney: { amount: 1_000_000, currency: 'EUR' } }],
        } } });
        assert([200, 201].includes(tools.status), `tools: ${show(tools)}`);
        const after = await call('/v1/admin/compliance/report', { token: OP.token });
        const d = (after.body.data.data_intermediation.findings as Body[]).find(f => f.id === 'app_open_registration_commerce');
        assert(d?.count >= 1 && d.items.some((i: Body) => i.app === `${A.name}/${APP}`), `(d): ${JSON.stringify(d)}`);
    });

    console.log('\nD4.3 a closed node');

    await test('D4.3 a node that shows its content to signed-in accounts only is off: the opening and the sessions are refused', async () => {
        assert((await setConfig('visibility.content_access', 'signed-in')).status === 200, 'signed-in only');
        const open = await call(P('/parties/registration'), { token: A.token, method: 'PUT', body: { open: true } });
        assert(open.status === 403 && codeOf(open) === 'PARTY_REGISTRATION_OFF', `open: ${show(open)}`);
        const me = await call(P('/parties/me'), { token: X.token });
        // The node's own content-access gate answers first, before the party layer reads the setting.
        assert(me.status === 401 && codeOf(me) === 'SIGN_IN_REQUIRED', `a session on a closed node: ${show(me)}`);
        assert((await setConfig('visibility.content_access', 'open')).status === 200, 'open again');
        assert((await call(P('/parties/me'), { token: X.token })).status === 200, 'the session works again');
    });

    console.log('\nsecaudit2026nov02d round 13');

    await test('A person the owner took off the roster stays off at their next sign-in; the first verification and a plain sign-in keep the role', async () => {
        const emailZ = `z${stamp}@example.test`;
        smtp!.clear();
        assert((await call(P('/parties/signup'), { body: { email: emailZ } })).status === 202, 'Z signs up');
        const v = await call(P('/parties/verify'), { body: { token: await linkIn(emailZ) } });
        assert(v.status === 200 && v.body.data.role === 'member', `the first verification puts Z on the roster: ${show(v)}`);
        const zRef = String(v.body.data.party.party_ref);
        smtp!.clear();
        assert((await call(P('/parties/signin'), { body: { email: emailZ } })).status === 202, 'Z asks for a sign-in link');
        const kept = await call(P('/parties/verify'), { body: { token: await linkIn(emailZ) } });
        assert(kept.status === 200 && kept.body.data.role === 'member', `a sign-in with the row in place keeps the role: ${show(kept)}`);
        const rm = await call(P(`/members/${encodeURIComponent(zRef)}`), { token: A.token, method: 'DELETE' });
        assert(rm.status === 200, `the owner takes Z off the roster: ${show(rm)}`);
        const off = await call(P('/members/me'), { token: kept.body.data.token });
        assert(off.status === 200 && off.body.data.member === null, `members/me after the removal: ${show(off)}`);
        smtp!.clear();
        assert((await call(P('/parties/signin'), { body: { email: emailZ } })).status === 202, 'Z asks for a sign-in link again');
        const back = await call(P('/parties/verify'), { body: { token: await linkIn(emailZ) } });
        assert(back.status === 200 && back.body.data.role === null, `the sign-in after the removal: ${show(back)}`);
        const me = await call(P('/members/me'), { token: back.body.data.token });
        assert(me.status === 200 && me.body.data.member === null, `members/me after the sign-in: ${show(me)}`);
        const roster = await call(P('/members'), { token: A.token });
        assert(!JSON.stringify(roster.body.data.members).includes(String(v.body.data.party.name)), `the roster after the sign-in: ${show(roster)}`);
        const re = await call(P('/members'), { token: A.token, body: { party: zRef, role: 'member' } });
        assert([200, 201].includes(re.status), `the owner puts Z back on purpose: ${show(re)}`);
        assert((await call(P('/parties/me'), { token: back.body.data.token })).body.data.role === 'member', 'Z has the role again');
    });

    await test('The signup takes a limited number of signups an hour from one address; the refusal names the setting, and 0 is no limit', async () => {
        assert((await setConfig('consent.app_party_signups_per_hour', 2)).status === 200, 'the limit set to 2');
        let refused: Answer | null = null;
        for (let i = 0; i < 4 && !refused; i++) {
            const s = await call(P('/parties/signup'), { body: { email: `rl${i}-${stamp}@example.test` } });
            if (s.status === 429) refused = s;
            else assert(s.status === 202, `signup ${i}: ${show(s)}`);
        }
        assert(refused && codeOf(refused) === 'RATE_LIMITED' && /app_party_signups_per_hour/.test(refused.text), `the refusal: ${refused ? show(refused) : 'none'}`);
        assert((await setConfig('consent.app_party_signups_per_hour', 0)).status === 200, 'no limit');
        const free = await call(P('/parties/signup'), { body: { email: `rlfree-${stamp}@example.test` } });
        assert(free.status === 202, `with no limit: ${show(free)}`);
        assert((await setConfig('consent.app_party_signups_per_hour', 30)).status === 200, 'the default again');
    });

    console.log(`\n${passed} passed, ${failed} failed\n`);
}

try { await run(); }
catch (err) { failed++; console.error(`  ❌ the suite stopped: ${(err as Error).message}`); }
finally { await stopAll(); }
process.exit(failed > 0 ? 1 : 0);
