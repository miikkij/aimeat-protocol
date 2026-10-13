/**
 * @file test/e2e-mcp-exchange.ts
 * @description The ten EXCHANGE tools on the node's own MCP door at /v1/mcp, none of which had ever
 *   been called by a suite.
 *
 *   WHY THIS SUITE EXISTS. src/mcp/exchange.ts registers the whole two-sided market for an agent:
 *   browse offerings, read one in full, accept a contract, list and switch off the caller's own
 *   contracts, post and browse needs, bid, accept a bid, and read who holds contracts against an
 *   offering. Every one of them mirrors a REST handler in src/routes/exchange.ts and
 *   exchange-market.ts, and every one of those REST handlers is already driven by test/e2e-exchange.ts.
 *   The MCP half was driven by nothing, so a difference between the two doors could only be found in
 *   production: the scope filter is stricter here than REST on purpose (exchange:read /
 *   exchange:write), the consumer identity is the CALLER's resolved GAII rather than anything from
 *   the input, and both facts were assertions nobody had written down.
 *
 *   HOW IT IS BUILT. Everything the market needs is seeded through the REST doors e2e-exchange.ts
 *   already keeps green — the extension, the offerings, one need and one bid — and the MCP tool is
 *   then driven against that seed, with the record read back through REST. A tool that decided
 *   something different from its route shows up as a mismatch rather than as a green run.
 * @structure
 *   - Phase 1: fixtures (provider owner + agent, consumer owner + agent, ext-action and app-tool
 *     offerings, one REST-seeded need and bid)
 *   - Phase 2: the scope fence — which of the ten tools each agent is handed
 *   - Phase 3: the consumer side (offerings, offering_get on both branches, accept on both branches,
 *     contracts, contract_off)
 *   - Phase 4: the demand side (needs, need_post, bid, bid_accept)
 *   - Phase 5: the provider side (consumers) and the refusals
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-exchange
 * @version-history
 *   v1.2.1 — 2026-10-13 — The provider's agent holds ext:invoke: aimeat_app_tool_invoke declares it beside
 *     exchange:write, and from 4.0.0 the tool is not offered without it (tests 28 and 29).
 *   v1.2.0 — 2026-10-12 — Node 4.0.0 refuses the 3.x morsel price fields (MORSEL_PRICE_REMOVED), so the
 *     fixtures use the 4.0.0 form, which 3.x accepts too: the extension actions and the app tool state
 *     `tollMorsels`, and both needs carry a money budget. Morsel-rail offerings and contracts are read
 *     through assertPacingRail: `toll_morsels` on both releases, the deprecated mirrors on 3.x only.
 *     20a: aimeat_exchange_need_post with a morsel budget, stored on 3.x and refused with
 *     MORSEL_PRICE_REMOVED and nothing stored on 4.0.0, as REST POST /v1/exchange/needs answers.
 *   v1.1.0 — 2026-09-19 — Phase 6: an app tool's input is checked against its published schema on
 *     both doors, and one refusal names every missing field.
 *   v1.0.0 — 2026-09-08 — Initial: all ten tools of src/mcp/exchange.ts, both branches of
 *     offering_get and of accept, and the scope fence that decides which of them exist at all.
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { ownerSignIn } from './helpers/owner-login.js';
import { removedOn } from './helpers/node-release.js';
import { MORSEL_PRICE_FIELDS_REMOVED_IN } from '../src/config-pacing.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

// Node 4.0.0 drops the deprecated mirrors of a morsel-rail offering or contract (`unit`, `basePrice`,
// `price_per_call`, `currency`) and keeps `toll_morsels` as the only figure (services/exchange-market.ts
// presentOffering, presentContractTerms). A 3.x node still answers with the mirrors, marked deprecated.
const MIRRORS_GONE = await removedOn(BASE, MORSEL_PRICE_FIELDS_REMOVED_IN);
/**
 * A morsel-rail offering or contract states `amount` morsels of pacing per use. On 3.x the mirror
 * `priceKey` and `unit: 'morsels'` carry the same amount and are named in `deprecated`; on 4.0.0 they are absent.
 */
function assertPacingRail(x: any, amount: number, priceKey: 'basePrice' | 'price_per_call', label: string) {
    assert(x?.toll_morsels === amount, `${label}: toll_morsels ${amount}: ${JSON.stringify(x)}`);
    if (MIRRORS_GONE) {
        assert(!('unit' in x) && !(priceKey in x) && !('deprecated' in x), `${label}: no 3.x mirrors on 4.0.0: ${JSON.stringify(x)}`);
    } else {
        assert(x.unit === 'morsels' && x[priceKey] === amount && !!x.deprecated?.[priceKey], `${label}: the 3.x mirrors: ${JSON.stringify(x)}`);
    }
}

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`✅ ${name}`); }
    catch (e) { failed++; console.log(`❌ ${name}: ${(e as Error).message}`); }
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
        });
        if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 1200)); continue; }
        const text = await res.text();
        let body: any;
        try { body = JSON.parse(text); } catch { body = { _raw: text }; }
        return { status: res.status, body };
    }
}

