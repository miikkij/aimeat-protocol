/**
 * @file e2e-account-security-gate.ts
 * @description The doors that decide who can sign in as the person, probed with every principal
 *   that carries their account name: an owner session, an agent JWT, an app-grant token, a second
 *   owner and that owner's agent, and an agent the owner deliberately granted `account:security`.
 *
 *   Why a suite of its own. Until the August 2026 audit not one authenticated route under /v1/ghii
 *   carried a role gate, and every handler reads req.auth.owner — which holds the HUMAN's account
 *   name on an agent JWT, a GEAI token and an app-grant token alike. Three chains were reachable
 *   end to end: set the first password on an OAuth account and sign in as them; repoint the recovery
 *   address at a mailbox you control, confirm it, and have the reset rail mail you a code; or arm
 *   TOTP with a secret the person never sees, which they then cannot remove because removing it
 *   needs a code from that secret.
 *
 *   The gate (requireOwnerPrincipal, src/auth/account-security.ts) admits the account holder and an
 *   agent the owner gave `account:security`, so the suite holds both halves: every door refuses an
 *   agent without the word with the gate's own answer (Phase 1), and the owner's agent holding it
 *   does the account's security work on every door and the change is read back (Phase 3).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *   test/run-e2e-ci.ts --test=e2e-account-security-gate
 * @version-history
 *   2026-11-19 — POST /v1/ghii/verify/eudiw sends `state`, which the contract now requires; without it the
 *     request-body check answered 400 before the route's own answer.
 *   2026-11-15 — Audit finding M049 asked for the account:security word to be bounded; that premise is
 *     replaced by the developer's ruling of 2026-11-15: an agent the owner gave the word does the
 *     account's security work, recovery address, second factor and signed credential included. Phase 3
 *     and the end of Phase 4 drive all 21 doors as that agent to the handler's real answer; Phase 1
 *     asserts the gate's exact refusal for an agent without the word on all 21; Phase 4 refuses
 *     another owner's agent holding it.
 *   2026-11-15 — Audit L002: the owner and owner-PAT passes also fail on a 5xx other than a 503, so a
 *     crashing handler no longer reads as a gate that let the owner through.
 *   v1.2.1 — 2026-10-13 — The replaced key's /v1/auth/token answer is chosen by the node's release and
 *     security.owner_key_login: 401 AUTH_REQUIRED on 3.x with the sign-in on, 410 OWNER_KEY_LOGIN_OFF
 *     otherwise. It accepted either one before (4.0-testimuutokset.md §4 item 2).
 *   v1.2.0 — 2026-10-09 — The owner signs back in with the changed password: the password change
 *     replaces the signing key, and the old key is asserted refused (secrets audit 2026-10-09, S2).
 *   v1.1.0 — 2026-09-12 — Phase 1b: the read side, on the one door of this family that could not
 *     take a gate. GET /v1/ghii/me is how any principal learns who it acts for, so it stays open to
 *     everything carrying the person's name and splits its response instead. The four assertions
 *     are the whole ruling: the person sees everything, so do their own agents, a published app
 *     gets the identity half without the account half, and a second person's session reads their
 *     own row, which is why no scope word was ever needed across people.
 *   v1.0.0 — 2026-08-11 — Initial (August 2026 audit, H-1/H-7 step 7b).
 */
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import { TOTP, Secret } from 'otpauth';
import { authorizeParams, mcpPkce } from './helpers/mcp-oauth-pkce.js';
import { ownerSignIn, ownerToken } from './helpers/owner-login.js';
import { removedOn } from './helpers/node-release.js';
import { ownerKeySignInOn, OWNER_KEY_LOGIN_REMOVED_IN } from './helpers/owner-key-sign-in.js';
import { seedEmailVerification } from './helpers/verified-email.js';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const stamp = Date.now() % 1000000;
const ownerA = `acctsec${stamp}`;
const ownerB = `acctsecb${stamp}`;
const ghiiA = `${ownerA}@${NODE_ID}`;
const PASSWORD = 'AcctSecTest1234';
/** The password the owner's own pass through the table sets in Phase 2. */
const CHANGED = 'TakenOver9876';
const FILENAME = 'acct-sec-demo.html';
const REDIRECT = 'http://localhost:9911/callback';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

