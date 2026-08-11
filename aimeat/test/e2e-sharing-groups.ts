// E2E Tests for Sharing Groups
// Run: cd aimeat && pnpm exec tsx test/e2e-sharing-groups.ts

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

async function getToken(ownerOrGaii: string, privKey: string, isAgent: boolean): Promise<string> {
    const timestamp = new Date().toISOString();
    const message = isAgent ? ownerOrGaii + timestamp : ownerOrGaii + NODE_ID + timestamp;
    const signature = await signMsg(privKey, message);
    const payload = isAgent
        ? { gaii: ownerOrGaii, timestamp, signature }
        : { owner: ownerOrGaii, timestamp, signature };
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    return body.data.token;
}

// ─── State ───
const ownerName = `sgowner${Date.now()}`;
let ownerPrivKey = '';
let ownerToken = '';

const owner2Name = `sgowner2${Date.now()}`;
let owner2PrivKey = '';
let owner2Token = '';

const owner3Name = `sgowner3${Date.now()}`;
let owner3PrivKey = '';
let owner3Token = '';

let groupId = '';

console.log('\n=== AIMEAT Sharing Groups E2E Test ===\n');

// ─── Setup ───
console.log('Setup -- Owners');

await test('Register owner 1', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    ownerPrivKey = body.data.private_key;
    ownerToken = await getToken(ownerName, ownerPrivKey, false);
});

await test('Register owner 2', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: owner2Name, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    owner2PrivKey = body.data.private_key;
    owner2Token = await getToken(owner2Name, owner2PrivKey, false);
});

await test('Register owner 3 (non-member)', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: owner3Name, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    owner3PrivKey = body.data.private_key;
    owner3Token = await getToken(owner3Name, owner3PrivKey, false);
});

// ─── Phase 1: Create a sharing group ───
console.log('\nPhase 1 -- Create & List');

await test('1. Create a sharing group with owner2 as member', async () => {
    const owner2Ghii = `${owner2Name}@${NODE_ID}`;
    const { status, body } = await json('/v1/groups', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            name: 'Test Group',
            description: 'A test sharing group',
            members: [
                { identifier: owner2Ghii, identifier_type: 'ghii', permissions: { read: true, write: true } },
            ],
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.group.name === 'Test Group', `name: ${body.data.group.name}`);
    assert(body.data.group.members.length === 1, `members: ${body.data.group.members.length}`);
    groupId = body.data.group.id;
});

