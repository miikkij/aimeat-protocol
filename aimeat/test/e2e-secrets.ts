/**
 * @file e2e-secrets.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's secrets vault against a real node and a real receiver: a credential goes
 *   in, comes out of nothing, and is used by the node on the owner's behalf.
 *
 *   The happy path is three tests; everything else is a refusal or an isolation boundary:
 *     - store, list without a value, replace (setAt holds, updatedAt moves), remove
 *     - a name the header syntax could not carry is refused, and so is a value over 4 kB
 *     - a second owner cannot list, use or remove the first owner's secret, and gets the SAME 404
 *       a name nobody holds gets — a distinct "yours, not yours" would make the route a probe
 *     - an agent without secrets:manage is refused on all three doors; with it, all three work, and
 *       what it writes lands in the OWNER's vault
 *     - an agent holding '*' is STILL refused: the word is outside every wildcard on purpose
 *     - THE RESOLUTION: a living-hooks send carrying `Authorization: Bearer {{secret:TOKEN}}`
 *       arrives at the receiver with the real value, and the value appears in nothing the caller,
 *       the extension record or the extension's own memory can see
 *     - WHAT THE SANDBOX IS HANDED: a probe extension echoes back the headers IT holds, and they
 *       carry the placeholder, never the value — which is the whole security claim, stated as an
 *       assertion instead of as a comment
 *     - a name nobody stored refuses with SECRET_UNKNOWN, names it, and nothing is sent
 *     - the owner's own vault BEATS the extension's shared config for the same name, and the config
 *       still serves a name the vault does not hold
 *     - usedBy names living-hooks after a use, and never before one
 *
 *   FIRST FAIL. Against the tree before this vault existed, the first test fails: GET /v1/secrets is
 *   a 404, because the route is not mounted. The resolution tests fail differently and more
 *   interestingly — living-hooks resolved its own secrets from the extension config, so a value in
 *   the OWNER's vault reached nothing and the send refused SECRET_UNKNOWN.
 *
 *   THE RECEIVER runs on 127.0.0.1, which safeFetch refuses on a public node and admits here
 *   because the runner pins AIMEAT_ALLOW_PRIVATE_EGRESS=true (run-e2e-server.ts) — the same flag
 *   e2e-living-hooks and e2e-connections use to put a real counterparty on the machine.
 * @version-history
 *   v1.0.0 — 2026-09-06 — Initial.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=secrets

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const RECEIVER_PORT = parseInt(process.env.E2E_SECRETS_PORT ?? '40672', 10);
const RECEIVER_HOST = '127.0.0.1';
const RECEIVER = `http://${RECEIVER_HOST}:${RECEIVER_PORT}`;

const SECRET_NAME = 'VAULT_TOKEN';
const SECRET_VALUE = 'zz-vault-value-zz';
const REPLACED_VALUE = 'zz-vault-rotated-zz';
/** Only in the extension's shared config, never in anyone's vault: the fallback's own proof. */
const SHARED_NAME = 'SHARED_KEY';
const SHARED_VALUE = 'zz-operator-shared-zz';
/** In BOTH, under one name, with different values: the vault must win. */
const BOTH_NAME = 'BOTH_WAYS';
const BOTH_VAULT_VALUE = 'zz-from-the-vault-zz';
const BOTH_CONFIG_VALUE = 'zz-from-the-config-zz';

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
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

async function setupOwner(label: string) {
    const name = `sec${label}${Date.now()}`;
    const reg = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: name, display_name: 'Vault', password: 'VaultTest12345' }),
    });
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }),
    });
    assert(tok.body?.ok === true, `token: ${JSON.stringify(tok.body?.error)}`);
    return { name, ghii: `${name}@${NODE_ID}`, token: tok.body.data.token as string };
}

