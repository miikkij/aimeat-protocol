/**
 * @file test/e2e-admin-doors-2.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The second half of the operator doors the sweep never writes through:
 *   src/routes/admin-monitoring.ts (work, federation, stats, restore, role grant and revoke, trust
 *   advisories, relay earnings), the setup and seeding doors in src/routes/admin.ts, and
 *   src/routes/knowledge/admin.ts (import, delete, review). Split from e2e-admin-doors.ts for the
 *   800-line rule; the two share no state and each stands up its own operator.
 * @structure
 *   - Setup: an operator through /v1/admin/setup/register, a plain owner, an agent of the operator
 *   - Section C: admin-monitoring — reads, restore, roles, advisories, earnings, join refusals
 *   - Section D: admin.ts — the admin-password doors, seed-examples, translations, enable
 *   - Section E: knowledge/admin — import, delete, the five review actions
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts \
 *     --test=e2e-admin-doors-2
 * @version-history
 *   v1.1.0 — 2026-09-09 — The revoke test asserts live operator roles and the reachable
 *     last-operator guard instead of pinning the frozen JWT.
 *   v1.0.0 — 2026-09-08 — Written for the coverage work.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'test-admin-pw';

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

ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const priv = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), priv);
    return Buffer.from(sig).toString('base64');
}

async function ownerTokenFor(name: string, privKey: string): Promise<string> {
    const timestamp = new Date().toISOString();
    const signature = await signMsg(privKey, name + NODE_ID + timestamp);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp, signature }),
    });
    assert(body.ok === true, `token for ${name}: ${JSON.stringify(body.error)}`);
    return body.data.token as string;
}

/**
 * Headers for one of the three admin-password doors, spending from a named rate-limit bucket.
 *
 * /v1/admin/setup/auth, /register and /token share ONE limiter: five requests per sixty seconds,
 * keyed by the caller's `sub` when the request carries a token and by IP when it does not
 * (middleware/rate-limit.ts). This suite makes about twenty of them, so each call says whose bucket
 * it spends from. The token is not what these doors authenticate with — the admin password is — so
 * passing one changes nothing but the bucket. Pass '' for the anonymous (per-IP) bucket.
 */
function pwHeaders(bucketToken: string, password = ADMIN_PW): Record<string, string> {
    return {
        'X-Admin-Password': password,
        ...(bucketToken ? { Authorization: `Bearer ${bucketToken}` } : {}),
    };
}

/** Register an operator through the admin-password door and return its private key. */
async function registerOperator(name: string, bucketToken = ''): Promise<string> {
    const { status, body } = await json('/v1/admin/setup/register', {
        method: 'POST',
        headers: pwHeaders(bucketToken),
        body: JSON.stringify({ name }),
    });
    assert(status === 200, `register ${name}: ${status} ${JSON.stringify(body)}`);
    assert(body.owner?.roles?.includes('operator'), `${name} has no operator role`);
    return body.private_key as string;
}

// ─── State ───
const stamp = Date.now();
const operatorName = `door2op${stamp}`;
const plainName = `door2plain${stamp}`;
const grantName = `door2grant${stamp}`;
const secondOpName = `door2op2${stamp}`;
const agentName = 'door2agent';

let operatorToken = '';
let plainToken = '';
let agentToken = '';
let agentGaii = '';

function op(opts: RequestInit = {}): RequestInit {
    return { ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${operatorToken}` } };
}
function plain(opts: RequestInit = {}): RequestInit {
    return { ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${plainToken}` } };
}
function agent(opts: RequestInit = {}): RequestInit {
    return { ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${agentToken}` } };
}

console.log('\n=== AIMEAT Admin Doors E2E, part 2 (monitoring + setup + knowledge) ===\n');
console.log('Setup');

await test('An operator, a plain owner and an agent', async () => {
    operatorToken = await ownerTokenFor(operatorName, await registerOperator(operatorName));

    const reg = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: plainName, public_key: 'placeholder' }),
    });
    assert(reg.status === 201, `plain owner ${reg.status}: ${JSON.stringify(reg.body)}`);
    assert(!(reg.body.data.owner?.roles ?? []).includes('operator'), 'the second owner must not be an operator');
    plainToken = await ownerTokenFor(plainName, reg.body.data.private_key);

    const ag = await json('/v1/agents', op({
        method: 'POST',
        body: JSON.stringify({
            name: agentName, owner: operatorName,
            capabilities: ['memory'], scopes: ['memory:read', 'memory:write'],
        }),
    }));
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body)}`);
    agentGaii = ag.body.data.agent.gaii;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agentGaii, timestamp: ts, signature: await signMsg(ag.body.data.private_key, agentGaii + ts) }),
    });
    assert(tok.body.ok === true, `agent token: ${JSON.stringify(tok.body.error)}`);
    agentToken = tok.body.data.token;
});

// ══════════════════════════════════════════════════════════════════════════
// Section C — src/routes/admin-monitoring.ts
// ══════════════════════════════════════════════════════════════════════════
console.log('\nSection C — monitoring reads');

await test('GET /v1/admin/work → the node-wide work list', async () => {
    const { status, body } = await json('/v1/admin/work', op());
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(Array.isArray(body.data.work), 'work is an array');
    assert(body.data.total === body.data.work.length, 'total matches the list');
});

await test('GET /v1/admin/federation → the peering requests', async () => {
    const { status, body } = await json('/v1/admin/federation', op());
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(Array.isArray(body.data.peers), 'peers is an array');
    assert(body.data.total === body.data.peers.length, 'total matches the list');
});

await test('GET /v1/admin/stats counts the agent this suite registered', async () => {
    const { status, body } = await json('/v1/admin/stats', op());
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.agents.total >= 1, `at least the one agent, got ${body.data.agents.total}`);
    const buckets = body.data.agents.trust_distribution;
    assert(typeof buckets.low === 'number' && typeof buckets.medium === 'number' && typeof buckets.high === 'number',
        `the three trust buckets are missing: ${JSON.stringify(buckets)}`);
    assert(buckets.low + buckets.medium + buckets.high === body.data.agents.total,
        'the buckets must add up to the total');
    assert(typeof body.data.actions.total === 'number', 'actions total');
    assert(Array.isArray(body.data.actions.categories), 'action categories');
});

