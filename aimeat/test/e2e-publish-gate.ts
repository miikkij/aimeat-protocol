/**
 * @file e2e-publish-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the publish gate on memory records (plan doc-mvcn6c7e4e5q, V4.1-V4.5): who may
 *   make a record public without the owner, and the request the others file instead. Asserted:
 *     - gate off (the code default): an agent without publish:public makes a record public at once;
 *     - gate agents-and-apps: the same write answers 202 with a publish request, the record is stored
 *       private, anonymous cannot read it, and the owner reads the request on GET /v1/publish-requests;
 *     - the requester cannot decide its own request (403 OWN_REQUEST); a sibling agent without
 *       publish:public cannot approve (403 SCOPE_DENIED); another owner does not see it (404);
 *     - the owner approves: the record is public and anonymous reads it;
 *     - an agent holding publish:public, and the owner in person, make a record public at once;
 *     - a record written again after the request is not published by its approval (409 OUTDATED);
 *     - a declined request leaves the record private; asking twice returns the standing request;
 *     - PUT, PATCH and the MCP tool aimeat_memory_write ask the same way, and aimeat_publish_requests
 *       lists and decides over MCP;
 *     - an app grant without publish:public files a request; with it, it publishes at once;
 *     - the refusals: anonymous 401 on the request routes.
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4.5).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-publish-gate

import { createHash, randomBytes } from 'node:crypto';
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:28269';
const stamp = Date.now();

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
async function call(path: string, opts: { token?: string; body?: unknown; method?: string } = {}): Promise<{ status: number; body: Body }> {
    const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    return { status: res.status, body: (res.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) as Body : { _raw: text } };
}
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

console.log('\n=== AIMEAT Publish Gate (memory) E2E ===\n');

let op!: Awaited<ReturnType<typeof registerOwner>>;
let A!: Awaited<ReturnType<typeof registerOwner>>;
let B!: Awaited<ReturnType<typeof registerOwner>>;
let asker!: Awaited<ReturnType<typeof makeAgent>>;
let sibling!: Awaited<ReturnType<typeof makeAgent>>;
let publisher!: Awaited<ReturnType<typeof makeAgent>>;

const setGate = (value: string) => call('/v1/admin/config', { token: op.token, method: 'PUT', body: { changes: [{ path: 'visibility.publish_gate', value }] } });
/** The record as a stranger reads it: 200 only when it is public. */
const anonRead = (owner: string, key: string) => call(`/v1/memory/${encodeURIComponent(owner)}/${encodeURIComponent(key)}`);
const ownerRead = (key: string, ns: string) => call(`/v1/memory/${encodeURIComponent(ns)}/${encodeURIComponent(key)}`, { token: A.token });

await test('Setup: an operator, owner A with three agents, owner B', async () => {
    op = await registerOwner(BASE, `pgop${stamp}`);
    A = await registerOwner(BASE, `pga${stamp}`);
    B = await registerOwner(BASE, `pgb${stamp}`);
    asker = await makeAgent(BASE, A, ['memory:read', 'memory:write']);
    sibling = await makeAgent(BASE, A, ['memory:read', 'memory:write']);
    publisher = await makeAgent(BASE, A, ['memory:read', 'memory:write', 'publish:public']);
});

await test('Gate off (the code default): an agent without publish:public makes a record public at once', async () => {
    const key = `pg.off.${stamp}`;
    const w = await call('/v1/memory', { token: asker.token, body: { key, value: { n: 1 }, visibility: 'public' } });
    assert(w.status === 201, `write: ${w.status} ${JSON.stringify(w.body.error)}`);
    assert(w.body.data.visibility === 'public' && !w.body.data.publish_request, `stored ${w.body.data.visibility}, request ${JSON.stringify(w.body.data.publish_request)}`);
    const r = await anonRead(asker.gaii, key);
    assert(r.status === 200, `anonymous read of a public record: ${r.status}`);
});

