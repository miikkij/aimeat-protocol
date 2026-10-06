/**
 * @file e2e-app-template-proposals.ts
 * @description E2E for agent-proposed app templates (AppDev KB Phase 6):
 *   aimeat_app_template_propose (model mandatory, derived_from must be an own published app,
 *   upsert by id preserving proofs), _list/_get (source-app live state + how_to_start),
 *   _delete, the publish next_steps nudge (agent_face_present / bound_skills_count /
 *   template_proposal_hint), cross-owner isolation, and the `templates` discovery source
 *   (aimeat_discover type=template scope=own finds a proposal; public scope stays empty).
 * @usage registered in test/run-e2e-ci.ts; run via the e2e harness
 *   (cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=app-template-proposals).
 * @version-history
 *   v1.1.0 — 2026-10-06 — POST /v1/appdev/templates and GET /v1/appdev/pitfalls/index, the routes the
 *     connector's tools call now: the same answer as the MCP tools, and their refusals
 *     (secaudit 2026-10 follow-up, Part B).
 *   v1.0.0 — 2026-07-19 — initial (AppDev KB Phase 6).
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err: any) {
        failed++;
        console.error(`  ❌ ${name}: ${err.message}`);
    }
}

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body };
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

function parseSSE(text: string): any[] {
    const messages: any[] = [];
    for (const evt of text.split('\n\n')) {
        let data = '';
        for (const line of evt.trim().split('\n')) {
            if (line.startsWith('data: ')) data += line.slice(6);
        }
        if (data) { try { messages.push(JSON.parse(data)); } catch { /* skip */ } }
    }
    return messages;
}

class McpSession {
    token = '';
    sessionId = '';
    private nextId = 1;

