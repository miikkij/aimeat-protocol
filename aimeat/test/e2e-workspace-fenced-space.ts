/**
 * @file e2e-workspace-fenced-space.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A memory-backed record space of a workspace whose manifest object type names
 *   extensions (`objectTypes[].extensions`, as installer/name) takes the write of a caller that is
 *   not a person only through one of those extensions (services/fenced-space.ts). Ruled by the
 *   developer on 2026-10-13: "sovelluksen tietuetila ottaa agentin kirjoituksen vain sovelluksen
 *   oman laajennuksen kautta".
 *
 *   WHAT WAS MEASURED. On aimeat.io on 2026-10-13 an agent made from the home page for the app
 *   MUISTIO wrote decision and action records directly into the app's spaces with the plain
 *   workspace-write tool, past the app's own tool: a quote with spelling slips the tool would have
 *   refused, a decision the note said was not decided, and an author field the model typed wrongly.
 *
 *   ONE ORGANISM, ONE WORKSPACE, THREE SPACES: `decision` names the test extension (fenced), `note`
 *   names none (the regression guard: it takes the agent's direct write as before) and `broken`
 *   names one entry that is not installer/name (fenced, and no extension opens it). The caller is an
 *   agent of the workspace's creator holding every scope the calls need, so each refusal below is
 *   the rule's and never a missing scope, membership or grant.
 *
 *   FIRST FAIL. On the tree before the rule every "Refused:" test fails: the agent's call is
 *   answered 200 or 201 and the record is written, published, reopened, deleted or archived. The
 *   tests named "Guard:" passed before the rule and must still pass: the owner in person, the
 *   named extension, the unfenced space and the owner's public form.
 *
 *   THE SECOND PART (v1.1.0), ruled by the developer on 2026-10-13 after his objection "miksi se
 *   hylättäisiin jos agentille on annettu lupa tehdä niin?": the permission `organism:direct`, the
 *   route that names an extension on a space, and the protection of a fenced space's list.
 *     - "Direct:" an agent whose SESSION holds `organism:direct` (the word, or `*`) writes a fenced
 *       space directly; a session minted before the grant held the word is still refused.
 *     - "Refused:" an agent without the word changes the list of a fenced space, removes the object
 *       type, or moves its namespace or backing: through PUT /v1/organisms/:id/workspace, through
 *       the MCP tool aimeat_workspace_update, and by writing or deleting the manifest record as a
 *       memory key. The account holder in person and an agent holding the word make the change.
 *     - "Named:" POST /v1/organisms/:id/workspace/spaces/:space/extensions adds an installed
 *       extension of the caller's own account to a memory space (which fences it) or a row space
 *       (which opens it to the extension); it adds and never removes.
 *   A second workspace (`fenced2`) holds these cases, so the 25 cases above run on a manifest
 *   nothing else changes.
 *
 *   FIRST FAIL of the second part. On the tree before it 15 of its 18 cases fail (measured on
 *   SQLite, 2026-10-13): every "Direct:" case is refused by the rule (no permission lets an agent
 *   through), every "Refused:" case of the list is answered 200 or 201 and the manifest changes, and
 *   every case of the route is answered 404 (no such route). Two of its three "Guard:" cases fail
 *   there as well, for a reason of their own: they follow a change the old tree accepted, so the
 *   manifest they start from had already lost its list. The set-up, the owner's "Guard:" and the
 *   clean-up pass.
 * @version-history
 *   v1.1.0 — 2026-10-13 — The permission organism:direct, the route that names an extension on a
 *     space, and the protected list of a fenced space. The suite's agent is given its scope words
 *     by name (AGENT_SCOPES): the test node approves a new agent with `*`, which covers the new
 *     word, so an agent on the node's default would write the fenced space directly and the 25
 *     cases of v1.0.0 would test nothing. Their assertions are unchanged.
 *   v1.0.0 — 2026-10-13 — Initial.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=workspace-fenced-space

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

import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import { authorizeParams, mcpPkce, tokenParams } from './helpers/mcp-oauth-pkce.js';
import { ownerSignIn } from './helpers/owner-login.js';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}
function parseSSE(text: string): any[] {
    const out: any[] = [];
    for (const evt of text.split('\n\n')) {
        let data = '';
        for (const line of evt.trim().split('\n')) if (line.startsWith('data: ')) data += line.slice(6);
        if (data) { try { out.push(JSON.parse(data)); } catch { /* skip */ } }
    }
    return out;
}

/** An MCP JSON-RPC caller bound to one agent's token and session. */
function mcpClient() {
    let token = '', session = '';
    const rpc = async (method: string, params: Record<string, any> = {}, id = 1) => {
        const res = await fetch(`${BASE}/v1/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(session ? { 'mcp-session-id': session, 'mcp-protocol-version': '2025-03-26' } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        });
        const sid = res.headers.get('mcp-session-id'); if (sid) session = sid;
        const ct = res.headers.get('content-type') ?? '';
        const body = ct.includes('text/event-stream')
            ? (parseSSE(await res.text()).find(m => m.id === id) ?? {})
            : await res.json() as any;
        return { status: res.status, body };
    };
    return {
        setToken: (t: string) => { token = t; },
        rpc,
        call: async (name: string, args: Record<string, any>, id = 1) => (await rpc('tools/call', { name, arguments: args }, id)).body,
    };
}

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/**
 * What the suite's agent holds: every word its calls need, written out, and NOT the word
 * `organism:direct`. The test node approves a new agent with `*` (run-e2e-server.ts sets
 * AIMEAT_DEFAULT_AGENT_SCOPES), and `*` covers `organism:direct`, the permission that lets an agent
 * write a fenced space directly (ruled 2026-10-13). An agent left on the node's default would
 * therefore hold the permission and prove nothing about the rule. A node as shipped approves an
 * agent with six words and no wildcard (SHIPPED_DEFAULT_AGENT_SCOPES in src/config.ts).
 */
const AGENT_SCOPES = ['memory:read', 'memory:write', 'memory:delete', 'memory:purge', 'storage:read', 'storage:write',
    'organism:read', 'organism:write', 'ext:invoke', 'catalogue:read', 'agent:read'];
/** The permission that lets an agent write a fenced space directly (services/fenced-space.ts). */
const DIRECT = 'organism:direct';

/** An owner account on the test node, signed in. */
async function registerOwnerAccount(label: string) {
    const ownerName = `fsp${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: ownerName, display_name: 'Fenced Space', password: 'FencedSp1234' }) });
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const tok = await ownerSignIn(BASE, ownerName, 'FencedSp1234');
    assert(tok.body?.ok === true, `owner token: ${JSON.stringify(tok.body?.error)}`);
    return { ownerName, ownerGhii: `${ownerName}@${NODE_ID}`, ownerToken: tok.body.data.token as string };
}

/**
 * An agent of `owner` whose grant is exactly `scopes`. `session()` mints a pair at that moment: an
 * MCP session and the agent's own REST token, both carrying the grant as it stands then.
 * `setScopes` changes the grant; a session minted before keeps the words it was minted with.
 */
