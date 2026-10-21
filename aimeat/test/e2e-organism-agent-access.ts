/**
 * @file test/e2e-organism-agent-access.ts
 * @description Which of its members' agents an organism admits (agentAccess), on every door.
 *
 *   WHAT WAS OPEN. A member's agents act with the member's rights: memberships are keyed by the bare
 *   owner name, and the gates resolve the caller's owner. An owner with 29 agents brought all 29 into
 *   a customer's area, and the member list named every one of them to the customer (reported by
 *   omnituinen on 2026-09-28). With agentAccess 'listed', only the agents on agentGaiis are admitted.
 *
 *   The suite checks the refusal on the REST routes, on the MCP tools that take organism_id, on the
 *   organism key namespace and in the organism list, and pairs each refusal with a positive control:
 *   the owner in person still gets in, a listed agent gets in with its owner's rights (a workspace
 *   write included), and turning the setting back to 'all' lets the other agents in again. It also
 *   checks who may change the list and the setting: an agent may narrow, never widen, and never list
 *   itself. The last part checks return_url on aimeat_organism_invite_email.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=organism-agent-access
 * @version-history
 *   2026-10-21 — A record of an organism that no longer exists stays in an agent's owner-scope reads
 *     (REST list, aimeat_memory_list, aimeat_memory_read), as before v57; the barred agent still gets
 *     nothing of the live organism.
 *   2026-10-20 — An unlisted agent reads no organism record through GET /v1/memory?owner_scope=true
 *     (values and meta), aimeat_memory_read and aimeat_memory_list with owner_scope; a listed agent and
 *     the owner in person still do (secaudit 2026-10, v57).
 *   2026-10-15 — A plain member, signed in, is refused listing their own agent: only the organism's
 *     owner or an admin adds to the list (feature-list audit #58).
 *   v1.1.0 — 2026-09-30 — aimeat_workspace_comment_delete: a listed agent deletes its own comment and,
 *     acting for the creator, the creator's; an unlisted agent is refused on DELETE /comments.
 *   v1.0.0 — 2026-09-28 — Initial.
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
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { authorizeParams, mcpPkce, tokenParams } from './helpers/mcp-oauth-pkce.js';
import { ownerSignIn } from './helpers/owner-login.js';
import { createStorage, type StorageProvider } from '../src/storage/storage-factory.js';
import { pinnedSqlitePath, serverDbUrl } from './helpers/server-db.js';
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

interface Agent { gaii: string; token: string }
interface Party {
    owner: string;
    ownerToken: string;
    /** The agent with an MCP session. */
    agent: Agent;
    mcpToken: string;
    sessionId: string;
    nextId: number;
}

async function rpc(p: Party, method: string, params: Record<string, any> = {}) {
    const id = p.nextId++;
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${p.mcpToken}`,
            ...(p.sessionId ? { 'mcp-session-id': p.sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) p.sessionId = sid;
    const ct = res.headers.get('content-type') ?? '';
    return ct.includes('text/event-stream') ? parseSSE(await res.text(), id) : await res.json() as any;
}

async function callTool(p: Party, name: string, args: Record<string, unknown>) {
    const body = await rpc(p, 'tools/call', { name, arguments: args });
    const text = body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body ?? {});
    return { isError: body?.result?.isError === true || body?.error !== undefined, text };
}

/** Register an agent for an owner and sign it in over REST. */
async function newAgent(owner: string, ownerToken: string, name: string): Promise<Agent & { key: string }> {
    const ag = await json('/v1/agents', {
        method: 'POST', headers: bearer(ownerToken),
        body: JSON.stringify({ name, owner, capabilities: ['memory'], model: 'gpt-4o' }),
    });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body?.error)}`);
    const gaii = ag.body.data.agent.gaii as string;
    const key = ag.body.data.private_key as string;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: await sign(key, gaii + ts) }),
    });
    assert(tok.status === 200, `agent token ${tok.status}: ${JSON.stringify(tok.body?.error)}`);
    return { gaii, token: tok.body.data.token as string, key };
}

