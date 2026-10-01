/**
 * @file e2e-home-journey.ts
 * @description E2E for the person's path (services/journey-state.ts): the seven stages on GET
 *   /v1/home/state, the person's own words written by their AI into `journey.state`, and the
 *   handbook that names the guided-journey skill while the path is not walked.
 *
 *   Happy path: a new account is at stage `ai`; an MCP session marks the AI connected; the AI writes
 *   what the person wants, their road and a declined stage, and the page reads it back; the first
 *   note moves the account past `first-result`.
 *
 *   Failure modes covered:
 *     - an agent token cannot read its owner's home state (the path is the person's, not the agent's);
 *     - another owner's home never shows this owner's words;
 *     - a record written badly by hand (unknown road, unknown stage) is ignored, not trusted;
 *     - once every stage is done or declined, the handbook says nothing about the path.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=e2e-home-journey
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const stamp = Date.now() % 100000;
const SECTION = 'Where this person is on their path';

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
const auth = (token: string, opts: RequestInit = {}): RequestInit =>
    ({ ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${token}` } });

async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

function parseSSE(text: string): any[] {
    const out: any[] = [];
    for (const evt of text.split('\n\n')) {
        let data = '';
        for (const line of evt.trim().split('\n')) if (line.startsWith('data: ')) data += line.slice(6);
        if (data) { try { out.push(JSON.parse(data)); } catch { /* a partial frame */ } }
    }
    return out;
}

