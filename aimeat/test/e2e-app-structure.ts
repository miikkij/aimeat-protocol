/**
 * @file e2e-app-structure.ts
 * @description An app's structure and its plan, from the first moment of building: the AI starts the
 *   plan before any code, the person's choice waits for the AI and stays the person's when the AI
 *   builds it, the AI's own choice is built at once, a value the node does not offer is refused with
 *   the values it does, a stranger and an agent without app:write are refused, the owner lists the
 *   apps they started, and the plan goes with the app; over REST and through aimeat_app_manage on the
 *   node's MCP server.
 * @usage pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-app-structure
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (wish-sovelluksen-rakenne-ja-tila-sivu-luonnoksesta-asti-josta-voi).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
ed.hashes.sha512 = m => new Uint8Array(createHash('sha512').update(m).digest());

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}: ${(e as Error).message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function setupOwner(label: string) {
    const name = `st${label}${Date.now().toString(36)}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'ST', password: 'StTest1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1200));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'ST', password: 'StTest1234' }) });
    }
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const tok = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: name, password: 'StTest1234' }) });
    assert(tok.status === 200, `login ${tok.status}`);
    return { name, token: tok.body.data.token as string };
}

async function makeAgent(owner: { token: string; name: string }, scopes: string[]): Promise<string> {
    const name = `st${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1000)}`;
    const reg = await json('/v1/agents', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ name, owner: owner.name, scopes }) });
    assert(reg.status === 201, `agent ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const timestamp = new Date().toISOString();
    const sig = await ed.signAsync(new TextEncoder().encode(gaii + timestamp), Buffer.from(reg.body.data.private_key, 'base64'));
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature: Buffer.from(sig).toString('base64') }) });
    assert(tok.status === 200, `agent token ${tok.status}`);
    return tok.body.data.token as string;
}

interface McpSession { token: string; sessionId?: string }
let rpcId = 0;
async function mcpRpc(session: McpSession, method: string, params: Record<string, any> = {}): Promise<any> {
    const id = ++rpcId;
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${session.token}`,
            ...(session.sessionId ? { 'mcp-session-id': session.sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) session.sessionId = sid;
    if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
        const msgs = (await res.text()).split('\n').filter(l => l.startsWith('data: '))
            .map(l => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean);
        return msgs.find(m => m.id === id) ?? msgs[0] ?? {};
    }
    return await res.json();
}
async function callTool(token: string, name: string, args: Record<string, unknown>) {
    const session: McpSession = { token };
    await mcpRpc(session, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'e2e-app-structure', version: '1.0.0' } });
    const body = await mcpRpc(session, 'tools/call', { name, arguments: args });
    const text: string = body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body ?? {});
    let data: any;
    try { data = JSON.parse(text); } catch { data = { _text: text }; }
    return { isError: body?.result?.isError === true || body?.error !== undefined, data, text };
}

const html = (s: string) => Buffer.from(`<!doctype html><meta name="viewport" content="width=device-width"><h1>${s}</h1>`).toString('base64');
const stepOf = (data: any, id: string) => (data.steps as any[]).find(s => s.id === id);

console.log('\n=== AIMEAT app structure E2E ===\n');

let owner: Awaited<ReturnType<typeof setupOwner>>;
let stranger: Awaited<ReturnType<typeof setupOwner>>;
let ai: string;
let readOnlyAgent: string;
const APP = 'structure-demo.html';
const path = () => `/v1/apps/${owner.name}/${APP}/structure`;

await test('setup: an owner, the owner\'s AI with app:write, one without it, and a stranger', async () => {
    owner = await setupOwner('own');
    stranger = await setupOwner('str');
    ai = await makeAgent(owner, ['app:write', 'memory:read']);
    readOnlyAgent = await makeAgent(owner, ['memory:read']);
});

await test('FAILURE: before anything is started there is no structure, and the answer says how to start one', async () => {
    const r = await json(path(), { headers: auth(owner.token) });
    assert(r.status === 404, `expected 404, got ${r.status}`);
    assert(String(r.body?.error?.message).includes('PUT'), `the refusal names the start: ${JSON.stringify(r.body?.error)}`);
});

await test('the AI starts the plan before any code, and the page exists from then on', async () => {
    const r = await json(path(), { method: 'PUT', headers: auth(ai), body: JSON.stringify({ name: 'Talkoolista', purpose: 'Members sign up for shifts.', now: 'Asking about the data' }) });
    assert(r.status === 201, `expected 201, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const d = r.body.data;
    assert(d.published === false && d.has_draft === false, 'nothing is built or published');
    assert(String(d.page_url).includes(`/v1/appcat/structure?app=${encodeURIComponent(`${owner.name}/${APP}`)}`), `page_url: ${d.page_url}`);
    assert(stepOf(d, 'purpose').state === 'fine', 'the purpose is written');
    assert(stepOf(d, 'data').state === 'missing', 'the data is not stated yet');
    assert(stepOf(d, 'layout').state === 'optional' && stepOf(d, 'look').state === 'optional', 'layout and look are optional');
    assert(stepOf(d, 'build').state === 'progress', 'the work has started');
    assert(stepOf(d, 'visibility').state === 'missing', 'visibility waits for a decision');
    assert(d.steps.length === 8 && d.total === 8, `eight steps (got ${d.steps.length})`);
});

await test('the person picks a look on the page: it waits for the AI and the step says so', async () => {
    const r = await json(path(), { method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ choices: { look: { value: 'workbench' } } }) });
    assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const c = r.body.data.plan.choices.look;
    assert(c.value === 'workbench' && c.by === 'owner' && c.state === 'waiting', `the choice: ${JSON.stringify(c)}`);
    assert(stepOf(r.body.data, 'look').state === 'progress', 'the look step is in progress');
    assert(String(stepOf(r.body.data, 'look').said).includes('done'), 'the AI is told what to do');
});

await test('the AI builds it and confirms it: the choice is done and stays the person\'s', async () => {
    const r = await json(path(), { method: 'PUT', headers: auth(ai), body: JSON.stringify({ choices: { look: { value: 'workbench', state: 'done' } } }) });
    assert(r.status === 200, `expected 200, got ${r.status}`);
    const c = r.body.data.plan.choices.look;
    assert(c.by === 'owner' && c.state === 'done', `the choice: ${JSON.stringify(c)}`);
    assert(stepOf(r.body.data, 'look').state === 'fine', 'the look step is done');
});

await test('the AI\'s own choice, with its reason, is built at once and says the AI chose it', async () => {
    const r = await json(path(), { method: 'PUT', headers: auth(ai), body: JSON.stringify({ choices: { layout: { value: 'work-queue', note: 'The queue is what people do here.' }, nav: { value: 'bottom-bar' } } }) });
    assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const c = r.body.data.plan.choices;
    assert(c.layout.by === 'ai' && c.layout.state === 'done' && c.layout.note.includes('queue'), `layout: ${JSON.stringify(c.layout)}`);
    assert(c.look.value === 'workbench', 'the look stays as it was');
    assert(stepOf(r.body.data, 'layout').state === 'fine', 'the layout step is done');
});

await test('FAILURE: a layout the node does not offer is refused, and the refusal lists the ones it does', async () => {
    const r = await json(path(), { method: 'PUT', headers: auth(ai), body: JSON.stringify({ choices: { layout: { value: 'carousel-of-doom' } } }) });
    assert(r.status === 400, `expected 400, got ${r.status}`);
    assert(String(r.body?.error?.message).includes('dashboard'), `the refusal names the layouts: ${JSON.stringify(r.body?.error)}`);
});

await test('FAILURE: an unknown choice key is refused before anything is written', async () => {
    const before = (await json(path(), { headers: auth(owner.token) })).body.data.plan.revision;
    const r = await json(path(), { method: 'PUT', headers: auth(ai), body: JSON.stringify({ choices: { colour: { value: 'red' } } }) });
    assert(r.status === 400, `expected 400, got ${r.status}`);
    const after = (await json(path(), { headers: auth(owner.token) })).body.data.plan.revision;
    assert(before === after, `nothing was written (revision ${before} → ${after})`);
});

await test('FAILURE: a write on an old revision is refused with the plan as it stands', async () => {
    const r = await json(path(), { method: 'PUT', headers: auth(ai), body: JSON.stringify({ now: 'x', expected_revision: 1 }) });
    assert(r.status === 409 && r.body?.error?.code === 'REVISION_MISMATCH', `expected 409 REVISION_MISMATCH, got ${r.status} ${r.body?.error?.code}`);
});

await test('FAILURE: a stranger can neither read nor write somebody else\'s plan', async () => {
    const g = await json(`/v1/apps/${owner.name}/${APP}/structure`, { headers: auth(stranger.token) });
    assert(g.status === 403, `read: expected 403, got ${g.status}`);
    const p = await json(`/v1/apps/${owner.name}/${APP}/structure`, { method: 'PUT', headers: auth(stranger.token), body: JSON.stringify({ choices: { look: { value: 'flat' } } }) });
    assert(p.status === 403, `write: expected 403, got ${p.status}`);
});

await test('FAILURE: the owner\'s agent without app:write is refused, on the plan and on the list', async () => {
    const r = await json(`/v1/apps/${owner.name}/${APP}/structure`, { method: 'PUT', headers: auth(readOnlyAgent), body: JSON.stringify({ now: 'x' }) });
    assert(r.status === 403, `write: expected 403, got ${r.status}`);
    const l = await json('/v1/app-plans', { headers: auth(readOnlyAgent) });
    assert(l.status === 403, `list: expected 403, got ${l.status}`);
});

await test('FAILURE: a plan write whose purpose is past its length is refused by the schema, before the service', async () => {
    const r = await json(path(), { method: 'PUT', headers: auth(ai), body: JSON.stringify({ purpose: 'x'.repeat(801) }) });
    assert(r.status === 400, `expected 400, got ${r.status}`);
});

await test('the owner lists the apps they started, with the one not published first', async () => {
    const r = await json('/v1/app-plans', { headers: auth(owner.token) });
    assert(r.status === 200, `expected 200, got ${r.status}`);
    const row = (r.body.data.plans as any[]).find(p => p.filename === APP);
    assert(row && row.published === false && row.name === 'Talkoolista' && row.total === 8, `the row: ${JSON.stringify(row)}`);
    const theirs = await json('/v1/app-plans', { headers: auth(stranger.token) });
    assert(!(theirs.body.data.plans as any[]).some(p => p.filename === APP), 'the stranger does not see it');
});

await test('through aimeat_app_manage: structure, structure_set and plans answer what REST answers', async () => {
    const set = await callTool(ai, 'aimeat_app_manage', { action: 'structure_set', filename: APP, data: { summary: 'Shifts are shared, sign-ups are each member\'s own.', personalData: 'yes' } });
    assert(!set.isError, `structure_set: ${set.text}`);
    assert(stepOf(set.data, 'data').state === 'fine', `the data step: ${JSON.stringify(stepOf(set.data, 'data'))}`);
    const read = await callTool(ai, 'aimeat_app_manage', { action: 'structure', filename: APP });
    assert(!read.isError && read.data.plan.data.personalData === 'yes', `structure: ${read.text.slice(0, 200)}`);
    assert(stepOf(read.data, 'requirements').detail.personal === true, 'the requirements step knows about personal data');
    const plans = await callTool(ai, 'aimeat_app_manage', { action: 'plans' });
    assert(!plans.isError && plans.data.plans.some((p: any) => p.filename === APP), `plans: ${plans.text.slice(0, 200)}`);
    const bad = await callTool(ai, 'aimeat_app_manage', { action: 'structure_set', filename: APP, choices: { look: { value: 'no-such-look' } } });
    assert(bad.isError && bad.text.includes('INVALID_INPUT'), `a bad look is refused: ${bad.text.slice(0, 200)}`);
});

await test('after the first publish the steps read the app itself', async () => {
    const pub = await json('/v1/apps', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ filename: APP, name: 'Talkoolista', description: 'structure e2e', content: html('v1') }) });
    assert(pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
    const r = await json(path(), { headers: auth(owner.token) });
    assert(r.status === 200 && r.body.data.published === true, `published: ${JSON.stringify(r.body.data?.published)}`);
    assert(stepOf(r.body.data, 'visibility').state === 'fine', 'the visibility is the app\'s listing now');
    assert(stepOf(r.body.data, 'build').detail.version === 1, 'the build step says version 1');
    assert(r.body.data.plan.choices.look.value === 'workbench', 'the choices stay with the plan');
});

await test('deleting the app takes its plan with it', async () => {
    const del = await json(`/v1/apps/${APP}`, { method: 'DELETE', headers: auth(owner.token) });
    assert(del.status === 200, `delete ${del.status}: ${JSON.stringify(del.body?.error)}`);
    const r = await json(path(), { headers: auth(owner.token) });
    assert(r.status === 404, `expected 404 after the delete, got ${r.status}`);
});

await test('cleanup: the test accounts go', async () => {
    for (const p of [owner, stranger]) await json(`/v1/owners/${p.name}`, { method: 'DELETE', headers: auth(p.token) });
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
