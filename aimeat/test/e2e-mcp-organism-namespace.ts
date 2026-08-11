/**
 * @file test/e2e-mcp-organism-namespace.ts
 * @description Proof that the organism namespace rule reaches the MCP door.
 *
 *   WHAT WAS OPEN. The rule that decides who may write an `organism.{id}.*` key lived entirely in
 *   middleware/workspace-access.ts, which is Express-shaped. services/memory-write.ts — the shared
 *   write every MCP tool calls — could therefore carry only the FLOOR of it (an active membership),
 *   and three doors above that floor were open on the agent surface and shut on the web one:
 *
 *     - workspace CONTENT: writing `organism.{id}.w.{ws}.*` as a plain member needs the workspace
 *       creator's 'workspace-contributor' grant. Without it the HTTP door answers CONSENT_REQUIRED.
 *       Over MCP it wrote. Revoking a contributor role stopped the browser and not the agent, which
 *       is the door that matters.
 *     - `organism.{id}.meta.*` is admin/creator write only. It holds the workspace registry that
 *       every access decision above reads, so a plain member writing there decides who may write
 *       everywhere else. Over MCP any active member could.
 *     - `organism.{id}.member.{owner}.*` is writable only by that owner. Over MCP one member could
 *       overwrite another's.
 *
 *   Each refusal here is paired with a POSITIVE CONTROL, because "B was refused" proves nothing on
 *   its own: an unregistered tool, a malformed argument and a working gate all read as isError.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-organism-namespace
 * @version-history
 *   v1.0.0 — 2026-08-11 — Initial (August 2026 audit: the organism rule moves to a shared service).
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

interface Party {
    owner: string;
    /** A human owner session. Deliberately NOT used for the parity comparison: the consent layer
     *  exempts a human owner-role member, so an owner token and an agent token are different
     *  principals and are supposed to get different answers. */
    ownerToken: string;
    agentGaii: string;
    /** The SAME agent's REST token, so "over MCP" and "over HTTP" mean the same principal. */
    agentToken: string;
    token: string;
    sessionId: string;
    nextId: number;
}