(ed as any).hashes.sha512 = (...msgs: Uint8Array[]) => {
    const h = createHash('sha512');
    for (const m of msgs) h.update(m);
    return new Uint8Array(h.digest());
};
async function signMsg(privB64: string, msg: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

const authed = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

async function makeOwner(name: string): Promise<{ token: string; owner: string }> {
    const owner = `${name}${Date.now().toString(36).slice(-6)}`;
    for (let attempt = 0; ; attempt++) {
        const reg = await json('/v1/ghii', {
            method: 'POST',
            body: JSON.stringify({ username: owner, display_name: owner, password: 'ExchangeTest1234' }),
        });
        if (reg.status === 429 && attempt < 8) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        assert(reg.status === 201, `registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
        const tok = await ownerSignIn(BASE, owner, 'ExchangeTest1234');
        assert(tok.status === 200, `token failed: ${tok.status}`);
        return { token: tok.body.data.token as string, owner };
    }
}

/** An agent token carrying exactly the scopes named — the fence this suite tests runs on them. */
async function makeAgent(ownerCtx: { token: string; owner: string }, scopes: string[]): Promise<string> {
    const name = `xc${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1000)}`;
    const reg = await json('/v1/agents', {
        method: 'POST', headers: authed(ownerCtx.token),
        body: JSON.stringify({ name, owner: ownerCtx.owner, scopes }),
    });
    assert(reg.status === 201, `agent registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const privKey = reg.body.data.private_key as string;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(privKey, gaii + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature }) });
    assert(tok.status === 200, `agent token failed: ${tok.status}`);
    return tok.body.data.token as string;
}

// ── The node's own MCP door ────────────────────────────────────────────────────────────────────

interface McpSession { token: string; sessionId?: string }

function parseSSE(text: string): any[] {
    return text.split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } })
        .filter(Boolean);
}

let rpcId = 0;
const nextId = (): number => ++rpcId;

async function mcpRpc(session: McpSession, method: string, params: Record<string, any> = {}, id = nextId()): Promise<any> {
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${session.token}`,
            ...(session.sessionId ? { 'mcp-session-id': session.sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) session.sessionId = sid;
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('text/event-stream')) {
        const msgs = parseSSE(await res.text());
        return msgs.find((m) => m.id === id) ?? msgs[0] ?? {};
    }
    return await res.json();
}

async function openSession(token: string): Promise<McpSession> {
    const session: McpSession = { token };
    await mcpRpc(session, 'initialize', {
        protocolVersion: '2025-03-26', capabilities: {},
        clientInfo: { name: 'e2e-mcp-exchange', version: '1.0.0' },
    });
    return session;
}

/** The text an MCP tool returns, parsed. */
function toolJson(body: any): any {
    const text = body?.result?.content?.[0]?.text ?? '';
    try { return JSON.parse(text); } catch { return { _text: text }; }
}

async function toolNames(session: McpSession): Promise<string[]> {
    const names: string[] = [];
    let cursor: string | undefined;
    do {
        const body = await mcpRpc(session, 'tools/list', cursor ? { cursor } : {});
        for (const t of body?.result?.tools ?? []) names.push(t.name);
        cursor = body?.result?.nextCursor;
    } while (cursor);
    return names;
}

/** Call one tool and return both halves: the parsed answer and whether the node refused. */
async function callTool(session: McpSession, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; data: any; text: string }> {
    const body = await mcpRpc(session, 'tools/call', { name, arguments: args });
    const text = body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body ?? {});
    return { isError: body?.result?.isError === true || body?.error !== undefined, data: toolJson(body), text };
}

// ── The run ────────────────────────────────────────────────────────────────────────────────────

console.log('═══ E2E: the EXCHANGE tools on the node MCP surface ═══');
console.log(`Base: ${BASE}`);

const EXT = `xcmcp${Date.now().toString(36).slice(-6)}`;
const IN_SCHEMA = { type: 'object', properties: { q: { type: 'string' } } };
const OUT_SCHEMA = { type: 'object', properties: { echo: {}, caller: { type: 'string' } } };
const USAGE_TERMS = { derivatives: true, resale: false, attribution: true };

const manifest = JSON.stringify({
    metadata: { name: EXT, version: '1.0.0', description: 'mcp exchange e2e provider', author: 'e2e' },
    actions: [
        {
            id: 'validate', method: 'POST', path: '/validate', script: 'echo',
            input: IN_SCHEMA, output: OUT_SCHEMA, tollMorsels: 10,
        },
        {
            id: 'legacy', method: 'POST', path: '/legacy', script: 'echo',
            input: IN_SCHEMA, output: OUT_SCHEMA, tollMorsels: 6,
        },
        {
            id: 'bidme', method: 'POST', path: '/bidme', script: 'echo',
            input: IN_SCHEMA, output: OUT_SCHEMA, tollMorsels: 4,
        },
        { id: 'unpriced', method: 'POST', path: '/unpriced', script: 'echo', input: IN_SCHEMA, output: OUT_SCHEMA },
    ],
    config: { public_access: { default: true } },
    limits: { timeout_ms: 5000, max_api_calls: 1 },
}, null, 2);
const SCRIPTS = { echo: 'export default async function(ctx, input){ return { echo: input, caller: ctx.caller.owner }; }' };

const APP_ID = 'mcpbriefapp';

const provider = await makeOwner('xcprov');
const consumer = await makeOwner('xccons');

// ext:invoke: tests 28 and 29 call aimeat_app_tool_invoke, which runs the tool's extension action and
// from 4.0.0 is offered only to an agent holding that word as well.
const providerAgent = await makeAgent(provider, ['exchange:read', 'exchange:write', 'ext:invoke']);
const consumerAgent = await makeAgent(consumer, ['exchange:read', 'exchange:write']);
const readOnlyAgent = await makeAgent(consumer, ['exchange:read']);
const narrowAgent = await makeAgent(consumer, ['memory:read']);

let extOfferingId = '';
let appToolOfferingId = '';
let seededNeedId = '';
let seededBidId = '';
let consumerGaii = '';

console.log('\nPhase 1 — fixtures, seeded through the REST doors');

await test('1. The provider installs and activates a priced extension', async () => {
    const inst = await json('/v1/extensions', {
        method: 'POST', headers: authed(provider.token),
        body: JSON.stringify({ manifest, scripts: SCRIPTS }),
    });
    assert(inst.status === 201, `install ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
    const act = await json(`/v1/extensions/${EXT}/activate`, { method: 'POST', headers: authed(provider.token) });
    assert(act.status === 200, `activate ${act.status}: ${JSON.stringify(act.body?.error)}`);
});

