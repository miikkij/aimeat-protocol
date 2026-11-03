// E2E: "build it with you" ("Rakennamme kanssasi"): the place's one build request, the operator's
// relay to the build queue, the status the place asks the queue for, the place's trail, and the
// operator's once-per-code notice.
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=build-with-you
//
// What it guards:
//   1. One request per place, stored for the operator; the place never submits to the queue itself,
//      and the queue's statusToken never reaches the owner's answer.
//   2. The operator's routes take an operator JWT or the admin password and refuse everybody else.
//   3. The operator's answer is taken once; the place then reads the queue's public getStatus.
//   4. An owner's trail is their own account's; the operator's activity is the whole node's.
//   5. notify-owner tells the owner once per code.
//
// v1.2.0 -- 2026-11-04 -- After the lockout, seed-examples and the setup sign-in refuse the same
//   address too: one count of wrong admin passwords for every route (codebase analysis 2026-11-03, A12).
// v1.1.0 -- 2026-11-01 -- With a build code a submit before connecting is BUILD_CONNECT_FIRST; the
//   place's own send is test/e2e-build-with-you-send.ts.
// v1.0.0 -- 2026-11-01 -- Initial ("Rakennamme kanssasi"; Jouni, 1.11 16.22).

import { createServer, type Server } from 'node:http';
import { registerOwner, ownerToken } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ADMIN_PASSWORD = process.env.AIMEAT_ADMIN_PASSWORD ?? 'test-admin-pw';

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

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any; text: string }> {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const text = await res.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { body = { _raw: text }; }
    return { status: res.status, body, text };
}

const bearer = (token: string, opts: RequestInit = {}): RequestInit => ({ ...opts, headers: { ...(opts.headers as Record<string, string> ?? {}), Authorization: `Bearer ${token}` } });
const admin = (opts: RequestInit = {}, pw = ADMIN_PASSWORD): RequestInit => ({ ...opts, headers: { ...(opts.headers as Record<string, string> ?? {}), 'X-Admin-Password': pw } });

// ── The stub build queue: getStatus only, the way c9's queue answers it ──
const statusCalls: any[] = [];
let queue: Server;
let queueUrl = '';
async function startQueue(): Promise<void> {
    queue = createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => {
            const body = raw ? JSON.parse(raw) : {};
            res.setHeader('Content-Type', 'application/json');
            if (req.url === '/getStatus') {
                statusCalls.push({ body, auth: req.headers.authorization ?? null });
                if (body.statusToken === 'tok-1') {
                    res.end(JSON.stringify({ ok: true, data: {
                        state: 'building', position: 2, queueLength: 5, organismInviteSent: true,
                        organism: { id: 'org-builders', name: 'Builders' }, inviteEmail: 'customer@example.test',
                    } }));
                    return;
                }
                res.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'NOT_FOUND: no such request' } }));
                return;
            }
            res.statusCode = 404;
            res.end(JSON.stringify({ ok: false, error: { message: 'not here' } }));
        });
    });
    await new Promise<void>((r) => queue.listen(0, '127.0.0.1', () => r()));
    const addr = queue.address();
    queueUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
}

const stamp = Date.now().toString(36);
const operatorName = `bwyop${stamp}`;
const customerName = `bwycust${stamp}`;
let operatorToken = '';
let customerToken = '';

async function setQueue(value: string): Promise<void> {
    const { status, body } = await json('/v1/admin/config', bearer(operatorToken, {
        method: 'PUT', body: JSON.stringify({ changes: [{ path: 'site.build_queue_url', value }] }),
    }));
    assert(status === 200, `set site.build_queue_url: ${status} ${JSON.stringify(body?.error ?? body)}`);
}

const spec = {
    what: 'An agent that answers the shop\'s email in Finnish',
    forWhom: 'The two people who run the shop',
    use: 'Answering the ten questions customers ask every week',
    readyWhen: 'It drafts an answer for every new email and we approve it with one press',
};

console.log('\n=== Build it with you E2E ===\n');
await startQueue();