/** Device-auth (RFC 8628): an agent token for `owner` carrying exactly `scopes`. */
async function mintAgentToken(owner: { name: string; token: string }, agentName: string, scopes: string[]): Promise<string> {
    const da = await json('/v1/agents/device-authorize', {
        method: 'POST', body: JSON.stringify({ agent_name: agentName, owner: owner.name }),
    });
    assert(da.status === 200 && da.body?.ok, `device-authorize ${da.status}`);
    const approve = await json('/v1/agents/verify', {
        method: 'POST',
        body: JSON.stringify({ user_code: da.body.data.user_code, action: 'approve', scopes, owner_token: owner.token }),
    });
    assert(approve.status === 200 && approve.body?.ok, `approve ${approve.status} ${JSON.stringify(approve.body?.error)}`);
    const poll = await json('/v1/agents/device-token', {
        method: 'POST',
        body: JSON.stringify({ device_code: da.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    });
    assert(poll.status === 200 && typeof poll.body?.token === 'string', `device-token ${poll.status}`);
    return poll.body.token as string;
}

// ── The receiver: a real HTTP server, recording exactly what arrived ──
interface Delivery { url: string; headers: Record<string, string | string[] | undefined>; body: string }
const deliveries: Delivery[] = [];
let receiver: Server | null = null;

function startReceiver(): Promise<void> {
    return new Promise((resolve, reject) => {
        receiver = createServer((req, res) => {
            let body = '';
            req.on('data', c => { body += c; });
            req.on('end', () => {
                deliveries.push({ url: req.url ?? '/', headers: req.headers, body });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end('{"received":true}');
            });
        });
        receiver.on('error', reject);
        receiver.listen(RECEIVER_PORT, RECEIVER_HOST, () => resolve());
    });
}
const stopReceiver = (): Promise<void> =>
    new Promise(resolve => { if (!receiver) return resolve(); receiver.close(() => resolve()); });

/** Invoke a living-hooks action and hand back what the sandbox answered. */
async function hook(action: 'send' | 'read', token: string, input: unknown) {
    const r = await json(`/v1/ext/living-hooks/${action}`, {
        method: 'POST', headers: auth(token), body: JSON.stringify(input),
    });
    return { status: r.status, envelope: r.body, data: r.body?.data ?? null, error: r.body?.data?.error ?? null };
}

/** Let this owner's living-hooks call the receiver. Their own list, in their own memory. */
async function allowReceiver(token: string) {
    const r = await json('/v1/memory', {
        method: 'POST', headers: auth(token),
        body: JSON.stringify({
            key: 'living-hooks.settings',
            value: { allow_hosts: [RECEIVER_HOST] },
            // 'public' because the extension reads it with getPublic, which is the only visibility
            // that leaves a namespace. Same as e2e-living-hooks.
            visibility: 'public',
        }),
    });
    assert(r.status === 201 || r.status === 200, `allowlist ${r.status}: ${JSON.stringify(r.body?.error)}`);
}

console.log('\n=== Secrets vault E2E ===\n');

await startReceiver();

const owner = await setupOwner('a');       // first owner on a cleared database: also the operator
const stranger = await setupOwner('b');

// ── Phase 1: the vault's own three doors ──────────────────────────────────────────────────────
console.log('\n-- Store, list, replace, remove --');

await test('an empty vault lists nothing, and says so without erroring', async () => {
    // HOLE: /v1/secrets did not exist before this change; this was a 404.
    const r = await json('/v1/secrets', { headers: auth(owner.token) });
    assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(Array.isArray(r.body.data.secrets) && r.body.data.secrets.length === 0, `not empty: ${JSON.stringify(r.body.data)}`);
    assert(r.body.data.count === 0, 'count disagrees with the list');
});

let setAtFirst = '';
await test('storing one answers its name and times, and never the value', async () => {
    const r = await json(`/v1/secrets/${SECRET_NAME}`, {
        method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ value: SECRET_VALUE }),
    });
    assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(r.body.data.name === SECRET_NAME, `name: ${JSON.stringify(r.body.data)}`);
    assert(typeof r.body.data.setAt === 'string' && typeof r.body.data.updatedAt === 'string', 'missing times');
    assert(!JSON.stringify(r.body).includes(SECRET_VALUE), 'the answer carries the value back');
    setAtFirst = r.body.data.setAt;
});

