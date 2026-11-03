/**
 * @file e2e-sign-in-policy.ts
 * @description The operator's sign-in policy (services/sign-in-policy.ts), end to end on a node of its
 *   own (port 28455), because the suite changes auth.password_sign_in and auth.two_step_required on
 *   the running node and a shared server would carry the change into the next suite.
 *
 *   What it proves, in the order it runs:
 *   - Defaults: both settings read off / on, a password sign-in works as before, and the auth library
 *     tells the sign-in dialog the policy.
 *   - Who changes it: a non-operator is refused; the operator's personal access token is the person
 *     (ruling 2026-11-04) and tightens and loosens either setting; the operator in person loosens.
 *   - Two-step required needs TOTP on: requiring it while totp.enabled is false, and switching
 *     totp.enabled off while it is required, are refused with TWO_STEP_NEEDS_TOTP; one request may
 *     switch TOTP on and require it.
 *   - The lockout guard: password sign-in off is refused (OPERATOR_LOCKOUT) until an operator has a
 *     passkey, and saved after one is registered.
 *   - Off: every password sign-in (right or wrong password, local or federated), password
 *     registration, the reset request and reset, attach-email and a password change answer
 *     PASSWORD_SIGN_IN_OFF; no account is made; the passkey still signs the operator in.
 *   - Operators: the operator signs in with a password; a non-operator with the right password gets
 *     the same PASSWORD_SIGN_IN_OFF, and with a wrong one the ordinary 401, so the role is read only
 *     after the password.
 *   - Two-step required: an uncovered account signs in as before; a covered account without TOTP gets
 *     TWO_STEP_SETUP_REQUIRED and a setup token; start gives the secret; a wrong code is refused and
 *     the token survives; the right code arms TOTP, gives backup codes and a session; the token is
 *     single use; a made-up token is refused; the token is bound to its account whatever the body
 *     names; an account with TOTP armed signs in with its code as before; the refresh of a covered
 *     session with no TOTP, passkey or provider link is refused and ends it, and an armed account's
 *     refresh works. The app-grant silent bridge reads the session the same way: it mints no app
 *     grant from the covered session the refresh ends (login_required, reason two_step_setup_required),
 *     and gives the enrolled account and, with the policy off, every account their own app's grant.
 *   - Back at the defaults, the account that never enrolled signs in with its password again.
 *   The setup token's expiry is proven in test/unit/sign-in-policy.test.ts, which can move time.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=sign-in-policy
 * @version-history
 *   2026-11-04 — The operator's access token is the person and loosens the policy (Jouni, 2026-11-04;
 *     codebase analysis 2026-11-03, PAT ruling). The DENIAL case that refused it is replaced by that
 *     case; the AI refusal is proven in test/unit/pat-is-person.test.ts.
 *   2026-11-02 — The silent app bridge under the required two-step policy (secaudit2026nov02d round 13).
 *   v1.1.0 — 2026-11-02 — Two-step required and totp.enabled false are refused together (TWO_STEP_NEEDS_TOTP).
 *   v1.0.0 — 2026-11-02 — Initial (IT review: required two-step sign-in, password sign-in off).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { TOTP, Secret } from 'otpauth';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { registerOwner, ownerSignIn, tokenRoles, type RegisteredOwner } from './helpers/owner-login.js';
import { SoftAuthenticator } from './helpers/soft-authenticator.js';

const PORT = process.env.E2E_SIGN_IN_POLICY_PORT ?? '28455';
const BASE = `http://localhost:${PORT}`;
const RP_ID = 'localhost';
const stamp = Date.now() % 1000000;

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
    return { status: res.status, body, setCookie: res.headers.getSetCookie?.() ?? [] };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    json(path, { method: 'POST', headers, body: JSON.stringify(body) });

function codeNow(secret: string, offsetPeriods = 0): string {
    return new TOTP({ secret: Secret.fromBase32(secret), algorithm: 'SHA1', digits: 6, period: 30 })
        .generate({ timestamp: Date.now() + offsetPeriods * 30_000 });
}
/** A six-digit code outside the window around now. */
function wrongCode(secret: string): string {
    const near = new Set([-2, -1, 0, 1, 2].map(o => codeNow(secret, o)));
    for (let n = 0; ; n++) { const c = String(n).padStart(6, '0'); if (!near.has(c)) return c; }
}
/** The `name=value` of the refresh cookie a sign-in set (plain http keeps `aimeat_rt`). */
function refreshCookie(setCookie: string[]): string {
    for (const c of setCookie) {
        const pair = c.split(';')[0];
        if (/^(__Host-)?aimeat_rt=./.test(pair)) return pair;
    }
    return '';
}
/** The silent app bridge as the apex bridge page calls it: the refresh cookie, the app by name. */
async function silentBridge(cookie: string, app: string): Promise<Record<string, any>> {
    const r = await json(`/v1/auth/app-grant-silent?app=${encodeURIComponent(app)}`, { headers: { Cookie: cookie } });
    return r.body?.data ?? {};
}
const subOf = (token: string) => JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')).sub as string;

