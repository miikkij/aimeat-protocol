/**
 * @file test/e2e-mcp-beneficiary.ts
 * @description E2E for the beneficiary-split MCP tools — the agent surface the REST routes shipped
 *   without, which meant configuring a revenue split from a chat needed a hand-rolled bearer token.
 *
 *   Proves over the real MCP transport that an agent can declare who shares what its owner earns,
 *   read what it is owed and what it owes, release a share, and (as an operator) record the approval
 *   that gates a payout — and that each of those refuses when it should: a narrow agent never sees
 *   the selling tools, a non-operator cannot open the payout gate for its own payees, and nobody
 *   declares a split against somebody else's revenue.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-mcp-beneficiary
 * @version-history
 *   v1.0.0 — 2026-07-30 — Initial.
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
async function signMsg(priv: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(priv, 'base64'))).toString('base64');
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

/** One MCP session over the streamable-HTTP transport, with a tools/call helper. */
class McpSession {
    token = ''; sessionId = ''; rpcId = 0;
    async rpc(method: string, params: Record<string, any> = {}) {
        const id = ++this.rpcId;
        const res = await fetch(`${BASE}/v1/mcp`, {
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
        const body = ct.includes('text/event-stream')
            ? (parseSSE(await res.text()).find(m => m.id === id) ?? {})
            : await res.json();
        return { status: res.status, body };
    }
    async call(name: string, args: Record<string, any> = {}) {
        const { body } = await this.rpc('tools/call', { name, arguments: args });
        const text = body.result?.content?.[0]?.text ?? JSON.stringify(body.error ?? {});
        let data: any = null;
        try { data = JSON.parse(text); } catch { /* tool returned prose */ }
        return { isError: !!body.result?.isError, text, data };
    }
    async tools(): Promise<string[]> {
        const { body } = await this.rpc('tools/list', {});
        return (body.result?.tools ?? []).map((t: any) => t.name);
    }
    async init(gaii: string, priv: string) {
        const reg = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'MCP Beneficiary E2E', redirect_uris: [] }) });
        assert(reg.status === 201, `oauth register ${reg.status}`);
        const ts = new Date().toISOString();
        const params = new URLSearchParams({
            response_type: 'code', client_id: reg.body.client_id, gaii,
            signature: await signMsg(priv, gaii + NODE_ID + ts), timestamp: ts,
        });
        const auth = await json(`/v1/mcp/authorize?${params}`);
        assert(typeof auth.body.code === 'string', `authorize: ${JSON.stringify(auth.body)}`);
        const tok = await json('/v1/mcp/token', {
            method: 'POST',
            body: JSON.stringify({ grant_type: 'authorization_code', code: auth.body.code, client_id: reg.body.client_id, client_secret: reg.body.client_secret }),
        });
        assert(tok.status === 200, `token ${tok.status}`);
        this.token = tok.body.access_token;
        const init = await this.rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'MCP Beneficiary E2E', version: '1.0.0' } });
        assert(init.status === 200 && init.body.result !== undefined, `initialize ${init.status}`);
        await fetch(`${BASE}/v1/mcp`, {
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
    const name = `mcpben${label}${Date.now().toString(36)}`;
    const reg0 = () => json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'MCP Beneficiary', password: 'McpBen1234' }) });
    let reg = await reg0();
    for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await reg0(); }
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }) });
    return { name, ghii: `${name}@${NODE_ID}`, token: tok.body.data.token as string };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Attach an agent to an owner with the given scopes and open an MCP session as it. */