await test('the list shows the name, the times and no value', async () => {
    const r = await json('/v1/secrets', { headers: auth(owner.token) });
    const one = r.body.data.secrets.find((s: any) => s.name === SECRET_NAME);
    assert(!!one, `not listed: ${JSON.stringify(r.body.data)}`);
    assert(!JSON.stringify(r.body).includes(SECRET_VALUE), 'the list carries the value');
    assert(Array.isArray(one.usedBy) && one.usedBy.length === 0, `usedBy before any use: ${JSON.stringify(one.usedBy)}`);
    assert(!('value' in one) && !('ciphertext' in one), `the row carries more than it should: ${Object.keys(one).join(', ')}`);
});

await test('a name the header syntax could not carry is refused, by rule and not by luck', async () => {
    for (const bad of ['has space', 'has.dot', 'has:colon', 'has/slash', 'x'.repeat(65), 'ä']) {
        const r = await json(`/v1/secrets/${encodeURIComponent(bad)}`, {
            method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ value: 'v' }),
        });
        assert(r.status === 400, `"${bad}" was accepted with ${r.status}`);
        assert(r.body?.error?.code === 'INVALID_SECRET_NAME', `"${bad}" refused as ${r.body?.error?.code}`);
    }
});

await test('an empty or missing value is refused, and says to use DELETE instead', async () => {
    for (const body of [{}, { value: '' }, { value: 42 }]) {
        const r = await json('/v1/secrets/EMPTY_TEST', {
            method: 'PUT', headers: auth(owner.token), body: JSON.stringify(body),
        });
        assert(r.status === 400 && r.body?.error?.code === 'INVALID_SECRET_VALUE',
            `${JSON.stringify(body)} → ${r.status} ${r.body?.error?.code}`);
    }
});

await test('4 kB is stored and one byte more is refused, measured in bytes and not characters', async () => {
    const ok = await json('/v1/secrets/SIZE_TEST', {
        method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ value: 'x'.repeat(4096) }),
    });
    assert(ok.status === 200, `4096 refused: ${ok.status} ${JSON.stringify(ok.body?.error)}`);
    const tooBig = await json('/v1/secrets/SIZE_TEST', {
        method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ value: 'x'.repeat(4097) }),
    });
    assert(tooBig.status === 400 && tooBig.body?.error?.code === 'SECRET_TOO_LARGE',
        `4097 → ${tooBig.status} ${tooBig.body?.error?.code}`);
    // Bytes, not characters: 2048 two-byte characters is 4096 bytes and fits; 2049 does not.
    const overInBytes = await json('/v1/secrets/SIZE_TEST', {
        method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ value: 'ä'.repeat(2049) }),
    });
    assert(overInBytes.status === 400 && overInBytes.body?.error?.code === 'SECRET_TOO_LARGE',
        `4098 bytes of two-byte characters → ${overInBytes.status} ${overInBytes.body?.error?.code}`);
    await json('/v1/secrets/SIZE_TEST', { method: 'DELETE', headers: auth(owner.token) });
});

