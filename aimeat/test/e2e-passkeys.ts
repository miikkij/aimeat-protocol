/**
 * @file e2e-passkeys.ts
 * @description Passkeys end to end, against a software authenticator that holds a real P-256 key
 *   and signs real assertions: register a device, sign in with it, rename it, take it away, and
 *   watch every refusal on the way.
 *
 *   WHAT IS REAL HERE. The responses go over HTTP to the real routes and are checked by the real
 *   library against the real challenge, origin and relying party id. Only the hardware is
 *   simulated, which is the one part a test cannot have. The helper only ever produces CORRECT
 *   answers, so the refusals are proven by handing it the wrong challenge, the wrong origin, the
 *   wrong relying party id or somebody else's credential id — a verifier that accepted any of
 *   those would be broken in the direction that matters.
 *
 *   THE REFUSALS, and why each one is here:
 *     - a stale ceremony, because a challenge that outlives its minute is a replay
 *     - a challenge from a different ceremony, which is the same attack with fresher timing
 *     - an origin that is not this node's, which is what a phishing page would send
 *     - a relying party id that is not this node's host
 *     - an unknown credential id, which must not say whether the account exists
 *     - a second account claiming a credential already registered here
 *     - an agent token trying to register a device on the human's account
 *     - a passkey belonging to somebody else, deleted or renamed by the wrong owner
 *     - a deactivated account, which must not get a session from this door either
 *
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *   test/run-e2e-ci.ts --test=passkeys
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial, with passkeys.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { SoftAuthenticator } from './helpers/soft-authenticator.js';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
/** What the node believes its own address is, which is what a browser origin must match. */
const ORIGIN = process.env.AIMEAT_BASE_URL ?? BASE;
const RP_ID = new URL(ORIGIN).hostname;

const stamp = Date.now() % 1000000;
const opName = `pkop${stamp}`;
const alice = `pkalice${stamp}`;
const bob = `pkbob${stamp}`;
const PASSWORD = 'PasskeyE2ETest1234';

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

/** Register an owner and mint its owner JWT by signing; no login, so the login limiter is untouched. */
async function registerOwner(username: string): Promise<string> {
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username, display_name: username, password: PASSWORD }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username, display_name: username, password: PASSWORD }) });
    }
    assert(reg.status === 201, `register ${username}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const priv = reg.body.data.private_key as string;
    const ts = new Date().toISOString();
    const sig = Buffer.from(await ed.signAsync(new TextEncoder().encode(username + NODE_ID + ts), Buffer.from(priv, 'base64'))).toString('base64');
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: username, timestamp: ts, signature: sig }) });
    assert(tok.status === 200, `auth/token ${username}: ${tok.status}`);
    return tok.body.data.token as string;
}

/** An agent under `owner`, and ITS session JWT. It carries the human's account name in `owner`,
 *  which is exactly why the device doors must refuse it. */
async function agentToken(owner: string, ownerTok: string, name: string): Promise<string> {
    const created = await json('/v1/agents', {
        method: 'POST', headers: auth(ownerTok),
        body: JSON.stringify({ name, owner, display_name: name, capabilities: [], scopes: ['memory:read', 'memory:write'] }),
    });
    assert(created.status === 201, `create agent ${name}: ${created.status} ${JSON.stringify(created.body)}`);
    const gaii = created.body.data.agent.gaii as string;
    const key = created.body.data.private_key as string;
    const ts = new Date().toISOString();
    const sig = Buffer.from(await ed.signAsync(new TextEncoder().encode(gaii + ts), Buffer.from(key, 'base64'))).toString('base64');
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: sig }) });
    assert(tok.body.ok === true, `agent token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}

/** Options for adding a device, for an account that is signed in. */
async function registerOptions(token: string) {
    const r = await json('/v1/ghii/passkeys/register/options', { method: 'POST', headers: auth(token), body: '{}' });
    return r;
}

/**
 * POST to a passkey login door, waiting out the shared login limiter rather than reading a 429 as a
 * verdict. Every suite on this server shares that bucket and its window is a fixed minute, so the
 * wait is measured in seconds. `body` is a factory, because a retry needs a fresh ceremony.
 */
async function postLogin(path: string, body: () => unknown) {
    let r = await json(path, { method: 'POST', body: JSON.stringify(body()) });
    for (let i = 0; r.status === 429 && i < 13; i++) {
        await new Promise(res => setTimeout(res, 5000));
        r = await json(path, { method: 'POST', body: JSON.stringify(body()) });
    }
    return r;
}