/** One MCP session per call of the factory. */
function mcpClient(token: string) {
    let sessionId = '';
    return async function rpc(method: string, params: Record<string, any> = {}, id = 1) {
        const res = await fetch(`${BASE}/v1/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
                Authorization: `Bearer ${token}`,
                ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        });
        const sid = res.headers.get('mcp-session-id');
        if (sid) sessionId = sid;
        const ct = res.headers.get('content-type') ?? '';
        const body = ct.includes('text/event-stream') ? (parseSSE(await res.text()).find(m => m.id === id) ?? {}) : await res.json() as any;
        return body;
    };
}
const toolText = (body: any): string => body?.result?.content?.[0]?.text ?? '';

/** An owner, one agent of theirs, and an MCP token for that agent. */
async function provision(tag: string) {
    const ownerName = `journey${tag}${stamp}`;
    const ghii = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: ownerName, display_name: 'Journey Test', password: 'Journey12345' }) });
    assert(ghii.status === 201, `ghii ${ghii.status}: ${JSON.stringify(ghii.body)}`);
    let ts = new Date().toISOString();
    const ownerTok = await json('/v1/auth/token', {
        method: 'POST', body: JSON.stringify({ owner: ownerName, timestamp: ts, signature: await signMsg(ghii.body.data.private_key, ownerName + NODE_ID + ts) }),
    });
    assert(ownerTok.body.ok === true, `owner token: ${JSON.stringify(ownerTok.body.error)}`);
    const ownerToken = ownerTok.body.data.token as string;

    const agent = await json('/v1/agents', auth(ownerToken, {
        method: 'POST', body: JSON.stringify({ name: 'journeyai', owner: ownerName, capabilities: ['memory'], model: 'claude-sonnet-5-5' }),
    }));
    assert(agent.status === 201, `agent ${agent.status}: ${JSON.stringify(agent.body)}`);
    const agentGaii = agent.body.data.agent.gaii;
    const agentPriv = agent.body.data.private_key;

    const reg = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'Journey E2E', redirect_uris: [] }) });
    assert(reg.status === 201, `mcp register ${reg.status}`);
    ts = new Date().toISOString();
    const params = new URLSearchParams({
        response_type: 'code', client_id: reg.body.client_id, gaii: agentGaii,
        signature: await signMsg(agentPriv, agentGaii + NODE_ID + ts), timestamp: ts,
    });
    const authz = await json(`/v1/mcp/authorize?${params}`);
    assert(typeof authz.body.code === 'string', 'has an auth code');
    const tok = await json('/v1/mcp/token', {
        method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code: authz.body.code, client_id: reg.body.client_id, client_secret: reg.body.client_secret }),
    });
    assert(tok.status === 200, `mcp token ${tok.status}`);
    return { ownerName, ownerToken, mcpToken: tok.body.access_token as string };
}

async function journeyOf(token: string) {
    const { status, body } = await json('/v1/home/state', auth(token));
    assert(status === 200, `home state ${status}: ${JSON.stringify(body.error)}`);
    return body.data.journey;
}
const stage = (j: any, id: string) => j.stages.find((s: any) => s.id === id);

async function connect(mcpToken: string) {
    const rpc = mcpClient(mcpToken);
    await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'Journey E2E', version: '1.0.0' } });
    return rpc;
}
async function writeOwnerMemory(rpc: Awaited<ReturnType<typeof connect>>, key: string, value: unknown, id: number) {
    const body = await rpc('tools/call', { name: 'aimeat_memory_write', arguments: { key, owner_scope: true, visibility: 'owner', value } }, id);
    assert(body.result?.isError !== true, `write ${key} refused: ${toolText(body)}`);
}
async function handbook(rpc: Awaited<ReturnType<typeof connect>>, id: number) {
    return toolText(await rpc('tools/call', { name: 'aimeat_handbook_get', arguments: {} }, id));
}

console.log('\n=== Home journey E2E (the seven stages and the person\'s own words) ===\n');

const me = await provision('a');
const other = await provision('b');

await test('1. a new account is at the first stage, with seven stages open', async () => {
    const j = await journeyOf(me.ownerToken);
    assert(Array.isArray(j.stages) && j.stages.length === 7, `seven stages: ${JSON.stringify(j.stages)}`);
    assert(j.stages.every((s: any) => !s.done && !s.declined), `none done: ${JSON.stringify(j.stages)}`);
    assert(j.next === 'ai', `next is ai, got ${j.next}`);
    assert(j.want === null && j.road === null, 'no words of theirs yet');
});

const rpc = await connect(me.mcpToken);

await test('2. an MCP session marks the AI connected, and the handbook names the guided-journey skill', async () => {
    const j = await journeyOf(me.ownerToken);
    assert(stage(j, 'ai').done && stage(j, 'connect').done, `ai and connect done: ${JSON.stringify(j.stages)}`);
    assert(j.next === 'first-result', `next is first-result, got ${j.next}`);
    const text = await handbook(rpc, 2);
    assert(text.includes(SECTION), 'the handbook carries the path section');
    assert(text.includes('aimeat-guided-journey'), 'and names the skill');
    assert(text.includes('[open] a first real result'), 'and the open stage');
});

await test('3. the skill the handbook names exists on the node', async () => {
    const body = await rpc('tools/call', { name: 'aimeat_skill_get', arguments: { name: 'aimeat-guided-journey' } }, 3);
    assert(toolText(body).includes('Walking a person along their path'), `skill body: ${toolText(body).slice(0, 200)}`);
});

await test('4. the AI writes what the person wants, their road and a declined stage; the page reads them', async () => {
    await writeOwnerMemory(rpc, 'journey.state', { want: 'run my bakery orders', road: 'free', declined: [{ stage: 'organise', at: '2026-10-01' }] }, 4);
    const j = await journeyOf(me.ownerToken);
    assert(j.want === 'run my bakery orders', `want: ${j.want}`);
    assert(j.road === 'free', `road: ${j.road}`);
    assert(stage(j, 'organise').declined === true, 'organise declined');
});

await test('5. the first note moves the account past the first result, and next skips the declined stage', async () => {
    await writeOwnerMemory(rpc, 'home.first-note', { title: 'Oven', text: 'The oven is serviced in March.' }, 5);
    const j = await journeyOf(me.ownerToken);
    assert(stage(j, 'first-result').done === true, 'first-result done');
    assert(j.next === 'apps', `organise is declined, so next is apps, got ${j.next}`);
});

await test('6. FAILURE: an agent token cannot read its owner\'s home state', async () => {
    const { status } = await json('/v1/home/state', auth(me.mcpToken));
    assert(status === 401 || status === 403, `agent must be refused, got ${status}`);
});

await test('7. FAILURE: another owner\'s home never shows this owner\'s words', async () => {
    const j = await journeyOf(other.ownerToken);
    assert(j.want === null && j.road === null, `other owner sees nothing of mine: ${JSON.stringify(j)}`);
    assert(j.next === 'ai', `other owner is at the start, got ${j.next}`);
});

await test('8. FAILURE: a badly written record is ignored rather than trusted', async () => {
    const orpc = await connect(other.mcpToken);
    await writeOwnerMemory(orpc, 'journey.state', { road: 'teleport', declined: [{ stage: 'moon' }] }, 8);
    const j = await journeyOf(other.ownerToken);
    assert(j.road === null, `unknown road ignored, got ${j.road}`);
    assert(j.stages.every((s: any) => !s.declined), 'unknown stage ignored');
});

await test('9. once every stage is done or declined, the handbook says nothing about the path', async () => {
    await writeOwnerMemory(rpc, 'journey.state', {
        want: 'run my bakery orders', road: 'free',
        declined: ['organise', 'apps', 'agents', 'share'].map(s => ({ stage: s, at: '2026-10-01' })),
    }, 9);
    const j = await journeyOf(me.ownerToken);
    assert(j.next === null, `nothing left, got ${j.next}`);
    const text = await handbook(rpc, 10);
    assert(!text.includes(SECTION), 'the path section is gone');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
