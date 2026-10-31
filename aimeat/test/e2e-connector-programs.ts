/**
 * @file test/e2e-connector-programs.ts
 * @description The programs a computer may start for its agents, and the owner's decision on them
 *   (wish-koneen-ohjelmaluettelo-nodeen-sallitut-ja-hyv-ksynt-odottava).
 *
 *   WHAT THIS PROVES. An agent's connector reports that agent's programs, and the owner and their AI
 *   read them on the computer's row. A program that waits asks the owner once; their answer reaches
 *   the computer over its tunnel and is read back in the next report. The owner stops a program that
 *   runs and allows it again, on REST and through the node's MCP server, and a "no" the computer
 *   overruled at the machine shows as allowed.
 *
 *   THE REFUSALS. An agent reports only for itself and only on a computer it is connected on; the
 *   owner reports nothing; a decision needs agent:write; another owner and an ecosystem app change
 *   nothing; an unknown hash or a malformed report is refused before anything is written.
 *
 *   THIS SUITE OPENS REAL TUNNELS, as e2e-agent-connectors does: the test is the connector.
 *
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=connector-programs
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial.
 */
import { WebSocket } from 'ws';
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { ownerSignIn } from './helpers/owner-login.js';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

async function setupOwner(label: string) {
    const owner = `prg${label}${Date.now().toString(36)}`;
    let r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: 'ProgramsPass12345' }) });
    for (let i = 0; r.status === 429 && i < 8; i++) {
        await new Promise(res => setTimeout(res, 1500));
        r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: 'ProgramsPass12345' }) });
    }
    assert(r.status === 201, `ghii ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const tok = await ownerSignIn(BASE, owner, 'ProgramsPass12345');
    return { owner, ownerToken: tok.body.data.token as string };
}

async function addAgent(owner: string, ownerToken: string, name: string, scopes: string[] = ['*']) {
    const ag = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name, owner, capabilities: [], mode: 'interactive', scopes }),
    });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body?.error)}`);
    const gaii = ag.body.data.agent.gaii as string;
    const ts = new Date().toISOString();
    const sig = Buffer.from(await ed.signAsync(new TextEncoder().encode(gaii + ts), Buffer.from(ag.body.data.private_key, 'base64'))).toString('base64');
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: sig }) });
    return { name, gaii, token: tok.body.data.token as string };
}

async function mintEcoToken(owner: string, ownerAuth: Record<string, string>, app: string): Promise<string> {
    const hello = await json('/v1/ecosystem-apps/hello', { method: 'POST', body: JSON.stringify({ owner, app, public_key: Buffer.from(`key-${app}`).toString('base64') }) });
    assert(hello.status === 200, `hello ${hello.status}`);
    const approve = await json(`/v1/ecosystem-apps/${hello.body.data.user_code}/approve`, {
        method: 'POST', headers: ownerAuth, body: JSON.stringify({ action: 'approve', scopes: ['memory:read', 'memory:write'] }),
    });
    assert(approve.status === 200, `approve ${approve.status}`);
    const tok = await json('/v1/ecosystem-apps/token', {
        method: 'POST', body: JSON.stringify({ device_code: hello.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    });
    return tok.body.access_token as string;
}

/** A connector, as a socket: it records every deliver frame the node sends it. */
function openDaemon(token: string, installId: string, installName: string): Promise<{ ws: WebSocket; delivered: any[]; close(): void }> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/v1/connect/tunnel', {
            headers: { Authorization: `Bearer ${token}`, 'X-AIMEAT-Install': installId, 'X-AIMEAT-Install-Name': encodeURIComponent(installName) },
        });
        const d = { ws, delivered: [] as any[], close: () => { try { ws.close(); } catch { /* already gone */ } } };
        const timer = setTimeout(() => reject(new Error('tunnel did not welcome in time')), 10_000);
        ws.on('message', (data) => {
            let frame: any;
            try { frame = JSON.parse(data.toString()); } catch { return; }
            if (frame.type === 'welcome') { clearTimeout(timer); resolve(d); return; }
            if (frame.type === 'deliver') d.delivered.push(frame);
        });
        ws.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
}