    async rpc(method: string, params: Record<string, any> = {}) {
        const id = this.nextId++;
        const res = await fetch(`${BASE}/v1/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream',
                ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
                ...(this.sessionId ? { 'mcp-session-id': this.sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        });
        const sid = res.headers.get('mcp-session-id');
        if (sid) this.sessionId = sid;
        const ct = res.headers.get('content-type') ?? '';
        let body: any;
        if (ct.includes('text/event-stream')) {
            const messages = parseSSE(await res.text());
            body = messages.find(m => m.id === id) ?? messages[0] ?? {};
        } else {
            body = await res.json() as any;
        }
        return { status: res.status, body };
    }

    async call(name: string, args: Record<string, any>) {
        const { body } = await this.rpc('tools/call', { name, arguments: args });
        return body;
    }
}

async function setupOwnerAgentSession(ownerName: string, agentName: string): Promise<{ session: McpSession; ownerToken: string }> {
    const { status: gs, body: gb } = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: ownerName, display_name: ownerName, password: 'Template1!' }),
    });
    assert(gs === 201, `ghii ${gs}`);
    const ts1 = new Date().toISOString();
    const { body: tb } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: ownerName, timestamp: ts1, signature: await signMsg(gb.data.private_key, ownerName + NODE_ID + ts1) }),
    });
    const ownerToken = tb.data.token;
    const { status: as, body: ab } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: agentName, owner: ownerName, capabilities: ['appdev'] }),
    });
    assert(as === 201, `agent ${as}`);
    const { body: reg } = await json('/v1/mcp/register', {
        method: 'POST',
        body: JSON.stringify({ client_name: `${ownerName} template client`, redirect_uris: [] }),
    });
    const ts2 = new Date().toISOString();
    const params = new URLSearchParams({
        response_type: 'code', client_id: reg.client_id, gaii: ab.data.agent.gaii,
        signature: await signMsg(ab.data.private_key, ab.data.agent.gaii + NODE_ID + ts2), timestamp: ts2,
    });
    const { body: auth } = await json(`/v1/mcp/authorize?${params}`);
    const { body: tok } = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({ grant_type: 'authorization_code', code: auth.code, client_id: reg.client_id, client_secret: reg.client_secret }),
    });
    const session = new McpSession();
    session.token = tok.access_token;
    await session.rpc('initialize', {
        protocolVersion: '2025-03-26', capabilities: {},
        clientInfo: { name: 'Template Proposals E2E', version: '1.0.0' },
    });
    return { session, ownerToken };
}

const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64');

console.log('\n=== AIMEAT App Template Proposals E2E Test ===\n');

const stamp = Date.now().toString().slice(-7);
const ownerA = `tpowna${stamp}`;
const ownerB = `tpownb${stamp}`;
const FILENAME = 'template-demo.html';
let A: McpSession;
let B: McpSession;

await test('Setup: two owners + agents; A publishes an app over MCP (next_steps present)', async () => {
    ({ session: A } = await setupOwnerAgentSession(ownerA, 'tpagenta'));
    ({ session: B } = await setupOwnerAgentSession(ownerB, 'tpagentb'));
    const pub = await A.call('aimeat_app_publish', {
        filename: FILENAME,
        content_base64: b64('<!doctype html><meta name="aimeat-app" content="template-demo.html"><h1>tpl demo</h1>'),
        name: 'Template Demo', description: 'source app for template proposal', category: 'utility', tags: ['demo'],
    });
    assert(!pub.result?.isError, `publish failed: ${JSON.stringify(pub).slice(0, 250)}`);
    const out = JSON.parse(pub.result.content[0].text);
    assert(out.next_steps, 'next_steps missing from publish response');
    assert(out.next_steps.agent_face_present === false, 'fresh app should have no face yet');
    assert(out.next_steps.bound_skills_count === 0, 'fresh app should have no bound skills');
    assert(/aimeat_app_template_propose/.test(out.next_steps.template_proposal_hint), 'template hint missing');
});

await test('propose: happy path (model mandatory, derived_from validated)', async () => {
    const body = await A.call('aimeat_app_template_propose', {
        id: 'demo-dashboard',
        title: 'Single-view dashboard shell',
        description: 'Auth + data + one grid view, mobile-safe',
        derived_from: { owner: ownerA, filename: FILENAME },
        tier: 'T1',
        reuse_notes: 'Keep the auth mount + data load pattern; swap the grid columns per use case.',
        model: 'Claude-Haiku-4.5',
        tags: ['dashboard'],
        start_mode: 'fork',
        packs: ['styling'],
    });
    assert(!body.result?.isError, `propose failed: ${JSON.stringify(body).slice(0, 250)}`);
    const out = JSON.parse(body.result.content[0].text);
    assert(out.id === 'demo-dashboard' && out.updated === false, `unexpected: ${JSON.stringify(out)}`);
});

await test('propose: missing model rejected; foreign derived_from rejected', async () => {
    const noModel = await A.call('aimeat_app_template_propose', {
        id: 'x1', title: 'No model', description: 'missing model field',
        derived_from: { owner: ownerA, filename: FILENAME }, tier: 'T1',
        reuse_notes: 'this should not be accepted at all',
    });
    assert(noModel.error !== undefined || noModel.result?.isError, 'missing model accepted');
    const foreign = await A.call('aimeat_app_template_propose', {
        id: 'x2', title: 'Foreign app', description: 'derived from someone else',
        derived_from: { owner: ownerB, filename: FILENAME }, tier: 'T1',
        reuse_notes: 'should be rejected as not my own app', model: 'claude-haiku-4.5',
    });
    assert(foreign.result?.isError === true, 'foreign derived_from accepted');
    const missingApp = await A.call('aimeat_app_template_propose', {
        id: 'x3', title: 'Ghost app', description: 'derived from an unpublished app',
        derived_from: { owner: ownerA, filename: 'no-such-app.html' }, tier: 'T1',
        reuse_notes: 'should be rejected: app does not exist', model: 'claude-haiku-4.5',
    });
    assert(missingApp.result?.isError === true, 'nonexistent derived_from accepted');
});

await test('list + get: manifest, live source-app state, how_to_start', async () => {
    const list = await A.call('aimeat_app_template_list', {});
    const lout = JSON.parse(list.result.content[0].text);
    assert(lout.total === 1 && lout.templates[0].id === 'demo-dashboard', `list wrong: ${JSON.stringify(lout)}`);
    assert(lout.templates[0].model === 'claude-haiku-4.5', 'model not normalized lowercase');

    const get = await A.call('aimeat_app_template_get', { id: 'demo-dashboard' });
    const g = JSON.parse(get.result.content[0].text);
    assert(g.tier === 'T1' && /auth mount/.test(g.reuseNotes), 'manifest body wrong');
    assert(g.source_app.exists === true && g.source_app.version >= 1, 'live source state missing');
    assert(/aimeat_app_fork/.test(g.how_to_start), 'how_to_start missing fork instruction');
});

await test('upsert: same id replaces content, createdAt preserved', async () => {
    const first = await A.call('aimeat_app_template_get', { id: 'demo-dashboard' });
    const created = JSON.parse(first.result.content[0].text).createdAt;
    const body = await A.call('aimeat_app_template_propose', {
        id: 'demo-dashboard',
        title: 'Single-view dashboard shell v2',
        description: 'Auth + data + one grid view, mobile-safe, theme-aware',
        derived_from: { owner: ownerA, filename: FILENAME },
        tier: 'T2',
        reuse_notes: 'Keep auth mount + data load; add the cortex DataTable for the grid.',
        model: 'kimi-k2.6',
    });
    const out = JSON.parse(body.result.content[0].text);
    assert(out.updated === true, 'upsert not flagged');
    const get = await A.call('aimeat_app_template_get', { id: 'demo-dashboard' });
    const g = JSON.parse(get.result.content[0].text);
    assert(g.tier === 'T2' && g.model === 'kimi-k2.6', 'upsert content not applied');
    assert(g.createdAt === created, 'createdAt not preserved across upsert');
});

await test('cross-owner isolation: B sees nothing', async () => {
    const list = await B.call('aimeat_app_template_list', {});
    assert(JSON.parse(list.result.content[0].text).total === 0, 'proposal leaked to B');
    const get = await B.call('aimeat_app_template_get', { id: 'demo-dashboard' });
    assert(get.result?.isError === true, 'B could read A\'s proposal');
});

await test('discovery: aimeat_discover type=template scope=own finds it; public scope empty', async () => {
    const own = await A.call('aimeat_discover', { type: 'template', scope: 'own' });
    const ownOut = JSON.parse(own.result.content[0].text);
    const entries = ownOut.entries ?? ownOut.results ?? [];
    assert(entries.some((e: any) => e.id === 'demo-dashboard' && e.type === 'template'), `template not discovered: ${JSON.stringify(ownOut).slice(0, 300)}`);
    const pub = await A.call('aimeat_discover', { type: 'template', scope: 'public' });
    const pubOut = JSON.parse(pub.result.content[0].text);
    const pubEntries = pubOut.entries ?? pubOut.results ?? [];
    assert(!pubEntries.some((e: any) => e.id === 'demo-dashboard'), 'private proposal leaked into public discovery');
});

await test('overview surfaces the proposal in template_proposals', async () => {
    const body = await A.call('aimeat_appdev_overview', { sections: ['template_proposals'] });
    const out = JSON.parse(body.result.content[0].text);
    assert(out.template_proposals.items.some((t: any) => t.id === 'demo-dashboard' && t.tier === 'T2'), 'overview missing proposal');
});

await test('delete removes the proposal', async () => {
    const del = await A.call('aimeat_app_template_delete', { id: 'demo-dashboard' });
    assert(!del.result?.isError, 'delete failed');
    const list = await A.call('aimeat_app_template_list', {});
    assert(JSON.parse(list.result.content[0].text).total === 0, 'proposal still listed');
    const again = await A.call('aimeat_app_template_delete', { id: 'demo-dashboard' });
    assert(again.result?.isError === true, 'double delete should error');
});

// ── The HTTP routes the connector and the shell call (secaudit 2026-10 follow-up, Part B) ──
//
// aimeat_app_template_propose and aimeat_appdev_pitfall_list run their CLI dispatch definition on the
// connector. The first wrote a memory record itself under tags the list does not read, so a proposal
// made there was never listed; the second read GET /learned, which has no curated entries. Each now
// calls a route that runs the node MCP tool's own function, and these tests hold the two to the same
// answer.

const rest = (s: McpSession, path: string, opts: RequestInit = {}) =>
    json(path, { ...opts, headers: { Authorization: `Bearer ${s.token}`, ...opts.headers } });

await test('POST /v1/appdev/templates proposes through the same function, and the MCP list shows it', async () => {
    const { status, body } = await rest(A, '/v1/appdev/templates', {
        method: 'POST',
        body: JSON.stringify({
            id: 'rest-proposal', title: 'Proposed over HTTP', description: 'what the connector sends',
            derived_from: { owner: ownerA, filename: FILENAME }, tier: 'T1',
            reuse_notes: 'Keep the shell; this one came in through the route.', model: 'Claude-Opus-5.5',
        }),
    });
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body).slice(0, 250)}`);
    assert(body.data?.id === 'rest-proposal' && body.data?.updated === false, `unexpected: ${JSON.stringify(body.data)}`);
    const list = JSON.parse((await A.call('aimeat_app_template_list', {})).result.content[0].text);
    const row = list.templates.find((t: any) => t.id === 'rest-proposal');
    assert(!!row, `the route's proposal is not listed: ${JSON.stringify(list).slice(0, 250)}`);
    assert(row.model === 'claude-opus-5.5', `model not normalized: ${row.model}`);
});