await test('replacing keeps when it was first stored and moves when the value changed', async () => {
    await new Promise(r => setTimeout(r, 10));   // so the two timestamps can differ at all
    const r = await json(`/v1/secrets/${SECRET_NAME}`, {
        method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ value: REPLACED_VALUE }),
    });
    assert(r.status === 200, `replace ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(r.body.data.setAt === setAtFirst, `setAt moved: ${setAtFirst} → ${r.body.data.setAt}`);
    assert(Date.parse(r.body.data.updatedAt) > Date.parse(setAtFirst),
        `updatedAt did not move: ${r.body.data.updatedAt}`);
    const list = await json('/v1/secrets', { headers: auth(owner.token) });
    assert(list.body.data.secrets.filter((s: any) => s.name === SECRET_NAME).length === 1,
        'replacing made a second row');
});

await test('removing a name nobody holds says so plainly', async () => {
    const r = await json('/v1/secrets/NEVER_STORED', { method: 'DELETE', headers: auth(owner.token) });
    assert(r.status === 404 && r.body?.error?.code === 'SECRET_NOT_FOUND',
        `${r.status} ${r.body?.error?.code}`);
});

await test('removing one takes it out of the list, and it can be stored again after', async () => {
    await json('/v1/secrets/GOING_AWAY', {
        method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ value: 'v' }),
    });
    const del = await json('/v1/secrets/GOING_AWAY', { method: 'DELETE', headers: auth(owner.token) });
    assert(del.status === 200 && del.body.data.deleted === true, `${del.status} ${JSON.stringify(del.body)}`);
    const list = await json('/v1/secrets', { headers: auth(owner.token) });
    assert(!list.body.data.secrets.some((s: any) => s.name === 'GOING_AWAY'), 'still listed after removal');
    const again = await json('/v1/secrets/GOING_AWAY', {
        method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ value: 'v2' }),
    });
    assert(again.status === 200, `could not store the name again: ${again.status}`);
    await json('/v1/secrets/GOING_AWAY', { method: 'DELETE', headers: auth(owner.token) });
});

await test('a guest is refused before any of this', async () => {
    assert((await json('/v1/secrets')).status === 401, 'the list answered a guest');
    const put = await json(`/v1/secrets/${SECRET_NAME}`, { method: 'PUT', body: JSON.stringify({ value: 'x' }) });
    assert(put.status === 401, `a guest could write: ${put.status}`);
    const del = await json(`/v1/secrets/${SECRET_NAME}`, { method: 'DELETE' });
    assert(del.status === 401, `a guest could delete: ${del.status}`);
});

// ── Phase 2: one owner's vault is not another's ───────────────────────────────────────────────
console.log('\n-- One owner, one vault --');

await test("a second owner's list does not contain the first owner's secret", async () => {
    const r = await json('/v1/secrets', { headers: auth(stranger.token) });
    assert(r.status === 200, `${r.status}`);
    assert(!r.body.data.secrets.some((s: any) => s.name === SECRET_NAME),
        `owner B sees owner A's names: ${JSON.stringify(r.body.data.secrets)}`);
    assert(!JSON.stringify(r.body).includes(REPLACED_VALUE), "owner B's list carries owner A's value");
});

await test("a second owner deleting the first owner's secret gets the SAME 404 a name nobody holds gets", async () => {
    // 404 and not 403, on purpose: the vault is per owner, so "not yours" and "not there" are one
    // fact from outside. A distinct answer would turn this route into a way to ask whether a
    // stranger holds a secret called STRIPE_KEY, which is half of knowing what to attack.
    const theirs = await json(`/v1/secrets/${SECRET_NAME}`, { method: 'DELETE', headers: auth(stranger.token) });
    const nobodys = await json('/v1/secrets/NEVER_STORED', { method: 'DELETE', headers: auth(stranger.token) });
    assert(theirs.status === 404, `deleting another owner's secret answered ${theirs.status}`);
    assert(theirs.status === nobodys.status && theirs.body?.error?.code === nobodys.body?.error?.code,
        'the two refusals differ, so the route can be used to probe');
    // …and it really is still there.
    const still = await json('/v1/secrets', { headers: auth(owner.token) });
    assert(still.body.data.secrets.some((s: any) => s.name === SECRET_NAME), "owner B deleted owner A's secret");
});

await test("a second owner writing the same NAME writes their own, not over the first owner's", async () => {
    const put = await json(`/v1/secrets/${SECRET_NAME}`, {
        method: 'PUT', headers: auth(stranger.token), body: JSON.stringify({ value: 'zz-strangers-own-zz' }),
    });
    assert(put.status === 200, `${put.status}`);
    const a = await json('/v1/secrets', { headers: auth(owner.token) });
    const mine = a.body.data.secrets.find((s: any) => s.name === SECRET_NAME);
    assert(mine.setAt === setAtFirst, "owner A's row was overwritten by owner B");
});

// ── Phase 3: the word that opens it ───────────────────────────────────────────────────────────
console.log('\n-- secrets:manage --');

const blindAgent = await mintAgentToken(owner, 'vault-blind', ['memory:read', 'memory:write']);
const vaultAgent = await mintAgentToken(owner, 'vault-keeper', ['memory:read', 'secrets:manage']);
const wildAgent = await mintAgentToken(owner, 'vault-wild', ['*']);

