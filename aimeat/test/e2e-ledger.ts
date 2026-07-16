/**
 * @file e2e-ledger.ts
 * @description E2E tests for the agent LLM usage ledger (LEDGER / TARGET-016): ingest via
 *   the telemetry llm_call path records priced, append-only usage events + daily rollups;
 *   the /v1/ledger/usage and /v1/ledger/usage/runs read APIs aggregate them owner-scoped.
 *   Covers: priced call (table), provider-reported cost, unpriced model (cost stays null,
 *   not 0), per-run drill-down, group_by, owner isolation, and auth gating.
 * @version-history
 *   v1.0.0 -- 2026-07-10 -- Initial creation for LEDGER TARGET-016
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

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function json(path: string, opts: RequestInit = {}, retries = 5): Promise<{ status: number; body: any }> {
    for (let attempt = 0; attempt <= retries; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            ...opts,
            headers: { 'Content-Type': 'application/json', ...opts.headers },
        });
        const ct = res.headers.get('content-type') ?? '';
        const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
        if (res.status === 429 && attempt < retries) {
            const retryAfter = Number(res.headers.get('Retry-After') || '5');
            await sleep(retryAfter * 1000 + 500);
            continue;
        }
        return { status: res.status, body };
    }
    throw new Error('unreachable');
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

async function getToken(ownerOrGaii: string, privKey: string, isAgent: boolean): Promise<string> {
    const timestamp = new Date().toISOString();
    const message = isAgent ? ownerOrGaii + timestamp : ownerOrGaii + NODE_ID + timestamp;
    const signature = await signMsg(privKey, message);
    const payload = isAgent
        ? { gaii: ownerOrGaii, timestamp, signature }
        : { owner: ownerOrGaii, timestamp, signature };
    const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify(payload) });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    return body.data.token;
}

async function registerOwnerAndAgent(prefix: string): Promise<{
    ownerName: string; ownerToken: string; agentName: string; agentGaii: string; agentToken: string;
}> {
    const ownerName = `${prefix}${Date.now()}${Math.floor(performance.now())}`;
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register owner: ${reg.status} ${JSON.stringify(reg.body)}`);
    const ownerToken = await getToken(ownerName, reg.body.data.private_key, false);

    const agentName = 'ledgerbot';
    const ar = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: agentName, owner: ownerName, capabilities: ['memory'] }),
    });
    assert(ar.status === 201, `register agent: ${ar.status} ${JSON.stringify(ar.body)}`);
    const agentGaii = ar.body.data.agent.gaii;
    const agentToken = await getToken(agentGaii, ar.body.data.private_key, true);
    return { ownerName, ownerToken, agentName, agentGaii, agentToken };
}

/** POST an llm_call telemetry event (the ledger ingest path). */
async function reportLlmCall(ownerToken: string, agentName: string, data: Record<string, unknown>) {
    return json(`/v1/agents/${agentName}/telemetry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ type: 'llm_call', data }),
    });
}

console.log('\n=== AIMEAT LEDGER (TARGET-016) E2E Test ===\n');

console.log('Setup -- Owner & Agent');
const a = await registerOwnerAndAgent('ledgerowner');

// ─── Phase 1: Ingest via telemetry llm_call ───
console.log('\nPhase 1 -- Ingest priced + provider-cost + unpriced calls');

await test('1. Priced call (table: claude-sonnet) -> 201', async () => {
    const { status, body } = await reportLlmCall(a.ownerToken, a.agentName, {
        model: 'claude-sonnet-4-6', provider: 'anthropic',
        prompt_tokens: 1000, completion_tokens: 500, run_id: 'run-alpha',
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
});

await test('2. Provider-reported cost (opus, cost_usd) -> 201', async () => {
    const { status } = await reportLlmCall(a.ownerToken, a.agentName, {
        model: 'claude-opus-4', provider: 'openrouter',
        prompt_tokens: 2000, completion_tokens: 800, cost_usd: 0.02, run_id: 'run-alpha',
    });
    assert(status === 201, `status ${status}`);
});

await test('3. Unpriced model (no rate, no provider cost) -> 201', async () => {
    const { status } = await reportLlmCall(a.ownerToken, a.agentName, {
        model: 'obscure-model-zzz', provider: 'local-lab',
        prompt_tokens: 300, completion_tokens: 100, run_id: 'run-beta',
    });
    assert(status === 201, `status ${status}`);
});

await test('4. Bare llm_call without model is accepted, records NO usage event', async () => {
    const { status } = await reportLlmCall(a.ownerToken, a.agentName, { tokens_in: 50, tokens_out: 20 });
    assert(status === 201, `status ${status}`);
});

// ─── Phase 2: Read aggregates ───
console.log('\nPhase 2 -- /v1/ledger/usage aggregates');

await test('5. group_by=day totals: 3 usage calls, sonnet+opus cost, 1 unpriced', async () => {
    const { status, body } = await json(`/v1/ledger/usage?agent=${encodeURIComponent(a.agentGaii)}&group_by=day`, {
        headers: { Authorization: `Bearer ${a.ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const t = body.data.totals;
    assert(t.calls === 3, `calls: ${t.calls} (expected 3 — bare llm_call excluded)`);
    assert(t.unpriced_calls === 1, `unpriced_calls: ${t.unpriced_calls} (expected 1)`);
    // sonnet: 1000*3/1e6 + 500*15/1e6 = 0.0105 ; opus provider cost: 0.02 ; unpriced: 0
    const expected = 0.0105 + 0.02;
    assert(Math.abs(t.cost_usd - expected) < 1e-6, `cost_usd: ${t.cost_usd} (expected ~${expected})`);
    assert(t.prompt_tokens === 3300, `prompt_tokens: ${t.prompt_tokens} (expected 3300)`);
    assert(t.completion_tokens === 1400, `completion_tokens: ${t.completion_tokens} (expected 1400)`);
});

await test('6. group_by=model splits sonnet / opus / unpriced', async () => {
    const { status, body } = await json(`/v1/ledger/usage?agent=${encodeURIComponent(a.agentGaii)}&group_by=model`, {
        headers: { Authorization: `Bearer ${a.ownerToken}` },
    });
    assert(status === 200, `status ${status}`);
    const keys = body.data.groups.map((g: any) => g.key);
    assert(keys.includes('claude-sonnet-4-6'), `has sonnet: ${keys.join(',')}`);
    assert(keys.includes('claude-opus-4'), `has opus: ${keys.join(',')}`);
    assert(keys.includes('obscure-model-zzz'), `has unpriced model: ${keys.join(',')}`);
    const unpriced = body.data.groups.find((g: any) => g.key === 'obscure-model-zzz');
    assert(unpriced.cost_usd === 0 && unpriced.unpriced_calls === 1, `unpriced group cost 0 / unpriced 1: ${JSON.stringify(unpriced)}`);
});

await test('7. Invalid group_by -> 400', async () => {
    const { status } = await json(`/v1/ledger/usage?group_by=nonsense`, {
        headers: { Authorization: `Bearer ${a.ownerToken}` },
    });
    assert(status === 400, `status ${status}`);
});

// ─── Phase 3: Per-run drill-down ───
console.log('\nPhase 3 -- /v1/ledger/usage/runs');

await test('8. runs grouped by run_id; run-alpha holds sonnet+opus', async () => {
    const { status, body } = await json(`/v1/ledger/usage/runs?agent=${encodeURIComponent(a.agentGaii)}`, {
        headers: { Authorization: `Bearer ${a.ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const alpha = body.data.runs.find((r: any) => r.run_id === 'run-alpha');
    assert(!!alpha, `run-alpha present: ${body.data.runs.map((r: any) => r.run_id).join(',')}`);
    assert(alpha.calls === 2, `run-alpha calls: ${alpha.calls} (expected 2)`);
    assert(alpha.models.includes('claude-sonnet-4-6') && alpha.models.includes('claude-opus-4'),
        `run-alpha models: ${alpha.models.join(',')}`);
    const beta = body.data.runs.find((r: any) => r.run_id === 'run-beta');
    assert(beta && beta.unpriced_calls === 1, `run-beta unpriced: ${JSON.stringify(beta)}`);
});

// ─── Phase 3b: Usage subtab composite (mount fold) ───
console.log('\nPhase 3b -- /v1/ledger/usage/overview composite');

await test('8b. /usage/overview == GET /usage?group_by=model (totals+groups) + GET /usage/runs (runs)', async () => {
    const { status, body } = await json(`/v1/ledger/usage/overview?agent=${encodeURIComponent(a.agentGaii)}`, {
        headers: { Authorization: `Bearer ${a.ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const d = body.data;
    assert(d.group_by === 'model', `group_by should be model, got ${d.group_by}`);

    const usage = await json(`/v1/ledger/usage?agent=${encodeURIComponent(a.agentGaii)}&group_by=model`, {
        headers: { Authorization: `Bearer ${a.ownerToken}` },
    });
    assert(JSON.stringify(d.totals) === JSON.stringify(usage.body.data.totals), 'totals match /usage?group_by=model');
    assert(JSON.stringify(d.groups) === JSON.stringify(usage.body.data.groups), 'groups match /usage?group_by=model');

    const runs = await json(`/v1/ledger/usage/runs?agent=${encodeURIComponent(a.agentGaii)}&limit=50`, {
        headers: { Authorization: `Bearer ${a.ownerToken}` },
    });
    assert(JSON.stringify(d.runs) === JSON.stringify(runs.body.data.runs), 'runs match /usage/runs');
});

await test('8c. usage/overview cross-owner isolation: a different owner sees ZERO', async () => {
    const b = await registerOwnerAndAgent('ledgerother2');
    const { status, body } = await json('/v1/ledger/usage/overview', {
        headers: { Authorization: `Bearer ${b.ownerToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.data.totals.calls === 0, `cross-owner leak: calls=${body.data.totals.calls}`);
    assert(body.data.groups.length === 0 && body.data.runs.length === 0, `cross-owner leak: ${body.data.groups.length} groups / ${body.data.runs.length} runs`);
});

// ─── Phase 4: Owner isolation + auth ───
console.log('\nPhase 4 -- Owner isolation & auth gating');

await test('9. A different owner sees ZERO of this owner\'s usage', async () => {
    const b = await registerOwnerAndAgent('ledgerother');
    const { status, body } = await json(`/v1/ledger/usage?group_by=day`, {
        headers: { Authorization: `Bearer ${b.ownerToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.data.totals.calls === 0, `cross-owner leak: calls=${body.data.totals.calls}`);
    assert(body.data.groups.length === 0, `cross-owner leak: ${body.data.groups.length} groups`);
});

await test('10. Unauthenticated -> 401', async () => {
    const { status } = await json(`/v1/ledger/usage`);
    assert(status === 401, `status ${status}`);
});

await test('11. Agent/app token of the owner sees the OWNER ledger (scoped by req.auth.owner)', async () => {
    // FLEET reads scope to the human owner behind any session (owner/agent/app-grant), so an
    // agent token belonging to owner `a` sees a's 3 usage calls — this is what lets the AGENCY
    // app grant read the owner's ledger. Cross-owner isolation is proven separately in test 9.
    const { status, body } = await json(`/v1/ledger/usage?group_by=day`, {
        headers: { Authorization: `Bearer ${a.agentToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.totals.calls === 3,
        `owner's own agent should see the owner ledger (3 calls): calls=${body.data.totals.calls}`);
});

// ─── Phase 5: Budget tracking + threshold alerts (TARGET-017) ───
console.log('\nPhase 5 -- Budget status & ATTN alerts');

const c = await registerOwnerAndAgent('ledgerbudget');

async function notifications(token: string) {
    const { status, body } = await json(`/v1/notifications`, { headers: { Authorization: `Bearer ${token}` } });
    assert(status === 200, `notifications status ${status}`);
    return body.data.notifications as any[];
}

await test('12. Set daily budget to $0.02', async () => {
    const { status } = await json(`/v1/ai/settings`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${c.ownerToken}` },
        body: JSON.stringify({ daily_budget_usd: 0.02 }),
    });
    assert(status === 200, `status ${status}`);
});

await test('13. Spend to 85% -> warn alert fires (budget_alert 80%)', async () => {
    const { status } = await reportLlmCall(c.ownerToken, c.agentName, {
        model: 'claude-sonnet-4-6', provider: 'openrouter',
        prompt_tokens: 100, completion_tokens: 50, cost_usd: 0.017, run_id: 'run-c1',
    });
    assert(status === 201, `status ${status}`);
    const alerts = (await notifications(c.ownerToken)).filter(n => n.type === 'budget_alert');
    assert(alerts.length === 1, `expected 1 budget_alert, got ${alerts.length}`);
    assert(alerts[0].title.includes('80%'), `title: ${alerts[0].title}`);
});

await test('14. GET /v1/ledger/budget shows level=warn, ratio~0.85', async () => {
    const { status, body } = await json(`/v1/ledger/budget`, { headers: { Authorization: `Bearer ${c.ownerToken}` } });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.level === 'warn', `level: ${body.data.level}`);
    assert(Math.abs(body.data.spent_usd - 0.017) < 1e-6, `spent: ${body.data.spent_usd}`);
    assert(body.data.daily_budget_usd === 0.02, `budget: ${body.data.daily_budget_usd}`);
    assert(body.data.top_consumers.length === 1, `top_consumers: ${JSON.stringify(body.data.top_consumers)}`);
});

await test('15. Spend past 100% -> over alert fires (now 2 budget_alerts)', async () => {
    const { status } = await reportLlmCall(c.ownerToken, c.agentName, {
        model: 'claude-sonnet-4-6', provider: 'openrouter',
        prompt_tokens: 100, completion_tokens: 50, cost_usd: 0.01, run_id: 'run-c2',
    });
    assert(status === 201, `status ${status}`);
    const alerts = (await notifications(c.ownerToken)).filter(n => n.type === 'budget_alert');
    assert(alerts.length === 2, `expected 2 budget_alerts, got ${alerts.length}`);
    assert(alerts.some(n => n.title.includes('100%')), `no 100% alert: ${alerts.map(n => n.title).join(' | ')}`);
});

await test('16. Further overspend does NOT re-alert (dedup) -> still 2', async () => {
    const { status } = await reportLlmCall(c.ownerToken, c.agentName, {
        model: 'claude-sonnet-4-6', provider: 'openrouter',
        prompt_tokens: 100, completion_tokens: 50, cost_usd: 0.005, run_id: 'run-c3',
    });
    assert(status === 201, `status ${status}`);
    const alerts = (await notifications(c.ownerToken)).filter(n => n.type === 'budget_alert');
    assert(alerts.length === 2, `dedup failed: ${alerts.length} budget_alerts`);
});

await test('17. Over-budget owner reads level=over', async () => {
    const { body } = await json(`/v1/ledger/budget`, { headers: { Authorization: `Bearer ${c.ownerToken}` } });
    assert(body.data.level === 'over', `level: ${body.data.level}`);
});

// ─── Phase 6: Cost allocation — organism/workspace/capability (TARGET-018) ───
console.log('\nPhase 6 -- Allocation by organism / workspace / capability');

const d = await registerOwnerAndAgent('ledgeralloc');
const buyerGhii = `buyer@${NODE_ID}`;

await test('18. Ingest calls with org/ws context, one unattributed, one capability call', async () => {
    const calls = [
        { model: 'claude-sonnet-4-6', provider: 'openrouter', cost_usd: 0.01, organism_id: 'org-alpha', workspace_id: 'ws-1', run_id: 'run-d1' },
        { model: 'claude-sonnet-4-6', provider: 'openrouter', cost_usd: 0.02, organism_id: 'org-alpha', workspace_id: 'ws-2', run_id: 'run-d2' },
        { model: 'claude-sonnet-4-6', provider: 'openrouter', cost_usd: 0.005, run_id: 'run-d3' }, // no context -> unattributed
        { model: 'claude-sonnet-4-6', provider: 'openrouter', cost_usd: 0.03, capability_id: 'cap-x', consumer_ghii: buyerGhii, run_id: 'run-d4' },
    ];
    for (const data of calls) {
        const { status } = await reportLlmCall(d.ownerToken, d.agentName, data);
        assert(status === 201, `status ${status} for ${JSON.stringify(data)}`);
    }
});

await test('19. group_by=organism: org-alpha=0.03, unattributed present', async () => {
    const { status, body } = await json(`/v1/ledger/usage?group_by=organism`, { headers: { Authorization: `Bearer ${d.ownerToken}` } });
    assert(status === 200, `status ${status}`);
    const alpha = body.data.groups.find((g: any) => g.key === 'org-alpha');
    assert(alpha && Math.abs(alpha.cost_usd - 0.03) < 1e-6, `org-alpha cost: ${JSON.stringify(alpha)}`);
    const unatt = body.data.groups.find((g: any) => g.key === '(unattributed)');
    assert(unatt && Math.abs(unatt.cost_usd - 0.035) < 1e-6, `unattributed cost: ${JSON.stringify(unatt)} (expected 0.035 = 0.005+0.03)`);
});

await test('20. group_by=workspace splits ws-1 / ws-2', async () => {
    const { body } = await json(`/v1/ledger/usage?group_by=workspace`, { headers: { Authorization: `Bearer ${d.ownerToken}` } });
    const ws1 = body.data.groups.find((g: any) => g.key === 'ws-1');
    const ws2 = body.data.groups.find((g: any) => g.key === 'ws-2');
    assert(ws1 && Math.abs(ws1.cost_usd - 0.01) < 1e-6, `ws-1: ${JSON.stringify(ws1)}`);
    assert(ws2 && Math.abs(ws2.cost_usd - 0.02) < 1e-6, `ws-2: ${JSON.stringify(ws2)}`);
});

await test('21. capabilities view: cap-x shows consumer + producer + real cost', async () => {
    const { status, body } = await json(`/v1/ledger/usage/capabilities`, { headers: { Authorization: `Bearer ${d.ownerToken}` } });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.capabilities.length === 1, `expected 1 capability, got ${body.data.capabilities.length}`);
    const cap = body.data.capabilities[0];
    assert(cap.capability_id === 'cap-x', `capability_id: ${cap.capability_id}`);
    assert(Math.abs(cap.cost_usd - 0.03) < 1e-6, `cost_usd: ${cap.cost_usd}`);
    assert(cap.consumers.includes(buyerGhii), `consumers: ${JSON.stringify(cap.consumers)}`);
    assert(cap.producers.includes(d.agentGaii), `producers: ${JSON.stringify(cap.producers)}`);
});

// ─── Phase 7: Monthly billing rollup + self-host/hosted split + CSV (TARGET-019) ───
console.log('\nPhase 7 -- Billing rollup & export');

const e = await registerOwnerAndAgent('ledgerbill');

async function rawText(path: string, token: string): Promise<{ status: number; text: string; ct: string }> {
    const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: res.status, text: await res.text(), ct: res.headers.get('content-type') ?? '' };
}

await test('22. Ingest hosted (node key) + self-host (own key) calls', async () => {
    const calls = [
        { model: 'claude-sonnet-4-6', provider: 'openrouter', cost_usd: 0.04, api_key_scope: 'node', run_id: 'run-e1' },
        { model: 'claude-opus-4', provider: 'openrouter', cost_usd: 0.06, api_key_scope: 'node', run_id: 'run-e2' },
        { model: 'claude-haiku-4', provider: 'anthropic', cost_usd: 0.01, api_key_scope: 'own', run_id: 'run-e3' },
    ];
    for (const data of calls) {
        const { status } = await reportLlmCall(e.ownerToken, e.agentName, data);
        assert(status === 201, `status ${status}`);
    }
});

await test('23. Monthly billing splits billable (node=$0.10) vs self_host (own=$0.01)', async () => {
    const { status, body } = await json(`/v1/ledger/billing`, { headers: { Authorization: `Bearer ${e.ownerToken}` } });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(Math.abs(body.data.totals.cost_usd - 0.11) < 1e-6, `totals: ${body.data.totals.cost_usd}`);
    assert(Math.abs(body.data.billable.cost_usd - 0.10) < 1e-6, `billable (node): ${body.data.billable.cost_usd}`);
    assert(Math.abs(body.data.self_host.cost_usd - 0.01) < 1e-6, `self_host (own): ${body.data.self_host.cost_usd}`);
    assert(body.data.by_model.length === 3, `by_model rows: ${body.data.by_model.length}`);
    assert(typeof body.data.audit === 'string' && body.data.audit.includes('price_ref'), 'audit note present');
});

await test('24. CSV export -> text/csv attachment with model rows', async () => {
    const { status, text, ct } = await rawText(`/v1/ledger/billing?format=csv`, e.ownerToken);
    assert(status === 200, `status ${status}`);
    assert(ct.includes('text/csv'), `content-type: ${ct}`);
    assert(text.startsWith('month,owner_ghii,api_key_scope'), `header: ${text.slice(0, 40)}`);
    assert(text.includes('claude-opus-4') && text.includes('node'), `rows: ${text}`);
});

await test('25. Invalid month -> 400', async () => {
    const { status } = await json(`/v1/ledger/billing?month=2026-7`, { headers: { Authorization: `Bearer ${e.ownerToken}` } });
    assert(status === 400, `status ${status}`);
});

// ─── Summary ───
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