await test('POST /v1/appdev/templates → 400 for another owner\'s app, 400 out of bounds, 401 without a credential', async () => {
    const foreign = await rest(B, '/v1/appdev/templates', {
        method: 'POST',
        body: JSON.stringify({
            id: 'b-claims-a', title: 'Not mine', description: 'derived from owner A',
            derived_from: { owner: ownerA, filename: FILENAME }, tier: 'T1',
            reuse_notes: 'should be refused: the app is not mine', model: 'claude-opus-5.5',
        }),
    });
    assert(foreign.status === 400 && foreign.body.error?.code === 'INVALID_INPUT', `foreign derived_from answered ${foreign.status}`);
    const listB = JSON.parse((await B.call('aimeat_app_template_list', {})).result.content[0].text);
    assert(listB.total === 0, 'B gained a proposal over A\'s app');
    const short = await rest(A, '/v1/appdev/templates', {
        method: 'POST',
        body: JSON.stringify({
            id: 'too-short', title: 'Short', description: 'reuse notes too short',
            derived_from: { owner: ownerA, filename: FILENAME }, tier: 'T1', reuse_notes: 'tiny', model: 'm',
        }),
    });
    assert(short.status === 400, `out-of-bounds body answered ${short.status}`);
    const anon = await json('/v1/appdev/templates', { method: 'POST', body: '{}' });
    assert(anon.status === 401, `no credential answered ${anon.status}`);
    const del = await A.call('aimeat_app_template_delete', { id: 'rest-proposal' });
    assert(!del.result?.isError, 'cleanup delete failed');
});

