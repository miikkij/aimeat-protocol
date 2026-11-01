/**
 * @file e2e-iam-parties.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for a person registered to an app without an account (plan doc-mvwxcas3dom3, D4) as
 *   a member AIMEAT.iam reads (WP9d). The suite runs its own node with mail on, pointed at a fake SMTP
 *   server in this process, because the sign-in link reaches the person by mail.
 *   1. GET .../members/me takes the app party token and answers the person's standing, kind party,
 *      with the roster role; the account holder's answer is unchanged.
 *   2. POST /v1/ext/{extension}/{action} runs the app's IAM extension for the person, with ctx.caller
 *      naming the party and its roster row, never the owner and never anonymous, and no wallet. Every
 *      refusal: another app's party token, an ended sign-in (epoch), a stopped person, an action the
 *      role lacks, an extension that gates another app or none, another owner's extension, a missing
 *      one, a priced action, the instance form, a party token that is not an app sign-in, another Origin.
 *   3. The owner stops a person and lets them in again (REST and aimeat_app_manage); another owner cannot.
 *   0. The node serves aimeat-parties.js at all: it answered 404 from D4 until WP9d.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=iam-parties
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (WP9d). Every test but the account holder's fails on the code before
 *     WP9d: members/me and /v1/ext answered an app party token 401, and parties/{name}/stop did not exist.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { startFakeSmtp, type FakeSmtp } from './helpers/fake-smtp.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const PORT = Number(process.env.E2E_IAM_PARTIES_PORT ?? 28572);
const SMTP_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PW = 'iam-parties-admin-pw';
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
const APP = 'market.html', OTHER = 'club.html';
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
    token, body: { filename, name: filename, description: 'iam parties e2e', content: Buffer.from('<!doctype html><title>m</title><p>market', 'utf8').toString('base64') },
});
/** Register `email` to `app` of A and open the mailed link: the session. */
async function register(email: string, app: string): Promise<{ token: string; name: string; ref: string }> {
    smtp!.clear();
    const s = await call(P('/parties/signup', app), { body: { email } });
    assert(s.status === 202, `signup ${email}: ${show(s)}`);
    const v = await call(P('/parties/verify', app), { body: { token: await linkIn(email) } });
    assert(v.status === 200, `verify ${email}: ${show(v)}`);
    return { token: v.body.data.token, name: v.body.data.party.name, ref: v.body.data.party.party_ref };
}
/** A new sign-in of an already registered person. */
async function signInAgain(email: string, app = APP): Promise<string> {
    smtp!.clear();
    assert((await call(P('/parties/signin', app), { body: { email } })).status === 202, `signin ${email}`);
    const v = await call(P('/parties/verify', app), { body: { token: await linkIn(email) } });
    assert(v.status === 200, `verify again: ${show(v)}`);
    return v.body.data.token as string;
}

