/**
 * @file e2e-package-install-requests.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An agent installs a package whose memory part it may not write alone, and the install
 *   becomes a request the owner answers instead of a refusal.
 *
 *   A package installs under the OWNER whoever presses install, so a memory part writes into the
 *   owner's memory, which costs an agent memory:write and memory:write-as-owner. An agent holding
 *   packages:write and not those two was answered 403 SCOPE_DENIED. Now it gets 202 and a request:
 *   one record under `packages.install-requests.` in the owner's namespace, one open item on the
 *   owner's list, one notification with Approve and Decline. The owner in person approves on the
 *   notification's own door, which re-checks everything and installs as the owner. An agent of the
 *   same owner may approve from a chat, but only when it is not the requester and holds the words
 *   itself: the device-authorization rule, an approver cannot grant beyond its own scopes.
 *
 *   What each part proves: the request instead of the refusal (R1 to R5), the fence around it (R6 to
 *   R8), the owner's approval and what it tells the requester (R9 to R10), a chat agent's approval on
 *   the node's MCP (R11), the three ways a request stops being approvable (R12 expired, R13 declined,
 *   R14 changed underneath), the reserved prefix at the memory door (R15), and the same road for an
 *   update and a migration (R16, R17).
 * @structure Setup · R1-R5 the request · R6-R8 who may not decide · R9-R10 the owner approves ·
 *   R11 a chat agent approves · R12-R14 expired, declined, changed · R15 forged records ·
 *   R16-R17 update and migration · Cleanup
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=package-install-requests
 * @version-history
 *   v1.0.0 — 2026-09-25 — Initial, written before the requests existed: on the old node every
 *     request-shaped assertion failed on 403 SCOPE_DENIED or on a door answering 404.
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
        if (res.status === 429 && attempt < 6) { await new Promise(r => setTimeout(r, 1200)); continue; }
        const text = await res.text();
        let body: any;
        try { body = JSON.parse(text); } catch { body = { _raw: text }; }
        return { status: res.status, body };
    }
}

(ed as any).hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
const authH = (t: string) => ({ Authorization: `Bearer ${t}` });

async function setupOwner(label: string): Promise<{ name: string; token: string }> {
    const name = `pir${label}${Date.now().toString(36)}`;
    const mk = () => json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Install requests', password: 'InstallReq1234' }) });
    let reg = await mk();
    for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await mk(); }
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }),
    });
    assert(tok.status === 200, `token ${tok.status}`);
    return { name, token: tok.body.data.token as string };
}

/** An agent of `owner` holding exactly `scopes`, through the owner-authed door. */
async function setupAgent(owner: { name: string; token: string }, name: string, scopes: string[]): Promise<{ gaii: string; token: string }> {
    const reg = await json('/v1/agents', {
        method: 'POST', headers: authH(owner.token),
        body: JSON.stringify({ name, owner: owner.name, capabilities: ['memory'], scopes }),
    });
    assert(reg.status === 201, `agent ${name} ${reg.status}: ${JSON.stringify(reg.body.error)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: await sign(reg.body.data.private_key, gaii + ts) }),
    });
    assert(tok.status === 200, `agent token ${tok.status}`);
    return { gaii, token: tok.body.data.token as string };
}

// ── The node's own MCP door, the way an AI chat reaches it ─────────────────────────────────────

interface McpSession { token: string; sessionId?: string }
let rpcId = 0;
function parseSSE(text: string): any[] {
    return text.split('\n').filter(l => l.startsWith('data: '))
        .map(l => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean);
}
async function mcpRpc(session: McpSession, method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = ++rpcId;
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${session.token}`,
            ...(session.sessionId ? { 'mcp-session-id': session.sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) session.sessionId = sid;
    if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
        const msgs = parseSSE(await res.text());
        return msgs.find(m => m.id === id) ?? msgs[0] ?? {};
    }
    return await res.json();
}
async function openSession(token: string): Promise<McpSession> {
    const session: McpSession = { token };
    await mcpRpc(session, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'e2e-install-requests', version: '1.0.0' } });
    return session;
}
/** A tool call's answer: its text parsed when it is JSON, and whether the tool refused. */
async function callTool(session: McpSession, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string; data: any }> {
    const body = await mcpRpc(session, 'tools/call', { name, arguments: args });
    const text = body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body);
    let data: any;
    try { data = JSON.parse(text); } catch { data = null; }
    return { isError: body?.result?.isError === true || !!body?.error, text, data };
}