await test('2. The provider lists an ext-action OFFERING through POST /v1/exchange/offerings', async () => {
    const r = await json('/v1/exchange/offerings', {
        method: 'POST', headers: authed(provider.token),
        body: JSON.stringify({
            ext: EXT, action: 'validate', title: 'Company lookup over MCP',
            description: 'The ext-action listing this suite reads back through the MCP tools',
            tags: ['mcp', 'e2e'], usage_terms: USAGE_TERMS,
        }),
    });
    assert(r.status === 201, `list offering ${r.status}: ${JSON.stringify(r.body?.error)}`);
    extOfferingId = r.body.data.offering.offeringId;
    assertPacingRail(r.body.data.offering, 10, 'basePrice', 'authoritative pacing');
});

await test('3. The provider lists an APP-TOOL offering, so offering_get has both branches to answer', async () => {
    const w = await json('/v1/memory', {
        method: 'POST', headers: authed(provider.token),
        body: JSON.stringify({
            key: `apps.${APP_ID}.tools`, visibility: 'public',
            value: {
                version: 1,
                tools: [{
                    name: 'getbrief', description: 'Company brief',
                    action_id: `ext:${EXT}:legacy`,
                    inputSchema: IN_SCHEMA, outputSchema: OUT_SCHEMA,
                    tollMorsels: 8,
                }],
            },
        }),
    });
    assert(w.status === 201, `manifest write ${w.status}: ${JSON.stringify(w.body?.error)}`);
    const r = await json('/v1/exchange/offerings', {
        method: 'POST', headers: authed(provider.token),
        body: JSON.stringify({ kind: 'app-tool', app_id: APP_ID, tool: 'getbrief', title: 'Company brief', usage_terms: USAGE_TERMS }),
    });
    assert(r.status === 201, `list app-tool ${r.status}: ${JSON.stringify(r.body?.error)}`);
    appToolOfferingId = r.body.data.offering.offeringId;
    assert(r.body.data.offering.surface?.ifaceVersion === 1, `pinned interface: ${JSON.stringify(r.body.data.offering.surface)}`);
});

await test('4. A need and a bid are seeded over REST, so the MCP reads have a record to find', async () => {
    // The need is posted by the consumer AGENT, because the MCP `mine` filter reads the caller's
    // owner and the agent resolves to the same owner its MCP session will.
    const n = await json('/v1/exchange/needs', {
        method: 'POST', headers: authed(consumerAgent),
        body: JSON.stringify({
            ext: EXT, action: 'bidme', description: 'REST-seeded need, read back over MCP',
            app_id: `${consumer.owner}/lookup-app`, budget_unit: 'money', budget_cap: 600000,
        }),
    });
    assert(n.status === 201, `post need ${n.status}: ${JSON.stringify(n.body?.error)}`);
    seededNeedId = n.body.data.need.needId;
    consumerGaii = n.body.data.need.requesterGaii;

    const b = await json(`/v1/exchange/needs/${seededNeedId}/bids`, {
        method: 'POST', headers: authed(provider.token),
        body: JSON.stringify({ ext: EXT, action: 'bidme', note: 'seeded over REST' }),
    });
    assert(b.status === 201, `bid ${b.status}: ${JSON.stringify(b.body?.error)}`);
    seededBidId = b.body.data.bid.bidId;
});

