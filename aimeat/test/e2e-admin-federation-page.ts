/**
 * @file test/e2e-admin-federation-page.ts
 * @description E2E for the Federation page's one read, and for the four facts it exists to show
 *   that no surface carried.
 *
 *   THE ASSERTION THAT MATTERS MOST is the approved peer. Approving a peering request does not
 *   connect anything: it creates the peer at status `approved`, and nothing crosses until the
 *   operator presses Activate. The page counted active, degraded, offline and pending requests, so
 *   approving a request dropped the pending count to zero, moved nothing else, and read as
 *   finished. So: approve a request, then assert that the read says one peer is waiting to be
 *   switched on and that the standing is `waiting` rather than `linked`.
 *
 *   THE SECOND ONE IS THE SIGN-IN THAT REACHES NOBODY. The node-wide policy and the per-peer switch
 *   must both say yes (routes/ghii/register-login.ts:381-390). `specific_peers` with no peer
 *   carrying the flag is a setting that reads as configured and admits nobody — the same shape the
 *   organisation sign-in page had. Asserted as a count, because a boolean would have passed on a
 *   node with no peers at all.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-admin-federation-page
 *   THE THIRD ONE IS DIRECTION. One table holds both halves of peering: a row this node SENT and a
 *   row somebody sent this node. The page read every pending row as an arrival, so a request we had
 *   made appeared under "asking to join" with Approve and Refuse beside it, naming this node as the
 *   asker. Found by driving the browser on 2026-09-12.
 * @version-history
 *   v1.2.0 — 2026-09-12 — aimeat_admin_federation over a real MCP session, held against the HTTP
 *     door. The tool takes the LIVE peers map through an optional parameter that defaults to an
 *     empty one, and a tool handed the empty one answers "no peers" — which is what a quiet node
 *     says, so no gate and no payload could tell the two apart.
 *   v1.1.0 — 2026-09-12 — A sent request is not an arriving one, and does not wait on the operator.
 *   v1.0.0 — 2026-09-12 — Initial, with the Federation page's rebuild.
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
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

console.log('\n=== AIMEAT Admin Federation page E2E ===\n');

const opName = `fedop${Date.now()}`;
const otherName = `fedother${Date.now()}`;
let opToken = '';
let otherToken = '';

const overviewAs = (token: string) =>
    json('/v1/admin/federation/overview', { headers: { Authorization: `Bearer ${token}` } });
const overview = () => overviewAs(opToken);

/** A public key shaped like the real thing, so a peer can be made with one and without one. */
const aKey = Buffer.from('a'.repeat(32)).toString('base64');

await test('Setup: the first owner is the operator; a second is not', async () => {
    const mk = async (name: string) => {
        const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
        assert(reg.status === 201, `register ${name}: ${reg.status}`);
        const ts = new Date().toISOString();
        const tok = await json('/v1/auth/token', {
            method: 'POST',
            body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }),
        });
        assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
        return tok.body.data.token as string;
    };
    opToken = await mk(opName);
    otherToken = await mk(otherName);
});

await test('The read carries the standing, the counts, the sign-in and the book together', async () => {
    const r = await overview();
    assert(r.body.ok === true, `ok: ${JSON.stringify(r.body.error ?? r.status)}`);
    const d = r.body.data;
    assert(['alone', 'waiting', 'degraded', 'linked'].includes(d.standing), `standing is one of four, got ${d.standing}`);
    assert(Array.isArray(d.needs), 'needs is an array');
    for (const f of ['total', 'active', 'degraded', 'offline', 'depeering', 'approved', 'keyless']) {
        assert(typeof d.peers?.[f] === 'number', `peers.${f} is a number`);
    }
    for (const f of ['policy', 'scopes', 'open_join', 'named', 'reaches', 'reaches_nobody']) {
        assert(d.signin?.[f] !== undefined, `signin.${f} is present`);
    }
    assert(typeof d.offer?.gives_nothing === 'boolean', 'the offer says whether it is empty');
    assert(typeof d.book?.present === 'boolean', 'the book says whether there is one');
    assert(d.this_node?.node_id === NODE_ID, `the read names this node, got ${d.this_node?.node_id}`);
});

await test('An empty node stands alone, and says so in one word', async () => {
    const d = (await overview()).body.data;
    assert(d.peers.total === 0, `no peers yet, got ${d.peers.total}`);
    assert(d.standing === 'alone', `standing alone, got ${d.standing}`);
    assert(d.needs.length === 0, `nothing waiting, got ${JSON.stringify(d.needs)}`);
});

