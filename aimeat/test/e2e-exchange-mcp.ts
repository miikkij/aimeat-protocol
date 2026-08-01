/**
 * @file test/e2e-exchange-mcp.ts
 * @description E2E for the GENERIC "act on EXCHANGE" MCP tools (src/mcp/exchange-run.ts) — the surface that
 *   lets ANY MCP client (Claude chat, an agent), not just a bespoke runtime, run agent-work + renegotiate +
 *   call an app-tool through a contract. Boots an in-process node (for storage access), seeds a provider
 *   agent-work offering + a consumer contract over REST (the same tested routes), then drives the new MCP
 *   tool HANDLERS directly against the server's storage:
 *     - aimeat_exchange_work           start a task (happy) + unknown offering (NOT_FOUND)
 *     - aimeat_exchange_work_deliver   provider delivers → SETTLE ON DELIVERY via the capture-mock Response
 *                                      (consumer debited, charged == price) + not-your-work (NOT_FOUND)
 *     - aimeat_exchange_work_list      consumer + provider views
 *     - aimeat_exchange_proposals      list a renegotiation proposal (seeded over REST)
 *     - aimeat_exchange_proposal_decide accept → supersede (price changes on the live contract)
 *     - aimeat_app_tool_invoke         NO_CONTRACT failure · the metered HAPPY path (result rides back,
 *                                      consumer debited) · and a STALE session token (named error, no charge)
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/e2e-exchange-mcp.ts
 * @version-history
 *   v1.0.0 — 2026-07-21 — Initial: MCP parity for the act-on-exchange tools (work / proposals / app-tool invoke).
 *   v1.1.0 — 2026-07-25 — Cover aimeat_app_tool_invoke's happy path and its stale-token failure. The suite
 *     previously treated the happy path as "identical to the WebMCP invoke" and skipped it — but WebMCP reads
 *     the token off the live request while the MCP tool replays its session's token, and that one difference
 *     is what broke every metered app-tool call an hour into any MCP session.
 *   v1.2.0 — 2026-08-01 — TARGET-058 Phase 8b: a declared `ai_provenance` on a delivery reaches the
 *     work item and the CONSUMER's listing. The delivered output is the thing the buyer paid for.
 */
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerExchangeRunTools } from '../src/mcp/exchange-run.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const PORT = parseInt(process.env.E2E_XMCP_PORT ?? '40273', 10);
const BASE = `http://localhost:${PORT}`;
process.env.AIMEAT_PORT = String(PORT);
process.env.AIMEAT_DEV_MODE = 'true';
process.env.AIMEAT_TEST_MODE = 'true';
if (!process.env.AIMEAT_ADMIN_PASSWORD) process.env.AIMEAT_ADMIN_PASSWORD = randomBytes(16).toString('base64url');
const { config } = loadConfig({});
config.port = PORT;
const NODE_ID = config.nodeId;
const { app, storage } = await createServer(config);
const server = await new Promise<Server>((resolve) => { const s = app.listen(PORT, () => resolve(s)); });

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
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
async function setupOwner(label: string) {
    const name = `xm${label}${Date.now()}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'XMcp', password: 'Exchange1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'XMcp', password: 'Exchange1234' }) }); }
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    return { name, token: tok.body.data.token as string, gaii: `${name}@${NODE_ID}` };
}
async function balance(token: string): Promise<number> {
    const r = await json('/v1/wallet', { headers: auth(token) });
    return Number(r.body.data.balance ?? r.body.data.total ?? 0);
}

/** A capture-only mock McpServer: records each registered handler by tool name so the test can invoke it. */
function captureTools(gaii: string, token: string): Record<string, (a: any) => Promise<any>> {
    const handlers: Record<string, (a: any) => Promise<any>> = {};
    const mock = { tool: (name: string, _d: unknown, _s: unknown, _a: unknown, handler: (a: any) => Promise<any>) => { handlers[name] = handler; } } as unknown as McpServer;
    registerExchangeRunTools(mock, storage, config, () => gaii, () => token);
    return handlers;
}
/** Parse a tool result: { data } from a success text blob, or { error } from an isError blob. */
function parse(res: { content: { text: string }[]; isError?: boolean }) {
    const text = res.content[0].text;
    if (res.isError) return { error: text };
    try { return { data: JSON.parse(text) }; } catch { return { data: text }; }
}

console.log('\n=== AIMEAT EXCHANGE — act-on-exchange MCP tools E2E ===\n');

const provider = await setupOwner('prov');
const consumer = await setupOwner('cons');
const validTerms = { derivatives: true, resale: false, attribution: true };
let awOfferingId = '';
const P = () => captureTools(provider.gaii, provider.token);
const C = () => captureTools(consumer.gaii, consumer.token);

await test('Setup: provider registers an agent + lists an agent-work offering (5 morsels/task)', async () => {
    const reg = await json('/v1/agents', { method: 'POST', headers: auth(provider.token), body: JSON.stringify({ name: 'worker', owner: provider.name, capabilities: ['actions'] }) });
    assert(reg.status === 201, `agent ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const r = await json('/v1/exchange/offerings', { method: 'POST', headers: auth(provider.token), body: JSON.stringify({
        kind: 'agent-work', agent_name: 'worker', task_type: 'summarize', title: 'Doc summarization', price_morsels: 5, usage_terms: validTerms,
        input_schema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } },
        output_schema: { type: 'object', properties: { summary: { type: 'string' } } },
    }) });
    assert(r.status === 201, `offering ${r.status}: ${JSON.stringify(r.body?.error)}`);
    awOfferingId = r.body.data.offering.offeringId;
});