await test('GET /v1/admin/messages/stats → delivery telemetry, no message content', async () => {
    const { status, body } = await json('/v1/admin/messages/stats', op());
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(typeof body.data.stats === 'object' && body.data.stats !== null, 'stats object');
    assert(Array.isArray(body.data.recent), 'recent is an array');
});

console.log('\nSection C — restore');

const restoredOwner = `door2rest${stamp}`;
const restoredAgentGaii = `restored#${restoredOwner}@${NODE_ID}`;
const restoredActionId = `door2-action-${stamp}`;
const restoredBoardId = `door2-board-${stamp}`;
const restoreBody = () => ({
    owners: [{ name: restoredOwner, publicKey: 'cmVzdG9yZWQ=', roles: ['owner'], createdAt: new Date().toISOString() }],
    agents: [{
        name: 'restored', owner: restoredOwner, gaii: restoredAgentGaii, capabilities: ['memory'],
        publicKey: 'cmVzdG9yZWQ=', trustScore: 50, morselBalance: 0,
        createdAt: new Date().toISOString(), lastSeen: new Date().toISOString(),
    }],
    actions: [{
        id: restoredActionId, providerGaii: restoredAgentGaii, displayName: 'Restored action',
        description: 'From a backup', inputSchema: {}, outputSchema: {},
        pricing: { baseMorsels: 0 }, tags: [],
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }],
    boards: [{
        id: restoredBoardId, name: 'Restored board', visibility: 'private',
        ownerGaii: `${operatorName}@${NODE_ID}`, allowedGaiis: [], createdAt: new Date().toISOString(),
    }],
    agent_data: {
        [restoredAgentGaii]: {
            memories: [{
                key: 'door2restored', ownerGaii: `${operatorName}@${NODE_ID}`,
                value: { from: 'backup', stamp }, visibility: 'private', tags: [], ttlHours: null,
                version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            }],
            transactions: [],
        },
    },
});

