/**
 * @file e2e-capability-trust-guard.ts
 * @description What a capability's owner may NOT write about their own capability.
 *
 *   `PUT /v1/capabilities/:id` handed the request body to the shared write, which merges what it is
 *   given. Only `id`, `ownerGhii` and `createdAt` were taken back out, so an owner could PUT
 *   `{"trust":{"operatorReviewed":true,"codeAudited":true}}` and the directory then showed their
 *   capability as reviewed and audited by the node operator. The same body could set the invocation
 *   counters, and could clear an operator's disable switch off their own capability.
 *
 *   Every assertion here is about a field the NODE writes: trust, stats, operatorOverride,
 *   rejectionReason, schemaHash and scope, plus the identity and timestamp fields. The last two
 *   tests are the other half — an ordinary patch still takes, and a vouch still counts — because a
 *   strip that is too wide breaks the owner's own editing.
 *
 *   The MCP door is not tested here and does not need to be: `aimeat_capabilities_update` declares a
 *   fixed zod parameter list and copies the eight fields it accepts into a fresh object, so a
 *   server-owned field cannot arrive at all. Only a route that takes a body has this problem.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *   test/run-e2e-ci.ts --test=e2e-capability-trust-guard
 * @version-history
 *   v1.0.0 — 2026-08-14 — Initial (August 2026 audit NEW-2).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'TestAdminPw123!';
const stamp = Date.now() % 1000000;
const operatorName = `captrustop${stamp}`;
const ownerName = `captrust${stamp}`;

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

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

/** Register a plain owner and sign in. Not an operator: this is the principal the fix is about. */
async function registerOwner(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const ts = new Date().toISOString();
    const sig = await signMsg(reg.body.data.private_key, name + NODE_ID + ts);
    const auth = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: sig }) });
    assert(auth.body.ok === true, `auth ${name}: ${JSON.stringify(auth.body.error)}`);
    assert(!(auth.body.data.roles ?? []).includes('operator'), `${name} must NOT be an operator`);
    return auth.body.data.token;
}

let operatorToken = '';
let ownerToken = '';
const capId = `captrust-cap-${stamp}`;

console.log('\n=== Capability: the fields the node owns ===\n');

console.log('Phase 0 — Two principals and one capability');

await test('Register the operator', async () => {
    const reg = await json('/v1/admin/setup/register', {
        method: 'POST', headers: { 'X-Admin-Password': ADMIN_PW }, body: JSON.stringify({ name: operatorName }),
    });
    assert(reg.status === 200 && reg.body.ok === true, `admin register: ${reg.status} ${JSON.stringify(reg.body)}`);
    const tok = await json('/v1/admin/setup/token', {
        method: 'POST', headers: { 'X-Admin-Password': ADMIN_PW },
        body: JSON.stringify({ owner: operatorName, private_key: reg.body.private_key }),
    });
    assert(tok.body.ok === true, `operator token: ${JSON.stringify(tok.body.error)}`);
    operatorToken = tok.body.token;
});

await test('Register an ordinary owner', async () => {
    ownerToken = await registerOwner(ownerName);
});

await test('The owner registers a capability, unreviewed and uncounted', async () => {
    const { status, body } = await json('/v1/capabilities', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            id: capId, name: 'Trust guard subject', summary: 'A capability nobody has reviewed',
            source: { type: 'manual', ref: 'manual', version: '1.0.0' },
            callable: false, visibility: 'private', status: 'active',
            inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
        }),
    });
    assert(status === 201, `create: ${status} ${JSON.stringify(body.error ?? body)}`);
    assert(body.data.trust.operatorReviewed === false, 'a new capability is not reviewed');
    assert(body.data.trust.codeAudited === false, 'a new capability is not audited');
    assert(body.data.stats.totalInvocations === 0, 'a new capability has no invocations');
});

console.log('\nPhase 1 — trust: the operator review an owner awarded themselves');

