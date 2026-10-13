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
 * @version-history
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
import { createHash } from 'node:crypto';
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

/** An owner, an agent of theirs, the agent's MCP session and the agent's own REST token. */
async function setupOwnerWithAgent(label: string) {
    const ownerName = `fsp${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: ownerName, display_name: 'Fenced Space', password: 'FencedSp1234' }) });
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const tok = await ownerSignIn(BASE, ownerName, 'FencedSp1234');
    assert(tok.body?.ok === true, `owner token: ${JSON.stringify(tok.body?.error)}`);
    const ownerToken = tok.body.data.token as string;
    const ag = await json('/v1/agents', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ name: `fspagent${label}`, owner: ownerName, capabilities: ['social'], model: 'gpt-4o' }) });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body?.error)}`);
    const agentGaii = ag.body.data.agent.gaii as string, agentPriv = ag.body.data.private_key as string;
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
    return { ownerName, ownerGhii: `${ownerName}@${NODE_ID}`, ownerToken, client, agentToken: rest.body.data.token as string, agentGaii };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

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

await test('Cleanup: the two extensions are removed', async () => {
    for (const name of [EXT, EXT_OTHER]) {
        const del = await json(`/v1/extensions/${name}`, { method: 'DELETE', headers: asOwner() });
        assert(del.status === 200, `delete ${name} ${del.status}`);
    }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
