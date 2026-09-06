/**
 * @file test/e2e-magic-link-refusal.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The email sign-in paths, driven end to end for the first time — and the refusal that
 *   used to arrive after the damage.
 *
 *   WHY THIS SUITE EXISTS. `GET /v1/ghii/magic-link/verify` replaced the owner's pinned public key
 *   and the app agent's, and THEN asked whether the account was deactivated. So clicking a sign-in
 *   link for a switched-off account destroyed the person's signing key on a request the node went on
 *   to refuse, and asking for another link is free, so it could be done again. Review item 2.5,
 *   2026-09-06. `POST /v1/ghii/verify-email` had the milder version of the same ordering.
 *
 *   AND WHY IT NEEDED AN SMTP SERVER. Both paths turn on a secret delivered by mail: a six-digit
 *   code, or a link carrying a token. Neither is exposed by any route, and the node's email service
 *   has two states — off, or a real nodemailer transport — so until now the whole family was
 *   untestable and every suite that touched it said so in its header. This starts a REAL SMTP server
 *   in the test process and points a REAL node at it: the node's own email service, the real
 *   transport, the real routes. Nothing here is a stub of our code; the sink is a mailbox, and the
 *   secret comes out of the message the node actually sent.
 *
 *   It runs its own node on its own port because SMTP is process-wide configuration, and the shared
 *   E2E server has email off. That node is SQLite whichever backend the runner was started with:
 *   what is under test is the ORDER of a route's checks, which no storage provider can change, and
 *   standing a Postgres database up per suite to prove the same statement twice is not worth it.
 *   `E2E_MAGIC_LINK_PORT` moves it (default 40289, with the SMTP sink one port above).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=magic-link-refusal
 * @version-history
 *   v1.0.0 — 2026-09-06 — Written with the fix for review item 2.5.
 */
import { createServer, type Server, type Socket } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import * as ed from '@noble/ed25519';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const PORT = Number(process.env.E2E_MAGIC_LINK_PORT ?? 40289);
const SMTP_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); if (process.env.E2E_ML_DEBUG) console.error(nodeLog.slice(-4000)); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    let res: Response | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
            break;
        } catch (err) {
            // The node is still standing extensions up for a few seconds after /v1/spec answers, and
            // a connection made in that window is reset. Retrying beats widening the readiness probe
            // into something that lies about what is ready.
            if (attempt === 4) throw err;
            await sleep(500);
        }
    }
    if (!res) throw new Error('unreachable');
    const ct = res.headers.get('content-type') ?? '';
    const body = res.status === 204 ? null : ct.includes('json') ? await res.json() : { _raw: await res.text() };
    return { status: res.status, body };
}
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Sign the owner-auth message with the key registration handed back once. */
async function ownerToken(owner: string, privB64: string): Promise<{ status: number; token: string }> {
    const timestamp = new Date().toISOString();
    const sig = await ed.signAsync(new TextEncoder().encode(owner + NODE_ID + timestamp), Buffer.from(privB64, 'base64'));
    const r = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner, timestamp, signature: Buffer.from(sig).toString('base64') }),
    });
    return { status: r.status, token: (r.body?.data?.token ?? '') as string };
}

// ─── A mailbox, not a mock ────────────────────────────────────────────────────
//
// Enough SMTP for nodemailer to deliver: a greeting, EHLO, MAIL/RCPT, DATA terminated by <CRLF>.<CRLF>,
// QUIT. No TLS is advertised, so the transport stays in the clear against loopback, which is what
// `secure: false` with no auth already means.

const inbox: string[] = [];