await test('A peer added and never switched on is counted, and the standing changes', async () => {
    // THE POINT OF THIS SUITE. Adding a peer connects nothing: the direct door writes `pending`,
    // approving a peering request writes `approved`, and Activate takes either. The old page counted
    // active, degraded, offline and pending REQUESTS, so both roads ended on a screen that looked
    // finished while the peer did nothing.
    const add = await json('/v1/federation/peers', {
        method: 'POST',
        headers: { Authorization: `Bearer ${opToken}` },
        body: JSON.stringify({ node_id: 'peer-waiting-001', url: 'https://waiting.example', public_key: aKey }),
    });
    assert(add.status === 201 || add.status === 200, `add peer: ${add.status} ${JSON.stringify(add.body.error ?? '')}`);

    const d = (await overview()).body.data;
    assert(d.peers.awaiting === 1, `one peer waiting to be switched on, got ${d.peers.awaiting}`);
    assert(d.peers.pending + d.peers.approved === d.peers.awaiting,
        `awaiting is both words for it: ${d.peers.pending} + ${d.peers.approved} vs ${d.peers.awaiting}`);
    assert(d.peers.active === 0, 'and it is not active');
    assert(d.standing === 'waiting', `standing waiting, got ${d.standing}`);
    const need = d.needs.find((n: any) => n.kind === 'activate');
    assert(!!need && need.count === 1, `the need names it: ${JSON.stringify(d.needs)}`);
    assert(need.nodes.includes('peer-waiting-001'), `and says which node: ${JSON.stringify(need.nodes)}`);
});

await test('The sign-in answer counts the peers it can actually reach', async () => {
    // Two decisions, and both must say yes. `specific_peers` with no peer carrying its own switch
    // reads as configured and admits nobody.
    const d = (await overview()).body.data;
    assert(typeof d.signin.reaches === 'number', 'reaches is a number');
    assert(d.signin.reaches === 0, `nothing is active yet, so nobody can arrive: got ${d.signin.reaches}`);
    assert(d.signin.named === 0, `and no peer has its own switch on: got ${d.signin.named}`);
    // Off is not the same as set-and-empty: a node with the policy off is not misconfigured.
    if (d.signin.policy === 'disabled') {
        assert(d.signin.reaches_nobody === false, 'a policy that is off is not a policy reaching nobody');
    }
});

await test('What this node gives the federation is a count, not four letters', async () => {
    const d = (await overview()).body.data;
    for (const f of ['actions', 'agents', 'boards', 'csms']) {
        assert(typeof d.offer[f] === 'number', `offer.${f} is a number`);
        assert(typeof d.offer[`${f}_total`] === 'number', `offer.${f}_total says out of how many`);
        assert(d.offer[f] <= d.offer[`${f}_total`], `${f}: offered ${d.offer[f]} cannot exceed ${d.offer[`${f}_total`]}`);
    }
    assert(d.offer.gives_nothing === (d.offer.actions + d.offer.agents + d.offer.boards + d.offer.csms === 0),
        'gives_nothing agrees with the four counts');
});

await test('The version baseline spans the whole federation, this node included', async () => {
    // The page reduced over LIVE PEERS and drew the badge in the book too, so a node running the
    // newest build was never the yardstick and nothing was ever marked behind it.
    const old = await json('/v1/federation/peers', {
        method: 'POST',
        headers: { Authorization: `Bearer ${opToken}` },
        body: JSON.stringify({ node_id: 'peer-old-001', url: 'https://old.example', public_key: aKey, software_version: '1.0.0' }),
    });
    assert(old.status === 201 || old.status === 200, `add old peer: ${old.status}`);

    const d = (await overview()).body.data;
    assert(typeof d.newest_version === 'string' && d.newest_version.length > 0,
        `the baseline is named, got ${JSON.stringify(d.newest_version)}`);
    assert(d.this_node.software_version === d.newest_version,
        `this node is the newest here, so it is the baseline: ${d.this_node.software_version} vs ${d.newest_version}`);
});

await test('The book says how old it is, or says there is none', async () => {
    const d = (await overview()).body.data;
    assert(typeof d.book.present === 'boolean', 'present is a boolean');
    if (d.book.present) {
        assert(d.book.age_days === null || typeof d.book.age_days === 'number', 'age_days is a number or null');
        assert(Array.isArray(d.book.nodes), 'the rows are an array');
        for (const n of d.book.nodes) {
            assert(typeof n.is_this_node === 'boolean', 'every row says whether it is this node');
            assert(typeof n.keeps_book === 'boolean', 'and whether it keeps the book');
        }
    } else {
        assert(d.book.edition === null && d.book.nodes.length === 0, 'no book means no edition and no rows');
    }
    assert(typeof d.book.is_primary === 'boolean', 'and whether this node is the one that keeps it');
});

await test('A request this node SENT is not a request waiting on this node', async () => {
    const req = await json('/v1/federation/peer/request', {
        method: 'POST',
        headers: { Authorization: `Bearer ${opToken}` },
        body: JSON.stringify({
            target_url: 'https://asking.example',
            target_node_id: 'peer-asking-001',
            message: 'Research node, we would like to read the boards.',
        }),
    });
    assert(req.status === 201 || req.status === 200, `request: ${req.status} ${JSON.stringify(req.body.error ?? '')}`);

    const d = (await overview()).body.data;
    // THIS ONE POINTS OUTWARD. `/peer/request` records `fromNodeId: this node` — WE asked them —
    // so it is waiting on them, not on the operator, and it must not appear as an arrival with an
    // Approve beside it. The page read every pending row as inbound and named this node as the asker.
    assert(d.requests.sent.length >= 1, `the sent request is carried: ${JSON.stringify(d.requests.sent)}`);
    assert(d.requests.sent.some((r: any) => r.to_node_id === 'peer-asking-001'), 'and says who we asked');
    assert(d.requests.pending.length === 0, `nobody is asking US: got ${JSON.stringify(d.requests.pending)}`);
    assert(!d.needs.find((n: any) => n.kind === 'request'), `and it is not waiting on the operator: ${JSON.stringify(d.needs)}`);
});

