/**
 * @file test/e2e-email-delivery.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every way this node sends mail, driven over HTTP against a real SMTP server, with the
 *   assertions made on the message that arrived.
 *
 *   WHY THIS SUITE EXISTS. `src/services/email.ts` and `src/services/email-templates.ts` were never
 *   executed by any suite in the sweep. Every `.env.test.*` leaves AIMEAT_SMTP_HOST unset, so
 *   `config.emailEnabled` is false, `createEmailService()` returns the disabled stub, and every
 *   caller sits behind `if (emailSvc?.enabled)`. The templates had unit tests; the transport, the
 *   retry, the subjects, the attachment path and the eleven doors that reach them had nothing. A
 *   defect in any of them would have shipped green.
 *
 *   WHAT IT PROVES, AND WHAT WOULD BE WORTHLESS. "A message arrived" is close to no assertion at
 *   all, because the failure this catches is a message that arrives WRONG. So every case reads the
 *   content back: the six-digit code in the mail is the code the API then accepts, the link in the
 *   mail is a link that opens, the subject names the organism it invites you to, the access code is
 *   the password that signs the account in, the credentials mail carries the password the login
 *   issued, and the invoice mail carries two attachments with their filenames, base64-encoded, a
 *   Reply-To and the AI-disclosure header.
 *
 *   IT RUNS ITS OWN NODE. SMTP is process-wide configuration and the shared E2E server has email
 *   off, so this spawns a node of its own on its own port with AIMEAT_SMTP_* pointed at the sink in
 *   this process. That node is SQLite whichever backend the runner was started with: what is under
 *   test is a service and a set of templates, and no storage provider changes what a template
 *   renders. `E2E_EMAIL_PORT` moves it (default 40294, with the SMTP sink one port above).
 *
 *   THE TRANSPORT AUTHENTICATES. AIMEAT_SMTP_USER is set, so `createEmailService()` builds its
 *   transport down the `auth:` branch and the sink counts the AUTH command. Without it that branch
 *   is dead code in every test that will ever run.
 * @structure
 *   - Phase 0: the node, the sink, an operator
 *   - Phase 1: verification codes (three doors) and the magic link
 *   - Phase 2: invitations (organism email, access key, first-login credentials, node registration,
 *     contact) and the notification door
 *   - Phase 3: the admin email doors, including all three of the test route's templates
 *   - Phase 4: the outbound door with attachments, Reply-To and a custom header
 *   - Phase 5: the refusals
 * @usage
 *   cd aimeat && pnpm exec node --import tsx test/e2e-email-delivery.ts
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=email-delivery
 * @version-history
 *   v1.0.0 -- 2026-09-08 -- Initial. Written with the fix for sendWithAttachments dropping opts.headers.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import * as ed from '@noble/ed25519';
import { startFakeSmtp, decodeWords, type FakeSmtp, type ParsedMail } from './helpers/fake-smtp.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const PORT = Number(process.env.E2E_EMAIL_PORT ?? 40294);
const SMTP_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const STAMP = Date.now().toString(36).slice(-6);

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) {
        failed++;
        console.error(`  ❌ ${name}: ${(err as Error).message}`);
        if (process.env.E2E_EMAIL_DEBUG) console.error(nodeLog.slice(-4000));
    }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    let res: Response | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
            break;
        } catch (err) {
            // Extensions keep mounting for a few seconds after /v1/spec answers, and a connection
            // made in that window is reset. Retrying beats widening the readiness probe into
            // something that lies about what is ready.
            if (attempt === 4) throw err;
            await sleep(500);
        }
    }
    if (!res) throw new Error('unreachable');
    const ct = res.headers.get('content-type') ?? '';
    const body = res.status === 204 ? null : ct.includes('json') ? await res.json() : { _raw: await res.text() };
    return { status: res.status, body };
}
const bearer = (t: string): Record<string, string> => ({ Authorization: `Bearer ${t}` });
const short = (v: unknown): string => JSON.stringify(v).slice(0, 300);

/** Sign the owner-auth message with the key a registration handed back once. */
async function ownerToken(owner: string, privB64: string): Promise<string> {
    const timestamp = new Date().toISOString();
    const sig = await ed.signAsync(new TextEncoder().encode(owner + NODE_ID + timestamp), Buffer.from(privB64, 'base64'));
    const r = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner, timestamp, signature: Buffer.from(sig).toString('base64') }),
    });
    assert(r.status === 200 && r.body?.data?.token, `owner token for ${owner}: ${r.status} ${short(r.body)}`);
    return r.body.data.token as string;
}

