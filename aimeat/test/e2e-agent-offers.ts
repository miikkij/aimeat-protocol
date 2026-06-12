/**
 * @file e2e-agent-offers.ts
 * @description E2E for the Agent Offers surface (v1): an agent/owner publishes `agents.{name}.offers`
 *   (validated against the offer descriptor), reads them back, and the owner aggregate `GET /v1/offers`
 *   joins each agent's offers with its mode + online state. Covers the happy path + invalid-descriptor
 *   rejection + owner-scoping.
 * @version-history
 *   v1.0.0 — 2026-06-12 — Initial: publish/read/aggregate + validation.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-offers

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
ed.etc.sha512Sync = (...m: Uint8Array[]) => new Uint8Array(createHash('sha512').update(ed.etc.concatBytes(...m)).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
async function setupOwner(label: string) {
    const name = `offers${label}${Date.now()}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Offers', password: 'Offers1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Offers', password: 'Offers1234' }) }); }
    assert(reg.status === 201, `ghii ${reg.status}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    return { name, token: tok.body.data.token as string };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

console.log('\n=== AIMEAT Agent Offers E2E ===\n');

let A: Awaited<ReturnType<typeof setupOwner>>;
let B: Awaited<ReturnType<typeof setupOwner>>;
let agentName = '';

const validOffers = {
    offers: [{
        id: 'research-topic', title: 'Research a topic',
        ask: "Ask me to research anything; I return findings + sources. I don't do real-time prices.",
        example: 'Research the EU AI Act impact on small SaaS.',
        tags: ['contract.research-results'],
        cost: 'cheap', latency: 'minutes', repeatability: 'idempotent',
        verification: 'deterministic', dataHandling: 'local-only',
        requirements: [{ need: 'organism membership', fix: 'join' }],
        consequences: [{ type: 'delegates-to-agent', dynamic: true }],
        deliverable: { format: 'document', location: { space: 'shared.research-results', visibility: 'workspace' }, sample: 'untested' },
    }],
};

await test('Setup owner A + B; A creates an agent', async () => {
    A = await setupOwner('a'); B = await setupOwner('b');
    const ag = await json('/v1/agents', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: 'researcher', owner: A.name, capabilities: ['social'] }) });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body.error || ag.body)}`);
    agentName = String(ag.body.data.agent.gaii || '').split('#')[0] || ag.body.data.agent.name;
    assert(!!agentName, `agent name resolved from ${JSON.stringify(ag.body.data.agent)}`);
});

await test('1. Publish a valid offers doc → 200', async () => {
    const r = await json(`/v1/agents/${agentName}/offers`, { method: 'PUT', headers: auth(A.token), body: JSON.stringify(validOffers) });
    assert(r.status === 200, `publish ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data.count === 1 && r.body.data.version === 1, `count/version: ${JSON.stringify(r.body.data)}`);
});

await test('2. Read the agent\'s offers back', async () => {
    const r = await json(`/v1/agents/${agentName}/offers`, { headers: auth(A.token) });
    assert(r.status === 200, `read ${r.status}`);
    const offers = r.body.data.offers || [];
    assert(offers.length === 1 && offers[0].id === 'research-topic', 'offer present');
    assert(offers[0].verification === 'deterministic' && offers[0].dataHandling === 'local-only', 'enums preserved');
});

await test('3. Owner aggregate GET /v1/offers joins offers + mode + online', async () => {
    const r = await json('/v1/offers', { headers: auth(A.token) });
    assert(r.status === 200, `aggregate ${r.status}`);
    const entry = (r.body.data.agents || []).find((x: any) => x.agent === agentName);
    assert(!!entry, 'agent present in aggregate');
    assert(entry.mode === 'interactive', `mode attached, got ${entry.mode}`);
    assert(typeof entry.online === 'boolean' && entry.offers.length === 1, 'online flag + offers');
    assert(r.body.data.total === 1, `total ${r.body.data.total}`);
});

await test('4. Re-publish bumps the version', async () => {
    const r = await json(`/v1/agents/${agentName}/offers`, { method: 'PUT', headers: auth(A.token), body: JSON.stringify(validOffers) });
    assert(r.status === 200 && r.body.data.version === 2, `version bump: ${JSON.stringify(r.body.data)}`);
});

await test('5. An invalid descriptor is rejected (400 INVALID_OFFERS)', async () => {
    const bad = { offers: [{ id: 'x', title: 'x', ask: 'x', verification: 'maybe', deliverable: { format: 'document' } }] };
    const r = await json(`/v1/agents/${agentName}/offers`, { method: 'PUT', headers: auth(A.token), body: JSON.stringify(bad) });
    assert(r.status === 400 && r.body.error?.code === 'INVALID_OFFERS', `expected 400 INVALID_OFFERS, got ${r.status} ${r.body.error?.code}`);
});

await test('6. Publishing for a non-existent agent → 404', async () => {
    const r = await json('/v1/agents/ghost/offers', { method: 'PUT', headers: auth(A.token), body: JSON.stringify(validOffers) });
    assert(r.status === 404, `expected 404, got ${r.status}`);
});

await test('7. Owner B cannot publish offers for A\'s agent (owner-scoped → 404)', async () => {
    const r = await json(`/v1/agents/${agentName}/offers`, { method: 'PUT', headers: auth(B.token), body: JSON.stringify(validOffers) });
    assert(r.status === 404, `expected 404 (B has no such agent), got ${r.status}`);
});

// ── Inbox (phase 2): the deliverables aggregate + rating gate ──
let taskId = '';
await test('8. An asked task appears in the deliverables Inbox with provenance', async () => {
    const ct = await json(`/v1/agents/${agentName}/tasks`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ title: 'Research the AI Act', description: 'find findings + sources', status: 'queued' }) });
    assert(ct.status === 201 || ct.status === 200, `create task ${ct.status}: ${JSON.stringify(ct.body.error)}`);
    taskId = ct.body.data.task?.id || ct.body.data.id;
    assert(!!taskId, `task id from ${JSON.stringify(ct.body.data)}`);
    const dl = await json('/v1/deliverables', { headers: auth(A.token) });
    assert(dl.status === 200, `deliverables ${dl.status}`);
    const entry = (dl.body.data.deliverables || []).find((d: any) => d.task_id === taskId);
    assert(!!entry, 'task present in the deliverables feed');
    assert(entry.agent === agentName && entry.status === 'queued', `provenance: ${JSON.stringify(entry)}`);
    assert('rating' in entry && entry.rating === null, 'unrated by default');
});

await test('9. Rating a non-done task is rejected (only delivered work is rateable)', async () => {
    const r = await json(`/v1/agents/${agentName}/tasks/${taskId}/rate`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ stars: 5, context: 'other', source_grounded: true }) });
    assert(r.status === 409, `expected 409 INVALID_STATE, got ${r.status}: ${JSON.stringify(r.body.error)}`);
});

await test('10. A non-owner cannot read the deliverables aggregate', async () => {
    // B is an owner but has no agents → empty, not an error; the route is owner-scoped by aggregation.
    const r = await json('/v1/deliverables', { headers: auth(B.token) });
    assert(r.status === 200 && !(r.body.data.deliverables || []).some((d: any) => d.task_id === taskId), 'B does not see A\'s deliverables');
});

// ── v2: billable offers (price + visibility + callable binding) ──
// Publish a doc carrying BOTH a v1-style non-callable private offer (research-topic, for the 422/403
// gates) AND a public callable offer pointing at a missing capability (summarize, for the 404 gate).
const v2Doc = { offers: [
    validOffers.offers[0], // research-topic — no visibility (→ private), no callable
    {
        id: 'summarize', title: 'Summarize a URL', ask: 'Give me a URL; I return a summary.',
        deliverable: { format: 'document', sample: 'untested' },
        price: { morsels: 25, unit: 'per-call' }, visibility: 'public',
        callable: { action_id: 'cap-missing-on-purpose' },
    },
] };

await test('11. A v2 offer with price/visibility/callable round-trips through publish→read', async () => {
    const pub = await json(`/v1/agents/${agentName}/offers`, { method: 'PUT', headers: auth(A.token), body: JSON.stringify(v2Doc) });
    assert(pub.status === 200, `publish ${pub.status}: ${JSON.stringify(pub.body.error)}`);
    const r = await json(`/v1/agents/${agentName}/offers`, { headers: auth(A.token) });
    const o = (r.body.data.offers || []).find((x: any) => x.id === 'summarize');
    assert(!!o, 'v2 offer present');
    assert(o.price?.morsels === 25 && o.visibility === 'public' && o.callable?.action_id === 'cap-missing-on-purpose', `v2 fields preserved: ${JSON.stringify(o)}`);
});

await test('12. Invoking an offer with no callable binding → 422 OFFER_NOT_CALLABLE', async () => {
    // A self-invokes research-topic (self skips the visibility gate, falls through to the callable check).
    const r = await json(`/v1/agents/${agentName}/offers/research-topic/invoke`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ input: {} }) });
    assert(r.status === 422 && r.body.error?.code === 'OFFER_NOT_CALLABLE', `expected 422 OFFER_NOT_CALLABLE, got ${r.status} ${r.body.error?.code}`);
});

await test('13. A different owner cannot invoke a private offer → 403 OFFER_PRIVATE', async () => {
    // research-topic has no visibility → defaults to private. B references A's agent by full GAII.
    const providerGaii = encodeURIComponent(`${agentName}#${A.name}@${NODE_ID}`);
    const r = await json(`/v1/agents/${providerGaii}/offers/research-topic/invoke`, { method: 'POST', headers: auth(B.token), body: JSON.stringify({ input: {} }) });
    assert(r.status === 403 && r.body.error?.code === 'OFFER_PRIVATE', `expected 403 OFFER_PRIVATE, got ${r.status} ${r.body.error?.code}`);
});

await test('14. A callable offer whose backing capability is missing → 404 CAPABILITY_NOT_FOUND', async () => {
    // The 'summarize' offer (published in #11) is public + callable but points at a non-existent capability.
    const r = await json(`/v1/agents/${agentName}/offers/summarize/invoke`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ input: { url: 'https://example.com' } }) });
    assert(r.status === 404 && r.body.error?.code === 'CAPABILITY_NOT_FOUND', `expected 404 CAPABILITY_NOT_FOUND, got ${r.status} ${r.body.error?.code}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