async function agentSession(ownerToken: string, ownerName: string, label: string, scopes: string[]) {
    const r = await json('/v1/agents', {
        method: 'POST', headers: auth(ownerToken),
        body: JSON.stringify({ name: `${label}${Date.now().toString(36)}`, owner: ownerName, capabilities: ['commerce'], scopes }),
    });
    assert(r.status === 201, `agent ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const gaii = r.body.data.agent.gaii as string;
    const s = new McpSession();
    await s.init(gaii, r.body.data.private_key);
    return { gaii, session: s, ownerName };
}

console.log('\n=== AIMEAT MCP BENEFICIARY E2E (the agent surface for the second rake) ===\n');

const EXT = `mcpben${Date.now().toString(36)}`;
// Money: a share is revenue. Morsels pace usage and are never shared, so nothing here is priced in them.
const PRICE = 500_000;
const SCRIPTS = {
    designating: 'export default async function(ctx, input){ return { ok: true, _revenue: { beneficiaries: [{ ghii: input.pay_to, weight: 1 }] } }; }',
};
const manifest = (name: string) => JSON.stringify({
    metadata: { name, version: '1.0.0', description: 'mcp beneficiary e2e provider', author: 'e2e' },
    actions: [{ id: 'lookup', method: 'POST', path: '/lookup', script: 'designating', commercial: { payMoney: { amount: PRICE, currency: 'EUR' } } }],
    config: { public_access: { default: true } },
    limits: { timeout_ms: 5000, max_api_calls: 1 },
});

let operator: Awaited<ReturnType<typeof setupOwner>>;
let provider: Awaited<ReturnType<typeof setupOwner>>;
let consumer: Awaited<ReturnType<typeof setupOwner>>;
let benef: Awaited<ReturnType<typeof setupOwner>>;
let opAgent: Awaited<ReturnType<typeof agentSession>>;
let provAgent: Awaited<ReturnType<typeof agentSession>>;
let benefAgent: Awaited<ReturnType<typeof agentSession>>;
let narrowAgent: Awaited<ReturnType<typeof agentSession>>;
let trackingCode = '';

await test('Setup: operator, provider, beneficiary and consumer, each with an MCP agent', async () => {
    operator = await setupOwner('op');   // first owner on a fresh DB auto-becomes operator
    provider = await setupOwner('prov');
    consumer = await setupOwner('cons');
    benef = await setupOwner('ben');

    opAgent = await agentSession(operator.token, operator.name, 'opa', ['wallet:read']);
    // ext:invoke is separate from ext:write since the 2026-08-10 scope work: publishing an extension
    // and running one are different promises, and running one can spend the caller's morsels. An
    // agent that does both needs both words. (The REST invoke route asks for no scope at all, so
    // this door is deliberately the stricter of the two.)
    provAgent = await agentSession(provider.token, provider.name, 'prova', ['commerce:sell', 'wallet:read', 'ext:write', 'ext:invoke']);
    benefAgent = await agentSession(benef.token, benef.name, 'bena', ['wallet:read']);
    narrowAgent = await agentSession(provider.token, provider.name, 'narrow', ['memory:read']);

    const inst = await json('/v1/extensions', { method: 'POST', headers: auth(provider.token), body: JSON.stringify({ manifest: manifest(EXT), scripts: SCRIPTS }) });
    assert(inst.status === 201 || inst.status === 200, `install ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
    const act = await json(`/v1/extensions/${EXT}/activate`, { method: 'POST', headers: auth(provider.token) });
    assert(act.status === 200, `activate ${act.status}`);
});

// ── Scope gating: a narrow agent is never even offered the selling tools ──────

await test('A narrow agent does not see the beneficiary selling tools at all', async () => {
    const names = await narrowAgent.session.tools();
    assert(names.length > 0, 'the narrow agent sees some tools');
    for (const t of ['aimeat_commerce_beneficiary_split_set', 'aimeat_commerce_beneficiary_splits', 'aimeat_commerce_beneficiary_release']) {
        assert(!names.includes(t), `memory-only agent must not be offered ${t}`);
    }
});

await test('A commerce:sell agent is offered them', async () => {
    const names = await provAgent.session.tools();
    for (const t of ['aimeat_commerce_beneficiary_split_set', 'aimeat_commerce_beneficiary_splits', 'aimeat_commerce_beneficiary_release']) {
        assert(names.includes(t), `commerce:sell agent should be offered ${t}, got ${names.filter(n => n.includes('beneficiary')).join(',')}`);
    }
});

// ── Declaring a split over MCP ───────────────────────────────────────────────

await test('An agent declares a dynamic split for its OWNER', async () => {
    const r = await provAgent.session.call('aimeat_commerce_beneficiary_split_set', {
        ext: EXT, action: 'lookup', pool_percent: 50, dynamic: true, capability: 'MCP beneficiary e2e',
    });
    assert(!r.isError, `split_set errored: ${r.text}`);
    assert(r.data?.split?.poolPercent === 50, `pool: ${JSON.stringify(r.data?.split)}`);
    assert(r.data?.split?.dynamic === true, 'dynamic flag round-trips');
    // The revenue being given away has to be the giver's: never a provider id from the arguments.
    assert(r.data?.split?.providerGhii === provider.ghii, `written for the caller's owner, got ${r.data?.split?.providerGhii}`);
});

await test('A split with no beneficiaries and not dynamic is refused', async () => {
    const r = await provAgent.session.call('aimeat_commerce_beneficiary_split_set', {
        ext: EXT, action: 'nothing', pool_percent: 50,
    });
    assert(r.isError, `expected an error, got ${r.text}`);
    assert(/EMPTY_SPLIT/.test(r.text), `expected EMPTY_SPLIT, got ${r.text}`);
});

