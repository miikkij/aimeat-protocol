/**
 * @file e2e-disputes.ts
 * @description T-3, the dispute escalation flow end to end: open and view, counter-dispute,
 *   re-delivery, accept-fault, partial refund (including the C-3 over-escrow refusal), withdraw,
 *   escalation, operator ruling, and the tamper-evident hash chain the audit log is built on.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *   test/run-e2e-ci.ts --test=e2e-disputes
 * @version-history
 *   v1.0.0 — 2026-08-14 — Header added; file pre-dates header standard.
 *   v1.1.0 — 2026-08-14 — Phase 8 removed with the routes it covered. GET accept-redelivery?otk=
 *     and GET escalate?otk= are deleted, so tests 20 and 21 and their two setups are deleted too.
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

async function json(path: string, opts: RequestInit = {}, retries = 5): Promise<{ status: number; body: any; headers: Headers }> {
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
        return { status: res.status, body, headers: res.headers };
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

// ─── State ───
let ownerToken = '';
let ownerPrivKey = '';
const ownerName = `dispowner${Date.now()}`;

// Second owner for provider agent (avoids SAME_OWNER_WORK)
const provOwnerName = `dispprov${Date.now()}`;
let provOwnerPriv = '';
let provOwnerToken = '';

// Two agents: requester and provider
let requesterToken = '';
let requesterPrivKey = '';
let requesterGaii = '';

let providerToken = '';
let providerPrivKey = '';
let providerGaii = '';

// Track work items and disputes for each phase
const trackingCodes: string[] = [];
const disputeIds: string[] = [];

// Helper: Create a delivered work item (full lifecycle)
async function createDeliveredWork(): Promise<string> {
    // Provider publishes action (idempotent)
    await json('/v1/actions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${providerToken}` },
        body: JSON.stringify({
            id: 'dispute-test-action',
            display_name: 'Dispute Test Action',
            description: 'Action for dispute testing',
            input_schema: { type: 'object', properties: { text: { type: 'string' } } },
            output_schema: { type: 'object', properties: { result: { type: 'string' } } },
            pricing: { base_morsels: 10 },
        }),
    });

    // Requester submits work
    const { body: subBody } = await json('/v1/work', {
        method: 'POST',
        headers: { Authorization: `Bearer ${requesterToken}` },
        body: JSON.stringify({
            action_id: 'dispute-test-action',
            provider_gaii: providerGaii,
            input: { text: 'test input' },
        }),
    });
    assert(subBody.ok === true, `work submit: ${JSON.stringify(subBody.error)}`);
    const tc = subBody.data.tracking_code;

    // Provider accepts
    const { body: accBody } = await json(`/v1/work/${tc}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${providerToken}` },
    });
    assert(accBody.ok === true, `work accept: ${JSON.stringify(accBody.error)}`);

    // Provider delivers
    const { body: delBody } = await json(`/v1/work/${tc}/deliver`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${providerToken}` },
        body: JSON.stringify({ output: { result: 'original output' } }),
    });
    assert(delBody.ok === true, `work deliver: ${JSON.stringify(delBody.error)}`);

    return tc;
}

console.log('\n=== AIMEAT Dispute Escalation E2E Test ===\n');

// ─── Setup: Register owner + 2 agents ───
console.log('Setup — Owner & Agents');

await test('Register owner', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    ownerPrivKey = body.data.private_key;
});

await test('Owner auth token', async () => {
    const timestamp = new Date().toISOString();
    const message = ownerName + NODE_ID + timestamp;
    const signature = await signMsg(ownerPrivKey, message);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: ownerName, timestamp, signature }),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    ownerToken = body.data.token;
});

await test('Register requester agent', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            name: 'requester',
            owner: ownerName,
            capabilities: ['work'],
            model: 'gpt-4o',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    requesterGaii = body.data.agent.gaii;
    requesterPrivKey = body.data.private_key;
});

await test('Requester auth token', async () => {
    const timestamp = new Date().toISOString();
    const message = requesterGaii + timestamp;
    const signature = await signMsg(requesterPrivKey, message);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: requesterGaii, timestamp, signature }),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    requesterToken = body.data.token;
});

await test('Register provider owner', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: provOwnerName, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    provOwnerPriv = body.data.private_key;
});

await test('Provider owner auth token', async () => {
    const timestamp = new Date().toISOString();
    const message = provOwnerName + NODE_ID + timestamp;
    const signature = await signMsg(provOwnerPriv, message);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: provOwnerName, timestamp, signature }),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    provOwnerToken = body.data.token;
});

await test('Register provider agent', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${provOwnerToken}` },
        body: JSON.stringify({
            name: 'provider',
            owner: provOwnerName,
            capabilities: ['work', 'actions'],
            model: 'gpt-4o',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    providerGaii = body.data.agent.gaii;
    providerPrivKey = body.data.private_key;
});

await test('Provider auth token', async () => {
    const timestamp = new Date().toISOString();
    const message = providerGaii + timestamp;
    const signature = await signMsg(providerPrivKey, message);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: providerGaii, timestamp, signature }),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    providerToken = body.data.token;
});

await test('Create delivered work item for Phase 1-3', async () => {
    const tc = await createDeliveredWork();
    trackingCodes.push(tc); // trackingCodes[0]
});

// ─── Phase 1: Dispute Opening & Viewing ───
console.log('\nPhase 1 — Dispute Opening & Viewing');

await test('1. Open dispute (requester)', async () => {
    const tc = trackingCodes[0];
    const { status, body } = await json(`/v1/work/${tc}/dispute`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${requesterToken}` },
        body: JSON.stringify({ reason: 'Output quality is unacceptable' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.status === 'open', `status: ${body.data.status}`);
    assert(typeof body.data.dispute_id === 'string', 'has dispute_id');
    disputeIds.push(body.data.dispute_id); // disputeIds[0]
});

await test('2. View dispute thread', async () => {
    const tc = trackingCodes[0];
    const { status, body } = await json(`/v1/work/${tc}/dispute`, {
        headers: { Authorization: `Bearer ${requesterToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.data.status === 'open', `status: ${body.data.status}`);
    assert(body.data.reason === 'Output quality is unacceptable', 'reason');
    assert(Array.isArray(body.data.messages), 'has messages');
    assert(body.data.messages.length >= 1, `messages count: ${body.data.messages.length}`);
    assert(body.data.messages[0].event === 'dispute_opened', `event: ${body.data.messages[0].event}`);
});

await test('3. Open duplicate dispute → 409', async () => {
    const tc = trackingCodes[0];
    const { status } = await json(`/v1/work/${tc}/dispute`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${requesterToken}` },
        body: JSON.stringify({ reason: 'duplicate attempt' }),
    });
    assert(status === 409, `status ${status}`);
});

await test('4. Open dispute as non-requester → 403', async () => {
    const tc = trackingCodes[0];
    const { status } = await json(`/v1/work/${tc}/dispute`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${providerToken}` },
        body: JSON.stringify({ reason: 'I am the provider' }),
    });
    assert(status === 403, `status ${status}`);
});

// ─── Phase 2: Counter-Dispute ───
console.log('\nPhase 2 — Counter-Dispute');

await test('5. Provider counters', async () => {
    const tc = trackingCodes[0];
    const { status, body } = await json(`/v1/work/${tc}/counter-dispute`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${providerToken}` },
        body: JSON.stringify({ reason: 'Output was excellent, requester is wrong' }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.status === 'contested', `status: ${body.data.status}`);
});

await test('6. Requester cannot counter own dispute → 403', async () => {
    const tc = trackingCodes[0];
    const { status } = await json(`/v1/work/${tc}/counter-dispute`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${requesterToken}` },
        body: JSON.stringify({ reason: 'I opened this dispute' }),
    });
    assert(status === 403, `status ${status}`);
});

await test('7. Audit log shows both entries', async () => {
    const tc = trackingCodes[0];
    const { status, body } = await json(`/v1/work/${tc}/dispute`, {
        headers: { Authorization: `Bearer ${requesterToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(body.data.messages.length >= 2, `messages: ${body.data.messages.length}`);
    const events = body.data.messages.map((m: any) => m.event);
    assert(events.includes('dispute_opened'), 'has dispute_opened');
    assert(events.includes('counter_dispute'), 'has counter_dispute');
});

// ─── Phase 3: Resolution — Redelivery ───
console.log('\nPhase 3 — Resolution: Redelivery');

await test('8. Provider offers redelivery', async () => {
    const tc = trackingCodes[0];
    const { status, body } = await json(`/v1/work/${tc}/redeliver`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${providerToken}` },
        body: JSON.stringify({ output: { result: 'improved output with more detail' } }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.redelivered === true, 'redelivered');
});

await test('9. Requester accepts redelivery', async () => {
    const tc = trackingCodes[0];
    const { status, body } = await json(`/v1/work/${tc}/accept-redelivery`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${requesterToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.status === 'resolved', `status: ${body.data.status}`);
    assert(body.data.outcome === 'redelivery_accepted', `outcome: ${body.data.outcome}`);
});

// ─── Phase 4: Resolution — Accept Fault ───
console.log('\nPhase 4 — Resolution: Accept Fault');

await test('Setup: Create delivered work for Phase 4', async () => {
    const tc = await createDeliveredWork();
    trackingCodes.push(tc); // trackingCodes[1]
});

await test('Setup: Open dispute for Phase 4', async () => {
    const tc = trackingCodes[1];
    const { status, body } = await json(`/v1/work/${tc}/dispute`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${requesterToken}` },
        body: JSON.stringify({ reason: 'Work not delivered as promised' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    disputeIds.push(body.data.dispute_id); // disputeIds[1]
});

let requesterBalanceBefore = 0;
await test('10. Provider accepts fault', async () => {
    // Snapshot requester balance
    const { body: walletBody } = await json('/v1/wallet', {
        headers: { Authorization: `Bearer ${requesterToken}` },
    });
    requesterBalanceBefore = walletBody.data.balance;

    const tc = trackingCodes[1];
    const { status, body } = await json(`/v1/work/${tc}/accept-fault`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${providerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.status === 'resolved', `status: ${body.data.status}`);
    assert(body.data.outcome === 'requester_refunded', `outcome: ${body.data.outcome}`);
});

await test('11. Verify requester wallet refund', async () => {
    const { body } = await json('/v1/wallet', {
        headers: { Authorization: `Bearer ${requesterToken}` },
    });
    assert(body.data.balance > requesterBalanceBefore, `balance ${body.data.balance} > ${requesterBalanceBefore}`);
});

// ─── Phase 5: Resolution — Partial Refund ───
console.log('\nPhase 5 — Resolution: Partial Refund');

await test('Setup: Create delivered work for Phase 5a', async () => {
    const tc = await createDeliveredWork();
    trackingCodes.push(tc); // trackingCodes[2]
});

await test('Setup: Open dispute for Phase 5a', async () => {
    const tc = trackingCodes[2];
    const { status, body } = await json(`/v1/work/${tc}/dispute`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${requesterToken}` },
        body: JSON.stringify({ reason: 'Partial output, want partial refund' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    disputeIds.push(body.data.dispute_id); // disputeIds[2]
});

await test('12. Provider offers partial refund', async () => {
    const tc = trackingCodes[2];
    const { status, body } = await json(`/v1/work/${tc}/offer-partial`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${providerToken}` },
        body: JSON.stringify({ refund_morsels: 5, message: 'Fair split' }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.offer.refund_morsels === 5, `refund: ${body.data.offer.refund_morsels}`);
});

// SECURITY (C-3, 2026-08 audit): `refund_morsels` was validated as any positive integer and then
// credited with an unconditional creditBalance, so an offer larger than the escrow minted the
// difference out of nothing. Both sides of a dispute are cheap for one person to control, which made
// this an unbounded mint. The escrow is the ceiling, and the balance must not move on a refusal.
await test('12b. Partial refund above the escrow is refused and mints nothing (C-3)', async () => {
    const tc = trackingCodes[2];
    const { body: beforeWallet } = await json('/v1/wallet', {
        headers: { Authorization: `Bearer ${requesterToken}` },
    });
    const before = Number(beforeWallet.data.balance);

    const { status, body } = await json(`/v1/work/${tc}/offer-partial`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${providerToken}` },
        body: JSON.stringify({ refund_morsels: 1_000_000, message: 'mint attempt' }),
    });
    assert(status === 400, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'REFUND_EXCEEDS_ESCROW', `code: ${JSON.stringify(body.error)}`);

    const { body: afterWallet } = await json('/v1/wallet', {
        headers: { Authorization: `Bearer ${requesterToken}` },
    });
    assert(Number(afterWallet.data.balance) === before,
        `requester balance moved on a refused offer: ${before} -> ${afterWallet.data.balance}`);
});

await test('13. Requester accepts partial', async () => {
    const tc = trackingCodes[2];
    const { status, body } = await json(`/v1/work/${tc}/accept-partial`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${requesterToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.status === 'resolved', `status: ${body.data.status}`);
});

// Phase 5b: Reject partial
await test('Setup: Create delivered work for Phase 5b', async () => {
    const tc = await createDeliveredWork();
    trackingCodes.push(tc); // trackingCodes[3]
});

await test('Setup: Open dispute for Phase 5b', async () => {
    const tc = trackingCodes[3];
    const { status, body } = await json(`/v1/work/${tc}/dispute`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${requesterToken}` },
        body: JSON.stringify({ reason: 'Output was wrong' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    disputeIds.push(body.data.dispute_id); // disputeIds[3]
});

await test('Setup: Provider offers partial for reject test', async () => {
    const tc = trackingCodes[3];
    const { body } = await json(`/v1/work/${tc}/offer-partial`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${providerToken}` },
        body: JSON.stringify({ refund_morsels: 3, message: 'Small refund' }),
    });
    assert(body.ok === true, `offer: ${JSON.stringify(body.error)}`);
});

await test('14. Requester rejects partial', async () => {
    const tc = trackingCodes[3];
    const { status, body } = await json(`/v1/work/${tc}/reject-partial`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${requesterToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.partial_rejected === true, 'partial_rejected');
    // Dispute remains open (not resolved)
    assert(body.data.status !== 'resolved', `status should not be resolved: ${body.data.status}`);
});

// ─── Phase 6: Withdraw ───
console.log('\nPhase 6 — Withdraw');

// Use the Phase 5b work item (dispute still open after reject-partial)
await test('15. Requester withdraws dispute', async () => {
    const tc = trackingCodes[3];
    const { status, body } = await json(`/v1/work/${tc}/withdraw-dispute`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${requesterToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.status === 'resolved', `status: ${body.data.status}`);
    assert(body.data.outcome === 'withdrawn', `outcome: ${body.data.outcome}`);
});

// ─── Phase 7: Escalation & Operator Ruling ───
console.log('\nPhase 7 — Escalation & Operator Ruling');

// Create two work items: one for requester-favorable ruling, one for provider-favorable
await test('Setup: Create delivered work for escalation (requester ruling)', async () => {
    const tc = await createDeliveredWork();
    trackingCodes.push(tc); // trackingCodes[4]
});

await test('Setup: Open + counter dispute for escalation', async () => {
    const tc = trackingCodes[4];
    const { body: dBody } = await json(`/v1/work/${tc}/dispute`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${requesterToken}` },
        body: JSON.stringify({ reason: 'Needs operator ruling' }),
    });
    assert(dBody.ok === true, `open: ${JSON.stringify(dBody.error)}`);
    disputeIds.push(dBody.data.dispute_id); // disputeIds[4]

    const { body: cBody } = await json(`/v1/work/${tc}/counter-dispute`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${providerToken}` },
        body: JSON.stringify({ reason: 'I disagree with requester' }),
    });
    assert(cBody.ok === true, `counter: ${JSON.stringify(cBody.error)}`);
});

await test('16. Requester escalates to operator', async () => {
    const tc = trackingCodes[4];
    const { status, body } = await json(`/v1/work/${tc}/escalate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${requesterToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.status === 'escalated', `status: ${body.data.status}`);
});

await test('17. Admin views audit log', async () => {
    const disputeId = disputeIds[4];
    const { status, body } = await json(`/v1/admin/disputes/${disputeId}/audit-log`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(Array.isArray(body.data.entries), 'has entries');
    // Should have: dispute_opened, counter_dispute, escalated
    assert(body.data.entries.length >= 3, `entries: ${body.data.entries.length}`);
    const events = body.data.entries.map((e: any) => e.event);
    assert(events.includes('dispute_opened'), 'has dispute_opened');
    assert(events.includes('counter_dispute'), 'has counter_dispute');
    assert(events.includes('escalated'), 'has escalated');
});

await test('18. Operator rules in favor of requester', async () => {
    const disputeId = disputeIds[4];
    const { status, body } = await json(`/v1/admin/disputes/${disputeId}/rule`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            ruling: 'Requester wins — full refund',
            distribution: { to_requester: 10, to_provider: 0, burned: 0 },
            reason: 'Provider failed to deliver quality output',
        }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.status === 'resolved', `status: ${body.data.status}`);
    assert(body.data.ruling.distribution.to_requester === 10, `to_requester: ${body.data.ruling.distribution.to_requester}`);
});

// Provider-favorable ruling
await test('Setup: Create work for provider-favorable ruling', async () => {
    const tc = await createDeliveredWork();
    trackingCodes.push(tc); // trackingCodes[5]
});

await test('Setup: Open + escalate for provider ruling', async () => {
    const tc = trackingCodes[5];
    const { body: dBody } = await json(`/v1/work/${tc}/dispute`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${requesterToken}` },
        body: JSON.stringify({ reason: 'Requesting operator ruling #2' }),
    });
    assert(dBody.ok === true, `open: ${JSON.stringify(dBody.error)}`);
    disputeIds.push(dBody.data.dispute_id); // disputeIds[5]

    const { body: eBody } = await json(`/v1/work/${tc}/escalate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${requesterToken}` },
    });
    assert(eBody.ok === true, `escalate: ${JSON.stringify(eBody.error)}`);
});

await test('19. Operator rules in favor of provider', async () => {
    const disputeId = disputeIds[5];
    const { status, body } = await json(`/v1/admin/disputes/${disputeId}/rule`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            ruling: 'Provider wins — work was acceptable',
            distribution: { to_requester: 0, to_provider: 10, burned: 0 },
            reason: 'Requester complaint not substantiated',
        }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.status === 'resolved', `status: ${body.data.status}`);
    assert(body.data.ruling.distribution.to_provider === 10, `to_provider: ${body.data.ruling.distribution.to_provider}`);
});

// Phase 8 was Tier 0.5: the same two operations reached by GET with a one-time key in the query
// string. Those routes are gone, so their four cases went with them rather than being turned into
// 404 assertions, which would have proved only that Express has no such route. Numbering below is
// left as it was; renumbering 22 and 23 down to 20 and 21 would make a later reader believe the
// hash-chain test has always been test 20.

// ─── Phase 9: Audit Log Integrity ───
console.log('\nPhase 9 — Audit Log Integrity');

await test('22. Audit log hash chain is valid', async () => {
    // Use the Phase 7 escalated dispute (disputeIds[4]) which has the most entries
    const disputeId = disputeIds[4];
    const { body } = await json(`/v1/admin/disputes/${disputeId}/audit-log`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok === true, 'ok');
    const entries = body.data.entries;
    assert(entries.length >= 3, `need 3+ entries: ${entries.length}`);

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        assert(typeof entry.hash === 'string' && entry.hash.length > 0, `entry ${i} has hash`);
        if (i === 0) {
            assert(entry.previousHash === '0' || entry.previousHash === '' || /^0+$/.test(entry.previousHash), `first entry previousHash: ${entry.previousHash}`);
        } else {
            assert(entry.previousHash === entries[i - 1].hash, `entry ${i} previousHash matches previous hash`);
        }
    }
});

await test('23. Entries ordered chronologically', async () => {
    const disputeId = disputeIds[4];
    const { body } = await json(`/v1/admin/disputes/${disputeId}/audit-log`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const entries = body.data.entries;
    for (let i = 1; i < entries.length; i++) {
        const prev = new Date(entries[i - 1].timestamp).getTime();
        const curr = new Date(entries[i].timestamp).getTime();
        assert(curr >= prev, `entry ${i} timestamp ${entries[i].timestamp} >= ${entries[i - 1].timestamp}`);
    }
});

// ─── Cleanup ───
console.log('\nCleanup');

await test('Cascade delete owner', async () => {
    const { status } = await json(`/v1/owners/${ownerName}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200 || status === 204, `status ${status}`);
});

await test('Cascade delete provider owner', async () => {
    const { status } = await json(`/v1/owners/${provOwnerName}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${provOwnerToken}` },
    });
    assert(status === 200 || status === 204, `status ${status}`);
});

// ─── Summary ───
console.log(`\n${'─'.repeat(40)}`);
console.log(`Dispute E2E: ${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);