let firstRequest = '';
const askedKey = `pg.asked.${stamp}`;
await test('Gate agents-and-apps: the agent\'s public write answers 202 with a request, and the record is private', async () => {
    const g = await setGate('agents-and-apps');
    assert(g.status === 200, `gate: ${g.status} ${JSON.stringify(g.body.error)}`);
    const w = await call('/v1/memory', { token: asker.token, body: { key: askedKey, value: { n: 2 }, visibility: 'public' } });
    assert(w.status === 202, `write: ${w.status} ${JSON.stringify(w.body.error ?? w.body.data)}`);
    assert(w.body.data.visibility === 'private', `stored as ${w.body.data.visibility}`);
    const pr = w.body.data.publish_request;
    assert(pr && pr.status === 'awaiting_owner' && typeof pr.request_id === 'string', `request: ${JSON.stringify(pr)}`);
    assert(typeof pr.approve_url === 'string' && pr.approve_url.includes('tab=notifications'), `approve_url: ${pr.approve_url}`);
    firstRequest = pr.request_id;
    const r = await anonRead(asker.gaii, askedKey);
    assert(r.status !== 200, `anonymous read of the waiting record: ${r.status}`);
    const again = await call('/v1/memory', { token: asker.token, body: { key: askedKey, value: { n: 2.5 }, visibility: 'public' } });
    assert(again.status === 202 && again.body.data.publish_request.request_id === firstRequest && again.body.data.publish_request.already_waiting === true,
        `asking again is the standing request, now about the new version: ${again.status} ${JSON.stringify(again.body.data?.publish_request)}`);
});

await test('The owner lists the waiting requests; anonymous gets 401, owner B sees none of A\'s', async () => {
    const l = await call('/v1/publish-requests', { token: A.token });
    assert(l.status === 200 && l.body.data.waiting >= 1, `list: ${l.status} ${JSON.stringify(l.body.error ?? l.body.data)}`);
    assert((l.body.data.requests as Body[]).some(r => r.id === firstRequest && r.kind === 'memory'), 'the request is listed');
    assert((await call('/v1/publish-requests')).status === 401, 'anonymous list');
    const b = await call(`/v1/publish-requests/${firstRequest}`, { token: B.token });
    assert(b.status === 404, `owner B reads A's request: ${b.status}`);
    const bd = await call(`/v1/publish-requests/${firstRequest}/decision`, { token: B.token, body: { decision: 'approve' } });
    assert(bd.status === 404, `owner B decides A's request: ${bd.status}`);
});

await test('The asker cannot decide its own request; a sibling without publish:public cannot approve', async () => {
    const own = await call(`/v1/publish-requests/${firstRequest}/decision`, { token: asker.token, method: 'POST', body: { decision: 'approve' } });
    assert(own.status === 403 && own.body.error.code === 'OWN_REQUEST', `own: ${own.status} ${JSON.stringify(own.body.error)}`);
    const sib = await call(`/v1/publish-requests/${firstRequest}/decision`, { token: sibling.token, method: 'POST', body: { decision: 'approve' } });
    assert(sib.status === 403 && sib.body.error.code === 'SCOPE_DENIED', `sibling: ${sib.status} ${JSON.stringify(sib.body.error)}`);
});

await test('The owner approves: the record is public and anonymous reads it', async () => {
    const d = await call(`/v1/publish-requests/${firstRequest}/decision`, { token: A.token, body: { decision: 'approve' } });
    assert(d.status === 200 && d.body.data.request.state === 'approved', `approve: ${d.status} ${JSON.stringify(d.body.error ?? d.body.data)}`);
    const r = await anonRead(asker.gaii, askedKey);
    assert(r.status === 200 && r.body.data.value.n === 2.5, `anonymous read after approval: ${r.status} ${JSON.stringify(r.body.data?.value)}`);
    const twice = await call(`/v1/publish-requests/${firstRequest}/decision`, { token: A.token, body: { decision: 'approve' } });
    assert(twice.status === 409 && twice.body.error.code === 'ALREADY_DECIDED', `decided twice: ${twice.status}`);
});