// ── Packages ───────────────────────────────────────────────────────────────────────────────────

const STAMP = Date.now().toString(36);
const MEMORY_ENTRIES = (prefix: string) => JSON.stringify({
    entries: [
        { key: `${prefix}.index`, value: { items: ['a', 'b'] }, visibility: 'private' },
        { key: `${prefix}.readme`, value: { text: 'What this holds' }, visibility: 'private' },
    ],
});

async function createPackage(token: string, name: string, prefix: string): Promise<{ groupId: string; encoded: string; version: string }> {
    const r = await json('/v1/packages', {
        method: 'POST', headers: authH(token),
        body: JSON.stringify({ name, description: 'install request coverage', category: 'utility', visibility: 'private', components: [
            { id: 'seed', type: 'memory', label: 'Seed records', content: MEMORY_ENTRIES(prefix), dependencies: [] },
        ] }),
    });
    assert(r.status === 201, `create package ${name}: ${r.status} ${JSON.stringify(r.body.error ?? r.body)}`);
    return { groupId: r.body.data.packageGroupId, encoded: encodeURIComponent(r.body.data.packageGroupId), version: r.body.data.version };
}

async function newVersion(token: string, encoded: string, prefix: string): Promise<string> {
    await new Promise(r => setTimeout(r, 1100));   // a version is named by its time, to the second
    const r = await json(`/v1/packages/${encoded}/versions`, {
        method: 'POST', headers: authH(token),
        body: JSON.stringify({ changelog: 'new seed', status: 'published', components: [
            { id: 'seed', type: 'memory', label: 'Seed records', content: MEMORY_ENTRIES(prefix), dependencies: [] },
        ] }),
    });
    assert(r.status === 201, `new version: ${r.status} ${JSON.stringify(r.body.error)}`);
    return r.body.data.version as string;
}

const memoryStatus = async (token: string, key: string) => (await json(`/v1/memory/${encodeURIComponent(key)}`, { headers: authH(token) })).status;
async function instancesOf(token: string, groupId: string): Promise<any[]> {
    const r = await json('/v1/instances?limit=100', { headers: authH(token) });
    return (r.body.data?.instances ?? []).filter((i: any) => i.packageGroupId === groupId);
}
async function requestsOf(token: string): Promise<any[]> {
    const r = await json('/v1/package-install-requests', { headers: authH(token) });
    return r.status === 200 ? (r.body.data?.requests ?? []) : [];
}
const requestIn = async (token: string, id: string) => (await requestsOf(token)).find(q => q.id === id);
const decide = (token: string, id: string, decision: string) => json(`/v1/package-install-requests/${encodeURIComponent(id)}/decision`, {
    method: 'POST', headers: authH(token), body: JSON.stringify({ decision }),
});
/** The turns the node sent to the requester about one request, read as the owner. */
async function toldAbout(ownerToken: string, requestId: string): Promise<any[]> {
    const r = await json(`/v1/agents/v2/messages?context_id=${encodeURIComponent(requestId)}`, { headers: authH(ownerToken) });
    return r.body.data?.messages ?? [];
}
const stateIn = (message: any): string | undefined => message?.parts?.find((p: any) => p.kind === 'data')?.data?.state;
async function openItemsFor(ownerToken: string, requestId: string): Promise<any[]> {
    const r = await json('/v1/open-items', { headers: authH(ownerToken) });
    return (r.body.data?.items ?? []).filter((i: any) => i.object?.type === 'package-install-request' && i.object?.id === requestId);
}

console.log('\n=== AIMEAT package install requests ===\n');

let A!: { name: string; token: string };
let C!: { name: string; token: string };
let narrow!: { gaii: string; token: string };
let helper!: { gaii: string; token: string };
let weak!: { gaii: string; token: string };
let other!: { gaii: string; token: string };
const pkgs: Array<Awaited<ReturnType<typeof createPackage>>> = [];
const P = (n: number) => `pir${STAMP}.p${n}`;