/** An extension of `owner` that gates `appId` (or nothing), with a check that reports ctx.caller. */
function gateManifest(name: string, appId: string | null): string {
    return [
        'metadata:', `  name: ${name}`, '  version: 1.0.0', '  description: iam parties fixture', '  author: t',
        ...(appId ? ['config:', '  app:', '    type: string', `    default: ${appId}`] : []),
        'actions:',
        '  - id: check', '    method: POST', '    path: /check', '    input: { type: object }', '    output: { type: object }', '    script: check.js',
        '  - id: sell', '    method: POST', '    path: /sell', '    input: { type: object }', '    output: { type: object }', '    script: sell.js',
        '  - id: paid', '    method: POST', '    path: /paid', '    input: { type: object }', '    output: { type: object }', '    script: check.js', '    tollMorsels: 5',
    ].join('\n');
}
const GATE_SCRIPTS = {
    'check.js': 'export default async function (ctx) { const c = ctx.caller || {}; return { gaii: c.gaii, owner: c.owner, party: c.party || null, member: c.member || null, isAppOwner: !!c.isAppOwner, anonymous: !!c.anonymous, hasWallet: !!(ctx.wallet && ctx.wallet.getBalance) }; }',
    // The extension refuses what the role lacks, as an IAM gate does in the action that changes data.
    'sell.js': 'export default async function (ctx) { const m = ctx.caller && ctx.caller.member; if (!m || m.role !== "seller") return { ok: false, error: "forbidden: your role may not sell" }; await ctx.memory.set("last-seller", ctx.caller.party ? ctx.caller.party.name : ctx.caller.owner); return { ok: true, seller: await ctx.memory.get("last-seller") }; }',
};
async function install(token: string, name: string, appId: string | null): Promise<void> {
    const inst = await call('/v1/extensions', { token, body: { manifest: gateManifest(name, appId), scripts: GATE_SCRIPTS } });
    assert(inst.status === 200 || inst.status === 201, `install ${name}: ${show(inst)}`);
    const act = await call(`/v1/extensions/${name}/activate`, { token, body: {} });
    assert(act.status === 200, `activate ${name}: ${show(act)}`);
}

const GATE = `mktgate${stamp}`, OTHER_GATE = `clubgate${stamp}`, PLAIN = `plainext${stamp}`, C_GATE = `cgate${stamp}`;
const ext = (name: string, action: string, token: string, headers?: Record<string, string>) =>
    call(`/v1/ext/${name}/${action}`, { token, body: {}, ...(headers ? { headers } : {}) });
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
            AIMEAT_PARTY_SELF_REGISTRATION: 'on',
            AIMEAT_SMTP_HOST: '127.0.0.1', AIMEAT_SMTP_PORT: String(SMTP_PORT), AIMEAT_SMTP_SECURE: 'false',
            AIMEAT_SMTP_REJECT_UNAUTHORIZED: 'false', AIMEAT_SMTP_FROM: 'AIMEAT Test <noreply@aimeat.test>',
            AIMEAT_DEFAULT_AGENT_SCOPES: '*',
            AIMEAT_RL_GLOBAL: '100000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000', AIMEAT_RL_MEMORY: '10000',
            AIMEAT_RL_GHII: '10000', AIMEAT_RL_OWNERS: '10000', AIMEAT_RL_CATALOGUE: '10000',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForServer(node, BASE, { label: 'the iam parties node' });
}

async function stopAll(): Promise<void> {
    if (node) { const dying = node; node = null; dying.kill(); await Promise.race([once(dying, 'exit'), new Promise(r => setTimeout(r, 15_000))]); }
    if (smtp) { await smtp.close(); smtp = null; }
}