await test('2. List groups (owner sees own group)', async () => {
    const { status, body } = await json('/v1/groups', {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.groups.length >= 1, `groups count: ${body.data.groups.length}`);
    const found = body.data.groups.find((g: any) => g.id === groupId);
    assert(!!found, 'Owner should see their own group');
});

await test('3. List groups (member sees shared group)', async () => {
    const { status, body } = await json('/v1/groups', {
        headers: { Authorization: `Bearer ${owner2Token}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const found = body.data.groups.find((g: any) => g.id === groupId);
    assert(!!found, 'Member should see group they belong to');
});

await test('4. Get group detail (owner)', async () => {
    const { status, body } = await json(`/v1/groups/${groupId}`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.group.id === groupId, `id: ${body.data.group.id}`);
    assert(body.data.group.members.length === 1, `members: ${body.data.group.members.length}`);
});

await test('5. Get group detail (member)', async () => {
    const { status, body } = await json(`/v1/groups/${groupId}`, {
        headers: { Authorization: `Bearer ${owner2Token}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.group.id === groupId, `id: ${body.data.group.id}`);
});

await test('6. Get group detail (non-member) -- should be denied', async () => {
    const { status } = await json(`/v1/groups/${groupId}`, {
        headers: { Authorization: `Bearer ${owner3Token}` },
    });
    assert(status === 403, `expected 403, got ${status}`);
});

// ─── Phase 2: Member management ───
console.log('\nPhase 2 -- Member management');

await test('7. Add owner3 as a member', async () => {
    const owner3Ghii = `${owner3Name}@${NODE_ID}`;
    const { status, body } = await json(`/v1/groups/${groupId}/members`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            identifier: owner3Ghii,
            identifier_type: 'ghii',
            permissions: { read: true, write: false },
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.group.members.length === 2, `members: ${body.data.group.members.length}`);
});

await test('8. Owner3 can now see the group', async () => {
    const { status, body } = await json(`/v1/groups/${groupId}`, {
        headers: { Authorization: `Bearer ${owner3Token}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
});

await test('9. Non-owner cannot add members', async () => {
    const { status } = await json(`/v1/groups/${groupId}/members`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${owner2Token}` },
        body: JSON.stringify({
            identifier: 'someone@somewhere',
            identifier_type: 'ghii',
            permissions: { read: true, write: false },
        }),
    });
    assert(status === 403, `expected 403, got ${status}`);
});

await test('10. Update member permissions', async () => {
    const owner2Ghii = `${owner2Name}@${NODE_ID}`;
    const { status, body } = await json(`/v1/groups/${groupId}/members/${encodeURIComponent(owner2Ghii)}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            permissions: { read: true, write: false },
        }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const member = body.data.group.members.find((m: any) => m.identifier === owner2Ghii);
    assert(member.permissions.write === false, 'write should be false after update');
});

await test('11. Remove owner3 from group', async () => {
    const owner3Ghii = `${owner3Name}@${NODE_ID}`;
    const { status, body } = await json(`/v1/groups/${groupId}/members/${encodeURIComponent(owner3Ghii)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.group.members.length === 1, `members: ${body.data.group.members.length}`);
});

await test('12. Owner3 can no longer see the group', async () => {
    const { status } = await json(`/v1/groups/${groupId}`, {
        headers: { Authorization: `Bearer ${owner3Token}` },
    });
    assert(status === 403, `expected 403, got ${status}`);
});

// ─── Phase 3: Group update and delete ───
console.log('\nPhase 3 -- Update & Delete');

await test('13. Update group name', async () => {
    const { status, body } = await json(`/v1/groups/${groupId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: 'Renamed Group' }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.group.name === 'Renamed Group', `name: ${body.data.group.name}`);
});

await test('14. Non-owner cannot update group', async () => {
    const { status } = await json(`/v1/groups/${groupId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${owner2Token}` },
        body: JSON.stringify({ name: 'Hacked' }),
    });
    assert(status === 403, `expected 403, got ${status}`);
});

await test('15. Non-owner cannot delete group', async () => {
    const { status } = await json(`/v1/groups/${groupId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${owner2Token}` },
    });
    assert(status === 403, `expected 403, got ${status}`);
});

await test('16. Owner can delete group', async () => {
    const { status, body } = await json(`/v1/groups/${groupId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.deleted === true, 'deleted should be true');
});

await test('17. Deleted group is gone', async () => {
    const { status } = await json(`/v1/groups/${groupId}`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 404, `expected 404, got ${status}`);
});

// ─── Phase 4: The shared write path ───
// These pin what services/sharing-group-members.ts decides for BOTH doors. aimeat_group_create and
// aimeat_group_add_member call the same function, and before they did, neither the bare-name
// resolution nor the shape limits applied on the agent surface: a member added by an agent was
// stored as `bob`, matched no membership test, and read nothing while reporting success.
console.log('\nPhase 4 -- Shared write path (REST and MCP call the same service)');

let group2Id = '';

await test('18. A bare member name is stored as a full GHII', async () => {
    const { status, body } = await json('/v1/groups', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            name: 'Bare Identifier Group',
            members: [{ identifier: owner2Name, identifier_type: 'ghii' }],
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    group2Id = body.data.group.id;
    const stored = body.data.group.members[0].identifier;
    assert(stored === `${owner2Name}@${NODE_ID}`, `stored identifier: ${stored}`);
});

await test('19. A bare name added later is resolved the same way', async () => {
    const { status, body } = await json(`/v1/groups/${group2Id}/members`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ identifier: owner3Name, identifier_type: 'ghii' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.added.identifier === `${owner3Name}@${NODE_ID}`, `added: ${body.data.added.identifier}`);
});

await test('20. A member with no permissions gets the group default (read, no write)', async () => {
    const { status, body } = await json(`/v1/groups/${group2Id}`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const member = body.data.group.members.find((m: any) => m.identifier === `${owner3Name}@${NODE_ID}`);
    assert(member.permissions.read === true && member.permissions.write === false,
        `permissions: ${JSON.stringify(member.permissions)}`);
});

await test('21. A group name over 128 characters is refused', async () => {
    const { status, body } = await json('/v1/groups', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: 'x'.repeat(129) }),
    });
    assert(status === 400, `expected 400, got ${status}`);
    assert(body.error.code === 'INVALID_INPUT', `code: ${body.error?.code}`);
});

await test('22. An empty group name is refused', async () => {
    const { status } = await json('/v1/groups', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: '' }),
    });
    assert(status === 400, `expected 400, got ${status}`);
});

await test('23. Adding the same member twice is refused', async () => {
    const { status, body } = await json(`/v1/groups/${group2Id}/members`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ identifier: `${owner3Name}@${NODE_ID}`, identifier_type: 'ghii' }),
    });
    assert(status === 409, `expected 409, got ${status}`);
    assert(body.error.code === 'DUPLICATE', `code: ${body.error?.code}`);
});

await test('24. Removing a member who is not there is refused', async () => {
    const { status, body } = await json(`/v1/groups/${group2Id}/members/${encodeURIComponent('nobody@' + NODE_ID)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 404, `expected 404, got ${status}`);
    assert(body.error.code === 'NOT_FOUND', `code: ${body.error?.code}`);
});

await test('25. Delete the Phase 4 group', async () => {
    const { status } = await json(`/v1/groups/${group2Id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `expected 200, got ${status}`);
});

// ─── Cleanup ───
console.log('\nCleanup');

await test('Cascade-delete owner 1', async () => {
    const { status, body } = await json(`/v1/owners/${encodeURIComponent(ownerName)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
});

await test('Cascade-delete owner 2', async () => {
    const { status, body } = await json(`/v1/owners/${encodeURIComponent(owner2Name)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${owner2Token}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
});

await test('Cascade-delete owner 3', async () => {
    const { status, body } = await json(`/v1/owners/${encodeURIComponent(owner3Name)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${owner3Token}` },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
});

// ─── Summary ───
console.log(`\n${'='.repeat(50)}`);
console.log(`Sharing Groups E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
