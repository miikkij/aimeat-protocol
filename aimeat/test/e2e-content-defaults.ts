/**
 * @file e2e-content-defaults.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the node's starting levels for content (plan doc-mvcn6c7e4e5q, V5): the level a
 *   record, a file, an app's upload, a board, an organism, a workspace share, a data package and a new
 *   agent's directory listing get when the caller names none. For each setting it asserts:
 *     - unset (the code default): today's level;
 *     - set by the operator (PUT /v1/admin/config): the new level when the caller names none;
 *     - a level the caller names still wins.
 *   The app-upload level answers only `visibility: 'default'` (the word AIMEAT.assets.upload sends): an
 *   app's direct post with no visibility still lands at the file level (private).
 *   Also asserted: a non-operator cannot set one (403); a default of public is asked about by the
 *   publish gate like an explicit public (a board by an agent without publish:public answers 202 and
 *   is stored private); every setting is put back at the end.
 * @version-history
 *   v1.1.0 — 2026-10-18 — An app's direct post with no visibility lands private; the SDK's 'default' gets the app-upload level.
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V5).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-content-defaults

import { createHash, randomBytes } from 'node:crypto';
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:28483';
const stamp = Date.now();
const tag = stamp.toString(36);

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
const show = (r: { status: number; body: Body }) => `${r.status} ${JSON.stringify(r.body.error ?? r.body.data ?? r.body).slice(0, 300)}`;
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

console.log('\n=== AIMEAT Content Starting Levels E2E ===\n');

let op!: Awaited<ReturnType<typeof registerOwner>>;
let A!: Awaited<ReturnType<typeof registerOwner>>;
let agent!: Awaited<ReturnType<typeof makeAgent>>;

/** The code default of every setting, which the last step puts back. */
const CODE_DEFAULTS: Record<string, string | boolean> = {
    'visibility.memory_default': 'private',
    'visibility.file_default': 'private',
    'visibility.app_upload_default': 'public',
    'visibility.board_default': 'public',
    'visibility.organism_default': 'public',
    'visibility.share_access_default': 'open',
    'visibility.datapackage_default': 'public',
    'visibility.agent_listed_default': true,
    'visibility.publish_gate': 'off',
};
async function setConfig(path: string, value: string | boolean): Promise<void> {
    const r = await call('/v1/admin/config', { token: op.token, method: 'PUT', body: { changes: [{ path, value }] } });
    assert(r.status === 200, `set ${path}=${String(value)}: ${show(r)}`);
}
const ownerRecord = (ns: string, key: string) => call(`/v1/memory/${encodeURIComponent(ns)}/${encodeURIComponent(key)}`, { token: A.token });

await test('Setup: the operator (first account), owner A and an agent of A', async () => {
    op = await registerOwner(BASE, `cdop${stamp}`);
    A = await registerOwner(BASE, `cda${stamp}`);
    agent = await makeAgent(BASE, A, ['memory:read', 'memory:write', 'social:read', 'social:write']);
    // Every setting at its code default, whatever an earlier suite left.
    for (const [path, value] of Object.entries(CODE_DEFAULTS)) await setConfig(path, value);
});

await test('A non-operator cannot set a starting level (403)', async () => {
    const r = await call('/v1/admin/config', { token: A.token, method: 'PUT', body: { changes: [{ path: 'visibility.memory_default', value: 'members' }] } });
    assert(r.status === 403, `owner A sets the config: ${show(r)}`);
});