async function connectAgent(owner: { ownerName: string; ownerToken: string }, name: string, scopes: string[]) {
    const ag = await json('/v1/agents', { method: 'POST', headers: auth(owner.ownerToken), body: JSON.stringify({ name, owner: owner.ownerName, capabilities: ['social'], model: 'gpt-4o' }) });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body?.error)}`);
    const agentGaii = ag.body.data.agent.gaii as string, agentPriv = ag.body.data.private_key as string;
    const setScopes = async (next: string[]) => {
        const r = await json(`/v1/agents/${name}/scopes`, { method: 'PATCH', headers: auth(owner.ownerToken), body: JSON.stringify({ scopes: next }) });
        assert(r.status === 200, `scopes of ${name} ${r.status}: ${JSON.stringify(r.body?.error)}`);
    };
    await setScopes(scopes);
    const session = async () => {
        const cl = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'Fenced Space', redirect_uris: [] }) });
        const ts = new Date().toISOString();
        const pkce = mcpPkce(BASE);
        const params = new URLSearchParams({ response_type: 'code', client_id: cl.body.client_id, gaii: agentGaii, signature: await signMsg(agentPriv, agentGaii + NODE_ID + ts), timestamp: ts, ...authorizeParams(pkce) });
        const authz = await json(`/v1/mcp/authorize?${params}`);
        const tk = await json('/v1/mcp/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code: authz.body.code, client_id: cl.body.client_id, client_secret: cl.body.client_secret, ...tokenParams(pkce) }) });
        const client = mcpClient(); client.setToken(tk.body.access_token);
        await client.rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'Fenced Space', version: '1.0.0' } });
        const ts2 = new Date().toISOString();
        const rest = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii: agentGaii, timestamp: ts2, signature: await signMsg(agentPriv, agentGaii + ts2) }) });
        assert(rest.status === 200 && typeof rest.body.data?.token === 'string', `agent token ${rest.status}: ${JSON.stringify(rest.body?.error)}`);
        return { client, token: rest.body.data.token as string };
    };
    return { name, agentGaii, setScopes, session };
}

/** An owner, an agent of theirs holding AGENT_SCOPES, the agent's MCP session and its own REST token. */
async function setupOwnerWithAgent(label: string) {
    const owner = await registerOwnerAccount(label);
    const agent = await connectAgent(owner, `fspagent${label}`, AGENT_SCOPES);
    const s = await agent.session();
    return { ...owner, client: s.client, agentToken: s.token, agentGaii: agent.agentGaii };
}

console.log('\n=== Workspace fenced space E2E ===\n');

const STAMP = Date.now();
const EXT = `fsn${STAMP}`;        // the extension the fenced space names
const EXT_OTHER = `fso${STAMP}`;  // installed by the same owner, named by no space
const WS = 'fenced';
const NS = 'app.decisions';       // fenced: names EXT
const NS_OPEN = 'shared.notes';   // names no extension
const NS_BROKEN = 'app.broken';   // fenced: its one entry is not installer/name
/** The sentence every refusal of the rule carries (services/fenced-space.ts). */
const RULE = "only through the app's own tool";

const SCRIPTS = {
    // Write a record and publish it, the two calls an app tool makes.
    put: `export default async function(ctx, input){
        var w = await ctx.workspace.write(input.org, input.ws, input.space, input.id, { id: input.id, title: input.title || 'through the tool' });
        var p = await ctx.workspace.publish(input.org, input.ws, input.ns, input.id);
        return { written: w, pub: p, caller: ctx.caller.gaii };
    }`,
    batch: `export default async function(ctx, input){
        return ctx.workspace.publishRecords(input.org, input.ws, input.ns, input.ids.map(function(id){ return { id: id, value: { id: id, title: 'batch' } }; }));
    }`,
    del: `export default async function(ctx, input){ return ctx.workspace.deleteRecords(input.org, input.ws, input.ns, input.ids); }`,
    arch: `export default async function(ctx, input){ return ctx.workspace.archiveRecords(input.org, input.ws, input.ns, input.ids); }`,
};
const extManifest = (name: string) => JSON.stringify({
    metadata: { name, version: '1.0.0', description: 'fenced space e2e', author: 'e2e' },
    actions: Object.keys(SCRIPTS).map(id => ({ id, method: 'POST', path: `/${id}`, script: id })),
    config: { public_access: { default: true } },
    limits: { timeout_ms: 8000, max_api_calls: 50 },
    workspace: { read: true, write: true },
});

let O!: Awaited<ReturnType<typeof setupOwnerWithAgent>>;
let orgId = '';
const root = () => `organism.${orgId}.w.${WS}`;
const base = (ns: string, id: string) => `${root()}.${ns}.${id}`;
let rpcId = 100;

const asOwner = () => auth(O.ownerToken);
const asAgent = () => auth(O.agentToken);
const post = (path: string, headers: Record<string, string>, body: unknown) => json(path, { method: 'POST', headers, body: JSON.stringify(body) });
const invoke = (ext: string, action: string, input: Record<string, unknown>) =>
    post(`/v1/ext/${ext}/${action}`, asAgent(), { org: orgId, ws: WS, ...input });
const mcp = async (tool: string, args: Record<string, unknown>) => {
    const b = await O.client.call(tool, { organism_id: orgId, ws: WS, ...args }, rpcId++);
    return { isError: b.result?.isError === true, text: String(b.result?.content?.[0]?.text ?? JSON.stringify(b.error ?? b)) };
};

/** The record as the owner's workspace read opens it, or null. Archived records are left out. */
async function ownerOpens(space: string, id: string): Promise<any | null> {
    const r = await json(`/v1/organisms/${orgId}/workspace/index?ws=${WS}&ids=${id}&space=${space}`, { headers: asOwner() });
    assert(r.status === 200, `owner read ${r.status}: ${JSON.stringify(r.body?.error)}`);
    return (r.body.data.items as any[]).find(i => i.id === id) ?? null;
}
/** The keys under one record that are stored under the AGENT's own identity. */
async function agentKeys(ns: string, id: string): Promise<string[]> {
    const r = await json(`/v1/memory?prefix=${encodeURIComponent(`${base(ns, id)}.`)}`, { headers: asAgent() });
    assert(r.status === 200, `agent list ${r.status}: ${JSON.stringify(r.body?.error)}`);
    return (r.body.data.items as any[]).map(i => i.key as string);
}
/** A REST answer that is the rule's refusal: 403 ACCESS_DENIED with the rule's sentence. */
function assertRefused(r: { status: number; body: any }, what: string) {
    assert(r.status === 403 && r.body?.error?.code === 'ACCESS_DENIED' && String(r.body.error.message).includes(RULE),
        `${what}: expected 403 ACCESS_DENIED naming the app's own tool, got ${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data)}`);
}
/** An MCP tool result that is the rule's refusal. */
function assertToolRefused(r: { isError: boolean; text: string }, what: string) {
    assert(r.isError && r.text.includes('ACCESS_DENIED') && r.text.includes(RULE),
        `${what}: expected an ACCESS_DENIED tool error naming the app's own tool, got ${r.text.slice(0, 300)}`);
}

await test('Setup: an owner, their agent (MCP session and REST token), an organism', async () => {
    O = await setupOwnerWithAgent('o');
    const o = await post('/v1/organisms', asOwner(), { name: 'Fenced Org', description: 'x', type: 'project', join_policy: 'open', visibility: 'public' });
    assert(o.status === 201, `org ${o.status}: ${JSON.stringify(o.body?.error)}`); orgId = o.body.data.organism.id;
});