await test('A malformed beneficiary GHII is refused', async () => {
    const r = await provAgent.session.call('aimeat_commerce_beneficiary_split_set', {
        ext: EXT, action: 'lookup', pool_percent: 50, beneficiaries: [{ ghii: 'not-a-ghii' }],
    });
    assert(r.isError && /INVALID_GHII/.test(r.text), `expected INVALID_GHII, got ${r.text}`);
});

await test('The agent lists its owner\'s splits, and only those', async () => {
    const r = await provAgent.session.call('aimeat_commerce_beneficiary_splits', {});
    assert(!r.isError, `splits errored: ${r.text}`);
    assert(r.data.count >= 1, `expected at least one split, got ${r.data.count}`);
    assert(r.data.splits.every((s: any) => s.providerGhii === provider.ghii), 'only the caller\'s own');
});

// ── A real settled call, then the two sides of the book over MCP ─────────────

await test('A settled call accrues a share the BENEFICIARY reads over MCP', async () => {
    const a = await json('/v1/exchange/entitlements', {
        method: 'POST', headers: auth(consumer.token),
        body: JSON.stringify({ ext: EXT, action: 'lookup', contract_ref: 'c-mcpben', cap_units: 50_000_000 }),
    });
    assert(a.status === 201, `accept ${a.status}: ${JSON.stringify(a.body?.error)}`);
    const rake = Number(a.body.data.entitlement.rake_per_call);

    const call = await json(`/v1/ext/${EXT}/lookup`, {
        method: 'POST', headers: auth(consumer.token), body: JSON.stringify({ pay_to: benef.ghii }),
    });
    assert(call.status === 200, `call ${call.status}: ${JSON.stringify(call.body?.error)}`);

    const r = await benefAgent.session.call('aimeat_commerce_beneficiary_earnings', {});
    assert(!r.isError, `earnings errored: ${r.text}`);
    assert(r.data.role === 'beneficiary' && r.data.beneficiary === benef.ghii, `identity: ${JSON.stringify(r.data.beneficiary)}`);
    const expected = Math.floor((PRICE - rake) * 50 / 100);
    assert(r.data.totals?.EUR?.accrued === expected, `accrued: expected ${expected}, got ${JSON.stringify(r.data.totals)}`);
    assert(r.data.verification.payable === false, 'nothing is payable before an approval exists');
});

await test('The PROVIDER reads the other side of the same book over MCP', async () => {
    const r = await provAgent.session.call('aimeat_commerce_beneficiary_earnings', { role: 'provider' });
    assert(!r.isError, `obligations errored: ${r.text}`);
    assert(r.data.role === 'provider' && r.data.provider === provider.ghii, 'the provider identity');
    const entry = r.data.entries.find((e: any) => e.beneficiaryGhii === benef.ghii && e.status === 'accrued');
    assert(!!entry, `expected an accrued obligation: ${JSON.stringify(r.data.entries)}`);
    assert(entry.kind === 'dynamic', `named per call, got ${entry.kind}`);
    trackingCode = entry.trackingCode;
    assert(!!trackingCode, 'the obligation carries the code a release needs');
});

// ── The payout gate, over MCP ────────────────────────────────────────────────

await test('Releasing to an unverified beneficiary is refused over MCP', async () => {
    const r = await provAgent.session.call('aimeat_commerce_beneficiary_release', {
        tracking_code: trackingCode, beneficiary: benef.ghii,
    });
    assert(r.isError && /BENEFICIARY_UNVERIFIED/.test(r.text), `expected BENEFICIARY_UNVERIFIED, got ${r.text}`);
});

await test('A NON-operator agent cannot open the gate, not even for itself', async () => {
    for (const [who, a] of [['provider', provAgent], ['beneficiary', benefAgent]] as const) {
        const r = await a.session.call('aimeat_commerce_beneficiary_approve', {
            ghii: benef.ghii, state: 'verified', method: 'self-serve',
        });
        assert(r.isError && /FORBIDDEN/.test(r.text), `${who} should be refused, got ${r.text}`);
    }
});

await test('Anyone may READ their own approval state', async () => {
    const r = await benefAgent.session.call('aimeat_commerce_beneficiary_approve', {});
    assert(!r.isError, `read errored: ${r.text}`);
    assert(r.data.ghii === benef.ghii && r.data.state === 'unverified', `own state: ${JSON.stringify(r.data)}`);
});

await test('Reading somebody ELSE\'s approval state needs the operator role', async () => {
    const r = await provAgent.session.call('aimeat_commerce_beneficiary_approve', { ghii: benef.ghii });
    assert(r.isError && /FORBIDDEN/.test(r.text), `expected FORBIDDEN, got ${r.text}`);
});