/** Register through the web door (which is the door that mails a verification code) and sign in. */
async function registerWeb(username: string, email: string, displayName: string): Promise<{ token: string; verificationId: string; privateKey: string }> {
    const reg = await json('/v1/ghii/register-web', {
        method: 'POST',
        body: JSON.stringify({ username, display_name: displayName, email }),
    });
    assert(reg.status === 201, `register-web ${username}: ${reg.status} ${short(reg.body)}`);
    return {
        token: await ownerToken(username, reg.body.data.private_key),
        verificationId: reg.body.data.verification_id as string,
        privateKey: reg.body.data.private_key as string,
    };
}

const sixDigits = (mail: ParsedMail): string => {
    const m = /\b(\d{6})\b/.exec(mail.text);
    assert(m !== null, `no six-digit code in the message: ${mail.text.slice(0, 400)}`);
    return m[1];
};

// ─── The node and the sink ────────────────────────────────────────────────────

let node: ChildProcess | null = null;
let nodeLog = '';
let smtp: FakeSmtp | null = null;
const dbDir = mkdtempSync(join(tmpdir(), 'aimeat-email-'));

async function startNode(): Promise<void> {
    node = spawn('node', ['--import', 'tsx', 'src/index.ts', 'start', '--db', 'sqlite', '--db-path', join(dbDir, 'email.db'), '--port', String(PORT)], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            AIMEAT_PORT: String(PORT),
            AIMEAT_BASE_URL: BASE,
            AIMEAT_DEFAULT_AGENT_SCOPES: '*',
            // The whole point: a node with email ON, pointed at the sink in this process, and
            // authenticating, so the transport's `auth:` branch is executed rather than skipped.
            AIMEAT_SMTP_HOST: '127.0.0.1',
            AIMEAT_SMTP_PORT: String(SMTP_PORT),
            AIMEAT_SMTP_SECURE: 'false',
            AIMEAT_SMTP_REJECT_UNAUTHORIZED: 'false',
            AIMEAT_SMTP_USER: 'aimeat-test',
            AIMEAT_SMTP_PASS: 'aimeat-test-secret',
            AIMEAT_SMTP_FROM: 'AIMEAT Test <noreply@aimeat.test>',
            AIMEAT_LOGIN_TARPIT_ENABLED: 'false',
            AIMEAT_LOGIN_RATE_LIMIT_MAX: '1000',
            AIMEAT_OUTBOUND_DAILY_LIMIT: '200',
            AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000', AIMEAT_RL_MEMORY: '1000',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    node.stdout?.on('data', c => { nodeLog += c.toString(); });
    node.stderr?.on('data', c => { nodeLog += c.toString(); });
    const start = Date.now();
    while (Date.now() - start < 90_000) {
        try { const r = await fetch(`${BASE}/v1/spec`); if (r.ok) return; } catch { /* booting */ }
        await sleep(300);
    }
    throw new Error(`node did not start\n--- node output ---\n${nodeLog.slice(-3000)}`);
}

async function stopAll(): Promise<void> {
    if (node) {
        const dying = node;
        node = null;
        dying.kill();
        // The coverage preload defers the signal and gives the node four seconds to write its
        // snapshot. Exiting this process before it has is how a measured run loses the measure.
        await Promise.race([once(dying, 'exit'), sleep(15_000)]);
    }
    if (smtp) { await smtp.close(); smtp = null; }
    try { rmSync(dbDir, { recursive: true, force: true }); } catch { /* the OS will get it */ }
}

// ─── The run ──────────────────────────────────────────────────────────────────

console.log('\n=== Email delivery: every send path, against a real SMTP server ===\n');

const opName = `edop${STAMP}`;
const opEmail = `${opName}@aimeat.test`;
const mlName = `edml${STAMP}`;
const mlEmail = `${mlName}@aimeat.test`;
const recName = `edrec${STAMP}`;
const recEmail = `${recName}@aimeat.test`;
const recPassword = 'RecoverMe9x';
const inviteeEmail = `edinv${STAMP}@aimeat.test`;
const keyName = `edkey${STAMP}`;
const keyEmail = `${keyName}@aimeat.test`;
const KEY_CODE = 'KeyAccess9x';
const regInviteEmail = `edreg${STAMP}@aimeat.test`;
const contactInviteEmail = `edcon${STAMP}@aimeat.test`;
const outboundEmail = `edout${STAMP}@aimeat.test`;
const ORG_NAME = `Email Delivery Org ${STAMP}`;

async function run(): Promise<void> {
    smtp = await startFakeSmtp({ port: SMTP_PORT, requireAuth: true });
    await startNode();

    let opToken = '';
    let opVerificationId = '';
    let recToken = '';
    let organismId = '';

    console.log('Phase 0 — the operator, and a transport that authenticates');

    await test('the first owner of a clean database registers and is the operator', async () => {
        const op = await registerWeb(opName, opEmail, 'Email Delivery Operator');
        opToken = op.token;
        opVerificationId = op.verificationId;
        const status = await json('/v1/admin/email/status', { headers: bearer(opToken) });
        assert(status.status === 200, `admin email status ${status.status}: ${short(status.body)}`);
        assert(status.body.data.enabled === true, 'the node under test must have email ON');
        assert(status.body.data.smtp_user_configured === true, 'the transport must be configured with credentials');
    });

    await test('the node authenticated to the SMTP server, so the transport built its auth branch', async () => {
        // Registration above already sent one message, so at least one session has completed.
        assert(smtp!.authAttempts > 0, `expected an AUTH command, got ${smtp!.authAttempts}`);
    });

    console.log('\nPhase 1 — verification codes and the magic link');

    await test('registration mails a six-digit code, and that code is what verify-email accepts', async () => {
        const mail = await smtp!.waitForMail(opEmail, /\b\d{6}\b/);
        assert(mail.subject === 'Your AIMEAT Verification Code', `subject: ${mail.subject}`);
        assert(/Email Verification/.test(mail.text), `the verification template must render its heading: ${mail.text.slice(0, 200)}`);
        // The registration response carried the id; the code comes only from the mailbox.
        const reg = smtp!.mailTo(opEmail);
        assert(reg.length >= 1, 'the operator got no mail at all');
        const code = sixDigits(mail);
        const verify = await json('/v1/ghii/verify-email', {
            method: 'POST',
            body: JSON.stringify({ verification_id: opVerificationId, code }),
        });
        assert(verify.status === 200, `verify-email ${verify.status}: ${short(verify.body)}`);
        assert(verify.body.data.verification_level === 1, `expected level 1, got ${verify.body.data.verification_level}`);
    });

    let magicToken = '';
    await test('a magic link is mailed, and the link in the message signs the account in', async () => {
        const ml = await registerWeb(mlName, mlEmail, 'Magic Link Reader');
        const codeMail = await smtp!.waitForMail(mlEmail, /\b\d{6}\b/);
        const v = await json('/v1/ghii/verify-email', {
            method: 'POST', body: JSON.stringify({ verification_id: ml.verificationId, code: sixDigits(codeMail) }),
        });
        assert(v.status === 200, `verify-email ${v.status}: ${short(v.body)}`);

        const req = await json('/v1/ghii/magic-link', { method: 'POST', body: JSON.stringify({ email: mlEmail }) });
        assert(req.status === 200, `magic-link ${req.status}: ${short(req.body)}`);
        const mail = await smtp!.waitForMail(mlEmail, /magic-link\/verify\?token=/);
        assert(mail.subject === 'Your AIMEAT Login Link', `subject: ${mail.subject}`);
        assert(/Sign In to AIMEAT/.test(mail.text), 'the magic-link template must render its heading');
        magicToken = /magic-link\/verify\?token=([a-f0-9]{64})/.exec(mail.text)![1];

        const opened = await json(`/v1/ghii/magic-link/verify?token=${magicToken}`);
        assert(opened.status === 200, `the emailed link must open: ${opened.status} ${short(opened.body)}`);
        const me = await json('/v1/ghii/me', { headers: bearer(opened.body.data.token) });
        assert(me.status === 200 && JSON.stringify(me.body.data).includes(mlName),
            `the session it hands back must be ${mlName}: ${short(me.body)}`);
    });

    await test('the owner door mails a code too, and confirming it verifies the address', async () => {
        const reg = await json('/v1/ghii', {
            method: 'POST',
            body: JSON.stringify({ username: recName, display_name: 'Recovery Reader', password: recPassword }),
        });
        assert(reg.status === 201, `register ${reg.status}: ${short(reg.body)}`);
        recToken = await ownerToken(recName, reg.body.data.private_key);

        const ask = await json('/v1/ghii/email/verify', {
            method: 'POST', headers: bearer(recToken), body: JSON.stringify({ email: recEmail }),
        });
        assert(ask.status === 200, `email/verify ${ask.status}: ${short(ask.body)}`);
        const mail = await smtp!.waitForMail(recEmail, /\b\d{6}\b/);
        assert(mail.subject === 'Your AIMEAT Verification Code', `subject: ${mail.subject}`);
        const confirm = await json('/v1/ghii/email/confirm', {
            method: 'POST', headers: bearer(recToken),
            body: JSON.stringify({ verification_id: ask.body.data.verification_id, code: sixDigits(mail) }),
        });
        assert(confirm.status === 200 && confirm.body.data.verified === true, `email/confirm ${confirm.status}: ${short(confirm.body)}`);
    });

    await test('the password-reset door mails a code, and the reset it opens really changes the password', async () => {
        smtp!.clear();
        const ask = await json('/v1/ghii/password/reset-request', { method: 'POST', body: JSON.stringify({ username: recName }) });
        assert(ask.status === 200, `reset-request ${ask.status}: ${short(ask.body)}`);
        const mail = await smtp!.waitForMail(recEmail, /\b\d{6}\b/);
        const newPassword = 'ResetWorked9x';
        const reset = await json('/v1/ghii/password/reset', {
            method: 'POST', body: JSON.stringify({ username: recName, code: sixDigits(mail), newPassword }),
        });
        assert(reset.status === 200, `password/reset ${reset.status}: ${short(reset.body)}`);
        const login = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: recName, password: newPassword }) });
        assert(login.status === 200, `the emailed code must produce a working password: ${login.status} ${short(login.body)}`);
    });

    await test('account recovery mails a notification carrying the username', async () => {
        smtp!.clear();
        const r = await json('/v1/ghii/account/recover', { method: 'POST', body: JSON.stringify({ email: recEmail }) });
        assert(r.status === 200, `account/recover ${r.status}: ${short(r.body)}`);
        const mail = await smtp!.waitForMail(recEmail, new RegExp(recName));
        assert(mail.subject === 'Your AIMEAT Username', `subject: ${mail.subject}`);
        assert(mail.text.includes(`Your username is: ${recName}`), `the message must name the account: ${mail.text.slice(0, 300)}`);
    });

    console.log('\nPhase 2 — invitations');

    await test('an organism email invitation names the organism in its subject, and its link opens', async () => {
        const org = await json('/v1/organisms', {
            method: 'POST', headers: bearer(opToken),
            body: JSON.stringify({ name: ORG_NAME, type: 'project', join_policy: 'invite_only', visibility: 'public' }),
        });
        assert(org.status === 201, `organism ${org.status}: ${short(org.body)}`);
        organismId = org.body.data.organism.id;

        smtp!.clear();
        const invite = await json(`/v1/organisms/${organismId}/invitations/email`, {
            method: 'POST', headers: bearer(opToken),
            body: JSON.stringify({ email: inviteeEmail, orgRole: 'member', message: 'Tule mukaan tähän.' }),
        });
        assert(invite.status === 201, `email invitation ${invite.status}: ${short(invite.body)}`);
        assert(invite.body.data.email_sent === true, 'the invite must report the message as sent');

        const mail = await smtp!.waitForMail(inviteeEmail, /v1\/invite\?token=/);
        assert(mail.subject === `You're invited to join ${ORG_NAME} on AIMEAT`,
            `the subject must name the organism, got: ${mail.subject}`);
        assert(mail.text.includes('Tule mukaan tähän.'), `the personal message must survive into the mail: ${mail.text.slice(0, 400)}`);
        const token = /v1\/invite\?token=([a-f0-9]{64})/.exec(mail.text)![1];
        const lookup = await json(`/v1/invitations/${token}`);
        assert(lookup.status === 200, `the emailed invitation link must resolve: ${lookup.status} ${short(lookup.body)}`);
        assert(lookup.body.data.invitation.organism.name === ORG_NAME,
            `the invitation must be for ${ORG_NAME}: ${short(lookup.body)}`);
    });

    await test('an access key mails a code that is the password the account signs in with', async () => {
        smtp!.clear();
        const mint = await json(`/v1/organisms/${organismId}/invitations/code`, {
            method: 'POST', headers: bearer(opToken),
            body: JSON.stringify({ email: keyEmail, username: keyName, code: KEY_CODE, display_name: 'Key Holder' }),
        });
        assert(mint.status === 201, `code mint ${mint.status}: ${short(mint.body)}`);
        assert(mint.body.data.email_sent === true, 'the mint must report the key as sent');

        const mail = await smtp!.waitForMail(keyEmail, new RegExp(KEY_CODE));
        assert(mail.subject === `Your access key to ${ORG_NAME} on AIMEAT`, `subject: ${mail.subject}`);
        assert(mail.text.includes(KEY_CODE), 'the access code must be in the message');
        // The key template is the one that carries the wordmark and its own footer.
        assert(/AIME/.test(mail.raw) && /machine room/i.test(mail.text), `the key template's brand and footer are missing: ${mail.text.slice(-300)}`);
    });

    await test("the first sign-in mails durable credentials, and the emailed password works", async () => {
        smtp!.clear();
        const login = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: keyName, password: KEY_CODE }) });
        assert(login.status === 200, `first login ${login.status}: ${short(login.body)}`);
        const issued = login.body.data?.key_credentials?.password as string;
        assert(typeof issued === 'string' && issued.length > 0, `first sign-in must issue a durable password: ${short(login.body.data?.key_credentials)}`);

        const mail = await smtp!.waitForMail(keyEmail, new RegExp(issued));
        assert(mail.subject === `Your login to ${ORG_NAME} on AIMEAT`, `subject: ${mail.subject}`);
        assert(mail.text.includes(`Username: ${keyName}`), `the mail must carry the username verbatim: ${mail.text.slice(0, 400)}`);
        assert(mail.text.includes(`Password: ${issued}`), 'the mail must carry the password the login issued, verbatim');
        const again = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: keyName, password: issued }) });
        assert(again.status === 200, `the emailed password must sign in: ${again.status} ${short(again.body)}`);
    });

    await test('the agent registration door mails a traceable invitation naming the model that asked', async () => {
        smtp!.clear();
        const r = await json('/v1/registration-invites', {
            method: 'POST',
            headers: { 'User-Agent': 'aimeat-e2e-email/1.0' },
            body: JSON.stringify({ email: regInviteEmail, agent: { model: 'claude-opus-5', vendor: 'Anthropic', client: 'Claude Code' } }),
        });
        assert(r.status === 202, `registration-invites ${r.status}: ${short(r.body)}`);

        const mail = await smtp!.waitForMail(regInviteEmail, /v1\/invite\?token=/);
        assert(mail.subject === 'Someone asked us to set up an AIMEAT account for this address', `subject: ${mail.subject}`);
        assert(mail.text.includes('claude-opus-5') && mail.text.includes('Anthropic'),
            `the claim the AI made about itself must be in the message: ${mail.text.slice(0, 500)}`);
        assert(mail.text.includes('aimeat-e2e-email/1.0'), 'what the server observed must be in the message too');
        const token = /v1\/invite\?token=([a-f0-9]{64})/.exec(mail.text)![1];
        const lookup = await json(`/v1/invitations/${token}`);
        assert(lookup.status === 200, `the emailed link must resolve: ${lookup.status} ${short(lookup.body)}`);
    });

    await test('a contact invitation names the inviter and carries their message', async () => {
        smtp!.clear();
        const r = await json('/v1/contacts/invite', {
            method: 'POST', headers: bearer(opToken),
            body: JSON.stringify({ email: contactInviteEmail, message: 'Tavataan AIMEATissa.' }),
        });
        assert(r.status === 201, `contacts/invite ${r.status}: ${short(r.body)}`);
        const acceptUrl = r.body.data.accept_url as string;

        const mail = await smtp!.waitForMail(contactInviteEmail, /v1\/invite\?token=/);
        assert(mail.subject === 'Email Delivery Operator invited you to AIMEAT', `subject: ${mail.subject}`);
        assert(mail.text.includes('Tavataan AIMEATissa.'), `the message must survive into the mail: ${mail.text.slice(0, 400)}`);
        assert(mail.text.includes(acceptUrl), `the link in the mail must be the accept_url the API returned: ${acceptUrl}`);
    });

    console.log('\nPhase 3 — the admin email doors');

    await test('the admin test route renders all three of its templates', async () => {
        const cases: Array<{ template: string; subject: string; marker: RegExp }> = [
            { template: 'verification', subject: 'AIMEAT Test — Verification Code', marker: /123456/ },
            { template: 'magic_link', subject: 'AIMEAT Test — Magic Link', marker: /login\?token=sample/ },
            { template: 'notification', subject: 'AIMEAT Test Email', marker: /test email from your AIMEAT node/ },
        ];
        for (const c of cases) {
            smtp!.clear();
            const r = await json('/v1/admin/email/test', {
                method: 'POST', headers: bearer(opToken),
                body: JSON.stringify({ to: opEmail, template: c.template }),
            });
            assert(r.status === 200 && r.body.data.sent === true, `admin test ${c.template}: ${r.status} ${short(r.body)}`);
            const mail = await smtp!.waitForMail(opEmail, c.marker);
            assert(mail.subject === c.subject, `${c.template} subject: ${mail.subject}`);
        }
    });

    await test('the same route in Finnish renders the Finnish string table', async () => {
        smtp!.clear();
        const r = await json('/v1/admin/email/test', {
            method: 'POST', headers: bearer(opToken),
            body: JSON.stringify({ to: opEmail, template: 'verification', locale: 'fi' }),
        });
        assert(r.status === 200, `admin test fi ${r.status}: ${short(r.body)}`);
        const mail = await smtp!.waitForMail(opEmail, /Sähköpostivahvistus/);
        assert(/Koodi vanhenee 15 minuutissa/.test(mail.text),
            `the Finnish body must be the Finnish one: ${mail.text.slice(0, 300)}`);
    });

    await test('a group send reaches every account with a notification address', async () => {
        smtp!.clear();
        const subject = `Group message ${STAMP}`;
        const r = await json('/v1/admin/email/send-group', {
            method: 'POST', headers: bearer(opToken),
            body: JSON.stringify({ group: 'all', subject, body: 'One line to everybody with an address on file.' }),
        });
        assert(r.status === 200, `send-group ${r.status}: ${short(r.body)}`);
        assert(r.body.data.sent >= 2, `expected at least two recipients, got ${short(r.body.data)}`);
        const mail = await smtp!.waitForMail(opEmail, new RegExp(`Group message ${STAMP}`));
        assert(mail.subject === subject, `subject: ${mail.subject}`);
        assert(mail.text.includes('One line to everybody with an address on file.'), 'the body must arrive intact');
    });

    console.log('\nPhase 4 — the outbound door: attachments, Reply-To and the disclosure header');

    await test('an invoice is delivered with both attachments, a Reply-To and the AI-disclosure header', async () => {
        const contact = await json('/v1/outbound/contacts', {
            method: 'POST', headers: bearer(opToken),
            body: JSON.stringify({ name: 'Ulkoinen Asiakas', email: outboundEmail, tags: ['asiakas'] }),
        });
        assert(contact.status === 201, `contact ${contact.status}: ${short(contact.body)}`);
        assert(contact.body.data.contact.ghii === null, 'the recipient must have no account here, or the send takes the inbox channel');
        const contactId = contact.body.data.contact.id as string;

        const draft = await json('/v1/finance/invoices', {
            method: 'POST', headers: bearer(opToken),
            body: JSON.stringify({
                seller: { name: 'Lähettäjä Oy', businessId: '1234567-8', iban: 'FI2112345600000785', bic: 'NDEAFIHH', streetAddress: 'Katu 1', postalCode: '00100', city: 'Helsinki' },
                buyer: { name: 'Ulkoinen Asiakas', email: outboundEmail },
                lines: [{ description: 'Palvelu', quantityMilli: 1000, unit: 'kpl', unitPriceMinor: 5000, vatCodeId: 'fi-std-2550' }],
            }),
        });
        assert(draft.status === 201, `invoice draft ${draft.status}: ${short(draft.body)}`);
        const invoiceId = draft.body.data.invoice.id as string;
        const sentInvoice = await json(`/v1/finance/invoices/${invoiceId}/send`, {
            method: 'POST', headers: bearer(opToken), body: JSON.stringify({ delivery_method: 'email' }),
        });
        assert(sentInvoice.status === 200, `invoice send ${sentInvoice.status}: ${short(sentInvoice.body)}`);
        const invoiceNumber = sentInvoice.body.data.invoice.invoiceNumber as string;

        smtp!.clear();
        const deliver = await json('/v1/outbound/send', {
            method: 'POST', headers: bearer(opToken),
            body: JSON.stringify({
                contact_id: contactId, kind: 'invoice', invoice_id: invoiceId,
                reply_to: 'laskutus@lahettaja.test', from_name: 'Lähettäjä Oy',
                ai_disclosure: { level: 'ai-generated' },
            }),
        });
        assert(deliver.status === 200, `outbound send ${deliver.status}: ${short(deliver.body)}`);
        assert(deliver.body.data.channel === 'email' && deliver.body.data.status === 'sent',
            `expected email/sent, got ${short(deliver.body.data)}`);

        const mail = await smtp!.waitForMail(outboundEmail, new RegExp(invoiceNumber));
        assert(mail.attachments.length === 2, `expected two attachments, got ${mail.attachments.map(a => a.filename).join(', ') || 'none'}`);
        const pdf = mail.attachments.find(a => a.filename === `lasku-${invoiceNumber}.pdf`);
        const xml = mail.attachments.find(a => a.filename === `finvoice-${invoiceNumber}.xml`);
        assert(pdf !== undefined, `the PDF must arrive under its own name: ${mail.attachments.map(a => a.filename).join(', ')}`);
        assert(xml !== undefined, `the Finvoice XML must arrive under its own name: ${mail.attachments.map(a => a.filename).join(', ')}`);
        assert(pdf.encoding.toLowerCase() === 'base64', `a PDF must cross the wire base64-encoded, got ${pdf.encoding}`);
        assert(pdf.content.subarray(0, 5).toString('latin1') === '%PDF-', 'the decoded attachment must really be a PDF');
        assert(pdf.content.length > 1500, `the PDF is suspiciously small: ${pdf.content.length} bytes`);
        assert(xml.content.toString('utf-8').includes(invoiceNumber), 'the Finvoice XML must carry the invoice number');

        const from = decodeWords(mail.headers['from'] ?? '');
        assert(/laskutus@lahettaja\.test/.test(mail.headers['reply-to'] ?? ''), `Reply-To: ${mail.headers['reply-to']}`);
        assert(from.includes('noreply@aimeat.test'), `the envelope sender stays the node's own: ${from}`);
        assert(from.includes('Lähettäjä Oy'), `the business name must ride on the From display name: ${from}`);
        // THE DEFECT. sendWithAttachments() accepted opts.headers in its signature and never passed
        // them to sendMail(), so an AI disclosure declared on the send never reached the message.
        assert(mail.headers['x-ai-disclosure'] === 'ai-generated',
            `the declared AI disclosure must be a header on the message, got ${JSON.stringify(mail.headers['x-ai-disclosure'])}`);
    });

    console.log('\nPhase 5 — the refusals');

    await test('a plain owner cannot use the operator email doors', async () => {
        const r = await json('/v1/admin/email/test', {
            method: 'POST', headers: bearer(recToken), body: JSON.stringify({ to: recEmail, template: 'notification' }),
        });
        assert(r.status === 403, `expected 403, got ${r.status}: ${short(r.body)}`);
    });

    await test('the test door refuses a request with no recipient, and sends nothing', async () => {
        smtp!.clear();
        const r = await json('/v1/admin/email/test', {
            method: 'POST', headers: bearer(opToken), body: JSON.stringify({ template: 'notification' }),
        });
        assert(r.status === 400, `expected 400, got ${r.status}: ${short(r.body)}`);
        await sleep(500);
        assert(smtp!.inbox.length === 0, `a refused request must send nothing, got ${smtp!.inbox.length} message(s)`);
    });

    await test('the group door refuses a group it does not know', async () => {
        const r = await json('/v1/admin/email/send-group', {
            method: 'POST', headers: bearer(opToken), body: JSON.stringify({ group: 'nobody', subject: 'x', body: 'y' }),
        });
        assert(r.status === 400, `expected 400, got ${r.status}: ${short(r.body)}`);
    });

    await stopAll();
    console.log(`\nEmail delivery E2E: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(async err => { console.error('Suite crashed:', err); await stopAll(); process.exit(1); });