await test('Setup: two owners, three agents of the first, one of the second, seven packages', async () => {
    A = await setupOwner('a');
    C = await setupOwner('c');
    // The requester: allowed to install, not to write the owner's memory.
    narrow = await setupAgent(A, 'pir-narrow', ['packages:write', 'memory:read']);
    // Holds both memory words, so it may approve somebody else's request.
    helper = await setupAgent(A, 'pir-helper', ['packages:write', 'memory:read', 'memory:write', 'memory:write-as-owner']);
    // Holds memory:write but not memory:write-as-owner.
    weak = await setupAgent(A, 'pir-weak', ['packages:write', 'memory:read', 'memory:write']);
    other = await setupAgent(C, 'pir-other', ['packages:write', 'memory:read', 'memory:write', 'memory:write-as-owner']);
    for (let n = 1; n <= 7; n++) pkgs.push(await createPackage(A.token, `pir-kit-${n}-${STAMP}`, P(n)));
    assert(pkgs.length === 7, 'seven packages');
});

// ── R1-R5: the request instead of the refusal ─────────────────────────────────────────────────
console.log('\nR1-R5 — the install becomes a request');

let req1 = '';

await test('R1. An agent without the owner-memory words gets 202 and a request, and nothing is written', async () => {
    const r = await json(`/v1/packages/${pkgs[0].encoded}/install`, {
        method: 'POST', headers: authH(narrow.token), body: JSON.stringify({ label: 'first' }),
    });
    assert(r.status === 202, `expected 202, got ${r.status}: ${JSON.stringify(r.body.error ?? r.body.data)}`);
    assert(r.body.data?.status === 'awaiting_owner', `status: ${JSON.stringify(r.body.data)}`);
    req1 = r.body.data.request_id;
    assert(typeof req1 === 'string' && req1.length > 0, 'a request id');
    for (const word of ['memory:write', 'memory:write-as-owner']) {
        assert((r.body.data.missing ?? []).includes(word), `missing names ${word}: ${JSON.stringify(r.body.data.missing)}`);
    }
    assert(await memoryStatus(A.token, `${P(1)}.index`) === 404, 'nothing landed in the owner\'s memory');
    assert((await instancesOf(A.token, pkgs[0].groupId)).length === 0, 'no instance was recorded');
});

await test('R2. A dry run says it would wait for the owner, and files nothing', async () => {
    const before = (await requestsOf(A.token)).length;
    const r = await json(`/v1/packages/${pkgs[0].encoded}/install`, {
        method: 'POST', headers: authH(narrow.token), body: JSON.stringify({ label: 'dry', dry_run: true }),
    });
    assert(r.status === 200, `dry run: ${r.status} ${JSON.stringify(r.body.error ?? r.body.data)}`);
    assert(r.body.data?.status === 'would_await_owner', `the preview says what would happen: ${JSON.stringify(r.body.data)}`);
    assert((r.body.data?.missing ?? []).includes('memory:write-as-owner'), 'and names the words');
    assert((await requestsOf(A.token)).length === before, 'a dry run files no request');
});

await test('R3. The owner\'s list shows it: who asked, for what, and what is missing', async () => {
    const q = await requestIn(A.token, req1);
    assert(q?.id === req1, `the request is on the owner's list: ${JSON.stringify(await requestsOf(A.token)).slice(0, 300)}`);
    assert(q.state === 'awaiting_owner', `state: ${q.state}`);
    assert(q.act === 'install', `act: ${q.act}`);
    assert(q.requested_by?.principal === narrow.gaii && q.requested_by?.kind === 'agent', `requested_by: ${JSON.stringify(q.requested_by)}`);
    assert(q.package?.group_id === pkgs[0].groupId && q.package?.version === pkgs[0].version, `package: ${JSON.stringify(q.package)}`);
    assert((q.memory_parts ?? []).includes('seed'), `the memory part is named: ${JSON.stringify(q.memory_parts)}`);
    assert(typeof q.expires_at === 'string' && Date.parse(q.expires_at) > Date.now() + 6 * 86400_000, `seven days to decide: ${q.expires_at}`);
});