await test('Setup: two extensions with workspace write, and a workspace whose decision space names one of them', async () => {
    for (const name of [EXT, EXT_OTHER]) {
        const inst = await post('/v1/extensions', asOwner(), { manifest: extManifest(name), scripts: SCRIPTS });
        assert(inst.status === 201, `install ${name} ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
        const act = await json(`/v1/extensions/${name}/activate`, { method: 'POST', headers: asOwner() });
        assert(act.status === 200, `activate ${name} ${act.status}`);
    }
    const reg = await post('/v1/memory', asOwner(), { key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Fenced', createdAt: new Date().toISOString(), createdBy: O.ownerName }] }, visibility: 'private' });
    assert(reg.status === 201, `registry ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const space = (name: string, namespace: string, extra: Record<string, unknown> = {}) =>
        ({ name, schemaRef: `schema:${name}@1`, namespace, backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records', versioned: true, ...extra });
    const manifest = {
        manifestVersion: '1.0', id: orgId, name: 'Fenced', kind: 'project', status: 'active',
        objectTypes: [
            // Written with capitals on purpose: the comparison is lower-cased on both sides, as for rows.
            space('decision', NS, { extensions: [`${O.ownerName}/${EXT}`] }),
            space('note', NS_OPEN),
            // The manifest schema lets this entry through and it is not installer/name: a space in
            // the installer part. The space is fenced and nothing opens it.
            space('broken', NS_BROKEN, { extensions: [`${O.ownerName} x/${EXT}`] }),
        ],
    };
    const mr = await post('/v1/memory', asOwner(), { key: `${root()}.meta.manifest`, value: manifest, visibility: 'private' });
    assert(mr.status === 201, `manifest ${mr.status}: ${JSON.stringify(mr.body?.error)}`);
});

// ── What still works: the owner in person, and the named extension. ──

await test('Guard: the owner in person writes a draft directly and publishes a record directly', async () => {
    const d = await post(`/v1/organisms/${orgId}/workspace/drafts`, asOwner(), { ws: WS, space: 'decision', id: 'ownerdraft', value: { title: 'the owner wrote this' } });
    assert(d.status === 200, `owner draft ${d.status}: ${JSON.stringify(d.body?.error)}`);
    for (const id of ['ownerpub', 'ownerarch']) {
        const w = await post(`/v1/organisms/${orgId}/workspace/drafts`, asOwner(), { ws: WS, space: 'decision', id, value: { title: 'published by the owner' } });
        assert(w.status === 200, `owner draft ${id} ${w.status}: ${JSON.stringify(w.body?.error)}`);
        const p = await post(`/v1/organisms/${orgId}/publish`, asOwner(), { ws: WS, namespace: NS, id });
        assert(p.status === 200, `owner publish ${id} ${p.status}: ${JSON.stringify(p.body?.error)}`);
    }
    const direct = await post('/v1/memory', asOwner(), { key: `${base(NS, 'ownerdirect')}.latest`, value: { id: 'ownerdirect', title: 'a direct value' }, visibility: 'public' });
    assert(direct.status === 201, `owner direct write ${direct.status}: ${JSON.stringify(direct.body?.error)}`);
    assert((await ownerOpens('decision', 'ownerpub'))?.published === true, 'the owner\'s record is published');
    assert((await ownerOpens('decision', 'ownerdraft'))?.published === false, 'the owner\'s draft is a draft');
});

await test('Guard: the same agent writes and publishes through the named extension, under the identities it always had', async () => {
    for (const id of ['viatool', 'fordelete', 'forbatchdel', 'fortooldel', 'forbulk', 'forput']) {
        const r = await invoke(EXT, 'put', { space: 'decision', ns: NS, id });
        assert(r.status === 200, `named extension put ${id} ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.caller === O.agentGaii, `the action ran as the agent: ${r.body.data.caller}`);
    }
    const opened = await ownerOpens('decision', 'viatool');
    assert(opened?.published === true && opened.value.title === 'through the tool', `record present: ${JSON.stringify(opened)}`);
    // The published copy is the owner's, the version row is the publisher's: as before the rule.
    const agentHolds = await agentKeys(NS, 'viatool');
    assert(agentHolds.includes(`${base(NS, 'viatool')}.version.1`), `the version row is the agent's: ${JSON.stringify(agentHolds)}`);
    assert(!agentHolds.includes(`${base(NS, 'viatool')}.latest`), `the live copy is not the agent's: ${JSON.stringify(agentHolds)}`);
    const ownerHolds = await json(`/v1/memory/${encodeURIComponent(`${base(NS, 'viatool')}.latest`)}`, { headers: asOwner() });
    assert(ownerHolds.status === 200 && ownerHolds.body.data.value?.title === 'through the tool', `the live copy is the owner's: ${ownerHolds.status}`);
});

await test('Guard: the named extension also publishes a batch, removes records and archives records', async () => {
    const b = await invoke(EXT, 'batch', { ns: NS, ids: ['tb1', 'tb2', 'tb3'] });
    assert(b.status === 200 && b.body.data.published === 3, `batch ${b.status}: ${JSON.stringify(b.body?.error ?? b.body?.data)}`);
    const d = await invoke(EXT, 'del', { ns: NS, ids: ['tb1'] });
    assert(d.status === 200 && d.body.data.deleted?.[0]?.id === 'tb1', `delete ${d.status}: ${JSON.stringify(d.body?.error ?? d.body?.data)}`);
    const a = await invoke(EXT, 'arch', { ns: NS, ids: ['tb2'] });
    assert(a.status === 200 && a.body.data.archived?.[0] === 'tb2', `archive ${a.status}: ${JSON.stringify(a.body?.error ?? a.body?.data)}`);
    assert((await ownerOpens('decision', 'tb1')) === null && (await ownerOpens('decision', 'tb2')) === null, 'tb1 is removed and tb2 is archived');
    assert((await ownerOpens('decision', 'tb3'))?.published === true, 'tb3 is published');
});

// ── The agent's direct calls. Each one was answered 200 or 201 before the rule. ──

await test('Refused: REST draft write (POST /v1/organisms/:id/workspace/drafts)', async () => {
    const r = await post(`/v1/organisms/${orgId}/workspace/drafts`, asAgent(), { ws: WS, space: 'decision', id: 'a-rest', value: { title: 'typed by the model' } });
    assertRefused(r, 'draft write');
    assert(Array.isArray(r.body.error.details?.extensions) && r.body.error.details.extensions[0] === `${O.ownerName}/${EXT}`.toLowerCase(), `details name the extension: ${JSON.stringify(r.body.error.details)}`);
    assert((await ownerOpens('decision', 'a-rest')) === null, 'no record was written');
    // A batch that holds one item for the fenced space is refused whole.
    const batch = await post(`/v1/organisms/${orgId}/workspace/drafts`, asAgent(), { ws: WS, items: [{ space: 'note', id: 'a-mixed', value: { title: 'open' } }, { space: 'decision', id: 'a-mixed', value: { title: 'fenced' } }] });
    assertRefused(batch, 'mixed draft batch');
    assert((await ownerOpens('note', 'a-mixed')) === null && (await ownerOpens('decision', 'a-mixed')) === null, 'no item of the batch was written');
});

await test('Refused: MCP aimeat_workspace_write', async () => {
    assertToolRefused(await mcp('aimeat_workspace_write', { space: 'decision', id: 'a-mcp', value: { title: 'typed by the model' } }), 'aimeat_workspace_write');
    assert((await ownerOpens('decision', 'a-mcp')) === null, 'no record was written');
});

await test('Refused: POST /v1/memory with the record key in its .draft, .latest and bare forms, and MCP aimeat_memory_write', async () => {
    for (const [form, key] of [['draft', `${base(NS, 'a-key')}.draft`], ['latest', `${base(NS, 'a-key')}.latest`], ['bare', base(NS, 'a-key')]]) {
        assertRefused(await post('/v1/memory', asAgent(), { key, value: { id: 'a-key', title: 'typed by the model' }, visibility: 'private' }), `POST /v1/memory (${form})`);
    }
    const b = await O.client.call('aimeat_memory_write', { key: `${base(NS, 'a-key')}.latest`, value: { id: 'a-key', title: 'typed by the model' } }, rpcId++);
    assertToolRefused({ isError: b.result?.isError === true, text: String(b.result?.content?.[0]?.text) }, 'aimeat_memory_write');
    assert((await agentKeys(NS, 'a-key')).length === 0 && (await ownerOpens('decision', 'a-key')) === null, 'no key was written');
});

await test('Refused: PUT and PATCH of an existing record', async () => {
    const key = `${base(NS, 'forput')}.version.1`;
    const put = await json(`/v1/memory/${encodeURIComponent(key)}`, { method: 'PUT', headers: asAgent(), body: JSON.stringify({ value: { id: 'forput', title: 'rewritten' }, version: 1 }) });
    assertRefused(put, 'PUT /v1/memory/:key');
    const patch = await json(`/v1/memory/${encodeURIComponent(key)}`, { method: 'PATCH', headers: asAgent(), body: JSON.stringify({ patch: { title: 'patched' } }) });
    assertRefused(patch, 'PATCH /v1/memory/:key');
    const still = await json(`/v1/memory/${encodeURIComponent(key)}`, { headers: asAgent() });
    assert(still.status === 200 && still.body.data.value?.title === 'through the tool', `the record is unchanged: ${still.status} ${JSON.stringify(still.body?.data?.value)}`);
});

await test('Refused: publish of a draft the owner wrote, REST and MCP', async () => {
    assertRefused(await post(`/v1/organisms/${orgId}/publish`, asAgent(), { ws: WS, namespace: NS, id: 'ownerdraft' }), 'POST /publish');
    assertToolRefused(await mcp('aimeat_workspace_publish', { namespace: NS, id: 'ownerdraft' }), 'aimeat_workspace_publish');
    assert((await ownerOpens('decision', 'ownerdraft'))?.published === false, 'the draft is still a draft');
});

await test('Refused: batch publish with records and with instances', async () => {
    const url = `/v1/organisms/${orgId}/workspace/records/publish`;
    assertRefused(await post(url, asAgent(), { ws: WS, namespace: NS, records: [{ id: 'a-batch', value: { id: 'a-batch', title: 'typed by the model' } }] }), 'batch publish (records)');
    assertRefused(await post(url, asAgent(), { ws: WS, namespace: NS, instances: ['ownerdraft'] }), 'batch publish (instances)');
    // A dry run decides the same refusal: it is the caller that is refused, not the write.
    assertRefused(await post(url, asAgent(), { ws: WS, namespace: NS, dry_run: true, records: [{ id: 'a-batch', value: { id: 'a-batch', title: 'x' } }] }), 'batch publish (dry run)');
    assert((await ownerOpens('decision', 'a-batch')) === null, 'no record was published');
    assert((await ownerOpens('decision', 'ownerdraft'))?.published === false, 'the owner\'s draft is still a draft');
});

await test('Refused: revert to draft, REST and MCP', async () => {
    assertRefused(await post(`/v1/organisms/${orgId}/revert`, asAgent(), { ws: WS, namespace: NS, id: 'ownerpub' }), 'POST /revert');
    assertToolRefused(await mcp('aimeat_workspace_revert_to_draft', { namespace: NS, id: 'ownerpub' }), 'aimeat_workspace_revert_to_draft');
    const opened = await ownerOpens('decision', 'ownerpub');
    assert(opened?.published === true && opened.draft === undefined, `no draft was opened: ${JSON.stringify(opened)}`);
});

await test('Refused: DELETE /v1/memory/:key, and putting a key back from the bin', async () => {
    const key = `${base(NS, 'fordelete')}.version.1`;
    assertRefused(await json(`/v1/memory/${encodeURIComponent(key)}`, { method: 'DELETE', headers: asAgent() }), 'DELETE /v1/memory/:key');
    assert((await agentKeys(NS, 'fordelete')).includes(key), 'the record is still there');
    assertRefused(await json(`/v1/memory/${encodeURIComponent(key)}/restore`, { method: 'POST', headers: asAgent() }), 'POST /v1/memory/:key/restore');
});

await test('Refused: POST /v1/organisms/:id/workspace/records/delete', async () => {
    assertRefused(await post(`/v1/organisms/${orgId}/workspace/records/delete`, asAgent(), { ws: WS, namespace: NS, ids: ['forbatchdel'] }), 'records/delete');
    assert((await ownerOpens('decision', 'forbatchdel'))?.published === true, 'the record is still there');
});

await test('Refused: MCP aimeat_workspace_object_delete', async () => {
    assertToolRefused(await mcp('aimeat_workspace_object_delete', { namespace: NS, id: 'fortooldel' }), 'aimeat_workspace_object_delete');
    assert((await ownerOpens('decision', 'fortooldel'))?.published === true, 'the record is still there');
});

await test('Refused: POST /v1/memory/bulk-delete, by key and by prefix', async () => {
    const key = `${base(NS, 'forbulk')}.version.1`;
    assertRefused(await post('/v1/memory/bulk-delete', asAgent(), { keys: [key] }), 'bulk-delete (keys)');
    assertRefused(await post('/v1/memory/bulk-delete', asAgent(), { prefix: `${root()}.${NS}.` }), 'bulk-delete (prefix)');
    assert((await agentKeys(NS, 'forbulk')).includes(key), 'the record is still there');
});

await test('Refused: POST /v1/memory/copy into the space, and POST /v1/memory/import', async () => {
    const key = `${base(NS, 'ownerdirect')}.latest`;
    assertRefused(await post('/v1/memory/copy', asAgent(), { source_gaii: O.ownerGhii, key }), 'copy');
    assert(!(await agentKeys(NS, 'ownerdirect')).includes(key), 'no copy landed under the agent');
    const imp = await post('/v1/memory/import', asAgent(), { entries: [{ key: `${base(NS, 'a-import')}.draft`, value: { id: 'a-import', title: 'imported' } }] });
    assert(imp.status === 200 && imp.body.data.created === 0 && String(imp.body.data.failed?.[0]?.reason).startsWith('ACCESS_DENIED') && String(imp.body.data.failed[0].reason).includes(RULE),
        `import names the refusal per entry: ${imp.status} ${JSON.stringify(imp.body?.data ?? imp.body?.error)}`);
    assert((await agentKeys(NS, 'a-import')).length === 0, 'nothing was imported');
});

await test('Refused: archive of a record and of the space, unarchive of a record, REST and MCP', async () => {
    const key = base(NS, 'ownerarch');
    assertRefused(await post(`/v1/organisms/${orgId}/archive`, asAgent(), { level: 'record', ws: WS, key }), 'archive (record)');
    assertRefused(await post(`/v1/organisms/${orgId}/archive`, asAgent(), { level: 'space', ws: WS, namespace: NS }), 'archive (space)');
    assertToolRefused(await mcp('aimeat_organism_archive', { action: 'archive', level: 'record', key }), 'aimeat_organism_archive');
    assert((await ownerOpens('decision', 'ownerarch'))?.published === true, 'the record is not archived');
    // The owner archives it; the agent may not bring it back either.
    const arch = await post(`/v1/organisms/${orgId}/archive`, asOwner(), { level: 'record', ws: WS, key });
    assert(arch.status === 200 && arch.body.data.archived > 0, `owner archive ${arch.status}: ${JSON.stringify(arch.body?.error)}`);
    assertRefused(await post(`/v1/organisms/${orgId}/unarchive`, asAgent(), { level: 'record', ws: WS, key }), 'unarchive (record)');
    assert((await ownerOpens('decision', 'ownerarch')) === null, 'the record is still archived');
});

// ── Extensions the space does not open to. ──

await test('Refused: an installed extension the space does not name, through its own action', async () => {
    const r = await invoke(EXT_OTHER, 'put', { space: 'decision', ns: NS, id: 'a-other' });
    assertRefused(r, 'unnamed extension put');
    assert((await ownerOpens('decision', 'a-other')) === null, 'no record was written');
    assertRefused(await invoke(EXT_OTHER, 'batch', { ns: NS, ids: ['a-other'] }), 'unnamed extension publishRecords');
    assertRefused(await invoke(EXT_OTHER, 'del', { ns: NS, ids: ['viatool'] }), 'unnamed extension deleteRecords');
    assertRefused(await invoke(EXT_OTHER, 'arch', { ns: NS, ids: ['viatool'] }), 'unnamed extension archiveRecords');
    assert((await ownerOpens('decision', 'viatool'))?.published === true, 'the record it aimed at is untouched');
});

await test('Refused: a space whose list holds only an entry that is not installer/name opens to nobody (fail closed)', async () => {
    const viaExt = await invoke(EXT, 'put', { space: 'broken', ns: NS_BROKEN, id: 'b-ext' });
    assertRefused(viaExt, 'extension put into the broken space');
    const direct = await post(`/v1/organisms/${orgId}/workspace/drafts`, asAgent(), { ws: WS, space: 'broken', id: 'b-agent', value: { title: 'x' } });
    assertRefused(direct, 'agent draft into the broken space');
    assert(JSON.stringify(direct.body.error.details?.extensions) === '[]', `the refusal names no extension: ${JSON.stringify(direct.body.error.details)}`);
    assert((await ownerOpens('broken', 'b-ext')) === null && (await ownerOpens('broken', 'b-agent')) === null, 'nothing was written');
    // The owner in person still writes it.
    const owner = await post(`/v1/organisms/${orgId}/workspace/drafts`, asOwner(), { ws: WS, space: 'broken', id: 'b-owner', value: { title: 'owner' } });
    assert(owner.status === 200, `owner draft into the broken space ${owner.status}: ${JSON.stringify(owner.body?.error)}`);
});

// ── The space that names no extension behaves exactly as before. ──

await test('Guard: the space that names no extension takes the agent\'s direct write, publish, reopen and delete', async () => {
    const w = await post(`/v1/organisms/${orgId}/workspace/drafts`, asAgent(), { ws: WS, space: 'note', id: 'n-rest', value: { title: 'direct' } });
    assert(w.status === 200, `agent draft ${w.status}: ${JSON.stringify(w.body?.error)}`);
    const p = await post(`/v1/organisms/${orgId}/publish`, asAgent(), { ws: WS, namespace: NS_OPEN, id: 'n-rest' });
    assert(p.status === 200, `agent publish ${p.status}: ${JSON.stringify(p.body?.error)}`);
    const m = await mcp('aimeat_workspace_write', { space: 'note', id: 'n-mcp', value: { title: 'direct over MCP' } });
    assert(!m.isError, `aimeat_workspace_write: ${m.text.slice(0, 200)}`);
    const mp = await mcp('aimeat_workspace_publish', { namespace: NS_OPEN, id: 'n-mcp' });
    assert(!mp.isError, `aimeat_workspace_publish: ${mp.text.slice(0, 200)}`);
    const key = await post('/v1/memory', asAgent(), { key: `${base(NS_OPEN, 'n-key')}.draft`, value: { id: 'n-key', title: 'by key' }, visibility: 'private' });
    assert(key.status === 201, `POST /v1/memory ${key.status}: ${JSON.stringify(key.body?.error)}`);
    const rv = await post(`/v1/organisms/${orgId}/revert`, asAgent(), { ws: WS, namespace: NS_OPEN, id: 'n-rest' });
    assert(rv.status === 200, `agent revert ${rv.status}: ${JSON.stringify(rv.body?.error)}`);
    const batch = await post(`/v1/organisms/${orgId}/workspace/records/publish`, asAgent(), { ws: WS, namespace: NS_OPEN, records: [{ id: 'n-batch', value: { id: 'n-batch', title: 'batch' } }] });
    assert(batch.status === 200 && batch.body.data.published === 1, `agent batch ${batch.status}: ${JSON.stringify(batch.body?.error ?? batch.body?.data)}`);
    const arch = await post(`/v1/organisms/${orgId}/archive`, asAgent(), { level: 'record', ws: WS, key: base(NS_OPEN, 'n-batch') });
    assert(arch.status === 200, `agent archive ${arch.status}: ${JSON.stringify(arch.body?.error)}`);
    const del = await post(`/v1/organisms/${orgId}/workspace/records/delete`, asAgent(), { ws: WS, namespace: NS_OPEN, ids: ['n-mcp'] });
    assert(del.status === 200 && del.body.data.deleted?.[0]?.id === 'n-mcp', `agent delete ${del.status}: ${JSON.stringify(del.body?.error ?? del.body?.data)}`);
    assert((await ownerOpens('note', 'n-rest'))?.published === true, 'the note is published');
    // The unnamed extension writes there too: the rule is per space.
    const ext = await invoke(EXT_OTHER, 'put', { space: 'note', ns: NS_OPEN, id: 'n-ext' });
    assert(ext.status === 200, `unnamed extension into the open space ${ext.status}: ${JSON.stringify(ext.body?.error)}`);
});

// ── Public intake: the form's records are written as whoever defined the form. ──

await test('Guard: a public form the owner defined onto the fenced space still takes a submission', async () => {
    const def = await post('/v1/intake/forms', asOwner(), { organism_id: orgId, ws: WS, namespace: NS, form_id: 'owner-form', allowed_fields: ['title'], required_fields: ['title'] });
    assert(def.status === 200, `owner defines the form ${def.status}: ${JSON.stringify(def.body?.error)}`);
    const sub = await post(`/v1/intake/${orgId}/${WS}/owner-form`, {}, { title: 'from a visitor' });
    assert(sub.status === 200 && typeof sub.body.data.id === 'string', `submit ${sub.status}: ${JSON.stringify(sub.body?.error)}`);
    assert((await ownerOpens('decision', sub.body.data.id))?.value?.title === 'from a visitor', 'the submission is a record of the space');
});

await test('Refused: an agent defining a public form onto the fenced space', async () => {
    const def = await post('/v1/intake/forms', asAgent(), { organism_id: orgId, ws: WS, namespace: NS, form_id: 'agent-form', allowed_fields: ['title'] });
    assertRefused(def, 'agent defines a form');
    const sub = await post(`/v1/intake/${orgId}/${WS}/agent-form`, {}, { title: 'x' });
    assert(sub.status === 404, `no form was stored: ${sub.status}`);
    // The space that names no extension takes the agent's form as before.
    const open = await post('/v1/intake/forms', asAgent(), { organism_id: orgId, ws: WS, namespace: NS_OPEN, form_id: 'agent-open-form', allowed_fields: ['title'] });
    assert(open.status === 200, `agent defines a form onto the open space ${open.status}: ${JSON.stringify(open.body?.error)}`);
});

await test('Refused: a submission to a stored form whose owner identity is an agent', async () => {
    // A form stored before the rule, or written by hand: its config names the agent as the identity
    // every submission is written under. The owner writes the config record here to stand for it.
    const now = new Date().toISOString();
    const cfg = {
        formId: 'legacy-form', orgId, ws: WS, namespace: NS, ownerGhii: O.agentGaii, allowedFields: ['title'], requiredFields: [], defaults: {},
        mode: 'publish', honeypotField: null, enabled: true, discoverable: true, maxPerDay: null, title: 'Legacy', fields: [{ key: 'title' }],
        successMessage: '', redirectUrl: null, createdAt: now, updatedAt: now,
    };
    const seeded = await post('/v1/memory', asOwner(), { key: `${root()}.meta.intake.legacy-form`, value: cfg, visibility: 'owner' });
    assert(seeded.status === 201, `seed the form config ${seeded.status}: ${JSON.stringify(seeded.body?.error)}`);
    const before = await json(`/v1/organisms/${orgId}/workspace/index?ws=${WS}`, { headers: asOwner() });
    const sub = await post(`/v1/intake/${orgId}/${WS}/legacy-form`, {}, { title: 'through an agent\'s form' });
    // The visitor is not signed in, and an extension's name holds the account name of whoever
    // installed it: the public refusal says that the form takes nothing and names neither.
    assert(sub.status === 403 && sub.body?.error?.code === 'ACCESS_DENIED',
        `submit to an agent-owned form: expected 403 ACCESS_DENIED, got ${sub.status} ${JSON.stringify(sub.body?.error ?? sub.body?.data)}`);
    const said = String(sub.body.error.message ?? '');
    assert(/form cannot take a message/i.test(said), `the public refusal says the form takes nothing: ${said}`);
    assert(!said.includes(EXT) && !said.includes(EXT_OTHER) && !said.includes(O.ownerName), `the public refusal names no extension and no account: ${said}`);
    assert(sub.body.error.details == null, `the public refusal carries no details: ${JSON.stringify(sub.body.error.details)}`);
    const after = await json(`/v1/organisms/${orgId}/workspace/index?ws=${WS}`, { headers: asOwner() });
    assert(after.body.data.counts.decision === before.body.data.counts.decision, `no record was written: ${before.body.data.counts.decision} → ${after.body.data.counts.decision}`);
});

// ══ The second part: the permission organism:direct, the route that names an extension on a
//    space, and the protected list of a fenced space (ruled 2026-10-13). ══

const WS2 = 'fenced2';
const NS2 = 'app.minutes';       // fenced: names EXT
const NS2_GONE = 'app.gone';     // fenced: the cases that remove a fence aim here
const NS2_OPEN = 'shared.open';  // names no extension, until the route names one
const NS2_LOG = 'app.log';       // a row space, which the route opens to EXT_ROWS
const EXT_ROWS = `fsr${STAMP}`;  // declares workspace.rows; no space names it at first
const EXT_B = `fsb${STAMP}`;     // installed by another account
const APP_FILE = `fsapp${STAMP}.html`;
const REDIRECT = 'http://localhost:9922/callback';
const ROW_SCRIPTS = {
    rows: `export default async function(ctx, input){
        return ctx.workspace.appendRows(input.org, input.ws, input.space, [{ body: { kind: 'note', detail: input.detail || 'from the extension' } }]);
    }`,
};

type Session = { client: ReturnType<typeof mcpClient>; token: string };
let direct!: Session;      // an agent of the creator whose session holds organism:direct
let star!: Session;        // an agent of the creator holding `*`
let lateOld!: Session;     // minted BEFORE its agent's grant held the word
let late!: Awaited<ReturnType<typeof connectAgent>>;
let B!: Awaited<ReturnType<typeof registerOwnerAccount>>;  // another account: not a member
let M!: Awaited<ReturnType<typeof registerOwnerAccount>>;  // a plain member of the organism
let appToken = '';         // a hosted app's grant, approved by the creator with organism:write
let appNarrow = '';        // the same app without organism:write

const root2 = () => `organism.${orgId}.w.${WS2}`;
const space2 = (name: string, namespace: string, extra: Record<string, unknown> = {}) =>
    ({ name, schemaRef: `schema:${name}@1`, namespace, backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records', versioned: true, ...extra });
const entry = (owner: string, ext: string) => `${owner}/${ext}`.toLowerCase();
/** The manifest that counts for the second workspace, as the creator's workspace read returns it. */
async function counted(): Promise<{ objectTypes: Array<Record<string, any>> } & Record<string, any>> {
    const r = await json(`/v1/organisms/${orgId}/workspace?ws=${WS2}`, { headers: asOwner() });
    assert(r.status === 200 && Array.isArray(r.body.data?.manifest?.objectTypes), `workspace read ${r.status}: ${JSON.stringify(r.body?.error)}`);
    return r.body.data.manifest;
}
const typeOf = async (name: string) => (await counted()).objectTypes.find(o => o.name === name);
const fencesOfManifest = (m: { objectTypes: Array<Record<string, any>> }) =>
    JSON.stringify(m.objectTypes.map(o => [o.name, o.namespace, o.backing, o.extensions ?? null]));
const putManifest = (headers: Record<string, string>, manifest: unknown) =>
    json(`/v1/organisms/${orgId}/workspace?ws=${WS2}`, { method: 'PUT', headers, body: JSON.stringify({ manifest }) });
const nameExtensions = (headers: Record<string, string>, space: string, add: unknown, ws: string | null = WS2) =>
    post(`/v1/organisms/${orgId}/workspace/spaces/${encodeURIComponent(space)}/extensions${ws ? `?ws=${ws}` : ''}`, headers, { add });
const draft = (headers: Record<string, string>, ws: string, space: string, id: string) =>
    post(`/v1/organisms/${orgId}/workspace/drafts`, headers, { ws, space, id, value: { title: `written as ${id}` } });
const toolResult = (b: any) => ({ isError: b.result?.isError === true, text: String(b.result?.content?.[0]?.text ?? JSON.stringify(b.error ?? b)) });
/** The manifest with one object type changed (`null` removes it). */
const withType = (m: { objectTypes: Array<Record<string, any>> }, name: string, change: (o: Record<string, any>) => Record<string, any> | null) =>
    ({ ...m, objectTypes: m.objectTypes.map(o => (o.name === name ? change(o) : o)).filter((o): o is Record<string, any> => o !== null) });
const withoutList = (o: Record<string, any>) => { const rest = { ...o }; delete rest.extensions; return rest; };
/** A REST answer that refuses a change to a fenced space's list: 403 ACCESS_DENIED naming the permission. */
function assertChangeRefused(r: { status: number; body: any }, what: string) {
    assert(r.status === 403 && r.body?.error?.code === 'ACCESS_DENIED' && String(r.body.error.message).includes(DIRECT),
        `${what}: expected 403 ACCESS_DENIED naming ${DIRECT}, got ${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data)}`);
}
function assertToolChangeRefused(r: { isError: boolean; text: string }, what: string) {
    assert(r.isError && r.text.includes('ACCESS_DENIED') && r.text.includes(DIRECT),
        `${what}: expected an ACCESS_DENIED tool error naming ${DIRECT}, got ${r.text.slice(0, 300)}`);
}
/** The full app-grant flow: the creator approves `scopes` for their own published app. */
async function grantApp(scopes: string[]): Promise<string> {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const q = new URLSearchParams({
        app: `${O.ownerName}/${APP_FILE}`, response_type: 'code', scope: scopes.join(' '),
        redirect_uri: REDIRECT, state: 'x', code_challenge: challenge, code_challenge_method: 'S256',
    });
    const authz = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    assert(authz.status === 302, `app authorize ${authz.status}`);
    const rid = decodeURIComponent(/req=([^&]+)/.exec(authz.headers.get('location') ?? '')![1]);
    const con = await post('/v1/app-grants/authorize-consent', asOwner(), { request_id: rid });
    assert(con.status === 200 && con.body.ok, `app consent ${con.status}: ${JSON.stringify(con.body?.error)}`);
    const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
    const tok = await post('/v1/app-grants/token', {}, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT });
    assert(tok.status === 200 && tok.body.ok, `app token ${tok.status}: ${JSON.stringify(tok.body?.error)}`);
    return tok.body.data.access_token as string;
}

await test('Setup: agents with and without organism:direct, another account, a plain member, a hosted app, a second workspace', async () => {
    direct = await (await connectAgent(O, 'fspdirect', [...AGENT_SCOPES, DIRECT])).session();
    star = await (await connectAgent(O, 'fspstar', ['*'])).session();
    late = await connectAgent(O, 'fsplate', AGENT_SCOPES);
    lateOld = await late.session();
    B = await registerOwnerAccount('b');
    M = await registerOwnerAccount('m');
    const add = await post(`/v1/organisms/${orgId}/members`, asOwner(), { ghii: M.ownerName });
    assert(add.status === 201 && add.body.data.member?.role === 'member', `add the member ${add.status}: ${JSON.stringify(add.body?.error)}`);

    const rowsManifest = JSON.stringify({
        metadata: { name: EXT_ROWS, version: '1.0.0', description: 'fenced space e2e, rows', author: 'e2e' },
        actions: [{ id: 'rows', method: 'POST', path: '/rows', script: 'rows' }],
        config: { public_access: { default: true } }, limits: { timeout_ms: 8000, max_api_calls: 50 },
        workspace: { rows: true },
    });
    for (const [name, manifest, scripts, token] of [
        [EXT_ROWS, rowsManifest, ROW_SCRIPTS, O.ownerToken], [EXT_B, extManifest(EXT_B), SCRIPTS, B.ownerToken],
    ] as Array<[string, string, Record<string, string>, string]>) {
        const inst = await post('/v1/extensions', auth(token), { manifest, scripts });
        assert(inst.status === 201, `install ${name} ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
        const act = await json(`/v1/extensions/${name}/activate`, { method: 'POST', headers: auth(token) });
        assert(act.status === 200, `activate ${name} ${act.status}`);
    }

    const pub = await post('/v1/apps', asOwner(), { filename: APP_FILE, content: Buffer.from('<!DOCTYPE html><html><body>fenced</body></html>', 'utf8').toString('base64'), name: 'Fenced Demo', description: 'fenced space e2e', category: 'utility' });
    assert(pub.status === 201, `publish the app ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
    appToken = await grantApp(['memory:read', 'organism:read', 'organism:write']);
    appNarrow = await grantApp(['memory:read', 'organism:read']);

    const now = new Date().toISOString();
    const reg = await post('/v1/memory', asOwner(), { key: `organism.${orgId}.meta.workspaces`, visibility: 'private', value: { workspaces: [
        { id: WS, name: 'Fenced', createdAt: now, createdBy: O.ownerName }, { id: WS2, name: 'Fenced Two', createdAt: now, createdBy: O.ownerName },
    ] } });
    // 200: the owner's registry record exists since the first setup, and this write replaces it.
    assert(reg.status === 200, `registry ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const manifest = {
        manifestVersion: '1.0', id: orgId, name: 'Fenced Two', kind: 'project', status: 'active',
        objectTypes: [
            space2('minutes', NS2, { extensions: [entry(O.ownerName, EXT)] }),
            space2('gone', NS2_GONE, { extensions: [entry(O.ownerName, EXT)] }),
            space2('open', NS2_OPEN),
            { name: 'log', schemaRef: 'schema:log@1', namespace: NS2_LOG, backing: 'rows', writeRole: 'member' },
            { name: 'todo', schemaRef: 'schema:todo@1', namespace: 'app.todo', backing: 'tasks', writeRole: 'member' },
        ],
    };
    const mr = await post('/v1/memory', asOwner(), { key: `${root2()}.meta.manifest`, value: manifest, visibility: 'private' });
    assert(mr.status === 201, `second manifest ${mr.status}: ${JSON.stringify(mr.body?.error)}`);
    assert((await counted()).objectTypes.length === 5, 'the second workspace reads back with its five spaces');
});

// ── The permission: a session that holds organism:direct writes a fenced space directly. ──

await test('Direct: an agent whose session holds organism:direct writes a draft, publishes and deletes in the fenced space', async () => {
    const h = auth(direct.token);
    const d = await draft(h, WS, 'decision', 'd-direct');
    assert(d.status === 200, `draft with the permission ${d.status}: ${JSON.stringify(d.body?.error)}`);
    const p = await post(`/v1/organisms/${orgId}/publish`, h, { ws: WS, namespace: NS, id: 'd-direct' });
    assert(p.status === 200, `publish with the permission ${p.status}: ${JSON.stringify(p.body?.error)}`);
    assert((await ownerOpens('decision', 'd-direct'))?.published === true, 'the record is published');
    const m = toolResult(await direct.client.call('aimeat_workspace_write', { organism_id: orgId, ws: WS, space: 'decision', id: 'd-direct-mcp', value: { title: 'over MCP, with the permission' } }, rpcId++));
    assert(!m.isError, `aimeat_workspace_write with the permission: ${m.text.slice(0, 300)}`);
    const k = await post('/v1/memory', h, { key: `${base(NS, 'd-direct-key')}.draft`, value: { id: 'd-direct-key', title: 'by key' }, visibility: 'private' });
    assert(k.status === 201, `POST /v1/memory with the permission ${k.status}: ${JSON.stringify(k.body?.error)}`);
    // Through an extension the space does not name: the permission is the session's, whichever code path the write takes.
    const viaOther = await post(`/v1/ext/${EXT_OTHER}/put`, h, { org: orgId, ws: WS, space: 'decision', ns: NS, id: 'd-direct-ext' });
    assert(viaOther.status === 200, `an unnamed extension, session with the permission ${viaOther.status}: ${JSON.stringify(viaOther.body?.error)}`);
    const del = await post(`/v1/organisms/${orgId}/workspace/records/delete`, h, { ws: WS, namespace: NS, ids: ['d-direct'] });
    assert(del.status === 200 && del.body.data.deleted?.[0]?.id === 'd-direct', `delete with the permission ${del.status}: ${JSON.stringify(del.body?.error ?? del.body?.data)}`);
    assert((await ownerOpens('decision', 'd-direct')) === null, 'the record is removed');
});

await test('Refused: the same agent on a session minted before its grant held the word; a session minted after writes', async () => {
    assertRefused(await draft(auth(lateOld.token), WS, 'decision', 'd-late'), 'no word on the grant or the session');
    await late.setScopes([...AGENT_SCOPES, DIRECT]);
    // The grant holds the word now and the session does not: the rule reads the session.
    assertRefused(await draft(auth(lateOld.token), WS, 'decision', 'd-late'), 'a session narrower than the grant (REST)');
    assertToolRefused(toolResult(await lateOld.client.call('aimeat_workspace_write', { organism_id: orgId, ws: WS, space: 'decision', id: 'd-late', value: { title: 'x' } }, rpcId++)), 'a session narrower than the grant (MCP)');
    assert((await ownerOpens('decision', 'd-late')) === null, 'nothing was written');
    const fresh = await late.session();
    const w = await draft(auth(fresh.token), WS, 'decision', 'd-late');
    assert(w.status === 200, `a session minted after the grant ${w.status}: ${JSON.stringify(w.body?.error)}`);
});

await test('Direct: an agent holding * writes the fenced space directly', async () => {
    const w = await draft(auth(star.token), WS, 'decision', 'd-star');
    assert(w.status === 200, `draft with * ${w.status}: ${JSON.stringify(w.body?.error)}`);
    const m = toolResult(await star.client.call('aimeat_workspace_write', { organism_id: orgId, ws: WS, space: 'decision', id: 'd-star-mcp', value: { title: 'over MCP, with *' } }, rpcId++));
    assert(!m.isError, `aimeat_workspace_write with *: ${m.text.slice(0, 300)}`);
});

// ── The list of a fenced space is changed by the person, or by an agent holding the word. ──

await test('Refused: an agent without the word PUTs the manifest with the fenced space\'s list removed, emptied or widened', async () => {
    const before = await counted();
    const removed = await putManifest(asAgent(), withType(before, 'minutes', withoutList));
    assertChangeRefused(removed, 'list removed');
    assert(removed.body.error.details?.reason === 'FENCE_CHANGE' && JSON.stringify(removed.body.error.details.spaces) === JSON.stringify([{ space: 'minutes', change: 'extensions' }]),
        `the refusal names the space and the kind of change: ${JSON.stringify(removed.body.error.details)}`);
    assertChangeRefused(await putManifest(asAgent(), withType(before, 'minutes', o => ({ ...o, extensions: [] }))), 'list emptied');
    assertChangeRefused(await putManifest(asAgent(), withType(before, 'minutes', o => ({ ...o, extensions: [...o.extensions, entry(O.ownerName, EXT_OTHER)] }))), 'list widened');
    // A schema sent with the refused change is not locked either: the refusal comes before any write.
    const withSchema = await json(`/v1/organisms/${orgId}/workspace?ws=${WS2}`, { method: 'PUT', headers: asAgent(), body: JSON.stringify({ manifest: withType(before, 'minutes', withoutList), schemas: { [NS2_OPEN]: { type: 'object', required: ['never'] } } }) });
    assertChangeRefused(withSchema, 'list removed, with a schema');
    const stillOpen = await draft(asOwner(), WS2, 'open', 'o-schema');
    assert(stillOpen.status === 200, `no schema was locked by the refused change ${stillOpen.status}: ${JSON.stringify(stillOpen.body?.error)}`);
    assert(fencesOfManifest(await counted()) === fencesOfManifest(before), 'the manifest is unchanged');
    assertRefused(await draft(asAgent(), WS2, 'minutes', 'm-agent'), 'the fence still holds');
});

await test('Refused: the same change through the MCP tool aimeat_workspace_update', async () => {
    const before = await counted();
    assertToolChangeRefused(await mcp('aimeat_workspace_update', { ws: WS2, manifest: withType(before, 'minutes', withoutList) }), 'aimeat_workspace_update');
    assert(fencesOfManifest(await counted()) === fencesOfManifest(before), 'the manifest is unchanged');
});

await test('Refused: removing the fenced object type, moving its namespace, changing its backing', async () => {
    const before = await counted();
    assertChangeRefused(await putManifest(asAgent(), withType(before, 'gone', () => null)), 'object type removed');
    assertChangeRefused(await putManifest(asAgent(), withType(before, 'minutes', o => ({ ...o, namespace: 'app.elsewhere' }))), 'namespace moved');
    assertChangeRefused(await putManifest(asAgent(), withType(before, 'gone', o => ({ ...o, backing: 'tasks' }))), 'backing changed');
    assert(fencesOfManifest(await counted()) === fencesOfManifest(before), 'the manifest is unchanged');
});

await test('Refused: the manifest record written, replaced, patched or deleted as a memory key', async () => {
    const before = await counted();
    const key = `${root2()}.meta.manifest`;
    const next = withType(before, 'minutes', withoutList);
    assertChangeRefused(await post('/v1/memory', asAgent(), { key, value: next, visibility: 'private' }), 'POST /v1/memory');
    assertToolChangeRefused(toolResult(await O.client.call('aimeat_memory_write', { key, value: next }, rpcId++)), 'aimeat_memory_write');
    assertChangeRefused(await json(`/v1/memory/${encodeURIComponent(key)}`, { method: 'PUT', headers: asAgent(), body: JSON.stringify({ value: next, version: 1 }) }), 'PUT /v1/memory/:key');
    assertChangeRefused(await json(`/v1/memory/${encodeURIComponent(key)}`, { method: 'PATCH', headers: asAgent(), body: JSON.stringify({ patch: { objectTypes: [] } }) }), 'PATCH /v1/memory/:key');
    assertChangeRefused(await json(`/v1/memory/${encodeURIComponent(key)}`, { method: 'DELETE', headers: asAgent() }), 'DELETE /v1/memory/:key');
    assertChangeRefused(await post(`/v1/organisms/${orgId}/workspace/records/delete`, asAgent(), { ws: WS2, namespace: 'meta', ids: ['manifest'] }), 'records/delete of meta.manifest');
    assertToolChangeRefused(await mcp('aimeat_workspace_object_delete', { ws: WS2, namespace: 'meta', id: 'manifest' }), 'aimeat_workspace_object_delete of meta.manifest');
    assertToolChangeRefused(toolResult(await O.client.call('aimeat_memory_delete', { key }, rpcId++)), 'aimeat_memory_delete');
    assert(fencesOfManifest(await counted()) === fencesOfManifest(before), 'the manifest that counts is unchanged');
    assertRefused(await draft(asAgent(), WS2, 'minutes', 'm-agent'), 'the fence still holds');
});

await test('Guard: an agent without the word still adds a space, adds a new space that names an extension, and changes a space with no fence', async () => {
    const before = await counted();
    const next = { ...withType(before, 'open', o => ({ ...o, writeRole: 'admin' })), objectTypes: [...withType(before, 'open', o => ({ ...o, writeRole: 'admin' })).objectTypes, space2('fresh', 'app.fresh', { extensions: [entry(O.ownerName, EXT)] })] };
    const full = await putManifest(asAgent(), next);
    assert(full.status === 200, `a full replace that changes no fence ${full.status}: ${JSON.stringify(full.body?.error)}`);
    const added = await json(`/v1/organisms/${orgId}/workspace?ws=${WS2}`, { method: 'PUT', headers: asAgent(), body: JSON.stringify({ add_spaces: [{ name: 'extra', namespace: 'shared.extra', mode: 'records' }] }) });
    assert(added.status === 200 && added.body.data.added?.includes('extra'), `add_spaces ${added.status}: ${JSON.stringify(added.body?.error ?? added.body?.data)}`);
    const renamed = await json(`/v1/organisms/${orgId}/workspace?ws=${WS2}`, { method: 'PUT', headers: asAgent(), body: JSON.stringify({ name: 'Fenced Two' }) });
    assert(renamed.status === 200, `a new name ${renamed.status}: ${JSON.stringify(renamed.body?.error)}`);
    const viaTool = await mcp('aimeat_workspace_space_add', { ws: WS2, spaces: [{ name: 'extra2', namespace: 'shared.extra2', mode: 'records' }] });
    assert(!viaTool.isError, `aimeat_workspace_space_add: ${viaTool.text.slice(0, 300)}`);
    const now = await counted();
    assert(now.objectTypes.some(o => o.name === 'fresh') && now.objectTypes.some(o => o.name === 'extra') && now.objectTypes.some(o => o.name === 'extra2'), `the spaces are there: ${now.objectTypes.map(o => o.name).join(', ')}`);
    assert((await typeOf('open'))?.writeRole === 'admin', 'the space with no fence changed');
    assert(JSON.stringify((await typeOf('minutes'))?.extensions) === JSON.stringify([entry(O.ownerName, EXT)]), 'the fenced space is as it was');
});

await test('Direct: an agent holding organism:direct removes a fenced space\'s list, REST and MCP', async () => {
    const before = await counted();
    const r = await putManifest(auth(direct.token), withType(before, 'gone', withoutList));
    assert(r.status === 200, `the change with the permission ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert((await typeOf('gone'))?.extensions === undefined, 'the list is gone');
    // The space takes an agent's direct write again, as a space with no fence does.
    const w = await draft(asAgent(), WS2, 'gone', 'g-agent');
    assert(w.status === 200, `the agent without the word writes the space that is no longer fenced ${w.status}: ${JSON.stringify(w.body?.error)}`);
    const viaTool = toolResult(await direct.client.call('aimeat_workspace_update', { organism_id: orgId, ws: WS2, manifest: withType(await counted(), 'fresh', withoutList) }, rpcId++));
    assert(!viaTool.isError, `aimeat_workspace_update with the permission: ${viaTool.text.slice(0, 300)}`);
    assert((await typeOf('fresh'))?.extensions === undefined, 'the second list is gone too');
});

await test('Guard: the owner in person changes a fenced space\'s list and removes a fenced object type', async () => {
    const before = await counted();
    const fenceBack = await putManifest(asOwner(), withType(before, 'gone', o => ({ ...o, extensions: [entry(O.ownerName, EXT)] })));
    assert(fenceBack.status === 200, `the owner names the list again ${fenceBack.status}: ${JSON.stringify(fenceBack.body?.error)}`);
    const changed = await putManifest(asOwner(), withType(await counted(), 'gone', o => ({ ...o, extensions: [entry(O.ownerName, EXT_OTHER)] })));
    assert(changed.status === 200, `the owner changes the list ${changed.status}: ${JSON.stringify(changed.body?.error)}`);
    const removed = await putManifest(asOwner(), withType(await counted(), 'gone', () => null));
    assert(removed.status === 200, `the owner removes the object type ${removed.status}: ${JSON.stringify(removed.body?.error)}`);
    assert((await typeOf('gone')) === undefined, 'the object type is removed');
});

// ── The route that names an extension on a space of an existing workspace. ──

await test('Named: the owner in person names an extension of theirs on a space with no fence, which then takes an agent\'s write only through it', async () => {
    const pre = await draft(asAgent(), WS2, 'open', 'o-before');
    assert(pre.status === 200, `before the naming the agent writes directly ${pre.status}: ${JSON.stringify(pre.body?.error)}`);
    const r = await nameExtensions(asOwner(), 'open', [`${O.ownerName}/${EXT}`]);
    assert(r.status === 200, `name the extension ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(r.body.data.space?.name === 'open' && r.body.data.space.namespace === NS2_OPEN && JSON.stringify(r.body.data.space.extensions) === JSON.stringify([entry(O.ownerName, EXT)])
        && JSON.stringify(r.body.data.added) === JSON.stringify([entry(O.ownerName, EXT)]), `the answer is the space with its list: ${JSON.stringify(r.body.data)}`);
    assert(JSON.stringify((await typeOf('open'))?.extensions) === JSON.stringify([entry(O.ownerName, EXT)]), 'the manifest that counts holds the entry');
    assertRefused(await draft(asAgent(), WS2, 'open', 'o-after'), 'the agent\'s direct write after the naming');
    const viaTool = await invoke(EXT, 'put', { ws: WS2, space: 'open', ns: NS2_OPEN, id: 'o-tool' });
    assert(viaTool.status === 200, `the named extension writes ${viaTool.status}: ${JSON.stringify(viaTool.body?.error)}`);
    // By namespace, with one entry that is already there and one that is new: it adds, and nothing is removed.
    const again = await nameExtensions(asOwner(), NS2_OPEN, [`${O.ownerName}/${EXT}`, `${O.ownerName}/${EXT_OTHER}`]);
    assert(again.status === 200 && JSON.stringify(again.body.data.added) === JSON.stringify([entry(O.ownerName, EXT_OTHER)])
        && JSON.stringify(again.body.data.space.extensions) === JSON.stringify([entry(O.ownerName, EXT), entry(O.ownerName, EXT_OTHER)]), `the second call adds one: ${again.status} ${JSON.stringify(again.body?.data ?? again.body?.error)}`);
    const same = await nameExtensions(asOwner(), 'open', [`${O.ownerName}/${EXT}`]);
    assert(same.status === 200 && same.body.data.added.length === 0 && same.body.data.space.extensions.length === 2, `an entry already there is not an error: ${same.status} ${JSON.stringify(same.body?.data ?? same.body?.error)}`);
});

await test('Named: on a row space, the extension\'s row call is admitted once the space names it', async () => {
    const rowCall = () => post(`/v1/ext/${EXT_ROWS}/rows`, asAgent(), { org: orgId, ws: WS2, space: 'log' });
    const refused = await rowCall();
    assert(refused.status === 403, `before the naming the row call is refused, got ${refused.status} ${JSON.stringify(refused.body?.error ?? refused.body?.data)}`);
    const r = await nameExtensions(asOwner(), 'log', [`${O.ownerName}/${EXT_ROWS}`]);
    assert(r.status === 200 && r.body.data.space?.backing === 'rows' && JSON.stringify(r.body.data.space.extensions) === JSON.stringify([entry(O.ownerName, EXT_ROWS)]), `name the extension on the row space ${r.status}: ${JSON.stringify(r.body?.data ?? r.body?.error)}`);
    const admitted = await rowCall();
    assert(admitted.status === 200, `after the naming the row call is admitted ${admitted.status}: ${JSON.stringify(admitted.body?.error)}`);
    const rows = await json(`/v1/organisms/${orgId}/workspace/rows/log?ws=${WS2}`, { headers: asOwner() });
    assert(rows.status === 200 && rows.body.data.rows?.length === 1, `the row landed: ${rows.status} ${JSON.stringify(rows.body?.data ?? rows.body?.error)}`);
});

await test('Refused: an entry of another account, an extension that is not installed, a list of the wrong size, a space the route does not serve', async () => {
    const before = await counted();
    const invalid = (r: { status: number; body: any }, what: string, names?: string) =>
        assert(r.status === 400 && r.body?.error?.code === 'INVALID_INPUT' && (!names || String(r.body.error.message).includes(names)),
            `${what}: expected 400 INVALID_INPUT${names ? ` naming ${names}` : ''}, got ${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data)}`);
    invalid(await nameExtensions(asOwner(), 'minutes', [`${B.ownerName}/${EXT_B}`]), 'another account\'s extension', entry(B.ownerName, EXT_B));
    invalid(await nameExtensions(asOwner(), 'minutes', [`${O.ownerName}/${EXT_B}`]), 'another account\'s extension under the caller\'s name', entry(O.ownerName, EXT_B));
    invalid(await nameExtensions(asOwner(), 'minutes', [`${O.ownerName}/fsnone${STAMP}`]), 'an extension that is not installed', entry(O.ownerName, `fsnone${STAMP}`));
    // One entry that may not be named refuses the whole call: the valid one beside it is not written.
    invalid(await nameExtensions(asOwner(), 'minutes', [`${O.ownerName}/${EXT_OTHER}`, `${B.ownerName}/${EXT_B}`]), 'a valid entry beside one of another account', entry(B.ownerName, EXT_B));
    invalid(await nameExtensions(asOwner(), 'minutes', []), 'no entry');
    invalid(await nameExtensions(asOwner(), 'minutes', Array.from({ length: 6 }, () => `${O.ownerName}/${EXT_OTHER}`)), 'six entries');
    invalid(await nameExtensions(asOwner(), 'minutes', `${O.ownerName}/${EXT_OTHER}`), 'a string in place of the list');
    invalid(await nameExtensions(asOwner(), 'minutes', ['no-slash']), 'an entry that is not installer/name', 'no-slash');
    invalid(await nameExtensions(asOwner(), 'todo', [`${O.ownerName}/${EXT_OTHER}`]), 'a tasks space');
    const noWs = await nameExtensions(asOwner(), 'minutes', [`${O.ownerName}/${EXT_OTHER}`], null);
    assert(noWs.status === 400, `without ?ws= ${noWs.status}`);
    const unknown = await nameExtensions(asOwner(), 'nosuchspace', [`${O.ownerName}/${EXT_OTHER}`]);
    assert(unknown.status === 404 && unknown.body?.error?.code === 'NOT_FOUND', `an unknown space ${unknown.status}: ${JSON.stringify(unknown.body?.error)}`);
    const noSuchWs = await nameExtensions(asOwner(), 'minutes', [`${O.ownerName}/${EXT_OTHER}`], 'nosuchws');
    assert(noSuchWs.status === 404, `an unknown workspace ${noSuchWs.status}`);
    assert(fencesOfManifest(await counted()) === fencesOfManifest(before), 'nothing was written');
});

await test('Refused: a plain member, another account, an agent without organism:direct, an app without organism:write', async () => {
    const before = await counted();
    const denied = (r: { status: number; body: any }, what: string, code = 'ACCESS_DENIED') =>
        assert(r.status === 403 && r.body?.error?.code === code, `${what}: expected 403 ${code}, got ${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data)}`);
    denied(await nameExtensions(auth(M.ownerToken), 'minutes', [`${O.ownerName}/${EXT_OTHER}`]), 'a plain member in person');
    denied(await nameExtensions(auth(B.ownerToken), 'minutes', [`${B.ownerName}/${EXT_B}`]), 'an account that is not a member');
    const agent = await nameExtensions(asAgent(), 'minutes', [`${O.ownerName}/${EXT_OTHER}`]);
    denied(agent, 'the creator\'s agent without the word');
    assert(String(agent.body.error.message).includes(DIRECT), `the refusal names the permission: ${agent.body.error.message}`);
    denied(await nameExtensions(auth(appNarrow), 'minutes', [`${O.ownerName}/${EXT_OTHER}`]), 'an app without organism:write', 'SCOPE_DENIED');
    assert(fencesOfManifest(await counted()) === fencesOfManifest(before), 'nothing was written');
});

await test('Named: an agent holding organism:direct, and a hosted app\'s grant, name an extension of their account', async () => {
    const byAgent = await nameExtensions(auth(direct.token), 'minutes', [`${O.ownerName}/${EXT_OTHER}`]);
    assert(byAgent.status === 200 && JSON.stringify(byAgent.body.data.space.extensions) === JSON.stringify([entry(O.ownerName, EXT), entry(O.ownerName, EXT_OTHER)]),
        `the agent with the permission ${byAgent.status}: ${JSON.stringify(byAgent.body?.data ?? byAgent.body?.error)}`);
    const byApp = await nameExtensions(auth(appToken), 'minutes', [`${O.ownerName}/${EXT_ROWS}`]);
    assert(byApp.status === 200 && byApp.body.data.space.extensions.length === 3 && JSON.stringify(byApp.body.data.added) === JSON.stringify([entry(O.ownerName, EXT_ROWS)]),
        `the hosted app's grant ${byApp.status}: ${JSON.stringify(byApp.body?.data ?? byApp.body?.error)}`);
    // The app's own way in adds; it does not open the space to an agent's direct write.
    assertRefused(await draft(asAgent(), WS2, 'minutes', 'm-after-app'), 'the fence still holds after the app named its extension');
});

await test('Guard: an agent without the word writes the manifest record as a memory key when no fence changes', async () => {
    const before = await counted();
    const same = await post('/v1/memory', asAgent(), { key: `${root2()}.meta.manifest`, value: { ...before, name: 'Fenced Two, renamed by key' }, visibility: 'private' });
    // 201: a memory key is unique per owner, so this is the agent's first copy of the record. As
    // the newest copy of the creator's it is the one that counts from here on, which is why the
    // rule compares its value.
    assert(same.status === 201, `a manifest write that keeps every fence ${same.status}: ${JSON.stringify(same.body?.error)}`);
    assert(fencesOfManifest(await counted()) === fencesOfManifest(before), 'the fences are as they were');
    assertRefused(await draft(asAgent(), WS2, 'minutes', 'm-after-key'), 'the fence still holds');
});

await test('Cleanup: what the second part installed is removed', async () => {
    for (const [name, token] of [[EXT_ROWS, O.ownerToken], [EXT_B, B.ownerToken]]) {
        const del = await json(`/v1/extensions/${name}`, { method: 'DELETE', headers: auth(token) });
        assert(del.status === 200, `delete ${name} ${del.status}`);
    }
    const app = await json(`/v1/apps/${APP_FILE}`, { method: 'DELETE', headers: asOwner() });
    assert(app.status === 200, `delete the app ${app.status}`);
});

await test('Cleanup: the two extensions are removed', async () => {
    for (const name of [EXT, EXT_OTHER]) {
        const del = await json(`/v1/extensions/${name}`, { method: 'DELETE', headers: asOwner() });
        assert(del.status === 200, `delete ${name} ${del.status}`);
    }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
