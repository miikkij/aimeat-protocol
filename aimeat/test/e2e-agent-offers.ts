/**
 * @file e2e-agent-offers.ts
 * @description E2E for the Agent Offers surface (v1): an agent/owner publishes `agents.{name}.offers`
 *   (validated against the offer descriptor), reads them back, and the owner aggregate `GET /v1/offers`
 *   joins each agent's offers with its mode + online state. Covers the happy path + invalid-descriptor
 *   rejection + owner-scoping.
 * @version-history
 *   v1.3.0 — 2026-08-16 — E2E quality, agent-offers :116, :82 and :207. The money had never moved in this
 *     suite: all three invokes stopped at a refusal, the last of them at the missing-capability 404, so
 *     the price, the debit, the 402, the refund, the fee, the provider's credit, both ledger rows and
 *     the receipt had never executed. Test 14b builds a capability that really dispatches, 14c buys
 *     from a different owner and reads every morsel back, 14d proves the refusal happens before the
 *     work. Plus the cross-owner publish refusal, which the bare-name request in test 7 could not
 *     reach, and what a stranger sees of the offer list when an offer declares no visibility at all.
 *   v1.0.0 — 2026-06-12 — Initial: publish/read/aggregate + validation.
 *   v1.1.0 — 2026-06-13 — Cover deliverable.format "image" round-trip (test 11b) for the inline
 *     image deliverable rendering feature.
 *   v1.2.0 — 2026-06-16 — Richer Offerings: json deliverable + object sample round-trip (15), per-offer
 *     run history via deliverables.offer_id (16), and prerequisite gating runnable/blocked (17).
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
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
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

/**
 * Test 7 sends a BARE agent name, which the route resolves under the CALLER's owner, so B is asking
 * about an agent of its own that does not exist and the 404 comes from the lookup. The cross-owner
 * refusal one line further down (`agent.owner !== owner` → 403 ACCESS_DENIED) was unreachable by that
 * request, and no suite in the tree reached it either: an offer document is what an agent sells and
 * for how much, so writing another owner's is the interesting act, not writing a missing one's.
 */