await test('an agent without the word is refused on all three doors', async () => {
    const list = await json('/v1/secrets', { headers: auth(blindAgent) });
    assert(list.status === 403, `list answered ${list.status}`);
    const put = await json('/v1/secrets/AGENT_TEST', {
        method: 'PUT', headers: auth(blindAgent), body: JSON.stringify({ value: 'v' }),
    });
    assert(put.status === 403, `put answered ${put.status}`);
    const del = await json(`/v1/secrets/${SECRET_NAME}`, { method: 'DELETE', headers: auth(blindAgent) });
    assert(del.status === 403, `delete answered ${del.status}`);
});

await test("memory:write does not carry it: an agent that can write memory cannot touch the vault", async () => {
    // The reason the word is new rather than borrowed. memory:write is among the most granted words
    // on this node; if the vault sat behind it, every grant already live would have gained the
    // power to rotate the owner's credentials with nobody ever asked.
    const memWriter = await mintAgentToken(owner, 'vault-memwriter', ['memory:write', 'memory:write-as-owner']);
    const put = await json('/v1/secrets/SHOULD_NOT_LAND', {
        method: 'PUT', headers: auth(memWriter), body: JSON.stringify({ value: 'v' }),
    });
    assert(put.status === 403, `memory:write-as-owner reached the vault: ${put.status}`);
});

await test('an agent holding the wildcard is STILL refused: this word is outside every wildcard', async () => {
    const list = await json('/v1/secrets', { headers: auth(wildAgent) });
    assert(list.status === 403, `a '*' agent read the vault: ${list.status}`);
    const put = await json('/v1/secrets/WILD_TEST', {
        method: 'PUT', headers: auth(wildAgent), body: JSON.stringify({ value: 'v' }),
    });
    assert(put.status === 403, `a '*' agent wrote to the vault: ${put.status}`);
});

await test('an agent WITH the word can list, store and remove', async () => {
    const list = await json('/v1/secrets', { headers: auth(vaultAgent) });
    assert(list.status === 200, `list ${list.status}: ${JSON.stringify(list.body?.error)}`);
    const put = await json('/v1/secrets/AGENT_STORED', {
        method: 'PUT', headers: auth(vaultAgent), body: JSON.stringify({ value: 'zz-agent-put-zz' }),
    });
    assert(put.status === 200, `put ${put.status}: ${JSON.stringify(put.body?.error)}`);
    const del = await json('/v1/secrets/AGENT_STORED', { method: 'DELETE', headers: auth(vaultAgent) });
    assert(del.status === 200, `delete ${del.status}`);
});

await test("what the agent stores lands in the OWNER's vault, not under the agent", async () => {
    const put = await json('/v1/secrets/AGENT_FOR_OWNER', {
        method: 'PUT', headers: auth(vaultAgent), body: JSON.stringify({ value: 'zz-agent-for-owner-zz' }),
    });
    assert(put.status === 200, `${put.status}`);
    // The owner's OWN session sees it. Without ownerCoordinate() this row would sit under the
    // agent's GAII and be invisible to the person who owns it, which is the defect
    // resolveIdentity exists to prevent.
    const owned = await json('/v1/secrets', { headers: auth(owner.token) });
    assert(owned.body.data.secrets.some((s: any) => s.name === 'AGENT_FOR_OWNER'),
        "the agent's write is not in its owner's vault");
    // …and it is not in a stranger's.
    const theirs = await json('/v1/secrets', { headers: auth(stranger.token) });
    assert(!theirs.body.data.secrets.some((s: any) => s.name === 'AGENT_FOR_OWNER'), 'it leaked to another owner');
    await json('/v1/secrets/AGENT_FOR_OWNER', { method: 'DELETE', headers: auth(owner.token) });
});

// ── Phase 4: the resolution — the whole point of the vault ────────────────────────────────────
console.log('\n-- The node uses it; nobody reads it --');

await allowReceiver(owner.token);
await allowReceiver(stranger.token);