try {
    await test('setup: the operator (first account) and a customer', async () => {
        await registerOwner(BASE, operatorName);
        operatorToken = await ownerToken(BASE, operatorName);
        await registerOwner(BASE, customerName);
        customerToken = await ownerToken(BASE, customerName);
    });

    await test('no queue: the offer reads off, and a request is refused with BUILD_WITH_YOU_OFF', async () => {
        await setQueue('');
        const read = await json('/v1/build-with-you/request', bearer(customerToken));
        assert(read.status === 200, `read ${read.status}`);
        assert(read.body.data.offer.reason === 'off' && read.body.data.offer.available === false, `offer ${JSON.stringify(read.body.data.offer)}`);
        assert(read.body.data.queueOrigin === null && read.body.data.request === null, `data ${JSON.stringify(read.body.data)}`);
        const post = await json('/v1/build-with-you/request', bearer(customerToken, { method: 'POST', body: JSON.stringify(spec) }));
        assert(post.status === 409 && post.body.error?.code === 'BUILD_WITH_YOU_OFF', `post ${post.status} ${post.text}`);
    });

    await test('with a queue: not-yet before any AI, and the queue origin is given', async () => {
        await setQueue(queueUrl);
        const read = await json('/v1/build-with-you/request', bearer(customerToken));
        assert(read.body.data.offer.reason === 'not-yet', `offer ${JSON.stringify(read.body.data.offer)}`);
        assert(read.body.data.queueOrigin === queueUrl, `queueOrigin ${read.body.data.queueOrigin}`);
    });

    await test('a request without readyWhen is refused, naming the field', async () => {
        const { readyWhen: _r, ...partial } = spec;
        const post = await json('/v1/build-with-you/request', bearer(customerToken, { method: 'POST', body: JSON.stringify(partial) }));
        assert(post.status === 400 && post.body.error?.code === 'VALIDATION_ERROR' && post.text.includes('readyWhen'), `post ${post.status} ${post.text}`);
    });

    await test('the request is stored for the operator: waiting-for-operator, no queue call', async () => {
        const post = await json('/v1/build-with-you/request', bearer(customerToken, { method: 'POST', body: JSON.stringify(spec) }));
        assert(post.status === 201, `post ${post.status} ${post.text}`);
        const r = post.body.data.request;
        assert(r.state === 'waiting-for-operator' && r.position === null && r.spec.readyWhen === spec.readyWhen, `request ${JSON.stringify(r)}`);
        assert(post.body.data.offer.reason === 'used', `offer ${JSON.stringify(post.body.data.offer)}`);
        assert(statusCalls.length === 0, `the place called the queue: ${JSON.stringify(statusCalls)}`);
    });

    await test('a second request from the place is refused with BUILD_REQUEST_EXISTS', async () => {
        const again = await json('/v1/build-with-you/request', bearer(operatorToken, { method: 'POST', body: JSON.stringify(spec) }));
        assert(again.status === 409 && again.body.error?.code === 'BUILD_REQUEST_EXISTS', `again ${again.status} ${again.text}`);
    });

    await test('the operator routes refuse no credential, a wrong password and a customer', async () => {
        const none = await json('/v1/operator/build-request');
        assert(none.status === 401, `none ${none.status}`);
        const wrong = await json('/v1/operator/build-request', admin({}, 'not-the-password'));
        assert(wrong.status === 401, `wrong ${wrong.status}`);
        const customer = await json('/v1/operator/build-request', bearer(customerToken));
        assert(customer.status === 403, `customer ${customer.status} ${customer.text}`);
        const activity = await json('/v1/operator/activity', bearer(customerToken));
        assert(activity.status === 403, `customer activity ${activity.status}`);
        const notice = await json('/v1/operator/notify-owner', bearer(customerToken, { method: 'POST', body: JSON.stringify({ code: 'x', title: 'x' }) }));
        assert(notice.status === 403, `customer notice ${notice.status}`);
    });

    await test('the operator reads the waiting request with the admin password, and with the operator JWT', async () => {
        const viaPw = await json('/v1/operator/build-request', admin());
        assert(viaPw.status === 200, `pw ${viaPw.status} ${viaPw.text}`);
        const p = viaPw.body.data.pending;
        assert(p && p.nodeId === NODE_ID && p.spec.what === spec.what && typeof p.node === 'string', `pending ${JSON.stringify(viaPw.body.data)}`);
        const viaJwt = await json('/v1/operator/build-request', bearer(operatorToken));
        assert(viaJwt.status === 200 && viaJwt.body.data.pending?.id === p.id, `jwt ${viaJwt.status} ${viaJwt.text}`);
    });

    await test('the queue\'s answer is taken once: the same id is a no-op, another id is refused', async () => {
        const put = (body: unknown) => json('/v1/operator/build-request', admin({ method: 'PUT', body: JSON.stringify(body) }));
        const first = await put({ requestId: 'req-1', statusToken: 'tok-1', position: 3, queueLength: 5, state: 'queued' });
        assert(first.status === 200 && first.body.data.already === false, `first ${first.status} ${first.text}`);
        assert(first.body.data.request.state === 'queued' && first.body.data.request.position === 3, `request ${JSON.stringify(first.body.data.request)}`);
        assert(!first.text.includes('tok-1'), 'the answer carries no status token');
        const same = await put({ requestId: 'req-1', statusToken: 'tok-1', position: 1, state: 'building' });
        assert(same.status === 200 && same.body.data.already === true, `same ${same.status} ${same.text}`);
        const other = await put({ requestId: 'req-2', statusToken: 'tok-2' });
        assert(other.status === 409 && other.body.error?.code === 'BUILD_REQUEST_HANDED', `other ${other.status} ${other.text}`);
        const handed = await json('/v1/operator/build-request', admin());
        assert(handed.body.data.pending === null && handed.body.data.requestId === 'req-1', `handed ${handed.text}`);
    });

    await test('the place then asks the queue\'s public getStatus, with no credential, and shows the invitation', async () => {
        const read = await json('/v1/build-with-you/request', bearer(customerToken));
        assert(read.status === 200, `read ${read.status}`);
        const r = read.body.data.request;
        assert(r.state === 'building' && r.position === 2 && r.queueLength === 5, `request ${JSON.stringify(r)}`);
        assert(r.organism?.name === 'Builders' && r.organism.url === `${queueUrl}/v1/profile?tab=organisms&org=org-builders`, `organism ${JSON.stringify(r.organism)}`);
        assert(r.inviteEmail === 'customer@example.test', `inviteEmail ${r.inviteEmail}`);
        assert(!read.text.includes('tok-1'), 'the owner\'s answer carries no status token');
        const call = statusCalls[statusCalls.length - 1];
        assert(call && call.body.requestId === 'req-1' && call.body.statusToken === 'tok-1' && call.body.nodeId === NODE_ID, `call ${JSON.stringify(call)}`);
        assert(call.auth === null, 'getStatus is sent with no Authorization header');
    });

    await test('the owner\'s trail lists their own request, and not the operator\'s changes', async () => {
        const trail = await json('/v1/build-with-you/trail?limit=50', bearer(customerToken));
        assert(trail.status === 200, `trail ${trail.status} ${trail.text}`);
        const entries: any[] = trail.body.data.entries;
        const mine = entries.find((e) => e.code === 'POST /v1/build-with-you/request' && e.outcome === 'ok');
        assert(mine && mine.actorKind === 'person' && mine.actorName === customerName, `own entry ${JSON.stringify(entries.slice(0, 5))}`);
        assert(!entries.some((e) => e.code === 'PUT /v1/admin/config'), 'the operator\'s config change is not in the customer\'s trail');
        assert(entries.every((e) => e.actor.endsWith(`@${NODE_ID}`) && e.actor.includes(customerName)), 'only the customer\'s account');
    });

    await test('a memory write names its key as the target, so the home can tell its bookkeeping from what the person saved', async () => {
        const write = await json('/v1/memory', bearer(customerToken, { method: 'POST', body: JSON.stringify({ key: 'home.visits', value: { count: 1 }, visibility: 'private' }) }));
        assert(write.status === 200 || write.status === 201, `write ${write.status} ${write.text}`);
        const trail = await json('/v1/build-with-you/trail?limit=20', bearer(customerToken));
        const entry = (trail.body.data.entries as any[]).find((e) => e.code === 'POST /v1/memory');
        assert(entry?.target === 'home.visits', `entry ${JSON.stringify(entry)}`);
    });

    await test('the operator\'s activity is the whole node\'s, newest first', async () => {
        const all = await json('/v1/operator/activity?limit=100', admin());
        assert(all.status === 200, `activity ${all.status} ${all.text}`);
        const entries: any[] = all.body.data.entries;
        assert(entries.some((e) => e.code === 'PUT /v1/admin/config' && e.actorName === operatorName), 'the operator\'s change is there');
        assert(entries.some((e) => e.code === 'POST /v1/build-with-you/request' && e.actorName === customerName), 'the customer\'s request is there');
        for (let i = 1; i < entries.length; i++) assert(entries[i - 1].at >= entries[i].at, `newest first at ${i}`);
    });

    await test('notify-owner tells the named owner once per code', async () => {
        const send = () => json('/v1/operator/notify-owner', admin({ method: 'POST', body: JSON.stringify({
            code: `gift.test-${stamp}`, title: 'Sait 2 € lisää tekoälysaldoa', body: 'Omalla OpenRouter-avaimella palvelumaksua ei ole.', owner: customerName,
        }) }));
        const first = await send();
        assert(first.status === 201 && first.body.data.already === false && first.body.data.told?.[0] === customerName, `first ${first.status} ${first.text}`);
        const again = await send();
        assert(again.status === 200 && again.body.data.already === true, `again ${again.status} ${again.text}`);
        const list = await json('/v1/notifications', bearer(customerToken));
        const items = (list.body.data?.notifications ?? list.body.data?.items ?? []) as any[];
        const hits = items.filter((n) => String(n.title ?? n.value?.title ?? '').includes('Sait 2 €'));
        assert(hits.length === 1, `the customer was told once: ${hits.length} (${JSON.stringify(list.body.data).slice(0, 300)})`);
        const bad = await json('/v1/operator/notify-owner', admin({ method: 'POST', body: JSON.stringify({ code: 'Not A Code', title: 'x' }) }));
        assert(bad.status === 400 && bad.body.error?.code === 'VALIDATION_ERROR', `bad ${bad.status}`);
        const nobody = await json('/v1/operator/notify-owner', admin({ method: 'POST', body: JSON.stringify({ code: 'x.y', title: 'x', owner: 'nobody-here' }) }));
        assert(nobody.status === 404, `nobody ${nobody.status}`);
    });

    await test('the owner routes refuse a caller with no account, and an agent without the permission', async () => {
        for (const [method, path] of [['GET', '/v1/build-with-you/request'], ['POST', '/v1/build-with-you/request'], ['GET', '/v1/build-with-you/trail']] as const) {
            const r = await json(path, { method, ...(method === 'POST' ? { body: JSON.stringify(spec) } : {}) });
            assert(r.status === 401 || r.status === 403, `${method} ${path} with no account: ${r.status}`);
        }
        const reader = await makeAgent(BASE, { name: customerName, token: customerToken }, ['memory:read'], `bwyreader${stamp}`);
        const post = await json('/v1/build-with-you/request', bearer(reader.token, { method: 'POST', body: JSON.stringify(spec) }));
        assert(post.status === 403, `an agent without memory:write: ${post.status} ${post.text}`);
        const s = await openSession(BASE, reader.token, 'bwy-reader');
        const submit = await callTool(s, 'aimeat_build_request_submit', spec);
        assert(submit.isError, `aimeat_build_request_submit without memory:write: ${submit.text}`);
        const put = await json('/v1/operator/build-request', bearer(customerToken, { method: 'PUT', body: JSON.stringify({ requestId: 'x', statusToken: 'y' }) }));
        assert(put.status === 403, `a customer on the operator PUT: ${put.status}`);
    });

    await test('the owner\'s AI reads the status and the trail over MCP, and a second request is refused there too', async () => {
        const ai = await makeAgent(BASE, { name: customerName, token: customerToken }, ['memory:read', 'memory:write'], `bwyai${stamp}`);
        const s = await openSession(BASE, ai.token, 'bwy-ai');
        const status = await callTool(s, 'aimeat_build_request_status', {});
        assert(!status.isError && status.data?.request?.state === 'building', `status ${status.text.slice(0, 300)}`);
        assert(!status.text.includes('tok-1'), 'no status token over MCP');
        const again = await callTool(s, 'aimeat_build_request_submit', spec);
        assert(again.isError && again.text.includes('BUILD_REQUEST_EXISTS'), `again ${again.text.slice(0, 200)}`);
        const trail = await callTool(s, 'aimeat_trail_list', { limit: 50 });
        assert(!trail.isError, `trail ${trail.text.slice(0, 200)}`);
        const own = (trail.data?.entries ?? []).find((e: any) => e.code === 'aimeat_build_request_status' && e.actorName === `bwyai${stamp}`);
        assert(own && own.actorKind === 'agent' && own.event === 'agent.ran' && own.readOnly === true, `the AI's own call: ${JSON.stringify(own)}`);
        const all = await json('/v1/operator/activity?limit=200', admin());
        const approved = (all.body.data.entries as any[]).find((e) => e.event === 'agent.approved' && e.code === 'POST /v1/agents' && e.actorName === customerName);
        assert(approved, 'agent.approved when the customer made the agent');
    });

    await test('a store place\'s build code: the owner reads it and where the request goes, and a submit before connecting is refused', async () => {
        const put = (path: string, value: unknown) => json('/v1/admin/config', bearer(operatorToken, {
            method: 'PUT', body: JSON.stringify({ changes: [{ path, value }] }),
        }));
        const bad = await put('site.build_code', 'RK-IIII-0000-0000');
        assert(bad.status === 400, `a code with I is refused: ${bad.status}`);
        assert((await put('site.build_code', 'RK-0000-1111-2222')).status === 200, 'the code is set');
        assert((await put('site.build_queue_url', `${queueUrl}/v1/ext/builder/rakennamme`)).status === 200, 'the queue names the extension');
        try {
            const read = await json('/v1/build-with-you/request', bearer(customerToken));
            const d = read.body.data;
            assert(d.buildCode === 'RK-0000-1111-2222' && d.offer.available === true, `code and offer ${JSON.stringify({ code: d.buildCode, offer: d.offer })}`);
            assert(d.send?.mcp === `${queueUrl}/v1/mcp` && d.send.tool === 'aimeat_app_tool_invoke', `send ${JSON.stringify(d.send)}`);
            assert(d.send.arguments.owner === 'builder' && d.send.arguments.app === 'rakennamme.html' && d.send.arguments.tool === 'submitRequest'
                && d.send.arguments.input.code === 'RK-0000-1111-2222' && d.send.arguments.input.nodeId === NODE_ID, `send arguments ${JSON.stringify(d.send.arguments)}`);
            // Not connected to the builders' node: the place has nothing to send it through
            // (the sending itself is test/e2e-build-with-you-send.ts).
            const own = await json('/v1/build-with-you/request', bearer(customerToken, { method: 'POST', body: JSON.stringify(spec) }));
            assert(own.status === 409 && own.body.error?.code === 'BUILD_CONNECT_FIRST', `own submit ${own.status} ${own.text}`);
            const site = await fetch(`${BASE}/v1/chat`).then((r) => r.text());
            assert(!site.includes('RK-0000-1111-2222'), 'the code is not on a page a visitor loads');
        } finally {
            await put('site.build_code', '');
            await put('site.build_queue_url', queueUrl);
        }
    });

    // Last: it locks this address out of the password for the window.
    await test('after five wrong admin passwords even the right one is refused for the window', async () => {
        // One wrong password was sent above; four more reach the count.
        for (let i = 0; i < 4; i++) {
            const wrong = await json('/v1/operator/activity', admin({}, `wrong-${i}`));
            assert(wrong.status === 401, `wrong ${i}: ${wrong.status}`);
        }
        const right = await json('/v1/operator/activity', admin());
        assert(right.status === 429 && right.body.error?.code === 'RATE_LIMITED', `right ${right.status} ${right.text}`);
        const jwt = await json('/v1/operator/activity', bearer(operatorToken));
        assert(jwt.status === 200, `the operator's JWT still works: ${jwt.status}`);
    });

    // After the lockout above: every route that takes the admin password counts in one count
    // (services/admin-password.ts; codebase analysis 2026-11-03, item A12). Seed-examples had only the
    // node's global limit, and the setup pages a count of their own, so their budgets added up.
    await test('the same address is refused the admin password on seed-examples and the setup sign-in too, and the operator JWT still seeds', async () => {
        const seed = await json('/v1/admin/seed-examples', admin({ method: 'POST' }));
        assert(seed.status === 429 && seed.body.error?.code === 'RATE_LIMITED', `seed-examples with the right password: ${seed.status} ${seed.text.slice(0, 300)}`);
        assert(Number(seed.body.error?.details?.retry_after_seconds) > 0, `it says when to try again: ${JSON.stringify(seed.body.error?.details)}`);
        const setup = await json('/v1/admin/setup/auth', admin({ method: 'POST', body: '{}' }));
        assert(setup.status === 429, `setup sign-in with the right password: ${setup.status} ${setup.text.slice(0, 300)}`);
        const byJwt = await json('/v1/admin/seed-examples', bearer(operatorToken, { method: 'POST' }));
        assert(byJwt.body.error?.code !== 'UNAUTHORIZED' && byJwt.status !== 429, `the operator's JWT is not counted: ${byJwt.status} ${byJwt.text.slice(0, 300)}`);
    });
} finally {
    await setQueue('').catch(() => undefined);
    queue.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
