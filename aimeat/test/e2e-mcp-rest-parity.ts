/**
 * @file test/e2e-mcp-rest-parity.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One capability, one implementation: the node MCP tool and its REST route answer the
 *   same call the same way, because both call one service function. Each phase runs one call on
 *   both surfaces as the same agent and compares the answers.
 *
 *   - Extension invoke: a failing action whose error text carries a credential-shaped string gives
 *     the same redacted text over POST /v1/ext/:extName/:actionId and aimeat_extension_invoke; a
 *     version pin (name@version) resolves on both, and an unknown version is refused on both.
 *   - Memory: a multi-word search returns the same keys on GET /v1/memory/search and
 *     aimeat_memory_search; the owner-scope listing lists one key held by the owner and the agent
 *     once on GET /v1/memory?owner_scope=true and on aimeat_memory_list.
 *   - Organism archive: an attached agent of the creator is refused on both surfaces, and an archive
 *     made over MCP writes the organism timeline entry the route writes.
 *   - Beneficiary split: the split's author is the calling agent on both surfaces, and one invalid
 *     declaration is refused with one code (INVALID_INPUT).
 *   - Mail send: the contact id aimeat_contact_add returns (`mail:<record id>` for a plain address,
 *     the person's identity once they proved the address here) is the id aimeat_mail_send and
 *     POST /v1/outbound/send take; another owner's agent is refused the same id.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-mcp-rest-parity
 * @version-history
 *   2026-10-16 — Initial (QA audit D2-05, D2-06, D2-08, F12b-01).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { authorizeParams, mcpPkce, tokenParams } from './helpers/mcp-oauth-pkce.js';
import { ownerSignIn } from './helpers/owner-login.js';
import { markEmailVerified } from './helpers/verified-email.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0, failed = 0;
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
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function signMsg(priv: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(priv, 'base64'))).toString('base64');
}
function parseSSE(text: string): any[] {
    const out: any[] = [];
    for (const evt of text.split('\n\n')) {
        let data = '';
        for (const line of evt.trim().split('\n')) if (line.startsWith('data: ')) data += line.slice(6);
        if (data) { try { out.push(JSON.parse(data)); } catch { /* not JSON */ } }
    }
    return out;
}

/** One MCP session over the streamable-HTTP transport, with a tools/call helper. */
class McpSession {
    token = ''; sessionId = ''; rpcId = 0;
    async rpc(method: string, params: Record<string, any> = {}) {
        const id = ++this.rpcId;
        const res = await fetch(`${BASE}/v1/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
                ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
                ...(this.sessionId ? { 'mcp-session-id': this.sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        });
        const sid = res.headers.get('mcp-session-id');
        if (sid) this.sessionId = sid;
        const ct = res.headers.get('content-type') ?? '';
        const body = ct.includes('text/event-stream')
            ? (parseSSE(await res.text()).find(m => m.id === id) ?? {})
            : await res.json();
        return { status: res.status, body };
    }
    async call(name: string, args: Record<string, any> = {}) {
        const { body } = await this.rpc('tools/call', { name, arguments: args });
        const text: string = body.result?.content?.[0]?.text ?? JSON.stringify(body.error ?? {});
        let data: any = null;
        try { data = JSON.parse(text); } catch { /* the tool answered in prose */ }
        return { isError: !!body.result?.isError, text, data };
    }
    async init(gaii: string, priv: string) {
        const reg = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'MCP REST parity E2E', redirect_uris: [] }) });
        assert(reg.status === 201, `oauth register ${reg.status}`);
        const ts = new Date().toISOString();
        const pkce = mcpPkce(BASE);
        const params = new URLSearchParams({
            response_type: 'code', client_id: reg.body.client_id, gaii,
            signature: await signMsg(priv, gaii + NODE_ID + ts), timestamp: ts,
            ...authorizeParams(pkce),
        });
        const authz = await json(`/v1/mcp/authorize?${params}`);
        assert(typeof authz.body.code === 'string', `authorize: ${JSON.stringify(authz.body)}`);
        const tok = await json('/v1/mcp/token', {
            method: 'POST',
            body: JSON.stringify({ grant_type: 'authorization_code', code: authz.body.code, client_id: reg.body.client_id, client_secret: reg.body.client_secret, ...tokenParams(pkce) }),
        });
        assert(tok.status === 200, `token ${tok.status}`);
        this.token = tok.body.access_token;
        const init = await this.rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'MCP REST parity E2E', version: '1.0.0' } });
        assert(init.status === 200 && init.body.result !== undefined, `initialize ${init.status}`);
        await fetch(`${BASE}/v1/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
                Authorization: `Bearer ${this.token}`, 'mcp-session-id': this.sessionId, 'mcp-protocol-version': '2025-03-26',
            },
            body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        });
    }
}

