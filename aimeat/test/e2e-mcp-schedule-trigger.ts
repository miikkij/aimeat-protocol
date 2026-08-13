/**
 * @file test/e2e-mcp-schedule-trigger.ts
 * @description Running a schedule NOW from an MCP session: aimeat_schedule_trigger.
 *
 *   Why this suite exists. Creating a recurring job over MCP has worked for months, and proving one
 *   works has not been possible from the same surface: "run it now" lived on the HTTP router alone.
 *   So an agent could set up a 07:00 job, tell the person it was done, and neither of them would
 *   learn until the following morning that it fires into nothing.
 *
 *   The failure mode is the point of half of these tests. triggerNow answers 'busy' and 'limited'
 *   from a call that did not throw, so a tool reporting only "triggered" would read as success on a
 *   run that never happened. The reply states `succeeded` outright, and that is what is asserted.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-schedule-trigger
 * @version-history
 *   v1.0.0 — 2026-08-13 — Initial, with the tool itself.
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

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

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, message: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'))).toString('base64');
}

function parseSSE(text: string, id: number): any {
    for (const evt of text.split('\n\n')) {
        let data = '';
        for (const line of evt.trim().split('\n')) if (line.startsWith('data: ')) data += line.slice(6);
        if (!data) continue;
        try { const m = JSON.parse(data); if (m.id === id) return m; } catch { /* not a JSON frame */ }
    }
    return {};
}

interface Session { token: string; sessionId: string; nextId: number }