async function setupParty(label: string): Promise<Party> {
    const owner = `agacc${label}${Date.now()}`;
    const reg = () => json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'AA', password: 'AgentAccess1234' }) });
    let r = await reg();
    for (let i = 0; r.status === 429 && i < 8; i++) { await new Promise(res => setTimeout(res, 1500)); r = await reg(); }
    assert(r.status === 201, `ghii ${r.status}: ${JSON.stringify(r.body?.error)}`);

    const tok = await ownerSignIn(BASE, owner, 'AgentAccess1234');
    const ownerToken = tok.body.data.token as string;
    const agent = await newAgent(owner, ownerToken, `mcp${label}`);

    const client = await json('/v1/mcp/register', {
        method: 'POST', body: JSON.stringify({ client_name: `agent-access ${label}`, redirect_uris: [] }),
    });
    const ats = new Date().toISOString();
    const pkce = mcpPkce(BASE);
    const params = new URLSearchParams({
        response_type: 'code', client_id: client.body.client_id, gaii: agent.gaii,
        signature: await sign(agent.key, agent.gaii + NODE_ID + ats), timestamp: ats,
        ...authorizeParams(pkce),
    });
    const auth = await json(`/v1/mcp/authorize?${params}`);
    const token = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({
            grant_type: 'authorization_code', code: auth.body.code,
            client_id: client.body.client_id, client_secret: client.body.client_secret,
            ...tokenParams(pkce),
        }),
    });
    assert(token.status === 200, `mcp token ${token.status}: ${JSON.stringify(token.body)}`);

    const p: Party = { owner, ownerToken, agent: { gaii: agent.gaii, token: agent.token }, mcpToken: token.body.access_token, sessionId: '', nextId: 1 };
    await rpc(p, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'agent-access e2e', version: '1.0.0' } });
    await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${p.mcpToken}`, 'mcp-session-id': p.sessionId, 'mcp-protocol-version': '2025-03-26',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    return p;
}

console.log('\n=== Organism agent access (which members\' agents an organism admits) ===\n');

async function run() {
    const A = await setupParty('a');
    const B = await setupParty('b');
    // A second agent of A's, never listed: the one the setting must keep out.
    const a2 = await newAgent(A.owner, A.ownerToken, 'other');

    // A's MCP agent creates the organism and a workspace, while every member's agent is still admitted.
    const org = await callTool(A, 'aimeat_organism_create', {
        name: `AgAccOrg${Date.now()}`, description: 'agent access e2e', visibility: 'private',
    });
    assert(!org.isError, `organism create failed: ${org.text.slice(0, 300)}`);
    const orgId = (JSON.parse(org.text).organism?.id ?? JSON.parse(org.text).id) as string;
    const wsRes = await callTool(A, 'aimeat_workspace_create', {
        organism_id: orgId, name: 'Notes',
        manifest: {
            objectTypes: [{
                name: 'doc', schemaRef: 'schema:doc@1', namespace: 'shared.docs',
                backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'document',
            }],
        },
    });
    assert(!wsRes.isError, `workspace create failed: ${wsRes.text.slice(0, 400)}`);
    const wsId = JSON.parse(wsRes.text).ws as string;
    const add = await callTool(A, 'aimeat_organism_member_add', { organism_id: orgId, ghii: B.owner, role: 'member' });
    assert(!add.isError, `member add failed: ${add.text.slice(0, 400)}`);

    // B shares a private record with the organism by consent. Reading it goes through the consent layer
    // (services/consent.ts), which no organism route or tool stands in front of.
    const bGhii = `${B.owner}@${NODE_ID}`;
    const note = await json('/v1/memory', {
        method: 'POST', headers: bearer(B.ownerToken),
        body: JSON.stringify({ key: 'bnote.plan', value: { text: 'for the organism' }, visibility: 'private' }),
    });
    assert(note.status === 200 || note.status === 201, `B's record ${note.status}: ${JSON.stringify(note.body?.error)}`);
    const consent = await json('/v1/consent', {
        method: 'POST', headers: bearer(B.ownerToken),
        body: JSON.stringify({ data_pattern: 'bnote.**', recipient: `organism.${orgId}`, purpose: 'agent access e2e', scope: 'private' }),
    });
    assert(consent.status === 201, `consent ${consent.status}: ${JSON.stringify(consent.body?.error)}`);
    const readShared = (token: string) => json(`/v1/memory/${encodeURIComponent(bGhii)}/bnote.plan`, { headers: bearer(token) });

    await test('by default every member\'s agent is admitted (positive control)', async () => {
        const r = await json(`/v1/organisms/${orgId}`, { headers: bearer(a2.token) });
        assert(r.status === 200, `A's unlisted agent was refused before the setting changed: ${r.status} ${JSON.stringify(r.body?.error)}`);
        const s = await readShared(a2.token);
        assert(s.status === 200, `a member's agent could not read a record shared with the organism: ${s.status} ${JSON.stringify(s.body?.error)}`);
        const ov = await callTool(B, 'aimeat_organism_overview', { organism_id: orgId });
        assert(!ov.isError, `B's agent was refused before the setting changed: ${ov.text.slice(0, 300)}`);
    });

    await test('an agent may narrow the setting to "listed"', async () => {
        const r = await callTool(A, 'aimeat_organism_update', { organism_id: orgId, agent_access: 'listed' });
        assert(!r.isError, `narrowing was refused: ${r.text.slice(0, 300)}`);
    });

    await test('an unlisted agent is refused on a REST route, with AGENT_NOT_ADMITTED', async () => {
        const r = await json(`/v1/organisms/${orgId}`, { headers: bearer(a2.token) });
        assert(r.status === 403 && r.body?.error?.code === 'AGENT_NOT_ADMITTED', `expected 403 AGENT_NOT_ADMITTED, got ${r.status} ${JSON.stringify(r.body?.error)}`);
        const ws = await json(`/v1/organisms/${orgId}/workspaces`, { headers: bearer(a2.token) });
        assert(ws.status === 403, `the workspace list answered an unlisted agent: ${ws.status}`);
    });

    await test('the owner in person is not an agent and still gets in', async () => {
        const r = await json(`/v1/organisms/${orgId}`, { headers: bearer(A.ownerToken) });
        assert(r.status === 200, `the owner was refused: ${r.status} ${JSON.stringify(r.body?.error)}`);
    });

    await test('an unlisted agent is refused on an MCP tool that names the organism', async () => {
        const r = await callTool(A, 'aimeat_organism_overview', { organism_id: orgId });
        assert(r.isError && r.text.startsWith('AGENT_NOT_ADMITTED'), `expected AGENT_NOT_ADMITTED, got: ${r.text.slice(0, 300)}`);
    });

    // Secaudit 2026-10, AUTH-2: the MCP resource answered the organism, its admins and its members
    // where every tool already refused.
    await test('an unlisted agent reads nothing through the MCP resource aimeat://organisms/{id}', async () => {
        const body = await rpc(A, 'resources/read', { uri: `aimeat://organisms/${orgId}` });
        const text = body?.result?.contents?.[0]?.text ?? JSON.stringify(body?.error ?? body);
        assert(!text.includes(orgId) || !text.includes('"members"'), `the resource answered an unlisted agent: ${text.slice(0, 300)}`);
        assert(/admit|listed/i.test(text), `the refusal says why: ${text.slice(0, 300)}`);
    });

    await test('an unlisted agent cannot write an organism key, and the organism leaves its list', async () => {
        const w = await callTool(A, 'aimeat_memory_write', { key: `organism.${orgId}.shared.note`, value: { t: 'x' } });
        assert(w.isError, `an unlisted agent wrote into the organism: ${w.text.slice(0, 300)}`);
        const list = await callTool(A, 'aimeat_organism_list', {});
        assert(!list.isError && !list.text.includes(orgId), 'the organism is still in an unlisted agent\'s organism list');
    });

    // Secaudit 2026-10, v57: the key route refused an unlisted agent, and the owner-scope list and
    // read paths returned the same organism record, its value included.
    const probeKey = `organism.${orgId}.shared.v57probe`;
    await test('an unlisted agent reads no organism record through the owner-scope list and read paths', async () => {
        const w = await json('/v1/memory', {
            method: 'POST', headers: bearer(A.ownerToken),
            body: JSON.stringify({ key: probeKey, value: { text: 'v57 organism record' }, visibility: 'members' }),
        });
        assert(w.status === 201, `the owner's organism record ${w.status}: ${JSON.stringify(w.body?.error)}`);
        const keyRoute = await json(`/v1/memory/${encodeURIComponent(probeKey)}?owner_scope=true`, { headers: bearer(a2.token) });
        assert(keyRoute.status === 403, `control: the key route answered an unlisted agent ${keyRoute.status}`);
        const prefix = encodeURIComponent(`organism.${orgId}.`);
        const list = await json(`/v1/memory?owner_scope=true&prefix=${prefix}`, { headers: bearer(a2.token) });
        assert(list.status === 200 && !JSON.stringify(list.body.data.items).includes('v57probe'), `GET /v1/memory?owner_scope=true listed it: ${JSON.stringify(list.body.data?.items).slice(0, 300)}`);
        const meta = await json(`/v1/memory?owner_scope=true&include=meta&prefix=${prefix}`, { headers: bearer(a2.token) });
        assert(meta.status === 200 && !JSON.stringify(meta.body.data.items).includes('v57probe'), `the meta listing named it: ${JSON.stringify(meta.body.data?.items).slice(0, 300)}`);
        const read = await callTool(A, 'aimeat_memory_read', { key: probeKey, owner_scope: true });
        assert(read.isError && !read.text.includes('v57 organism record'), `aimeat_memory_read answered: ${read.text.slice(0, 300)}`);
        const mlist = await callTool(A, 'aimeat_memory_list', { prefix: `organism.${orgId}.`, owner_scope: true });
        assert(!mlist.isError && !mlist.text.includes('v57probe'), `aimeat_memory_list named it: ${mlist.text.slice(0, 300)}`);
        // The owner in person still lists it (positive control).
        const mine = await json(`/v1/memory?prefix=${prefix}`, { headers: bearer(A.ownerToken) });
        assert(mine.status === 200 && JSON.stringify(mine.body.data.items).includes('v57probe'), `the owner lost their own record: ${mine.status}`);
    });

    await test('a consent to the organism does not reach an unlisted agent', async () => {
        const s = await readShared(a2.token);
        assert(s.status !== 200, `an unlisted agent read a record shared with the organism: ${s.status}`);
    });

    await test('an unlisted agent cannot put itself on the list', async () => {
        const r = await json(`/v1/organisms/${orgId}/agents`, {
            method: 'POST', headers: bearer(a2.token), body: JSON.stringify({ agent_gaii: a2.gaii }),
        });
        assert(r.status === 403, `an agent listed itself: ${r.status} ${JSON.stringify(r.body)}`);
    });

    await test('the owner lists an agent, and it acts with the owner\'s rights, a workspace write included', async () => {
        const r = await json(`/v1/organisms/${orgId}/agents`, {
            method: 'POST', headers: bearer(A.ownerToken), body: JSON.stringify({ agent_gaii: A.agent.gaii }),
        });
        assert(r.status === 201, `attach ${r.status} ${JSON.stringify(r.body?.error)}`);
        const ov = await callTool(A, 'aimeat_organism_overview', { organism_id: orgId });
        assert(!ov.isError, `the listed agent was refused: ${ov.text.slice(0, 300)}`);
        const w = await callTool(A, 'aimeat_memory_write', { key: `organism.${orgId}.w.${wsId}.doc.listed`, value: { title: 'by a listed agent' } });
        assert(!w.isError, `a listed agent of the workspace creator could not write its workspace: ${w.text.slice(0, 300)}`);
    });

    await test('a listed agent reads the organism record through the owner-scope paths (v57 positive control)', async () => {
        const read = await callTool(A, 'aimeat_memory_read', { key: probeKey, owner_scope: true });
        assert(!read.isError && read.text.includes('v57 organism record'), `the listed agent could not read it: ${read.text.slice(0, 300)}`);
        const mlist = await callTool(A, 'aimeat_memory_list', { prefix: `organism.${orgId}.`, owner_scope: true });
        assert(!mlist.isError && mlist.text.includes('v57probe'), `aimeat_memory_list left it out: ${mlist.text.slice(0, 300)}`);
        const list = await json(`/v1/memory?owner_scope=true&prefix=${encodeURIComponent(`organism.${orgId}.`)}`, { headers: bearer(A.agent.token) });
        assert(list.status === 200 && JSON.stringify(list.body.data.items).includes('v57 organism record'), `GET /v1/memory?owner_scope=true left it out: ${list.status}`);
    });

    await test('a record of an organism that no longer exists stays in an agent\'s owner-scope reads, as before v57', async () => {
        // No route writes under an organism that does not exist, and deleting one removes its keys, so
        // the row is written behind the server's back: a record left from an organism gone earlier.
        const provider = (process.env.AIMEAT_DB ?? '') as StorageProvider;
        const dbUrl = serverDbUrl();
        const sqlitePath = pinnedSqlitePath();
        assert((provider === 'sqlite' && !!sqlitePath) || (provider === 'postgres-kysely' && !!dbUrl), `backend "${provider}" is not reachable from this process`);
        const storage = await createStorage({ provider, sqlitePath, dbUrl });
        const goneKey = `organism.gone${Date.now().toString(36)}.shared.leftover`;
        const now = new Date().toISOString();
        await storage.setMemory({
            key: goneKey, ownerGaii: `${A.owner}@${NODE_ID}`, value: { text: 'left from a deleted organism' },
            visibility: 'members', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
        });
        try {
            const prefix = goneKey.slice(0, goneKey.indexOf('.shared.') + 1);
            // a2 is barred from the live organism; the gone one has no rule to bar it with.
            const list = await json(`/v1/memory?owner_scope=true&prefix=${encodeURIComponent(prefix)}`, { headers: bearer(a2.token) });
            assert(list.status === 200 && JSON.stringify(list.body.data.items).includes('left from a deleted organism'),
                `GET /v1/memory?owner_scope=true left it out: ${list.status} ${JSON.stringify(list.body.data?.items ?? list.body.error).slice(0, 300)}`);
            const mlist = await callTool(A, 'aimeat_memory_list', { prefix, owner_scope: true });
            assert(!mlist.isError && mlist.text.includes('leftover'), `aimeat_memory_list left it out: ${mlist.text.slice(0, 300)}`);
            const read = await callTool(A, 'aimeat_memory_read', { key: goneKey, owner_scope: true });
            assert(!read.isError && read.text.includes('left from a deleted organism'), `aimeat_memory_read refused it: ${read.text.slice(0, 300)}`);
            // The hole stays closed: the same agent still gets nothing of the live organism that bars it.
            const live = await json(`/v1/memory?owner_scope=true&prefix=${encodeURIComponent(`organism.${orgId}.`)}`, { headers: bearer(a2.token) });
            assert(live.status === 200 && !JSON.stringify(live.body.data.items).includes('v57probe'), `the barred agent listed the live organism's record: ${JSON.stringify(live.body.data?.items).slice(0, 300)}`);
        } finally {
            await storage.deleteMemory(`${A.owner}@${NODE_ID}`, goneKey, `${A.owner}@${NODE_ID}`);
        }
    });

    await test('aimeat_workspace_comment_delete: an agent takes back its own comment, and an admin\'s agent removes the admin\'s', async () => {
        // There was no MCP tool for this, so an agent could write a comment it could not take back
        // (reported by omnituinen, 2026-09-29). A is the organism's creator; its listed agent acts
        // with A's rights, so it may also clean up A's own comment.
        const target = { organism_id: orgId, ws: wsId, space: 'doc', instance_id: 'listed' };
        const mine = await callTool(A, 'aimeat_workspace_comment', { ...target, body: 'a comment the agent will take back' });
        assert(!mine.isError, `comment failed: ${mine.text.slice(0, 300)}`);
        const mineId = JSON.parse(mine.text).comment.id as string;
        const byOwner = await json(`/v1/organisms/${orgId}/comments`, {
            method: 'POST', headers: bearer(A.ownerToken),
            body: JSON.stringify({ ws: wsId, space: 'doc', instance_id: 'listed', body: 'a test trace by the owner' }),
        });
        assert(byOwner.status === 201, `owner comment ${byOwner.status}: ${JSON.stringify(byOwner.body?.error)}`);
        const ownerCommentId = byOwner.body.data.comment.id as string;

        const barred = await json(`/v1/organisms/${orgId}/comments/${ownerCommentId}?ws=${wsId}&space=doc&instance_id=listed`, {
            method: 'DELETE', headers: bearer(a2.token),
        });
        assert(barred.status === 403, `an unlisted agent deleted a comment: ${barred.status} ${JSON.stringify(barred.body?.error)}`);

        const d1 = await callTool(A, 'aimeat_workspace_comment_delete', { ...target, comment_id: mineId });
        assert(!d1.isError && JSON.parse(d1.text).deleted === mineId, `the agent could not delete its own comment: ${d1.text.slice(0, 300)}`);
        const d2 = await callTool(A, 'aimeat_workspace_comment_delete', { ...target, comment_id: ownerCommentId });
        assert(!d2.isError, `the admin's agent could not delete the admin's comment: ${d2.text.slice(0, 300)}`);
        const gone = await callTool(A, 'aimeat_workspace_comment_delete', { ...target, comment_id: mineId });
        assert(gone.isError && gone.text.startsWith('NOT_FOUND'), `a deleted comment was found again: ${gone.text.slice(0, 300)}`);

        const list = await callTool(A, 'aimeat_workspace_comments', target);
        assert(!list.isError && !list.text.includes(mineId) && !list.text.includes(ownerCommentId), `a deleted comment is still listed: ${list.text.slice(0, 300)}`);
    });

    await test('a listed agent may not put another agent on the list', async () => {
        const r = await json(`/v1/organisms/${orgId}/agents`, {
            method: 'POST', headers: bearer(A.agent.token), body: JSON.stringify({ agent_gaii: a2.gaii }),
        });
        assert(r.status === 403 && r.body?.error?.code === 'ACCESS_DENIED', `a listed agent listed its sibling: ${r.status} ${JSON.stringify(r.body?.error)}`);
    });

    await test('a listed agent may not widen the setting back to "all"', async () => {
        const r = await callTool(A, 'aimeat_organism_update', { organism_id: orgId, agent_access: 'all' });
        assert(r.isError && /signed in/i.test(r.text), `an agent widened the setting: ${r.text.slice(0, 300)}`);
    });

    await test('a member who is neither owner nor admin may not list their own agent, even in person (audit #58)', async () => {
        // Until 2026-10-15 a member signed in as a person put their own agent on the list, so the
        // organism's list admitted whatever each member chose to add.
        const r = await json(`/v1/organisms/${orgId}/agents`, {
            method: 'POST', headers: bearer(B.ownerToken), body: JSON.stringify({ agent_gaii: B.agent.gaii }),
        });
        assert(r.status === 403 && r.body?.error?.code === 'ACCESS_DENIED' && /owner or an admin/.test(r.body?.error?.message ?? ''),
            `a plain member listed their own agent: ${r.status} ${JSON.stringify(r.body?.error)}`);
    });

    await test('another member\'s agent is refused until an organism owner lists it', async () => {
        const before = await callTool(B, 'aimeat_organism_overview', { organism_id: orgId });
        assert(before.isError && before.text.startsWith('AGENT_NOT_ADMITTED'), `B's unlisted agent got in: ${before.text.slice(0, 300)}`);
        const r = await json(`/v1/organisms/${orgId}/agents`, {
            method: 'POST', headers: bearer(A.ownerToken), body: JSON.stringify({ agent_gaii: B.agent.gaii }),
        });
        assert(r.status === 201, `the organism owner could not list a member's agent: ${r.status} ${JSON.stringify(r.body?.error)}`);
        const after = await callTool(B, 'aimeat_organism_overview', { organism_id: orgId });
        assert(!after.isError, `B's listed agent was refused: ${after.text.slice(0, 300)}`);
    });

    await test('the member list names only the admitted agents', async () => {
        const r = await json(`/v1/organisms/${orgId}/members`, { headers: bearer(B.ownerToken) });
        assert(r.status === 200, `members ${r.status}`);
        assert(r.body.data.agent_access === 'listed', `agent_access not reported: ${JSON.stringify(r.body.data.agent_access)}`);
        const aRow = (r.body.data.members as any[]).find(m => String(m.ghii).startsWith(A.owner));
        const names = (aRow?.agents ?? []).map((x: any) => x.gaii);
        assert(names.includes(A.agent.gaii), `the listed agent is missing from the roster: ${JSON.stringify(names)}`);
        assert(!names.includes(a2.gaii), `the unlisted agent is still on the roster: ${JSON.stringify(names)}`);
    });

    await test('the owner in person widens the setting, and the other agents are admitted again', async () => {
        const r = await json(`/v1/organisms/${orgId}`, {
            method: 'PUT', headers: bearer(A.ownerToken), body: JSON.stringify({ agent_access: 'all' }),
        });
        assert(r.status === 200, `the owner could not widen: ${r.status} ${JSON.stringify(r.body?.error)}`);
        const g = await json(`/v1/organisms/${orgId}`, { headers: bearer(a2.token) });
        assert(g.status === 200, `the unlisted agent is still refused under "all": ${g.status}`);
        const s = await readShared(a2.token);
        assert(s.status === 200, `the consent did not reach the agent again under "all": ${s.status}`);
    });

    await test('aimeat_organism_invite_email keeps a return_url on this node and drops a foreign one', async () => {
        const kept = await callTool(A, 'aimeat_organism_invite_email', {
            organism_id: orgId, email: `kept${Date.now()}@example.com`, return_url: `${BASE}/v1/profile`,
        });
        assert(!kept.isError, `invite failed: ${kept.text.slice(0, 300)}`);
        assert(typeof JSON.parse(kept.text).return_url === 'string', `the return_url was not kept: ${kept.text.slice(0, 300)}`);
        const dropped = await callTool(A, 'aimeat_organism_invite_email', {
            organism_id: orgId, email: `dropped${Date.now()}@example.com`, return_url: 'https://evil.example/landing',
        });
        assert(!dropped.isError, `invite failed: ${dropped.text.slice(0, 300)}`);
        assert(JSON.parse(dropped.text).return_url === null, `a foreign return_url was kept: ${dropped.text.slice(0, 300)}`);
    });

    console.log('\nCleanup');
    await json(`/v1/organisms/${orgId}`, { method: 'DELETE', headers: bearer(A.ownerToken) });
    await json(`/v1/owners/${A.owner}`, { method: 'DELETE', headers: bearer(A.ownerToken) });
    await json(`/v1/owners/${B.owner}`, { method: 'DELETE', headers: bearer(B.ownerToken) });

    console.log(`\nOrganism agent access: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
    if (failed > 0) process.exit(1);
}

void run();