await test('a header naming a vault secret arrives at the receiver with the real value', async () => {
    deliveries.length = 0;
    const r = await hook('send', owner.token, {
        url: `${RECEIVER}/hook`,
        headers: { Authorization: `Bearer {{secret:${SECRET_NAME}}}` },
        body: { a: 1 },
    });
    assert(r.error === null, `refused: ${JSON.stringify(r.error)}`);
    assert(deliveries.length === 1, `${deliveries.length} arrived`);
    assert(deliveries[0].headers.authorization === `Bearer ${REPLACED_VALUE}`,
        `the header did not resolve from the vault: ${String(deliveries[0].headers.authorization)}`);
});

await test('the value appears in nothing the caller is told', async () => {
    const r = await hook('send', owner.token, {
        url: `${RECEIVER}/hook`,
        headers: { Authorization: `Bearer {{secret:${SECRET_NAME}}}` },
        body: { a: 2 },
    });
    assert(!JSON.stringify(r.envelope).includes(REPLACED_VALUE), 'the answer carries the value back');
    const list = await json('/v1/secrets', { headers: auth(owner.token) });
    assert(!JSON.stringify(list.body).includes(REPLACED_VALUE), 'the vault list carries the value');
    const ext = await json('/v1/extensions/living-hooks', { headers: auth(owner.token) });
    assert(!JSON.stringify(ext.body).includes(REPLACED_VALUE), 'the extension record carries the value');
});

await test("the extension's own memory namespace carries no trace of it either", async () => {
    // ext:living-hooks is where the script keeps its pacing record and read cache. If the sandbox
    // had ever held the value, this is the surface where it would leak by accident.
    const r = await json('/v1/memory/public/ext%3Aliving-hooks', { headers: auth(owner.token) });
    assert(!JSON.stringify(r.body).includes(REPLACED_VALUE), "the extension's own memory carries the value");
});

await test('usedBy names living-hooks after a use, having named nobody before one', async () => {
    const list = await json('/v1/secrets', { headers: auth(owner.token) });
    const one = list.body.data.secrets.find((s: any) => s.name === SECRET_NAME);
    assert(Array.isArray(one.usedBy) && one.usedBy.includes('living-hooks'),
        `usedBy: ${JSON.stringify(one?.usedBy)}`);
    // A secret nobody has used says so, which is what makes the line worth reading.
    const untouched = list.body.data.secrets.find((s: any) => s.name === 'AGENT_STORED');
    assert(untouched === undefined || untouched.usedBy.length === 0, 'an unused secret claims a user');
});

await test('a name nobody stored refuses by name, and nothing is sent', async () => {
    deliveries.length = 0;
    const r = await hook('send', owner.token, {
        url: `${RECEIVER}/hook`, headers: { Authorization: 'Bearer {{secret:NOT_STORED}}' }, body: { a: 3 },
    });
    assert(r.error?.code === 'SECRET_UNKNOWN', `code: ${JSON.stringify(r.data)}`);
    assert(r.error.message.includes('NOT_STORED'), `the refusal does not name the secret: ${r.error.message}`);
    assert(r.error.message.includes('Authorization'), 'the refusal does not name the header');
    assert(!r.error.message.includes(REPLACED_VALUE), 'the refusal leaks another secret');
    assert(deliveries.length === 0, 'the refused call reached the receiver');
});

await test("a second owner naming the same secret gets THEIR value, never the first owner's", async () => {
    deliveries.length = 0;
    const r = await hook('send', stranger.token, {
        url: `${RECEIVER}/hook`,
        headers: { Authorization: `Bearer {{secret:${SECRET_NAME}}}` },
        body: { a: 4 },
    });
    assert(r.error === null, `refused: ${JSON.stringify(r.error)}`);
    assert(deliveries.length === 1, `${deliveries.length} arrived`);
    assert(deliveries[0].headers.authorization === 'Bearer zz-strangers-own-zz',
        `owner B got: ${String(deliveries[0].headers.authorization)}`);
    assert(!String(deliveries[0].headers.authorization).includes(REPLACED_VALUE),
        "owner B was handed owner A's credential");
});

await test("a second owner naming a secret only the FIRST owner holds is refused", async () => {
    deliveries.length = 0;
    const r = await hook('send', stranger.token, {
        url: `${RECEIVER}/hook`, headers: { Authorization: `Bearer {{secret:${'AGENT_STORED'}}}` }, body: { a: 5 },
    });
    assert(r.error?.code === 'SECRET_UNKNOWN', `code: ${JSON.stringify(r.data)}`);
    assert(deliveries.length === 0, 'the refused call reached the receiver');
});