async function mcpSession(token: string) {
    let sid: string | undefined;
    let id = 0;
    const rpc = async (method: string, params: Record<string, unknown> = {}) => {
        const res = await fetch(`${BASE}/v1/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`,
                ...(sid ? { 'mcp-session-id': sid, 'mcp-protocol-version': '2025-03-26' } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
        });
        sid = res.headers.get('mcp-session-id') ?? sid;
        const text = await res.text();
        const line = text.split('\n').find(l => l.startsWith('data: '));
        return JSON.parse(line ? line.slice(6) : text);
    };
    await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'e2e-connector-programs', version: '1' } });
    return async (name: string, args: Record<string, unknown>) => {
        const body = await rpc('tools/call', { name, arguments: args });
        const t = body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body);
        let data: any; try { data = JSON.parse(t); } catch { data = null; }
        return { isError: body?.result?.isError === true || !!body?.error, text: t as string, data };
    };
}

async function until(what: string, cond: () => Promise<boolean>, ms = 15_000) {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await cond()) return; await new Promise(r => setTimeout(r, 200)); }
    throw new Error(`timed out waiting for ${what}`);
}

const H1 = '1'.repeat(64);
const H2 = '2'.repeat(64);
const HOME_ID = 'inst-programs-home';

console.log('\n=== Connector programs: what a computer may start, and the owner\'s decision ===\n');

