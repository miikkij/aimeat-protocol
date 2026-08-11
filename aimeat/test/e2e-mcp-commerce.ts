/**
 * @file test/e2e-mcp-commerce.ts
 * @description E2E for the MCP commerce tools (TARGET-033/034 over MCP): scope-gated visibility
 *   (commerce:sell / commerce:buy vs a narrow agent), PSP credentials (masked status — the secret
 *   never appears in any response), app-tool manifest publish + discovery in the node catalog,
 *   offer money pricing in 6-decimal micro-units, and a cross-owner app-tool purchase completed
 *   end-to-end over the MCP surface (task-path fulfillment + fee arithmetic on the wallets).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-commerce
 * @version-history
 *   v1.0.0 — 2026-07-14 — Initial MCP commerce suite
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

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

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function signMsg(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}

function parseSSE(text: string): any[] {
    const out: any[] = [];
    for (const evt of text.split('\n\n')) {
        let data = '';
        for (const line of evt.trim().split('\n')) if (line.startsWith('data: ')) data += line.slice(6);
        if (data) { try { out.push(JSON.parse(data)); } catch { /* skip */ } }
    }
    return out;
}

/** One MCP session (OAuth token + streamable HTTP session id) with a tools/call helper. */
class McpSession {
    token = ''; sessionId = ''; rpcId = 0;
    constructor(private path: string = '/v1/mcp') {}
    async rpc(method: string, params: Record<string, any> = {}) {
        const id = ++this.rpcId;
        const res = await fetch(`${BASE}${this.path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
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
        } else body = await res.json();
        return { status: res.status, body };
    }
    async call(name: string, args: Record<string, any> = {}) {
        const { body } = await this.rpc('tools/call', { name, arguments: args });
        const text = body.result?.content?.[0]?.text ?? '';
        let data: any = null;
        try { data = JSON.parse(text); } catch { /* non-JSON tool text */ }
        return { isError: !!body.result?.isError, text, data };
    }
    async init(agentGaii: string, agentPrivKey: string) {
        const reg = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'MCP Commerce E2E', redirect_uris: [] }) });
        assert(reg.status === 201, `oauth register ${reg.status}`);
        const ts = new Date().toISOString();
        const params = new URLSearchParams({
            response_type: 'code', client_id: reg.body.client_id, gaii: agentGaii,
            signature: await signMsg(agentPrivKey, agentGaii + NODE_ID + ts), timestamp: ts,
        });
        const auth = await json(`/v1/mcp/authorize?${params}`);
        assert(typeof auth.body.code === 'string', `authorize: ${JSON.stringify(auth.body)}`);
        const tok = await json('/v1/mcp/token', {
            method: 'POST',
            body: JSON.stringify({ grant_type: 'authorization_code', code: auth.body.code, client_id: reg.body.client_id, client_secret: reg.body.client_secret }),
        });
        assert(tok.status === 200, `token ${tok.status}`);
        this.token = tok.body.access_token;
        const init = await this.rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'MCP Commerce E2E', version: '1.0.0' } });
        assert(init.status === 200 && init.body.result !== undefined, `initialize ${init.status}`);
        await fetch(`${BASE}${this.path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
                Authorization: `Bearer ${this.token}`, 'mcp-session-id': this.sessionId, 'mcp-protocol-version': '2025-03-26',
            },
            body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        });
    }
}

async function setupOwner(label: string) {
    const name = `mcpcom${label}${Date.now().toString(36)}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'MCP Commerce', password: 'McpCom1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'MCP Commerce', password: 'McpCom1234' }) }); }
    assert(reg.status === 201, `ghii ${reg.status}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }) });
    return { name, token: tok.body.data.token as string };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
async function balance(token: string): Promise<number> {
    const r = await json('/v1/wallet', { headers: auth(token) });
    return Number(r.body.data.balance ?? r.body.data.total ?? 0);
}

console.log('\n=== AIMEAT MCP Commerce E2E ===\n');

// ─── Setup: neutral operator-catcher, buyer owner + MCP agents, seller owner (REST side) ───