async function rpc(p: Party, method: string, params: Record<string, any> = {}) {
    const id = p.nextId++;
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${p.token}`,
            ...(p.sessionId ? { 'mcp-session-id': p.sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) p.sessionId = sid;
    const ct = res.headers.get('content-type') ?? '';
    return ct.includes('text/event-stream') ? parseSSE(await res.text(), id) : await res.json() as any;
}

/** Call a tool and return the refusal-or-answer shape every test here reads. */
async function callTool(p: Party, name: string, args: Record<string, unknown>) {
    const body = await rpc(p, 'tools/call', { name, arguments: args });
    const text = body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body ?? {});
    // A tool the session's scopes do not allow is never registered, which the SDK reports as a
    // JSON-RPC error rather than an isError result. Both are refusals for this suite's purpose.
    return { isError: body?.result?.isError === true || body?.error !== undefined, text };
}

async function setupParty(label: string): Promise<Party> {
    const owner = `orgns${label}${Date.now()}`;
    const reg = () => json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'NS', password: 'NamespaceRule1234' }) });
    let r = await reg();
    for (let i = 0; r.status === 429 && i < 8; i++) { await new Promise(res => setTimeout(res, 1500)); r = await reg(); }
    assert(r.status === 201, `ghii ${r.status}: ${JSON.stringify(r.body?.error)}`);

    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner, timestamp: ts, signature: await sign(r.body.data.private_key, owner + NODE_ID + ts) }),
    });
    const ownerToken = tok.body.data.token as string;

    const ag = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: `ag${label}`, owner, capabilities: ['memory'], model: 'gpt-4o' }),
    });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body?.error)}`);
    const agentGaii = ag.body.data.agent.gaii as string;
    const agentKey = ag.body.data.private_key as string;

    const ags = new Date().toISOString();
    const agTok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agentGaii, timestamp: ags, signature: await sign(agentKey, agentGaii + ags) }),
    });
    assert(agTok.status === 200, `agent token ${agTok.status}: ${JSON.stringify(agTok.body?.error)}`);
    const agentToken = agTok.body.data.token as string;

    const client = await json('/v1/mcp/register', {
        method: 'POST', body: JSON.stringify({ client_name: `org-ns ${label}`, redirect_uris: [] }),
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

    const p: Party = { owner, ownerToken, agentGaii, agentToken, token: token.body.access_token, sessionId: '', nextId: 1 };
    await rpc(p, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'org-ns e2e', version: '1.0.0' } });
    await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${p.token}`, 'mcp-session-id': p.sessionId, 'mcp-protocol-version': '2025-03-26',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    return p;
}

console.log('\n=== MCP organism namespace rule (August 2026 audit) ===\n');

async function run() {
    const A = await setupParty('a');
    const B = await setupParty('b');

    // A creates the organism and a workspace inside it, so the registry names A as the creator.
    const org = await callTool(A, 'aimeat_organism_create', {
        name: `NsOrg${Date.now()}`, description: 'organism namespace rule e2e', visibility: 'private',
    });
    assert(!org.isError, `organism create failed: ${org.text.slice(0, 300)}`);
    const orgId = (JSON.parse(org.text).organism?.id ?? JSON.parse(org.text).id) as string;
    assert(typeof orgId === 'string' && orgId.length > 0, `no organism id in: ${org.text.slice(0, 300)}`);

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
    assert(typeof wsId === 'string' && wsId.length > 0, `no workspace id in: ${wsRes.text.slice(0, 300)}`);

    // B joins as a plain member, with no contributor grant on A's workspace.
    const add = await callTool(A, 'aimeat_organism_member_add', {
        organism_id: orgId, ghii: B.owner, role: 'member',
    });
    assert(!add.isError, `member add failed: ${add.text.slice(0, 400)}`);

    // ── The three keys B may not write, each checked on BOTH doors ──────────────────────────────
    //
    // The assertion is parity, not a particular wording: the same key, the same principal, the same
    // refusal code whichever door it arrives at. That is the whole claim, and it is what was false
    // — the HTTP door refused all three and the tool surface wrote all three.
    //
    // Which rule fires is the middleware's own order, unchanged: the consent layer runs before the
    // meta and member rules, so a member holding no consent at all is stopped there, and the two
    // rules under it decide for a member who does hold one. Both doors run them in that order now,
    // which is the point.
    const forbidden: Array<{ what: string; key: string; value: unknown }> = [
        {
            what: 'another member\'s WORKSPACE content, with no contributor grant',
            key: `organism.${orgId}.w.${wsId}.doc.intruder`,
            value: { title: 'written by B' },
        },
        {
            what: 'organism meta, which holds the registry every access decision reads',
            key: `organism.${orgId}.meta.workspaces`,
            value: { workspaces: [{ id: 'forged', name: 'mine now', createdBy: B.owner }] },
        },
        {
            what: 'another member\'s own namespace',
            key: `organism.${orgId}.member.${A.owner}.notes`,
            value: { note: 'B was here' },
        },
    ];

    for (const f of forbidden) {
        await test(`a plain member cannot write ${f.what} — over MCP, and the HTTP door agrees`, async () => {
            const viaMcp = await callTool(B, 'aimeat_memory_write', { key: f.key, value: f.value });
            assert(viaMcp.isError, `MCP allowed the write: ${viaMcp.text.slice(0, 300)}`);

            // B's AGENT over HTTP, not B the human: the consent layer exempts a human owner-role
            // member from consenting to itself, so an owner token is a different principal and is
            // meant to get a different answer. The claim under test is that one principal gets one
            // answer whichever door it uses.
            const viaHttp = await json('/v1/memory', {
                method: 'POST', headers: { Authorization: `Bearer ${B.agentToken}` },
                body: JSON.stringify({ key: f.key, value: f.value }),
            });
            assert(viaHttp.status === 403, `HTTP gave ${viaHttp.status}: ${JSON.stringify(viaHttp.body?.error)}`);

            const code = viaHttp.body?.error?.code as string;
            assert(viaMcp.text.includes(code),
                `the doors gave different answers — HTTP said ${code}, MCP said ${viaMcp.text.slice(0, 200)}`);
        });
    }

    await test('the registry A wrote is intact (nothing was written before the refusal)', async () => {
        const r = await callTool(A, 'aimeat_workspace_list', { organism_id: orgId });
        assert(!r.isError, `workspace list failed: ${r.text.slice(0, 300)}`);
        assert(r.text.includes(wsId), `A's workspace is gone from the registry: ${r.text.slice(0, 400)}`);
        assert(!r.text.includes('mine now'), `B's forged registry survived: ${r.text.slice(0, 400)}`);
    });

    // ── The positive controls ───────────────────────────────────────────────────────────────────
    // Without these, every assertion above is satisfied by a broken tool.
    await test('B CAN write B\'s own member namespace (the rule is not a ban on members)', async () => {
        const r = await callTool(B, 'aimeat_memory_write', {
            key: `organism.${orgId}.member.${B.owner}.notes`,
            value: { note: 'mine' },
        });
        assert(!r.isError, `B's own namespace was refused: ${r.text.slice(0, 300)}`);
    });

    await test('A, the creator, CAN still write organism meta over MCP', async () => {
        const r = await callTool(A, 'aimeat_memory_write', {
            key: `organism.${orgId}.meta.tagline`,
            value: { text: 'creator writes meta' },
        });
        assert(!r.isError, `the creator was refused their own meta namespace: ${r.text.slice(0, 300)}`);
    });

    // ── The publish gate, read from wherever the config actually lives ──────────────────────────
    //
    // The gate is a field in organism.{id}.meta.config, and that record belongs to whoever wrote it
    // — normally the organism's creator. The MCP publish tool read it from the CALLING agent's own
    // namespace, so for every member but the creator it found nothing, read the gate as absent, and
    // published. "Publishing requires human approval" was true in the browser and false through a
    // tool call, for exactly the members the gate is there to hold.
    await test('A turns the publish gate on, and grants B contributor so B can write drafts', async () => {
        const cfg = await callTool(A, 'aimeat_memory_write', {
            key: `organism.${orgId}.meta.config`,
            value: { gates: { publish: { enabled: true } } },
        });
        assert(!cfg.isError, `writing the config failed: ${cfg.text.slice(0, 300)}`);

        const grant = await callTool(A, 'aimeat_workspace_member_grant', {
            organism_id: orgId, ws: wsId, grantee: B.owner, role: 'contributor',
        });
        assert(!grant.isError, `grant failed: ${grant.text.slice(0, 300)}`);
    });

    await test('B, a contributor and not the creator, CAN write a draft with the gate on', async () => {
        const w = await callTool(B, 'aimeat_workspace_write', {
            organism_id: orgId, ws: wsId, space: 'doc', id: 'gated', value: { title: 'B draft' },
        });
        assert(!w.isError, `B could not write a draft: ${w.text.slice(0, 300)}`);
    });

    await test('B cannot PUBLISH it — the gate is found even though the config is A\'s record', async () => {
        const p = await callTool(B, 'aimeat_workspace_publish', {
            organism_id: orgId, ws: wsId, namespace: 'shared.docs', id: 'gated',
        });
        assert(p.isError, `the publish gate did not hold: ${p.text.slice(0, 300)}`);
        assert(/approval|gate/i.test(p.text), `expected the gate's own wording, got: ${p.text.slice(0, 300)}`);
    });

    await test('A, the workspace creator, CAN still write its content over MCP', async () => {
        const r = await callTool(A, 'aimeat_memory_write', {
            key: `organism.${orgId}.w.${wsId}.doc.own`,
            value: { title: 'by the creator' },
        });
        assert(!r.isError, `the workspace creator was refused their own workspace: ${r.text.slice(0, 300)}`);
    });

    console.log('\nCleanup');
    await json(`/v1/organisms/${orgId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${A.ownerToken}` } });
    await json(`/v1/owners/${A.owner}`, { method: 'DELETE', headers: { Authorization: `Bearer ${A.ownerToken}` } });
    await json(`/v1/owners/${B.owner}`, { method: 'DELETE', headers: { Authorization: `Bearer ${B.ownerToken}` } });

    console.log(`\nMCP organism namespace: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
    if (failed > 0) process.exit(1);
}

void run();