async function rpc(s: Session, method: string, params: Record<string, any> = {}) {
    const id = s.nextId++;
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${s.token}`,
            ...(s.sessionId ? { 'mcp-session-id': s.sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) s.sessionId = sid;
    const ct = res.headers.get('content-type') ?? '';
    return ct.includes('text/event-stream') ? parseSSE(await res.text(), id) : await res.json() as any;
}

async function callTool(s: Session, name: string, args: Record<string, unknown>) {
    const body = await rpc(s, 'tools/call', { name, arguments: args });
    const text = body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body ?? {});
    return { isError: body?.result?.isError === true || body?.error !== undefined, text };
}

/** Parse a tool reply that is a JSON document; throws with the raw text when it is a refusal. */
function data(reply: { isError: boolean; text: string }): any {
    assert(!reply.isError, `tool refused: ${reply.text}`);
    return JSON.parse(reply.text);
}

/** One owner, one interactive agent, and an MCP session for that agent. */
async function setup(label: string) {
    const owner = `mtrig${label}${Date.now()}`;
    const reg = () => json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: 'McpTrigFlow1234' }) });
    let r = await reg();
    for (let i = 0; r.status === 429 && i < 8; i++) { await new Promise(res => setTimeout(res, 1500)); r = await reg(); }
    assert(r.status === 201, `ghii ${r.status}: ${JSON.stringify(r.body?.error)}`);

    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner, timestamp: ts, signature: await sign(r.body.data.private_key, owner + NODE_ID + ts) }),
    });
    const ownerToken = tok.body.data.token as string;

    const agentName = `ag${label}`;
    const ag = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: agentName, owner, capabilities: ['schedules'], mode: 'interactive', scopes: ['*'] }),
    });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body?.error)}`);
    const agentGaii = ag.body.data.agent.gaii as string;
    const agentKey = ag.body.data.private_key as string;

    const client = await json('/v1/mcp/register', {
        method: 'POST', body: JSON.stringify({ client_name: `mcp trigger ${label}`, redirect_uris: [] }),
    });
    const ats = new Date().toISOString();
    const params = new URLSearchParams({
        response_type: 'code', client_id: client.body.client_id, gaii: agentGaii,
        signature: await sign(agentKey, agentGaii + NODE_ID + ats), timestamp: ats,
    });
    const auth = await json(`/v1/mcp/authorize?${params}`);
    const token = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({
            grant_type: 'authorization_code', code: auth.body.code,
            client_id: client.body.client_id, client_secret: client.body.client_secret,
        }),
    });
    assert(token.status === 200, `mcp token ${token.status}: ${JSON.stringify(token.body)}`);

    const session: Session = { token: token.body.access_token, sessionId: '', nextId: 1 };
    await rpc(session, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'mcp trigger e2e', version: '1.0.0' } });
    await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${session.token}`, 'mcp-session-id': session.sessionId, 'mcp-protocol-version': '2025-03-26',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    return { owner, ownerToken, agentGaii, agentName, session };
}

console.log('\n=== MCP schedule trigger ===\n');

async function run() {
    const a = await setup('a');
    const b = await setup('b');
    const authA = { Authorization: `Bearer ${a.ownerToken}` };

    let scheduleId = '';

    await test('the tool is on the agent surface', async () => {
        const body = await rpc(a.session, 'tools/list', {});
        const names: string[] = (body?.result?.tools ?? []).map((t: any) => t.name);
        assert(names.includes('aimeat_schedule_trigger'), 'aimeat_schedule_trigger is registered');
    });

    await test('an agent creates a morning schedule over MCP', async () => {
        const out = data(await callTool(a.session, 'aimeat_schedule_create', {
            kind: 'agent_task',
            cron: '0 7 * * *',
            timezone: 'Europe/Helsinki',
            display_name: 'Morning news',
            task_title: 'TRIGGER_OCCURRENCE',
            task_description: 'Fetch what happened overnight and write it to the archive key.',
        }));
        assert(out.created === true, `expected created, got ${JSON.stringify(out)}`);
        scheduleId = out.schedule_id;
        assert(typeof scheduleId === 'string' && scheduleId.length > 0, 'got a schedule id');
    });

    await test('running it now queues a real occurrence, and the reply says it succeeded', async () => {
        const out = data(await callTool(a.session, 'aimeat_schedule_trigger', { schedule_id: scheduleId }));
        assert(out.succeeded === true, `expected succeeded, got ${JSON.stringify(out)}`);
        assert(out.outcome === 'created', `expected outcome=created, got ${out.outcome}`);
        assert(typeof out.task_id === 'string', 'the created task is named, so the caller can follow it');

        // The reply is not the proof. The task has to actually be in the agent's queue.
        const tasks = await json(`/v1/agents/${a.agentName}/tasks?status=queued&per_page=100`, { headers: authA });
        const found = (tasks.body.data.tasks ?? []).filter((t: any) => t.title === 'TRIGGER_OCCURRENCE').length;
        assert(found === 1, `expected exactly one queued occurrence, found ${found}`);
    });

    await test('a second run while the first is still pending reports busy, NOT success', async () => {
        const out = data(await callTool(a.session, 'aimeat_schedule_trigger', { schedule_id: scheduleId }));
        assert(out.outcome === 'busy', `expected outcome=busy, got ${out.outcome}`);
        assert(out.succeeded === false, 'busy is not success — this is the whole reason `succeeded` is stated');
        assert(typeof out.reason === 'string', 'busy carries a reason the caller can relay');

        const tasks = await json(`/v1/agents/${a.agentName}/tasks?status=queued&per_page=100`, { headers: authA });
        const found = (tasks.body.data.tasks ?? []).filter((t: any) => t.title === 'TRIGGER_OCCURRENCE').length;
        assert(found === 1, `no duplicate occurrence may be created, found ${found}`);
    });

    await test('another owner\'s agent cannot run this schedule', async () => {
        const reply = await callTool(b.session, 'aimeat_schedule_trigger', { schedule_id: scheduleId });
        assert(reply.isError, `expected a refusal, got ${reply.text}`);
        assert(/FORBIDDEN|NOT_FOUND/.test(reply.text), `expected FORBIDDEN/NOT_FOUND, got ${reply.text}`);

        // And nothing ran: owner A's queue is untouched.
        const tasks = await json(`/v1/agents/${a.agentName}/tasks?status=queued&per_page=100`, { headers: authA });
        const found = (tasks.body.data.tasks ?? []).filter((t: any) => t.title === 'TRIGGER_OCCURRENCE').length;
        assert(found === 1, `a foreign trigger must create nothing, found ${found}`);
    });

    await test('an unknown schedule id is refused, not silently ignored', async () => {
        const reply = await callTool(a.session, 'aimeat_schedule_trigger', { schedule_id: 'sched-does-not-exist' });
        assert(reply.isError, `expected a refusal, got ${reply.text}`);
        assert(reply.text.includes('NOT_FOUND'), `expected NOT_FOUND, got ${reply.text}`);
    });

    console.log('\nCleanup');
    await test('cascade-delete both owners', async () => {
        const r1 = await json(`/v1/owners/${encodeURIComponent(a.owner)}`, { method: 'DELETE', headers: authA });
        const r2 = await json(`/v1/owners/${encodeURIComponent(b.owner)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${b.ownerToken}` } });
        assert(r1.status === 200 && r2.status === 200, `delete ${r1.status}/${r2.status}`);
    });
}

await run();

console.log(`\n${'='.repeat(50)}`);
console.log(`MCP schedule trigger E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
