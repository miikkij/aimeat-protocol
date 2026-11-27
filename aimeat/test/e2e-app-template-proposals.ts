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
 *   v1.3.0 — 2026-11-27 — The recipe a template carries: proposed, read back on both lists and both
 *     gets, kept by an upsert without one, replaced and removed on PATCH /v1/appdev/templates/:id, and
 *     the PATCH taken from the owner's agent and refused to another owner and a caller without a session
 *     (wish-omistaja-tekee-omia-sovelluspohjia-ja-aloittaa-seuraavan-app).
 *   v1.2.1 — 2026-11-15 — Audit M208: after a public agent face and a bound skill, a republish's
 *     next_steps reports agent_face_present true and bound_skills_count 1.
 *   v1.2.0 — 2026-10-12 — The REST routes are called with the agent's own token from POST
 *     /v1/auth/token, the one the connector holds; the MCP OAuth token stays on /v1/mcp, because node
 *     4.0.0 refuses it on a REST route (401 INVALID_TOKEN, MCP_TOKEN_ON_REST_REMOVED_IN).
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
import { authorizeParams, mcpPkce, tokenParams } from './helpers/mcp-oauth-pkce.js';
import { ownerSignIn } from './helpers/owner-login.js';
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
    /** The agent's own REST token (POST /v1/auth/token); the MCP OAuth token stays on /v1/mcp. */
    restToken = '';
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
    const { status: gs } = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: ownerName, display_name: ownerName, password: 'Template1!' }),
    });
    assert(gs === 201, `ghii ${gs}`);
    const { body: tb } = await ownerSignIn(BASE, ownerName, 'Template1!');
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
    const pkce = mcpPkce(BASE);
    const params = new URLSearchParams({
        response_type: 'code', client_id: reg.client_id, gaii: ab.data.agent.gaii,
        signature: await signMsg(ab.data.private_key, ab.data.agent.gaii + NODE_ID + ts2), timestamp: ts2,
        ...authorizeParams(pkce),
    });
    const { body: auth } = await json(`/v1/mcp/authorize?${params}`);
    const { body: tok } = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({ grant_type: 'authorization_code', code: auth.code, client_id: reg.client_id, client_secret: reg.client_secret, ...tokenParams(pkce) }),
    });
    const session = new McpSession();
    session.token = tok.access_token;
    const ts3 = new Date().toISOString();
    const { status: rs, body: rb } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: ab.data.agent.gaii, timestamp: ts3, signature: await signMsg(ab.data.private_key, ab.data.agent.gaii + ts3) }),
    });
    assert(rs === 200 && typeof rb.data?.token === 'string', `agent token ${rs}: ${JSON.stringify(rb.error)}`);
    session.restToken = rb.data.token;
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
let ownerAToken = '';
let ownerBToken = '';