await test('V5.1 memory: private unset; members when set (POST, bulk, MCP); a named level wins', async () => {
    const k0 = `cd.mem0.${tag}`;
    const w0 = await call('/v1/memory', { token: A.token, body: { key: k0, value: { n: 0 } } });
    assert(w0.status === 201 && w0.body.data.visibility === 'private', `unset: ${show(w0)}`);
    await setConfig('visibility.memory_default', 'members');
    const k1 = `cd.mem1.${tag}`;
    const w1 = await call('/v1/memory', { token: A.token, body: { key: k1, value: { n: 1 } } });
    assert(w1.status === 201 && w1.body.data.visibility === 'members', `set: ${show(w1)}`);
    const k2 = `cd.mem2.${tag}`;
    const w2 = await call('/v1/memory', { token: A.token, body: { key: k2, value: { n: 2 }, visibility: 'private' } });
    assert(w2.status === 201 && w2.body.data.visibility === 'private', `named: ${show(w2)}`);
    const kb = `cd.memb.${tag}`;
    const bulk = await call('/v1/memory/bulk', { token: A.token, body: { entries: [{ key: kb, value: { n: 3 } }] } });
    assert(bulk.status < 300, `bulk: ${show(bulk)}`);
    const rb = await ownerRecord(A.ghii, kb);
    assert(rb.status === 200 && rb.body.data.visibility === 'members', `bulk entry: ${show(rb)}`);
    const km = `cd.memm.${tag}`;
    const s = await openSession(BASE, agent.token);
    const t = await callTool(s, 'aimeat_memory_write', { key: km, value: { n: 4 } });
    assert(!t.isError, `MCP write: ${t.text.slice(0, 300)}`);
    const rm = await ownerRecord(agent.gaii, km);
    assert(rm.status === 200 && rm.body.data.visibility === 'members', `MCP entry: ${show(rm)}`);
});

await test('V5.2 files: private unset; members when set; a named level wins', async () => {
    const up = (key: string, visibility?: string) => call('/v1/storage', { token: A.token, body: { key, data: b64(`file ${key}`), mime_type: 'text/plain', ...(visibility ? { visibility } : {}) } });
    const f0 = await up(`cd/f0-${tag}.txt`);
    assert(f0.status === 201 && f0.body.data.visibility === 'private', `unset: ${show(f0)}`);
    await setConfig('visibility.file_default', 'members');
    const f1 = await up(`cd/f1-${tag}.txt`);
    assert(f1.status === 201 && f1.body.data.visibility === 'members', `set: ${show(f1)}`);
    const f2 = await up(`cd/f2-${tag}.txt`, 'private');
    assert(f2.status === 201 && f2.body.data.visibility === 'private', `named: ${show(f2)}`);
});

// An app grant: authorize with PKCE, the owner consents, the code is exchanged (as e2e-publish-gate.ts).
const REDIRECT = 'http://localhost:9911/callback';
async function appGrant(owner: { name: string; token: string }, filename: string, scope: string): Promise<string> {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const q = new URLSearchParams({ app: `${owner.name}/${filename}`, response_type: 'code', scope, redirect_uri: REDIRECT, state: 's', code_challenge: challenge, code_challenge_method: 'S256' });
    const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    const m = /\/v1\/app-grant\?req=([^&]+)/.exec(res.headers.get('location') ?? '');
    assert(m, `authorize: ${res.status} ${res.headers.get('location')}`);
    const c = await call('/v1/app-grants/authorize-consent', { token: owner.token, body: { request_id: decodeURIComponent(m[1]) } });
    assert(c.status === 200, `consent: ${show(c)}`);
    const code = new URL(c.body.data.redirect_url).searchParams.get('code');
    const t = await call('/v1/app-grants/token', { body: { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT } });
    assert(t.status === 200, `token: ${show(t)}`);
    return t.body.data.access_token as string;
}

let app = '';
await test('V5.2 an app\'s direct post with no visibility lands private, as before V5 (the app-upload default is not asked)', async () => {
    await setConfig('visibility.file_default', 'private');
    const f = `cd-app-${tag}.html`;
    const a = await call('/v1/apps', { token: A.token, body: { filename: f, content: b64(`<!DOCTYPE html><html><body>${f}</body></html>`), mime_type: 'text/html', description: 'Content defaults fixture' } });
    assert(a.status === 201, `app: ${show(a)}`);
    app = await appGrant(A, f, 'storage:write');
    const direct = await call('/v1/storage', { token: app, body: { key: `cd/direct-${tag}.txt`, data: b64('direct'), mime_type: 'text/plain' } });
    assert(direct.status === 201 && direct.body.data.visibility === 'private', `direct post, app-upload default public: ${show(direct)}`);
    const files = await call('/v1/memory/files', { token: app, body: { key: `cd/direct-mf-${tag}.txt`, content: b64('direct'), mime_type: 'text/plain' } });
    assert(files.status === 201 && files.body.data.visibility === 'private', `direct POST /v1/memory/files: ${show(files)}`);
});