await test('A record written again after the request, without asking, is not published by its approval (409 OUTDATED)', async () => {
    const key = `pg.changed.${stamp}`;
    const w = await call('/v1/memory', { token: asker.token, body: { key, value: { n: 'benign' }, visibility: 'public' } });
    assert(w.status === 202, `write: ${w.status}`);
    const changed = await call('/v1/memory', { token: asker.token, body: { key, value: { n: 'something else' }, visibility: 'private' } });
    assert(changed.status === 200 && !changed.body.data.publish_request, `rewrite: ${changed.status}`);
    const d = await call(`/v1/publish-requests/${w.body.data.publish_request.request_id}/decision`, { token: A.token, body: { decision: 'approve' } });
    assert(d.status === 409 && d.body.error.code === 'OUTDATED', `approve: ${d.status} ${JSON.stringify(d.body.error)}`);
    const rec = await ownerRead(key, asker.gaii);
    assert(rec.status === 200 && rec.body.data.visibility === 'private', `still private: ${JSON.stringify(rec.body.data?.visibility)}`);
});

await test('PATCH asks the same way; a declined request leaves the record private', async () => {
    const key = `pg.declined.${stamp}`;
    const w = await call('/v1/memory', { token: asker.token, body: { key, value: { n: 3 }, visibility: 'private' } });
    assert(w.status === 201, `write: ${w.status}`);
    const p = await call(`/v1/memory/${encodeURIComponent(key)}`, { token: asker.token, method: 'PATCH', body: { patch: { m: 1 }, visibility: 'public' } });
    assert(p.status === 202 && p.body.data.visibility === 'private', `patch: ${p.status} ${JSON.stringify(p.body.error ?? p.body.data)}`);
    const d = await call(`/v1/publish-requests/${p.body.data.publish_request.request_id}/decision`, { token: sibling.token, body: { decision: 'decline' } });
    assert(d.status === 200 && d.body.data.request.state === 'declined', `a sibling declines: ${d.status} ${JSON.stringify(d.body.error)}`);
    const rec = await ownerRead(key, asker.gaii);
    assert(rec.body.data.visibility === 'private', `still private: ${rec.body.data.visibility}`);
});

await test('PUT asks the same way, and an agent holding publish:public publishes at once', async () => {
    const key = `pg.put.${stamp}`;
    const first = await call('/v1/memory', { token: asker.token, body: { key, value: { n: 4 }, visibility: 'private' } });
    assert(first.status === 201, `create: ${first.status}`);
    const put = await call(`/v1/memory/${encodeURIComponent(key)}`, { token: asker.token, method: 'PUT', body: { visibility: 'public', version: first.body.data.version } });
    assert(put.status === 202 && put.body.data.publish_request, `put: ${put.status} ${JSON.stringify(put.body.error ?? put.body.data)}`);
    const pub = await call('/v1/memory', { token: publisher.token, body: { key: `pg.pub.${stamp}`, value: { n: 5 }, visibility: 'public' } });
    assert(pub.status === 201 && pub.body.data.visibility === 'public', `publisher: ${pub.status} ${pub.body.data?.visibility}`);
});

await test('The owner in person makes a record public at once, and a sibling holding publish:public approves', async () => {
    const own = await call('/v1/memory', { token: A.token, body: { key: `pg.owner.${stamp}`, value: { n: 6 }, visibility: 'public' } });
    assert(own.status === 201 && own.body.data.visibility === 'public', `owner: ${own.status}`);
    const key = `pg.byagent.${stamp}`;
    const w = await call('/v1/memory', { token: asker.token, body: { key, value: { n: 7 }, visibility: 'public' } });
    const d = await call(`/v1/publish-requests/${w.body.data.publish_request.request_id}/decision`, { token: publisher.token, body: { decision: 'approve' } });
    assert(d.status === 200 && d.body.data.request.state === 'approved', `publisher approves: ${d.status} ${JSON.stringify(d.body.error)}`);
    assert((await anonRead(asker.gaii, key)).status === 200, 'public after the agent approved');
});