function startSmtpSink(): Promise<Server> {
    const CRLF = '\r\n';
    const END_OF_DATA = `${CRLF}.${CRLF}`;
    const server = createServer((socket: Socket) => {
        let buffer = '';
        let inData = false;
        let message = '';
        socket.setEncoding('utf-8');
        socket.write(`220 aimeat-test ESMTP${CRLF}`);
        socket.on('data', chunk => {
            buffer += chunk;
            for (;;) {
                if (inData) {
                    // THE TERMINATOR CAN ARRIVE SPLIT. A <CRLF>.<CRLF> straddling two TCP chunks is
                    // ordinary, so the buffer is never cleared blindly: only what is provably before
                    // the marker is consumed, and the last four characters stay behind.
                    const end = buffer.indexOf(END_OF_DATA);
                    if (end === -1) {
                        if (buffer.length > 4) { message += buffer.slice(0, -4); buffer = buffer.slice(-4); }
                        return;
                    }
                    message += buffer.slice(0, end);
                    buffer = buffer.slice(end + END_OF_DATA.length);
                    inbox.push(message);
                    message = '';
                    inData = false;
                    socket.write(`250 2.0.0 Ok: queued${CRLF}`);
                    continue;
                }
                const nl = buffer.indexOf(CRLF);
                if (nl === -1) return;
                const line = buffer.slice(0, nl);
                buffer = buffer.slice(nl + CRLF.length);
                const verb = line.slice(0, 4).toUpperCase();
                if (verb === 'EHLO') socket.write(`250-aimeat-test${CRLF}250 8BITMIME${CRLF}`);
                else if (verb === 'HELO') socket.write(`250 aimeat-test${CRLF}`);
                else if (verb === 'DATA') { inData = true; socket.write(`354 End data with <CR><LF>.<CR><LF>${CRLF}`); }
                else if (verb === 'QUIT') { socket.write(`221 Bye${CRLF}`); socket.end(); return; }
                else socket.write(`250 2.0.0 Ok${CRLF}`);
            }
        });
        socket.on('error', () => { /* a client hanging up mid-session is not this test's business */ });
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(SMTP_PORT, '127.0.0.1', () => resolve(server));
    });
}

/**
 * Wait for a message to ONE address whose decoded body matches, then return that body.
 *
 * The recipient is not optional politeness: this suite registers two accounts, so a bare
 * "any message with six digits" hands the second account the first one's code.
 */
async function waitForMail(to: string, match: RegExp, timeoutMs = 15_000): Promise<string> {
    const start = Date.now();
    for (;;) {
        for (const raw of inbox) {
            const body = decodeMail(raw);
            if (body.includes(to) && match.test(body)) return body;
        }
        if (Date.now() - start > timeoutMs) {
            throw new Error(`no mail to ${to} matching ${match} after ${timeoutMs}ms (${inbox.length} message(s) received)`);
        }
        await sleep(150);
    }
}

/**
 * Undo the two encodings nodemailer applies to a body, so a six-digit code split by a soft line
 * break is still one number. Quoted-printable first (`=\r\n` joins, `=XX` bytes), then base64 when
 * the whole part is encoded that way.
 */