// ── Phase 5: the extension's own config is the FALLBACK, and only that ────────────────────────
console.log("\n-- The operator's shared map is second, never first --");

await test("the operator stores a shared map in the extension's settings", async () => {
    const { LIVING_HOOKS } = await import('../src/data/builtin-extensions/living-hooks.js');
    const shared = JSON.stringify({ [SHARED_NAME]: SHARED_VALUE, [BOTH_NAME]: BOTH_CONFIG_VALUE });
    const withSecret = LIVING_HOOKS.manifest.replace('default: ""', `default: '${shared}'`);
    assert(withSecret !== LIVING_HOOKS.manifest, 'the manifest no longer has the secrets default this test replaces');
    const r = await json('/v1/extensions/living-hooks', {
        method: 'PUT', headers: auth(owner.token),
        body: JSON.stringify({ manifest: withSecret, scripts: LIVING_HOOKS.scripts }),
    });
    // 403 here is almost never a code change. living-hooks is installed by `system`, and only an
    // OPERATOR may manage somebody else's extension; this suite's owner is the operator solely
    // because it registered first on an empty database. A 403 says the database was not empty —
    // usually two runners sharing test/.test-e2e.db in one worktree. Give the runner its own:
    // AIMEAT_DB_PATH=test/.test-e2e-<session>.db
    assert(r.status !== 403, `PUT 403 ${JSON.stringify(r.body?.error)} — this owner is not the operator, `
        + 'so the database this suite ran against was not empty. See the comment above.');
    assert(r.status === 200, `PUT ${r.status}: ${JSON.stringify(r.body?.error)}`);
});

await test('a name only the shared map holds still resolves, so nobody\'s setup breaks', async () => {
    deliveries.length = 0;
    const r = await hook('send', owner.token, {
        url: `${RECEIVER}/hook`, headers: { 'X-Api-Key': `{{secret:${SHARED_NAME}}}` }, body: { a: 6 },
    });
    assert(r.error === null, `refused: ${JSON.stringify(r.error)}`);
    assert(deliveries[0]?.headers['x-api-key'] === SHARED_VALUE,
        `the fallback did not resolve: ${String(deliveries[0]?.headers['x-api-key'])}`);
});

await test("the owner's own vault BEATS the shared map for the same name", async () => {
    await json(`/v1/secrets/${BOTH_NAME}`, {
        method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ value: BOTH_VAULT_VALUE }),
    });
    deliveries.length = 0;
    const r = await hook('send', owner.token, {
        url: `${RECEIVER}/hook`, headers: { 'X-Api-Key': `{{secret:${BOTH_NAME}}}` }, body: { a: 7 },
    });
    assert(r.error === null, `refused: ${JSON.stringify(r.error)}`);
    assert(deliveries[0]?.headers['x-api-key'] === BOTH_VAULT_VALUE,
        `the shared map won: ${String(deliveries[0]?.headers['x-api-key'])}`);
});

await test("and a second owner, holding no vault entry, still gets the operator's shared value", async () => {
    deliveries.length = 0;
    const r = await hook('send', stranger.token, {
        url: `${RECEIVER}/hook`, headers: { 'X-Api-Key': `{{secret:${BOTH_NAME}}}` }, body: { a: 8 },
    });
    assert(r.error === null, `refused: ${JSON.stringify(r.error)}`);
    assert(deliveries[0]?.headers['x-api-key'] === BOTH_CONFIG_VALUE,
        `owner B got: ${String(deliveries[0]?.headers['x-api-key'])}`);
});

// ── Phase 6: what the sandbox is actually handed ──────────────────────────────────────────────
console.log('\n-- What the script itself can see --');

const PROBE_MANIFEST = `extension: "1.0"
metadata:
  name: "secret-probe"
  version: "1.0.0"
  description: "Answers with the headers this script itself is holding, and calls out with them."
  author: "test"
required_apis:
  - memory
actions:
  - id: probe
    description: "Call the URL with the given headers and report what this script held."
    method: POST
    path: "/v1/ext/secret-probe/probe"
    auth: required
    script: "actions/probe.js"
limits:
  memory_mb: 16
  timeout_ms: 5000
  max_api_calls: 5
`;