const STAMP = Date.now().toString(36);

async function setupOwner(label: string) {
    const name = `par${label}${STAMP}`;
    const reg0 = () => json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Parity', password: 'Parity1234' }) });
    let reg = await reg0();
    for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await reg0(); }
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const tok = await ownerSignIn(BASE, name, 'Parity1234');
    return { name, ghii: `${name}@${NODE_ID}`, token: tok.body.data.token as string };
}

/** An agent of `owner` holding exactly `scopes`: a REST token and an MCP session, both as the agent. */
async function agentOf(owner: { name: string; token: string }, label: string, scopes: string[]) {
    const made = await json('/v1/agents', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ name: `${label}${STAMP}`, owner: owner.name, capabilities: ['memory'], scopes }),
    });
    assert(made.status === 201, `agent ${label} ${made.status}: ${JSON.stringify(made.body?.error)}`);
    const gaii = made.body.data.agent.gaii as string;
    const key = made.body.data.private_key as string;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: await signMsg(key, gaii + ts) }) });
    assert(tok.body.ok === true, `agent token ${label}: ${JSON.stringify(tok.body.error)}`);
    const session = new McpSession();
    await session.init(gaii, key);
    return { gaii, token: tok.body.data.token as string, session };
}

console.log('\n=== AIMEAT MCP / REST PARITY E2E (one capability, one implementation) ===\n');

let A!: Awaited<ReturnType<typeof setupOwner>>;
let B!: Awaited<ReturnType<typeof setupOwner>>;
let C!: Awaited<ReturnType<typeof setupOwner>>;
let agent!: Awaited<ReturnType<typeof agentOf>>;
let attached!: Awaited<ReturnType<typeof agentOf>>;
let stranger!: Awaited<ReturnType<typeof agentOf>>;

const SCOPES = [
    'ext:invoke', 'memory:read', 'memory:write', 'memory:read-as-owner',
    'organism:read', 'organism:write', 'exchange:beneficiary',
    'messages:send', 'outbound:send', 'connections:use',
];

await test('Setup: three owners, the first with two agents, the third with one', async () => {
    A = await setupOwner('a');
    B = await setupOwner('b');
    C = await setupOwner('c');
    agent = await agentOf(A, 'paragent', SCOPES);
    attached = await agentOf(A, 'parattached', SCOPES);
    stranger = await agentOf(C, 'parstranger', SCOPES);
    assert(agent.session.sessionId !== '' && stranger.session.sessionId !== '', 'both MCP sessions opened');
});

// ── Extension invoke ─────────────────────────────────────────────────────────

const EXT = `parext${STAMP}`;
const SECRET = 's3cretValue9988';
const SCRIPTS = {
    leaky: `export default async function(ctx, input){ throw new Error('upstream refused: api_key=${SECRET} was rejected'); }`,
    fine: 'export default async function(ctx, input){ return { ok: true, echo: input.word ?? null }; }',
};
const MANIFEST = JSON.stringify({
    metadata: { name: EXT, version: '1.0.0', description: 'mcp rest parity e2e', author: 'e2e' },
    actions: [
        { id: 'leaky', method: 'POST', path: '/leaky', script: 'leaky' },
        { id: 'fine', method: 'POST', path: '/fine', script: 'fine' },
    ],
    limits: { timeout_ms: 5000, max_api_calls: 1 },
});

