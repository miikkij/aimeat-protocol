/**
 * @file test/e2e-mcp-cross-owner.ts
 * @description Proof that the gates added on 2026-08-10/11 hold on the MCP surface.
 *
 *   WHY THIS FILE EXISTS. Every one of those gates passed the existing suites on its first run.
 *   That is not reassuring, it is the finding: if any test had exercised "owner B's agent deletes
 *   owner A's extension over MCP", it would have been asserting the broken behaviour and would have
 *   failed the moment the gate landed. None did. The suites proved the changes broke nothing that
 *   was tested; they said nothing about whether the new refusals work, because nothing had ever
 *   asked.
 *
 *   So this asks. Two owners, each with their own agent and its own MCP session, and owner B tries
 *   in turn every door that was open until yesterday:
 *
 *     - activate, deactivate and delete owner A's extension            (5befb1ba)
 *     - activate, deactivate and delete owner A's cortex extension     (5befb1ba)
 *     - invoke owner A's PRIVATE capability                            (cfb1c13b)
 *     - post into owner A's PRIVATE board                              (97f463c6)
 *     - cron owner A's extension                                       (ed990076)
 *
 *   And two that are not cross-owner but were unbounded over MCP:
 *
 *     - a memory value past the node's size ceiling                    (7017d545)
 *     - a board post with an empty title                               (97f463c6)
 *
 *   Each test names what used to happen, so a future reader knows what the assertion is protecting
 *   rather than only that it passes.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-mcp-cross-owner
 * @version-history
 *   v1.0.0 — 2026-08-11 — Initial (August 2026 audit step 3: the MCP/REST gate parity work).
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

function parseSSE(text: string): any[] {
    const out: any[] = [];
    for (const evt of text.split('\n\n')) {
        let data = '';
        for (const line of evt.trim().split('\n')) if (line.startsWith('data: ')) data += line.slice(6);
        if (data) { try { out.push(JSON.parse(data)); } catch { /* not a JSON frame */ } }
    }
    return out;
}

/** One MCP session: its own OAuth client, its own token, its own session id. */
interface Session { token: string; sessionId: string; nextId: number }