await test('7b. Owner B cannot publish offers for A\'s agent addressed by its full GAII → 403', async () => {
    const before = await json(`/v1/agents/${agentName}/offers`, { headers: auth(A.token) });
    const versionBefore = before.body.data?.version;
    const idsBefore = JSON.stringify((before.body.data?.offers ?? []).map((o: any) => o.id));

    const providerGaii = encodeURIComponent(`${agentName}#${A.name}@${NODE_ID}`);
    const r = await json(`/v1/agents/${providerGaii}/offers`, {
        method: 'PUT', headers: auth(B.token),
        body: JSON.stringify({ offers: [{ ...validOffers.offers[0], id: 'hijacked', title: 'Mine now' }] }),
    });
    assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.error?.code === 'ACCESS_DENIED', `expected ACCESS_DENIED, got ${r.body.error?.code}`);

    // A 200 that wrote nothing would still be a defect, so the document is read back rather than trusted.
    const after = await json(`/v1/agents/${agentName}/offers`, { headers: auth(A.token) });
    assert(after.body.data?.version === versionBefore, `the version moved: ${versionBefore} → ${after.body.data?.version}`);
    assert(JSON.stringify((after.body.data?.offers ?? []).map((o: any) => o.id)) === idsBefore,
        `the offer list changed: ${idsBefore} → ${JSON.stringify((after.body.data?.offers ?? []).map((o: any) => o.id))}`);
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

await test('11b. An offer can declare deliverable.format "image" and round-trips', async () => {
    // The new image deliverable format (rendered inline by the shared image renderer across the
    // task / memory / offers / workflow surfaces). A real /v1/pub image url is the sample. Republish
    // ALONGSIDE the v2 offers so the later invoke gates (12–14) still resolve research-topic/summarize.
    const imgDoc = { offers: [
        ...v2Doc.offers,
        {
            id: 'generate-image', title: 'Generate an image',
            ask: 'Describe an image; I generate it and return a public URL.',
            deliverable: {
                format: 'image',
                location: { space: 'crews.image-maker.images', visibility: 'owner' },
                sample: { url: 'https://aimeat.io/v1/pub/x%23o%40n/images/test.jpg', mime: 'image/jpeg' },
            },
        },
    ] };
    const pub = await json(`/v1/agents/${agentName}/offers`, { method: 'PUT', headers: auth(A.token), body: JSON.stringify(imgDoc) });
    assert(pub.status === 200, `publish ${pub.status}: ${JSON.stringify(pub.body.error)}`);
    const r = await json(`/v1/agents/${agentName}/offers`, { headers: auth(A.token) });
    const o = (r.body.data.offers || []).find((x: any) => x.id === 'generate-image');
    assert(!!o && o.deliverable?.format === 'image', `image format preserved: ${JSON.stringify(o?.deliverable)}`);
});

/**
 * Every GET of this document in the file reads it as A, the agent's own owner, for whom the route
 * returns the list unfiltered. What a STRANGER sees has never been read here. The unset-visibility
 * case is the part no other suite covers: research-topic declares no visibility at all, and silence
 * has to mean private rather than public.
 */
await test('11c. A stranger sees only the public offers, and an offer that said nothing stays hidden', async () => {
    const providerGaii = encodeURIComponent(`${agentName}#${A.name}@${NODE_ID}`);
    const r = await json(`/v1/agents/${providerGaii}/offers`, { headers: auth(B.token) });
    assert(r.status === 200, `stranger read: ${r.status}: ${JSON.stringify(r.body.error)}`);
    const ids = (r.body.data.offers ?? []).map((o: any) => o.id);
    assert(ids.includes('summarize'), `the public offer must be visible: ${JSON.stringify(ids)}`);
    assert(!ids.includes('research-topic'), `an offer with no visibility must not be shown to a stranger: ${JSON.stringify(ids)}`);
    // The owner still sees both, which is what makes the line above a filter rather than a deletion.
    const own = await json(`/v1/agents/${agentName}/offers`, { headers: auth(A.token) });
    const ownIds = (own.body.data.offers ?? []).map((o: any) => o.id);
    assert(ownIds.includes('research-topic') && ownIds.includes('summarize'), `the owner sees everything: ${JSON.stringify(ownIds)}`);
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

/**
 * THE MONEY HAS NEVER MOVED IN THIS SUITE. The three invokes above all stop at a refusal, and the
 * last of them stops at `if (!cap) 404`, so everything after that line — the price, the debit, the
 * 402, the refund, the marketplace fee, the provider's credit, both ledger rows and the receipt —
 * has never executed. A priced offer is the agent economy's till, and nothing rang it.
 *
 * Three things had to be true for a real invoke: a capability that actually dispatches (an extension
 * action of A's), the offer bound to it, and a caller who is NOT the provider, since offers.ts treats
 * a self-invoke as free.
 */
const extName = `offersecho${Date.now() % 1000000}`;
const capId = `offers-echo-${Date.now() % 1000000}`;
let paidOfferReady = false;

await test('14b. A callable capability of A, backed by a real extension action', async () => {
    const manifest = JSON.stringify({
        metadata: { name: extName, version: '1.0.0', description: 'Offers E2E: an action a paid offer can call', author: A.name },
        actions: [{ id: 'echo', method: 'POST', path: '/echo', script: 'echo', description: 'Echo the input back' }],
        limits: { timeout_ms: 5000, max_api_calls: 1 },
    });
    const script = 'export default async function(ctx, input){ return { echoed: "Echo: " + (input.message || "(empty)") }; }';
    const inst = await json('/v1/extensions', {
        method: 'POST', headers: auth(A.token),
        body: JSON.stringify({ manifest, scripts: { echo: script } }),
    });
    assert(inst.status === 201 || inst.status === 200, `install ${inst.status}: ${JSON.stringify(inst.body.error)}`);
    const act = await json(`/v1/extensions/${extName}/activate`, { method: 'POST', headers: auth(A.token) });
    assert(act.status === 200, `activate ${act.status}: ${JSON.stringify(act.body.error)}`);

    // Private on purpose: this node runs capabilityPublishing 'self_only', and the offer's own
    // visibility is what decides who may buy. The capability is the machinery behind it.
    const cap = await json('/v1/capabilities', {
        method: 'POST', headers: auth(A.token),
        body: JSON.stringify({
            id: capId, name: 'Offers echo', summary: 'Echoes the input back', visibility: 'private',
            source: { type: 'extension', ref: `ext:${extName}:echo` }, callable: true,
            usage: 'POST an input object; the same message comes back.',
        }),
    });
    assert(cap.status === 201, `capability ${cap.status}: ${JSON.stringify(cap.body.error)}`);
    paidOfferReady = true;
});

await test('14c. A pays for an invoke: the buyer is debited, the provider credited, both rows written', async () => {
    assert(paidOfferReady, 'the capability fixture must exist');
    const pub = await json(`/v1/agents/${agentName}/offers`, {
        method: 'PUT', headers: auth(A.token),
        body: JSON.stringify({ offers: [
            validOffers.offers[0],
            {
                id: 'summarize', title: 'Summarize a URL', ask: 'Give me a URL; I return a summary.',
                deliverable: { format: 'document', sample: 'untested' },
                price: { morsels: 25, unit: 'per-call' }, visibility: 'public',
                callable: { action_id: capId },
            },
        ] }),
    });
    assert(pub.status === 200, `publish ${pub.status}: ${JSON.stringify(pub.body.error)}`);

    const balance = async (token: string) => {
        const w = await json('/v1/wallet', { headers: auth(token) });
        assert(w.status === 200, `wallet ${w.status}`);
        return Number(w.body.data.balance);
    };
    const buyerBefore = await balance(B.token);
    const providerBefore = await balance(A.token);

    const providerGaii = encodeURIComponent(`${agentName}#${A.name}@${NODE_ID}`);
    const r = await json(`/v1/agents/${providerGaii}/offers/summarize/invoke`, {
        method: 'POST', headers: auth(B.token), body: JSON.stringify({ input: { message: 'hello' } }),
    });
    assert(r.status === 200, `invoke ${r.status}: ${JSON.stringify(r.body.error)}`);

    const receipt = r.body.data?.receipt ?? {};
    assert(receipt.charged === 25, `the buyer must be charged the asking price, got ${JSON.stringify(receipt)}`);
    assert(typeof receipt.earned === 'number' && typeof receipt.fee === 'number', `receipt shape: ${JSON.stringify(receipt)}`);
    assert(receipt.earned + receipt.fee === 25, `the fee comes out of the price, not on top: ${JSON.stringify(receipt)}`);
    assert(typeof receipt.trackingCode === 'string' && receipt.trackingCode.length > 0, 'the receipt must carry a tracking code');

    const buyerAfter = await balance(B.token);
    const providerAfter = await balance(A.token);
    assert(buyerBefore - buyerAfter === 25, `the buyer must be down exactly 25: ${buyerBefore} → ${buyerAfter}`);

    // Both explaining rows, under the same tracking code, each on the wallet its owner reads. The
    // ledger is filed under the human, so an agent-keyed row would be invisible here.
    const rows = async (token: string) => {
        const t = await json('/v1/wallet/transactions', { headers: auth(token) });
        assert(t.status === 200, `transactions ${t.status}`);
        return (t.body.data.transactions ?? []) as any[];
    };
    // The fee leg is filed under the same code with a ':<source>' suffix (services/marketplace-fee.ts),
    // so the family is what has to be summed, not the exact string.
    const family = (x: any) => String(x.tracking_code ?? '').startsWith(receipt.trackingCode);
    const buyerRows = (await rows(B.token)).filter(family);
    const spend = buyerRows.find(x => x.type === 'offer_spend');
    assert(!!spend, `the buyer's row is missing for ${receipt.trackingCode}`);
    assert(Number(spend.amount) === -25, `buyer row: ${JSON.stringify(spend)}`);
    const providerRows = (await rows(A.token)).filter(family);
    const earn = providerRows.find(x => x.type === 'offer_earn');
    assert(!!earn, `the provider's row is missing for ${receipt.trackingCode}`);
    assert(Number(earn.amount) === receipt.earned, `provider row: ${JSON.stringify(earn)}`);

    // EVERY MORSEL THAT MOVED IS EXPLAINED BY A ROW, which is the statement worth making and the one
    // that does not depend on who the node operator happens to be. The marketplace fee routes to the
    // operator, and when the provider IS the operator (this suite's owner A is, whenever the suite
    // runs first on a cleared database) the fee comes back as a second row on the same code. Summing
    // the rows covers both worlds; asserting `+ earned` would pass only in one of them.
    const sum = (list: any[]) => list.reduce((n, x) => n + Number(x.amount), 0);
    assert(providerAfter - providerBefore === sum(providerRows),
        `the provider's balance moved by ${providerAfter - providerBefore} but its rows explain ${sum(providerRows)}: ${JSON.stringify(providerRows)}`);
    assert(buyerAfter - buyerBefore === sum(buyerRows),
        `the buyer's balance moved by ${buyerAfter - buyerBefore} but its rows explain ${sum(buyerRows)}: ${JSON.stringify(buyerRows)}`);
});

await test('14d. A price beyond the buyer\'s balance is refused, and nothing moves', async () => {
    assert(paidOfferReady, 'the capability fixture must exist');
    const pub = await json(`/v1/agents/${agentName}/offers`, {
        method: 'PUT', headers: auth(A.token),
        body: JSON.stringify({ offers: [
            validOffers.offers[0],
            {
                id: 'expensive', title: 'Cost the earth', ask: 'Anything, for a lot.',
                deliverable: { format: 'document', sample: 'untested' },
                price: { morsels: 10_000_000, unit: 'per-call' }, visibility: 'public',
                callable: { action_id: capId },
            },
        ] }),
    });
    assert(pub.status === 200, `publish ${pub.status}: ${JSON.stringify(pub.body.error)}`);

    const balance = async (token: string) => Number((await json('/v1/wallet', { headers: auth(token) })).body.data.balance);
    const buyerBefore = await balance(B.token);
    const providerBefore = await balance(A.token);

    const providerGaii = encodeURIComponent(`${agentName}#${A.name}@${NODE_ID}`);
    const r = await json(`/v1/agents/${providerGaii}/offers/expensive/invoke`, {
        method: 'POST', headers: auth(B.token), body: JSON.stringify({ input: { message: 'hello' } }),
    });
    assert(r.status === 402, `expected 402, got ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.error?.code === 'INSUFFICIENT_BALANCE', `expected INSUFFICIENT_BALANCE, got ${r.body.error?.code}`);

    // The refusal happens before the work, so neither side's balance may move by a single morsel.
    assert(await balance(B.token) === buyerBefore, 'the refused buyer was charged');
    assert(await balance(A.token) === providerBefore, 'the provider was paid for work nobody bought');
});

// ── v2.3: richer Offerings — JSON deliverables, per-offer run history, prerequisite gating ──
// Publish a fresh doc carrying the offers these tests need: a structured (json) offer + a gated offer
// whose hard prerequisite (a signal over owner memory) is initially unmet.
const richDoc = { offers: [
    {
        id: 'json-report', title: 'Structured report',
        ask: 'Ask for a report; I return structured JSON.',
        deliverable: {
            format: 'json',
            location: { space: 'crews.reporter.reports', key: 'reports.latest', visibility: 'owner' },
            sample: { title: 'Q2 summary', score: 87, tags: ['growth', 'risk'] },
        },
    },
    {
        id: 'gated-publish', title: 'Publish the report',
        ask: 'Publish the latest report — but only once the data is ready.',
        deliverable: { format: 'document', sample: 'untested' },
        dependsOn: [{ signal: { kind: 'deterministic', key: 'prereq.ready', op: 'nonempty' }, label: 'data ready', hard: true }],
    },
] };

await test('15. A json-format offer with an OBJECT sample round-trips', async () => {
    const pub = await json(`/v1/agents/${agentName}/offers`, { method: 'PUT', headers: auth(A.token), body: JSON.stringify(richDoc) });
    assert(pub.status === 200, `publish ${pub.status}: ${JSON.stringify(pub.body.error)}`);
    const r = await json(`/v1/agents/${agentName}/offers`, { headers: auth(A.token) });
    const o = (r.body.data.offers || []).find((x: any) => x.id === 'json-report');
    assert(!!o && o.deliverable?.format === 'json', `json format preserved: ${JSON.stringify(o?.deliverable)}`);
    assert(o.deliverable.sample && typeof o.deliverable.sample === 'object' && o.deliverable.sample.score === 87,
        `object sample preserved: ${JSON.stringify(o.deliverable.sample)}`);
});

await test('16. A run carries its offer_id in /v1/deliverables so a card can list its own history', async () => {
    const ct = await json(`/v1/agents/${agentName}/tasks`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({
        title: 'Generate the Q2 report', description: 'structured', status: 'queued',
        scope: [{ name: 'offer_id', value: 'json-report', type: 'text' }],
    }) });
    assert(ct.status === 201 || ct.status === 200, `create task ${ct.status}: ${JSON.stringify(ct.body.error)}`);
    const offerTaskId = ct.body.data.task?.id || ct.body.data.id;
    const dl = await json('/v1/deliverables', { headers: auth(A.token) });
    assert(dl.status === 200, `deliverables ${dl.status}`);
    const all = dl.body.data.deliverables || [];
    const entry = all.find((d: any) => d.task_id === offerTaskId);
    assert(!!entry && entry.offer_id === 'json-report', `offer_id stamped: ${JSON.stringify(entry)}`);
    // Filtering by offer_id is exactly what the per-offer "Recent runs" does — and the plain task from
    // test 8 (no offer_id) must NOT match.
    const mine = all.filter((d: any) => d.offer_id === 'json-report' && d.agent === agentName);
    assert(mine.length >= 1 && mine.every((d: any) => d.offer_id === 'json-report'), `per-offer filter: ${mine.length}`);
    assert(!mine.some((d: any) => d.task_id === taskId), 'the no-offer task from test 8 is excluded');
});

await test('17. An offer with an unmet HARD prerequisite is gated; satisfying it makes it runnable', async () => {
    const find = async () => {
        const r = await json('/v1/offers', { headers: auth(A.token) });
        const entry = (r.body.data.agents || []).find((x: any) => x.agent === agentName);
        return (entry?.offers || []).find((o: any) => o.id === 'gated-publish');
    };
    const before = await find();
    assert(!!before?.prereq, `prereq attached: ${JSON.stringify(before)}`);
    assert(before.prereq.blocked === true && before.prereq.runnable === false, `blocked initially: ${JSON.stringify(before.prereq)}`);
    assert(before.prereq.items.some((i: any) => i.hard && !i.ok && i.label === 'data ready'), `unmet item with reason: ${JSON.stringify(before.prereq.items)}`);

    // Satisfy the prerequisite by writing the owner-memory key the signal checks.
    const w = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: 'prereq.ready', value: 'go' }) });
    assert(w.status === 200 || w.status === 201, `memory write ${w.status}: ${JSON.stringify(w.body.error)}`);

    const after = await find();
    assert(after.prereq.blocked === false && after.prereq.runnable === true, `runnable after satisfying: ${JSON.stringify(after.prereq)}`);
});

await test('18. A schedule-born offer is flagged auto in /v1/offers (drives the ⏱ Automatiikassa pin)', async () => {
    const autoDoc = { offers: [
        ...richDoc.offers,
        {
            id: 'daily-digest', title: 'Daily digest',
            ask: 'I compile a digest every morning.',
            deliverable: { format: 'document', sample: 'untested' },
            availability: { scheduleBorn: 'Every morning 08:00' },
        },
    ] };
    const pub = await json(`/v1/agents/${agentName}/offers`, { method: 'PUT', headers: auth(A.token), body: JSON.stringify(autoDoc) });
    assert(pub.status === 200, `publish ${pub.status}: ${JSON.stringify(pub.body.error)}`);
    const r = await json('/v1/offers', { headers: auth(A.token) });
    const entry = (r.body.data.agents || []).find((x: any) => x.agent === agentName);
    const auto = (entry?.offers || []).find((o: any) => o.id === 'daily-digest');
    const plain = (entry?.offers || []).find((o: any) => o.id === 'json-report');
    assert(auto?.auto === true, `schedule-born → auto:true, got ${JSON.stringify(auto?.auto)}`);
    assert(plain?.auto === false, `plain offer → auto:false, got ${JSON.stringify(plain?.auto)}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