await test('An operator verification must say HOW representation was established', async () => {
    const r = await opAgent.session.call('aimeat_commerce_beneficiary_approve', { ghii: benef.ghii, state: 'verified' });
    assert(r.isError && /INVALID_INPUT/.test(r.text), `expected INVALID_INPUT, got ${r.text}`);
});

await test('The OPERATOR verifies, and the release then settles over MCP', async () => {
    const ap = await opAgent.session.call('aimeat_commerce_beneficiary_approve', {
        ghii: benef.ghii, state: 'verified', method: 'manual-operator', subject: 'fi-ytunnus:3323553-5', evidence: 'mcp e2e',
    });
    assert(!ap.isError, `approve errored: ${ap.text}`);
    assert(ap.data.approval.state === 'verified' && ap.data.approval.method === 'manual-operator', `approval: ${JSON.stringify(ap.data.approval)}`);

    const morselsBefore = Number((await json('/v1/wallet', { headers: auth(benef.token) })).body.data.balance);
    const rel = await provAgent.session.call('aimeat_commerce_beneficiary_release', {
        tracking_code: trackingCode, beneficiary: benef.ghii,
    });
    assert(!rel.isError, `release errored: ${rel.text}`);
    assert(rel.data.method === 'payable-booked', `method: ${rel.data.method}`);
    assert(rel.data.currency === 'EUR' && Number(rel.data.amount) > 0, `released: ${rel.text}`);
    // Releasing takes on the debt; the money moves when the provider signs a payout. And it never
    // touches the pacing meter, which is a different quantity entirely.
    const morselsAfter = Number((await json('/v1/wallet', { headers: auth(benef.token) })).body.data.balance);
    assert(morselsAfter === morselsBefore, `no morsels move on a money release: ${morselsBefore} -> ${morselsAfter}`);
});

await test('The same share cannot be released twice over MCP', async () => {
    const r = await provAgent.session.call('aimeat_commerce_beneficiary_release', {
        tracking_code: trackingCode, beneficiary: benef.ghii,
    });
    assert(r.isError && /NOTHING_ACCRUED/.test(r.text), `expected NOTHING_ACCRUED, got ${r.text}`);
});

await test('Withdrawing a split over MCP leaves accrued shares standing', async () => {
    const before = await benefAgent.session.call('aimeat_commerce_beneficiary_earnings', {});
    const releasedBefore = before.data.totals?.morsels?.released ?? 0;
    const r = await provAgent.session.call('aimeat_commerce_beneficiary_splits', { remove_ext: EXT, remove_action: 'lookup' });
    assert(!r.isError && r.data.removed === true, `remove errored: ${r.text}`);
    const after = await benefAgent.session.call('aimeat_commerce_beneficiary_earnings', {});
    assert((after.data.totals?.morsels?.released ?? 0) === releasedBefore, 'what was earned survives the withdrawal');
    const gone = await provAgent.session.call('aimeat_commerce_beneficiary_splits', { remove_ext: EXT, remove_action: 'lookup' });
    assert(gone.isError && /NOT_FOUND/.test(gone.text), `second removal should 404, got ${gone.text}`);
});

await test('The MCP invoke door strips `_revenue` too, not just the REST one', async () => {
  // Found in PRODUCTION: the raw MCP extension-invoke path returned the key verbatim while the
  // REST path stripped it, so which door you came through decided whether you saw who the seller
  // shares its margin with. That door settles nothing, but disclosure is not a settlement question.
  const r = await provAgent.session.call('aimeat_extension_invoke', {
    extension_name: EXT, action_id: 'lookup', input: { pay_to: benef.ghii },
  });
  assert(!r.isError, `invoke errored: ${r.text}`);
  assert(!r.text.includes('_revenue'), `the designation key leaked over MCP: ${r.text.slice(0, 300)}`);
  assert(r.data?.ok === true, `the rest of the result survives: ${r.text.slice(0, 200)}`);
});

await test('MCP: the payout tool quotes what is owed, and refuses without an address', async () => {
  // The last leg reached the agent surface too. A quote is a read; settling needs a signature the
  // node never holds, so the tool hands back requirements rather than moving anything itself.
  const r = await provAgent.session.call('aimeat_commerce_beneficiary_payout', { beneficiary: benef.ghii });
  assert(r.isError, `no payout address is configured, so a quote must refuse: ${r.text}`);
  assert(/BENEFICIARY_NO_ADDRESS|NOTHING_OWED/.test(r.text), `expected a named reason, got ${r.text}`);
});

console.log(`\n=== MCP BENEFICIARY E2E: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