await test('V5.2 an SDK-shaped post (visibility "default"): public unset; private when set; a named level wins; a person gets the file default', async () => {
    const up = (token: string, key: string, visibility: string) => call('/v1/storage', { token, body: { key, data: b64(`asset ${key}`), mime_type: 'text/plain', visibility } });
    const u0 = await up(app, `cd/app0-${tag}.txt`, 'default');
    assert(u0.status === 201 && u0.body.data.visibility === 'public', `unset: ${show(u0)}`);
    await setConfig('visibility.app_upload_default', 'private');
    const u1 = await up(app, `cd/app1-${tag}.txt`, 'default');
    assert(u1.status === 201 && u1.body.data.visibility === 'private', `set: ${show(u1)}`);
    const u2 = await up(app, `cd/app2-${tag}.txt`, 'public');
    assert(u2.status === 201 && u2.body.data.visibility === 'public', `named: ${show(u2)}`);
    await setConfig('visibility.file_default', 'members');
    const p = await up(A.token, `cd/p-${tag}.txt`, 'default');
    assert(p.status === 201 && p.body.data.visibility === 'members', `a person's "default": ${show(p)}`);
    const init = await call('/v1/storage/upload/init', { token: app, body: { key: `cd/chunk-${tag}.bin`, mime_type: 'application/octet-stream', chunk_size: 1024, total_chunks: 1, visibility: 'default' } });
    assert(init.status === 201, `chunked init takes "default": ${show(init)}`);
    await call(`/v1/storage/upload/${init.body.data.upload_id}`, { token: app, method: 'DELETE' });
});

await test('V5.3 boards: public unset; private when set; a named level wins', async () => {
    const b0 = await call('/v1/boards', { token: A.token, body: { name: `cd board 0 ${tag}` } });
    assert(b0.status === 201 && b0.body.data.visibility === 'public', `unset: ${show(b0)}`);
    await setConfig('visibility.board_default', 'private');
    const b1 = await call('/v1/boards', { token: A.token, body: { name: `cd board 1 ${tag}` } });
    assert(b1.status === 201 && b1.body.data.visibility === 'private', `set: ${show(b1)}`);
    const b2 = await call('/v1/boards', { token: A.token, body: { name: `cd board 2 ${tag}`, visibility: 'public' } });
    assert(b2.status === 201 && b2.body.data.visibility === 'public', `named: ${show(b2)}`);
});

await test('A default of public asks the publish gate: an agent\'s board with no level answers 202 and is private', async () => {
    await setConfig('visibility.board_default', 'public');
    await setConfig('visibility.publish_gate', 'agents');
    const r = await call('/v1/boards', { token: agent.token, body: { name: `cd board gate ${tag}` } });
    assert(r.status === 202 && r.body.data.visibility === 'private' && r.body.data.publish_request?.kind === 'board', `gate: ${show(r)}`);
    await setConfig('visibility.publish_gate', 'off');
});

await test('V5.4 organisms: public unset; private when set; a named level wins', async () => {
    const o0 = await call('/v1/organisms', { token: A.token, body: { name: `cd org 0 ${tag}` } });
    assert(o0.status === 201 && o0.body.data.organism.visibility === 'public', `unset: ${show(o0)}`);
    await setConfig('visibility.organism_default', 'private');
    const o1 = await call('/v1/organisms', { token: A.token, body: { name: `cd org 1 ${tag}` } });
    assert(o1.status === 201 && o1.body.data.organism.visibility === 'private', `set: ${show(o1)}`);
    const o2 = await call('/v1/organisms', { token: A.token, body: { name: `cd org 2 ${tag}`, visibility: 'public' } });
    assert(o2.status === 201 && o2.body.data.organism.visibility === 'public', `named: ${show(o2)}`);
});