await test('aimeat_exchange_work — start without a contract → NO_CONTRACT (failure mode)', async () => {
    const res = parse(await C()['aimeat_exchange_work']({ offering_id: awOfferingId, input: { text: 'hi' } }));
    assert(!!res.error && res.error.includes('NO_CONTRACT'), `expected NO_CONTRACT, got ${JSON.stringify(res)}`);
});

let workId = '';
await test('aimeat_exchange_work — consumer contracts (REST) then starts a task via MCP (happy)', async () => {
    const acc = await json('/v1/exchange/entitlements', { method: 'POST', headers: auth(consumer.token), body: JSON.stringify({ offering_id: awOfferingId, cap_units: 50 }) });
    assert(acc.status === 201, `accept ${acc.status}: ${JSON.stringify(acc.body?.error)}`);
    const res = parse(await C()['aimeat_exchange_work']({ offering_id: awOfferingId, input: { text: 'a long document' }, note: 'via mcp' }));
    assert(!!res.data?.work?.work_id && res.data.work.state === 'open', `work started: ${JSON.stringify(res)}`);
    workId = res.data.work.work_id;
});

await test('aimeat_exchange_work — unknown offering → NOT_FOUND (failure mode)', async () => {
    const res = parse(await C()['aimeat_exchange_work']({ offering_id: 'off-nope', input: {} }));
    assert(!!res.error && res.error.includes('NOT_FOUND'), `expected NOT_FOUND, got ${JSON.stringify(res)}`);
});

await test('aimeat_exchange_work_deliver — a non-provider cannot deliver → NOT_FOUND', async () => {
    const res = parse(await C()['aimeat_exchange_work_deliver']({ work_id: workId, output: { summary: 'x' } }));
    assert(!!res.error && res.error.includes('NOT_FOUND'), `expected NOT_FOUND, got ${JSON.stringify(res)}`);
});

await test('aimeat_exchange_work_deliver — provider delivers → settle on delivery (consumer −5, charged 5)', async () => {
    const before = await balance(consumer.token);
    const res = parse(await P()['aimeat_exchange_work_deliver']({ work_id: workId, output: { summary: 'A short summary.' } }));
    assert(res.data?.work?.state === 'delivered', `delivered: ${JSON.stringify(res)}`);
    assert(res.data.work.charged_units === 5, `charged 5, got ${res.data?.work?.charged_units}`);
    const after = await balance(consumer.token);
    assert(after === before - 5, `consumer debited 5 (before ${before}, after ${after})`);
});

await test('aimeat_exchange_work_deliver — a DECLARED provenance rides with the delivered answer (TARGET-058)', async () => {
    // The buyer paid for this output, so how it was made is part of what they bought. The provider
    // here is an OWNER principal, which Mint-3 leaves alone (a person is presumed human) — so this
    // asserts the DECLARATION path: the provider says a model wrote it, and the record must reach the
    // work item, not just the tool result.
    const res = parse(await C()['aimeat_exchange_work']({ offering_id: awOfferingId, input: { text: 'another document' } }));
    const id = res.data?.work?.work_id;
    assert(!!id, `start ${JSON.stringify(res)}`);
    const del = parse(await P()['aimeat_exchange_work_deliver']({
        work_id: id, output: { summary: 'A model wrote this summary.' },
        ai_provenance: { level: 'ai-generated', human_involvement: 'none', model: 'stub/test-model' },
    }));
    assert(del.data?.work?.state === 'delivered', `deliver: ${JSON.stringify(del)}`);
    const echoed = del.data.ai_provenance;
    assert(!!echoed?.id, `no record echoed on the delivery: ${JSON.stringify(del.data)}`);
    assert(echoed.record.level === 'ai-generated', `level ${echoed.record.level}`);
    assert(echoed.record.generator?.model === 'stub/test-model', `model ${echoed.record.generator?.model}`);
    assert(del.data.work.ai_provenance_id === echoed.id,
        `the work item lost the record: ${JSON.stringify(del.data.work.ai_provenance_id)}`);

    // ...and the CONSUMER — the party who paid — sees it on their own listing.
    const list = parse(await C()['aimeat_exchange_work_list']({}));
    const mine = list.data?.work?.find((x: any) => x.work_id === id);
    assert(mine?.ai_provenance_id === echoed.id,
        `the buyer cannot see how the answer was made: ${JSON.stringify(mine)}`);
});