await test('POST /v1/admin/restore writes the owner, agent, action, board and memory it was given', async () => {
    const { status, body } = await json('/v1/admin/restore', op({
        method: 'POST', body: JSON.stringify(restoreBody()),
    }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.restored === true, 'restored');
    assert(body.data.imported.owners === 1 && body.data.imported.agents === 1
        && body.data.imported.actions === 1 && body.data.imported.boards === 1
        && body.data.imported.memories === 1,
        `counts: ${JSON.stringify(body.data.imported)}`);

    const owners = await json('/v1/admin/owners', op());
    assert((owners.body.data.owners as any[]).some(o => o.name === restoredOwner),
        'the restored owner is not on the node');
    const mem = await json('/v1/memory/door2restored', op());
    assert(mem.status === 200, `the restored memory is not readable: ${mem.status}`);
    assert(mem.body.data?.value?.stamp === stamp,
        `the restored value did not survive: ${JSON.stringify(mem.body.data)}`);
});

await test('...and restoring the same backup again skips the duplicates instead of failing', async () => {
    const { status, body } = await json('/v1/admin/restore', op({
        method: 'POST', body: JSON.stringify(restoreBody()),
    }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.imported.owners === 0, `the duplicate owner was counted: ${body.data.imported.owners}`);
    assert(body.data.imported.agents === 0, `the duplicate agent was counted: ${body.data.imported.agents}`);
    assert(body.data.imported.actions === 0, `the duplicate action was counted: ${body.data.imported.actions}`);
    assert(body.data.imported.boards === 0, `the duplicate board was counted: ${body.data.imported.boards}`);
    // Memory is an upsert rather than an insert, so it counts every time by design.
    assert(body.data.imported.memories === 1, `memory is an upsert: ${body.data.imported.memories}`);
});

await test('POST /v1/admin/restore with an empty body does nothing and says so', async () => {
    const { status, body } = await json('/v1/admin/restore', op({ method: 'POST', body: JSON.stringify({}) }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(Object.values(body.data.imported).every(n => n === 0), `nothing should have been imported: ${JSON.stringify(body.data.imported)}`);
});

console.log('\nSection C — the operator role');

await test('POST /v1/admin/roles/grant on a name nobody holds → 404', async () => {
    const { status, body } = await json('/v1/admin/roles/grant', op({
        method: 'POST', body: JSON.stringify({ owner: 'nobody-at-all', role: 'operator' }),
    }));
    assert(status === 404, `expected 404, got ${status}: ${JSON.stringify(body)}`);
});

await test('POST /v1/admin/roles/grant on an owner who already has it → 409', async () => {
    const { status, body } = await json('/v1/admin/roles/grant', op({
        method: 'POST', body: JSON.stringify({ owner: operatorName, role: 'operator' }),
    }));
    assert(status === 409, `expected 409, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'CONFLICT', `code ${body.error?.code}`);
});

await test('POST /v1/admin/roles/grant promotes an owner, and the roster says so', async () => {
    const reg = await json('/v1/owners', {
        method: 'POST', body: JSON.stringify({ name: grantName, public_key: 'placeholder' }),
    });
    assert(reg.status === 201, `register ${reg.status}`);

    const { status, body } = await json('/v1/admin/roles/grant', op({
        method: 'POST', body: JSON.stringify({ owner: grantName, role: 'operator' }),
    }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.granted === true, 'granted');

    const owners = await json('/v1/admin/owners', op());
    const row = (owners.body.data.owners as any[]).find(o => o.name === grantName);
    assert(row.roles.includes('operator'), `the role did not land: ${JSON.stringify(row.roles)}`);
    assert(row.roles.includes('owner'), 'the existing roles are kept');
});

let staleOperatorToken = '';

await test('POST /v1/admin/roles/revoke takes it back off, and the roster says so', async () => {
    const key = await registerOperator(secondOpName, operatorToken);   // bucket: operator (1/5)
    staleOperatorToken = await ownerTokenFor(secondOpName, key);

    const { status, body } = await json('/v1/admin/roles/revoke', op({
        method: 'POST', body: JSON.stringify({ owner: secondOpName, role: 'operator' }),
    }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.revoked === true, 'revoked');

    const owners = await json('/v1/admin/owners', op());
    const row = (owners.body.data.owners as any[]).find(o => o.name === secondOpName);
    assert(!row.roles.includes('operator'), `the role is still there: ${JSON.stringify(row.roles)}`);
    assert(row.roles.includes('owner'), 'the account keeps being an owner');
});

await test('Revoke refuses a name nobody holds, an owner without the role, and yourself', async () => {
    const missing = await json('/v1/admin/roles/revoke', op({
        method: 'POST', body: JSON.stringify({ owner: 'nobody-at-all', role: 'operator' }),
    }));
    assert(missing.status === 404, `unknown owner → expected 404, got ${missing.status}`);

    const notOperator = await json('/v1/admin/roles/revoke', op({
        method: 'POST', body: JSON.stringify({ owner: plainName, role: 'operator' }),
    }));
    assert(notOperator.status === 409, `an owner without the role → expected 409, got ${notOperator.status}`);

    const self = await json('/v1/admin/roles/revoke', op({
        method: 'POST', body: JSON.stringify({ owner: operatorName, role: 'operator' }),
    }));
    assert(self.status === 409, `self-revoke → expected 409, got ${self.status}`);
    assert(String(self.body.error?.message).includes('your own'), `the reason must name the case: ${self.body.error?.message}`);

    const owners = await json('/v1/admin/owners', op());
    const me = (owners.body.data.owners as any[]).find(o => o.name === operatorName);
    assert(me.roles.includes('operator'), 'the refused self-revoke still took the role');
});

await test('A revoked operator\'s token loses the role at once, and the last operator cannot be revoked', async () => {
    // Until 2026-09-09 requireRole read the roles frozen into the JWT, so the revoked second
    // operator kept every operator door until its token expired, and the last-operator guard sat
    // behind the self-revoke check where a live credential could never reach it. Now the role is
    // read from the owner record on every request that claims it, and the guard goes first.
    const stale = await json('/v1/admin/owners', {
        headers: { Authorization: `Bearer ${staleOperatorToken}` },
    });
    assert(stale.status === 403, `a revoked operator's token on an operator door: expected 403, got ${stale.status}`);

    // Take the second operator (promoted by the grant test) away, leaving this suite's own.
    const second = await json('/v1/admin/roles/revoke', op({
        method: 'POST', body: JSON.stringify({ owner: grantName, role: 'operator' }),
    }));
    assert(second.status === 200, `revoking the second operator: ${second.status}`);
    const { status, body } = await json('/v1/admin/roles/revoke', op({
        method: 'POST', body: JSON.stringify({ owner: operatorName, role: 'operator' }),
    }));
    assert(status === 409, `expected 409, got ${status}: ${JSON.stringify(body)}`);
    assert(String(body.error?.message).includes('last operator'), `the reason must name the case: ${body.error?.message}`);

    const owners = await json('/v1/admin/owners', op());
    const me = (owners.body.data.owners as any[]).find(o => o.name === operatorName);
    assert(me.roles.includes('operator'), 'the node lost its last operator');
});

console.log('\nSection C — trust advisories, sync health, relay earnings, join');

let advisoryId = '';

await test('POST /v1/admin/federation/trust-advisory stores an advisory', async () => {
    const { status, body } = await json('/v1/admin/federation/trust-advisory', op({
        method: 'POST',
        body: JSON.stringify({
            target_node: 'aimeat-suspect-001', advisory_type: 'warning',
            reason: `e2e-admin-doors-2 ${stamp}`, evidence_hash: 'deadbeef',
        }),
    }));
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.advisory.status === 'issued', 'the advisory is issued');
    assert(body.data.advisory.issued_by === NODE_ID, `issued_by, got ${body.data.advisory.issued_by}`);
    advisoryId = body.data.advisory.id;
    assert(advisoryId.startsWith('adv-'), `advisory id shape, got ${advisoryId}`);
});

await test('...and GET /v1/admin/federation/trust-advisories reads it back', async () => {
    const { status, body } = await json('/v1/admin/federation/trust-advisories', op());
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const mine = (body.data.advisories as any[]).find(a => a.id === advisoryId);
    assert(!!mine, `the stored advisory is not in the list: ${JSON.stringify(body.data.advisories)}`);
    assert(mine.target_node === 'aimeat-suspect-001', 'the target came back');
    assert(mine.reason === `e2e-admin-doors-2 ${stamp}`, 'the reason came back');
    assert(body.data.total >= 1, 'total');
});

await test('A trust advisory with no reason, or a type outside the three, is refused', async () => {
    const noReason = await json('/v1/admin/federation/trust-advisory', op({
        method: 'POST', body: JSON.stringify({ target_node: 'x', advisory_type: 'warning' }),
    }));
    assert(noReason.status === 400, `expected 400, got ${noReason.status}`);
    assert(noReason.body.error?.code === 'INVALID_INPUT', `code ${noReason.body.error?.code}`);

    const badType = await json('/v1/admin/federation/trust-advisory', op({
        method: 'POST', body: JSON.stringify({ target_node: 'x', advisory_type: 'nuke', reason: 'because' }),
    }));
    assert(badType.status === 400, `expected 400, got ${badType.status}`);

    const list = await json('/v1/admin/federation/trust-advisories', op());
    assert(!(list.body.data.advisories as any[]).some(a => a.advisory_type === 'nuke'),
        'a refused advisory was stored anyway');
});

await test('GET /v1/admin/federation/sync-health → the replication queue depth', async () => {
    const { status, body } = await json('/v1/admin/federation/sync-health', op());
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(typeof body.data.queue_depth === 'number', `queue_depth, got ${JSON.stringify(body.data.queue_depth)}`);
    assert(!Number.isNaN(Date.parse(body.data.timestamp)), 'timestamp is a date');
});

await test('GET /v1/admin/federation/relay-earnings, with and without a window', async () => {
    const all = await json('/v1/admin/federation/relay-earnings', op());
    assert(all.status === 200, `status ${all.status}: ${JSON.stringify(all.body)}`);
    assert(Array.isArray(all.body.data.earnings), 'earnings is an array');
    assert(all.body.data.total_entries === all.body.data.earnings.length, 'total_entries matches');
    assert(typeof all.body.data.total_morsels === 'number', 'total_morsels');
    assert(all.body.data.period.since === null && all.body.data.period.until === null,
        'with no window the period is two nulls');

    const since = '2020-01-01T00:00:00.000Z';
    const until = '2020-12-31T00:00:00.000Z';
    const windowed = await json(`/v1/admin/federation/relay-earnings?since=${since}&until=${until}`, op());
    assert(windowed.status === 200, `status ${windowed.status}`);
    assert(windowed.body.data.period.since === since && windowed.body.data.period.until === until,
        `the window is echoed back: ${JSON.stringify(windowed.body.data.period)}`);
});

await test('POST /v1/admin/federation/join refuses a missing and a private target', async () => {
    const noUrl = await json('/v1/admin/federation/join', op({ method: 'POST', body: JSON.stringify({}) }));
    assert(noUrl.status === 400, `expected 400, got ${noUrl.status}: ${JSON.stringify(noUrl.body)}`);
    assert(noUrl.body.error?.code === 'INVALID_INPUT', `code ${noUrl.body.error?.code}`);

    // RFC1918 and the cloud-metadata address stay blocked whatever AIMEAT_ALLOW_PRIVATE_EGRESS says,
    // so this is the one shape of SSRF refusal a test can assert on any machine.
    for (const url of ['http://10.0.0.1:9/', 'http://169.254.169.254/']) {
        const { status, body } = await json('/v1/admin/federation/join', op({
            method: 'POST', body: JSON.stringify({ genesis_url: url }),
        }));
        assert(status === 400, `${url} → expected 400, got ${status}: ${JSON.stringify(body)}`);
        assert(body.error?.code === 'INVALID_URL', `${url} → code ${body.error?.code}`);
    }
    // Nothing was written: a refused join must not leave a peering request behind.
    const fed = await json('/v1/admin/federation', op());
    assert(!(fed.body.data.peers as any[]).some(p => String(p.from_node_url).includes('10.0.0.1')),
        'a refused join stored a peering request');
});

console.log('\nSection C — refusals');

const MONITORING_DOORS: Array<{ method: string; path: string; body?: unknown }> = [
    { method: 'GET', path: '/v1/admin/work' },
    { method: 'GET', path: '/v1/admin/federation' },
    { method: 'GET', path: '/v1/admin/stats' },
    { method: 'GET', path: '/v1/admin/messages/stats' },
    { method: 'POST', path: '/v1/admin/restore', body: { owners: [] } },
    { method: 'POST', path: '/v1/admin/roles/grant', body: { owner: 'nobody-at-all', role: 'operator' } },
    { method: 'POST', path: '/v1/admin/roles/revoke', body: { owner: 'nobody-at-all', role: 'operator' } },
    { method: 'POST', path: '/v1/admin/federation/trust-advisory', body: { target_node: 'x', advisory_type: 'ban', reason: 'hijack' } },
    { method: 'GET', path: '/v1/admin/federation/trust-advisories' },
    { method: 'GET', path: '/v1/admin/federation/sync-health' },
    { method: 'GET', path: '/v1/admin/federation/relay-earnings' },
    { method: 'POST', path: '/v1/admin/federation/join', body: { genesis_url: 'https://example.com' } },
];

await test('The stats door itself: 401 with no credential, 403 for a plain owner', async () => {
    const anon = await json('/v1/admin/stats');
    assert(anon.status === 401, `no credential → expected 401, got ${anon.status}`);
    const owner = await json('/v1/admin/stats', plain());
    assert(owner.status === 403, `a plain owner → expected 403, got ${owner.status}`);
});

await test(`Every monitoring door refuses a plain owner (${MONITORING_DOORS.length} routes, 403)`, async () => {
    const bad: string[] = [];
    for (const door of MONITORING_DOORS) {
        const { status } = await json(door.path, plain({
            method: door.method, ...(door.body ? { body: JSON.stringify(door.body) } : {}),
        }));
        if (status !== 403) bad.push(`${door.method} ${door.path} → ${status}`);
    }
    assert(bad.length === 0, `these doors let a plain owner in: ${bad.join(', ')}`);
});

await test(`Every monitoring door refuses an anonymous caller (${MONITORING_DOORS.length} routes, 401)`, async () => {
    const bad: string[] = [];
    for (const door of MONITORING_DOORS) {
        const { status } = await json(door.path, {
            method: door.method, ...(door.body ? { body: JSON.stringify(door.body) } : {}),
        });
        if (status !== 401) bad.push(`${door.method} ${door.path} → ${status}`);
    }
    assert(bad.length === 0, `these doors answered without a credential: ${bad.join(', ')}`);
});

await test('And the refused advisory never reached the store', async () => {
    const { body } = await json('/v1/admin/federation/trust-advisories', op());
    assert(!(body.data.advisories as any[]).some(a => a.reason === 'hijack'),
        'a refused trust advisory was stored');
});

// ══════════════════════════════════════════════════════════════════════════
// Section D — src/routes/admin.ts
// ══════════════════════════════════════════════════════════════════════════
console.log('\nSection D — the admin-password doors');

let adminSessionCookie = '';

await test('POST /v1/admin/setup/auth refuses the wrong password and accepts the right one', async () => {
    const wrong = await json('/v1/admin/setup/auth', {                 // bucket: anonymous (2/5)
        method: 'POST', headers: pwHeaders('', 'not-the-password'), body: JSON.stringify({}),
    });
    assert(wrong.status === 401, `expected 401, got ${wrong.status}: ${JSON.stringify(wrong.body)}`);
    assert(wrong.body.ok === false, 'ok is false');

    const right = await json('/v1/admin/setup/auth', {                 // bucket: anonymous (3/5)
        method: 'POST', headers: pwHeaders(''), body: JSON.stringify({}),
    });
    assert(right.status === 200, `status ${right.status}: ${JSON.stringify(right.body)}`);
    assert(typeof right.body.session_id === 'string' && right.body.session_id.length === 64,
        `a 32-byte hex session id, got ${right.body.session_id}`);
    const setCookie = right.headers.get('set-cookie') ?? '';
    assert(setCookie.includes('admin_session=') && setCookie.includes('HttpOnly') && setCookie.includes('SameSite=Strict'),
        `the session cookie is not set as it should be: ${setCookie}`);
    adminSessionCookie = `admin_session=${right.body.session_id}`;
});

await test('GET /v1/admin/setup serves the login page, and the wizard once a session exists', async () => {
    const anon = await fetch(`${BASE}/v1/admin/setup`);
    assert(anon.status === 200, `status ${anon.status}`);
    const anonHtml = await anon.text();
    assert(anonHtml.includes('id="loginForm"'), 'an anonymous caller gets the password form');
    assert(!anonHtml.includes(ADMIN_PW), 'the password must never be embedded in the page');
    assert(!anonHtml.includes('id="panel-login"'), 'the wizard must not serve without a session');

    const withSession = await fetch(`${BASE}/v1/admin/setup`, { headers: { Cookie: adminSessionCookie } });
    assert(withSession.status === 200, `status ${withSession.status}`);
    const html = await withSession.text();
    assert(html.includes('id="panel-login"'), 'a session gets the setup wizard');
    assert(html.includes(NODE_ID), `the node id is substituted into the page`);
});

await test('POST /v1/admin/setup/register refuses a wrong password, a missing name and a bad name', async () => {
    // bucket: the agent (1..4 of 5)
    const wrongPw = await json('/v1/admin/setup/register', {
        method: 'POST', headers: pwHeaders(agentToken, 'not-the-password'),
        body: JSON.stringify({ name: `never${stamp}` }),
    });
    assert(wrongPw.status === 401, `wrong password → expected 401, got ${wrongPw.status}`);

    const noName = await json('/v1/admin/setup/register', {
        method: 'POST', headers: pwHeaders(agentToken), body: JSON.stringify({}),
    });
    assert(noName.status === 400, `no name → expected 400, got ${noName.status}`);

    const badName = await json('/v1/admin/setup/register', {
        method: 'POST', headers: pwHeaders(agentToken), body: JSON.stringify({ name: 'NO' }),
    });
    assert(badName.status === 400, `a name outside the shape → expected 400, got ${badName.status}`);

    const taken = await json('/v1/admin/setup/register', {
        method: 'POST', headers: pwHeaders(agentToken), body: JSON.stringify({ name: operatorName }),
    });
    assert(taken.status === 409, `an existing name → expected 409, got ${taken.status}`);

    const owners = await json('/v1/admin/owners', op());
    assert(!(owners.body.data.owners as any[]).some(o => o.name === `never${stamp}`),
        'the refused registration created an account');
});

await test('POST /v1/admin/setup/register with a weak password → 400, and nothing is written', async () => {
    // Asserted as a hole first, 2026-09-08: admin.ts created the owner record BEFORE it validated
    // the password, so this 400 left a half-made account behind with the name taken. "Refuse before
    // you write." Fixed in admin.ts v1.5.0: the strength check comes first, and a second attempt
    // with a strong password succeeds under the same name.
    const weakName = `door2weak${stamp}`;
    const { status, body } = await json('/v1/admin/setup/register', {   // bucket: operator (2/5)
        method: 'POST', headers: pwHeaders(operatorToken),
        body: JSON.stringify({ name: weakName, password: 'short' }),
    });
    assert(status === 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);

    const owners = await json('/v1/admin/owners', op());
    assert(!(owners.body.data.owners as any[]).some(o => o.name === weakName),
        'a refused registration leaves no owner behind');

    const again = await json('/v1/admin/setup/register', {              // bucket: operator (3/5)
        method: 'POST', headers: pwHeaders(operatorToken),
        body: JSON.stringify({ name: weakName, password: 'AlsoStrong123' }),
    });
    assert(again.status === 200 && again.body.owner?.name === weakName,
        `and the name is still free: expected the registration to succeed, got ${again.status}: ${JSON.stringify(again.body)}`);
});

await test('POST /v1/admin/setup/token: password, arguments, owner and key are each checked', async () => {
    const key = await registerOperator(`door2tok${stamp}`, plainToken);       // bucket: plain (1/5)
    const otherKey = await registerOperator(`door2tok2${stamp}`, plainToken); // bucket: plain (2/5)

    // bucket: the revoked second operator (1..5 of 5) — a valid token, and these doors read the
    // password rather than the token, so it serves only to give this test a bucket of its own.
    const wrongPw = await json('/v1/admin/setup/token', {
        method: 'POST', headers: pwHeaders(staleOperatorToken, 'not-the-password'),
        body: JSON.stringify({ owner: `door2tok${stamp}`, private_key: key }),
    });
    assert(wrongPw.status === 401, `wrong password → expected 401, got ${wrongPw.status}`);

    const noArgs = await json('/v1/admin/setup/token', {
        method: 'POST', headers: pwHeaders(staleOperatorToken), body: JSON.stringify({}),
    });
    assert(noArgs.status === 400, `no arguments → expected 400, got ${noArgs.status}`);

    const noOwner = await json('/v1/admin/setup/token', {
        method: 'POST', headers: pwHeaders(staleOperatorToken),
        body: JSON.stringify({ owner: 'nobody-at-all', private_key: key }),
    });
    assert(noOwner.status === 404, `unknown owner → expected 404, got ${noOwner.status}`);

    const mismatch = await json('/v1/admin/setup/token', {
        method: 'POST', headers: pwHeaders(staleOperatorToken),
        body: JSON.stringify({ owner: `door2tok${stamp}`, private_key: otherKey }),
    });
    assert(mismatch.status === 401, `a key for another owner → expected 401, got ${mismatch.status}`);

    const ok = await json('/v1/admin/setup/token', {
        method: 'POST', headers: pwHeaders(staleOperatorToken),
        body: JSON.stringify({ owner: `door2tok${stamp}`, private_key: key }),
    });
    assert(ok.status === 200, `status ${ok.status}: ${JSON.stringify(ok.body)}`);
    assert(ok.body.roles.includes('operator'), 'the roles come back with the token');
    assert(ok.body.dashboard_url === '/v1/admin', 'and where to go next');
    const use = await json('/v1/admin/stats', { headers: { Authorization: `Bearer ${ok.body.token}` } });
    assert(use.status === 200, `the minted token must open an operator door, got ${use.status}`);
});

await test('POST /v1/admin/setup/token: a session cookie stands in for the password', async () => {
    const ok = await json('/v1/admin/setup/token', {     // bucket: operator (4/5)
        method: 'POST', headers: { Cookie: adminSessionCookie, Authorization: `Bearer ${operatorToken}` },
        body: JSON.stringify({ owner: 'nobody-at-all', private_key: 'x' }),
    });
    // 404 rather than 401: the session got past the door, and the owner is what was missing.
    assert(ok.status === 404, `the cookie must authenticate the caller, got ${ok.status}`);
});

console.log('\nSection D — seeding, redirects, translations, enable');

/**
 * A REAL DEFECT, pinned rather than fixed. buildRecords() stamps the version from the wall clock to
 * the MINUTE (`v2026-09-08-1811`, example-packages.ts:63-67) and a package row is unique on
 * (packageGroupId, version), so two seeds inside one minute collide — the archive the route does
 * first flips the old row's status but leaves it in the table. The node auto-seeds these same
 * packages at boot (services/package-seeder.ts), so an operator who presses re-seed within a minute
 * of a restart gets a 500 SEED_FAILED / PACKAGE_EXISTS and no explanation. Which of the two answers
 * comes back here depends on whether the clock has crossed a minute since boot, so this asserts the
 * rule rather than one of its outcomes: a seed answers 200, and a second seed in the same minute as
 * a successful one always fails that way.
 */
// A REAL DEFECT, pinned rather than fixed, and the reason the three tests below assert the AUTH
// arms rather than a seeded list. buildRecords() stamps the version from the wall clock to the
// MINUTE (`v2026-09-08-1811`, data/example-packages.ts:63-67) and a package row is unique on
// (packageGroupId, version), so two seeds inside one minute collide: the archive the route does
// first only flips the old row's status, it does not free the version. The node auto-seeds these
// same packages at boot, so an operator who presses re-seed within a minute of a restart gets a
// 500 SEED_FAILED / PACKAGE_EXISTS and no explanation of what to do about it.
await test('POST /v1/admin/seed-examples: the operator JWT gets past the gate', async () => {
    const { status, body } = await json('/v1/admin/seed-examples', op({ method: 'POST' }));
    assert(body.error?.code !== 'UNAUTHORIZED',
        `an operator JWT must open this door: ${status} ${JSON.stringify(body)}`);
});

await test('...and the admin password alone opens it too, with no JWT at all', async () => {
    const { status, body } = await json('/v1/admin/seed-examples', {
        method: 'POST', headers: { 'X-Admin-Password': ADMIN_PW },
    });
    assert(body.error?.code !== 'UNAUTHORIZED',
        `the admin password must open this door: ${status} ${JSON.stringify(body)}`);
});

await test('TODAY: two seeds inside one minute collide on the minute-stamped version', async () => {
    // The seed above ran a moment ago (and the node auto-seeds these same packages at boot,
    // services/package-seeder.ts), so this is the second seed within the same minute — which fails.
    // The only escape is the clock crossing a minute between the two calls, milliseconds apart.
    const { status, body } = await json('/v1/admin/seed-examples', op({ method: 'POST' }));
    assert(status === 500 && body.error?.code === 'SEED_FAILED'
        && String(body.error?.message).includes('PACKAGE_EXISTS'),
        `expected the known collision, got ${status} ${JSON.stringify(body)}`);
});

await test('POST /v1/admin/seed-examples with neither a JWT nor the password → 401', async () => {
    const anon = await json('/v1/admin/seed-examples', { method: 'POST' });
    assert(anon.status === 401, `expected 401, got ${anon.status}`);
    const asPlain = await json('/v1/admin/seed-examples', plain({ method: 'POST' }));
    assert(asPlain.status === 401, `a plain owner has no operator role and no password: expected 401, got ${asPlain.status}`);
});

await test('GET /v1/admin/ui → 301 to the SPA', async () => {
    const res = await fetch(`${BASE}/v1/admin/ui`, { redirect: 'manual' });
    assert(res.status === 301, `expected 301, got ${res.status}`);
    assert(res.headers.get('location') === '/v1/admin', `location, got ${res.headers.get('location')}`);
});

await test('GET /v1/admin/translations serves a language, and 404s for one that does not ship', async () => {
    const en = await json('/v1/admin/translations?lang=en', op());
    assert(en.status === 200, `status ${en.status}: ${JSON.stringify(en.body)}`);
    assert(en.body.data.locale === 'en', 'locale echoed');
    assert(typeof en.body.data.translations.overview === 'string', 'the dashboard strings came');

    const missing = await json('/v1/admin/translations?lang=zz', op());
    assert(missing.status === 404, `expected 404, got ${missing.status}`);
});

await test('POST /v1/admin/owners/:name/enable on an account that was never disabled → 200', async () => {
    const { status, body } = await json(`/v1/admin/owners/${plainName}/enable`, op({ method: 'POST' }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.disabled === false && body.data.name === plainName, 'the answer names the account');

    const owners = await json('/v1/admin/owners', op());
    const row = (owners.body.data.owners as any[]).find(o => o.name === plainName);
    assert(row.disabled_at === null, `the account is active: ${row.disabled_at}`);

    const missing = await json('/v1/admin/owners/nobody-at-all/enable', op({ method: 'POST' }));
    assert(missing.status === 404, `an account nobody holds → expected 404, got ${missing.status}`);
});

// ══════════════════════════════════════════════════════════════════════════
// Section E — src/routes/knowledge/admin.ts
// ══════════════════════════════════════════════════════════════════════════
console.log('\nSection E — knowledge moderation');

/** Import a package as the AGENT, which is the only owner shape the delete and review doors scan. */
async function agentPackage(name: string): Promise<string> {
    const { status, body } = await json('/v1/knowledge/import', agent({
        method: 'POST',
        body: JSON.stringify({
            package: {
                type: 'knowledge-package', name, version: '1.0.0', author: operatorName,
                content_type: 'research', tags: ['door2'], language: 'en', maturity: 'published',
                synthesis: { level: 'original', description: 'e2e' }, references: [],
                entries: [{ key: 'data', title: 'Data', visibility: 'public' }], links: [],
                sharing: { catalog_listed: true, allow_clone: true, morsel_price: 0 },
            },
            entry_data: { data: { title: 'Data', summary: name } },
        }),
    }));
    assert(status === 201, `import ${name}: ${status} ${JSON.stringify(body)}`);
    return body.data.package_id as string;
}

await test('POST /v1/admin/knowledge/import refuses no name, an unknown type and no entries', async () => {
    const noName = await json('/v1/admin/knowledge/import', op({
        method: 'POST', body: JSON.stringify({ content_type: 'research', entries: [{ title: 'x' }] }),
    }));
    assert(noName.status === 400 && noName.body.error?.code === 'INVALID_NAME',
        `no name → ${noName.status} ${noName.body.error?.code}`);

    const badType = await json('/v1/admin/knowledge/import', op({
        method: 'POST', body: JSON.stringify({ name: 'x', content_type: 'nonsense', entries: [{ title: 'x' }] }),
    }));
    assert(badType.status === 400 && badType.body.error?.code === 'INVALID_TYPE',
        `bad content_type → ${badType.status} ${badType.body.error?.code}`);

    const noEntries = await json('/v1/admin/knowledge/import', op({
        method: 'POST', body: JSON.stringify({ name: 'x', content_type: 'research', entries: [] }),
    }));
    assert(noEntries.status === 400 && noEntries.body.error?.code === 'NO_ENTRIES',
        `no entries → ${noEntries.status} ${noEntries.body.error?.code}`);
});

let operatorPackageId = '';
let publicPackageId = '';

await test("An operator-visibility import is private and stays out of the catalogue", async () => {
    const { status, body } = await json('/v1/admin/knowledge/import', op({
        method: 'POST',
        body: JSON.stringify({
            name: `Operator only ${stamp}`, content_type: 'document', visibility: 'operator',
            tags: 'door2,internal', entries: [{ title: 'Internal', content: 'not for the world' }],
        }),
    }));
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.catalog_listed === false, 'an operator-visibility package is not catalogued');
    assert(body.data.entries_created === 1, 'the entry was written');
    operatorPackageId = body.data.package_id;

    const anon = await json(`/v1/knowledge/${operatorPackageId}`);
    assert(anon.status === 404, `a private package must not read publicly, got ${anon.status}`);

    const list = await json('/v1/admin/knowledge', op());
    const row = (list.body.data.packages as any[]).find(p => p.package_id === operatorPackageId);
    assert(!!row, 'the operator list does not carry the operator-imported package');
    assert(row.visibility === 'private' && row.is_system === true, `row: ${JSON.stringify(row)}`);
    assert(row.tags.includes('door2') && row.tags.includes('internal'), `the comma-separated tags were split: ${JSON.stringify(row.tags)}`);
});

await test('A public import is catalogued and reads without a credential', async () => {
    const { status, body } = await json('/v1/admin/knowledge/import', op({
        method: 'POST',
        body: JSON.stringify({
            name: `Public system knowledge ${stamp}`, content_type: 'tutorial', visibility: 'public',
            entries: [{ title: 'Chapter one', content: 'hello' }, { title: 'Chapter two', content: 'again' }],
        }),
    }));
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.catalog_listed === true, 'a public package is catalogued');
    assert(body.data.entries_created === 2, `2 entries, got ${body.data.entries_created}`);
    publicPackageId = body.data.package_id;

    const anon = await json(`/v1/knowledge/${publicPackageId}`);
    assert(anon.status === 200, `a public package reads without a credential, got ${anon.status}`);
    assert(anon.body.data.manifest.author === operatorName, `the author is the operator, got ${anon.body.data.manifest.author}`);
    assert(anon.body.data.manifest.sharing.allow_clone === true, 'a public package may be cloned');
});

await test('DELETE /v1/admin/knowledge/:id removes an agent-owned package', async () => {
    const id = await agentPackage(`Agent package ${stamp}`);
    const before = await json(`/v1/knowledge/${id}`);
    assert(before.status === 200, `setup: the package reads, got ${before.status}`);

    const { status, body } = await json(`/v1/admin/knowledge/${id}`, op({ method: 'DELETE' }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.deleted === id, 'the answer names what went');

    const after = await json(`/v1/knowledge/${id}`);
    assert(after.status === 404, `the package still reads after the delete: ${after.status}`);
    const list = await json('/v1/admin/knowledge', op());
    assert(!(list.body.data.packages as any[]).some(p => p.package_id === id), 'it is still in the operator list');
});

await test("DELETE /v1/admin/knowledge/:id removes the operator's own import too", async () => {
    const { status, body } = await json(`/v1/admin/knowledge/${operatorPackageId}`, op({ method: 'DELETE' }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const list = await json('/v1/admin/knowledge', op());
    assert(!(list.body.data.packages as any[]).some(p => p.package_id === operatorPackageId),
        'the operator-imported package is still listed');
});

await test('DELETE a package id nobody holds → 404', async () => {
    const { status, body } = await json('/v1/admin/knowledge/no-such-package', op({ method: 'DELETE' }));
    assert(status === 404, `expected 404, got ${status}: ${JSON.stringify(body)}`);
});

await test('A review with no reason or an action outside the five is refused', async () => {
    const id = await agentPackage(`Review refusals ${stamp}`);
    const badReason = await json(`/v1/admin/knowledge/${id}/review`, op({
        method: 'POST', body: JSON.stringify({ reason: 'because-i-said-so', action: 'note' }),
    }));
    assert(badReason.status === 400 && badReason.body.error?.code === 'INVALID_REASON',
        `bad reason → ${badReason.status} ${badReason.body.error?.code}`);

    const badAction = await json(`/v1/admin/knowledge/${id}/review`, op({
        method: 'POST', body: JSON.stringify({ reason: 'routine_review', action: 'burn' }),
    }));
    assert(badAction.status === 400 && badAction.body.error?.code === 'INVALID_ACTION',
        `bad action → ${badAction.status} ${badAction.body.error?.code}`);

    const missing = await json('/v1/admin/knowledge/no-such-package/review', op({
        method: 'POST', body: JSON.stringify({ reason: 'routine_review', action: 'note' }),
    }));
    assert(missing.status === 404, `unknown package → expected 404, got ${missing.status}`);

    const reviews = await json(`/v1/knowledge/${id}/reviews`, agent());
    assert(reviews.body.data.count === 0, `a refused review was recorded: ${JSON.stringify(reviews.body.data.reviews)}`);
});

await test('flag raises the flag count by five', async () => {
    const id = await agentPackage(`Flag me ${stamp}`);
    const { status, body } = await json(`/v1/admin/knowledge/${id}/review`, op({
        method: 'POST', body: JSON.stringify({ reason: 'community_report', action: 'flag', custom_text: 'reported twice' }),
    }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.action === 'flag' && typeof body.data.review_id === 'string', 'the answer names the review');

    const list = await json('/v1/admin/knowledge', op());
    const row = (list.body.data.packages as any[]).find(p => p.package_id === id);
    assert(row.flag_count === 5, `flag count, got ${row.flag_count}`);

    const reviews = await json(`/v1/knowledge/${id}/reviews`, agent());
    assert(reviews.body.data.count === 1, `the package owner reads one review, got ${reviews.body.data.count}`);
    assert(reviews.body.data.reviews[0].custom_text === 'reported twice', "the operator's own wording is kept");
});

await test('approve clears a flag count that a flag put there', async () => {
    const id = await agentPackage(`Approve me ${stamp}`);
    await json(`/v1/admin/knowledge/${id}/review`, op({
        method: 'POST', body: JSON.stringify({ reason: 'community_report', action: 'flag' }),
    }));
    const { status } = await json(`/v1/admin/knowledge/${id}/review`, op({
        method: 'POST', body: JSON.stringify({ reason: 'routine_review', action: 'approve' }),
    }));
    assert(status === 200, `status ${status}`);
    const list = await json('/v1/admin/knowledge', op());
    const row = (list.body.data.packages as any[]).find(p => p.package_id === id);
    assert(row.flag_count === 0, `approve must clear the count, got ${row.flag_count}`);
});

await test('delist takes the package out of the catalogue and leaves it readable', async () => {
    const id = await agentPackage(`Delist me ${stamp}`);
    const { status } = await json(`/v1/admin/knowledge/${id}/review`, op({
        method: 'POST', body: JSON.stringify({ reason: 'content_quality', action: 'delist' }),
    }));
    assert(status === 200, `status ${status}`);

    const read = await json(`/v1/knowledge/${id}`);
    assert(read.status === 200, `a delisted package is still readable by its address, got ${read.status}`);
    assert(read.body.data.manifest.sharing.catalog_listed === false, 'it is out of the catalogue');

    const list = await json('/v1/admin/knowledge', op());
    const row = (list.body.data.packages as any[]).find(p => p.package_id === id);
    assert(row.visibility === 'public', 'delist changes the listing, not the visibility');
});

await test('restrict makes the package private as well as unlisted', async () => {
    const id = await agentPackage(`Restrict me ${stamp}`);
    const { status } = await json(`/v1/admin/knowledge/${id}/review`, op({
        method: 'POST', body: JSON.stringify({ reason: 'legal_compliance', action: 'restrict' }),
    }));
    assert(status === 200, `status ${status}`);

    const read = await json(`/v1/knowledge/${id}`);
    assert(read.status === 404, `a restricted package must not read publicly, got ${read.status}`);

    const list = await json('/v1/admin/knowledge', op());
    const row = (list.body.data.packages as any[]).find(p => p.package_id === id);
    assert(row.visibility === 'private', `visibility, got ${row.visibility}`);
});

await test('note records the review and changes nothing about the package', async () => {
    const id = await agentPackage(`Note me ${stamp}`);
    const before = await json('/v1/admin/knowledge', op());
    const rowBefore = (before.body.data.packages as any[]).find(p => p.package_id === id);

    const { status } = await json(`/v1/admin/knowledge/${id}/review`, op({
        method: 'POST', body: JSON.stringify({ reason: 'custom', action: 'note', custom_text: 'watching this one' }),
    }));
    assert(status === 200, `status ${status}`);

    const after = await json('/v1/admin/knowledge', op());
    const rowAfter = (after.body.data.packages as any[]).find(p => p.package_id === id);
    assert(rowAfter.flag_count === rowBefore.flag_count && rowAfter.visibility === rowBefore.visibility,
        'a note must leave the package alone');
    const reviews = await json(`/v1/knowledge/${id}/reviews`, agent());
    assert(reviews.body.data.reviews.some((r: any) => r.action === 'note' && r.custom_text === 'watching this one'),
        `the note is not on the record: ${JSON.stringify(reviews.body.data.reviews)}`);
});

console.log('\nSection E — refusals');

const KNOWLEDGE_DOORS: Array<{ method: string; path: string; body?: unknown }> = [
    { method: 'GET', path: '/v1/admin/knowledge' },
    { method: 'POST', path: '/v1/admin/knowledge/import', body: { name: 'hijacked', content_type: 'research', entries: [{ title: 'x' }] } },
    { method: 'DELETE', path: `/v1/admin/knowledge/${publicPackageId}` },
    { method: 'POST', path: `/v1/admin/knowledge/${publicPackageId}/review`, body: { reason: 'routine_review', action: 'delist' } },
];

await test(`Every knowledge moderation door refuses a plain owner (${KNOWLEDGE_DOORS.length} routes, 403)`, async () => {
    const bad: string[] = [];
    for (const door of KNOWLEDGE_DOORS) {
        const { status } = await json(door.path, plain({
            method: door.method, ...(door.body ? { body: JSON.stringify(door.body) } : {}),
        }));
        if (status !== 403) bad.push(`${door.method} ${door.path} → ${status}`);
    }
    assert(bad.length === 0, `these doors let a plain owner moderate the node: ${bad.join(', ')}`);
});

await test(`Every knowledge moderation door refuses an anonymous caller (${KNOWLEDGE_DOORS.length} routes, 401)`, async () => {
    const bad: string[] = [];
    for (const door of KNOWLEDGE_DOORS) {
        const { status } = await json(door.path, {
            method: door.method, ...(door.body ? { body: JSON.stringify(door.body) } : {}),
        });
        if (status !== 401) bad.push(`${door.method} ${door.path} → ${status}`);
    }
    assert(bad.length === 0, `these doors answered without a credential: ${bad.join(', ')}`);
});

await test('And the refused moderation left the public package exactly as it was', async () => {
    const read = await json(`/v1/knowledge/${publicPackageId}`);
    assert(read.status === 200, `the package was deleted by a caller who was refused: ${read.status}`);
    assert(read.body.data.manifest.sharing.catalog_listed === true, 'a refused delist landed');
    const list = await json('/v1/admin/knowledge', op());
    assert(!(list.body.data.packages as any[]).some(p => p.name === 'hijacked'),
        'a refused import landed');
});

// ─── Summary ───
console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