await test('R4. One open item and one notification with Approve and Decline', async () => {
    assert((await openItemsFor(A.token, req1)).length === 1, 'one open item on the owner\'s list');
    const n = await json('/v1/notifications?limit=200', { headers: authH(A.token) });
    const door = `/v1/package-install-requests/${req1}/decision`;
    const mine = (n.body.data?.notifications ?? []).filter((x: any) => (x.actions ?? []).some((a: any) => a.endpoint === door));
    assert(mine.length === 1, `one notification carries the door: ${mine.length}`);
    const ids = (mine[0].actions ?? []).map((a: any) => `${a.id}:${a.kind}:${a.body?.decision}`).sort();
    assert(JSON.stringify(ids) === JSON.stringify(['approve:api:approve', 'decline:api:decline']), `the actions: ${JSON.stringify(ids)}`);
});

await test('R5. Asking again returns the standing request, not a second one', async () => {
    const r = await json(`/v1/packages/${pkgs[0].encoded}/install`, {
        method: 'POST', headers: authH(narrow.token), body: JSON.stringify({ label: 'first' }),
    });
    assert(r.status === 202 && r.body.data?.request_id === req1, `the same request: ${r.status} ${JSON.stringify(r.body.data)}`);
    assert(r.body.data?.already_waiting === true, 'and it says so');
    assert((await openItemsFor(A.token, req1)).length === 1, 'still one open item');
});

// ── R6-R8: who may not decide ──────────────────────────────────────────────────────────────────
console.log('\nR6-R8 — who may not decide');

await test('R6. Another owner and their agent reach nothing of it', async () => {
    const read = await json(`/v1/package-install-requests/${req1}`, { headers: authH(C.token) });
    assert(read.status === 404, `another owner reads 404: ${read.status}`);
    const byOwner = await decide(C.token, req1, 'approve');
    assert(byOwner.status === 404, `another owner approving: ${byOwner.status}`);
    const byAgent = await decide(other.token, req1, 'approve');
    assert(byAgent.status === 404, `their agent approving: ${byAgent.status}`);
    assert(!(await requestsOf(C.token)).some(q => q.id === req1), 'not on the other owner\'s list');
    assert((await requestIn(A.token, req1))?.state === 'awaiting_owner', 'still waiting');
});

await test('R7. The requester cannot approve or decline its own request', async () => {
    for (const decision of ['approve', 'decline']) {
        const r = await decide(narrow.token, req1, decision);
        assert(r.status === 403 && r.body.error?.code === 'OWN_REQUEST', `${decision} by the requester: ${r.status} ${JSON.stringify(r.body.error ?? r.body.data)}`);
    }
    const session = await openSession(narrow.token);
    const t = await callTool(session, 'aimeat_package_install_requests', { request_id: req1, decision: 'approve' });
    assert(t.isError && t.text.startsWith('OWN_REQUEST'), `the tool refuses it too: ${t.text.slice(0, 200)}`);
    assert((await requestIn(A.token, req1))?.state === 'awaiting_owner', 'still waiting');
});

await test('R8. An agent without the words is refused, and told the owner approves on the page', async () => {
    const r = await decide(weak.token, req1, 'approve');
    assert(r.status === 403 && r.body.error?.code === 'SCOPE_DENIED', `REST: ${r.status} ${JSON.stringify(r.body.error ?? r.body.data)}`);
    const session = await openSession(weak.token);
    const t = await callTool(session, 'aimeat_package_install_requests', { request_id: req1, decision: 'approve' });
    assert(t.isError && t.text.startsWith('SCOPE_DENIED'), `MCP: ${t.text.slice(0, 200)}`);
    assert(t.text.includes('memory:write-as-owner'), `names the word it lacks: ${t.text}`);
    assert(/owner/i.test(t.text) && /Notifications/.test(t.text), `and says where the owner approves: ${t.text}`);
    assert(await memoryStatus(A.token, `${P(1)}.index`) === 404, 'nothing was installed');
    assert((await requestIn(A.token, req1))?.state === 'awaiting_owner', 'still waiting');
});

// ── R9-R10: the owner approves ─────────────────────────────────────────────────────────────────
console.log('\nR9-R10 — the owner approves on the door');