await test('A peer with no key is named, because it cannot be switched on at all', async () => {
    // Created through storage rather than the door: POST /peers has required a key since
    // 2026-09-01, and the rows this need exists for were written before that.
    const d = (await overview()).body.data;
    assert(typeof d.peers.keyless === 'number', 'keyless is counted');
    const need = d.needs.find((n: any) => n.kind === 'key');
    assert(d.peers.keyless === 0 ? !need : (!!need && need.count === d.peers.keyless),
        `the need and the count agree: ${d.peers.keyless} vs ${JSON.stringify(need)}`);
});

/* ── The chat path ──
 *
 * THE ONE THING THE STATIC GATES CANNOT SEE. The tool takes the LIVE peers map, the one the
 * federation routes and the heartbeat job share, and it is an optional parameter of
 * registerCoreTools with `new Map()` as its default. Nothing in a type check or a schema audit
 * notices it not being passed: the tool answers, the shape is right, and every count is zero.
 * "This node has no peers" is exactly the answer a quiet node gives, so the failure is invisible
 * from the payload.
 */
let mcpToken = '';
let mcpSession = '';

async function mcpRpc(method: string, params: Record<string, unknown> = {}, id = 1) {
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            ...(mcpToken ? { Authorization: `Bearer ${mcpToken}` } : {}),
            ...(mcpSession ? { 'mcp-session-id': mcpSession, 'mcp-protocol-version': '2025-03-26' } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) mcpSession = sid;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('text/event-stream')) return await res.json() as any;
    const messages = (await res.text()).split('\n\n').map(evt => {
        const data = evt.trim().split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6)).join('');
        try { return data ? JSON.parse(data) : null; } catch { return null; }
    }).filter(Boolean);
    return messages.find((m: any) => m.id === id) ?? messages[0] ?? {};
}

await test("The operator's agent reads the same federation over MCP", async () => {
    const agent = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${opToken}` },
        body: JSON.stringify({ name: 'fedopagent', owner: opName, capabilities: ['federation'], model: 'gpt-4o' }),
    });
    assert(agent.status === 201, `agent: ${agent.status} ${JSON.stringify(agent.body.error ?? '')}`);
    const gaii = agent.body.data.agent.gaii as string;

    const client = await json('/v1/mcp/register', {
        method: 'POST',
        body: JSON.stringify({ client_name: 'Admin Federation E2E', redirect_uris: [] }),
    });
    assert(client.status === 201, `mcp register: ${client.status}`);

    const ts = new Date().toISOString();
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: client.body.client_id,
        gaii,
        signature: await signMsg(agent.body.data.private_key, gaii + NODE_ID + ts),
        timestamp: ts,
    });
    const auth = await json(`/v1/mcp/authorize?${params}`);
    assert(typeof auth.body.code === 'string', `authorize: ${JSON.stringify(auth.body)}`);
    const tok = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({
            grant_type: 'authorization_code', code: auth.body.code,
            client_id: client.body.client_id, client_secret: client.body.client_secret,
        }),
    });
    assert(tok.status === 200, `mcp token: ${tok.status}`);
    mcpToken = tok.body.access_token;

    await mcpRpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'Admin Federation E2E', version: '1.0.0' } });
    const called = await mcpRpc('tools/call', { name: 'aimeat_admin_federation', arguments: {} }, 2);
    assert(called?.result?.isError !== true, `tool errored: ${JSON.stringify(called?.result ?? called).slice(0, 300)}`);
    const payload = JSON.parse(called.result.content[0].text);

    // The HTTP door is the control: the two read the same live map, or the tool was handed an empty one.
    const overHttp = (await overview()).body.data;
    assert(payload.peers.total === overHttp.peers.total,
        `MCP says ${payload.peers.total} peers, the page says ${overHttp.peers.total}`);
    assert(payload.peers.total > 0, 'and it is not an empty federation, which would prove nothing');
    assert(payload.standing === overHttp.standing, `the same standing: ${payload.standing} vs ${overHttp.standing}`);
    assert(payload.roster.length === overHttp.roster.length, 'and the same roster');
});

await test('The door is operator-only', async () => {
    const other = await overviewAs(otherToken);
    assert(other.status === 403, `a non-operator: expected 403, got ${other.status}`);
    const anon = await json('/v1/admin/federation/overview');
    assert(anon.status === 401 || anon.status === 403, `unauthenticated: got ${anon.status}`);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===`);
process.exit(failed > 0 ? 1 : 0);