await test('GET /v1/appdev/pitfalls/index answers what aimeat_appdev_pitfall_list answers', async () => {
    for (const args of [{}, { scope: 'own' }, { scope: 'platform', limit: 5, offset: 2 }, { status: 'all', applies_to: 'auth' }]) {
        const q = new URLSearchParams(Object.entries(args).map(([k, v]) => [k, String(v)])).toString();
        const { status, body } = await rest(A, `/v1/appdev/pitfalls/index${q ? `?${q}` : ''}`);
        assert(status === 200, `index ${q} answered ${status}`);
        const tool = JSON.parse((await A.call('aimeat_appdev_pitfall_list', args)).result.content[0].text);
        assert(JSON.stringify(body.data) === JSON.stringify(tool), `index ${q} differs from the MCP tool`);
    }
    const all = await rest(A, '/v1/appdev/pitfalls/index');
    assert(all.body.data.pitfalls.some((p: any) => p.source === 'curated'), 'the curated registry is missing from the index');
    const own = await rest(A, '/v1/appdev/pitfalls/index?scope=own');
    assert(!own.body.data.pitfalls.some((p: any) => p.source === 'curated'), 'scope=own carries curated entries');
});

await test('GET /v1/appdev/pitfalls/index → 400 for an unknown scope, 401 without a credential', async () => {
    const bad = await rest(A, '/v1/appdev/pitfalls/index?scope=everyone');
    assert(bad.status === 400 && bad.body.error?.code === 'INVALID_INPUT', `unknown scope answered ${bad.status}`);
    const anon = await json('/v1/appdev/pitfalls/index');
    assert(anon.status === 401, `no credential answered ${anon.status}`);
});

console.log('\n' + '─'.repeat(40));
console.log(`App template proposals E2E: ${passed} passed, ${failed} failed of ${passed + failed}`);
if (failed > 0) process.exit(1);
console.log('✅ All template-proposal tests passed!\n');