await test('aimeat_exchange_work_list — consumer sees the delivered task with its output', async () => {
    const res = parse(await C()['aimeat_exchange_work_list']({}));
    const w = res.data?.work?.find((x: any) => x.work_id === workId);
    assert(w && w.state === 'delivered' && (w.output?.summary === 'A short summary.'), `consumer list: ${JSON.stringify(res.data?.work)}`);
});

await test('aimeat_exchange_work_list — provider role lists work to/that they delivered', async () => {
    const res = parse(await P()['aimeat_exchange_work_list']({ role: 'provider' }));
    assert(res.data?.role === 'provider' && res.data.work.some((x: any) => x.work_id === workId), `provider list: ${JSON.stringify(res.data)}`);
});

await test('aimeat_exchange_proposals + _proposal_decide — accept a renegotiation → supersede (price → 7)', async () => {
    // Seed a provider→consumer proposal over the tested REST route, then decide it via MCP.
    const prop = await json('/v1/exchange/proposals', { method: 'POST', headers: auth(provider.token), body: JSON.stringify({
        ext: `agentwork:${provider.name}/worker`, action: 'summarize', consumer_gaii: consumer.gaii, new_price_per_call: 7, note: 'volume up',
    }) });
    assert(prop.status === 201, `propose ${prop.status}: ${JSON.stringify(prop.body?.error)}`);
    const pid = prop.body.data.proposal.proposal_id;
    // Consumer is the counterparty — sees it in their proposals list.
    const list = parse(await C()['aimeat_exchange_proposals']({}));
    assert(list.data?.proposals?.some((p: any) => p.proposal_id === pid && p.status === 'pending'), `consumer sees pending proposal: ${JSON.stringify(list.data?.proposals)}`);
    // A non-counterparty decision is refused (provider cannot accept their own proposal).
    const bad = parse(await P()['aimeat_exchange_proposal_decide']({ proposal_id: pid, decision: 'accept' }));
    assert(!!bad.error && bad.error.includes('FORBIDDEN'), `provider accept refused: ${JSON.stringify(bad)}`);
    // Counterparty accepts → supersede at the new price.
    const dec = parse(await C()['aimeat_exchange_proposal_decide']({ proposal_id: pid, decision: 'accept' }));
    assert(dec.data?.status === 'accepted' && dec.data.entitlement?.price_per_call === 7, `superseded to 7: ${JSON.stringify(dec)}`);
});

await test('aimeat_app_tool_invoke — no contract for the app-tool → NO_CONTRACT (failure mode)', async () => {
    // Publish a minimal app-tool manifest so the tool resolves, but hold no contract → must refuse before any charge.
    const put = await json('/v1/memory', { method: 'POST', headers: auth(provider.token), body: JSON.stringify({
        key: 'apps.brief.tools', visibility: 'public',
        value: { tools: [{ name: 'getBrief', action_id: 'cap-x', description: 'brief', inputSchema: { type: 'object' }, outputSchema: { type: 'object' } }] },
    }) });
    assert(put.status === 200 || put.status === 201, `manifest put ${put.status}`);
    const res = parse(await C()['aimeat_app_tool_invoke']({ owner: provider.name, app: 'brief', tool: 'getBrief', input: {} }));
    assert(!!res.error && res.error.includes('NO_CONTRACT'), `expected NO_CONTRACT, got ${JSON.stringify(res)}`);
});