async function run(): Promise<void> {
    await startNode();
    console.log('\n=== AIMEAT iam parties E2E ===\n');

    await test('Setup: an operator, owner A with two apps and their gates, C with a gate; two people register', async () => {
        const op = await registerOwner(BASE, `ipop${stamp}`); OP = { name: op.name, token: op.token };
        nodeId = op.ghii.split('@')[1]!;
        const a = await registerOwner(BASE, `ipa${stamp}`); A = { name: a.name, token: a.token };
        const c = await registerOwner(BASE, `ipc${stamp}`); C = { name: c.name, token: c.token };
        for (const f of [APP, OTHER]) assert([200, 201].includes((await publish(A.token, f)).status), `publish ${f}`);
        assert([200, 201].includes((await publish(C.token, APP)).status), 'C publishes an app');
        for (const f of [APP, OTHER]) {
            const open = await call(P('/parties/registration', f), { token: A.token, method: 'PUT', body: { open: true, role: 'member' } });
            assert(open.status === 200 && open.body.data.registration.open === true, `open ${f}: ${show(open)}`);
        }
        await install(A.token, GATE, `${A.name}/${APP}`);
        await install(A.token, OTHER_GATE, `${A.name}/${OTHER}`);
        await install(A.token, PLAIN, null);
        await install(C.token, C_GATE, `${C.name}/${APP}`);
        X = await register(emailX, APP);
        Y = await register(emailY, OTHER);
        assert(X.ref === `party:${A.name}/${X.name}@${nodeId}`, `X: ${JSON.stringify(X)}`);
    });

    await test('0 the node serves both libraries an app loads for this: aimeat-parties.js and aimeat-iam.js', async () => {
        for (const lib of ['aimeat-parties.js', 'aimeat-iam.js']) {
            const r = await fetch(`${BASE}/v1/libs/${lib}`, { signal: AbortSignal.timeout(30_000) });
            const text = await r.text();
            assert(r.status === 200 && text.length > 1000, `${lib}: ${r.status}`);
        }
    });

    console.log('\n1. the roster standing');

    await test('1 members/me answers the registered person with kind party and the roster role', async () => {
        const me = await call(P('/members/me'), { token: X.token });
        assert(me.status === 200, `me: ${show(me)}`);
        const d = me.body.data;
        assert(d.kind === 'party' && d.identity === X.ref && d.role === 'member' && d.isOwner === false && d.canManage === false, `standing: ${show(me)}`);
        assert(d.member?.role === 'member' && d.member.note === undefined && d.member.approvedBy === undefined, `the row leaves out the owner's side: ${show(me)}`);
        assert(d.displayName && d.party?.party_ref === X.ref, `who: ${show(me)}`);
    });

    await test('1 members/me refuses another app\'s token, a token with no app, and another Origin', async () => {
        const other = await call(P('/members/me'), { token: Y.token });
        assert(other.status === 401 && codeOf(other) === 'INVALID_PARTY_CREDENTIAL', `Y on market: ${show(other)}`);
        const cApp = await call(P('/members/me', APP, C.name), { token: X.token });
        assert(cApp.status === 401, `X on C's app of the same name: ${show(cApp)}`);
        const origin = await call(P('/members/me'), { token: X.token, headers: { Origin: 'https://evil.example' } });
        assert(origin.status === 403 && codeOf(origin) === 'ORIGIN_MISMATCH', `Origin: ${show(origin)}`);
        const roster = await call(P('/members'), { token: X.token });
        assert(roster.status === 401, `the roster itself refuses the party: ${show(roster)}`);
    });

    await test('1 the account holder\'s standing is unchanged: the owner and a stranger', async () => {
        const own = await call(P('/members/me'), { token: A.token });
        assert(own.status === 200 && own.body.data.isOwner === true && own.body.data.kind === undefined, `owner: ${show(own)}`);
        const stranger = await call(P('/members/me'), { token: C.token });
        assert(stranger.status === 200 && stranger.body.data.isOwner === false && stranger.body.data.role === null, `C: ${show(stranger)}`);
    });

    console.log('\n2. the app\'s IAM extension');

    await test('2 the gate runs for the person: ctx.caller names the party and its row, never the owner, no wallet', async () => {
        const r = await ext(GATE, 'check', X.token);
        assert(r.status === 200, `check: ${show(r)}`);
        const d = r.body.data;
        assert(d.gaii === X.ref && d.owner === X.ref, `identity: ${show(r)}`);
        assert(d.party?.name === X.name && d.party.app === `${A.name}/${APP}` && d.party.ref === X.ref, `party: ${show(r)}`);
        assert(d.member?.role === 'member', `member row: ${show(r)}`);
        assert(d.isAppOwner === false && d.anonymous === false && d.hasWallet === false, `not the owner, not anonymous, no wallet: ${show(r)}`);
        const owner = await ext(GATE, 'check', A.token);
        assert(owner.status === 200 && owner.body.data.isAppOwner === true && owner.body.data.party === null && owner.body.data.hasWallet === true, `the owner's call: ${show(owner)}`);
    });

    await test('2 an action the role lacks is refused by the gate; the owner gives the role and it runs', async () => {
        const lacks = await ext(GATE, 'sell', X.token);
        assert(lacks.status === 200 && lacks.body.data.ok === false && /forbidden/.test(lacks.body.data.error), `member sells: ${show(lacks)}`);
        const role = await call(P('/members'), { token: A.token, body: { party: X.ref, role: 'seller' } });
        assert(role.status === 200 && role.body.data.member.role === 'seller', `seller: ${show(role)}`);
        const sells = await ext(GATE, 'sell', X.token);
        assert(sells.status === 200 && sells.body.data.ok === true && sells.body.data.seller === X.name, `seller sells: ${show(sells)}`);
        const me = await call(P('/members/me'), { token: X.token });
        assert(me.body.data.role === 'seller', `the standing follows: ${show(me)}`);
    });

    await test('2 the person\'s sign-in reaches no other extension: another app\'s, none, another owner\'s, a missing one', async () => {
        for (const [label, name] of [['another app of A', OTHER_GATE], ['a gate of no app', PLAIN], ['C\'s gate by its address', encodeURIComponent(`${C.name}/${C_GATE}`)], ['C\'s gate by name', C_GATE], ['a missing one', `nothing${stamp}`]] as const) {
            const r = await ext(name, 'check', X.token);
            assert(r.status === 403 && codeOf(r) === 'PARTY_NOT_FOR_EXTENSION', `${label}: ${show(r)}`);
        }
        const yOnMarket = await ext(GATE, 'check', Y.token);
        assert(yOnMarket.status === 403 && codeOf(yOnMarket) === 'PARTY_NOT_FOR_EXTENSION', `another app's party token: ${show(yOnMarket)}`);
        const yOwn = await ext(OTHER_GATE, 'check', Y.token);
        assert(yOwn.status === 200 && yOwn.body.data.party?.app === `${A.name}/${OTHER}`, `Y on its own app's gate: ${show(yOwn)}`);
    });

    await test('2 a priced action, the instance form, another Origin and a party token that is not an app sign-in are refused', async () => {
        const paid = await ext(GATE, 'paid', X.token);
        assert(paid.status === 403 && codeOf(paid) === 'PARTY_CANNOT_PAY', `priced: ${show(paid)}`);
        const inst = await call(`/v1/ext/${GATE}/i1/check`, { token: X.token, body: {} });
        assert(inst.status === 401, `instance form: ${show(inst)}`);
        const origin = await ext(GATE, 'check', X.token, { Origin: 'https://evil.example' });
        assert(origin.status === 403 && codeOf(origin) === 'ORIGIN_MISMATCH', `Origin: ${show(origin)}`);
        const made = await call('/v1/parties', { token: A.token, body: { name: `crm${stamp % 1000}`, kind: 'program' } });
        assert(made.status === 201, `A's own party: ${show(made)}`);
        const tok = await call('/v1/parties/token', { body: { grant_type: 'client_credentials', client_id: `${A.name}/${made.body.data.party.name}`, client_secret: made.body.data.key } });
        assert(tok.status === 200, `its token: ${show(tok)}`);
        const r = await ext(GATE, 'check', tok.body.access_token as string);
        assert(r.status === 401 && codeOf(r) === 'INVALID_PARTY_CREDENTIAL', `a data party token on the gate: ${show(r)}`);
        const me = await call(P('/members/me'), { token: tok.body.access_token as string });
        assert(me.status === 401, `a data party token on members/me: ${show(me)}`);
    });

    await test('2 an ended sign-in (the epoch moved) is refused on both endpoints', async () => {
        const second = await signInAgain(emailX);
        const out = await call(P('/parties/signout'), { token: second, body: {} });
        assert(out.status === 200, `signout: ${show(out)}`);
        const r = await ext(GATE, 'check', X.token);
        assert(r.status === 401 && codeOf(r) === 'INVALID_PARTY_CREDENTIAL', `gate: ${show(r)}`);
        const me = await call(P('/members/me'), { token: X.token });
        assert(me.status === 401, `me: ${show(me)}`);
        X.token = await signInAgain(emailX);
        assert((await ext(GATE, 'check', X.token)).status === 200, 'signed in again');
    });

    console.log('\n3. stop and let in again');

    await test('3 a stopped person is refused everywhere; C cannot stop A\'s person; resume keeps the role', async () => {
        const byC = await call(`/v1/apps/${A.name}/${APP}/parties/${X.name}/stop`, { method: 'POST', token: C.token, body: {} });
        assert(byC.status === 403, `C stops A's person: ${show(byC)}`);
        const resumeByC = await call(`/v1/apps/${A.name}/${APP}/parties/${X.name}/resume`, { method: 'POST', token: C.token, body: {} });
        assert(resumeByC.status === 403, `C resumes A's person: ${show(resumeByC)}`);
        const none = await call(P('/parties/ap-000000000000/stop'), { token: A.token, body: {} });
        assert(none.status === 404, `nobody of that name: ${show(none)}`);
        const stop = await call(P(`/parties/${X.name}/stop`), { token: A.token, body: {} });
        assert(stop.status === 200 && stop.body.data.status === 'stopped', `stop: ${show(stop)}`);
        const r = await ext(GATE, 'check', X.token);
        assert(r.status === 403 && codeOf(r) === 'PARTY_STOPPED', `gate: ${show(r)}`);
        const me = await call(P('/members/me'), { token: X.token });
        assert(me.status === 403 && codeOf(me) === 'PARTY_STOPPED', `me: ${show(me)}`);
        const list = await call(P('/parties'), { token: A.token });
        assert((list.body.data.parties as Body[]).find(p => p.name === X.name)?.status === 'stopped', `the list says stopped: ${show(list)}`);
        const resume = await call(P(`/parties/${X.name}/resume`), { token: A.token, body: {} });
        assert(resume.status === 200 && resume.body.data.status === 'active', `resume: ${show(resume)}`);
        const back = await call(P('/members/me'), { token: X.token });
        assert(back.status === 200 && back.body.data.role === 'seller', `back with the role: ${show(back)}`);
    });

    await test('3 over MCP: the owner\'s agent stops and resumes a person; an agent without app:manage is refused', async () => {
        const ag = await makeAgent(BASE, A, ['app:manage', 'app:write']);
        const s = await openSession(BASE, ag.token, 'iam-parties-owner');
        const stop = await callTool(s, 'aimeat_app_manage', { action: 'party_stop', filename: APP, party_name: X.name });
        assert(!stop.isError && stop.data?.status === 'stopped', `party_stop: ${stop.text.slice(0, 300)}`);
        assert((await ext(GATE, 'check', X.token)).status === 403, 'stopped over MCP');
        const resume = await callTool(s, 'aimeat_app_manage', { action: 'party_resume', filename: APP, party_name: X.name });
        assert(!resume.isError && resume.data?.status === 'active', `party_resume: ${resume.text.slice(0, 300)}`);
        assert((await ext(GATE, 'check', X.token)).status === 200, 'resumed over MCP');
        const reader = await makeAgent(BASE, A, ['app:write']);
        const rs = await openSession(BASE, reader.token, 'iam-parties-reader');
        const refused = await callTool(rs, 'aimeat_app_manage', { action: 'party_stop', filename: APP, party_name: X.name });
        assert(refused.isError && /SCOPE_DENIED|FORBIDDEN|app:manage/.test(refused.text), `without app:manage: ${refused.text.slice(0, 300)}`);
    });

    console.log(`\n${passed} passed, ${failed} failed\n`);
}

try { await run(); }
catch (err) { failed++; console.error(`  ❌ the suite stopped: ${(err as Error).message}`); }
finally { await stopAll(); }
process.exit(failed > 0 ? 1 : 0);