let op: Awaited<ReturnType<typeof setupOwner>>;
let buyerOwner: Awaited<ReturnType<typeof setupOwner>>;
let sellerOwner: Awaited<ReturnType<typeof setupOwner>>;
const mcp = new McpSession();       // commerce-scoped agent
const narrow = new McpSession();    // memory-only agent (scope filter check)
let sellerAppRef = '';
let traderGaii = '', traderKey = ''; // reused for the /v2/mcp/commerce session

await test('Setup: owners + commerce-scoped and narrow MCP agents + seller manifest', async () => {
    op = await setupOwner('o'); // fresh-DB operator self-heal catcher (fee neutrality)
    buyerOwner = await setupOwner('b');
    sellerOwner = await setupOwner('s');

    // Commerce-scoped agent: granular scopes, NOT '*', to prove the gates open exactly right.
    const a1 = await json('/v1/agents', {
        method: 'POST', headers: auth(buyerOwner.token),
        body: JSON.stringify({ name: 'trader', owner: buyerOwner.name, capabilities: ['commerce'], scopes: ['commerce:buy', 'commerce:sell', 'commerce:psp', 'memory:read', 'memory:write'] }),
    });
    assert(a1.status === 201, `trader ${a1.status}: ${JSON.stringify(a1.body.error)}`);
    traderGaii = a1.body.data.agent.gaii;
    traderKey = a1.body.data.private_key;
    await mcp.init(traderGaii, traderKey);

    // Narrow agent: memory scopes only — commerce tools must be filtered from its surface.
    const a2 = await json('/v1/agents', {
        method: 'POST', headers: auth(buyerOwner.token),
        body: JSON.stringify({ name: 'narrowbot', owner: buyerOwner.name, capabilities: ['memory'], scopes: ['memory:read', 'memory:write'] }),
    });
    assert(a2.status === 201, `narrowbot ${a2.status}`);
    await narrow.init(a2.body.data.agent.gaii, a2.body.data.private_key);

    // Seller side over REST (the cross-owner counterparty): an agent + a priced task-path app-tool.
    const vendor = await json('/v1/agents', {
        method: 'POST', headers: auth(sellerOwner.token),
        body: JSON.stringify({ name: 'vendor', owner: sellerOwner.name, capabilities: ['social'] }),
    });
    assert(vendor.status === 201, `vendor ${vendor.status}`);
    sellerAppRef = `${sellerOwner.name}/shop.html`;
    const manifest = { tools: [{ name: 'concierge', description: 'White-glove run (task path)', price: { morsels: 3, unit: 'per-call' }, agent: 'vendor' }] };
    const w = await json('/v1/memory', { method: 'POST', headers: auth(sellerOwner.token), body: JSON.stringify({ key: 'apps.shop.html.tools', value: manifest, visibility: 'public' }) });
    assert(w.status === 200 || w.status === 201, `seller manifest ${w.status}`);
});

// ─── Phase 1: scope-gated tool surface ───
console.log('\nPhase 1 — Scope-gated surface');

await test('1. Commerce agent sees all 9 commerce tools', async () => {
    const { body } = await mcp.rpc('tools/list', {});
    const names = new Set(body.result.tools.map((t: any) => t.name));
    for (const n of ['aimeat_commerce_psp_set', 'aimeat_commerce_psp_status', 'aimeat_commerce_psp_delete',
        'aimeat_app_tools_publish', 'aimeat_app_tools_get', 'aimeat_offer_price_set',
        'aimeat_checkout_open', 'aimeat_checkout_complete', 'aimeat_checkout_list']) {
        assert(names.has(n), `missing ${n}`);
    }
});

await test('2. Narrow agent (memory-only) is filtered: no commerce tools except the public read', async () => {
    const { body } = await narrow.rpc('tools/list', {});
    const names = new Set(body.result.tools.map((t: any) => t.name));
    assert(!names.has('aimeat_commerce_psp_set'), 'psp_set must be filtered (commerce:sell)');
    assert(!names.has('aimeat_checkout_open'), 'checkout_open must be filtered (commerce:buy)');
    assert(names.has('aimeat_app_tools_get'), 'app_tools_get is ungated (public manifests)');
});