await test('MCP: aimeat_memory_write asks, aimeat_publish_requests lists and decides', async () => {
    const s = await openSession(BASE, asker.token);
    const key = `pg.mcp.${stamp}`;
    const w = await callTool(s, 'aimeat_memory_write', { key, value: { n: 8 }, visibility: 'public' });
    assert(!w.isError && w.text.includes('publish_request') && w.text.includes('approve_url'), `memory_write: ${w.text.slice(0, 300)}`);
    const l = await callTool(s, 'aimeat_publish_requests', {});
    assert(!l.isError && l.text.includes(key), `list: ${l.text.slice(0, 300)}`);
    const ps = await openSession(BASE, publisher.token);
    const listed = JSON.parse((await callTool(ps, 'aimeat_publish_requests', {})).text) as Body;
    const id = (listed.requests as Body[]).find(r => r.target?.key === key && r.state === 'awaiting_owner')?.id;
    assert(id, 'the publisher sees the request');
    const d = await callTool(ps, 'aimeat_publish_requests', { request_id: id, decision: 'approve' });
    assert(!d.isError && d.text.includes('approved'), `decide: ${d.text.slice(0, 300)}`);
    const own = await callTool(s, 'aimeat_publish_requests', { request_id: id, decision: 'decline' });
    assert(own.isError, 'the asker decides nothing over MCP either');
});

// An app grant: authorize with PKCE, the owner consents, the code is exchanged.
// A loopback callback, as test/e2e-app-grants.ts uses: the node accepts one for a local app.
const REDIRECT = 'http://localhost:9911/callback';
async function appGrant(owner: { name: string; token: string }, filename: string, scope: string): Promise<string> {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const redirect = REDIRECT;
    const q = new URLSearchParams({ app: `${owner.name}/${filename}`, response_type: 'code', scope, redirect_uri: redirect, state: 's', code_challenge: challenge, code_challenge_method: 'S256' });
    const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    const m = /\/v1\/app-grant\?req=([^&]+)/.exec(res.headers.get('location') ?? '');
    assert(m, `authorize: ${res.status} ${res.headers.get('location')}`);
    const c = await call('/v1/app-grants/authorize-consent', { token: owner.token, body: { request_id: decodeURIComponent(m[1]) } });
    assert(c.status === 200, `consent: ${c.status} ${JSON.stringify(c.body.error)}`);
    const code = new URL(c.body.data.redirect_url).searchParams.get('code');
    const t = await call('/v1/app-grants/token', { body: { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect } });
    assert(t.status === 200, `token: ${t.status} ${JSON.stringify(t.body.error)}`);
    return t.body.data.access_token as string;
}

await test('An app grant without publish:public files a request; with it, the app publishes at once', async () => {
    for (const f of [`pg-ask-${stamp}.html`, `pg-pub-${stamp}.html`]) {
        const a = await call('/v1/apps', { token: A.token, body: { filename: f, content: b64(`<!DOCTYPE html><html><body>${f}</body></html>`), mime_type: 'text/html', description: 'Publish gate fixture' } });
        assert(a.status === 201, `app ${f}: ${a.status} ${JSON.stringify(a.body.error)}`);
    }
    const narrow = await appGrant(A, `pg-ask-${stamp}.html`, 'memory:write');
    const w = await call('/v1/memory', { token: narrow, body: { key: `pg.app.${stamp}`, value: { n: 9 }, visibility: 'public' } });
    assert(w.status === 202 && w.body.data.publish_request?.kind === 'memory', `app without the word: ${w.status} ${JSON.stringify(w.body.error ?? w.body.data)}`);
    const own = await call('/v1/publish-requests', { token: narrow });
    assert(own.status === 200 && (own.body.data.requests as Body[]).length === 1, `the app sees its own request only: ${own.status} ${JSON.stringify(own.body.data?.requests?.length)}`);
    const decide = await call(`/v1/publish-requests/${w.body.data.publish_request.request_id}/decision`, { token: narrow, body: { decision: 'approve' } });
    assert(decide.status === 403, `an app decides nothing: ${decide.status}`);
    const wide = await appGrant(A, `pg-pub-${stamp}.html`, 'memory:write publish:public');
    const p = await call('/v1/memory', { token: wide, body: { key: `pg.app.pub.${stamp}`, value: { n: 10 }, visibility: 'public' } });
    assert(p.status === 201 && p.body.data.visibility === 'public', `app with the word: ${p.status} ${JSON.stringify(p.body.error)}`);
});

await test('Cleanup: the gate back to off', async () => {
    const g = await setGate('off');
    assert(g.status === 200, `gate off: ${g.status}`);
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}\n`);
process.exit(failed > 0 ? 1 : 0);