await test('R9. The owner approves: the part is installed under the owner, the item closes, the requester is told', async () => {
    const r = await decide(A.token, req1, 'approve');
    assert(r.status === 200, `approve: ${r.status} ${JSON.stringify(r.body.error ?? r.body.data)}`);
    assert(r.body.data?.request?.state === 'approved', `state: ${JSON.stringify(r.body.data?.request)}`);
    const instanceId = r.body.data.request.outcome?.instance_id;
    assert(typeof instanceId === 'string', `the outcome names the instance: ${JSON.stringify(r.body.data.request.outcome)}`);
    assert(await memoryStatus(A.token, `${P(1)}.index`) === 200, 'the memory part is the owner\'s');
    const inst = await json(`/v1/instances/${instanceId}`, { headers: authH(A.token) });
    assert(inst.status === 200 && inst.body.data?.packageGroupId === pkgs[0].groupId, `the instance: ${inst.status}`);
    assert((await openItemsFor(A.token, req1)).length === 0, 'the open item is closed');
    const told = await toldAbout(A.token, req1);
    assert(told.some(m => m.to === narrow.gaii && stateIn(m) === 'approved'), `the requester was told: ${JSON.stringify(told).slice(0, 300)}`);
    const ev = await json('/v1/account/events?limit=50', { headers: authH(A.token) });
    assert((ev.body.data?.events ?? []).some((e: any) => e.kind === 'package_installed' && e.subject === req1), 'an account event records it');
});

await test('R10. Deciding it again is refused, and changes nothing', async () => {
    const r = await decide(A.token, req1, 'approve');
    assert(r.status === 409 && r.body.error?.code === 'ALREADY_SETTLED', `again: ${r.status} ${JSON.stringify(r.body.error)}`);
    assert((await instancesOf(A.token, pkgs[0].groupId)).length === 1, 'still one copy');
});

// ── R11: a chat agent approves ─────────────────────────────────────────────────────────────────
console.log('\nR11 — an agent of the owner approves from a chat');

await test('R11. The requester asks on the MCP door; an agent holding the words approves on it', async () => {
    const asker = await openSession(narrow.token);
    const asked = await callTool(asker, 'aimeat_package_install', { group_id: pkgs[1].groupId, label: 'second' });
    assert(!asked.isError && asked.data?.status === 'awaiting_owner' && asked.data?.request_id, `the MCP twin files a request: ${asked.text.slice(0, 300)}`);
    const id = asked.data.request_id as string;

    const chat = await openSession(helper.token);
    const listed = await callTool(chat, 'aimeat_package_install_requests', {});
    assert(!listed.isError && (listed.data?.requests ?? []).some((q: any) => q.id === id && q.state === 'awaiting_owner'), `listed: ${listed.text.slice(0, 300)}`);
    const approved = await callTool(chat, 'aimeat_package_install_requests', { request_id: id, decision: 'approve' });
    assert(!approved.isError, `approved: ${approved.text.slice(0, 300)}`);
    assert(approved.data?.request?.state === 'approved' && approved.data.request.decided_by === helper.gaii, `decided by the agent: ${JSON.stringify(approved.data?.request)}`);
    assert(await memoryStatus(A.token, `${P(2)}.index`) === 200, 'installed under the owner');
    const n = await json('/v1/notifications?limit=200', { headers: authH(A.token) });
    assert((n.body.data?.notifications ?? []).some((x: any) => x.type === 'package_install_request_decided' && JSON.stringify(x).includes(`pir-kit-2-${STAMP}`)),
        'the owner is told an agent decided in their name');
});

// ── R12-R14: expired, declined, changed underneath ─────────────────────────────────────────────
console.log('\nR12-R14 — the ways a request stops being approvable');