type Answer = { status: number; body: any };
async function json(path: string, opts: RequestInit = {}): Promise<Answer> {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
/** One call as `token`. */
function req(token: string, method: string, path: string, body?: unknown): Promise<Answer> {
    return json(path, { method, headers: auth(token), ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const codeNow = (secret: string) => new TOTP({ secret: Secret.fromBase32(secret), algorithm: 'SHA1', digits: 6, period: 30 }).generate();

/** Register an owner and return its owner-session JWT plus the private key. Retries the shared
 *  server's registration rate limit, the way every other suite does. */
async function registerOwner(username: string): Promise<{ token: string; privateKey: string }> {
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username, display_name: username, password: PASSWORD }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username, display_name: username, password: PASSWORD }) });
    }
    assert(reg.status === 201, `register ${username}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const privateKey = reg.body.data.private_key as string;
    const tok = await ownerSignIn(BASE, username, PASSWORD);
    assert(tok.body.ok === true, `owner token ${username}: ${JSON.stringify(tok.body.error)}`);
    return { token: tok.body.data.token as string, privateKey };
}

/** Create an agent under `owner` with the given scopes and return ITS session JWT. */
async function agentToken(name: string, scopes: string[], owner = ownerA, ownerTok = ownerAToken): Promise<string> {
    const created = await req(ownerTok, 'POST', '/v1/agents', { name, owner, display_name: name, capabilities: [], scopes });
    assert(created.status === 201, `create agent ${name}: ${created.status} ${JSON.stringify(created.body)}`);
    const gaii = created.body.data.agent.gaii as string;
    const key = created.body.data.private_key as string;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii, timestamp: ts, signature: await signMsg(key, gaii + ts) }),
    });
    assert(tok.body.ok === true, `agent token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}

let ownerAToken = '';
let ownerAKey = '';
let ownerBToken = '';
/** The node's release is at or after OWNER_KEY_LOGIN_REMOVED_IN. */
let ownerKeyRemoved = false;
/** The node still takes the owner-key sign-in: a release before the removal, with the setting on. */
let ownerKeyOn = false;
let plainAgentToken = '';
let grantedAgentToken = '';
/** An agent of the SECOND owner holding account:security: the word is that owner's consent, not this one's. */
let crossAgentToken = '';
let appToken = '';
/** An owner-level PAT. It reaches these doors ON PURPOSE — see Phase 3b. */
let ownerPatToken = '';

/** One door, described the way a person would say it. */
interface Door { what: string; method: string; path: string; body?: unknown }

/** Every door this gate closes, apart from the two destructive ones, which run last. */
const DOORS: Door[] = [
    { what: 'set the password', method: 'POST', path: '/v1/ghii/password/change', body: { current_password: PASSWORD, new_password: CHANGED } },
    { what: 'repoint the recovery address', method: 'POST', path: '/v1/ghii/email/verify', body: { email: 'attacker@example.com' } },
    { what: 'confirm the recovery address', method: 'POST', path: '/v1/ghii/email/confirm', body: { code: '000000' } },
    { what: 'arm a second factor', method: 'POST', path: '/v1/ghii/totp/setup', body: {} },
    { what: 'activate a second factor', method: 'POST', path: '/v1/ghii/totp/verify', body: { code: '000000' } },
    { what: 'remove the second factor', method: 'DELETE', path: '/v1/ghii/totp', body: { code: '000000' } },
    { what: 'replace the backup codes', method: 'POST', path: '/v1/ghii/totp/backup-codes', body: { code: '000000' } },
    { what: 'decide which web origins may read the account', method: 'PUT', path: '/v1/ghii/cors', body: { allowed_origins: null } },
    { what: 'stamp a wallet identity onto the person', method: 'POST', path: '/v1/ghii/verify/eudiw', body: { vp_token: 'x', state: 'x' } },
    { what: 'stamp a bank identity onto the person', method: 'POST', path: '/v1/ghii/verify/ftn', body: { callback_token: 'x' } },
    { what: 'export everything the account holds', method: 'GET', path: `/v1/owners/${ownerA}/export` },
    // Added 2026-09-04 by check:owner-principal, which found this door carrying requireAuth() and a
    // name comparison. It has the node MINT AND SIGN a W3C verifiable credential asserting who this
    // person is — the strongest statement a node makes about a human — and every principal carrying
    // the account name passed the comparison.
    { what: 'have a signed identity credential minted', method: 'GET', path: `/v1/ghii/${ghiiA}/credential` },
    // Added 2026-09-04, hand-found while paying down the route-scope backlog. All six are the same
    // shape and it is the one check:owner-principal cannot see: they do not REFUSE on the account
    // name, they SCOPE A QUERY by it, so there is no comparison for a scanner to read.
    //
    // The two verification OPENERS. Their POST halves are ten lines above; these mint the nonce
    // those flows are bound to, and the callback that consumes it is unauthenticated by necessity —
    // a wallet or bank-ID redirect — so it writes verificationLevel 3 and the presented attributes
    // onto the GHII the NONCE names. Fencing only the POSTs left each rail half fenced: whoever
    // FINISHED the login walked away with their own name, birthdate and national identifier hash
    // recorded as this person's, proved. Answered before the feature flag is read, so the refusal is
    // 403 on a node with the rails switched off, which is what the shared test config is.
    { what: 'open a wallet verification bound to the person', method: 'GET', path: '/v1/ghii/verify/eudiw/request' },
    { what: 'open a bank-ID verification bound to the person', method: 'GET', path: '/v1/ghii/verify/ftn/authorize' },
    // The session doors. A device list says where and when the person signs in, and the session_id
    // values in it are exactly the ids the DELETEs accept. "Every other device" joined on 2026-11-15:
    // it carries the same gate and was the one door of the family this table did not list.
    { what: 'read where the person is signed in', method: 'GET', path: '/v1/auth/sessions' },
    { what: 'sign the person out of one device', method: 'DELETE', path: '/v1/auth/sessions/no-such-session' },
    { what: 'sign the person out of every other device', method: 'DELETE', path: '/v1/auth/sessions/others' },
    { what: 'sign the person out of every device', method: 'DELETE', path: '/v1/auth/sessions' },
    // The read half of the CORS pair whose write is above. Audit H-7 closed the write and left this,
    // and this is the reconnaissance for the same attack: which web origins already hold
    // credentialed access to the account.
    { what: 'read which web origins may read the account', method: 'GET', path: '/v1/ghii/cors' },
];
/** The two destructive doors: refused in Phase 1 with the rest, passed at the end of Phase 4. */
const DESTRUCTIVE: Door[] = [
    { what: 'delete the identity record', method: 'DELETE', path: '/v1/ghii' },
    { what: 'erase the owner account', method: 'DELETE', path: `/v1/owners/${ownerA}` },
];