// ─── Phase 2: PSP credentials (masked, never echoed) ───
console.log('\nPhase 2 — PSP credentials');

const SECRET = 'sk_test_mcp_secret_9x8y7z_TAIL';

await test('3. psp_set stores + returns only a masked hint', async () => {
    const r = await mcp.call('aimeat_commerce_psp_set', { provider: 'stripe', secret_key: SECRET });
    assert(!r.isError, `psp_set: ${r.text}`);
    assert(r.data.configured === true && r.data.provider === 'stripe', `ack: ${r.text}`);
    assert(r.data.key_hint === '…TAIL', `masked hint: ${r.data.key_hint}`);
    assert(!r.text.includes(SECRET), 'the secret must never appear in the response');
});

await test('4. psp_status is masked; the raw record is private to the owner', async () => {
    const r = await mcp.call('aimeat_commerce_psp_status', {});
    assert(!r.isError && r.data.configured === true, `status: ${r.text}`);
    assert(!r.text.includes(SECRET), 'status must not leak the secret');
    // Cross-owner public read of the record must not exist (visibility private).
    const pub = await json(`/v1/memory/${encodeURIComponent(`${buyerOwner.name}@${NODE_ID}`)}/commerce.psp`);
    assert(pub.status !== 200 || !(JSON.stringify(pub.body).includes(SECRET)), 'commerce.psp must not be publicly readable');
});

await test('5. psp_delete removes the credentials', async () => {
    const del = await mcp.call('aimeat_commerce_psp_delete', {});
    assert(!del.isError && del.data.deleted === true, `delete: ${del.text}`);
    const st = await mcp.call('aimeat_commerce_psp_status', {});
    assert(st.data.configured === false, `status after delete: ${st.text}`);
});

// ─── Phase 3: app-tool manifest + offer pricing (seller side, own owner) ───
console.log('\nPhase 3 — Selling config');

await test('6. app_tools_publish declares a priced tool; it lands in the node catalog', async () => {
    const r = await mcp.call('aimeat_app_tools_publish', {
        app_id: 'mcpshop.html',
        tools: [{ name: 'summarize', description: 'Paid summary (task path)', price: { morsels: 2 }, priceMoney: { amount: 2000, currency: 'EUR' } }],
    });
    assert(!r.isError, `publish: ${r.text}`);
    assert(r.data.tools[0].sku === `app-tool:${buyerOwner.name}/mcpshop.html:summarize`, `sku: ${r.text}`);
    assert(r.data.tools[0].fulfillment === 'task' && r.data.tools[0].priced === true, `entry: ${r.text}`);
    const cat = await json('/v1/commerce/tools');
    const entry = (cat.body.tools || []).find((t: any) => t.sku === r.data.tools[0].sku);
    assert(!!entry && entry.priceMoney?.amount === 2000 && entry.priceMoney?.currency === 'EUR', `catalog: ${JSON.stringify(entry)}`);
});

await test('7. app_tools_get reads own manifest; invalid manifest is rejected loudly', async () => {
    const r = await mcp.call('aimeat_app_tools_get', { app_id: 'mcpshop.html' });
    assert(!r.isError && r.data.manifest.tools[0].name === 'summarize', `get: ${r.text}`);
    const bad = await mcp.call('aimeat_app_tools_publish', { app_id: 'mcpshop.html', tools: [{ name: 'BAD NAME WITH SPACES' }] });
    assert(bad.isError && bad.text.includes('INVALID_TOOL_MANIFEST'), `invalid manifest: ${bad.text}`);
});