await test('R12. An expired request cannot be approved', async () => {
    const r = await json(`/v1/packages/${pkgs[2].encoded}/install`, { method: 'POST', headers: authH(narrow.token), body: JSON.stringify({ label: 'third' }) });
    assert(r.status === 202, `filed: ${r.status}`);
    const id = r.body.data.request_id as string;
    // The owner may write their own reserved keys; this is the only way to age a request in a test.
    const key = `packages.install-requests.${id}`;
    const rec = await json(`/v1/memory/${encodeURIComponent(key)}`, { headers: authH(A.token) });
    assert(rec.status === 200, `the record is the owner's: ${rec.status}`);
    const value = { ...rec.body.data.value, expires_at: new Date(Date.now() - 60_000).toISOString() };
    const aged = await json('/v1/memory', { method: 'POST', headers: authH(A.token), body: JSON.stringify({ key, value, visibility: 'private' }) });
    // 200, not 201: the record exists, and this replaces it.
    assert(aged.status === 200, `aged: ${aged.status} ${JSON.stringify(aged.body.error)}`);
    const approve = await decide(A.token, id, 'approve');
    assert(approve.status === 410 && approve.body.error?.code === 'EXPIRED', `approve: ${approve.status} ${JSON.stringify(approve.body.error ?? approve.body.data)}`);
    assert(await memoryStatus(A.token, `${P(3)}.index`) === 404, 'nothing was installed');
    assert((await requestIn(A.token, id))?.state === 'expired', 'the request says expired');
    assert((await toldAbout(A.token, id)).some(m => stateIn(m) === 'expired'), 'the requester was told');
});

await test('R13. Declining closes it and tells the requester; any other agent of the owner may decline', async () => {
    const r = await json(`/v1/packages/${pkgs[3].encoded}/install`, { method: 'POST', headers: authH(narrow.token), body: JSON.stringify({ label: 'fourth' }) });
    assert(r.status === 202, `filed: ${r.status}`);
    const id = r.body.data.request_id as string;
    const d = await decide(weak.token, id, 'decline');
    assert(d.status === 200 && d.body.data?.request?.state === 'declined', `declined: ${d.status} ${JSON.stringify(d.body.error ?? d.body.data)}`);
    assert(await memoryStatus(A.token, `${P(4)}.index`) === 404, 'nothing was installed');
    assert((await openItemsFor(A.token, id)).length === 0, 'the open item is closed');
    const told = await toldAbout(A.token, id);
    assert(told.some(m => m.to === narrow.gaii && stateIn(m) === 'declined'), `the requester was told: ${JSON.stringify(told).slice(0, 300)}`);
});

await test('R14. A package version archived after the request cannot be installed by approving it', async () => {
    const r = await json(`/v1/packages/${pkgs[4].encoded}/install`, { method: 'POST', headers: authH(narrow.token), body: JSON.stringify({ label: 'fifth' }) });
    assert(r.status === 202, `filed: ${r.status}`);
    const id = r.body.data.request_id as string;
    const archived = await json(`/v1/packages/${pkgs[4].encoded}/versions/${pkgs[4].version}`, { method: 'DELETE', headers: authH(A.token) });
    assert(archived.status === 200, `archived: ${archived.status} ${JSON.stringify(archived.body.error)}`);
    const approve = await decide(A.token, id, 'approve');
    assert(approve.status === 409 && approve.body.error?.code === 'OUTDATED', `approve: ${approve.status} ${JSON.stringify(approve.body.error ?? approve.body.data)}`);
    assert(await memoryStatus(A.token, `${P(5)}.index`) === 404, 'nothing was installed');
    assert((await requestIn(A.token, id))?.state === 'outdated', 'the request says outdated');
});

// ── R15: forged records ────────────────────────────────────────────────────────────────────────
console.log('\nR15 — the prefix is reserved');

await test('R15. A record forged under the prefix is refused at the memory door, and never listed', async () => {
    const key = `packages.install-requests.forged-${STAMP}`;
    const forged = { spec: 'aimeat.package-install-request/v1', id: `forged-${STAMP}`, act: 'install', state: 'awaiting_owner', missing: [] };
    const r = await json('/v1/memory', {
        method: 'POST', headers: authH(helper.token), body: JSON.stringify({ key, value: forged, owner_scope: true }),
    });
    assert(r.status === 403 && r.body.error?.code === 'RESERVED_KEY', `an agent writing as the owner: ${r.status} ${JSON.stringify(r.body.error ?? r.body.data)}`);
    assert(await memoryStatus(A.token, key) === 404, 'nothing landed');
    assert(!(await requestsOf(A.token)).some(q => q.id === `forged-${STAMP}`), 'not on the owner\'s list');
});