console.log('\nPhase 2 — the scope fence decides which tools exist');

const READ_TOOLS = [
    'aimeat_exchange_offerings', 'aimeat_exchange_offering_get', 'aimeat_exchange_contracts',
    'aimeat_exchange_needs', 'aimeat_exchange_consumers',
];
const WRITE_TOOLS = [
    'aimeat_exchange_accept', 'aimeat_exchange_contract_off', 'aimeat_exchange_need_post',
    'aimeat_exchange_bid', 'aimeat_exchange_bid_accept',
];

const consumerSession = await openSession(consumerAgent);
const providerSession = await openSession(providerAgent);

await test('5. An agent holding both exchange words is handed all ten tools', async () => {
    const names = await toolNames(consumerSession);
    for (const t of [...READ_TOOLS, ...WRITE_TOOLS]) {
        assert(names.includes(t), `${t} must be offered to an exchange:read+write agent`);
    }
});

await test('6. …an exchange:read agent gets the five reads and NONE of the five writes', async () => {
    const names = await toolNames(await openSession(readOnlyAgent));
    for (const t of READ_TOOLS) assert(names.includes(t), `${t} is a read tool and must survive exchange:read`);
    for (const t of WRITE_TOOLS) assert(!names.includes(t), `${t} mints or changes a contract and must be gone without exchange:write`);
});

await test('7. …and an agent with neither word is handed no exchange tool at all', async () => {
    const names = await toolNames(await openSession(narrowAgent));
    const found = [...READ_TOOLS, ...WRITE_TOOLS].filter((t) => names.includes(t));
    assert(found.length === 0, `an agent without an exchange scope must see none of them, got ${JSON.stringify(found)}`);
});

await test('8. The REST door behind them refuses an unauthenticated read with 401', async () => {
    const res = await fetch(`${BASE}/v1/exchange/entitlements`);
    assert(res.status === 401, `expected 401 without a token, got ${res.status}`);
});

console.log('\nPhase 3 — the consumer side');

await test('9. aimeat_exchange_offerings lists the market, and filters it by capability', async () => {
    const all = await callTool(consumerSession, 'aimeat_exchange_offerings', {});
    assert(!all.isError, `offerings refused: ${all.text.slice(0, 200)}`);
    assert(all.data.offerings.some((o: any) => o.offeringId === extOfferingId),
        `the seeded listing must be in the market, got ${all.data.count} offerings`);

    const filtered = await callTool(consumerSession, 'aimeat_exchange_offerings', { ext: EXT, action: 'validate', stats: true });
    assert(!filtered.isError, `filtered offerings refused: ${filtered.text.slice(0, 200)}`);
    assert(filtered.data.offerings.length >= 1 && filtered.data.offerings.every((o: any) => o.ext === EXT),
        `an ext+action filter must narrow the list: ${JSON.stringify(filtered.data.offerings.map((o: any) => o.ext))}`);
    assert(typeof filtered.data.offerings[0].stats?.totalCalls === 'number',
        `stats:true must fold usage into each row: ${JSON.stringify(filtered.data.offerings[0].stats)}`);
});

await test('10. aimeat_exchange_offering_get (ext-action branch) carries the schema and the call recipe', async () => {
    const out = await callTool(consumerSession, 'aimeat_exchange_offering_get', { offering_id: extOfferingId });
    assert(!out.isError, `offering_get refused: ${out.text.slice(0, 200)}`);
    assert(out.data.offering?.offeringId === extOfferingId, 'the tool must answer about the offering it was asked for');
    assert(out.data.capability?.output_schema?.properties, `the action's output schema: ${JSON.stringify(out.data.capability)}`);
    assert(out.data.call_recipe?.url === `/v1/ext/${EXT}/validate`, `call recipe url: ${out.data.call_recipe?.url}`);
    assert(String(out.data.call_recipe?.mcp ?? '').includes('aimeat_extension_invoke'),
        `an agent needs the tool call it would make: ${out.data.call_recipe?.mcp}`);

    // The same offering through the REST detail door must describe the same capability.
    const rest = await json(`/v1/exchange/offerings/${extOfferingId}`);
    assert(rest.status === 200 && rest.body.data.call_recipe.url === out.data.call_recipe.url,
        'the two doors must describe one offering the same way');
});

await test('11. aimeat_exchange_offering_get (app-tool branch) carries the PINNED interface', async () => {
    const out = await callTool(consumerSession, 'aimeat_exchange_offering_get', { offering_id: appToolOfferingId });
    assert(!out.isError, `app-tool offering_get refused: ${out.text.slice(0, 200)}`);
    assert(out.data.capability?.kind === 'app-tool' && out.data.capability.iface_version === 1,
        `pinned interface in the answer: ${JSON.stringify(out.data.capability)}`);
    assert(out.data.capability.app === `${provider.owner}/${APP_ID}` && out.data.capability.tool === 'getbrief',
        `the coordinate a buyer calls: ${JSON.stringify(out.data.capability)}`);
    assert(out.data.call_recipe?.url === `/v1/apps/${provider.owner}/${APP_ID}/webmcp/tools/getbrief`,
        `WebMCP call recipe: ${out.data.call_recipe?.url}`);
});