await test('7c. A manifest past the memory value ceiling is refused, and the good one survives', async () => {
    // The manifest is a memory record, and it used to be written straight to storage — so none of
    // memory's ceilings applied to it. The schema allows 200 tools and a 10 000-character
    // description each, which is 2 MB against a 1024 kB per-value budget, so the only thing that
    // would ever have bounded this record was the check that was missing. Every later read of that
    // key would have paid for it.
    const fat = Array.from({ length: 200 }, (_, i) => ({
        name: `bloat${i}`, description: 'x'.repeat(10_000),
    }));
    const r = await mcp.call('aimeat_app_tools_publish', { app_id: 'mcpfat.html', tools: fat });
    assert(r.isError, `a 2 MB manifest was accepted: ${r.text.slice(0, 200)}`);
    assert(/QUOTA_EXCEEDED|exceeds limit/i.test(r.text), `expected a size refusal, got: ${r.text.slice(0, 200)}`);

    // The positive control, and the "nothing was half-written" check in one: the manifest published
    // in test 6 is still readable and unchanged.
    const still = await mcp.call('aimeat_app_tools_get', { app_id: 'mcpshop.html' });
    assert(!still.isError && still.data.manifest.tools[0].name === 'summarize',
        `the earlier manifest did not survive: ${still.text.slice(0, 200)}`);
});

await test('7b. A missed app id NAMES the manifests this owner does publish', async () => {
    // An app id is a filename and carries its extension; the app's own subdomain does not. An agent
    // that read `mcpshop.apps.…` asked for "mcpshop", was told the app declares no manifest, believed
    // it, and went off to download the app's HTML. The bare "not found" was true of the key and false
    // of the app, so the error has to name what is actually there.
    const r = await mcp.call('aimeat_app_tools_get', { app_id: 'mcpshop' });
    assert(r.isError, `a wrong id must still fail: ${r.text}`);
    assert(r.text.includes('APP_TOOLS_NOT_FOUND'), `keeps its code: ${r.text}`);
    assert(r.text.includes('mcpshop.html'), `names the real app id, got: ${r.text}`);
    assert(r.text.includes('includes its extension'), `says WHY the id missed, got: ${r.text}`);
});

await test('8. offer_price_set prices an own offer in morsels + EUR micro-units', async () => {
    // Base offer doc via REST (owner token passes requireRole("agent") for own agents).
    const pub = await json('/v1/agents/trader/offers', {
        method: 'PUT', headers: auth(buyerOwner.token),
        body: JSON.stringify({ offers: [{ id: 'research', title: 'Research run', ask: 'I research a topic.', deliverable: { format: 'document', sample: 'untested' } }] }),
    });
    assert(pub.status === 200, `offers publish ${pub.status}: ${JSON.stringify(pub.body.error)}`);
    const r = await mcp.call('aimeat_offer_price_set', {
        agent_name: 'trader', offer_id: 'research',
        price_morsels: 7, money_amount_micros: 1500000, money_currency: 'EUR', visibility: 'public',
    });
    assert(!r.isError, `price_set: ${r.text}`);
    assert(r.data.price.morsels === 7 && r.data.priceMoney.amount === 1500000 && r.data.priceMoney.currency === 'EUR', `priced: ${r.text}`);
    const back = await json('/v1/agents/trader/offers', { headers: auth(buyerOwner.token) });
    const offer = (back.body.data.offers || []).find((o: any) => o.id === 'research');
    assert(offer?.priceMoney?.amount === 1500000 && offer?.visibility === 'public', `persisted: ${JSON.stringify(offer)}`);
    // Foreign agent names never resolve (GAII is built from the SESSION owner).
    const foreign = await mcp.call('aimeat_offer_price_set', { agent_name: 'vendor', offer_id: 'x', price_morsels: 1 });
    assert(foreign.isError && foreign.text.includes('AGENT_NOT_FOUND'), `foreign agent: ${foreign.text}`);
});

// ─── Phase 4: buying over MCP (cross-owner app-tool, task-path fulfillment) ───
console.log('\nPhase 4 — Buying over MCP');

let boughtSessionId = '';

