// E2E test for AIMEAT Personal Node lifecycle
// Run: cd aimeat && pnpm exec tsx test/e2e-personal-node.ts

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'meat-local-001-dev';

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
ed.etc.sha512Sync = (...m: Uint8Array[]) =>
    new Uint8Array(createHash('sha512').update(ed.etc.concatBytes(...m)).digest());

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
    assert(typeof body.data?.total === 'number', 'has total');
    assert(typeof body.data?.max_slots === 'number', 'has max_slots');
    assert(typeof body.data?.available_slots === 'number', 'has available_slots');
    assert(body.data.available_slots === body.data.max_slots - body.data.total, 'available_slots = max_slots - total');
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

// ─── Phase 6: Federation — Check personal nodes appear in directory ───
console.log('Phase 6 — Federation');

await test('GET /v1/federation/directory — personal nodes in directory', async () => {
    const { status, body } = await json('/v1/federation/directory');
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, 'ok');
    assert(Array.isArray(body.data?.peers), 'has peers array');
    // personal_nodes may or may not be present depending on config — just verify directory works
    if (body.data?.personal_nodes) {
        assert(Array.isArray(body.data.personal_nodes), 'personal_nodes is array');
    }
});

// ─── Phase 7: Bootstrap — Check personal node info ───
console.log('Phase 7 — Bootstrap');

await test('GET /?format=json — personal nodes in bootstrap', async () => {
    const { status, body } = await json('/?format=json');
    assert(status === 200, `status ${status}`);
    assert(body.ok === true, 'ok');
    assert(body.protocol === 'aimeat', `protocol: ${body.protocol}`);
    // personal_nodes section should be present in data when feature is enabled
    if (body.data?.personal_nodes) {
        assert(body.data.personal_nodes.enabled === true, 'personal_nodes enabled');
        assert(typeof body.data.personal_nodes.tunnel_url === 'string', 'has tunnel_url');
    }
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