await test('V5.5 workspace shares: open unset; account when set; a named access wins; a later change keeps it', async () => {
    const o = await call('/v1/organisms', { token: A.token, body: { name: `cd share org ${tag}`, visibility: 'private' } });
    assert(o.status === 201, `organism: ${show(o)}`);
    const orgId = o.body.data.organism.id as string;
    const workspace = async (n: number): Promise<string> => {
        const w = await call(`/v1/organisms/${orgId}/workspaces`, { token: A.token, body: {
            name: `Pages ${n}`,
            manifest: { manifestVersion: '1', name: `Pages ${n}`, kind: 'project', objectTypes: [
                { name: 'pages', namespace: 'shared.pages', schemaRef: 'schema:page@1', mode: 'document', backing: 'memory', writeRole: 'member' },
            ] },
        } });
        assert(w.status === 201, `workspace ${n}: ${show(w)}`);
        return w.body.data.ws as string;
    };
    const share = (ws: string, body: Body) => call(`/v1/organisms/${orgId}/workspace/share?ws=${ws}`, { token: A.token, method: 'PUT', body });
    const s0 = await share(await workspace(0), { public: true });
    assert(s0.status === 200 && s0.body.data.share.access === 'open', `unset: ${show(s0)}`);
    await setConfig('visibility.share_access_default', 'account');
    const ws1 = await workspace(1);
    const s1 = await share(ws1, { public: true });
    assert(s1.status === 200 && s1.body.data.share.access === 'account', `set: ${show(s1)}`);
    const s1b = await share(ws1, { public: false });
    assert(s1b.status === 200 && s1b.body.data.share.access === 'account', `a later change keeps the stored access: ${show(s1b)}`);
    const s2 = await share(await workspace(2), { public: true, access: 'open' });
    assert(s2.status === 200 && s2.body.data.share.access === 'open', `named: ${show(s2)}`);
});

await test('V5.6 data packages: public unset; private when set; a named level wins', async () => {
    const publish = (name: string, visibility?: string) => call('/v1/datapackages', { token: A.token, method: 'POST', body: {
        name, changes: 'a version', resources: [{ name: 'items', rows: [{ id: 1, label: 'one' }] }], ...(visibility ? { visibility } : {}),
    } });
    const anon = (name: string) => call(`/v1/datapackages/${A.name}/${name}`);
    const d0 = `cdpkg0${tag}`;
    const p0 = await publish(d0);
    assert(p0.status === 201 || p0.status === 200, `unset publish: ${show(p0)}`);
    assert((await anon(d0)).status === 200, 'unset: anonymous reads it');
    await setConfig('visibility.datapackage_default', 'private');
    const d1 = `cdpkg1${tag}`;
    const p1 = await publish(d1);
    assert(p1.status === 201 || p1.status === 200, `set publish: ${show(p1)}`);
    assert((await anon(d1)).status === 404, 'set: anonymous does not read it');
    assert((await call(`/v1/datapackages/${A.name}/${d1}`, { token: A.token })).status === 200, 'set: the owner reads it');
    const d2 = `cdpkg2${tag}`;
    const p2 = await publish(d2, 'public');
    assert(p2.status === 201 || p2.status === 200, `named publish: ${show(p2)}`);
    assert((await anon(d2)).status === 200, 'named: anonymous reads it');
});

/** Whether the public agent directory lists this agent (all pages). */
async function listed(gaii: string): Promise<boolean> {
    for (let page = 1; page < 200; page++) {
        const r = await call(`/v1/catalogue/agents?per_page=50&page=${page}`);
        assert(r.status === 200, `catalogue: ${show(r)}`);
        const agents = r.body.data.agents as Body[];
        if (agents.some(a => a.gaii === gaii)) return true;
        if (agents.length < 50) return false;
    }
    return false;
}

await test('V5.8 a new agent: listed unset; unlisted when set; an agent made before keeps its listing', async () => {
    assert(await listed(agent.gaii), 'unset: the agent made in setup is listed');
    await setConfig('visibility.agent_listed_default', false);
    const later = await makeAgent(BASE, A, ['memory:read']);
    assert(!(await listed(later.gaii)), 'set: the new agent is not listed');
    assert(await listed(agent.gaii), 'the agent made before is still listed');
});

await test('Cleanup: every setting back to its code default', async () => {
    for (const [path, value] of Object.entries(CODE_DEFAULTS)) await setConfig(path, value);
    const w = await call('/v1/memory', { token: A.token, body: { key: `cd.after.${tag}`, value: { n: 9 } } });
    assert(w.status === 201 && w.body.data.visibility === 'private', `after reset: ${show(w)}`);
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}\n`);
process.exit(failed > 0 ? 1 : 0);