const call = (door: Door, token: string) => req(token, door.method, door.path, door.body);

/** The gate's own refusal: 403 ACCESS_DENIED with its default sentence, which no door here replaces,
 *  and no one-press permission address, since the owner grants the word in the agent editor. */
function expectGateRefusal(r: Answer, door: Door) {
    const where = `${door.method} ${door.path}`;
    assert(r.status === 403 && r.body.error?.code === 'ACCESS_DENIED', `${where}: expected 403 ACCESS_DENIED, got ${r.status} ${JSON.stringify(r.body.error)}`);
    assert(String(r.body.error?.message).includes('"account:security" permission'), `${where}: refused by something other than the gate: ${r.body.error?.message}`);
    assert(r.body.error?.details?.allow_url === undefined, `${where}: the gate gives no permission address: ${JSON.stringify(r.body.error?.details)}`);
}
/** A handler's own answer: the status (and code) it gives the account holder, never the gate's. */
function expectAnswer(r: Answer, status: number, what: string, code?: string) {
    assert(r.status === status && (code === undefined || r.body.error?.code === code),
        `${what}: expected ${status}${code ? ` ${code}` : ''}, got ${r.status} ${JSON.stringify(r.body.error ?? r.body.data)}`);
}
/** The person's own sign-ins, as the owner's agent reads them. */
async function personSessions(): Promise<any[]> {
    const r = await req(grantedAgentToken, 'GET', '/v1/auth/sessions');
    expectAnswer(r, 200, 'read where the person is signed in');
    return r.body.data.sessions as any[];
}
const meAsAgent = async () => (await req(grantedAgentToken, 'GET', '/v1/ghii/me')).body.data;