await test('9. checkout_open quotes the seller app-tool', async () => {
    const r = await mcp.call('aimeat_checkout_open', {
        items: [{ kind: 'app-tool', app: sellerAppRef, tool: 'concierge', input: { brief: 'mcp purchase' } }],
        note: 'bought over MCP',
    });
    assert(!r.isError, `open: ${r.text}`);
    boughtSessionId = r.data.session.id;
    assert(r.data.session.total === 3 && r.data.session.sellerOwner === sellerOwner.name, `quote: ${JSON.stringify(r.data.session)}`);
});

await test('10. checkout_complete charges the buyer owner + queues the seller task (fee arithmetic)', async () => {
    const buyerBefore = await balance(buyerOwner.token);
    const sellerBefore = await balance(sellerOwner.token);
    const r = await mcp.call('aimeat_checkout_complete', { session_id: boughtSessionId });
    assert(!r.isError, `complete: ${r.text}`);
    const s = r.data.session;
    assert(s.status === 'completed' && s.receipt.charged === 3, `receipt: ${JSON.stringify(s.receipt)}`);
    assert(s.receipt.charged === s.receipt.earned + s.receipt.fee, 'fee arithmetic');
    assert((s.fulfillment?.taskIds || []).length === 1, `taskIds: ${JSON.stringify(s.fulfillment)}`);
    assert(await balance(buyerOwner.token) === buyerBefore - 3, 'buyer owner debited');
    assert(await balance(sellerOwner.token) === sellerBefore + s.receipt.earned, 'seller owner credited (minus fee)');
    const tasks = await json('/v1/agents/vendor/tasks', { headers: auth(sellerOwner.token) });
    const task = (tasks.body.data.tasks || []).find((t: any) => t.id === s.fulfillment.taskIds[0]);
    assert(!!task && String(task.description).includes('mcp purchase'), 'seller task carries the buyer input');
});

await test('11. checkout_list shows the purchase; unknown session errors cleanly', async () => {
    const r = await mcp.call('aimeat_checkout_list', { limit: 10 });
    assert(!r.isError, `list: ${r.text}`);
    assert((r.data || []).some((s: any) => s.id === boughtSessionId), 'purchase in the list');
    const ghost = await mcp.call('aimeat_checkout_complete', { session_id: 'cs_no-such-session' });
    assert(ghost.isError && ghost.text.includes('SESSION_NOT_FOUND'), `ghost: ${ghost.text}`);
});

// ─── Phase 5: the /v2/mcp/commerce surface ───
console.log('\nPhase 5 — Commerce surface');

await test('12. /v2/mcp/commerce serves the selling baseline and nothing else', async () => {
    const ent = new McpSession('/v2/mcp/commerce');
    await ent.init(traderGaii, traderKey);
    const { body } = await ent.rpc('tools/list', {});
    const names = new Set(body.result.tools.map((t: any) => t.name));
    // Baseline present (scope-permitting): commerce + the memory a listing lives in.
    for (const n of ['aimeat_commerce_psp_status', 'aimeat_app_tools_publish', 'aimeat_checkout_open', 'aimeat_app_tools_get', 'aimeat_memory_read']) {
        assert(names.has(n), `commerce baseline missing ${n}`);
    }
    // Surface discipline: unrelated core tools stay off this surface.
    assert(!names.has('aimeat_board_post') && !names.has('aimeat_admin_mint'), 'non-commerce tools stay off the commerce surface');
    // The surface is fully usable, not just listable.
    const st = await ent.call('aimeat_commerce_psp_status', {});
    assert(!st.isError && st.data.configured === false, `psp status over commerce surface: ${st.text}`);
});

await test('13. Unknown v2 role still rejects cleanly', async () => {
    const res = await fetch(`${BASE}/v2/mcp/nonsense`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    const body = await res.json() as any;
    assert(res.status === 400 && String(body.error?.message).includes('commerce'), `unknown role: ${res.status} ${JSON.stringify(body.error)}`);
});

console.log(`\n${'═'.repeat(50)}`);
console.log(`MCP Commerce E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('═'.repeat(50));
await new Promise<void>(r => process.stdout.write('', r));
process.exit(failed > 0 ? 1 : 0);