await test('12. An unknown offering is refused by name rather than answered empty', async () => {
    const out = await callTool(consumerSession, 'aimeat_exchange_offering_get', { offering_id: 'ei-olemassa' });
    assert(out.isError, `expected a refusal, got ${out.text.slice(0, 200)}`);
    assert(out.text.includes('NOT_FOUND'), `the refusal must name the reason: ${out.text}`);
});

await test('13. aimeat_exchange_accept by offering_id mints the contract the REST list then shows', async () => {
    const out = await callTool(consumerSession, 'aimeat_exchange_accept', {
        offering_id: extOfferingId, cap_units: 40, app_id: `${consumer.owner}/lookup-app`,
    });
    assert(!out.isError, `accept refused: ${out.text.slice(0, 300)}`);
    const e = out.data.entitlement;
    assertPacingRail(e, 10, 'price_per_call', 'the pacing is the provider\'s, not the caller\'s');
    assert(e.state === 'active', `state: ${JSON.stringify(e)}`);
    assert(e.budget.cap_units === 40 && e.budget.spent_units === 0, `budget: ${JSON.stringify(e.budget)}`);
    assert(e.contract_ref === `offering:${extOfferingId}`, `the contract names the offering: ${e.contract_ref}`);
    assert(e.consumer_gaii === consumerGaii,
        `the consumer is the CALLER's resolved identity, never an input: ${e.consumer_gaii} vs ${consumerGaii}`);

    // The same contract read through the door e2e-exchange.ts drives.
    const list = await json('/v1/exchange/entitlements', { headers: authed(consumerAgent) });
    assert(list.status === 200, `entitlements ${list.status}`);
    const rest = (list.body.data.entitlements ?? []).find((x: any) => x.action === 'validate');
    assert(!!rest, `REST must show the contract MCP minted: ${JSON.stringify(list.body.data.entitlements)}`);
    assertPacingRail(rest, 10, 'price_per_call', 'REST must show the contract MCP minted');
});

await test('14. aimeat_exchange_accept on the legacy ext+action branch mints its own contract ref', async () => {
    const out = await callTool(consumerSession, 'aimeat_exchange_accept', { ext: EXT, action: 'legacy', cap_units: 30 });
    assert(!out.isError, `legacy accept refused: ${out.text.slice(0, 300)}`);
    const e = out.data.entitlement;
    assert(e.action === 'legacy', `the legacy contract: ${JSON.stringify(e)}`);
    assertPacingRail(e, 6, 'price_per_call', 'authoritative legacy pacing');
    assert(String(e.contract_ref).startsWith('mcp:'),
        `a contract with no offering behind it gets an mcp: reference, got ${e.contract_ref}`);
    assert(e.provider === `${provider.owner}@${NODE_ID}`, `the provider is the extension's installer: ${e.provider}`);
});

await test('15. Accept refuses what it cannot price: no coordinate, an unknown offering, a budget under the price', async () => {
    const bare = await callTool(consumerSession, 'aimeat_exchange_accept', {});
    assert(bare.isError && bare.text.includes('BAD_REQUEST'), `naming nothing must be refused: ${bare.text.slice(0, 200)}`);

    const unknown = await callTool(consumerSession, 'aimeat_exchange_accept', { offering_id: 'ei-olemassa' });
    assert(unknown.isError && unknown.text.includes('NOT_FOUND'), `an unknown offering: ${unknown.text.slice(0, 200)}`);

    const tooLow = await callTool(consumerSession, 'aimeat_exchange_accept', { offering_id: extOfferingId, cap_units: 3 });
    assert(tooLow.isError && tooLow.text.includes('BUDGET_TOO_LOW'),
        `a cap below one call's price buys nothing and must say so: ${tooLow.text.slice(0, 200)}`);

    const free = await callTool(consumerSession, 'aimeat_exchange_accept', { ext: EXT, action: 'unpriced' });
    assert(free.isError && free.text.includes('NOT_PRICED'), `an unpriced action: ${free.text.slice(0, 200)}`);
});

await test('16. aimeat_exchange_contracts lists exactly the caller\'s own two contracts', async () => {
    const out = await callTool(consumerSession, 'aimeat_exchange_contracts', {});
    assert(!out.isError, `contracts refused: ${out.text.slice(0, 200)}`);
    const actions = out.data.entitlements.map((e: any) => e.action).sort();
    assert(actions.includes('validate') && actions.includes('legacy'),
        `both contracts must be listed, got ${JSON.stringify(actions)}`);
    assert(out.data.entitlements.every((e: any) => e.consumer_gaii === consumerGaii),
        'the list is the caller\'s own, and nobody else\'s');

    // The provider holds no contract as a consumer, which is what makes the list the caller's.
    const theirs = await callTool(providerSession, 'aimeat_exchange_contracts', {});
    assert(!theirs.isError && !theirs.data.entitlements.some((e: any) => e.consumer_gaii === consumerGaii),
        `another principal must not see this consumer's contracts: ${JSON.stringify(theirs.data)}`);
});