async function main() {
    console.log('\n=== Account security gate (H-1 / H-7) E2E ===\n');
    console.log('Phase 0: Setup');

    await test('two owners, an agent with full access, and an agent of each owner with account:security', async () => {
        const a = await registerOwner(ownerA);
        ownerAToken = a.token;
        ownerAKey = a.privateKey;
        const b = await registerOwner(ownerB);
        ownerBToken = b.token;
        // Read now: owner A is the first owner of the suite's clean database, so the operator, and
        // its session is signed out everywhere before the owner-key assertion below runs.
        ownerKeyRemoved = await removedOn(BASE, OWNER_KEY_LOGIN_REMOVED_IN);
        ownerKeyOn = await ownerKeySignInOn(BASE, ownerAToken);
        // Full access, which is what most agents hold. The point of the assertions below is that
        // '*' does not reach these doors.
        plainAgentToken = await agentToken('plainbot', ['*']);
        grantedAgentToken = await agentToken('securitybot', ['memory:read', 'account:security']);
        crossAgentToken = await agentToken('crossbot', ['memory:read', 'account:security'], ownerB, ownerBToken);
    });

    await test('an owner-level personal access token', async () => {
        const mint = await req(ownerAToken, 'POST', '/v1/access/tokens', { label: 'account-security probe', grant_owner: true });
        assert(mint.status === 200 || mint.status === 201, `mint PAT: ${mint.status} ${JSON.stringify(mint.body)}`);
        ownerPatToken = mint.body.data?.token as string;
        assert(!!ownerPatToken, `the mint returns the raw token once: ${JSON.stringify(mint.body.data)}`);
    });

    await test('an app-grant token for the same owner', async () => {
        const pub = await req(ownerAToken, 'POST', '/v1/apps', {
            filename: FILENAME, content: b64('<!DOCTYPE html><html><body>gate</body></html>'),
            name: 'Gate Demo', description: 'account security gate demo app', category: 'utility',
        });
        assert(pub.status === 201, `publish: ${pub.status} ${JSON.stringify(pub.body)}`);

        const codeVerifier = randomBytes(32).toString('base64url');
        const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
        const q = new URLSearchParams({
            app: `${ownerA}/${FILENAME}`, response_type: 'code', scope: 'memory:read',
            redirect_uri: REDIRECT, code_challenge: codeChallenge, code_challenge_method: 'S256',
        });
        const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
        const m = /req=([^&]+)/.exec(res.headers.get('location') ?? '');
        assert(!!m, `expected a consent redirect, got ${res.status} ${res.headers.get('location')}`);
        const con = await req(ownerAToken, 'POST', '/v1/app-grants/authorize-consent', { request_id: decodeURIComponent(m![1]) });
        const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
        const tok = await json('/v1/app-grants/token', {
            method: 'POST',
            body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: REDIRECT }),
        });
        assert(tok.body.ok === true, `app token: ${JSON.stringify(tok.body.error)}`);
        appToken = tok.body.data.access_token as string;
    });

    console.log('\nPhase 1: A machine principal of the same owner without account:security is refused at every door');

    for (const door of [...DOORS, ...DESTRUCTIVE]) {
        await test(`an agent on full access without account:security cannot ${door.what}`, async () => {
            expectGateRefusal(await call(door, plainAgentToken), door);
        });
        await test(`app-grant token cannot ${door.what}`, async () => {
            expectGateRefusal(await call(door, appToken), door);
        });
    }

    // The READ side of the same question, on the one door of this family that could not take a
    // gate: GET /v1/ghii/me is how any principal learns who it acts for, so every agent on the node
    // calls it and refusing them all was never on the table. It splits its response instead, and
    // these four assertions are the whole ruling.
    //
    // It runs HERE, before Phase 2, for the reason the comment at the bottom of this file records:
    // Phase 2 drives "sign the person out of every device" with the owner's own session, so from
    // there down ownerAToken is revoked until it is signed in again.
    console.log('\nPhase 1b: GET /v1/ghii/me splits, rather than closing');

    const ACCOUNT_HALF = ['notification_email', 'email_verified_at', 'has_password', 'public_key'];
    const IDENTITY_HALF = ['ghii', 'display_name', 'verification_level', 'directory_listed'];

    await test('the owner session sees the whole record', async () => {
        const r = await req(ownerAToken, 'GET', '/v1/ghii/me');
        assert(r.status === 200, `expected 200, got ${r.status} ${JSON.stringify(r.body)}`);
        for (const f of [...IDENTITY_HALF, ...ACCOUNT_HALF]) {
            assert(f in r.body.data, `owner session is missing ${f}: ${JSON.stringify(Object.keys(r.body.data))}`);
        }
    });

    await test('the owner\'s own agent sees it too, on full access alone', async () => {
        // Ruled 2026-09-12. An agent acting for someone should be able to tell them the recovery
        // address is stale or that they never set a password, and the alternative on the table —
        // requiring account:security here, the way every door in Phase 1 does — would have refused
        // every agent on the node until each owner went and ticked a box.
        const r = await req(plainAgentToken, 'GET', '/v1/ghii/me');
        assert(r.status === 200, `expected 200, got ${r.status} ${JSON.stringify(r.body)}`);
        for (const f of ACCOUNT_HALF) {
            assert(f in r.body.data, `the owner's agent is missing ${f}: ${JSON.stringify(Object.keys(r.body.data))}`);
        }
    });

    await test('a published app running in the same person\'s name gets the identity half and not the account half', async () => {
        const r = await req(appToken, 'GET', '/v1/ghii/me');
        assert(r.status === 200, `expected 200, got ${r.status} ${JSON.stringify(r.body)}`);
        for (const f of IDENTITY_HALF) {
            assert(f in r.body.data, `the app is missing ${f}, which it needs to know who it works for: ${JSON.stringify(Object.keys(r.body.data))}`);
        }
        for (const f of ACCOUNT_HALF) {
            assert(!(f in r.body.data), `the app can read ${f}, which is the input to taking the account over`);
        }
        assert(r.body.data.ghii === ghiiA, `the app should still learn whose name it acts under, got ${r.body.data.ghii}`);
    });

    await test('the door answers about the CALLER, so another person\'s session reads their own row', async () => {
        // Why no scope word was ever needed across PEOPLE: the record is looked up by the account
        // name the credential carries, so there is no target id to tamper with and this account is
        // not addressable from another person's principal at all.
        const r = await req(ownerBToken, 'GET', '/v1/ghii/me');
        assert(r.status === 200, `expected 200, got ${r.status} ${JSON.stringify(r.body)}`);
        assert(r.body.data.ghii === `${ownerB}@${NODE_ID}`, `expected ${ownerB}'s own row, got ${r.body.data.ghii}`);
    });

    console.log('\nPhase 2: The account holder still gets through');

    for (const door of DOORS) {
        await test(`the owner can reach "${door.what}"`, async () => {
            const r = await call(door, ownerAToken);
            // What each door answers depends on the account's state and the node's feature flags —
            // a 400 for a wrong TOTP code and a 503 for a disabled wallet integration are both the
            // handler running. The gate is what is under test, so the assertion is that the request
            // got past it. A 5xx is a broken handler, not a gate that opened, so it fails as well.
            assert(r.status !== 403, `${door.method} ${door.path}: owner was refused with ${JSON.stringify(r.body)}`);
            assert(r.status < 500 || r.status === 503, `${door.method} ${door.path}: the handler failed with ${r.status} ${JSON.stringify(r.body?.error)}`);
        });
    }

    // The developer's ruling of 2026-11-15: an agent the owner gave account:security does the
    // account's security work, so the system can be brought to the configuration the owner wants
    // without a person at every step. Human in the loop is the owner's choice, made per agent by
    // ticking that one word. Each test drives a door to the answer its handler gives the account
    // holder and reads the change back; the suite undoes what it sets (sessions, factor, origins),
    // and the recovery address goes with the account erased at the end.
    console.log('\nPhase 3: The owner\'s agent holding account:security does the account\'s security work');

    await test('the agent reads where the person is signed in, and signs one device out', async () => {
        ownerAToken = await ownerToken(BASE, ownerA, CHANGED);
        const list = await personSessions();
        assert(list.length > 0 && list.every(s => s.gaii === ownerA), `the person's own sign-ins, and only those: ${JSON.stringify(list)}`);
        const one = list[0].session_id as string;
        const r = await req(grantedAgentToken, 'DELETE', `/v1/auth/sessions/${one}`);
        expectAnswer(r, 200, 'sign the person out of one device');
        assert(r.body.data.revoked === true && r.body.data.session_id === one, `the answer names the device: ${JSON.stringify(r.body.data)}`);
        assert(!(await personSessions()).some(s => s.session_id === one), 'the signed-out device is still listed');
    });

    for (const [what, path] of [['every other device', '/v1/auth/sessions/others'], ['every device', '/v1/auth/sessions']]) {
        await test(`the agent signs the person out of ${what}`, async () => {
            ownerAToken = await ownerToken(BASE, ownerA, CHANGED);
            const r = await req(grantedAgentToken, 'DELETE', path);
            expectAnswer(r, 200, `sign the person out of ${what}`);
            assert(r.body.data.revoked_sessions >= 1, `the fresh sign-in is ended: ${JSON.stringify(r.body.data)}`);
            const left = await personSessions();
            assert(left.length === 0, `no sign-in of the person is left: ${JSON.stringify(left)}`);
        });
    }

    await test('the agent reaches the password change, which asks for the current password', async () => {
        const r = await req(grantedAgentToken, 'POST', '/v1/ghii/password/change', { current_password: 'NotTheCurrent123', new_password: 'AgentChose98765' });
        expectAnswer(r, 401, 'set the password with a wrong current one', 'WRONG_PASSWORD');
    });

    const recovery = `${ownerA}.recovery@example.test`;
    await test('the agent sets the recovery address, which waits unproven', async () => {
        const r = await req(grantedAgentToken, 'POST', '/v1/ghii/email/verify', { email: recovery });
        expectAnswer(r, 200, 'set the recovery address');
        assert(typeof r.body.data.verification_id === 'string', `a verification is started: ${JSON.stringify(r.body.data)}`);
        const me = await meAsAgent();
        assert(me.notification_email === recovery && me.email_verified_at === null, `read back: ${JSON.stringify(me)}`);
    });

    await test('the agent confirms the recovery address with its code', async () => {
        // The code goes out by mail, which a suite on the runner's server cannot read, so a pending
        // verification with a known code is written for the same address (helpers/verified-email.ts).
        const code = '424242';
        const id = await seedEmailVerification(ownerA, recovery, code);
        const r = await req(grantedAgentToken, 'POST', '/v1/ghii/email/confirm', { code, verification_id: id });
        expectAnswer(r, 200, 'confirm the recovery address');
        assert(r.body.data.verified === true, `the answer says verified: ${JSON.stringify(r.body.data)}`);
        const me = await meAsAgent();
        assert(me.notification_email === recovery && typeof me.email_verified_at === 'string', `read back: ${JSON.stringify(me)}`);
    });

    let totpSecret = '';
    let backupCodes: string[] = [];
    await test('the agent arms a second factor', async () => {
        const r = await req(grantedAgentToken, 'POST', '/v1/ghii/totp/setup', {});
        expectAnswer(r, 200, 'arm a second factor');
        totpSecret = r.body.data.totp_secret as string;
        assert(typeof totpSecret === 'string' && Array.isArray(r.body.data.backup_codes), `the secret and backup codes: ${JSON.stringify(Object.keys(r.body.data))}`);
    });

    await test('the agent activates it with a code from the secret', async () => {
        const r = await req(grantedAgentToken, 'POST', '/v1/ghii/totp/verify', { code: codeNow(totpSecret) });
        expectAnswer(r, 200, 'activate a second factor');
        assert(r.body.data.status === 'totp_enabled', `the answer: ${JSON.stringify(r.body.data)}`);
        // Read back: the account holds an active factor, so a second setup is refused.
        expectAnswer(await req(grantedAgentToken, 'POST', '/v1/ghii/totp/setup', {}), 409, 'set up again on an armed account', 'TOTP_ALREADY_ENABLED');
    });

    await test('the agent replaces the backup codes', async () => {
        const r = await req(grantedAgentToken, 'POST', '/v1/ghii/totp/backup-codes', { code: codeNow(totpSecret) });
        expectAnswer(r, 200, 'replace the backup codes');
        backupCodes = r.body.data.backup_codes as string[];
        assert(Array.isArray(backupCodes) && backupCodes.length > 0, `new codes: ${JSON.stringify(r.body.data)}`);
    });

    await test('the agent removes the second factor with one of the new backup codes', async () => {
        const r = await req(grantedAgentToken, 'DELETE', '/v1/ghii/totp', { backup_code: backupCodes[0] });
        expectAnswer(r, 200, 'remove the second factor');
        assert(r.body.data.status === 'totp_disabled', `the answer: ${JSON.stringify(r.body.data)}`);
        // Read back, and the cleanup: factor and secret are gone, so the owner signs in with the
        // password alone in Phase 4.
        expectAnswer(await req(grantedAgentToken, 'POST', '/v1/ghii/totp/verify', { code: '000000' }), 400, 'activate after removal', 'TOTP_NOT_SETUP');
    });

    await test('the agent decides which web origins may read the account, reads it back and restores the default', async () => {
        const origins = ['https://agent.example.test'];
        expectAnswer(await req(grantedAgentToken, 'PUT', '/v1/ghii/cors', { allowed_origins: origins }), 200, 'set the origins');
        const set = await req(grantedAgentToken, 'GET', '/v1/ghii/cors');
        expectAnswer(set, 200, 'read the origins');
        assert(JSON.stringify(set.body.data.allowed_origins) === JSON.stringify(origins), `read back: ${JSON.stringify(set.body.data)}`);
        expectAnswer(await req(grantedAgentToken, 'PUT', '/v1/ghii/cors', { allowed_origins: null }), 200, 'restore the default');
        const back = await req(grantedAgentToken, 'GET', '/v1/ghii/cors');
        assert(back.body.data.allowed_origins === null && back.body.data.inherited === true, `read back: ${JSON.stringify(back.body.data)}`);
    });

    // The two identity rails are switched off on the shared test node, so each door answers with its
    // handler's own state: the agent gets past the gate to the answer the account holder gets.
    for (const door of DOORS.filter(d => d.path.startsWith('/v1/ghii/verify/'))) {
        await test(`the agent reaches "${door.what}", which answers with the rail's own state`, async () => {
            const r = await call(door, grantedAgentToken);
            const rail = r.status === 503 && r.body.error?.code === 'FEATURE_DISABLED';
            const ftnSendsOn = door.path === '/v1/ghii/verify/ftn' && r.status === 400 && r.body.error?.code === 'FTN_USE_AUTHORIZE';
            assert(rail || ftnSendsOn, `${door.method} ${door.path}: expected the rail's answer, got ${r.status} ${JSON.stringify(r.body.error)}`);
        });
    }

    await test('the agent exports everything the account holds', async () => {
        const r = await req(grantedAgentToken, 'GET', `/v1/owners/${ownerA}/export`);
        expectAnswer(r, 200, 'export the account');
        assert(r.body.data.owner?.name === ownerA && r.body.data.ghii?.username === ownerA, `the export is this account's: ${JSON.stringify(r.body.data.owner)}`);
    });

    await test('the agent has the signed identity credential minted', async () => {
        const r = await req(grantedAgentToken, 'GET', `/v1/ghii/${ghiiA}/credential`);
        expectAnswer(r, 200, 'mint the identity credential');
        assert(typeof r.body.data.credential === 'object' && JSON.stringify(r.body.data.credential).includes(ownerA), `a credential about this person: ${JSON.stringify(r.body.data)}`);
    });

    // A PAT is the person's own credential, minted by them on purpose, and it is how everything gets
    // managed from outside a browser. So it reaches these doors, and that is a decision rather than an
    // oversight — asserted here so that tightening requireOwnerPrincipal() to mean "a browser session"
    // fails this suite instead of quietly breaking somebody's automation. The gate cannot tell a PAT
    // from a login: resolvePatToken builds the same VerifiedToken, and maybeSetPatBrowserSession
    // deliberately turns an owner PAT into a browser session.
    console.log('\nPhase 3b: The owner\'s own long-lived token gets through, by design');

    for (const door of DOORS) {
        await test(`an owner PAT can ${door.what}`, async () => {
            const r = await call(door, ownerPatToken);
            assert(r.status !== 403, `${door.method} ${door.path}: the owner's own token was refused with ${JSON.stringify(r.body)}`);
            assert(r.status < 500 || r.status === 503, `${door.method} ${door.path}: the handler failed with ${r.status} ${JSON.stringify(r.body?.error)}`);
        });
    }

    console.log('\nPhase 4: Cross-owner, and the two destructive doors');

    // Another person's principals, the second one holding the word itself: the word is consent given
    // by the account holder of ITS owner, so it reaches no other account. The three doors that name an
    // account in the path refuse on their own name check; the rest act on the caller's own account.
    const ADDRESSED: Array<[string, string, string, string]> = [
        ['export this account', 'GET', `/v1/owners/${ownerA}/export`, 'You can only export your own data'],
        ['have this person\'s credential minted', 'GET', `/v1/ghii/${ghiiA}/credential`, 'Can only request own credential'],
        ['erase this account', 'DELETE', `/v1/owners/${ownerA}`, 'You can only delete your own account'],
    ];
    for (const [who, token] of [['a different owner', ownerBToken], ['a different owner\'s agent holding account:security', crossAgentToken]]) {
        for (const [what, method, path, message] of ADDRESSED) {
            await test(`${who} cannot ${what}`, async () => {
                const r = await req(token, method, path);
                assert(r.status === 403 && r.body.error?.code === 'ACCESS_DENIED' && r.body.error?.message === message,
                    `${method} ${path}: expected 403 ACCESS_DENIED "${message}", got ${r.status} ${JSON.stringify(r.body.error)}`);
            });
        }
    }

    await test('a different owner\'s agent holding account:security reads its own owner\'s devices, never this one\'s', async () => {
        const r = await req(crossAgentToken, 'GET', '/v1/auth/sessions');
        expectAnswer(r, 200, 'read the devices');
        const list = r.body.data.sessions as any[];
        assert(list.length > 0 && list.every(s => s.gaii === ownerB), `only ${ownerB}'s sign-ins: ${JSON.stringify(list)}`);
    });

    // "Sign the person out of every device" is the one door in this table whose OWNER path succeeds
    // by destroying the credential that reached it, and Phase 3 and the PAT pass both drive it, so by
    // here the session is revoked. Re-minted rather than dropped from the table, because the refusals
    // in Phase 1 are why the door is listed and they are what dropping it would lose. e2e-profile-tabs
    // carries the same repair for the same door, and the comment beside it records the day this was
    // first learned.
    await test('the owner signs back in after signing themselves out everywhere', async () => {
        // With the password, not the signing key: the table's "set the password" row changed the
        // password to CHANGED on the owner's own pass, and a password change replaces the signing
        // key since 2026-10-09 (secrets audit 2026-10-09, S2).
        const ts = new Date().toISOString();
        const byKey = await json('/v1/auth/token', {
            method: 'POST',
            body: JSON.stringify({ owner: ownerA, timestamp: ts, signature: await signMsg(ownerAKey, ownerA + NODE_ID + ts) }),
        });
        // Refused one of two ways, chosen by the node's release and setting: 401 AUTH_REQUIRED while the
        // owner-key sign-in is on (the password change replaced the key), 410 OWNER_KEY_LOGIN_OFF once
        // it is gone (switched off, or any 4.0.0 node).
        assert(byKey.body.ok !== true && typeof byKey.body.data?.token !== 'string',
            `the signing key from before the password change must no longer sign in: ${byKey.status} ${byKey.body.error?.code}`);
        const want = ownerKeyOn ? { status: 401, code: 'AUTH_REQUIRED' } : { status: 410, code: 'OWNER_KEY_LOGIN_OFF' };
        const state = ownerKeyOn ? 'on (3.x)' : ownerKeyRemoved ? 'removed (4.0.0)' : 'off (3.x)';
        assert(byKey.status === want.status && byKey.body.error?.code === want.code,
            `sign-in ${state}: expected ${want.status} ${want.code} for the replaced key, got ${byKey.status} ${byKey.body.error?.code}`);
        // removed_in is in the 410 of a node at or after the removal, and in no other answer.
        assert((byKey.body.error?.details?.removed_in === OWNER_KEY_LOGIN_REMOVED_IN) === ownerKeyRemoved,
            `sign-in ${state}: removed_in ${ownerKeyRemoved ? 'expected' : 'not expected'}, got ${JSON.stringify(byKey.body.error?.details)}`);
        const again = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: ownerA, password: CHANGED }) });
        assert(again.body.ok === true, `owner re-auth: ${JSON.stringify(again.body.error)}`);
        ownerAToken = again.body.data.token as string;
    });

    // TAKING THE PERMISSION BACK HAS TO REACH THE TOKEN ALREADY OUT THERE. A JWT carries what the
    // agent held when it was minted, so every door reads the narrowed list instead — optionalAuth
    // and requireAuth both run withCurrentScopes. POST /v1/mcp/authorize-consent verified the JWT
    // itself and skipped that, and it is the door that mints a credential carrying the target
    // agent's FULL scope list. Found by the AI triage of 2026-09-13.
    await test('a revoked account:security stops an agent approving an MCP consent, on its old token', async () => {
        const made = await req(ownerAToken, 'POST', '/v1/agents', { name: 'revokebot', owner: ownerA, display_name: 'revokebot', capabilities: [], scopes: ['memory:read', 'account:security'] });
        assert(made.status === 201, `create revokebot: ${made.status} ${JSON.stringify(made.body?.error)}`);
        const targetGaii = made.body.data.agent.gaii as string;
        const ts0 = new Date().toISOString();
        const tok0 = await json('/v1/auth/token', {
            method: 'POST',
            body: JSON.stringify({ gaii: targetGaii, timestamp: ts0, signature: await signMsg(made.body.data.private_key as string, targetGaii + ts0) }),
        });
        assert(tok0.body.ok === true, `revokebot token: ${JSON.stringify(tok0.body.error)}`);
        const revokeMe = tok0.body.data.token as string;

        // The ordinary door first, so the token is known to work before the permission is taken.
        const before = await req(revokeMe, 'PUT', '/v1/ghii/cors', { allowed_origins: null });
        assert(before.status === 200, `the token starts out holding it: ${before.status}`);

        const narrowed = await req(ownerAToken, 'PATCH', '/v1/agents/revokebot/scopes', { scopes: ['memory:read'] });
        assert(narrowed.status === 200, `taking it back: ${narrowed.status} ${JSON.stringify(narrowed.body?.error)}`);

        // Same unexpired token. The ordinary door already refuses it…
        const after = await req(revokeMe, 'PUT', '/v1/ghii/cors', { allowed_origins: null });
        assert(after.status === 403, `the ordinary door reads the record: ${after.status}`);

        // …and so must the consent door. Everything it needs is supplied, so the principal check is
        // the only thing left to refuse it: a valid registered client, a real agent of this owner as
        // the target, and the revoked agent's own token in `owner_token`. On the old code it got
        // past that check and was handed an authorization code for the target agent's FULL scopes.
        const reg = await json('/v1/mcp/register', {
            method: 'POST', body: JSON.stringify({ client_name: 'Revoked consent probe', redirect_uris: [REDIRECT] }),
        });
        assert(reg.status === 201, `register client: ${reg.status} ${JSON.stringify(reg.body)}`);

        const consent = await json('/v1/mcp/authorize-consent', {
            method: 'POST',
            body: JSON.stringify({
                client_id: reg.body.client_id, redirect_uri: REDIRECT,
                gaii: targetGaii, owner_token: revokeMe,
                ...authorizeParams(mcpPkce(BASE)),
            }),
        });
        assert(consent.status === 403, `the consent door must refuse a revoked permission, got ${consent.status}: ${JSON.stringify(consent.body)}`);
        assert(consent.body?.error === 'access_denied', `and say why: ${JSON.stringify(consent.body)}`);
    });

    // Each destructive door gets both passes: the account holder in person on one account and the
    // owner's agent holding the word on the other.
    await test('the owner can delete their own identity record', async () => {
        const r = await req(ownerAToken, 'DELETE', '/v1/ghii');
        assert(r.status === 200, `expected 200, got ${r.status} ${JSON.stringify(r.body)}`);
    });

    await test('the owner\'s agent holding account:security erases the account (cleanup)', async () => {
        const r = await req(grantedAgentToken, 'DELETE', `/v1/owners/${ownerA}`);
        expectAnswer(r, 200, 'erase the account');
        // plainbot, securitybot and revokebot go with it, the agent that asked included.
        assert(r.body.data.deleted === true && r.body.data.owner === ownerA && r.body.data.agents_deleted >= 3, `the answer: ${JSON.stringify(r.body.data)}`);
    });

    await test('the second owner\'s agent holding account:security deletes that owner\'s identity record, and the owner erases the account (cleanup)', async () => {
        const r = await req(crossAgentToken, 'DELETE', '/v1/ghii');
        expectAnswer(r, 200, 'delete the identity record');
        assert(r.body.data.ghii === `${ownerB}@${NODE_ID}`, `the record of the agent's own owner: ${JSON.stringify(r.body.data)}`);
        expectAnswer(await req(ownerBToken, 'GET', '/v1/ghii/me'), 404, 'read the deleted record back', 'NOT_FOUND');
        const gone = await req(ownerBToken, 'DELETE', `/v1/owners/${ownerB}`);
        assert(gone.status === 200, `second owner cleanup: ${gone.status}`);
    });

    console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
    // An explicit exit: the seeded verification opens a storage handle that would hold the process open.
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