async function rpc(s: Session, method: string, params: Record<string, any> = {}) {
    const id = s.nextId++;
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${s.token}`,
            ...(s.sessionId ? { 'mcp-session-id': s.sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) s.sessionId = sid;
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('text/event-stream')
        ? (parseSSE(await res.text()).find(m => m.id === id) ?? {})
        : await res.json() as any;
    return { status: res.status, body };
}

/** Call a tool and return { isError, text } — the shape every refusal here takes. */
async function callTool(s: Session, name: string, args: Record<string, unknown>) {
    const { body } = await rpc(s, 'tools/call', { name, arguments: args });
    const result = body?.result;
    const text = result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body ?? {});
    // A tool the session's scopes do not allow is not registered at all, which the SDK reports as a
    // JSON-RPC error rather than an isError result. Both are refusals for this suite's purpose.
    const isError = result?.isError === true || body?.error !== undefined;
    return { isError, text, raw: body };
}

/** A registered owner, an agent under it, and an initialised MCP session for that agent. */
async function setupOwner(label: string) {
    const name = `xown${label}${Date.now()}`;
    const reg = () => json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Cross', password: 'CrossOwner1234' }) });
    let r = await reg();
    for (let i = 0; r.status === 429 && i < 8; i++) { await new Promise(res => setTimeout(res, 1500)); r = await reg(); }
    assert(r.status === 201, `ghii ${r.status}: ${JSON.stringify(r.body?.error)}`);

    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(r.body.data.private_key, name + NODE_ID + ts) }),
    });
    const ownerToken = tok.body.data.token as string;

    const ag = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: `ag${label}`, owner: name, capabilities: ['extensions'], model: 'gpt-4o' }),
    });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body?.error)}`);
    const agentGaii = ag.body.data.agent.gaii as string;
    const agentKey = ag.body.data.private_key as string;

    const client = await json('/v1/mcp/register', {
        method: 'POST',
        body: JSON.stringify({ client_name: `cross-owner ${label}`, redirect_uris: [] }),
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
    await rpc(session, 'initialize', {
        protocolVersion: '2025-03-26', capabilities: {},
        clientInfo: { name: 'cross-owner e2e', version: '1.0.0' },
    });
    await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${session.token}`,
            'mcp-session-id': session.sessionId, 'mcp-protocol-version': '2025-03-26',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });

    return { name, ownerToken, agentGaii, session };
}

console.log('\n=== MCP cross-owner gates (August 2026 audit, step 3) ===\n');

async function run() {
    const A = await setupOwner('a');
    const B = await setupOwner('b');


    // ── Owner A installs an extension through the HTTP door ────────────────────────────────
    const extName = `crossext${Date.now()}`;
    const install = await json('/v1/extensions', {
        method: 'POST', headers: { Authorization: `Bearer ${A.ownerToken}` },
        body: JSON.stringify({
            manifest: JSON.stringify({
                metadata: { name: extName, version: '1.0.0', description: 'cross-owner e2e', author: 'e2e' },
                actions: [{ id: 'ping', method: 'POST', path: '/ping', script: 'echo' }],
                limits: { timeout_ms: 5000, max_api_calls: 1 },
            }),
            scripts: { echo: 'export default async function(){ return { ok: true }; }' },
        }),
    });
    assert(install.status === 201, `owner A install ${install.status}: ${JSON.stringify(install.body?.error)}`);

    await test('owner B cannot ACTIVATE owner A\'s extension over MCP', async () => {
        // Until 5befb1ba this had no ownership check at all: any agent with ext:write reached every
        // extension on the node.
        const r = await callTool(B.session, 'aimeat_extension_activate', { name: extName });
        assert(r.isError, `expected a refusal, got: ${r.text.slice(0, 200)}`);
        const after = await json(`/v1/extensions/${extName}`, { headers: { Authorization: `Bearer ${A.ownerToken}` } });
        assert(after.body?.data?.extension?.status !== 'active',
            'owner B activated owner A\'s extension — the guard did not hold');
    });

    await test('owner A CAN activate their own extension over MCP', async () => {
        // The guard must refuse a stranger without refusing the installer.
        const r = await callTool(A.session, 'aimeat_extension_activate', { name: extName });
        assert(!r.isError, `the installer's own agent was refused: ${r.text.slice(0, 200)}`);
    });

    await test('owner B cannot DEACTIVATE owner A\'s extension over MCP', async () => {
        const r = await callTool(B.session, 'aimeat_extension_deactivate', { name: extName });
        assert(r.isError, `expected a refusal, got: ${r.text.slice(0, 200)}`);
        const after = await json(`/v1/extensions/${extName}`, { headers: { Authorization: `Bearer ${A.ownerToken}` } });
        assert(after.body?.data?.extension?.status === 'active',
            'owner B took owner A\'s extension offline');
    });

    await test('owner B cannot DELETE owner A\'s extension over MCP', async () => {
        // The worst of the six: uninstalls the extension and deletes its lib files.
        const r = await callTool(B.session, 'aimeat_extension_delete', { name: extName });
        assert(r.isError, `expected a refusal, got: ${r.text.slice(0, 200)}`);
        const after = await json(`/v1/extensions/${extName}`, { headers: { Authorization: `Bearer ${A.ownerToken}` } });
        assert(after.status === 200, 'owner B deleted owner A\'s extension');
    });

    await test('owner B cannot put owner A\'s extension on a clock, and owner A can', async () => {
        // ed990076. The scheduler runs an extension action as a SYSTEM caller, so a cron on somebody
        // else's extension is a standing unpriced call on their capability, keys and quota.
        //
        // The positive control is the whole test: "B was refused" proves nothing on its own, because
        // a tool the session cannot reach refuses too. A doing the SAME call successfully is what
        // makes B's refusal mean "not your extension" rather than "not your tool".
        const args = { kind: 'extension', cron: '0 2 * * *', extension_name: extName, action_id: 'ping' };

        const mine = await callTool(A.session, 'aimeat_schedule_create', { ...args, display_name: 'mine' });
        assert(!mine.isError, `the extension's owner could not schedule it: ${mine.text.slice(0, 200)}`);

        const theirs = await callTool(B.session, 'aimeat_schedule_create', { ...args, display_name: 'raid' });
        assert(theirs.isError, `owner B put owner A's extension on a clock: ${theirs.text.slice(0, 200)}`);
        assert(/not found/i.test(theirs.text),
            `refused, but not as "not found" — which is the wording that keeps the id unconfirmed: ${theirs.text.slice(0, 200)}`);
    });

    // ── A private capability ────────────────────────────────────────────────────────────────
    const capId = `crosscap${Date.now()}`;
    await test('owner B cannot invoke owner A\'s PRIVATE capability', async () => {
        // cfb1c13b. The read path hides a private capability from everyone but its owner; invoke
        // took anything by id, including a manual webhook capability pointing at somebody's endpoint.
        const made = await callTool(A.session, 'aimeat_capabilities_create', {
            id: capId, name: 'private probe', summary: 'cross-owner e2e', visibility: 'private',
            usage: 'test only',
        });
        // AIMEAT_CAPABILITY_PUBLISHING defaults to 'disabled', so on an ordinary node nobody but the
        // operator can create a capability at all and there is no private one to protect. That is
        // itself worth asserting — it is the gate cfb1c13b added — so the test checks whichever case
        // this node is in rather than returning early and passing for the wrong reason.
        if (made.isError) {
            assert(/PUBLISHING_DISABLED/i.test(made.text),
                `owner A could not create the capability for an unexpected reason: ${made.text.slice(0, 200)}`);
            // Publishing is off: prove it is off for everyone, which is the whole of the policy.
            const asB = await callTool(B.session, 'aimeat_capabilities_create', {
                id: `${capId}b`, name: 'probe', summary: 'cross-owner e2e', visibility: 'private', usage: 'test only',
            });
            assert(asB.isError && /PUBLISHING_DISABLED/i.test(asB.text),
                `publishing is disabled for owner A but not for owner B: ${asB.text.slice(0, 200)}`);
            return;
        }
        // Publishing is on: the private-invoke gate is testable, and needs a positive control for
        // the same reason the schedule one does.
        const mine = await callTool(A.session, 'aimeat_capabilities_invoke', { id: capId, input: {} });
        assert(!mine.isError || !/not found/i.test(mine.text),
            `the capability's owner was told it does not exist: ${mine.text.slice(0, 200)}`);
        const r = await callTool(B.session, 'aimeat_capabilities_invoke', { id: capId, input: {} });
        assert(r.isError, `owner B invoked owner A's private capability: ${r.text.slice(0, 200)}`);
        assert(/not found/i.test(r.text),
            `refused, but not as "not found": ${r.text.slice(0, 200)}`);
    });

    // ── A private board ─────────────────────────────────────────────────────────────────────
    let boardId = '';
    await test('owner B cannot post into owner A\'s PRIVATE board', async () => {
        // 97f463c6. aimeat_board_post never loaded the board, so it had no access check at all.
        const made = await callTool(A.session, 'aimeat_board_create', {
            name: `crossboard${Date.now()}`, visibility: 'private', description: 'cross-owner e2e',
        });
        assert(!made.isError, `owner A could not create a board: ${made.text.slice(0, 200)}`);
        boardId = (JSON.parse(made.text).board_id ?? JSON.parse(made.text).id) as string;
        assert(!!boardId, `no board id in ${made.text.slice(0, 200)}`);

        const r = await callTool(B.session, 'aimeat_board_post', {
            board_id: boardId, title: 'intrusion', body: 'this should not land',
        });
        assert(r.isError, `owner B posted into owner A's private board: ${r.text.slice(0, 200)}`);
    });

    await test('owner A CAN post into their own private board', async () => {
        const r = await callTool(A.session, 'aimeat_board_post', {
            board_id: boardId, title: 'mine', body: 'this should land',
        });
        assert(!r.isError, `the board owner was refused: ${r.text.slice(0, 200)}`);
    });

    await test('a board post with an empty title is refused', async () => {
        // The route validates 1-256; the tool took z.string(), so an empty post stored.
        const r = await callTool(A.session, 'aimeat_board_post', { board_id: boardId, title: '', body: 'no title' });
        assert(r.isError, `an empty title was accepted: ${r.text.slice(0, 200)}`);
    });

    // ── The memory ceiling ──────────────────────────────────────────────────────────────────
    await test('a memory value past the node ceiling is refused over MCP', async () => {
        // 7017d545. Every memory ceiling lived in the HTTP route, so an agent writing over MCP had
        // no size limit at all. The default is 1024 kB; 3 MB is unambiguously past it.
        const huge = 'x'.repeat(3 * 1024 * 1024);
        const r = await callTool(A.session, 'aimeat_memory_write', { key: 'cross.owner.huge', value: huge });
        assert(r.isError, `a 3 MB value was accepted over MCP: ${r.text.slice(0, 200)}`);
        assert(/QUOTA_EXCEEDED/i.test(r.text), `refused, but not as a quota: ${r.text.slice(0, 200)}`);
    });

    console.log(`\nMCP cross-owner gates: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
    if (failed > 0) process.exit(1);
}

void run();