function decodeMail(raw: string): string {
    let text = raw;
    if (/Content-Transfer-Encoding:\s*base64/i.test(raw)) {
        text = raw.replace(/(?:\r?\n){2}([A-Za-z0-9+/=\r\n]+)$/m, (_m, b64: string) => {
            try { return `\n${Buffer.from(b64.replace(/\s+/g, ''), 'base64').toString('utf-8')}`; } catch { return _m; }
        });
    }
    return text
        .replace(/=\r?\n/g, '')
        .replace(/=([0-9A-F]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

// ─── The node ─────────────────────────────────────────────────────────────────

let node: ChildProcess | null = null;
let nodeLog = '';
let sink: Server | null = null;
const dbDir = mkdtempSync(join(tmpdir(), 'aimeat-magiclink-'));

async function startNode(): Promise<void> {
    node = spawn('node', ['--import', 'tsx', 'src/index.ts', 'start', '--db', 'sqlite', '--db-path', join(dbDir, 'magic.db'), '--port', String(PORT)], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            AIMEAT_PORT: String(PORT),
            AIMEAT_BASE_URL: BASE,
            AIMEAT_DEFAULT_AGENT_SCOPES: '*',
            // The whole point: a node with email ON, pointed at the sink above.
            AIMEAT_SMTP_HOST: '127.0.0.1',
            AIMEAT_SMTP_PORT: String(SMTP_PORT),
            AIMEAT_SMTP_SECURE: 'false',
            AIMEAT_SMTP_REJECT_UNAUTHORIZED: 'false',
            AIMEAT_SMTP_FROM: 'AIMEAT Test <noreply@aimeat.test>',
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
    throw new Error(`node did not start
--- node output ---
${nodeLog.slice(-3000)}`);
}

async function stopAll(): Promise<void> {
    if (node) { node.kill(); node = null; }
    if (sink) { await new Promise<void>(r => sink!.close(() => r())); sink = null; }
    await sleep(300);
    try { rmSync(dbDir, { recursive: true, force: true }); } catch { /* the OS will get it */ }
}

// ─── The run ──────────────────────────────────────────────────────────────────

console.log('\n=== Magic-link and verify-email refuse a deactivated account BEFORE they write ===\n');

async function run() {
    sink = await startSmtpSink();
    await startNode();

    const stamp = Date.now().toString(36);
    const victimName = `mluser${stamp}`;
    const victimEmail = `${victimName}@aimeat.test`;
    let victimPrivKey = '';
    let victimPublicKey = '';
    let opToken = '';

    await test('setup: an operator exists (the first owner of a clean database self-heals into one)', async () => {
        const opName = `mlop${stamp}`;
        const reg = await json('/v1/ghii/register-web', {
            method: 'POST',
            body: JSON.stringify({ username: opName, display_name: 'Magic Link Operator', email: `${opName}@aimeat.test` }),
        });
        assert(reg.status === 201, `operator register ${reg.status}: ${JSON.stringify(reg.body).slice(0, 300)}`);
        // register-web sets no password; the key it returns once is how this account signs in.
        const tok = await ownerToken(opName, reg.body.data.private_key);
        assert(tok.status === 200 && tok.token.length > 0, `operator token ${tok.status}`);
        opToken = tok.token;
    });

    let verificationId = '';
    await test('setup: the victim registers, and the node really sends the code', async () => {
        const reg = await json('/v1/ghii/register-web', {
            method: 'POST',
            body: JSON.stringify({ username: victimName, display_name: 'Magic Link Victim', email: victimEmail }),
        });
        assert(reg.status === 201, `register ${reg.status}: ${JSON.stringify(reg.body).slice(0, 300)}`);
        victimPrivKey = reg.body.data.private_key;
        victimPublicKey = reg.body.data.public_key;
        verificationId = reg.body.data.verification_id;
        assert(typeof victimPrivKey === 'string' && victimPrivKey.length > 0, 'owner private key returned once');
        assert(typeof verificationId === 'string' && verificationId.length > 0, `verification_id: ${JSON.stringify(reg.body.data).slice(0, 300)}`);
    });

    await test('the six-digit code arrives by mail, and verifying it lights up magic-link sign-in', async () => {
        const mail = await waitForMail(victimEmail, /\b\d{6}\b/);
        const code = /\b(\d{6})\b/.exec(mail)![1];
        const verify = await json('/v1/ghii/verify-email', {
            method: 'POST', body: JSON.stringify({ verification_id: verificationId, code }),
        });
        assert(verify.status === 200, `verify-email ${verify.status}: ${JSON.stringify(verify.body).slice(0, 300)}`);
        assert(verify.body.data.verification_level === 1, `expected level 1, got ${verify.body.data.verification_level}`);
    });

    await test("the owner's key works, which is what the rest of this suite is about", async () => {
        const r = await ownerToken(victimName, victimPrivKey);
        assert(r.status === 200 && r.token.length > 0, `owner key must authenticate: ${r.status}`);
        const me = await json(`/v1/ghii/${encodeURIComponent(`${victimName}@${NODE_ID}`)}`);
        assert(me.status === 200, `public profile ${me.status}`);
    });

    let magicToken = '';
    await test('a magic link is sent, and its token is in the message', async () => {
        inbox.length = 0;
        const r = await json('/v1/ghii/magic-link', { method: 'POST', body: JSON.stringify({ email: victimEmail }) });
        assert(r.status === 200, `magic-link ${r.status}`);
        const mail = await waitForMail(victimEmail, /magic-link\/verify\?token=/);
        magicToken = /magic-link\/verify\?token=([a-f0-9]+)/.exec(mail)![1];
        assert(magicToken.length === 64, `token looks wrong: ${magicToken}`);
    });

    await test('setup: the operator deactivates the account', async () => {
        const r = await json(`/v1/admin/owners/${victimName}/disable`, { method: 'POST', headers: bearer(opToken) });
        assert(r.status === 200, `disable ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
    });

    // ── The finding ──
    await test('the magic link is refused for a deactivated account', async () => {
        const r = await json(`/v1/ghii/magic-link/verify?token=${magicToken}`);
        assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
        assert(r.body.error?.code === 'ACCOUNT_DISABLED', `code: ${JSON.stringify(r.body.error)}`);
    });

    await test("…and the refusal did not destroy the owner's signing key on its way out", async () => {
        // THE DEFECT, MEASURED. The re-key ran six lines above the refusal, so the owner's pinned
        // public key was replaced and the replacement was handed to nobody: the person's own private
        // key stopped working on a request the node had refused. Re-enable, then ask the key.
        const en = await json(`/v1/admin/owners/${victimName}/enable`, { method: 'POST', headers: bearer(opToken) });
        assert(en.status === 200, `enable ${en.status}: ${JSON.stringify(en.body).slice(0, 300)}`);

        const r = await ownerToken(victimName, victimPrivKey);
        assert(r.status === 200 && r.token.length > 0,
            `the owner's key must still authenticate after a REFUSED magic link, got ${r.status}. `
            + 'This is the whole finding: the re-key ran before the refusal, so a request that was '
            + 'denied still replaced the key and handed the replacement to nobody.');

        const profile = await json('/v1/ghii/me', { headers: bearer(r.token) });
        assert(profile.status === 200 && profile.body.data.public_key === victimPublicKey,
            `the stored public key must be the one registration returned: ${profile.body?.data?.public_key?.slice(0, 20)} vs ${victimPublicKey.slice(0, 20)}`);
    });

    await test('a deactivated account is not sent a sign-in link at all', async () => {
        const dis = await json(`/v1/admin/owners/${victimName}/disable`, { method: 'POST', headers: bearer(opToken) });
        assert(dis.status === 200, `disable ${dis.status}`);
        inbox.length = 0;
        const r = await json('/v1/ghii/magic-link', { method: 'POST', body: JSON.stringify({ email: victimEmail }) });
        assert(r.status === 200, `the answer must not disclose the account's state, got ${r.status}`);
        await sleep(1500);
        assert(inbox.length === 0, `no link may be sent for a switched-off account, got ${inbox.length} message(s)`);
    });

    await test('…and a live account still gets one, so the fix costs the real path nothing', async () => {
        const en = await json(`/v1/admin/owners/${victimName}/enable`, { method: 'POST', headers: bearer(opToken) });
        assert(en.status === 200, `enable ${en.status}`);
        inbox.length = 0;
        const r = await json('/v1/ghii/magic-link', { method: 'POST', body: JSON.stringify({ email: victimEmail }) });
        assert(r.status === 200, `magic-link ${r.status}`);
        const mail = await waitForMail(victimEmail, /magic-link\/verify\?token=/);
        assert(/token=[a-f0-9]{64}/.test(mail), 'the link must carry a token');
    });

    await stopAll();
    console.log(`\nMagic-link refusal E2E: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(async err => { console.error('Suite crashed:', err); await stopAll(); process.exit(1); });