await test('PUT trust does not make the node say it reviewed this', async () => {
    const { status, body } = await json(`/v1/capabilities/${capId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            summary: 'Still a capability nobody has reviewed',
            trust: {
                operatorReviewed: true, reviewedAt: new Date().toISOString(), vouchCount: 99,
                publisherTrustScore: 100, codeAudited: true, auditNotes: 'Audited by me, for me',
            },
        }),
    });
    assert(status === 200, `put: ${status} ${JSON.stringify(body.error ?? body)}`);
    assert(body.data.summary === 'Still a capability nobody has reviewed', 'the legitimate field took');
    const t = body.data.trust;
    assert(t.operatorReviewed === false, `operatorReviewed must stay false, got ${t.operatorReviewed}`);
    assert(t.codeAudited === false, `codeAudited must stay false, got ${t.codeAudited}`);
    assert(t.reviewedAt === null, `reviewedAt must stay null, got ${JSON.stringify(t.reviewedAt)}`);
    assert(t.auditNotes === null, `auditNotes must stay null, got ${JSON.stringify(t.auditNotes)}`);
    assert(t.vouchCount === 0, `vouchCount must stay 0, got ${t.vouchCount}`);
    assert(t.publisherTrustScore === 0, `publisherTrustScore must stay 0, got ${t.publisherTrustScore}`);
});

await test('...and it is the stored record that is unreviewed, not just the response', async () => {
    const { status, body } = await json(`/v1/capabilities/${capId}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(status === 200, `get: ${status}`);
    assert(body.data.trust.operatorReviewed === false, 'stored operatorReviewed must stay false');
    assert(body.data.trust.codeAudited === false, 'stored codeAudited must stay false');
    assert(body.data.trust.vouchCount === 0, `stored vouchCount must stay 0, got ${body.data.trust.vouchCount}`);
});

console.log('\nPhase 2 — stats: usage history the node did not observe');

await test('PUT stats does not invent invocations', async () => {
    const { status, body } = await json(`/v1/capabilities/${capId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            stats: {
                totalInvocations: 9999, successCount: 9999, errorCount: 0,
                lastInvokedAt: new Date().toISOString(), avgResponseMs: 1, lastError: null,
            },
        }),
    });
    assert(status === 200, `put: ${status} ${JSON.stringify(body.error ?? body)}`);
    const s = body.data.stats;
    assert(s.totalInvocations === 0, `totalInvocations must stay 0, got ${s.totalInvocations}`);
    assert(s.successCount === 0, `successCount must stay 0, got ${s.successCount}`);
    assert(s.lastInvokedAt === null, `lastInvokedAt must stay null, got ${JSON.stringify(s.lastInvokedAt)}`);
});

console.log('\nPhase 3 — operatorOverride: the disable switch is the operator\'s');

await test('The operator disables the capability', async () => {
    const { status, body } = await json(`/v1/admin/capabilities/${capId}/override`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${operatorToken}` },
        body: JSON.stringify({ disabled: true, notes: 'Disabled pending review' }),
    });
    assert(status === 200, `override: ${status} ${JSON.stringify(body.error ?? body)}`);
    assert(body.data.operatorOverride.disabled === true, 'override is on');
});

await test('The owner cannot lift the operator override with a PUT', async () => {
    const { status, body } = await json(`/v1/capabilities/${capId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ operatorOverride: null, summary: 'Nothing to see here' }),
    });
    assert(status === 200, `put: ${status} ${JSON.stringify(body.error ?? body)}`);
    assert(body.data.operatorOverride?.disabled === true,
        `override must survive the owner's patch, got ${JSON.stringify(body.data.operatorOverride)}`);

    const back = await json(`/v1/capabilities/${capId}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(back.body.data.operatorOverride?.disabled === true,
        `stored override must survive, got ${JSON.stringify(back.body.data.operatorOverride)}`);
});

await test('The operator lifts it again', async () => {
    const { status } = await json(`/v1/admin/capabilities/${capId}/override`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${operatorToken}` },
        body: JSON.stringify({ disabled: false, notes: null }),
    });
    assert(status === 200, `override: ${status}`);
});

console.log('\nPhase 4 — identity, provenance and bookkeeping');

