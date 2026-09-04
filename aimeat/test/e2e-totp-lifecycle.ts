/**
 * @file e2e-totp-lifecycle.ts
 * @description Two-step sign-in from end to end, with codes computed from the secret the server
 *   handed out: arm it, sign in with a code, sign in with a backup code, replace the codes, turn it
 *   off, and sign in normally again.
 *
 *   Why a suite of its own. The TOTP routes shipped in July 2026 and the only coverage was
 *   e2e-phase0.ts, which asks for a setup and then submits '000000' — it proves the refusal and
 *   never once proves a valid code works, so nothing in the repo had ever completed the flow. The
 *   round trip that actually matters, LOGIN with a second factor, was untested on every path: no
 *   caller could send a code, so no test had reason to.
 *
 *   The failure modes are here beside the happy path because each one is a door a person walks into:
 *   a login with no code at all, a wrong code, a backup code used twice, and a backup code that a
 *   regenerate has retired.
 *
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *   test/run-e2e-ci.ts --test=totp-lifecycle
 * @version-history
 *   v1.1.0 — 2026-09-04 — The operator's reset (DELETE /v1/admin/owners/:name/totp) and its four
 *     refusals, plus the account-event row that tells the person it happened. That door is the one
 *     removal that asks for no code, so who may open it is most of what is asserted here.
 *   v1.0.0 — 2026-09-04 — Initial, with the SPA's two-step sign-in.
 */
import { TOTP, Secret } from 'otpauth';
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const stamp = Date.now() % 1000000;
// The operator is registered FIRST, because the first owner of a clean suite database becomes one.
const operatorName = `totpop${stamp}`;
const bystanderName = `totpby${stamp}`;
const owner = `totplife${stamp}`;
const PASSWORD = 'TotpLifecycleTest1234';

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
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** The code an authenticator app would be showing right now for this secret. */
function codeNow(secret: string, offsetPeriods = 0): string {
    const totp = new TOTP({ secret: Secret.fromBase32(secret), algorithm: 'SHA1', digits: 6, period: 30 });
    return totp.generate({ timestamp: Date.now() + offsetPeriods * 30_000 });
}

/**
 * Sign in with the password, plus whatever second factor the caller wants to try.
 *
 * This suite signs in a dozen times and the login door allows 15 a minute per IP, shared with every
 * other suite on the same server, so a 429 here is the shared limiter and not a verdict on the
 * credentials. Wait it out rather than reading it as a failure. The limiter's window is a fixed
 * minute, so the wait has to be measured in seconds, not milliseconds.
 *
 * The second factor arrives as a FUNCTION so a retry recomputes it: a code held across a five-second
 * wait would have aged out of the window, and the retry would then be testing staleness instead of
 * whatever the caller meant to test.
 */
async function login(second: () => Record<string, string> = () => ({})) {
    const attempt = () => json('/v1/ghii/login', {
        method: 'POST', body: JSON.stringify({ username: owner, password: PASSWORD, ...second() }),
    });
    let r = await attempt();
    for (let i = 0; r.status === 429 && i < 13; i++) {
        await new Promise(res => setTimeout(res, 5000));
        r = await attempt();
    }
    return r;
}