await test('Setup: two owners + agents; A publishes an app over MCP (next_steps present)', async () => {
    ({ session: A, ownerToken: ownerAToken } = await setupOwnerAgentSession(ownerA, 'tpagenta'));
    ({ session: B, ownerToken: ownerBToken } = await setupOwnerAgentSession(ownerB, 'tpagentb'));
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

await test('next_steps sees a published agent face and a bound skill after a republish', async () => {
    // The present direction of the nudge (audit M208): only the empty state was ever measured.
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerAToken}` };
    const face = await json('/v1/memory', { method: 'POST', headers: auth, body: JSON.stringify({
        key: `apps.${FILENAME}.agentface`, visibility: 'public', value: { title: 'Template Demo', sections: [] } }) });
    assert(face.status === 201, `face write ${face.status}: ${JSON.stringify(face.body)}`);
    const skill_md = `---\nname: template-demo-guide\ndescription: How to use the template demo. Use when working inside it.\nmetadata:\n  binding: app:${ownerA}/${FILENAME}\n---\n\n# Guide\nOpen it.\n`;
    const sk = await json('/v1/skills', { method: 'POST', headers: auth, body: JSON.stringify({ skill_md, visibility: 'public' }) });
    assert(sk.status === 201, `skill publish ${sk.status}: ${JSON.stringify(sk.body)}`);
    const pub = await A.call('aimeat_app_publish', {
        filename: FILENAME,
        content_base64: b64('<!doctype html><meta name="aimeat-app" content="template-demo.html"><h1>tpl demo v2</h1>'),
        name: 'Template Demo', description: 'source app for template proposal', category: 'utility', tags: ['demo'],
    });
    assert(!pub.result?.isError, `republish failed: ${JSON.stringify(pub).slice(0, 250)}`);
    const ns = JSON.parse(pub.result.content[0].text).next_steps;
    assert(ns?.agent_face_present === true && ns?.bound_skills_count === 1,
        `face ${ns?.agent_face_present}, skills ${ns?.bound_skills_count}`);
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

// The connector holds the agent's own token, never the MCP OAuth token: node 4.0.0 refuses that one
// on a REST route (401 INVALID_TOKEN, MCP_TOKEN_ON_REST_REMOVED_IN).
const rest = (s: McpSession, path: string, opts: RequestInit = {}) =>
    json(path, { ...opts, headers: { Authorization: `Bearer ${s.restToken}`, ...opts.headers } });

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

// ── The recipe a template carries (wish-omistaja-tekee-omia-sovelluspohjia-ja-aloittaa-seuraavan-app) ──
//
// A template names what the next build starts from: the look, the genre, the frame, the needs, the
// moments, where the data is kept and the criteria. It is written by the propose MCP tool and the POST
// route, read back by both lists and both gets, and replaced or removed on PATCH.

const RECIPE = {
    look: 'kit-mappi', genre: 'genre-workbench', frame: 'tool',
    screens: [{ name: 'List', from: 'genre-workbench', note: 'Newest first.' }],
    needs: ['session', 'ai', 'member:use'],
    moments: ['ask:signIn', 'propose:draft', 'handoff:say'],
    data: [{ what: 'errands', where: 'memory key errands.list' }],
    scopes: ['memory:read'],
    criteria: [{ text: 'A new errand shows without a reload.', check: 'scenario' }],
};
const RECIPE_ID = 'recipe-proposal';
const ownerRest = (token: string, path: string, opts: RequestInit = {}) =>
    json(path, { ...opts, headers: { Authorization: `Bearer ${token}`, ...opts.headers } });
const patchRecipe = (token: string | null, id: string, recipe: unknown) =>
    json(`/v1/appdev/templates/${id}`, {
        method: 'PATCH',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: JSON.stringify({ recipe }),
    });
const proposeRecipe = (extra: Record<string, unknown>) => A.call('aimeat_app_template_propose', {
    id: RECIPE_ID, title: 'Errands workbench', description: 'A list of errands with an AI draft.',
    derived_from: { owner: ownerA, filename: FILENAME },
    reuse_notes: 'Keep the list and the draft moment; swap the fields.', model: 'claude-opus-5.5',
    ...extra,
});

await test('recipe: proposed over MCP, read back on the REST list, the REST get and the MCP get and list', async () => {
    const p = await proposeRecipe({ recipe: RECIPE });
    assert(!p.result?.isError, `propose with a recipe failed: ${JSON.stringify(p).slice(0, 300)}`);

    const list = await ownerRest(ownerAToken, '/v1/appdev/templates');
    const row = list.body.data?.templates?.find((t: any) => t.id === RECIPE_ID);
    assert(row?.recipe?.frame === 'tool' && row.recipe.moments?.join(',') === RECIPE.moments.join(','),
        `REST list recipe: ${JSON.stringify(row?.recipe)}`);

    const one = await ownerRest(ownerAToken, `/v1/appdev/templates/${RECIPE_ID}`);
    assert(one.status === 200 && one.body.data.template.recipe?.criteria?.[0]?.check === 'scenario',
        `REST get recipe: ${one.status} ${JSON.stringify(one.body.data?.template?.recipe)}`);
    assert(/AIMEAT\.atelier\.app\(\)/.test(one.body.data.how_to_start) && /"tool"/.test(one.body.data.how_to_start),
        `REST how_to_start does not name the frame: ${one.body.data.how_to_start}`);

    const g = JSON.parse((await A.call('aimeat_app_template_get', { id: RECIPE_ID })).result.content[0].text);
    assert(g.recipe?.look === 'kit-mappi' && g.recipe.needs?.includes('member:use'), `MCP get recipe: ${JSON.stringify(g.recipe)}`);
    assert(g.how_to_start === one.body.data.how_to_start, `MCP and REST how_to_start differ:\n${g.how_to_start}\n${one.body.data.how_to_start}`);

    const ml = JSON.parse((await A.call('aimeat_app_template_list', {})).result.content[0].text);
    assert(ml.templates.find((t: any) => t.id === RECIPE_ID)?.recipe?.genre === 'genre-workbench', 'MCP list leaves the recipe out');
});

await test('recipe: an upsert without a recipe keeps it; a bad recipe is refused', async () => {
    const p = await proposeRecipe({ title: 'Errands workbench v2' });
    assert(!p.result?.isError, `upsert failed: ${JSON.stringify(p).slice(0, 300)}`);
    const g = JSON.parse((await A.call('aimeat_app_template_get', { id: RECIPE_ID })).result.content[0].text);
    assert(g.title === 'Errands workbench v2' && g.recipe?.frame === 'tool', `recipe lost on upsert: ${JSON.stringify(g.recipe)}`);
    const bad = await rest(A, '/v1/appdev/templates', {
        method: 'POST',
        body: JSON.stringify({ id: RECIPE_ID, title: 'Bad recipe', description: 'a moment that is not one',
            derived_from: { owner: ownerA, filename: FILENAME }, reuse_notes: 'should be refused for its recipe',
            model: 'claude-opus-5.5', recipe: { moments: ['wait:forever'] } }),
    });
    // The contract's request validation answers before the route does (VALIDATION_ERROR); either names the field.
    assert(bad.status === 400 && /recipe\.moments/.test(bad.body.error?.message ?? ''), `bad recipe answered ${bad.status}: ${JSON.stringify(bad.body.error)}`);
});

await test('PATCH /v1/appdev/templates/:id replaces the recipe, and null removes it', async () => {
    const r = await patchRecipe(ownerAToken, RECIPE_ID, { frame: 'game', moments: ['ask:signIn'] });
    assert(r.status === 200 && r.body.data?.recipe?.frame === 'game', `PATCH answered ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
    const one = await ownerRest(ownerAToken, `/v1/appdev/templates/${RECIPE_ID}`);
    const rec = one.body.data.template.recipe;
    assert(rec?.frame === 'game' && rec.look === undefined && rec.moments?.join(',') === 'ask:signIn', `not replaced: ${JSON.stringify(rec)}`);
    assert(/"game"/.test(one.body.data.how_to_start), 'how_to_start does not follow the new recipe');

    const bad = await patchRecipe(ownerAToken, RECIPE_ID, { frame: 'poster' });
    assert(bad.status === 400 && /recipe\.frame/.test(bad.body.error?.message ?? ''), `bad PATCH answered ${bad.status}: ${JSON.stringify(bad.body.error)}`);

    const cleared = await patchRecipe(ownerAToken, RECIPE_ID, null);
    assert(cleared.status === 200 && cleared.body.data?.recipe === null, `PATCH null answered ${cleared.status}: ${JSON.stringify(cleared.body).slice(0, 300)}`);
    const after = await ownerRest(ownerAToken, `/v1/appdev/templates/${RECIPE_ID}`);
    assert(after.body.data.template.recipe === undefined, `recipe still there: ${JSON.stringify(after.body.data.template.recipe)}`);
    assert(!/AIMEAT\.atelier/.test(after.body.data.how_to_start), 'how_to_start still names the removed recipe');
    const g = JSON.parse((await A.call('aimeat_app_template_get', { id: RECIPE_ID })).result.content[0].text);
    assert(g.title === 'Errands workbench v2', 'PATCH changed more than the recipe');

    const missing = await patchRecipe(ownerAToken, 'no-such-template', { frame: 'tool' });
    assert(missing.status === 404 && missing.body.error?.code === 'NOT_FOUND', `unknown id answered ${missing.status}`);
});

await test('PATCH /v1/appdev/templates/:id: the owner\'s agent may, another owner → 404, no session → 401', async () => {
    await patchRecipe(ownerAToken, RECIPE_ID, { frame: 'stage' });
    // The owner's own agent holds memory:write and can already replace the recipe by proposing the
    // template again, so the PATCH takes it under the guards POST and DELETE have.
    const agent = await patchRecipe(A.restToken, RECIPE_ID, { frame: 'tool' });
    assert(agent.status === 200 && agent.body.data?.recipe?.frame === 'tool', `the owner's agent answered ${agent.status}: ${JSON.stringify(agent.body).slice(0, 200)}`);
    // Another owner reaches only their own templates, where this id does not exist: 404, and A's
    // recipe is unchanged (read back below).
    const other = await patchRecipe(ownerBToken, RECIPE_ID, { frame: 'game' });
    assert(other.status === 404, `another owner answered ${other.status}`);
    const anon = await patchRecipe(null, RECIPE_ID, { frame: 'game' });
    assert(anon.status === 401, `no session answered ${anon.status}`);
    const g = JSON.parse((await A.call('aimeat_app_template_get', { id: RECIPE_ID })).result.content[0].text);
    assert(g.recipe?.frame === 'tool', `a refused PATCH changed the recipe: ${JSON.stringify(g.recipe)}`);
    const del = await A.call('aimeat_app_template_delete', { id: RECIPE_ID });
    assert(!del.result?.isError, 'cleanup delete failed');
});

console.log('\n' + '─'.repeat(40));
console.log(`App template proposals E2E: ${passed} passed, ${failed} failed of ${passed + failed}`);
if (failed > 0) process.exit(1);
console.log('✅ All template-proposal tests passed!\n');