async function run() {
    const a = await setupOwner('a');
    const b = await setupOwner('b');
    const authA = { Authorization: `Bearer ${a.ownerToken}` };
    const authB = { Authorization: `Bearer ${b.ownerToken}` };
    const seat = await addAgent(a.owner, a.ownerToken, 'news-seat');
    const sibling = await addAgent(a.owner, a.ownerToken, 'sibling-seat');
    const reader = await addAgent(a.owner, a.ownerToken, 'plain-reader', ['memory:read', 'memory:write']);
    const as = (tok: string) => ({ Authorization: `Bearer ${tok}` });

    const dSeat = await openDaemon(seat.token, HOME_ID, 'Kotikone');
    const dSibling = await openDaemon(sibling.token, HOME_ID, 'Kotikone');
    const report = (agent: { name: string; token: string }, body: unknown, name = agent.name) =>
        json(`/v1/agents/${name}/programs`, { method: 'PUT', headers: as(agent.token), body: JSON.stringify(body) });
    const home = async (auth: Record<string, string>) => ((await json('/v1/agents/v2/connectors', { headers: auth })).body?.data?.connectors as any[] ?? []).find(c => c.id === HOME_ID);
    const decide = (auth: Record<string, string>, connector: string, hash: string, decision: string) =>
        json(`/v1/agents/v2/connectors/${encodeURIComponent(connector)}/programs/${hash}`, { method: 'PUT', headers: auth, body: JSON.stringify({ decision }) });

    let requestId = '';

    await test('an agent reports a program that waits, and the owner is asked once', async () => {
        const r = await report(seat, { hash: H1, status: 'waiting', runner: 'node ./heratys.js' });
        assert(r.status === 200, `report ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.connector === HOME_ID && r.body.data.status === 'waiting', `answer ${JSON.stringify(r.body.data)}`);
        requestId = r.body.data.request_id;
        assert(typeof requestId === 'string' && requestId.length > 0, 'a request asks the owner');
        assert(typeof r.body.data.approve_url === 'string', 'and the answer says where the owner answers');
        const again = await report(seat, { hash: H1, status: 'waiting', runner: 'node ./heratys.js' });
        assert(again.body.data.request_id === requestId, 'the same report asks no second time');
        const req = await json(`/v1/publish-requests/${requestId}`, { headers: authA });
        assert(req.status === 200 && req.body.data.request?.kind === 'connector-program', `request ${req.status} ${JSON.stringify(req.body?.data?.request?.kind)}`);
    });

    await test('the owner reads the program on the computer\'s row', async () => {
        const c = await home(authA);
        const row = (c?.programs ?? []).find((p: any) => p.agent === 'news-seat');
        assert(!!row, `no program row: ${JSON.stringify(c?.programs)}`);
        assert(row.use === 'runner' && row.command === 'node ./heratys.js' && row.status === 'waiting' && row.request_id === requestId, `row ${JSON.stringify(row)}`);
        assert(typeof c.programs_reported_at === 'string', 'the list says how old it is');
    });

    await test('an agent reports only for itself, only on a connected computer, and only in the shape', async () => {
        const other = await report(sibling, { hash: H1, status: 'waiting', runner: 'node x.js' }, 'news-seat');
        assert(other.status === 403, `a sibling reporting for another agent: expected 403, got ${other.status}`);
        const owner = await json('/v1/agents/news-seat/programs', { method: 'PUT', headers: authA, body: JSON.stringify({ hash: H1, status: 'waiting', runner: 'x' }) });
        assert(owner.status === 403, `the owner reporting: expected 403, got ${owner.status}`);
        const off = await report(reader, { hash: H1, status: 'waiting', runner: 'node x.js' });
        assert(off.status === 409 && off.body?.error?.code === 'NOT_ON_A_CONNECTOR', `not connected: expected 409 NOT_ON_A_CONNECTOR, got ${off.status} ${off.body?.error?.code}`);
        const bad = await report(seat, { hash: 'not-a-hash', status: 'waiting', runner: 'x' });
        assert(bad.status === 400, `a malformed hash: expected 400, got ${bad.status}`);
        const none = await report(seat, { hash: H1, status: 'waiting' });
        assert(none.status === 400, `a hash with no command: expected 400, got ${none.status}`);
    });

    await test('the owner allows it: the computer hears it, and reads the decision back', async () => {
        dSeat.delivered.length = 0;
        const r = await json(`/v1/publish-requests/${requestId}/decision`, { method: 'POST', headers: authA, body: JSON.stringify({ decision: 'approve' }) });
        assert(r.status === 200, `decision ${r.status}: ${JSON.stringify(r.body?.error)}`);
        await until('the programs_decided delivery', async () => dSeat.delivered.some(f => f.kind === 'connector.programs_decided'));
        const back = await report(seat, { hash: H1, status: 'waiting', runner: 'node ./heratys.js' });
        assert(back.body.data.decision === 'allowed' && back.body.data.status === 'allowed' && back.body.data.applied === false, `answer ${JSON.stringify(back.body.data)}`);
        const ran = await report(seat, { hash: H1, status: 'allowed', runner: 'node ./heratys.js', source: 'approved', since: new Date().toISOString() });
        assert(ran.status === 200, `report ${ran.status}`);
        const row = (await home(authA)).programs.find((p: any) => p.agent === 'news-seat');
        assert(row.status === 'allowed' && row.applied === true && row.source === 'approved', `row ${JSON.stringify(row)}`);
    });

    await test('the owner stops it, and a "no" the machine overruled later shows as allowed', async () => {
        const since = new Date(Date.now() - 60_000).toISOString();
        await report(seat, { hash: H1, status: 'allowed', runner: 'node ./heratys.js', source: 'approved', since });
        const r = await decide(authA, 'Kotikone', H1, 'deny');
        assert(r.status === 200 && r.body.data.programs[0].status === 'declined' && r.body.data.programs[0].applied === false, `deny ${r.status} ${JSON.stringify(r.body?.data ?? r.body?.error)}`);
        const back = await report(seat, { hash: H1, status: 'allowed', runner: 'node ./heratys.js', source: 'approved', since });
        assert(back.body.data.decision === 'declined', `the computer reads the "no": ${JSON.stringify(back.body.data)}`);
        const later = await report(seat, { hash: H1, status: 'allowed', runner: 'node ./heratys.js', source: 'connected', since: new Date(Date.now() + 60_000).toISOString() });
        assert(later.body.data.status === 'allowed', `a connect at the machine after the "no": ${JSON.stringify(later.body.data)}`);
    });

    await test('who may decide: agent:write, the owner\'s own computers, never an app', async () => {
        const noScope = await decide(as(reader.token), HOME_ID, H1, 'allow');
        assert(noScope.status === 403 && noScope.body?.error?.code === 'SCOPE_DENIED', `without agent:write: expected 403 SCOPE_DENIED, got ${noScope.status} ${noScope.body?.error?.code}`);
        const other = await decide(authB, HOME_ID, H1, 'deny');
        assert(other.status === 404, `another owner: expected 404, got ${other.status}`);
        const ecoToken = await mintEcoToken(a.owner, authA, 'progs-app');
        const eco = await json(`/v1/agents/v2/connectors/${HOME_ID}/programs/${H1}`, { method: 'PUT', headers: as(ecoToken), body: JSON.stringify({ decision: 'deny' }) });
        assert(eco.status === 403, `an ecosystem app: expected 403, got ${eco.status}`);
        const unknown = await decide(authA, HOME_ID, 'f'.repeat(64), 'allow');
        assert(unknown.status === 404, `an unknown hash: expected 404, got ${unknown.status}`);
        const word = await decide(authA, HOME_ID, H1, 'maybe');
        assert(word.status === 400, `a decision that is not allow or deny: expected 400, got ${word.status}`);
        const row = (await home(authA)).programs.find((p: any) => p.agent === 'news-seat');
        assert(row.status === 'allowed', `none of these changed it: ${JSON.stringify(row)}`);
    });

    await test('the chat path: an agent lists the programs and stops one over MCP', async () => {
        // The computer trusted it a minute ago, so a "no" now is the later act.
        await report(seat, { hash: H1, status: 'allowed', runner: 'node ./heratys.js', source: 'connected', since: new Date(Date.now() - 60_000).toISOString() });
        const call = await mcpSession(sibling.token);
        const list = await call('aimeat_connector_list', {});
        const c = (list.data?.connectors as any[] ?? []).find(x => x.id === HOME_ID);
        assert(!!c?.programs?.length, `aimeat_connector_list names the programs: ${list.text.slice(0, 300)}`);
        const set = await call('aimeat_connector_program_set', { connector: 'Kotikone', hash: H1, decision: 'deny' });
        assert(!set.isError && set.data?.programs?.[0]?.status === 'declined', `aimeat_connector_program_set: ${set.text}`);
        const readerCall = await mcpSession(reader.token);
        const refused = await readerCall('aimeat_connector_program_set', { connector: HOME_ID, hash: H1, decision: 'allow' });
        assert(refused.isError, `an agent without agent:write is refused over MCP too: ${refused.text}`);
    });

    await test('"don\'t allow" on the question records the program as not allowed', async () => {
        const r = await report(sibling, { hash: H2, status: 'waiting', wake: 'node ./wake.js' });
        assert(r.status === 200 && r.body.data.request_id, `report ${r.status} ${JSON.stringify(r.body?.data ?? r.body?.error)}`);
        const d = await json(`/v1/publish-requests/${r.body.data.request_id}/decision`, { method: 'POST', headers: authA, body: JSON.stringify({ decision: 'decline' }) });
        assert(d.status === 200, `decline ${d.status}: ${JSON.stringify(d.body?.error)}`);
        const row = (await home(authA)).programs.find((p: any) => p.agent === 'sibling-seat');
        assert(row?.use === 'wake' && row.status === 'declined' && row.applied === true, `row ${JSON.stringify(row)}`);
        const allow = await decide(authA, HOME_ID, H2, 'allow');
        assert(allow.status === 200 && allow.body.data.programs[0].status === 'allowed', `allowed again from the page: ${JSON.stringify(allow.body?.data ?? allow.body?.error)}`);
    });

    await test('an agent with no programs any more clears its row', async () => {
        const r = await report(sibling, { hash: null });
        assert(r.status === 200, `report ${r.status}`);
        const c = await home(authA);
        assert(!c.programs.some((p: any) => p.agent === 'sibling-seat'), `the row is gone: ${JSON.stringify(c.programs)}`);
    });

    dSeat.close();
    dSibling.close();
}

run().then(() => {
    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
}).catch((err) => {
    console.error('Suite crashed:', err);
    process.exit(1);
});