const PROBE_SCRIPTS = {
  'actions/probe.js': `export default async function (ctx, input) {
    var held = JSON.parse(JSON.stringify(input.headers || {}));
    var status = 0;
    var failed = null;
    try {
      var res = await ctx.fetch(input.url, { method: 'POST', headers: input.headers, body: '{"probe":true}' });
      status = res.status;
    } catch (err) {
      failed = err && err.message ? err.message : String(err);
    }
    // What the SCRIPT was holding, read back after the call. If the node had substituted into the
    // object the script handed over, the value would be sitting right here.
    return { held: held, after: input.headers, status: status, failed: failed, config: ctx.config };
  }`,
};

await test('a probe extension installs and activates', async () => {
    const install = await json('/v1/extensions', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ manifest: PROBE_MANIFEST, scripts: PROBE_SCRIPTS }),
    });
    assert(install.status === 201, `install ${install.status}: ${JSON.stringify(install.body?.error)}`);
    const activate = await json('/v1/extensions/secret-probe/activate', { method: 'POST', headers: auth(owner.token) });
    assert(activate.status === 200, `activate ${activate.status}: ${JSON.stringify(activate.body?.error)}`);
});

await test('the script holds the PLACEHOLDER and the receiver holds the VALUE', async () => {
    deliveries.length = 0;
    const r = await json('/v1/ext/secret-probe/probe', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({
            url: `${RECEIVER}/probe`,
            headers: { Authorization: `Bearer {{secret:${SECRET_NAME}}}` },
        }),
    });
    assert(r.status === 200, `probe ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const out = r.body.data?.result ?? r.body.data;
    assert(out.failed === null, `the probe's own call failed: ${out.failed}`);
    // THE CLAIM, as an assertion: the sandbox never had the value.
    assert(out.held.Authorization === `Bearer {{secret:${SECRET_NAME}}}`,
        `the script was handed the value: ${String(out.held.Authorization)}`);
    assert(out.after.Authorization === `Bearer {{secret:${SECRET_NAME}}}`,
        `the node substituted into the object the script still holds: ${String(out.after.Authorization)}`);
    assert(!JSON.stringify(out).includes(REPLACED_VALUE), 'the value is somewhere in what the script returned');
    assert(!JSON.stringify(r.body).includes(REPLACED_VALUE), "the value is in the probe's answer");
    // …and the node did send the real thing.
    assert(deliveries.length === 1 && deliveries[0].headers.authorization === `Bearer ${REPLACED_VALUE}`,
        `the receiver got: ${String(deliveries[0]?.headers.authorization)}`);
});

await test("a script cannot read the vault by asking for its own config either", async () => {
    const r = await json('/v1/ext/secret-probe/probe', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ url: `${RECEIVER}/probe`, headers: { Accept: 'application/json' } }),
    });
    const out = r.body.data?.result ?? r.body.data;
    assert(!JSON.stringify(out.config ?? {}).includes(REPLACED_VALUE),
        'the vault reached the sandbox through ctx.config');
    assert(!JSON.stringify(out.config ?? {}).includes(SECRET_NAME),
        'the vault even NAMED itself to a foreign extension');
});

await test('a name the probe extension cannot resolve refuses it too, and sends nothing', async () => {
    deliveries.length = 0;
    const r = await json('/v1/ext/secret-probe/probe', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ url: `${RECEIVER}/probe`, headers: { Authorization: 'Bearer {{secret:NOT_STORED}}' } }),
    });
    const out = r.body.data?.result ?? r.body.data;
    assert(typeof out.failed === 'string' && out.failed.includes('SECRET_UNKNOWN'),
        `the refusal did not reach the script: ${JSON.stringify(out)}`);
    assert(out.failed.includes('NOT_STORED'), 'the refusal does not name the secret');
    assert(deliveries.length === 0, 'the refused call reached the receiver');
});

await stopReceiver();

console.log(`\n=== Secrets vault: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
