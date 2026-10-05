/**
 * @file test/e2e-magic-link-return.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The emailed sign-in link returns the person to the place they asked from, and never
 *   anywhere else.
 *
 *   WHY THIS SUITE EXISTS. Until 2026-09-29 GET /v1/ghii/magic-link/open always redirected to the
 *   front page, so a person who asked for a link inside an app, or on any page of the node, had to
 *   find their way back after signing in. POST /v1/ghii/magic-link now takes `redirect`: a path of
 *   this node, or an address on one of this node's own published app origins. The link carries it,
 *   and the open endpoint checks it again, because the person's own mail is not a trusted store and
 *   a link can be edited before it is opened.
 *
 *   WHAT IT PROVES. A path lands on that path. An app origin the node serves lands on that app. A
 *   foreign address, asked for or written into the link afterwards, lands on the front page, signed
 *   in, because the token was good and only the address was not. A refused token still goes to the
 *   front page with `auth_error`, whatever address it carries. The session a link opens is the
 *   mailed account's, and the operator's endpoint refuses it with 403.
 *
 *   It runs its own node, with email on (a real SMTP sink) and app origins on, because the shared
 *   E2E server has neither. SQLite whichever backend the runner started with: what is under test is
 *   how a route reads an address, which no storage provider changes. `E2E_MAGIC_RETURN_PORT` moves
 *   it (default 40454, with the SMTP sink one port above).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=magic-link-return
 * @version-history
 *   v1.0.0 — 2026-09-29 — Initial (the emailed link returns to the place it was asked from).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import * as ed from '@noble/ed25519';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { startFakeSmtp, type FakeSmtp } from './helpers/fake-smtp.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const PORT = Number(process.env.E2E_MAGIC_RETURN_PORT ?? 40454);
const SMTP_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const APP_HOST = 'apps.aimeat.test';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); if (process.env.E2E_ML_DEBUG) console.error(nodeLog.slice(-4000)); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// Every request comes from a different documentation address. The link request allows five per ten
// minutes per address, and this suite asks for more than five links; its node trusts loopback as a
// proxy (AIMEAT_TRUST_PROXY below), so it reads the forwarded address as the client's.
let clientSeq = 0;
const asClient = () => ({ 'X-Forwarded-For': `203.0.113.${++clientSeq}` });

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    let res: Response | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...asClient(), ...opts.headers } });
            break;
        } catch (err) {
            // The node is still standing extensions up for a few seconds after /v1/spec answers.
            if (attempt === 4) throw err;
            await sleep(500);
        }
    }
    if (!res) throw new Error('unreachable');
    const ct = res.headers.get('content-type') ?? '';
    const body = res.status === 204 ? null : ct.includes('json') ? await res.json() : { _raw: await res.text() };
    return { status: res.status, body };
}

async function ownerToken(owner: string, privB64: string): Promise<string> {
    const timestamp = new Date().toISOString();
    const sig = await ed.signAsync(new TextEncoder().encode(owner + NODE_ID + timestamp), Buffer.from(privB64, 'base64'));
    const r = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner, timestamp, signature: Buffer.from(sig).toString('base64') }),
    });
    assert(r.status === 200, `owner token ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
    return r.body.data.token as string;
}

// ─── The node ─────────────────────────────────────────────────────────────────

let node: ChildProcess | null = null;
let nodeLog = '';
let smtp: FakeSmtp | null = null;
const dbDir = mkdtempSync(join(tmpdir(), 'aimeat-magicreturn-'));

async function startNode(): Promise<void> {
    node = spawn('node', [...nodeEntryArgs(), 'start', '--db', 'sqlite', '--db-path', join(dbDir, 'magic.db'), '--port', String(PORT)], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            AIMEAT_PORT: String(PORT),
            AIMEAT_BASE_URL: BASE,
            AIMEAT_DEFAULT_AGENT_SCOPES: '*',
            AIMEAT_APP_HOST: APP_HOST,
            AIMEAT_APP_ORIGIN_ENABLED: 'true',
            AIMEAT_SMTP_HOST: '127.0.0.1',
            AIMEAT_SMTP_PORT: String(SMTP_PORT),
            AIMEAT_SMTP_SECURE: 'false',
            AIMEAT_SMTP_REJECT_UNAUTHORIZED: 'false',
            AIMEAT_SMTP_FROM: 'AIMEAT Test <noreply@aimeat.test>',
            // A node on 127.0.0.1 trusts no proxy by default; this one trusts loopback, so the
            // forwarded address each request carries (asClient above) is the one it limits by.
            AIMEAT_TRUST_PROXY: 'loopback',
            AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000', AIMEAT_RL_MEMORY: '1000',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    node.stdout?.on('data', c => { nodeLog += c.toString(); });
    node.stderr?.on('data', c => { nodeLog += c.toString(); });
    await waitForServer(node, BASE, { label: 'the magic-link return node' });
}

async function stopAll(): Promise<void> {
    if (node) { node.kill(); node = null; }
    if (smtp) { await smtp.close(); smtp = null; }
    await sleep(300);
    try { rmSync(dbDir, { recursive: true, force: true }); } catch { /* the OS will get it */ }
}