// ── R16-R17: update and migration ──────────────────────────────────────────────────────────────
console.log('\nR16-R17 — an update and a migration take the same road');

await test('R16. An update that brings a memory part becomes a request on the MCP twin, and the owner approves it', async () => {
    const own = await json(`/v1/packages/${pkgs[5].encoded}/install`, { method: 'POST', headers: authH(A.token), body: JSON.stringify({ label: 'sixth' }) });
    assert(own.status === 201, `the owner installs v1: ${own.status}`);
    const instanceId = own.body.data.id as string;
    const v2 = await newVersion(A.token, pkgs[5].encoded, `${P(6)}.v2`);
    const session = await openSession(narrow.token);
    const asked = await callTool(session, 'aimeat_package_update', { instance_id: instanceId });
    assert(!asked.isError && asked.data?.status === 'awaiting_owner' && asked.data?.request_id, `the update files a request: ${asked.text.slice(0, 300)}`);
    const id = asked.data.request_id as string;
    assert(await memoryStatus(A.token, `${P(6)}.v2.index`) === 404, 'the new version wrote nothing yet');
    const q = await requestIn(A.token, id);
    assert(q?.act === 'update' && q.instance_id === instanceId && q.package?.version === v2, `the request: ${JSON.stringify(q)}`);
    const approve = await decide(A.token, id, 'approve');
    assert(approve.status === 200 && approve.body.data?.request?.state === 'approved', `approve: ${approve.status} ${JSON.stringify(approve.body.error ?? approve.body.data)}`);
    assert(await memoryStatus(A.token, `${P(6)}.v2.index`) === 200, 'the new version is the owner\'s');
    const inst = await json(`/v1/instances/${instanceId}`, { headers: authH(A.token) });
    assert(inst.body.data?.packageVersion === v2, `the copy is on v2: ${inst.body.data?.packageVersion}`);
});

await test('R17. A migration with merged content becomes a request, and approving applies that content', async () => {
    const own = await json(`/v1/packages/${pkgs[6].encoded}/install`, { method: 'POST', headers: authH(A.token), body: JSON.stringify({ label: 'seventh' }) });
    assert(own.status === 201, `the owner installs v1: ${own.status}`);
    const instanceId = own.body.data.id as string;
    const v2 = await newVersion(A.token, pkgs[6].encoded, `${P(7)}.v2`);
    const r = await json(`/v1/instances/${instanceId}/apply-migration`, {
        method: 'POST', headers: authH(narrow.token),
        body: JSON.stringify({ targetVersion: v2, components: [{ componentId: 'seed', action: 'custom', content: MEMORY_ENTRIES(`${P(7)}.merged`) }] }),
    });
    assert(r.status === 202 && r.body.data?.status === 'awaiting_owner', `migration: ${r.status} ${JSON.stringify(r.body.error ?? r.body.data)}`);
    const id = r.body.data.request_id as string;
    assert((await requestIn(A.token, id))?.act === 'migrate', 'a migration request');
    assert(await memoryStatus(A.token, `${P(7)}.merged.index`) === 404, 'nothing applied yet');
    const approve = await decide(A.token, id, 'approve');
    assert(approve.status === 200, `approve: ${approve.status} ${JSON.stringify(approve.body.error ?? approve.body.data)}`);
    assert(await memoryStatus(A.token, `${P(7)}.merged.index`) === 200, 'the merged content is the owner\'s');
});

await test('Cleanup: instances, packages and both owners', async () => {
    for (const p of pkgs) {
        for (const i of await instancesOf(A.token, p.groupId)) {
            await json(`/v1/instances/${i.id}`, { method: 'DELETE', headers: authH(A.token), body: JSON.stringify({ removeComponents: true }) });
        }
        await json(`/v1/packages/${p.encoded}`, { method: 'DELETE', headers: authH(A.token) });
    }
    for (const o of [A, C]) {
        const r = await json(`/v1/owners/${o.name}`, { method: 'DELETE', headers: authH(o.token) });
        assert(r.status === 200, `owner delete ${o.name} → ${r.status}`);
    }
});

console.log(`\nPackage install requests: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);
