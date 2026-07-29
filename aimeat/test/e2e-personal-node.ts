/**
 * @file e2e-personal-node.ts
 * @description E2E for the AIMEAT personal-node lifecycle: anchor, status, operator inventory,
 *   visibility toggle, cross-owner denial, mailbox stats, federation-directory visibility filtering,
 *   bootstrap + admin dashboard exposure, deregister and cascade delete.
 * @structure Phase 1 setup · 2 anchor · 3 status · 4 operator list · 4b visibility · 4c cross-owner
 *   denial · 5 mailbox · 6 federation visibility · 7 bootstrap · 8 admin dashboard · 9 deregister ·
 *   10 cleanup.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-personal-node
 * @version-history
 *   v1.1.0 — 2026-07-29 — Add a second, non-operator owner and the cross-owner denials for
 *            PATCH/DELETE /v1/personal/anchor/:nodeId, GET /v1/personal/mailbox/:nodeId and
 *            GET /v1/personal/nodes (batch 01, holes 7-10); make the bootstrap assertion depend on
 *            the server's personal_nodes_enabled flag instead of the section's presence.
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

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body, headers: res.headers };
}

// Helper: sign a message with a base64 private key, return base64 signature
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
let ownerPrivKey = ''; // base64, returned by server
const ownerName = `pnowner${Date.now()}`;
const personalNodeId = `personal-test-${Date.now()}`;

console.log('\n=== AIMEAT Personal Node E2E Test ===\n');

// ─── Phase 1: Setup — Create owner + get token ───
console.log('Phase 1 — Setup');

await test('POST /v1/owners — register owner', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    ownerPrivKey = body.data.private_key;
    assert(typeof ownerPrivKey === 'string' && ownerPrivKey.length > 0, 'got owner private key');
});

await test('Owner auth — sign + token', async () => {
    const timestamp = new Date().toISOString();
    const message = ownerName + NODE_ID + timestamp;
    const signature = await signMsg(ownerPrivKey, message);

    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: ownerName, timestamp, signature }),
    });
    assert(body.ok === true, `token ok: ${JSON.stringify(body.error)}`);
    ownerToken = body.data?.token;
    assert(typeof ownerToken === 'string', 'got owner token');
});

// ─── Phase 2: Anchor — Register personal node ───
console.log('Phase 2 — Anchor');

await test('POST /v1/personal/anchor — register personal node', async () => {
    const { status, body } = await json('/v1/personal/anchor', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            node_id: personalNodeId,
            owner_name: ownerName,
            public_key: 'test-key-base64',
            agent_gaiis: [],
            visibility: 'private',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.node_id === personalNodeId, `node_id: ${body.data?.node_id}`);
    assert(body.data?.anchor_operator === NODE_ID, `anchor_operator: ${body.data?.anchor_operator}`);
    assert(body.data?.status === 'offline', `status: ${body.data?.status}`);
    assert(typeof body.data?.tunnel_url === 'string', 'has tunnel_url');
    assert(typeof body.data?.mailbox_quota_bytes === 'number', 'has mailbox_quota_bytes');
    assert(typeof body.data?.created_at === 'string', 'has created_at');
    assert(body.data?.visibility === 'private', `visibility should be private: ${body.data?.visibility}`);
});

// ─── Phase 3: Status — Check personal node status ───
console.log('Phase 3 — Status');

await test('GET /v1/personal/status — check personal node status', async () => {
    const { status, body } = await json('/v1/personal/status', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.node_id === personalNodeId, `node_id: ${body.data?.node_id}`);
    assert(body.data?.status === 'offline', `status should be offline: ${body.data?.status}`);
    assert(body.data?.mailbox?.items === 0, `mailbox items should be 0: ${body.data?.mailbox?.items}`);
    assert(typeof body.data?.mailbox?.used_bytes === 'number', 'has used_bytes');
    assert(typeof body.data?.mailbox?.quota_bytes === 'number', 'has quota_bytes');
    assert(Array.isArray(body.data?.agent_gaiis), 'has agent_gaiis array');
    assert(typeof body.data?.last_seen === 'string', 'has last_seen');
    assert(typeof body.data?.created_at === 'string', 'has created_at');
    assert(body.data?.visibility === 'private', `visibility should be private: ${body.data?.visibility}`);
});

// ─── Phase 4: List — Operator list all nodes ───
console.log('Phase 4 — List');

await test('GET /v1/personal/nodes — operator lists all personal nodes', async () => {
    const { status, body } = await json('/v1/personal/nodes', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(Array.isArray(body.data?.personal_nodes), 'has personal_nodes array');
    const ourNode = body.data.personal_nodes.find((n: any) => n.node_id === personalNodeId);
    assert(ourNode, 'our personal node appears in list');
    assert(ourNode.owner_name === ownerName, `owner_name: ${ourNode.owner_name}`);
    assert(ourNode.status === 'offline', `status: ${ourNode.status}`);
    assert(ourNode.visibility === 'private', `visibility should be private: ${ourNode.visibility}`);
    assert(typeof body.data?.total === 'number', 'has total');
    assert(typeof body.data?.max_slots === 'number', 'has max_slots');
    assert(typeof body.data?.available_slots === 'number', 'has available_slots');
    assert(body.data.available_slots === body.data.max_slots - body.data.total, 'available_slots = max_slots - total');
});

// ─── Phase 4b: Visibility Toggle ───
console.log('Phase 4b — Visibility Toggle');

await test('PATCH /v1/personal/anchor/:nodeId — toggle visibility to public', async () => {
    const { status, body } = await json(`/v1/personal/anchor/${encodeURIComponent(personalNodeId)}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: 'public' }),
    });
    assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.visibility === 'public', `Should be public: ${body.data?.visibility}`);
    assert(body.data?.node_id === personalNodeId, `node_id: ${body.data?.node_id}`);
    assert(typeof body.data?.updated_at === 'string', 'has updated_at');
});

await test('PATCH /v1/personal/anchor/:nodeId — toggle visibility back to private', async () => {
    const { status, body } = await json(`/v1/personal/anchor/${encodeURIComponent(personalNodeId)}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: 'private' }),
    });
    assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.visibility === 'private', `Should be private: ${body.data?.visibility}`);
});

await test('PATCH /v1/personal/anchor/:nodeId — invalid visibility rejected', async () => {
    const { status, body } = await json(`/v1/personal/anchor/${encodeURIComponent(personalNodeId)}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: 'invalid' }),
    });
    assert(status === 400, `Expected 400 for invalid visibility, got ${status}`);
});

await test('PATCH /v1/personal/anchor/:nodeId — empty body rejected', async () => {
    const { status, body } = await json(`/v1/personal/anchor/${encodeURIComponent(personalNodeId)}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
    });
    assert(status === 400, `Expected 400 for empty body, got ${status}`);
});

// ─── Phase 4c: Cross-owner denial ───
// Every ownership check in personal.ts is `node.ownerName !== ownerName && !roles.includes('operator')`.
// With only one owner registered the suite could not express the denial, so all four checks were
// deletable in silence (batch 01 mutations P1–P4).
console.log('Phase 4c — Cross-owner denial');

const ownerBName = `pnownerb${Date.now()}`;
let ownerBToken = '';

await test('Setup — a second, non-operator owner', async () => {
    const reg = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: ownerBName, public_key: 'placeholder' }),
    });
    assert(reg.status === 201, `owner B register ${reg.status}: ${JSON.stringify(reg.body)}`);
    const timestamp = new Date().toISOString();
    const signature = await signMsg(reg.body.data.private_key, ownerBName + NODE_ID + timestamp);
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: ownerBName, timestamp, signature }),
    });
    assert(tok.body.ok === true, `owner B token: ${JSON.stringify(tok.body.error)}`);
    ownerBToken = tok.body.data.token;
    // The two callers really are different privilege levels — A is the node's first owner and
    // therefore an operator, B is not. Phase 4's "operator lists all" test depends on that.
    const rolesOf = (t: string) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).roles ?? [];
    assert(rolesOf(ownerToken).includes('operator'), `owner A should be the bootstrap operator, got ${JSON.stringify(rolesOf(ownerToken))}`);
    assert(!rolesOf(ownerBToken).includes('operator'), `owner B must NOT be an operator, got ${JSON.stringify(rolesOf(ownerBToken))}`);
});

await test('cross-owner: owner B cannot read, flip or destroy owner A\'s personal node', async () => {
    const bAuth = { Authorization: `Bearer ${ownerBToken}`, 'Content-Type': 'application/json' };
    const url = `/v1/personal/anchor/${encodeURIComponent(personalNodeId)}`;

    const patch = await json(url, { method: 'PATCH', headers: bAuth, body: JSON.stringify({ visibility: 'public' }) });
    assert(patch.status === 403, `cross-owner PATCH must be 403, got ${patch.status}: ${JSON.stringify(patch.body)}`);
    assert(patch.body.error?.code === 'FORBIDDEN', `expected FORBIDDEN, got ${patch.body.error?.code}`);

    const mail = await json(`/v1/personal/mailbox/${encodeURIComponent(personalNodeId)}`, { headers: bAuth });
    assert(mail.status === 403, `cross-owner mailbox read must be 403, got ${mail.status}`);
    assert(mail.body.error?.code === 'FORBIDDEN', `expected FORBIDDEN, got ${mail.body.error?.code}`);

    const del = await json(url, { method: 'DELETE', headers: bAuth });
    assert(del.status === 403, `cross-owner DELETE must be 403, got ${del.status}`);
    assert(del.body.error?.code === 'FORBIDDEN', `expected FORBIDDEN, got ${del.body.error?.code}`);

    // The refusals were real: A's node is intact and still private.
    const still = await json('/v1/personal/status', { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(still.status === 200, `A's node must survive B's attempts, got ${still.status}`);
    assert(still.body.data?.node_id === personalNodeId, `node_id after B's attempts: ${still.body.data?.node_id}`);
    assert(still.body.data?.visibility !== 'public', `B must not have flipped A's node public: ${still.body.data?.visibility}`);
});

await test('GET /v1/personal/nodes — a NON-operator owner is refused the full inventory', async () => {
    const { status, body } = await json('/v1/personal/nodes', {
        headers: { Authorization: `Bearer ${ownerBToken}` },
    });
    assert(status === 403, `non-operator listing every personal node must be 403, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'ACCESS_DENIED', `expected ACCESS_DENIED, got ${body.error?.code}`);
    assert(body.data?.personal_nodes === undefined, `the refusal must not carry the inventory: ${JSON.stringify(body.data)}`);
});

// ─── Phase 5: Mailbox — Check mailbox stats ───
console.log('Phase 5 — Mailbox');

await test('GET /v1/personal/mailbox/:nodeId — check mailbox stats', async () => {
    const { status, body } = await json(`/v1/personal/mailbox/${encodeURIComponent(personalNodeId)}`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.node_id === personalNodeId, `node_id: ${body.data?.node_id}`);
    assert(body.data?.items === 0, `items should be 0: ${body.data?.items}`);
    assert(typeof body.data?.total_bytes === 'number', 'has total_bytes');
    assert(typeof body.data?.quota_bytes === 'number', 'has quota_bytes');
    assert(typeof body.data?.by_type === 'object', 'has by_type');
});

// ─── Phase 6: Federation — Check visibility filtering in directory ───
console.log('Phase 6 — Federation Visibility');

await test('GET /v1/federation/directory — private node hidden from directory', async () => {
    // Node is currently private (toggled back in Phase 4b)
    const { status, body } = await json('/v1/federation/directory');
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(Array.isArray(body.data?.peers), 'has peers array');
    const personalNodes = body.data?.personal_nodes || [];
    const found = personalNodes.find((n: any) => n.node_id === personalNodeId);
    assert(!found, 'Private node should NOT appear in federation directory');
});

await test('Toggle to public then verify in directory', async () => {
    // Toggle to public
    const { status: patchStatus } = await json(`/v1/personal/anchor/${encodeURIComponent(personalNodeId)}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: 'public' }),
    });
    assert(patchStatus === 200, `PATCH failed: ${patchStatus}`);

    // Check directory — public node should appear
    const { body } = await json('/v1/federation/directory');
    const personalNodes = body.data?.personal_nodes || [];
    const found = personalNodes.find((n: any) => n.node_id === personalNodeId);
    assert(found, 'Public node should appear in federation directory');
    assert(found.node_id === personalNodeId, `node_id: ${found.node_id}`);
    assert(found.type === 'personal', `type: ${found.type}`);
});

await test('Toggle back to private then verify hidden again', async () => {
    // Toggle back to private
    const { status: patchStatus } = await json(`/v1/personal/anchor/${encodeURIComponent(personalNodeId)}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: 'private' }),
    });
    assert(patchStatus === 200, `PATCH failed: ${patchStatus}`);

    // Check directory — should be hidden again
    const { body } = await json('/v1/federation/directory');
    const personalNodes = body.data?.personal_nodes || [];
    const found = personalNodes.find((n: any) => n.node_id === personalNodeId);
    assert(!found, 'Private node should be hidden again after toggle');
});

// ─── Phase 7: Bootstrap — Check personal node info ───
console.log('Phase 7 — Bootstrap');

await test('GET /?format=json — personal nodes in bootstrap', async () => {
    const { status, body } = await json('/?format=json');
    assert(status === 200, `status ${status}`);
    assert(body.ok === true, 'ok');
    assert(body.protocol === 'aimeat', `protocol: ${body.protocol}`);
    // Condition on the server's own flag, not on the section's presence — otherwise the section
    // can disappear entirely and this test still passes.
    assert(body.data?.this_node?.personal_nodes_enabled === true,
        `personal nodes must be enabled here (the anchor above succeeded): ${JSON.stringify(body.data?.this_node?.personal_nodes_enabled)}`);
    assert(body.data?.personal_nodes, `personal_nodes section must be present when the feature is enabled: ${JSON.stringify(Object.keys(body.data ?? {}))}`);
    assert(body.data.personal_nodes.enabled === true, 'personal_nodes enabled');
    assert(typeof body.data.personal_nodes.tunnel_url === 'string', 'has tunnel_url');
});

// ─── Phase 8: Admin Dashboard — Check personal node stats ───
console.log('Phase 8 — Admin Dashboard');

await test('GET /v1/admin/dashboard — personal_nodes in dashboard', async () => {
    const { status, body } = await json('/v1/admin/dashboard', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, `ok: ${JSON.stringify(body.error)}`);
    assert(typeof body.data?.node_id === 'string', 'has node_id');
    assert(body.data?.personal_nodes !== undefined, 'has personal_nodes section');
    assert(typeof body.data.personal_nodes.total === 'number', 'personal_nodes has total');
    assert(typeof body.data.personal_nodes.max_slots === 'number', 'personal_nodes has max_slots');
});

// ─── Phase 9: Deregister — Clean up personal node ───
console.log('Phase 9 — Deregister');

await test('DELETE /v1/personal/anchor/:nodeId — deregister personal node', async () => {
    const { status, body } = await json(`/v1/personal/anchor/${encodeURIComponent(personalNodeId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.node_id === personalNodeId, `node_id: ${body.data?.node_id}`);
    assert(body.data?.deregistered === true, 'deregistered');
    assert(body.data?.mailbox_purged === true, 'mailbox_purged');
});

await test('GET /v1/personal/status — 404 after deregister', async () => {
    const { status, body } = await json('/v1/personal/status', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 404, `expected 404, got ${status}: ${JSON.stringify(body)}`);
});

await test('GET /v1/personal/status?soft=1 — 200 anchored:false when no node', async () => {
    const { status, body } = await json('/v1/personal/status?soft=1', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(body.data?.anchored === false, `anchored should be false: ${JSON.stringify(body.data)}`);
    assert(body.data?.node_id === null, `node_id should be null: ${body.data?.node_id}`);
});

// ─── Phase 10: Cleanup — Delete owner ───
console.log('Phase 10 — Cleanup');

await test('DELETE /v1/owners/:ownerName — cascade delete', async () => {
    const { body } = await json(`/v1/owners/${ownerName}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(body.ok === true, `delete: ${JSON.stringify(body.error)}`);
    assert(body.data?.deleted === true, 'confirmed deleted');

    // Verify owner is gone
    const { body: gBody } = await json(`/v1/owners/${ownerName}`);
    assert(gBody.ok === false || gBody.data === null, 'owner gone');
});

// ─── Summary ───
console.log(`\nPersonal Node E2E: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