// ─── The link, as the mail carries it ─────────────────────────────────────────

const LINK_RE = /(https?:\/\/[^\s"<>]*\/v1\/ghii\/magic-link\/open\?token=[a-f0-9]{64}[^\s"<>]*)/;

/** Ask for a link as the dialog does, and return the address the mail carries. */
async function askLink(email: string, redirect?: string): Promise<string> {
    smtp!.clear();
    const body: Record<string, string> = { email };
    if (redirect !== undefined) body.redirect = redirect;
    const r = await json('/v1/ghii/magic-link', { method: 'POST', body: JSON.stringify(body) });
    assert(r.status === 200, `magic-link ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
    const mail = await smtp!.waitForMail(email, /magic-link\/open\?token=/);
    const m = LINK_RE.exec(mail.text);
    assert(!!m, `no link in the mail: ${mail.text.slice(0, 400)}`);
    return m![1];
}

/** Open a link as a browser does, and say where it went and whether a session was opened. */
async function open(link: string): Promise<{ status: number; location: string; session: boolean }> {
    const r = await fetch(link, { redirect: 'manual', headers: asClient() });
    const session = r.headers.getSetCookie().some(c => c.startsWith('aimeat_rt=') && !/^aimeat_rt=;/.test(c));
    return { status: r.status, location: r.headers.get('location') ?? '', session };
}

/** The same link with its `redirect` replaced, the way a person or a mail filter could edit it. */
function withRedirect(link: string, redirect: string): string {
    const u = new URL(link);
    u.searchParams.set('redirect', redirect);
    return u.toString();
}

// ─── The run ──────────────────────────────────────────────────────────────────

console.log('\n=== The emailed sign-in link returns the person to the place they asked from ===\n');

async function run() {
    smtp = await startFakeSmtp({ port: SMTP_PORT });
    await startNode();

    const stamp = Date.now().toString(36);
    const userName = `mruser${stamp}`;
    const email = `${userName}@aimeat.test`;
    let userToken = '';
    let appOrigin = '';
    const opName = `mrop${stamp}`;
    let opToken = '';

    await test('setup: an operator exists, so the next account is an ordinary one', async () => {
        const reg = await json('/v1/ghii/register-web', {
            method: 'POST',
            body: JSON.stringify({ username: opName, display_name: 'Return Operator', email: `${opName}@aimeat.test` }),
        });
        assert(reg.status === 201, `operator register ${reg.status}: ${JSON.stringify(reg.body).slice(0, 300)}`);
        opToken = await ownerToken(opName, reg.body.data.private_key);
    });

    await test('setup: the person registers and verifies the address, which turns the link on', async () => {
        const reg = await json('/v1/ghii/register-web', {
            method: 'POST',
            body: JSON.stringify({ username: userName, display_name: 'Return User', email }),
        });
        assert(reg.status === 201, `register ${reg.status}: ${JSON.stringify(reg.body).slice(0, 300)}`);
        const mail = await smtp!.waitForMail(email, /\b\d{6}\b/);
        const code = /\b(\d{6})\b/.exec(mail.text)![1];
        const verify = await json('/v1/ghii/verify-email', {
            method: 'POST', body: JSON.stringify({ verification_id: reg.body.data.verification_id, code }),
        });
        assert(verify.status === 200, `verify-email ${verify.status}: ${JSON.stringify(verify.body).slice(0, 300)}`);
        userToken = await ownerToken(userName, reg.body.data.private_key);
    });

    await test('setup: the person publishes an app, and the node gives it an origin of its own', async () => {
        const html = '<!doctype html><html><head><title>Return demo</title></head><body>return demo</body></html>';
        const pub = await json('/v1/apps', {
            method: 'POST', headers: { Authorization: `Bearer ${userToken}` },
            body: JSON.stringify({ filename: 'return-demo.html', content: Buffer.from(html).toString('base64'), name: 'Return Demo', description: 'd', category: 'utility', tags: [] }),
        });
        assert(pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body).slice(0, 300)}`);
        // Opening the app on the apex assigns its subdomain and redirects there.
        const r = await fetch(`${BASE}/v1/apps/${userName}/return-demo.html?mode=inline`, { redirect: 'manual' });
        const loc = r.headers.get('location') ?? '';
        assert(r.status === 301 && loc.includes(`.${APP_HOST}:${PORT}`), `expected a redirect to the app origin, got ${r.status} ${loc}`);
        appOrigin = new URL(loc).origin;
    });

    // ── Asked for with a return address ──

    await test('a link asked for from a page of the node lands on that page, signed in', async () => {
        const link = await askLink(email, '/v1/profile?tab=agents#connect');
        const r = await open(link);
        assert(r.status === 302 && r.location === `${BASE}/v1/profile?tab=agents#connect`,
            `expected ${BASE}/v1/profile?tab=agents#connect, got ${r.status} ${r.location}`);
        assert(r.session, 'the link must open a session');
    });

    await test('a link asked for from inside an app lands back in that app, signed in', async () => {
        const back = `${appOrigin}/?view=board#week`;
        const link = await askLink(email, back);
        const r = await open(link);
        assert(r.status === 302 && r.location === back, `expected ${back}, got ${r.status} ${r.location}`);
        assert(r.session, 'the link must open a session');
    });

    // Secaudit 2026-10, WEB-3: anyone may ask for a link to somebody's address naming any app here, so
    // the address must be the account's own app, or one it holds a grant for.
    await test('a link that names another person\'s app the account never used lands on the front page, signed in', async () => {
        const html = '<!doctype html><html><head><title>Other</title></head><body>other</body></html>';
        const pub = await json('/v1/apps', {
            method: 'POST', headers: { Authorization: `Bearer ${opToken}` },
            body: JSON.stringify({ filename: 'other-demo.html', content: Buffer.from(html).toString('base64'), name: 'Other', description: 'd', category: 'utility', tags: [] }),
        });
        assert(pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body).slice(0, 300)}`);
        const r0 = await fetch(`${BASE}/v1/apps/${opName}/other-demo.html?mode=inline`, { redirect: 'manual' });
        const otherOrigin = new URL(r0.headers.get('location') ?? '').origin;
        assert(otherOrigin !== appOrigin && otherOrigin.includes(APP_HOST), `the other app's origin: ${otherOrigin}`);
        const r = await open(await askLink(email, `${otherOrigin}/`));
        assert(r.status === 302 && r.location === `${BASE}/`, `expected the front page, got ${r.status} ${r.location}`);
        assert(r.session, 'the good token still signs the person in');
    });

    await test('a link asked for with no return address still lands on the front page', async () => {
        const r = await open(await askLink(email));
        assert(r.status === 302 && r.location === `${BASE}/`, `expected the front page, got ${r.status} ${r.location}`);
        assert(r.session, 'the link must open a session');
    });

    // ── A foreign address ──

    await test('a link asked for with a foreign URL lands on the front page, and the mail does not carry the URL', async () => {
        const link = await askLink(email, 'https://evil.example/steal');
        assert(!link.includes('evil.example'), `the mail must not carry a foreign address: ${link}`);
        const r = await open(link);
        assert(r.status === 302 && r.location === `${BASE}/`, `expected the front page, got ${r.status} ${r.location}`);
        assert(r.session, 'a good token still signs the person in; only the address is dropped');
    });

    // Each of these is written into a good link after it was sent. The open endpoint is the check
    // that counts, because the link in a person's mailbox is not something the node controls.
    const forged: Array<[string, string]> = [
        ['a foreign https URL', 'https://evil.example/'],
        ['a protocol-relative address', '//evil.example/'],
        ['a backslash the browser reads as a slash', '/\\evil.example'],
        ['a tab the browser drops', '/\t/evil.example'],
        ['a javascript: address', 'javascript:alert(1)'],
        ['an app host subdomain nothing is published at', `http://nothing-here.${APP_HOST}:${PORT}/`],
        ['a subdomain nested under a real app', `http://a.${appOrigin ? new URL(appOrigin).hostname : `x.${APP_HOST}`}:${PORT}/`],
        ['the node itself, lookalike host', `http://127.0.0.1.evil.example:${PORT}/`],
    ];
    for (const [what, value] of forged) {
        await test(`a link edited to carry ${what} lands on the front page`, async () => {
            const link = withRedirect(await askLink(email), value);
            const r = await open(link);
            assert(r.status === 302 && r.location === `${BASE}/`, `expected the front page, got ${r.status} ${r.location}`);
        });
    }

    await test('a real app origin on another port or with a user name in it lands on the front page', async () => {
        const host = new URL(appOrigin).hostname;
        for (const value of [`http://${host}:${PORT + 7}/`, `http://someone@${host}:${PORT}/`, `https://${host}:${PORT}/`]) {
            const r = await open(withRedirect(await askLink(email), value));
            assert(r.status === 302 && r.location === `${BASE}/`, `${value}: expected the front page, got ${r.status} ${r.location}`);
        }
    });

    // ── Whose session it is ──

    await test("the session a link opens is the mailed account's, and it cannot act as another person", async () => {
        // The return address changes where the browser goes, never whose session it carries. The
        // operator is a different person here (the first account); the link's session is refused
        // on the operator's endpoint, whatever address the link returned to.
        const link = await askLink(email, `${appOrigin}/`);
        const r = await fetch(link, { redirect: 'manual', headers: asClient() });
        assert(r.status === 302 && r.headers.get('location') === `${appOrigin}/`, `open: ${r.status} ${r.headers.get('location')}`);
        const cookie = r.headers.getSetCookie().find(c => c.startsWith('aimeat_rt=') && !/^aimeat_rt=;/.test(c));
        assert(!!cookie, 'the link must set the refresh cookie');
        const refresh = await json('/v1/auth/refresh', {
            method: 'POST', headers: { Cookie: cookie!.split(';')[0], 'X-AIMEAT-Refresh': '1' },
        });
        assert(refresh.status === 200, `refresh ${refresh.status}: ${JSON.stringify(refresh.body).slice(0, 300)}`);
        const token = refresh.body.data.token as string;
        const me = await json('/v1/ghii/me', { headers: { Authorization: `Bearer ${token}` } });
        assert(me.status === 200 && me.body.data.ghii === `${userName}@${NODE_ID}`, `me: ${me.status} ${me.body?.data?.ghii}`);
        const asOperator = await json(`/v1/admin/owners/mrop${stamp}/disable`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
        assert(asOperator.status === 403, `the link's session must be refused on the operator's endpoint, got ${asOperator.status}`);
    });

    // ── A refusal is still a refusal ──

    await test('a spent link carrying a good address is refused on the front page, and opens no session', async () => {
        const link = await askLink(email, '/v1/profile');
        const first = await open(link);
        assert(first.location === `${BASE}/v1/profile`, `first open: ${first.location}`);
        const again = await open(link);
        assert(again.status === 302 && again.location === `${BASE}/?auth_error=INVALID_TOKEN`,
            `expected the front page with INVALID_TOKEN, got ${again.status} ${again.location}`);
        assert(!again.session, 'a refused link must not open a session');
    });

    await stopAll();
    console.log(`\nMagic-link return E2E: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(async err => { console.error('Suite crashed:', err); await stopAll(); process.exit(1); });