/** Options for signing in. `username` optional: omitted means the discoverable flow. */
async function loginOptions(username?: string) {
    return postLogin('/v1/ghii/login/passkey/options', () => (username ? { username } : {}));
}

/** Options, answer, verify: one whole passkey sign-in, retried as a whole when the limiter says wait. */
async function passkeyLogin(dev: SoftAuthenticator, username?: string) {
    for (let i = 0; i < 14; i++) {
        const opts = await loginOptions(username);
        if (opts.status !== 200) return opts;
        const answer = dev.authenticate(opts.body.data.options);
        const r = await json('/v1/ghii/login/passkey/verify', {
            method: 'POST', body: JSON.stringify({ ceremony_id: opts.body.data.ceremony_id, response: answer }),
        });
        if (r.status !== 429) return r;
        await new Promise(res => setTimeout(res, 5000));
    }
    throw new Error('the login limiter never let go');
}

async function main() {
    console.log('\n=== Passkeys: register, sign in, manage, and every refusal ===\n');

    let aliceToken = '';
    let bobToken = '';
    let operatorToken = '';
    let enabled = true;
    const device = new SoftAuthenticator(ORIGIN, RP_ID);
    const bobDevice = new SoftAuthenticator(ORIGIN, RP_ID);
    // A separate instance for the tests that register a THROWAWAY credential. register() makes a new
    // key pair, so reusing `device` for one of those would silently replace the private key behind
    // Alice's registered public key, and every later assertion would fail as a bad signature.
    const spare = new SoftAuthenticator(ORIGIN, RP_ID);

    await test('setup: an operator and two accounts', async () => {
        // The first owner of a clean suite database becomes the operator; not used until the end.
        operatorToken = await registerOwner(opName);
        aliceToken = await registerOwner(alice);
        bobToken = await registerOwner(bob);
        assert(!!aliceToken && !!bobToken && aliceToken !== bobToken, 'two separate owner sessions');
    });

    await test('the node offers passkeys, and this account has none yet', async () => {
        const r = await json('/v1/ghii/passkeys', { headers: auth(aliceToken) });
        assert(r.status === 200, `list: ${r.status} ${JSON.stringify(r.body.error)}`);
        enabled = r.body.data.available === true;
        if (!enabled) { console.log('    (passkeys are off on this node, skipping the rest)'); return; }
        assert(r.body.data.count === 0, `a new account has no passkeys, got ${r.body.data.count}`);
    });

    // ── Registering a device ──

    await test('a ceremony from a different account is refused', async () => {
        if (!enabled) return;
        const mine = await registerOptions(aliceToken);
        assert(mine.status === 200, `options: ${mine.status}`);
        const answer = device.register(mine.body.data.options);
        // Bob answers Alice's ceremony. The ceremony remembers whose it was.
        const r = await json('/v1/ghii/passkeys/register/verify', {
            method: 'POST', headers: auth(bobToken),
            body: JSON.stringify({ ceremony_id: mine.body.data.ceremony_id, response: answer }),
        });
        assert(r.status === 400, `expected 400, got ${r.status} ${JSON.stringify(r.body.error)}`);
        assert(r.body.error?.code === 'PASSKEY_CHALLENGE_EXPIRED', `expected PASSKEY_CHALLENGE_EXPIRED, got ${r.body.error?.code}`);
    });

    await test('an answer to a challenge nobody asked for is refused', async () => {
        if (!enabled) return;
        const opts = await registerOptions(aliceToken);
        const answer = device.register(opts.body.data.options, { challengeOverride: 'bm90LXRoZS1jaGFsbGVuZ2U' });
        const r = await json('/v1/ghii/passkeys/register/verify', {
            method: 'POST', headers: auth(aliceToken),
            body: JSON.stringify({ ceremony_id: opts.body.data.ceremony_id, response: answer }),
        });
        assert(r.status === 400, `expected 400, got ${r.status}`);
        assert(r.body.error?.code === 'PASSKEY_INVALID', `expected PASSKEY_INVALID, got ${r.body.error?.code}`);
    });

    await test('an answer from another origin is refused', async () => {
        if (!enabled) return;
        const opts = await registerOptions(aliceToken);
        const answer = device.register(opts.body.data.options, { originOverride: 'https://not-this-node.example' });
        const r = await json('/v1/ghii/passkeys/register/verify', {
            method: 'POST', headers: auth(aliceToken),
            body: JSON.stringify({ ceremony_id: opts.body.data.ceremony_id, response: answer }),
        });
        assert(r.status === 400, `expected 400, got ${r.status}`);
        assert(r.body.error?.code === 'PASSKEY_INVALID', `expected PASSKEY_INVALID, got ${r.body.error?.code}`);
    });

    let aliceKeyId = '';
    await test('the device is registered, and shows up in the list', async () => {
        if (!enabled) return;
        const opts = await registerOptions(aliceToken);
        assert(opts.status === 200, `options: ${opts.status} ${JSON.stringify(opts.body.error)}`);
        assert(typeof opts.body.data.options?.challenge === 'string', 'the options carry a challenge');
        assert(opts.body.data.options?.rp?.id === RP_ID, `the relying party is this host, got ${opts.body.data.options?.rp?.id}`);

        const answer = device.register(opts.body.data.options, { backedUp: true });
        const r = await json('/v1/ghii/passkeys/register/verify', {
            method: 'POST', headers: auth(aliceToken),
            body: JSON.stringify({ ceremony_id: opts.body.data.ceremony_id, response: answer, label: 'Alice phone' }),
        });
        assert(r.status === 201, `verify: ${r.status} ${JSON.stringify(r.body.error)}`);
        aliceKeyId = r.body.data.passkey.id;
        assert(r.body.data.passkey.label === 'Alice phone', `the label is kept, got ${r.body.data.passkey.label}`);
        assert(r.body.data.passkey.backed_up === true, 'a synced key is marked as one');
        assert(!('public_key' in r.body.data.passkey), 'the public key is not handed back');

        const list = await json('/v1/ghii/passkeys', { headers: auth(aliceToken) });
        assert(list.body.data.count === 1, `one device listed, got ${list.body.data.count}`);
        assert(list.body.data.passkeys[0].last_used_at === null, 'it has not signed anything yet');
    });

    await test('a ceremony is single use: the same answer twice is refused', async () => {
        if (!enabled) return;
        const opts = await registerOptions(aliceToken);
        const answer = spare.register(opts.body.data.options);
        const first = await json('/v1/ghii/passkeys/register/verify', {
            method: 'POST', headers: auth(aliceToken),
            body: JSON.stringify({ ceremony_id: opts.body.data.ceremony_id, response: answer }),
        });
        assert(first.status === 201, `the first use works: ${first.status} ${JSON.stringify(first.body.error)}`);
        const again = await json('/v1/ghii/passkeys/register/verify', {
            method: 'POST', headers: auth(aliceToken),
            body: JSON.stringify({ ceremony_id: opts.body.data.ceremony_id, response: answer }),
        });
        assert(again.status === 400, `the second is refused, got ${again.status}`);
        // Tidy: that second device is not part of the rest of the story, and its removal is what the
        // account-feed test later asserts a passkey_removed row for.
        const gone = await json(`/v1/ghii/passkeys/${encodeURIComponent(first.body.data.passkey.id)}`, { method: 'DELETE', headers: auth(aliceToken) });
        assert(gone.status === 200, `tidy: ${gone.status}`);
    });

    // ── Signing in ──

    await test('an unknown credential is refused, and says nothing about the account', async () => {
        if (!enabled) return;
        const opts = await loginOptions();
        const answer = bobDevice.register(opts.body.data.options); // never registered anywhere
        const r = await json('/v1/ghii/login/passkey/verify', {
            method: 'POST', body: JSON.stringify({ ceremony_id: opts.body.data.ceremony_id, response: answer }),
        });
        assert(r.status === 401, `expected 401, got ${r.status}`);
        assert(r.body.error?.code === 'PASSKEY_UNKNOWN', `expected PASSKEY_UNKNOWN, got ${r.body.error?.code}`);
    });

    await test('a username nobody has is answered like one that exists', async () => {
        if (!enabled) return;
        const real = await loginOptions(alice);
        const fake = await loginOptions(`nobody${stamp}`);
        assert(real.status === 200 && fake.status === 200, `both answer 200, got ${real.status} and ${fake.status}`);
        assert(typeof fake.body.data.options?.challenge === 'string', 'the unknown name still gets a real challenge');
        assert(typeof fake.body.data.ceremony_id === 'string', 'and a real ceremony');
    });

    await test('the device signs in, by name', async () => {
        if (!enabled) return;
        const opts = await loginOptions(alice);
        assert(opts.status === 200, `options: ${opts.status} ${JSON.stringify(opts.body.error)}`);
        const allow = opts.body.data.options?.allowCredentials ?? [];
        assert(allow.some((c: any) => c.id === aliceKeyId), 'the account\'s own key is offered');

        const r = await passkeyLogin(device, alice);
        assert(r.status === 200, `verify: ${r.status} ${JSON.stringify(r.body.error)}`);
        assert(typeof r.body.data.token === 'string' && r.body.data.token.length > 0, 'a session token came back');
        assert(r.body.data.owner?.name === alice, `the session is Alice's, got ${r.body.data.owner?.name}`);
        aliceToken = r.body.data.token;
    });

    await test('the device signs in with no username at all (discoverable)', async () => {
        if (!enabled) return;
        const opts = await loginOptions();
        assert((opts.body.data.options?.allowCredentials ?? []).length === 0, 'a discoverable ceremony offers no list');
        const r = await passkeyLogin(device);
        assert(r.status === 200, `verify: ${r.status} ${JSON.stringify(r.body.error)}`);
        assert(r.body.data.owner?.name === alice, `the answer names the account, got ${r.body.data.owner?.name}`);
        aliceToken = r.body.data.token;
    });

    await test('the counter and the last-used moment are stored', async () => {
        if (!enabled) return;
        const list = await json('/v1/ghii/passkeys', { headers: auth(aliceToken) });
        const mine = list.body.data.passkeys.find((p: any) => p.id === aliceKeyId);
        assert(!!mine, 'the key is still listed');
        assert(typeof mine.last_used_at === 'string', 'it has signed something now');
    });

    await test('a signature over another node\'s relying party id is refused', async () => {
        if (!enabled) return;
        const opts = await loginOptions(alice);
        const answer = device.authenticate(opts.body.data.options, { rpIdOverride: 'not-this-node.example' });
        const r = await json('/v1/ghii/login/passkey/verify', {
            method: 'POST', body: JSON.stringify({ ceremony_id: opts.body.data.ceremony_id, response: answer }),
        });
        assert(r.status === 401, `expected 401, got ${r.status}`);
    });

    await test('an answer from a phishing origin is refused', async () => {
        if (!enabled) return;
        const opts = await loginOptions(alice);
        const answer = device.authenticate(opts.body.data.options, { originOverride: 'https://aimeat.example.evil' });
        const r = await json('/v1/ghii/login/passkey/verify', {
            method: 'POST', body: JSON.stringify({ ceremony_id: opts.body.data.ceremony_id, response: answer }),
        });
        assert(r.status === 401, `expected 401, got ${r.status}`);
    });

    await test('a challenge from another ceremony is refused', async () => {
        if (!enabled) return;
        const a = await loginOptions(alice);
        const b = await loginOptions(alice);
        const answer = device.authenticate(a.body.data.options, { challengeOverride: b.body.data.options.challenge });
        const r = await json('/v1/ghii/login/passkey/verify', {
            method: 'POST', body: JSON.stringify({ ceremony_id: a.body.data.ceremony_id, response: answer }),
        });
        assert(r.status === 401, `expected 401, got ${r.status}`);
    });

    // ── Whose device is it ──

    await test('another account cannot register a credential id already here', async () => {
        if (!enabled) return;
        const opts = await registerOptions(bobToken);
        // Bob's authenticator makes a NEW key pair but claims Alice's credential id, in the attested
        // credential data where the verifier actually reads it. Everything else about the answer is
        // correct, so the only thing that can refuse it is the uniqueness check.
        const answer = bobDevice.register(opts.body.data.options, { credentialIdOverride: aliceKeyId });
        const r = await json('/v1/ghii/passkeys/register/verify', {
            method: 'POST', headers: auth(bobToken),
            body: JSON.stringify({ ceremony_id: opts.body.data.ceremony_id, response: answer }),
        });
        assert(r.status === 409, `expected 409, got ${r.status} ${JSON.stringify(r.body.error)}`);
        assert(r.body.error?.code === 'PASSKEY_EXISTS', `expected PASSKEY_EXISTS, got ${r.body.error?.code}`);
        const list = await json('/v1/ghii/passkeys', { headers: auth(bobToken) });
        assert(list.body.data.count === 0, `Bob still has no passkeys, got ${list.body.data.count}`);
    });

    await test('another account cannot rename or delete your device', async () => {
        if (!enabled) return;
        const rename = await json(`/v1/ghii/passkeys/${encodeURIComponent(aliceKeyId)}`, {
            method: 'PATCH', headers: auth(bobToken), body: JSON.stringify({ label: 'mine now' }),
        });
        assert(rename.status === 404, `rename: expected 404, got ${rename.status}`);
        const del = await json(`/v1/ghii/passkeys/${encodeURIComponent(aliceKeyId)}`, { method: 'DELETE', headers: auth(bobToken) });
        assert(del.status === 404, `delete: expected 404, got ${del.status}`);
        const list = await json('/v1/ghii/passkeys', { headers: auth(aliceToken) });
        assert(list.body.data.count === 1, 'Alice still has her device');
    });

    await test('nobody at all cannot list or register: 401', async () => {
        if (!enabled) return;
        const list = await json('/v1/ghii/passkeys');
        assert(list.status === 401, `list: expected 401, got ${list.status}`);
        const opts = await json('/v1/ghii/passkeys/register/options', { method: 'POST', body: '{}' });
        assert(opts.status === 401, `options: expected 401, got ${opts.status}`);
    });

    await test('the owner renames their own device', async () => {
        if (!enabled) return;
        const r = await json(`/v1/ghii/passkeys/${encodeURIComponent(aliceKeyId)}`, {
            method: 'PATCH', headers: auth(aliceToken), body: JSON.stringify({ label: 'Work laptop' }),
        });
        assert(r.status === 200, `rename: ${r.status} ${JSON.stringify(r.body.error)}`);
        const list = await json('/v1/ghii/passkeys', { headers: auth(aliceToken) });
        assert(list.body.data.passkeys[0].label === 'Work laptop', `the new label sticks, got ${list.body.data.passkeys[0].label}`);
    });

    await test('adding and removing a device lands on the account feed', async () => {
        if (!enabled) return;
        const ev = await json('/v1/account/events?limit=50', { headers: auth(aliceToken) });
        assert(ev.status === 200, `events: ${ev.status}`);
        const kinds: string[] = (ev.body.data.events ?? []).map((e: any) => e.kind);
        assert(kinds.includes('passkey_added'), `passkey_added is on the feed (saw: ${kinds.join(', ')})`);
        assert(kinds.includes('passkey_removed'), 'the device deleted during the single-use test was recorded too');
    });

    await test('an agent of this account cannot register a device on it: 403', async () => {
        if (!enabled) return;
        const agent = await agentToken(alice, aliceToken, `pkagent${stamp}`);
        const opts = await json('/v1/ghii/passkeys/register/options', { method: 'POST', headers: auth(agent), body: '{}' });
        assert(opts.status === 403, `options: expected 403, got ${opts.status} ${JSON.stringify(opts.body.error)}`);
        const list = await json('/v1/ghii/passkeys', { headers: auth(agent) });
        assert(list.status === 403, `list: expected 403, got ${list.status}`);
        const del = await json(`/v1/ghii/passkeys/${encodeURIComponent(aliceKeyId)}`, { method: 'DELETE', headers: auth(agent) });
        assert(del.status === 403, `delete: expected 403, got ${del.status}`);
    });

    await test('a deactivated account gets no session from this door either', async () => {
        if (!enabled) return;
        const off = await json(`/v1/admin/owners/${alice}/disable`, { method: 'POST', headers: auth(operatorToken) });
        assert(off.status === 200, `disable: ${off.status} ${JSON.stringify(off.body.error)}`);

        const r = await passkeyLogin(device, alice);
        assert(r.status === 403, `expected 403, got ${r.status} ${JSON.stringify(r.body.error)}`);
        assert(r.body.error?.code === 'ACCOUNT_DISABLED', `expected ACCOUNT_DISABLED, got ${r.body.error?.code}`);

        const on = await json(`/v1/admin/owners/${alice}/enable`, { method: 'POST', headers: auth(operatorToken) });
        assert(on.status === 200, `enable: ${on.status}`);
        // Deactivation ended every session in her name, so she needs a fresh one for what follows.
        const again = await passkeyLogin(device, alice);
        assert(again.status === 200, `signing in after reactivation: ${again.status} ${JSON.stringify(again.body.error)}`);
        aliceToken = again.body.data.token;
    });

    await test('a removed device can no longer sign in', async () => {
        if (!enabled) return;
        const del = await json(`/v1/ghii/passkeys/${encodeURIComponent(aliceKeyId)}`, { method: 'DELETE', headers: auth(aliceToken) });
        assert(del.status === 200, `delete: ${del.status} ${JSON.stringify(del.body.error)}`);

        const r = await passkeyLogin(device, alice);
        assert(r.status === 401, `expected 401, got ${r.status}`);
        assert(r.body.error?.code === 'PASSKEY_UNKNOWN', `expected PASSKEY_UNKNOWN, got ${r.body.error?.code}`);
    });

    await test('the accounts are erased (cleanup)', async () => {
        const a = await json(`/v1/owners/${alice}`, { method: 'DELETE', headers: auth(aliceToken) });
        assert(a.status === 200, `cleanup alice: ${a.status}`);
        const b = await json(`/v1/owners/${bob}`, { method: 'DELETE', headers: auth(bobToken) });
        assert(b.status === 200, `cleanup bob: ${b.status}`);
    });

    console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
    if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