await test('17. aimeat_exchange_contract_off pauses a contract, and REST reads it as paused', async () => {
    const out = await callTool(consumerSession, 'aimeat_exchange_contract_off', { ext: EXT, action: 'legacy', mode: 'pause' });
    assert(!out.isError, `pause refused: ${out.text.slice(0, 200)}`);
    assert(out.data.applied === true && out.data.mode === 'pause', `pause answer: ${JSON.stringify(out.data)}`);

    const list = await json('/v1/exchange/entitlements', { headers: authed(consumerAgent) });
    const e = (list.body.data.entitlements ?? []).find((x: any) => x.action === 'legacy');
    assert(e && e.state !== 'active', `the paused contract must not read active over REST: ${JSON.stringify(e?.state)}`);
});

await test('18. …revoke is the other mode, and a capability the caller never contracted is NOT_FOUND', async () => {
    const rev = await callTool(consumerSession, 'aimeat_exchange_contract_off', { ext: EXT, action: 'legacy', mode: 'revoke' });
    assert(!rev.isError && rev.data.mode === 'revoke' && rev.data.applied === true, `revoke: ${rev.text.slice(0, 200)}`);

    const stranger = await callTool(consumerSession, 'aimeat_exchange_contract_off', { ext: EXT, action: 'bidme', mode: 'pause' });
    assert(stranger.isError && stranger.text.includes('NOT_FOUND'),
        `switching off a contract you do not hold must be refused: ${stranger.text.slice(0, 200)}`);
});

console.log('\nPhase 4 — the demand side');

let mcpNeedId = '';
let mcpBidId = '';

await test('19. aimeat_exchange_needs browses the market and narrows to the caller\'s own', async () => {
    const open = await callTool(consumerSession, 'aimeat_exchange_needs', { open: true });
    assert(!open.isError, `needs refused: ${open.text.slice(0, 200)}`);
    assert(open.data.needs.some((n: any) => n.needId === seededNeedId),
        `the REST-seeded need must be browsable over MCP, got ${open.data.count}`);

    const mine = await callTool(consumerSession, 'aimeat_exchange_needs', { mine: true });
    assert(!mine.isError && mine.data.needs.every((n: any) => n.requesterOwner === consumer.owner),
        `mine:true must be the caller's own: ${JSON.stringify(mine.data.needs.map((n: any) => n.requesterOwner))}`);

    const providersView = await callTool(providerSession, 'aimeat_exchange_needs', { mine: true });
    assert(!providersView.isError && !providersView.data.needs.some((n: any) => n.needId === seededNeedId),
        'another owner must not read this consumer\'s need as their own');
});

await test('20. aimeat_exchange_need_post writes a need REST then finds, with matches folded in', async () => {
    const out = await callTool(consumerSession, 'aimeat_exchange_need_post', {
        description: 'Need Finnish company lookups, posted over MCP',
        app_id: `${consumer.owner}/lookup-app`,
        ext: EXT, action: 'validate',
        usage_intent: 'Enriching a customer list the owner already holds',
        budget_unit: 'money', budget_cap: 500000, autonomy: 'supervised',
    });
    assert(!out.isError, `need_post refused: ${out.text.slice(0, 300)}`);
    mcpNeedId = out.data.need.needId;
    assert(out.data.need.requesterOwner === consumer.owner && out.data.need.state === 'open',
        `the need is the caller's and open: ${JSON.stringify(out.data.need)}`);
    assert(out.data.need.usageIntent, 'usage_intent must survive the tool');
    assert(out.data.matches.some((o: any) => o.offeringId === extOfferingId),
        `an offering that already satisfies the need must be surfaced: ${JSON.stringify(out.data.matches?.length)}`);

    const rest = await json('/v1/exchange/needs?open=1');
    assert(rest.body.data.needs.some((n: any) => n.needId === mcpNeedId),
        'the need the tool wrote must be the need the REST browse returns');
});