// ── The happy path, and the token that goes stale under it ────────────────────────────────────────
// This was the coverage hole: the MCP happy path was assumed identical to the WebMCP route, but the
// two differ in exactly one respect — WebMCP reads the bearer token off the LIVE request, while the
// MCP tool replays whatever token its session was handed. An MCP session outlives its access token
// (jwtTtlSeconds, rotated by the client), so a replayed-stale token made every metered app-tool call
// fail with the route's AUTH_REQUIRED for the rest of the session. Both cases are pinned here.
const EXT = `xmcpext${Date.now()}`;
await test('Setup: provider installs a priced extension and sells it as an app-tool', async () => {
    const inst = await json('/v1/extensions', { method: 'POST', headers: auth(provider.token), body: JSON.stringify({
        manifest: JSON.stringify({
            metadata: { name: EXT, version: '1.0.0', description: 'app-tool invoke e2e provider', author: 'e2e' },
            // No `commercial` block on the action ON PURPOSE: the price lives on the app-tool
            // manifest. Pricing the raw action too would meter the SAME call twice — once by the
            // app-tool contract, once by the extension route's own paywall underneath it.
            actions: [{
                id: 'echo', method: 'POST', path: '/echo', script: 'echo',
                input: { type: 'object', properties: { q: { type: 'string' } } },
                output: { type: 'object', properties: { echo: {} } },
            }],
            config: { public_access: { default: true } },
            limits: { timeout_ms: 5000, max_api_calls: 1 },
        }),
        scripts: { echo: 'export default async function(ctx, input){ return { echo: input, caller: ctx.caller.owner }; }' },
    }) });
    assert(inst.status === 201 || inst.status === 200, `install ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
    const act = await json(`/v1/extensions/${EXT}/activate`, { method: 'POST', headers: auth(provider.token) });
    assert(act.status === 200, `activate ${act.status}: ${JSON.stringify(act.body?.error)}`);
    // The aggregator that mints `ext:{name}:{action}` capability records runs on a schedule; drive it
    // now so the app-tool has something to bind to.
    const { runCapabilityAggregation } = await import('../src/services/capability-aggregator.js');
    await runCapabilityAggregation(config, storage);
    assert(!!(await storage.getCapability(`ext:${EXT}:echo`)), 'capability must be registered for the action');

    const put = await json('/v1/memory', { method: 'POST', headers: auth(provider.token), body: JSON.stringify({
        key: 'apps.plotter.tools', visibility: 'public',
        value: { tools: [{
            name: 'run', action_id: `ext:${EXT}:echo`, description: 'echo the input',
            price: { morsels: 3, unit: 'per-call' },
            inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
        }] },
    }) });
    assert(put.status === 200 || put.status === 201, `manifest put ${put.status}`);

    // List it on EXCHANGE, then contract against the offering (an app-tool coordinate is only
    // contractable through its listing — the offering carries the authoritative price).
    const off = await json('/v1/exchange/offerings', { method: 'POST', headers: auth(provider.token), body: JSON.stringify({
        kind: 'app-tool', app_id: 'plotter', tool: 'run', usage_terms: validTerms,
    }) });
    assert(off.status === 201, `offering ${off.status}: ${JSON.stringify(off.body?.error)}`);
    const acc = await json('/v1/exchange/entitlements', { method: 'POST', headers: auth(consumer.token), body: JSON.stringify({
        offering_id: off.body.data.offering.offeringId, cap_units: 30, contract_ref: 'c-apptool',
    }) });
    assert(acc.status === 201, `accept ${acc.status}: ${JSON.stringify(acc.body?.error)}`);
});

await test('aimeat_app_tool_invoke — with a live token the metered call returns the capability result', async () => {
    const before = await balance(consumer.token);
    const res = parse(await C()['aimeat_app_tool_invoke']({ owner: provider.name, app: 'plotter', tool: 'run', input: { q: 'hello' } }));
    assert(!res.error, `expected a result, got ${JSON.stringify(res)}`);
    assert(res.data?.metered === true, `call must be metered: ${JSON.stringify(res.data)}`);
    assert(res.data?.result?.echo?.q === 'hello', `capability output must ride back: ${JSON.stringify(res.data?.result)}`);
    const after = await balance(consumer.token);
    assert(after === before - 3, `consumer debited the 3-morsel price (before ${before}, after ${after})`);
});

await test('aimeat_app_tool_invoke — a session token that went stale fails by NAME, and refunds', async () => {
    // Drive the same handler with an empty token, which is what a session captured at initialize
    // degrades to once its access token has rotated. The caller must learn it is a TOKEN problem.
    const staleHandlers = captureTools(consumer.gaii, '');
    const before = await balance(consumer.token);
    const res = parse(await staleHandlers['aimeat_app_tool_invoke']({ owner: provider.name, app: 'plotter', tool: 'run', input: { q: 'hello' } }));
    assert(!!res.error, `expected a failure, got ${JSON.stringify(res)}`);
    assert(res.error!.includes('CALLER_TOKEN'), `the error must name the token, got: ${res.error}`);
    const after = await balance(consumer.token);
    assert(after === before, `a failed invoke must leave no charge (before ${before}, after ${after})`);
});

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
await new Promise<void>((resolve) => server.close(() => resolve()));
process.exit(failed === 0 ? 0 : 1);