/** Register an owner and mint its owner JWT by signing. No login, so the login limiter is untouched. */
async function registerOwner(username: string): Promise<string> {
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username, display_name: username, password: PASSWORD }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username, display_name: username, password: PASSWORD }) });
    }
    assert(reg.status === 201, `register ${username}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const privateKey = reg.body.data.private_key as string;
    const ts = new Date().toISOString();
    const sig = Buffer.from(
        await ed.signAsync(new TextEncoder().encode(username + NODE_ID + ts), Buffer.from(privateKey, 'base64')),
    ).toString('base64');
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: username, timestamp: ts, signature: sig }) });
    assert(tok.status === 200, `auth/token ${username}: ${tok.status} ${JSON.stringify(tok.body?.error)}`);
    return tok.body.data.token as string;
}

async function main() {
    console.log('\n=== Two-step sign-in: the whole lifecycle ===\n');

    let ownerToken = '';
    let secret = '';
    let backupCodes: string[] = [];
    let operatorToken = '';
    let bystanderToken = '';

    // The FIRST owner in a clean suite database becomes the operator (self-heal), so it is minted
    // before anything else. The bystander is here to prove the door refuses an ordinary account.
    await test('setup: an operator and a bystander exist', async () => {
        operatorToken = await registerOwner(operatorName);
        bystanderToken = await registerOwner(bystanderName);
        const who = await json('/v1/admin/owners', { headers: auth(operatorToken) });
        assert(who.status === 200, `the first owner is the operator: /v1/admin/owners answered ${who.status}`);
    });

    await test('an account is created and signs in with a password alone', async () => {
        let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: owner, password: PASSWORD }) });
        for (let i = 0; reg.status === 429 && i < 8; i++) {
            await new Promise(r => setTimeout(r, 1500));
            reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: owner, password: PASSWORD }) });
        }
        assert(reg.status === 201, `register: ${reg.status} ${JSON.stringify(reg.body)}`);

        const first = await login();
        assert(first.status === 200, `password-only login: ${first.status} ${JSON.stringify(first.body.error)}`);
        ownerToken = first.body.data.token as string;
        assert(!!ownerToken, 'login returned a session token');
    });

    // Nothing below can pass on a node that has TOTP switched off, and that is a legitimate
    // configuration. Skip rather than fail, the way e2e-phase0 does.
    let armed = false;

    await test('setup hands back a secret, a QR image and the backup codes', async () => {
        const r = await json('/v1/ghii/totp/setup', { method: 'POST', headers: auth(ownerToken), body: '{}' });
        if (r.status === 503) { console.log('    (two-step sign-in is off on this node, skipping the rest)'); return; }
        assert(r.status === 200, `setup: ${r.status} ${JSON.stringify(r.body.error)}`);
        secret = r.body.data.totp_secret;
        backupCodes = r.body.data.backup_codes ?? [];
        assert(typeof secret === 'string' && secret.length > 0, 'a base32 secret came back');
        assert(String(r.body.data.qr_data_url ?? '').startsWith('data:image/'), 'the QR is a data URL the browser can show');
        assert(String(r.body.data.totp_uri ?? '').startsWith('otpauth://'), 'the otpauth URI is there for a manual entry');
        assert(backupCodes.length >= 1, `backup codes came back (got ${backupCodes.length})`);
    });

    await test('the factor is NOT armed until a real code confirms it', async () => {
        if (!secret) return;
        // The secret exists but setup is unfinished, so the password alone still gets in.
        const half = await login();
        assert(half.status === 200, `an unverified setup must not gate the login yet: ${half.status}`);

        const r = await json('/v1/ghii/totp/verify', { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ code: codeNow(secret) }) });
        assert(r.status === 200, `verify with a real code: ${r.status} ${JSON.stringify(r.body.error)}`);
        assert(r.body.data.status === 'totp_enabled', `expected totp_enabled, got ${r.body.data.status}`);
        armed = true;
    });

    await test('the security overview now says the factor is on', async () => {
        if (!armed) return;
        const r = await json('/v1/security/overview', { headers: auth(ownerToken) });
        assert(r.status === 200, `overview: ${r.status}`);
        const tf = r.body.data.two_factor;
        assert(!!tf, 'the overview carries two_factor');
        assert(tf.enabled === true, 'two_factor.enabled is true');
        assert(tf.pending === false, 'nothing is left half-finished');
        assert(tf.backup_codes_left === backupCodes.length, `backup_codes_left is ${backupCodes.length}, got ${tf.backup_codes_left}`);
    });

    await test('the password alone is now refused, and says a code is needed', async () => {
        if (!armed) return;
        const r = await login();
        assert(r.status === 401, `expected 401, got ${r.status}`);
        assert(r.body.error?.code === 'TOTP_REQUIRED', `expected TOTP_REQUIRED, got ${r.body.error?.code}`);
    });

    await test('a wrong code is refused without arming a session', async () => {
        if (!armed) return;
        // A code from ten periods ago: correctly formed, well outside the window.
        const r = await login(() => ({ totp_code: codeNow(secret, -10) }));
        assert(r.status === 401, `expected 401, got ${r.status}`);
        assert(r.body.error?.code === 'INVALID_TOTP', `expected INVALID_TOTP, got ${r.body.error?.code}`);
        assert(!r.body.data?.token, 'no session came back');
    });

    await test('the code from the app signs the person in', async () => {
        if (!armed) return;
        const r = await login(() => ({ totp_code: codeNow(secret) }));
        assert(r.status === 200, `expected 200, got ${r.status} ${JSON.stringify(r.body.error)}`);
        assert(!!r.body.data.token, 'a session token came back');
        ownerToken = r.body.data.token as string;
    });

    await test('the same code cannot be replayed', async () => {
        if (!armed) return;
        // Spend a code, then offer the same one again. Whether the first call here signs in or is
        // itself a replay of the previous test's code does not matter: the second call is a reuse
        // of a code the server has seen, and that is what has to be refused.
        const code = codeNow(secret);
        await login(() => ({ totp_code: code }));
        const again = await login(() => ({ totp_code: code }));
        assert(again.status === 401, `a reused code must be refused, got ${again.status}`);
        assert(again.body.error?.code === 'TOTP_REPLAY', `expected TOTP_REPLAY, got ${again.body.error?.code}`);
    });

    await test('a backup code works once, and only once', async () => {
        if (!armed || backupCodes.length < 1) return;
        const code = backupCodes[0];
        const ok = await login(() => ({ backup_code: code }));
        assert(ok.status === 200, `first use of a backup code: ${ok.status} ${JSON.stringify(ok.body.error)}`);
        ownerToken = ok.body.data.token as string;

        const twice = await login(() => ({ backup_code: code }));
        assert(twice.status === 401, `a spent backup code must be refused, got ${twice.status}`);
    });

    await test('replacing the backup codes retires the old ones', async () => {
        if (!armed || backupCodes.length < 2) return;
        const stillUnused = backupCodes[1];
        const r = await json('/v1/ghii/totp/backup-codes', {
            method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ code: codeNow(secret, 1) }),
        });
        assert(r.status === 200, `regenerate: ${r.status} ${JSON.stringify(r.body.error)}`);
        const fresh: string[] = r.body.data.backup_codes ?? [];
        assert(fresh.length === backupCodes.length, `a full set came back (${fresh.length})`);
        assert(!fresh.includes(stillUnused), 'the new set is not the old set');

        const dead = await login(() => ({ backup_code: stillUnused }));
        assert(dead.status === 401, `an unused code from the retired set must be refused, got ${dead.status}`);
        backupCodes = fresh;
    });

    await test('turning it off needs a code, and a wrong one leaves it on', async () => {
        if (!armed) return;
        const refused = await json('/v1/ghii/totp', {
            method: 'DELETE', headers: auth(ownerToken), body: JSON.stringify({ code: codeNow(secret, -10) }),
        });
        assert(refused.status === 401, `expected 401, got ${refused.status}`);

        const still = await login();
        assert(still.body.error?.code === 'TOTP_REQUIRED', 'the factor is still armed after a refused removal');
    });

    await test('a real code turns it off, and the password alone gets in again', async () => {
        if (!armed) return;
        // Removal does not carry the login's replay guard, so the current period's code is fine
        // here even if a login already spent it.
        const r = await json('/v1/ghii/totp', {
            method: 'DELETE', headers: auth(ownerToken), body: JSON.stringify({ code: codeNow(secret) }),
        });
        assert(r.status === 200, `disable: ${r.status} ${JSON.stringify(r.body.error)}`);

        const plain = await login();
        assert(plain.status === 200, `password-only login after removal: ${plain.status} ${JSON.stringify(plain.body.error)}`);
        ownerToken = plain.body.data.token as string;

        const ov = await json('/v1/security/overview', { headers: auth(ownerToken) });
        assert(ov.body.data.two_factor.enabled === false, 'the overview says it is off');
        assert(ov.body.data.two_factor.pending === false, 'the secret is gone, not left pending');
    });

    // ── The operator's reset: what happens when the phone AND the backup codes are gone ──
    //
    // Every assertion here is about who may open this door, because it is the one removal that asks
    // for no code at all. The person is told afterwards, and that record is asserted too: a reset
    // nobody can see is the same as no second factor at all.

    await test('the factor is armed again, for the operator door', async () => {
        if (!armed) return;
        const s = await json('/v1/ghii/totp/setup', { method: 'POST', headers: auth(ownerToken), body: '{}' });
        assert(s.status === 200, `second setup: ${s.status} ${JSON.stringify(s.body.error)}`);
        secret = s.body.data.totp_secret;
        const v = await json('/v1/ghii/totp/verify', { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ code: codeNow(secret) }) });
        assert(v.status === 200, `second verify: ${v.status} ${JSON.stringify(v.body.error)}`);
    });

    await test('an ordinary account cannot reset anyone: 403', async () => {
        if (!armed) return;
        const r = await json(`/v1/admin/owners/${owner}/totp`, { method: 'DELETE', headers: auth(bystanderToken) });
        assert(r.status === 403, `expected 403, got ${r.status} ${JSON.stringify(r.body.error)}`);
    });

    await test('nobody at all cannot reset anyone: 401', async () => {
        if (!armed) return;
        const r = await json(`/v1/admin/owners/${owner}/totp`, { method: 'DELETE' });
        assert(r.status === 401, `expected 401, got ${r.status}`);
    });

    await test('the account keeps its factor after both refusals', async () => {
        if (!armed) return;
        const still = await login();
        assert(still.body.error?.code === 'TOTP_REQUIRED', `still armed, got ${still.status} ${still.body.error?.code}`);
    });

    await test('an operator cannot reset THEIR OWN factor: 400', async () => {
        if (!armed) return;
        const r = await json(`/v1/admin/owners/${operatorName}/totp`, { method: 'DELETE', headers: auth(operatorToken) });
        assert(r.status === 400, `expected 400, got ${r.status} ${JSON.stringify(r.body.error)}`);
    });

    await test('an account with no factor has nothing to reset: 400', async () => {
        if (!armed) return;
        const r = await json(`/v1/admin/owners/${bystanderName}/totp`, { method: 'DELETE', headers: auth(operatorToken) });
        assert(r.status === 400, `expected 400, got ${r.status} ${JSON.stringify(r.body.error)}`);
        assert(r.body.error?.code === 'TOTP_NOT_ENABLED', `expected TOTP_NOT_ENABLED, got ${r.body.error?.code}`);
    });

    await test('the operator removes it, and the password alone gets in', async () => {
        if (!armed) return;
        const r = await json(`/v1/admin/owners/${owner}/totp`, { method: 'DELETE', headers: auth(operatorToken) });
        assert(r.status === 200, `reset: ${r.status} ${JSON.stringify(r.body.error)}`);
        assert(r.body.data.two_factor === false, 'the answer says the factor is off');

        const plain = await login();
        assert(plain.status === 200, `password-only login after the reset: ${plain.status} ${JSON.stringify(plain.body.error)}`);
        ownerToken = plain.body.data.token as string;

        const ov = await json('/v1/security/overview', { headers: auth(ownerToken) });
        assert(ov.body.data.two_factor.enabled === false, 'the overview says it is off');
        assert(ov.body.data.two_factor.pending === false, 'the secret is gone, not left pending');
    });

    await test('the person is told, on their own feed, and it names the operator', async () => {
        if (!armed) return;
        const ev = await json('/v1/account/events?limit=50', { headers: auth(ownerToken) });
        assert(ev.status === 200, `events: ${ev.status}`);
        const rows: any[] = ev.body.data.events ?? [];
        const reset = rows.find(e => e.kind === 'two_factor_reset_by_operator');
        assert(!!reset, `the reset is on the feed (kinds seen: ${rows.map(e => e.kind).join(', ')})`);
        assert(reset.data?.operator === operatorName, `it names the operator, got ${reset.data?.operator}`);
        assert(rows.some(e => e.kind === 'two_factor_armed'), 'arming it was recorded too');
        assert(rows.some(e => e.kind === 'two_factor_removed'), 'their own removal was recorded too');
    });

    await test('the accounts are erased (cleanup)', async () => {
        const r = await json(`/v1/owners/${owner}`, { method: 'DELETE', headers: auth(ownerToken) });
        assert(r.status === 200, `cleanup target: ${r.status} ${JSON.stringify(r.body)}`);
        const b = await json(`/v1/owners/${bystanderName}`, { method: 'DELETE', headers: auth(bystanderToken) });
        assert(b.status === 200, `cleanup bystander: ${b.status}`);
    });

    console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
    if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