// A budget in morsels is a 3.x form: REST POST /v1/exchange/needs refuses it from 4.0.0, and the MCP
// tool has to answer the same, or the removed form stays reachable through the agent's door.
await test('20a. aimeat_exchange_need_post with a morsel budget is stored and browsable on 3.x; 4.0.0 refuses it with MORSEL_PRICE_REMOVED and stores nothing', async () => {
    const description = `Morsel-budget need over MCP ${Date.now()}`;
    const out = await callTool(consumerSession, 'aimeat_exchange_need_post', {
        description, app_id: `${consumer.owner}/lookup-app`, ext: EXT, action: 'validate',
        budget_unit: 'morsels', budget_cap: 50,
    });
    const rest = await json('/v1/exchange/needs?open=1');
    assert(rest.status === 200, `needs ${rest.status}`);
    const stored = (rest.body.data.needs as any[]).filter(n => n.description === description);
    if (MIRRORS_GONE) {
        assert(out.isError && out.text.startsWith('MORSEL_PRICE_REMOVED'),
            `4.0.0 refuses a morsel budget with MORSEL_PRICE_REMOVED: ${out.text.slice(0, 300)}`);
        assert(stored.length === 0, `nothing was stored: ${JSON.stringify(stored)}`);
        return;
    }
    assert(!out.isError, `need_post refused: ${out.text.slice(0, 300)}`);
    assert(out.data.need.budgetUnit === 'morsels' && out.data.need.budgetCap === 50, `the budget is stored as sent: ${JSON.stringify(out.data.need)}`);
    assert(stored.length === 1 && stored[0].needId === out.data.need.needId, `the need is browsable over REST: ${JSON.stringify(stored)}`);
});

await test('21. aimeat_exchange_bid bids with an action the caller\'s own extension owns', async () => {
    const out = await callTool(providerSession, 'aimeat_exchange_bid', {
        need_id: mcpNeedId, ext: EXT, action: 'validate', offering_id: extOfferingId, note: 'happy to serve',
    });
    assert(!out.isError, `bid refused: ${out.text.slice(0, 300)}`);
    mcpBidId = out.data.bid.bidId;
    assert(out.data.bid.bidderOwner === provider.owner && out.data.bid.state === 'open',
        `the bid is the provider's and open: ${JSON.stringify(out.data.bid)}`);

    const rest = await json(`/v1/exchange/needs/${mcpNeedId}/bids`);
    assert(rest.body.data.bids.some((b: any) => b.bidId === mcpBidId), 'the bid must be readable over REST');
});

await test('22. …and refuses a bid on an extension the caller does not own, and on an unknown need', async () => {
    const notMine = await callTool(consumerSession, 'aimeat_exchange_bid', { need_id: mcpNeedId, ext: EXT, action: 'validate' });
    assert(notMine.isError && notMine.text.includes('FORBIDDEN'),
        `bidding with somebody else's extension must be refused: ${notMine.text.slice(0, 200)}`);

    const noNeed = await callTool(providerSession, 'aimeat_exchange_bid', { need_id: 'need-ei-olemassa', ext: EXT, action: 'validate' });
    assert(noNeed.isError && noNeed.text.includes('NOT_FOUND'), `an unknown need: ${noNeed.text.slice(0, 200)}`);
});

await test('23. aimeat_exchange_bid_accept mints the entitlement and matches the need', async () => {
    const out = await callTool(consumerSession, 'aimeat_exchange_bid_accept', {
        need_id: seededNeedId, bid_id: seededBidId, cap_units: 50,
    });
    assert(!out.isError, `bid_accept refused: ${out.text.slice(0, 300)}`);
    assert(out.data.entitlement_id && out.data.ext === EXT && out.data.action === 'bidme',
        `the minted contract names the capability: ${JSON.stringify(out.data)}`);

    const mine = await json('/v1/exchange/needs?mine=1', { headers: authed(consumerAgent) });
    const need = (mine.body.data.needs ?? []).find((n: any) => n.needId === seededNeedId);
    assert(need?.state === 'matched', `the accepted need must read matched, got ${need?.state}`);

    const list = await json('/v1/exchange/entitlements', { headers: authed(consumerAgent) });
    assert((list.body.data.entitlements ?? []).some((e: any) => e.action === 'bidme'),
        'the entitlement the bid produced must be in the consumer\'s contracts');
});

await test('24. …a need that is not the caller\'s, and a bid already taken, are both refused', async () => {
    const notMine = await callTool(providerSession, 'aimeat_exchange_bid_accept', { need_id: seededNeedId, bid_id: seededBidId });
    assert(notMine.isError && notMine.text.includes('NOT_FOUND'),
        `only the requester may accept a bid on their need: ${notMine.text.slice(0, 200)}`);

    const again = await callTool(consumerSession, 'aimeat_exchange_bid_accept', { need_id: seededNeedId, bid_id: seededBidId });
    assert(again.isError, `a bid that is no longer open must not be accepted twice: ${again.text.slice(0, 200)}`);
});

console.log('\nPhase 5 — the provider side');

await test('25. aimeat_exchange_consumers shows the provider who holds contracts against its offering', async () => {
    const out = await callTool(providerSession, 'aimeat_exchange_consumers', { offering_id: extOfferingId });
    assert(!out.isError, `consumers refused: ${out.text.slice(0, 300)}`);
    assert(out.data.offeringId === extOfferingId, `the answer names the offering: ${JSON.stringify(out.data.offeringId)}`);
    assert(out.data.consumers.some((c: any) => String(c.consumerGaii ?? c.consumer_gaii ?? '').includes(consumer.owner)),
        `the consumer that accepted must appear: ${JSON.stringify(out.data.consumers)}`);

    const rest = await json(`/v1/exchange/offerings/${extOfferingId}/consumers`, { headers: authed(provider.token) });
    assert(rest.status === 200 && rest.body.data.count === out.data.count,
        `the two doors must count the same lineage: ${rest.body.data.count} vs ${out.data.count}`);
});

