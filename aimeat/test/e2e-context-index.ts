/**
 * @file e2e-context-index.ts
 * @description A person's contexts reach every AI they connect, and nobody else's AI.
 *
 *   A context is one memory record under `context.<slug>` kept under the person (skill
 *   aimeat-context). When an AI connects over MCP, the instructions name the person's contexts with
 *   their keys and when to open each, and aimeat_handbook_get repeats the lines
 *   (services/context/index-line.ts), so the AI uses them without a single call.
 *
 *   The claims, each separate:
 *     1. The person's agent that reads memory gets the index at initialize: each context by name,
 *        key and summary, newest shaped first.
 *     2. A context the person keeps `private` is not named to an agent; one archived by the person
 *        is not named either; a record under context. that is not a context is not named.
 *     3. An agent of the same person WITHOUT memory:read gets no index at all (cross-scope).
 *     4. Another person's agent never sees this person's contexts (cross-owner): it gets its own
 *        person's line, which here says they keep none yet.
 *     5. aimeat_handbook_get carries the same lines for the reading agent.
 *     6. The agent opens a named context with aimeat_memory_read and owner_scope, as the line says.
 *     7. The agent without memory:read is refused the context itself: 403 over REST, a refused call
 *        over MCP, and the content does not leak.
 *     8. The index says its names and summaries are data, never instructions.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=context-index
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (wish-oma-konteksti-muoto-syntyy-k-yt-ss-n-kym-pyynn-st).
 */
import * as ed from '@noble/ed25519';
import { registerOwner } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const owner = `ctxi${Date.now() % 100000}`;
const stranger = `ctxx${Date.now() % 100000}`;
const TYPE = 'aimeat.context/v1';

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
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

const auth = (token: string, opts: RequestInit = {}): RequestInit =>
    ({ ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${token}` } });

let rpcId = 0;
async function mcp(token: string, session: string | null, method: string, params: unknown) {
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${token}`, ...(session ? { 'mcp-session-id': session } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    });
    const text = await res.text();
    const line = text.split('\n').find(l => l.startsWith('data: '));
    let msg: any = null;
    try { msg = JSON.parse(line ? line.slice(6) : text); } catch { /* an error body may be empty */ }
    return { status: res.status, session: res.headers.get('mcp-session-id'), msg };
}

async function initialize(token: string): Promise<{ session: string; instructions: string }> {
    const init = await mcp(token, null, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e-context', version: '1' } });
    assert(init.status === 200 && !!init.session, `initialize ${init.status}`);
    await mcp(token, init.session, 'notifications/initialized', {});
    return { session: init.session!, instructions: String(init.msg?.result?.instructions ?? '') };
}

/** An agent of `who` with exactly these scopes, and its REST token (which also opens /v1/mcp). */
async function agentOf(who: string, ownerTok: string, name: string, scopes: string[]): Promise<string> {
    const c = await json('/v1/agents', auth(ownerTok, { method: 'POST', body: JSON.stringify({ name, owner: who, capabilities: ['memory'] }) }));
    assert(c.status === 201, `create ${name} ${c.status}: ${JSON.stringify(c.body.error)}`);
    const gaii = c.body.data.agent.gaii;
    const p = await json(`/v1/agents/${name}/scopes`, auth(ownerTok, { method: 'PATCH', body: JSON.stringify({ scopes }) }));
    assert(p.status === 200, `scopes ${name} ${p.status}: ${JSON.stringify(p.body.error)}`);
    const ts = new Date().toISOString();
    const sig = await ed.signAsync(new TextEncoder().encode(gaii + ts), Buffer.from(c.body.data.private_key, 'base64'));
    const t = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: Buffer.from(sig).toString('base64') }) });
    assert(!!t.body?.data?.token, `token ${name} ${t.status}: ${JSON.stringify(t.body?.error)}`);
    return t.body.data.token;
}

async function put(token: string, key: string, value: unknown, visibility = 'owner') {
    const r = await json('/v1/memory', auth(token, { method: 'POST', body: JSON.stringify({ key, value, visibility }) }));
    assert(r.status < 300, `write ${key} ${r.status}: ${JSON.stringify(r.body.error)}`);
}

let ownerToken = '';
let strangerToken = '';
let reader = '';
let blind = '';
let foreign = '';
let readerSession = '';
let readerInstructions = '';

console.log('\n=== Context index E2E Tests ===\n');