async function setPolicy(token: string, changes: Array<{ path: string; value: string | boolean }>) {
    return json('/v1/admin/config', { method: 'PUT', headers: auth(token), body: JSON.stringify({ changes }) });
}
async function policyNow(token: string): Promise<{ twoStep: unknown; password: unknown }> {
    const r = await json('/v1/admin/config', { headers: auth(token) });
    return { twoStep: r.body?.data?.schema?.['auth.two_step_required']?.value, password: r.body?.data?.schema?.['auth.password_sign_in']?.value };
}

async function startNode(): Promise<ChildProcess> {
    const db = await ownNodeDb(`sign-in-policy-${PORT}`);
    const env = {
        ...process.env, ...db.env,
        AIMEAT_PORT: PORT, AIMEAT_BASE_URL: BASE, AIMEAT_NODE_ID: 'aimeat-local-001-dev',
        AIMEAT_LOGIN_RATE_LIMIT_MAX: '1000', AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000', AIMEAT_LOGIN_TARPIT_ENABLED: 'false',
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000',
        AIMEAT_TOTP_ENABLED: 'true', AIMEAT_PASSKEY_ENABLED: 'true',
        // A refused credential must not fall back to the anonymous identity: production runs it off.
        AIMEAT_ANONYMOUS: 'false',
        AIMEAT_ENCRYPTION_KEY: process.env.AIMEAT_ENCRYPTION_KEY ?? '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        // The suite's subject starts at its defaults, whatever the developer's environment says.
        AIMEAT_TWO_STEP_REQUIRED: 'off', AIMEAT_PASSWORD_SIGN_IN: 'on', AIMEAT_SIGN_IN_LOCKOUT: 'off',
    };
    const child = spawn('node', [...nodeEntryArgs(), 'start', ...db.args], { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    return waitForServer(child, BASE, { label: 'the sign-in policy node' });
}

/** One whole passkey sign-in: options, the device's answer, verify. */
async function passkeySignIn(device: SoftAuthenticator, username: string) {
    const opts = await post('/v1/ghii/login/passkey/options', { username });
    assert(opts.status === 200, `passkey options: ${opts.status} ${JSON.stringify(opts.body.error)}`);
    return post('/v1/ghii/login/passkey/verify', { ceremony_id: opts.body.data.ceremony_id, response: device.authenticate(opts.body.data.options) });
}

async function main() {
    console.log('\n=== The operator\'s sign-in policy: two-step required, password sign-in off ===\n');
    const node = await startNode();
    let op!: RegisteredOwner, alice!: RegisteredOwner, bob!: RegisteredOwner;
    let opPat = '';
    let opSession = '';            // the operator's session, from a sign-in that satisfies every policy here
    let opSecret = '';
    let opBackup: string[] = [];
    let aliceCookie = '';
    const device = new SoftAuthenticator(BASE, RP_ID);
    const PW_OFF = 'PASSWORD_SIGN_IN_OFF';
    try {
        await test('setup: the first account is the operator, two ordinary accounts beside it', async () => {
            op = await registerOwner(BASE, `polop${stamp}`);
            alice = await registerOwner(BASE, `polalice${stamp}`);
            bob = await registerOwner(BASE, `polbob${stamp}`);
            assert(tokenRoles(op.token).includes('operator'), `the operator token carries the role: ${tokenRoles(op.token)}`);
            assert(!tokenRoles(alice.token).includes('operator'), 'alice is no operator');
            opSession = op.token;
        });

        // ── Defaults ──
        await test('DEFAULTS: both settings read their defaults and a password sign-in works as before', async () => {
            const p = await policyNow(op.token);
            assert(p.twoStep === 'off' && p.password === 'on', `defaults: ${JSON.stringify(p)}`);
            const r = await ownerSignIn(BASE, alice.name, alice.password);
            assert(r.status === 200 && typeof r.body?.data?.token === 'string', `password sign-in: ${r.status} ${JSON.stringify(r.body?.error)}`);
        });

        await test('DEFAULTS: the auth library tells the sign-in dialog the policy', async () => {
            const res = await fetch(`${BASE}/v1/libs/aimeat-auth.js`);
            const src = await res.text();
            assert(src.includes('"passwordSignIn":"on"') && src.includes('"twoStepRequired":"off"'), 'the prelude names both values');
        });

        // ── Who changes it ──
        await test('DENIAL: an account without the operator role changes neither setting', async () => {
            const r = await setPolicy(alice.token, [{ path: 'auth.two_step_required', value: 'everyone' }]);
            assert(r.status === 403, `alice: ${r.status} ${JSON.stringify(r.body?.error)}`);
            assert((await policyNow(op.token)).twoStep === 'off', 'nothing moved');
        });

        await test('the operator\'s access token tightens both settings', async () => {
            const pat = await post('/v1/access/tokens', { label: `policy ${stamp}`, grant_operator: true }, auth(op.token));
            assert(pat.status === 201 && typeof pat.body?.data?.token === 'string', `mint: ${pat.status} ${JSON.stringify(pat.body?.error)}`);
            opPat = pat.body.data.token;
            const r = await setPolicy(opPat, [{ path: 'auth.two_step_required', value: 'operators' }, { path: 'auth.password_sign_in', value: 'operators' }]);
            assert(r.status === 200, `tighten: ${r.status} ${JSON.stringify(r.body?.error)}`);
            const p = await policyNow(op.token);
            assert(p.twoStep === 'operators' && p.password === 'operators', `tightened: ${JSON.stringify(p)}`);
        });

        // Until 2026-11-04 the token was refused a loosening (PERSON_REQUIRED). An owner-level personal
        // access token is the person since then (Jouni, 2026-11-04; codebase analysis 2026-11-03, PAT
        // ruling); the refusal an AI credential gets is proven in test/unit/pat-is-person.test.ts and in
        // e2e-classification with the operator's agent.
        await test('the operator\'s access token is the person: it loosens both settings, and tightens them back', async () => {
            const r = await setPolicy(opPat, [{ path: 'auth.two_step_required', value: 'off' }, { path: 'auth.password_sign_in', value: 'on' }]);
            assert(r.status === 200, `loosen: ${r.status} ${JSON.stringify(r.body?.error)}`);
            const loose = await policyNow(op.token);
            assert(loose.twoStep === 'off' && loose.password === 'on', `loosened: ${JSON.stringify(loose)}`);
            const back = await setPolicy(opPat, [{ path: 'auth.two_step_required', value: 'operators' }, { path: 'auth.password_sign_in', value: 'operators' }]);
            assert(back.status === 200, `tighten back: ${back.status} ${JSON.stringify(back.body?.error)}`);
            const p = await policyNow(op.token);
            assert(p.twoStep === 'operators' && p.password === 'operators', `tightened back: ${JSON.stringify(p)}`);
        });

        await test('the operator in person loosens both back to the defaults', async () => {
            const r = await setPolicy(op.token, [{ path: 'auth.two_step_required', value: 'off' }, { path: 'auth.password_sign_in', value: 'on' }]);
            assert(r.status === 200, `in person: ${r.status} ${JSON.stringify(r.body?.error)}`);
            const p = await policyNow(op.token);
            assert(p.twoStep === 'off' && p.password === 'on', `back at the defaults: ${JSON.stringify(p)}`);
        });

        // ── Two-step required needs TOTP on ──
        await test('DENIAL: two-step sign-in is not required while TOTP is off, nor TOTP switched off while it is required', async () => {
            const off = await setPolicy(op.token, [{ path: 'totp.enabled', value: false }]);
            assert(off.status === 200, `TOTP off with nothing required: ${off.status} ${JSON.stringify(off.body?.error)}`);
            const req = await setPolicy(op.token, [{ path: 'auth.two_step_required', value: 'operators' }]);
            assert(req.status === 409 && req.body?.error?.code === 'TWO_STEP_NEEDS_TOTP' && /totp\.enabled/.test(req.body?.error?.message ?? ''),
                `require with TOTP off: ${req.status} ${JSON.stringify(req.body?.error)}`);
            assert((await policyNow(op.token)).twoStep === 'off', 'nothing applied');
            const both = await setPolicy(op.token, [{ path: 'totp.enabled', value: true }, { path: 'auth.two_step_required', value: 'operators' }]);
            assert(both.status === 200, `TOTP on and required in one request: ${both.status} ${JSON.stringify(both.body?.error)}`);
            const totpOff = await setPolicy(op.token, [{ path: 'totp.enabled', value: false }]);
            assert(totpOff.status === 409 && totpOff.body?.error?.code === 'TWO_STEP_NEEDS_TOTP' && /auth\.two_step_required/.test(totpOff.body?.error?.message ?? ''),
                `TOTP off while required: ${totpOff.status} ${JSON.stringify(totpOff.body?.error)}`);
            const cfg = await json('/v1/admin/config', { headers: auth(op.token) });
            assert(cfg.body?.data?.schema?.['totp.enabled']?.value === true, 'TOTP stayed on');
            const back = await setPolicy(op.token, [{ path: 'auth.two_step_required', value: 'off' }]);
            assert(back.status === 200, `back to off: ${back.status} ${JSON.stringify(back.body?.error)}`);
        });

        // ── The lockout guard ──
        await test('DENIAL: password sign-in off is refused while no operator has a passkey or a provider link', async () => {
            const r = await setPolicy(op.token, [{ path: 'auth.password_sign_in', value: 'off' }]);
            assert(r.status === 409 && r.body?.error?.code === 'OPERATOR_LOCKOUT', `off: ${r.status} ${JSON.stringify(r.body?.error)}`);
            assert(/operators/.test(r.body?.error?.message ?? '') && /passkey/.test(r.body?.error?.message ?? ''), 'the message names both ways out');
            assert((await policyNow(op.token)).password === 'on', 'still on');
        });

        await test('an operator registers a passkey, and then password sign-in off is saved', async () => {
            const opts = await post('/v1/ghii/passkeys/register/options', {}, auth(op.token));
            assert(opts.status === 200, `register options: ${opts.status} ${JSON.stringify(opts.body.error)}`);
            const reg = await post('/v1/ghii/passkeys/register/verify', { ceremony_id: opts.body.data.ceremony_id, response: device.register(opts.body.data.options), label: 'op key' }, auth(op.token));
            assert(reg.status === 201, `register verify: ${reg.status} ${JSON.stringify(reg.body.error)}`);
            const r = await setPolicy(op.token, [{ path: 'auth.password_sign_in', value: 'off' }]);
            assert(r.status === 200, `off: ${r.status} ${JSON.stringify(r.body?.error)}`);
            assert((await policyNow(op.token)).password === 'off', 'off now');
        });

        // ── Off ──
        await test('OFF: a password sign-in is refused before the password is read, right or wrong, local or federated', async () => {
            for (const [user, pw] of [[alice.name, alice.password], [alice.name, 'NotThePassword1'], [op.name, op.password], [`someone@other-node-${stamp}`, 'Whatever1234']]) {
                const r = await post('/v1/ghii/login', { username: user, password: pw });
                assert(r.status === 403 && r.body?.error?.code === PW_OFF, `${user}: ${r.status} ${JSON.stringify(r.body?.error)}`);
            }
            const msg = (await post('/v1/ghii/login', { username: alice.name, password: alice.password })).body?.error?.message ?? '';
            assert(/passkey/i.test(msg) && /link/i.test(msg), `the message names the other ways in: ${msg}`);
        });

        await test('OFF: password registration is refused and makes no account', async () => {
            const name = `polnew${stamp}`;
            const r = await post('/v1/ghii', { username: name, display_name: name, password: 'BrandNewPassword1' });
            assert(r.status === 403 && r.body?.error?.code === PW_OFF, `register: ${r.status} ${JSON.stringify(r.body?.error)}`);
            const who = await json(`/v1/ghii/${encodeURIComponent(`${name}@aimeat-local-001-dev`)}`);
            assert(who.status === 404, `no account: ${who.status}`);
        });

        await test('OFF: the reset request, the reset, attach-email and a password change are refused', async () => {
            const req = await post('/v1/ghii/password/reset-request', { username: alice.name });
            assert(req.status === 403 && req.body?.error?.code === PW_OFF, `reset-request: ${req.status} ${JSON.stringify(req.body?.error)}`);
            const reset = await post('/v1/ghii/password/reset', { username: alice.name, code: '123456', newPassword: 'AnotherPassword12' });
            assert(reset.status === 403 && reset.body?.error?.code === PW_OFF, `reset: ${reset.status} ${JSON.stringify(reset.body?.error)}`);
            const attach = await post('/v1/ghii/login/attach-email', { username: alice.name, password: alice.password, email: `a${stamp}@example.com` });
            assert(attach.status === 403 && attach.body?.error?.code === PW_OFF, `attach-email: ${attach.status} ${JSON.stringify(attach.body?.error)}`);
            const change = await post('/v1/ghii/password/change', { current_password: alice.password, new_password: 'AnotherPassword12' }, auth(alice.token));
            assert(change.status === 403 && change.body?.error?.code === PW_OFF, `change: ${change.status} ${JSON.stringify(change.body?.error)}`);
        });

        await test('OFF: the auth library tells the dialog, and the operator signs in with the passkey', async () => {
            const src = await (await fetch(`${BASE}/v1/libs/aimeat-auth.js`)).text();
            assert(src.includes('"passwordSignIn":"off"'), 'the prelude says off');
            const r = await passkeySignIn(device, op.name);
            assert(r.status === 200 && typeof r.body?.data?.token === 'string', `passkey: ${r.status} ${JSON.stringify(r.body?.error)}`);
            opSession = r.body.data.token;
        });

        // ── Operators ──
        await test('OPERATORS: the operator in person opens it to operators, and signs in with the password', async () => {
            const r = await setPolicy(opSession, [{ path: 'auth.password_sign_in', value: 'operators' }]);
            assert(r.status === 200, `operators: ${r.status} ${JSON.stringify(r.body?.error)}`);
            const s = await ownerSignIn(BASE, op.name, op.password);
            assert(s.status === 200, `operator password sign-in: ${s.status} ${JSON.stringify(s.body?.error)}`);
        });

        await test('OPERATORS: a non-operator gets PASSWORD_SIGN_IN_OFF only after a right password, so the answer tells no role', async () => {
            const right = await post('/v1/ghii/login', { username: alice.name, password: alice.password });
            assert(right.status === 403 && right.body?.error?.code === PW_OFF, `right password: ${right.status} ${JSON.stringify(right.body?.error)}`);
            // The sentence agrees with the dialog's line: the password is the operators' only, here.
            assert(/only for its operators/.test(right.body?.error?.message ?? '') && /passkey/i.test(right.body?.error?.message ?? ''),
                `the operators-only sentence: ${right.body?.error?.message}`);
            const wrong = await post('/v1/ghii/login', { username: alice.name, password: 'NotThePassword1' });
            assert(wrong.status === 401 && wrong.body?.error?.code === 'AUTH_REQUIRED', `wrong password: ${wrong.status} ${JSON.stringify(wrong.body?.error)}`);
            const reg = await post('/v1/ghii', { username: `polnew2${stamp}`, display_name: 'x', password: 'BrandNewPassword1' });
            assert(reg.status === 403 && reg.body?.error?.code === PW_OFF, `register: ${reg.status} ${JSON.stringify(reg.body?.error)}`);
        });

        await test('back to on, by the operator in person', async () => {
            const r = await setPolicy(opSession, [{ path: 'auth.password_sign_in', value: 'on' }]);
            assert(r.status === 200, `on: ${r.status} ${JSON.stringify(r.body?.error)}`);
        });

        // ── Two-step required ──
        // Alice's cookie session, made before the policy, for the refresh test below.
        await test('setup: alice holds a password-only cookie session', async () => {
            const r = await post('/v1/ghii/login', { username: alice.name, password: alice.password });
            assert(r.status === 200, `alice: ${r.status}`);
            aliceCookie = refreshCookie(r.setCookie);
            assert(!!aliceCookie, `a refresh cookie: ${JSON.stringify(r.setCookie)}`);
        });

        // The silent app bridge (GET /v1/auth/app-grant-silent) reads the same cookie session as the
        // refresh, so the policy applies there too (secaudit2026nov02d round 13).
        let aliceBridgeCookie = '';
        await test('setup: alice and the operator publish an app each; with the policy off alice\'s session signs in to hers through the silent bridge', async () => {
            for (const [who, file] of [[alice, 'polalice-app.html'], [op, 'polop-app.html']] as const) {
                const html = Buffer.from('<!DOCTYPE html><html><head></head><body>app</body></html>', 'utf8').toString('base64');
                const p = await post('/v1/apps', { filename: file, content: html, name: file, description: 'd', category: 'utility' }, auth(who.token));
                assert(p.status === 201, `publish ${file}: ${p.status} ${JSON.stringify(p.body?.error)}`);
            }
            const r = await post('/v1/ghii/login', { username: alice.name, password: alice.password });
            aliceBridgeCookie = refreshCookie(r.setCookie);
            assert(!!aliceBridgeCookie, `a second refresh cookie: ${JSON.stringify(r.setCookie)}`);
            const s = await silentBridge(aliceBridgeCookie, `${alice.name}/polalice-app.html`);
            assert(s.ok === true && typeof s.access_token === 'string', `the bridge with the policy off: ${JSON.stringify(s)}`);
        });

        let opSetupToken = '';
        await test('TWO-STEP operators: an uncovered account signs in as before; the operator without TOTP gets a setup token, no session', async () => {
            const set = await setPolicy(opSession, [{ path: 'auth.two_step_required', value: 'operators' }]);
            assert(set.status === 200, `operators: ${set.status} ${JSON.stringify(set.body?.error)}`);
            const a = await ownerSignIn(BASE, alice.name, alice.password);
            assert(a.status === 200, `alice is not covered: ${a.status} ${JSON.stringify(a.body?.error)}`);
            const r = await post('/v1/ghii/login', { username: op.name, password: op.password });
            assert(r.status === 403 && r.body?.error?.code === 'TWO_STEP_SETUP_REQUIRED', `operator: ${r.status} ${JSON.stringify(r.body?.error)}`);
            opSetupToken = r.body?.error?.details?.setup_token;
            assert(typeof opSetupToken === 'string' && opSetupToken.length === 43, `a setup token: ${JSON.stringify(r.body?.error?.details)}`);
            assert(!r.body?.data?.token && !refreshCookie(r.setCookie), 'no session and no refresh cookie');
        });

        await test('TWO-STEP: start gives the secret and the QR; a wrong code is refused and the token survives', async () => {
            const s = await post('/v1/ghii/login/two-step/start', { setup_token: opSetupToken });
            assert(s.status === 200, `start: ${s.status} ${JSON.stringify(s.body?.error)}`);
            opSecret = s.body.data.secret;
            assert(/^[A-Z2-7]+=*$/.test(opSecret) && String(s.body.data.otpauth_url).startsWith('otpauth://') && String(s.body.data.qr_data_url).startsWith('data:image/png'), 'secret, otpauth address and QR');
            const bad = await post('/v1/ghii/login/two-step/finish', { setup_token: opSetupToken, code: wrongCode(opSecret) });
            assert(bad.status === 401 && bad.body?.error?.code === 'INVALID_TOTP', `wrong code: ${bad.status} ${JSON.stringify(bad.body?.error)}`);
        });

        await test('TWO-STEP: the right code arms TOTP, gives the backup codes once and a session', async () => {
            const r = await post('/v1/ghii/login/two-step/finish', { setup_token: opSetupToken, code: codeNow(opSecret) });
            assert(r.status === 200, `finish: ${r.status} ${JSON.stringify(r.body?.error)}`);
            assert(Array.isArray(r.body.data.backup_codes) && r.body.data.backup_codes.length >= 1, `backup codes: ${JSON.stringify(r.body.data.backup_codes)}`);
            opBackup = [...r.body.data.backup_codes];
            assert(typeof r.body.data.token === 'string' && tokenRoles(r.body.data.token).includes('operator'), 'an operator session');
            assert(!!refreshCookie(r.setCookie), 'the refresh cookie is set');
            opSession = r.body.data.token;
            const me = await json('/v1/ghii/me', { headers: auth(opSession) });
            assert(me.status === 200, `me: ${me.status}`);
        });

        await test('DENIAL: the setup token is single use, and a made-up token is refused', async () => {
            const again = await post('/v1/ghii/login/two-step/finish', { setup_token: opSetupToken, code: codeNow(opSecret, 1) });
            assert(again.status === 401 && again.body?.error?.code === 'SETUP_TOKEN_EXPIRED', `reuse: ${again.status} ${JSON.stringify(again.body?.error)}`);
            const fake = await post('/v1/ghii/login/two-step/start', { setup_token: 'A'.repeat(43) });
            assert(fake.status === 401 && fake.body?.error?.code === 'SETUP_TOKEN_EXPIRED', `fake: ${fake.status} ${JSON.stringify(fake.body?.error)}`);
            const none = await post('/v1/ghii/login/two-step/start', {});
            assert(none.status === 400 && none.body?.error?.code === 'VALIDATION_ERROR', `no token: ${none.status} ${JSON.stringify(none.body?.error)}`);
        });

        await test('an account with TOTP armed signs in with its code as before', async () => {
            const noCode = await post('/v1/ghii/login', { username: op.name, password: op.password });
            assert(noCode.status === 401 && noCode.body?.error?.code === 'TOTP_REQUIRED', `no code: ${noCode.status} ${JSON.stringify(noCode.body?.error)}`);
            const r = await ownerSignIn(BASE, op.name, op.password, { totp_code: codeNow(opSecret, 1) });
            assert(r.status === 200, `with the code: ${r.status} ${JSON.stringify(r.body?.error)}`);
            opSession = r.body.data.token;
        });

        await test('TWO-STEP everyone: alice gets a setup token; bob\'s token arms bob, whatever account the body names', async () => {
            const set = await setPolicy(opSession, [{ path: 'auth.two_step_required', value: 'everyone' }]);
            assert(set.status === 200, `everyone: ${set.status} ${JSON.stringify(set.body?.error)}`);
            const a = await post('/v1/ghii/login', { username: alice.name, password: alice.password });
            assert(a.status === 403 && a.body?.error?.code === 'TWO_STEP_SETUP_REQUIRED', `alice: ${a.status} ${JSON.stringify(a.body?.error)}`);
            const b = await post('/v1/ghii/login', { username: bob.name, password: bob.password });
            assert(b.status === 403 && b.body?.error?.code === 'TWO_STEP_SETUP_REQUIRED', `bob: ${b.status} ${JSON.stringify(b.body?.error)}`);
            const bobToken = b.body.error.details.setup_token;
            const s = await post('/v1/ghii/login/two-step/start', { setup_token: bobToken, username: alice.name });
            assert(s.status === 200, `start: ${s.status}`);
            const f = await post('/v1/ghii/login/two-step/finish', { setup_token: bobToken, code: codeNow(s.body.data.secret), username: alice.name });
            assert(f.status === 200 && subOf(f.body.data.token) === bob.name, `the session is bob's: ${f.status} ${f.body?.data?.token ? subOf(f.body.data.token) : JSON.stringify(f.body?.error)}`);
            // Alice is still not enrolled: her sign-in still stops at the setup.
            const again = await post('/v1/ghii/login', { username: alice.name, password: alice.password });
            assert(again.body?.error?.code === 'TWO_STEP_SETUP_REQUIRED', `alice untouched: ${JSON.stringify(again.body?.error)}`);
        });

        await test('DENIAL: the silent app bridge mints no app grant from a covered session with no TOTP, passkey or provider link', async () => {
            const s = await silentBridge(aliceBridgeCookie, `${alice.name}/polalice-app.html`);
            assert(s.ok === false && !s.access_token && !s.refresh_token, `no app grant: ${JSON.stringify(s)}`);
            assert(s.error === 'login_required' && s.reason === 'two_step_setup_required', `login_required, reason two_step_setup_required: ${JSON.stringify(s)}`);
            assert(s.app === `${alice.name}/polalice-app.html`, `the answer names the app, so the SDK opens the visible sign-in: ${JSON.stringify(s)}`);
        });

        await test('DENIAL: the refresh of a covered session with no TOTP, passkey or provider link is refused and ends it', async () => {
            const r = await json('/v1/auth/refresh', { method: 'POST', headers: { Cookie: aliceCookie, 'X-AIMEAT-Refresh': '1' } });
            assert(r.status === 403 && r.body?.error?.code === 'TWO_STEP_SETUP_REQUIRED', `refresh: ${r.status} ${JSON.stringify(r.body?.error)}`);
            const again = await json('/v1/auth/refresh', { method: 'POST', headers: { Cookie: aliceCookie, 'X-AIMEAT-Refresh': '1' } });
            assert(again.status === 401, `the session is gone: ${again.status} ${JSON.stringify(again.body?.error)}`);
        });

        await test('an enrolled account\'s session still refreshes under the policy', async () => {
            // A backup code from the enrolment: the app's codes of this half-minute were used above.
            const s = await post('/v1/ghii/login', { username: op.name, password: op.password, backup_code: opBackup.pop() });
            assert(s.status === 200, `op sign-in: ${s.status} ${JSON.stringify(s.body?.error)}`);
            const cookie = refreshCookie(s.setCookie);
            const r = await json('/v1/auth/refresh', { method: 'POST', headers: { Cookie: cookie, 'X-AIMEAT-Refresh': '1' } });
            assert(r.status === 200 && typeof r.body?.data?.token === 'string', `refresh: ${r.status} ${JSON.stringify(r.body?.error)}`);
        });

        await test('an enrolled account\'s session still signs in to its own app through the silent bridge under the policy', async () => {
            const s = await post('/v1/ghii/login', { username: op.name, password: op.password, backup_code: opBackup.pop() });
            assert(s.status === 200, `op sign-in: ${s.status} ${JSON.stringify(s.body?.error)}`);
            const b = await silentBridge(refreshCookie(s.setCookie), `${op.name}/polop-app.html`);
            assert(b.ok === true && typeof b.access_token === 'string' && b.own === true, `the bridge: ${JSON.stringify(b)}`);
        });

        // ── Back at the defaults ──
        await test('DEFAULTS again: with both settings back, the account that never enrolled signs in with its password', async () => {
            const r = await setPolicy(opSession, [{ path: 'auth.two_step_required', value: 'off' }]);
            assert(r.status === 200, `off: ${r.status} ${JSON.stringify(r.body?.error)}`);
            const a = await ownerSignIn(BASE, alice.name, alice.password);
            assert(a.status === 200 && typeof a.body?.data?.token === 'string', `alice: ${a.status} ${JSON.stringify(a.body?.error)}`);
        });

        await test('DEFAULTS again: alice\'s new session signs in to her app through the silent bridge as before', async () => {
            const r = await post('/v1/ghii/login', { username: alice.name, password: alice.password });
            assert(r.status === 200, `alice: ${r.status}`);
            const s = await silentBridge(refreshCookie(r.setCookie), `${alice.name}/polalice-app.html`);
            assert(s.ok === true && typeof s.access_token === 'string', `the bridge: ${JSON.stringify(s)}`);
        });

        // ── The sign-in lockout (auth.sign_in_lockout): off unless the operator turns it on (Jouni, 2026-11-02 08.02) ──
        const locked = await registerOwner(BASE, `pollock${stamp}`);
        const guess = (password: string) => post('/v1/ghii/login', { username: locked.name, password });
        await test('LOCKOUT off: many wrong passwords answer wrong and lock nothing, and the right one signs in', async () => {
            const cfg = await json('/v1/admin/config', { headers: auth(opSession) });
            assert(cfg.body?.data?.schema?.['auth.sign_in_lockout']?.value === 'off', `the node's value: ${cfg.body?.data?.schema?.['auth.sign_in_lockout']?.value}`);
            for (let i = 0; i < 8; i++) {
                const r = await guess(`WrongPassword${i}`);
                assert(r.status === 401 && r.body?.error?.code === 'AUTH_REQUIRED', `wrong ${i}: ${r.status} ${r.body?.error?.code}`);
            }
            const right = await ownerSignIn(BASE, locked.name, locked.password);
            assert(right.status === 200, `the right password: ${right.status} ${right.body?.error?.code}`);
        });

        await test('LOCKOUT on: an AI credential may turn it on, and wrong passwords then lock with their own answer', async () => {
            const r = await setPolicy(opPat, [{ path: 'auth.sign_in_lockout', value: 'on' }]);
            assert(r.status === 200, `on: ${r.status} ${JSON.stringify(r.body?.error)}`);
            for (let i = 0; i < 5; i++) await guess(`WrongPassword${i}`);
            const held = await ownerSignIn(BASE, locked.name, locked.password);
            assert(held.status === 429 && held.body?.error?.code === 'PASSWORD_LOCKED', `the right password while locked: ${held.status} ${held.body?.error?.code}`);
        });

        await test('DENIAL: an AI credential does not switch the lockout off (PERSON_REQUIRED)', async () => {
            const r = await setPolicy(opPat, [{ path: 'auth.sign_in_lockout', value: 'off' }]);
            assert(r.status === 403 && r.body?.error?.code === 'PERSON_REQUIRED', `off by AI: ${r.status} ${r.body?.error?.code}`);
        });

        await test('LOCKOUT off again: the operator in person switches it off, and the lock it set no longer holds', async () => {
            const r = await setPolicy(opSession, [{ path: 'auth.sign_in_lockout', value: 'off' }]);
            assert(r.status === 200, `off in person: ${r.status} ${JSON.stringify(r.body?.error)}`);
            const right = await ownerSignIn(BASE, locked.name, locked.password);
            assert(right.status === 200, `the right password: ${right.status} ${right.body?.error?.code}`);
        });
    } finally {
        node.kill('SIGTERM');
        setTimeout(() => { if (node.exitCode === null) node.kill('SIGKILL'); }, 3000).unref();
    }

    console.log('\n─────────────────────────────────────');
    console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
    if (failed > 0) { console.log('⚠️  Some tests failed!'); process.exit(1); }
    console.log('✅ All tests passed!');
}

main().catch((e) => { console.error(e); process.exit(1); });