await test('26. …and refuses the lineage of an offering that is not the caller\'s', async () => {
    const stranger = await callTool(consumerSession, 'aimeat_exchange_consumers', { offering_id: extOfferingId });
    assert(stranger.isError && stranger.text.includes('NOT_FOUND'),
        `who buys from a provider is the provider's to read: ${stranger.text.slice(0, 200)}`);
});

console.log('\nPhase 6 — an app tool\'s input is checked against its published schema');

// The shape of Lifecycle Central's decision_record, which on 2026-09-19 took five calls to learn five
// required fields because the node passed input through and the extension named one field per refusal.
const STRICT_APP = 'mcpstrictapp';
const STRICT_SCHEMA = {
    type: 'object', required: ['title', 'ruling', 'why'], additionalProperties: false,
    properties: { title: { type: 'string', minLength: 3 }, ruling: { type: 'string' }, why: { type: 'string' } },
};

await test('27. The provider publishes an unpriced tool whose schema requires three fields', async () => {
    const w = await json('/v1/memory', {
        method: 'POST', headers: authed(provider.token),
        body: JSON.stringify({
            key: `apps.${STRICT_APP}.tools`, visibility: 'public',
            value: { version: 1, tools: [{ name: 'record', action_id: `ext:${EXT}:unpriced`, inputSchema: STRICT_SCHEMA }] },
        }),
    });
    assert(w.status === 201, `manifest write ${w.status}: ${JSON.stringify(w.body?.error)}`);
});

await test('28. aimeat_app_tool_invoke with an empty input names EVERY missing field in one refusal', async () => {
    const out = await callTool(providerSession, 'aimeat_app_tool_invoke', { owner: provider.owner, app: STRICT_APP, tool: 'record', input: {} });
    assert(out.isError && out.text.startsWith('INVALID_INPUT'), `expected INVALID_INPUT: ${out.text.slice(0, 300)}`);
    for (const f of ['title', 'ruling', 'why']) assert(out.text.includes(f), `the refusal must name "${f}": ${out.text.slice(0, 400)}`);
});

// A matching input passes the check and the tool RUNS. Until 2026-10-13 this case asserted
// CAPABILITY_NOT_FOUND here, with the reason "this suite registers no capability (that is an
// operator's aggregate)": an installed, active extension's action had no capability row until the
// five-minute aggregation, and the suite never waited for it. That window is the defect closed on
// that day (capability-aggregator.ts aggregateExtensionNow: the rows are made when the extension
// goes live), so this case asserted the hole, and now asserts what a caller is owed: the result.
await test('29. …an undeclared field is named too, and a complete input passes the check and runs', async () => {
    const extra = await callTool(providerSession, 'aimeat_app_tool_invoke', {
        owner: provider.owner, app: STRICT_APP, tool: 'record', input: { title: 'abc', ruling: 'r', why: 'w', decidedBy: 'x' },
    });
    assert(extra.isError && extra.text.includes('"decidedBy"'), `the unknown field must be named: ${extra.text.slice(0, 300)}`);
    const ok = await callTool(providerSession, 'aimeat_app_tool_invoke', {
        owner: provider.owner, app: STRICT_APP, tool: 'record', input: { title: 'abc', ruling: 'r', why: 'w' },
    });
    assert(!ok.text.startsWith('INVALID_INPUT'), `a matching input must pass the check: ${ok.text.slice(0, 300)}`);
    assert(!ok.isError && !ok.text.includes('CAPABILITY_NOT_FOUND'), `…and the tool answers, with no wait for an aggregation: ${ok.text.slice(0, 300)}`);
    const answered = JSON.parse(ok.text);
    assert(answered.result?.echo?.title === 'abc' && answered.result?.echo?.why === 'w', `the extension's own answer comes back: ${ok.text.slice(0, 300)}`);
});

await test('30. The REST twin answers 400 with the same missing fields in details.missing', async () => {
    const r = await json(`/v1/apps/${provider.owner}/${STRICT_APP}/webmcp/tools/record`, {
        method: 'POST', headers: authed(consumer.token), body: JSON.stringify({ input: { title: 'abc' } }),
    });
    assert(r.status === 400 && r.body?.error?.code === 'INVALID_INPUT', `expected 400 INVALID_INPUT, got ${r.status} ${JSON.stringify(r.body?.error)}`);
    assert(JSON.stringify(r.body.error.details?.missing) === JSON.stringify(['ruling', 'why']),
        `details.missing must list both: ${JSON.stringify(r.body.error.details)}`);
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);