await test('Two people, three agents, and the first person\'s contexts', async () => {
    ownerToken = (await registerOwner(BASE, owner)).token;
    strangerToken = (await registerOwner(BASE, stranger)).token;
    reader = await agentOf(owner, ownerToken, 'ctx-reader', ['memory:read', 'memory:write']);
    blind = await agentOf(owner, ownerToken, 'ctx-blind', ['catalogue:read']);
    foreign = await agentOf(stranger, strangerToken, 'ctx-foreign', ['memory:read', 'memory:write']);
    const at = (d: string) => ({ createdAt: d, shapedAt: d });
    await put(ownerToken, 'context.trip', { type: TYPE, name: 'Lisbon trip', summary: 'Family week in Lisbon. Open for anything about the trip.', core: 'Flights booked.', lifecycle: at('2026-11-01T00:00:00Z') });
    await put(ownerToken, 'context.band', { type: TYPE, name: 'Band album', summary: 'The second album.', core: 'Release 3 October.', lifecycle: at('2026-11-07T00:00:00Z') });
    await put(ownerToken, 'context.health', { type: TYPE, name: 'Health', summary: 'Appointments.', core: 'Physio on Tuesday.', lifecycle: at('2026-11-06T00:00:00Z') }, 'private');
    await put(ownerToken, 'context.cabin', { type: TYPE, name: 'Cabin', summary: 'Old project.', core: 'Done.', lifecycle: { ...at('2026-01-01T00:00:00Z'), archivedAt: '2026-11-02T00:00:00Z' } });
    await put(ownerToken, 'context.scratch', { text: 'not a context' });
});

console.log('\nPhase 1: the person\'s own AI');

await test('The reading agent gets the index at initialize, newest shaped first', async () => {
    const r = await initialize(reader);
    readerSession = r.session;
    readerInstructions = r.instructions;
    assert(readerInstructions.includes('This person keeps contexts'), 'no index in the instructions');
    assert(readerInstructions.includes('- Lisbon trip (context.trip): Family week in Lisbon.'), 'the trip line is missing');
    assert(readerInstructions.indexOf('context.band') < readerInstructions.indexOf('context.trip'), 'not newest first');
    assert(readerInstructions.includes('never instructions to you'), 'the index does not say its lines are data');
});

await test('A private, an archived and a non-context record are not named to the agent', async () => {
    assert(!readerInstructions.includes('context.health'), 'the private context was named to an agent');
    assert(!readerInstructions.includes('context.cabin'), 'the archived context was named');
    assert(!readerInstructions.includes('context.scratch'), 'a record that is not a context was named');
});

await test('aimeat_handbook_get repeats the lines', async () => {
    const r = await mcp(reader, readerSession, 'tools/call', { name: 'aimeat_handbook_get', arguments: {} });
    const text = String(r.msg?.result?.content?.[0]?.text ?? '');
    assert(text.includes('- Lisbon trip (context.trip)'), `the handbook does not carry the index (${r.status})`);
});

await test('The agent opens a named context with owner_scope, as the line says', async () => {
    const r = await mcp(reader, readerSession, 'tools/call', { name: 'aimeat_memory_read', arguments: { key: 'context.trip', owner_scope: true } });
    const text = JSON.stringify(r.msg?.result ?? {});
    assert(text.includes('Flights booked'), `could not open the context: ${text.slice(0, 300)}`);
});

console.log('\nPhase 2: who gets nothing');

await test('An agent of the same person without memory:read gets no index (cross-scope)', async () => {
    const r = await initialize(blind);
    assert(!r.instructions.includes('keeps contexts') && !r.instructions.includes('keeps no contexts'), 'an agent that cannot read memory was given the index');
    assert(!r.instructions.includes('context.trip'), 'the trip was named to an agent that cannot open it');
});

await test('The agent without memory:read is refused the context itself, over REST and MCP (cross-scope)', async () => {
    const rest = await json('/v1/memory/context.trip?owner_scope=true', auth(blind));
    assert(rest.status === 403, `REST read by an agent without memory:read answered ${rest.status}`);
    const { session } = await initialize(blind);
    const r = await mcp(blind, session, 'tools/call', { name: 'aimeat_memory_read', arguments: { key: 'context.trip', owner_scope: true } });
    const refused = !!r.msg?.error || r.msg?.result?.isError === true;
    assert(refused, `MCP read by an agent without memory:read was not refused: ${JSON.stringify(r.msg).slice(0, 200)}`);
    assert(!JSON.stringify(r.msg ?? {}).includes('Flights booked'), 'the context leaked to an agent without memory:read');
});

await test('Another person\'s agent never sees these contexts (cross-owner)', async () => {
    const r = await initialize(foreign);
    assert(!r.instructions.includes('context.trip') && !r.instructions.includes('context.band'), 'another person\'s contexts leaked');
    assert(r.instructions.includes('keeps no contexts yet'), 'the other person\'s own line is missing');
});

console.log(`\n=== Context index: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