await test('Extension: the owner installs and activates a test extension', async () => {
    const inst = await json('/v1/extensions', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ manifest: MANIFEST, scripts: SCRIPTS }) });
    assert(inst.status === 201, `install ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
    const act = await json(`/v1/extensions/${EXT}/activate`, { method: 'POST', headers: auth(A.token) });
    assert(act.status === 200, `activate ${act.status}: ${JSON.stringify(act.body?.error)}`);
});

await test('Extension: a failing action gives the same redacted text over REST and MCP', async () => {
    const rest = await json(`/v1/ext/${EXT}/leaky`, { method: 'POST', headers: auth(agent.token), body: JSON.stringify({}) });
    assert(rest.status === 500, `REST status ${rest.status}: ${JSON.stringify(rest.body)}`);
    assert(rest.body.error?.code === 'EXTENSION_ERROR', `REST code ${rest.body.error?.code}`);
    const restMessage = String(rest.body.error?.message ?? '');
    assert(!restMessage.includes(SECRET), `REST leaked the secret: ${restMessage}`);
    assert(restMessage.includes('[redacted]'), `REST message is not redacted: ${restMessage}`);

    const mcp = await agent.session.call('aimeat_extension_invoke', { extension_name: EXT, action_id: 'leaky', input: {} });
    assert(mcp.isError, `MCP answered success: ${mcp.text}`);
    assert(!mcp.text.includes(SECRET), `MCP leaked the secret: ${mcp.text}`);
    assert(mcp.text.includes('EXTENSION_ERROR'), `MCP carries no EXTENSION_ERROR code: ${mcp.text}`);
    assert(mcp.text.includes(restMessage), `MCP text differs from REST. REST: ${restMessage} MCP: ${mcp.text}`);
});

await test('Extension: a version pin resolves on both surfaces', async () => {
    const rest = await json(`/v1/ext/${EXT}@1.0.0/fine`, { method: 'POST', headers: auth(agent.token), body: JSON.stringify({ word: 'x' }) });
    assert(rest.status === 200 && rest.body.data?.ok === true, `REST pin ${rest.status}: ${JSON.stringify(rest.body)}`);
    const mcp = await agent.session.call('aimeat_extension_invoke', { extension_name: `${EXT}@1.0.0`, action_id: 'fine', input: { word: 'x' } });
    assert(!mcp.isError && mcp.data?.ok === true, `MCP pin: ${mcp.text}`);
});

await test('Extension: an unknown version is NOT_FOUND on both surfaces', async () => {
    const rest = await json(`/v1/ext/${EXT}@9.9.9/fine`, { method: 'POST', headers: auth(agent.token), body: JSON.stringify({}) });
    assert(rest.status === 404 && rest.body.error?.code === 'NOT_FOUND', `REST ${rest.status}: ${JSON.stringify(rest.body)}`);
    const mcp = await agent.session.call('aimeat_extension_invoke', { extension_name: `${EXT}@9.9.9`, action_id: 'fine', input: {} });
    assert(mcp.isError && mcp.text.includes('NOT_FOUND') && mcp.text.includes('9.9.9'), `MCP: ${mcp.text}`);
});

// ── Memory search and the owner-scope listing ────────────────────────────────

const MEM = `par${STAMP}`;

await test('Memory: a multi-word search returns the same keys on both surfaces', async () => {
    for (const [k, v] of [[`${MEM}.one`, 'alpha beta'], [`${MEM}.two`, 'beta gamma'], [`${MEM}.three`, 'delta epsilon']]) {
        const w = await json('/v1/memory', { method: 'POST', headers: auth(agent.token), body: JSON.stringify({ key: k, value: v, visibility: 'private' }) });
        assert(w.status === 201, `write ${k} ${w.status}: ${JSON.stringify(w.body?.error)}`);
    }
    const rest = await json(`/v1/memory/search?q=${encodeURIComponent('alpha gamma')}&include=meta`, { headers: auth(agent.token) });
    assert(rest.status === 200, `REST search ${rest.status}: ${JSON.stringify(rest.body?.error)}`);
    const restKeys = (rest.body.data.results as any[]).map(r => r.key).filter((k: string) => k.startsWith(MEM)).sort();
    const mcp = await agent.session.call('aimeat_memory_search', { query: 'alpha gamma' });
    assert(!mcp.isError, `MCP search: ${mcp.text}`);
    const mcpKeys = (mcp.data.hits as any[]).map(h => h.key).filter((k: string) => k.startsWith(MEM)).sort();
    assert(JSON.stringify(restKeys) === JSON.stringify(mcpKeys), `REST ${JSON.stringify(restKeys)} vs MCP ${JSON.stringify(mcpKeys)}`);
    assert(restKeys.includes(`${MEM}.one`) && restKeys.includes(`${MEM}.two`) && !restKeys.includes(`${MEM}.three`),
        `either word finds its record and neither finds the third: ${JSON.stringify(restKeys)}`);
});

await test('Memory: the owner-scope listing lists a key held by the owner and the agent once, on both surfaces', async () => {
    const shared = `${MEM}.shared`;
    const o = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: shared, value: 'owner copy', visibility: 'private' }) });
    assert(o.status === 201, `owner write ${o.status}: ${JSON.stringify(o.body?.error)}`);
    const a = await json('/v1/memory', { method: 'POST', headers: auth(agent.token), body: JSON.stringify({ key: shared, value: 'agent copy', visibility: 'private' }) });
    assert(a.status === 201, `agent write ${a.status}: ${JSON.stringify(a.body?.error)}`);

    const rest = await json(`/v1/memory?owner_scope=true&include=meta&prefix=${encodeURIComponent(MEM + '.')}`, { headers: auth(agent.token) });
    assert(rest.status === 200, `REST list ${rest.status}: ${JSON.stringify(rest.body?.error)}`);
    const restKeys = (rest.body.data.items as any[]).map(i => i.key).sort();
    const mcp = await agent.session.call('aimeat_memory_list', { prefix: `${MEM}.`, owner_scope: true, limit: 500 });
    assert(!mcp.isError, `MCP list: ${mcp.text}`);
    const items = Array.isArray(mcp.data) ? mcp.data : mcp.data.items;
    const mcpKeys = (items as any[]).map(i => i.key).sort();
    assert(restKeys.filter(k => k === shared).length === 1, `REST lists ${shared} ${restKeys.filter(k => k === shared).length} times`);
    assert(JSON.stringify(restKeys) === JSON.stringify(mcpKeys), `REST ${JSON.stringify(restKeys)} vs MCP ${JSON.stringify(mcpKeys)}`);
});

// ── Organism archive ─────────────────────────────────────────────────────────

let orgId = '';
const WS = 'wsparity';

await test('Organism: the creator makes an organism with one workspace and attaches one agent', async () => {
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: 'Parity Org', description: 'parity', type: 'project', join_policy: 'open', visibility: 'public' }) });
    assert(o.status === 201, `org ${o.status}: ${JSON.stringify(o.body?.error)}`);
    orgId = o.body.data.organism.id;
    const root = `organism.${orgId}.w.${WS}`;
    await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Parity', createdAt: new Date().toISOString(), createdBy: A.name }] }, visibility: 'private' }) });
    const manifest = {
        manifestVersion: '1.0', id: orgId, name: 'Parity', kind: 'project', status: 'active',
        objectTypes: [{ name: 'note', schemaRef: 'schema:note@1', namespace: 'shared.notes', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records' }],
    };
    await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `${root}.meta.manifest`, value: manifest, visibility: 'private' }) });
    await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `${root}.shared.notes.n1`, value: { id: 'n1', title: 'First note' }, visibility: 'private' }) });
    const at = await json(`/v1/organisms/${orgId}/agents`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ agent_gaii: attached.gaii }) });
    assert(at.status === 201, `attach ${at.status}: ${JSON.stringify(at.body?.error)}`);
    // The timeline's first snapshot, so the archive below is a change against it.
    const h = await json(`/v1/organisms/${orgId}/structure/history`, { headers: auth(A.token) });
    assert(h.status === 200, `history ${h.status}`);
});

await test('Organism: an attached agent of the creator is refused the archive on REST and on MCP', async () => {
    const body = { level: 'record', ws: WS, key: `organism.${orgId}.w.${WS}.shared.notes.n1` };
    const rest = await json(`/v1/organisms/${orgId}/archive`, { method: 'POST', headers: auth(attached.token), body: JSON.stringify(body) });
    assert(rest.status === 403 && rest.body.error?.code === 'ACCESS_DENIED', `REST ${rest.status}: ${JSON.stringify(rest.body)}`);
    const mcp = await attached.session.call('aimeat_organism_archive', { organism_id: orgId, action: 'archive', ...body });
    assert(mcp.isError && mcp.text.includes('ACCESS_DENIED'), `MCP: ${mcp.text}`);
});

await test('Organism: an archive over MCP writes the timeline entry the route writes', async () => {
    const mcp = await agent.session.call('aimeat_organism_archive', { organism_id: orgId, action: 'archive', level: 'workspace', ws: WS });
    assert(!mcp.isError, `MCP archive: ${mcp.text}`);
    const h = await json(`/v1/organisms/${orgId}/structure/history`, { headers: auth(A.token) });
    assert(h.status === 200, `history ${h.status}`);
    const event = String(h.body.data.current?.value?._event ?? '');
    assert(event.startsWith('workspace archived'), `the newest timeline entry is "${event}", expected "workspace archived: …"`);
    assert(h.body.data.current?.value?._actor === agent.gaii, `actor ${h.body.data.current?.value?._actor}`);
});

// ── Beneficiary split ────────────────────────────────────────────────────────

const SPLIT_EXT = `parsplit${STAMP}`;

await test('Split: the author is the calling agent on REST and on MCP', async () => {
    const rest = await json('/v1/commerce/beneficiary-splits', {
        method: 'POST', headers: auth(agent.token),
        body: JSON.stringify({ ext: SPLIT_EXT, action: 'rest', pool_percent: 10, dynamic: true }),
    });
    assert(rest.status === 200, `REST split ${rest.status}: ${JSON.stringify(rest.body?.error)}`);
    const mcp = await agent.session.call('aimeat_commerce_beneficiary_split_set', { ext: SPLIT_EXT, action: 'mcp', pool_percent: 10, dynamic: true });
    assert(!mcp.isError, `MCP split: ${mcp.text}`);
    const list = await json('/v1/commerce/beneficiary-splits', { headers: auth(agent.token) });
    assert(list.status === 200, `list ${list.status}`);
    const mine = (list.body.data.splits as any[]).filter(s => s.ext === SPLIT_EXT);
    assert(mine.length === 2, `two splits, got ${mine.length}`);
    for (const s of mine) assert(s.created_by === agent.gaii, `split ${s.action} created_by ${s.created_by}, expected ${agent.gaii}`);
    assert(mcp.data?.split?.createdBy === agent.gaii, `MCP answer createdBy ${mcp.data?.split?.createdBy}`);
});

await test('Split: one invalid declaration is INVALID_INPUT on REST and on MCP', async () => {
    const rest = await json('/v1/commerce/beneficiary-splits', {
        method: 'POST', headers: auth(agent.token),
        body: JSON.stringify({ ext: SPLIT_EXT, action: 'empty', pool_percent: 10 }),
    });
    assert(rest.status === 400 && rest.body.error?.code === 'INVALID_INPUT', `REST ${rest.status}: ${JSON.stringify(rest.body)}`);
    const mcp = await agent.session.call('aimeat_commerce_beneficiary_split_set', { ext: SPLIT_EXT, action: 'empty', pool_percent: 10 });
    assert(mcp.isError && mcp.text.startsWith('INVALID_INPUT'), `MCP: ${mcp.text}`);
    const bad = await agent.session.call('aimeat_commerce_beneficiary_split_set', { ext: SPLIT_EXT, action: 'bad', pool_percent: 10, beneficiaries: [{ ghii: 'not-a-ghii' }] });
    assert(bad.isError && bad.text.startsWith('INVALID_INPUT'), `MCP bad GHII: ${bad.text}`);
});

// ── Mail send to a saved contact ─────────────────────────────────────────────

let plainContactId = '';
const PLAIN_EMAIL = `plain${STAMP}@example.test`;
const B_EMAIL = `${STAMP}b@example.test`;

await test('Mail: aimeat_mail_send takes the mail: id aimeat_contact_add returned', async () => {
    const added = await agent.session.call('aimeat_contact_add', { name: 'Plain Person', email: PLAIN_EMAIL });
    assert(!added.isError, `contact_add: ${added.text}`);
    plainContactId = added.data.contact_id;
    assert(plainContactId.startsWith('mail:'), `a plain address is saved as mail:<id>, got ${plainContactId}`);
    // No SMTP on the runner's node: a send that found the contact ends in SEND_FAILED with its logged
    // row. NOT_FOUND would mean the id was never resolved.
    const sent = await agent.session.call('aimeat_mail_send', { contact_id: plainContactId, subject: 'Hello', body: 'A message.' });
    assert(sent.isError, `no transport, so the send cannot succeed: ${sent.text}`);
    assert(sent.data?.code === 'SEND_FAILED' && typeof sent.data?.message_id === 'string', `MCP: ${sent.text}`);
});

await test('Mail: POST /v1/outbound/send takes the same mail: id', async () => {
    const r = await json('/v1/outbound/send', {
        method: 'POST', headers: auth(agent.token),
        body: JSON.stringify({ contact_id: plainContactId, kind: 'transactional', subject: 'Hello', body: 'A message.' }),
    });
    assert(r.status === 503 && r.body.error?.code === 'SEND_FAILED', `REST ${r.status}: ${JSON.stringify(r.body)}`);
});

await test('Mail: a person who proved the address here is sent to by the identity contact_add returned', async () => {
    await markEmailVerified(B.name, B_EMAIL);
    const added = await agent.session.call('aimeat_contact_add', { name: 'Proven Person', email: B_EMAIL });
    assert(!added.isError, `contact_add: ${added.text}`);
    assert(added.data.contact_id === B.ghii, `the contact id is the person's identity, got ${added.data.contact_id}`);
    const sent = await agent.session.call('aimeat_mail_send', { contact_id: B.ghii, subject: 'Hello', body: 'A message.' });
    assert(!sent.isError && sent.data?.status === 'sent', `MCP send to an identity: ${sent.text}`);
});

await test('Mail: another owner\'s agent is refused the same contact id (NOT_FOUND)', async () => {
    const sent = await stranger.session.call('aimeat_mail_send', { contact_id: plainContactId, subject: 'Hello', body: 'A message.' });
    assert(sent.isError && sent.text.includes('NOT_FOUND'), `MCP cross-owner: ${sent.text}`);
    const r = await json('/v1/outbound/send', {
        method: 'POST', headers: auth(stranger.token),
        body: JSON.stringify({ contact_id: plainContactId, kind: 'transactional', subject: 'Hello', body: 'A message.' }),
    });
    assert(r.status === 404 && r.body.error?.code === 'NOT_FOUND', `REST cross-owner ${r.status}: ${JSON.stringify(r.body)}`);
});

console.log(`\n=== MCP / REST PARITY E2E: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