await test('PUT cannot rewrite ownerGhii, createdAt, schemaHash, rejectionReason or scope', async () => {
    const before = await json(`/v1/capabilities/${capId}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    const original = before.body.data;

    const { status, body } = await json(`/v1/capabilities/${capId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            id: 'some-other-capability',
            ownerGhii: `attacker@${NODE_ID}`,
            createdAt: '2000-01-01T00:00:00.000Z',
            schemaHash: 'deadbeefdeadbeef',
            rejectionReason: 'Reviewed and cleared, says the subject of the review',
            scope: 'federated',
        }),
    });
    assert(status === 200, `put: ${status} ${JSON.stringify(body.error ?? body)}`);
    assert(body.data.id === capId, `id must stay ${capId}, got ${body.data.id}`);
    assert(body.data.ownerGhii === original.ownerGhii, `ownerGhii must stay ${original.ownerGhii}, got ${body.data.ownerGhii}`);
    assert(body.data.createdAt === original.createdAt, `createdAt must stay ${original.createdAt}, got ${body.data.createdAt}`);
    assert(body.data.schemaHash === original.schemaHash, `schemaHash must stay ${original.schemaHash}, got ${body.data.schemaHash}`);
    assert(body.data.rejectionReason === null, `rejectionReason must stay null, got ${JSON.stringify(body.data.rejectionReason)}`);
    assert(body.data.scope === 'local', `scope must stay local, got ${body.data.scope}`);
});

console.log('\nPhase 5 — the owner can still edit their own capability');

await test('An ordinary patch takes, and updatedAt moves', async () => {
    const before = await json(`/v1/capabilities/${capId}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    const { status, body } = await json(`/v1/capabilities/${capId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            name: 'Trust guard subject, renamed', summary: 'Edited by its owner',
            tags: ['captrust', 'edited'], whenToUse: 'When proving a strip is not too wide',
            updatedAt: '2000-01-01T00:00:00.000Z',
        }),
    });
    assert(status === 200, `put: ${status} ${JSON.stringify(body.error ?? body)}`);
    assert(body.data.name === 'Trust guard subject, renamed', `name: ${body.data.name}`);
    assert(body.data.summary === 'Edited by its owner', `summary: ${body.data.summary}`);
    assert(body.data.tags.includes('edited'), `tags: ${JSON.stringify(body.data.tags)}`);
    assert(body.data.whenToUse.startsWith('When proving'), `whenToUse: ${body.data.whenToUse}`);
    assert(body.data.updatedAt !== '2000-01-01T00:00:00.000Z', 'updatedAt is the node\'s stamp, not the caller\'s');
    assert(Date.parse(body.data.updatedAt) >= Date.parse(before.body.data.updatedAt), 'updatedAt moved forward');
});

await test('A vouch from someone else still counts', async () => {
    // The counter is server-written, which is the point: the door that raises it is the vouch route,
    // and it is somebody else's to use.
    const voucher = `captrustv${stamp}`;
    const voucherToken = await registerOwner(voucher);
    const { status, body } = await json(`/v1/capabilities/${capId}/vouch`, {
        method: 'POST', headers: { Authorization: `Bearer ${voucherToken}` },
    });
    assert(status === 200, `vouch: ${status} ${JSON.stringify(body.error ?? body)}`);
    assert(body.data.vouchCount === 1, `vouchCount should be 1, got ${body.data.vouchCount}`);
    await json(`/v1/owners/${voucher}`, { method: 'DELETE', headers: { Authorization: `Bearer ${voucherToken}` } });
});

console.log('\nCleanup');

await test('Delete the capability and both owners', async () => {
    const del = await json(`/v1/capabilities/${capId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(del.status === 200, `delete capability: ${del.status} ${JSON.stringify(del.body.error ?? del.body)}`);
    const a = await json(`/v1/owners/${ownerName}`, { method: 'DELETE', headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(a.body.ok === true, `delete owner: ${JSON.stringify(a.body.error)}`);
    const b = await json(`/v1/owners/${operatorName}`, { method: 'DELETE', headers: { Authorization: `Bearer ${operatorToken}` } });
    assert(b.body.ok === true, `delete operator: ${JSON.stringify(b.body.error)}`);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
process.exit(failed > 0 ? 1 : 0);
