/**
 * @file test/e2e-mailbox-push.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Web push, mailbox notification and the two timed notification sweeps, driven over
 *   HTTP against a real HTTPS push receiver and a real SMTP server.
 *
 *   WHY THIS SUITE EXISTS. The shared E2E node runs with AIMEAT_VAPID_PUBLIC_KEY and
 *   AIMEAT_VAPID_PRIVATE_KEY pinned EMPTY (test/run-e2e-server.ts), which is deliberate and right
 *   for a shared instrument -- but it means `createPushService()` returns a service whose `enabled`
 *   is false, `MailboxNotificationService` is never constructed at all
 *   (server-bootstrap/service-init.ts, the personal-nodes + VAPID condition), and
 *   `sweepHeldPushes()` returns on its first line. Every route in front of them answers, so the
 *   sweep was green over code that had never run: the fan-out, the 410 prune, the failure counter,
 *   the quiet-hours arithmetic, the cooldowns and both sweeps. This node has real VAPID keys, a
 *   real SMTP sink and a real push receiver, so each of those is executed and read back.
 *
 *   WHAT IS ASSERTED, AND WHY NOT THE BODY. A push payload is encrypted with the subscription's own
 *   P-256 key (aes128gcm), so nothing here can read what a notification said. What proves the node
 *   did the work is the request around it: the TTL the service asked for, the Content-Encoding, the
 *   VAPID Authorization, and -- for the branches that matter -- what the node did NEXT with the
 *   subscription after the receiver answered 201, 410 or 500.
 *
 *   THE ONE ENDPOINT THAT IS NOT REAL. `services/mailbox-notification.ts` accepts only the five
 *   real push services (fcm, mozilla, windows, apple), so a personal-node subscription cannot point
 *   at this suite's receiver. It points at `e2e-nowhere.fcm.googleapis.com` instead: allowed by the
 *   `endsWith('.' + domain)` half of the allow-list, and a name that resolves nowhere, on or off
 *   the network. The send therefore fails with no statusCode, which is exactly the branch the
 *   failure counter and the max-failures delete live on. Pointing it at the real fcm.googleapis.com
 *   would put a live third-party service in the middle of a test and let it decide, with a 404,
 *   whether the subscription is pruned or counted.
 *
 *   IT RUNS ITS OWN NODE. VAPID keys, SMTP and the two sweep timers are boot-time configuration, so
 *   this spawns a node of its own on 40312 with the SMTP sink on 40313 (both written out here so
 *   the runner's fixedPorts() sees them and keeps this suite in lane 0) and its own SQLite file. That node
 *   is SQLite whichever backend the runner was started with: what is under test is a service, a
 *   template and two timers, and no storage provider changes any of them.
 * @structure
 *   - Phase 0: the node, the SMTP sink, the HTTPS push receiver, three owners
 *   - Phase 1: the sweep owner's fixtures, written first because the timers fire at 60 s and 120 s
 *   - Phase 2: the owner web-push routes (subscribe, list, test, the 410 prune, the 500 keep)
 *   - Phase 3: the mailbox notification service (defaults, disabled, type, quiet hours, cooldown)
 *   - Phase 4: the refusals (cross-owner 403, no credential 401, scope 403)
 *   - Phase 5: the cooldown expiry, the max-failures delete and the email rate limit
 *   - Phase 6: the two sweeps (held pushes at 60 s, the digest email at 120 s)
 * @usage
 *   cd aimeat && pnpm exec node --import tsx test/e2e-mailbox-push.ts
 * @version-history
 *   v1.0.0 -- 2026-09-08 -- Initial.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import * as ed from '@noble/ed25519';
import { startFakeSmtp, type FakeSmtp, type ParsedMail } from './helpers/fake-smtp.js';
import { startFakePushReceiver, type FakePushReceiver } from './helpers/fake-push.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const require = createRequire(import.meta.url);
const webPush = require('web-push') as typeof import('web-push');

const PORT = Number(process.env.E2E_MAILBOX_PUSH_PORT ?? 40312);
const SMTP_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const NODE_ID = 'aimeat-local-001-dev';
const STAMP = Date.now().toString(36).slice(-6);

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) {
        failed++;
        console.error(`  ❌ ${name}: ${(err as Error).message}`);
        if (process.env.E2E_MAILBOX_PUSH_DEBUG) console.error(nodeLog.slice(-4000));
    }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
const short = (v: unknown): string => JSON.stringify(v).slice(0, 300);
const bearer = (t: string): Record<string, string> => ({ Authorization: `Bearer ${t}` });

interface Res { status: number; body: any }
async function json(path: string, opts: RequestInit = {}): Promise<Res> {
    let res: Response | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
            break;
        } catch (err) {
            // Extensions keep mounting for a few seconds after /v1/spec answers, and a connection
            // made in that window is reset. Retrying beats widening the readiness probe.
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
    assert(r.status === 200 && r.body?.data?.token, `owner token for ${owner}: ${r.status} ${short(r.body)}`);
    return r.body.data.token as string;
}

/** Register through the plain door and sign in. */
async function registerOwner(username: string): Promise<string> {
    const reg = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username, display_name: `Mailbox Push ${username}`, password: 'MbxPush1234' }),
    });
    assert(reg.status === 201, `register ${username}: ${reg.status} ${short(reg.body)}`);
    return ownerToken(username, reg.body.data.private_key);
}

/**
 * A real browser subscription: an uncompressed P-256 public point and sixteen random bytes, both
 * base64url. web-push derives the content encryption key from these, so a placeholder string is
 * rejected before a byte is sent and no branch of services/push.ts is reached.
 */
function browserKeys(): { p256dh: string; auth: string } {
    const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const spki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
    return {
        p256dh: spki.subarray(spki.length - 65).toString('base64url'),
        auth: randomBytes(16).toString('base64url'),
    };
}

const utcMinutes = (d = new Date()): number => d.getUTCHours() * 60 + d.getUTCMinutes();
const hhmm = (minutes: number): string => {
    const m = ((minutes % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

// ─── The node, the sink and the receiver ──────────────────────────────────────

let node: ChildProcess | null = null;
let nodeLog = '';
let smtp: FakeSmtp | null = null;
let rx: FakePushReceiver | null = null;
let bootedAt = 0;
const dbDir = mkdtempSync(join(tmpdir(), 'aimeat-mbxpush-'));
const vapid = webPush.generateVAPIDKeys();

async function startNode(): Promise<void> {
    node = spawn('node', ['--import', 'tsx', 'src/index.ts', 'start', '--db', 'sqlite', '--db-path', join(dbDir, 'mailbox-push.db'), '--port', String(PORT)], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            AIMEAT_PORT: String(PORT),
            AIMEAT_BASE_URL: BASE,
            AIMEAT_NODE_ID: NODE_ID,
            AIMEAT_NODE_TYPE: 'full',
            AIMEAT_STORAGE: 'sqlite',
            AIMEAT_SQLITE_PATH: join(dbDir, 'mailbox-push.db'),
            DATABASE_URL: '',

            // The whole point: a node that can actually sign and send a web push.
            AIMEAT_PUSH_ENABLED: 'true',
            AIMEAT_VAPID_PUBLIC_KEY: vapid.publicKey,
            AIMEAT_VAPID_PRIVATE_KEY: vapid.privateKey,
            AIMEAT_VAPID_SUBJECT: 'mailto:admin@aimeat.example.com',
            // Large enough that the cooldown branch is provable, small enough that the last phase
            // can wait it out: the DEFAULT preferences carry 1000 minutes, and the node's stored
            // preferences are patched down to 1 for the arc that has to see it expire.
            AIMEAT_PUSH_COOLDOWN_MIN: '1000',
            AIMEAT_PUSH_MAX_FAILURES: '2',
            AIMEAT_EMAIL_RATE_LIMIT_MIN: '1000',

            // A real SMTP server in this process, authenticating, so the mailbox email channel and
            // the digest sweep both send for real.
            AIMEAT_SMTP_HOST: '127.0.0.1',
            AIMEAT_SMTP_PORT: String(SMTP_PORT),
            AIMEAT_SMTP_SECURE: 'false',
            AIMEAT_SMTP_REJECT_UNAUTHORIZED: 'false',
            AIMEAT_SMTP_USER: 'aimeat-test',
            AIMEAT_SMTP_PASS: 'aimeat-test-secret',
            AIMEAT_SMTP_FROM: 'AIMEAT Test <noreply@aimeat.test>',

            // The receiver is a throwaway loopback sink with a certificate this node has never
            // seen. What is under test is what the node SENT, never who it trusted.
            NODE_TLS_REJECT_UNAUTHORIZED: '0',

            AIMEAT_PERSONAL_NODES_ENABLED: 'true',
            AIMEAT_DEFAULT_AGENT_SCOPES: '*',
            AIMEAT_ANONYMOUS: 'true',
            AIMEAT_ANONYMOUS_MODE: 'true',
            AIMEAT_TEST_MODE: 'true',
            AIMEAT_DEV_MODE: 'true',
            AIMEAT_ALLOW_PRIVATE_EGRESS: 'true',
            AIMEAT_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
            AIMEAT_LOGIN_TARPIT_ENABLED: 'false',
            AIMEAT_LOGIN_RATE_LIMIT_MAX: '1000',
            AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000',
            AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000',
            AIMEAT_RL_MEMORY: '1000', AIMEAT_RL_BOARDS: '1000',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    node.stdout?.on('data', c => { nodeLog += c.toString(); });
    node.stderr?.on('data', c => { nodeLog += c.toString(); });
    const start = Date.now();
    while (Date.now() - start < 90_000) {
        try { const r = await fetch(`${BASE}/v1/spec`); if (r.ok) { bootedAt = Date.now(); return; } } catch { /* booting */ }
        await sleep(300);
    }
    throw new Error(`node did not start\n--- node output ---\n${nodeLog.slice(-3000)}`);
}

async function stopAll(): Promise<void> {
    if (node) {
        const dying = node;
        node = null;
        dying.kill();
        // The coverage preload defers the signal and gives the node a few seconds to write its
        // snapshot. Exiting before it has is how a measured run loses the measure.
        await Promise.race([once(dying, 'exit'), sleep(15_000)]);
    }
    if (smtp) { await smtp.close(); smtp = null; }
    if (rx) { await rx.close(); rx = null; }
    try { rmSync(dbDir, { recursive: true, force: true }); } catch { /* the OS will get it */ }
}

/** Milliseconds since /v1/spec first answered: the clock the two sweep timers run on. */
const sinceBoot = (): number => Date.now() - bootedAt;

// ─── The run ──────────────────────────────────────────────────────────────────

console.log('\n=== Mailbox push, web push and the notification sweeps ===\n');

const ownerA = `mbxa${STAMP}`;                 // the node's first owner, therefore the operator
const ownerB = `mbxb${STAMP}`;                 // a second owner, for the cross-owner refusals
const sweepOwner = `mbxs${STAMP}`;             // the owner the two timed sweeps act on
const sweepEmail = `${sweepOwner}@aimeat.test`;
const mailboxEmail = `mbxbox${STAMP}@aimeat.test`;
const personalNodeId = `personal-mbx-${STAMP}`;   // AnchorRequestSchema pins the `personal-` prefix

/** When the mailbox cooldown was set, so phase 5 waits the remainder rather than a flat minute. */
let cooldownSetAt = 0;

async function run(): Promise<void> {
    smtp = await startFakeSmtp({ port: SMTP_PORT, requireAuth: true });
    rx = await startFakePushReceiver();
    await startNode();

    let tokenA = '';
    let tokenB = '';
    let sweepToken = '';
    const sweepPath = `/sweep-${STAMP}`;
    const okPath = `/dev-ok-${STAMP}`;
    const gonePath = `/gone/dev-${STAMP}`;
    const boomPath = `/boom/dev-${STAMP}`;
    const mailboxEndpoint = `https://e2e-nowhere.fcm.googleapis.com/wp/${randomUUID()}`;
    let mailboxSubId = '';

    console.log('Phase 0 — the node, the sink, the receiver, the owners');

    await test('the node came up with push and email both configured', async () => {
        const key = await json('/v1/push/vapid-key');
        assert(key.status === 200, `vapid-key ${key.status}: ${short(key.body)}`);
        assert(key.body.data.vapidPublicKey === vapid.publicKey,
            'the node must serve the VAPID public key this suite generated, or nothing it signs is ours');
        tokenA = await registerOwner(ownerA);
        tokenB = await registerOwner(ownerB);
        const rolesOf = (t: string): string[] => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).roles ?? [];
        assert(rolesOf(tokenA).includes('operator'), `owner A should be the bootstrap operator: ${short(rolesOf(tokenA))}`);
        assert(!rolesOf(tokenB).includes('operator'), `owner B must NOT be an operator: ${short(rolesOf(tokenB))}`);
    });

    // ── Phase 1 ── The sweep fixtures go in FIRST. sweepHeldPushes fires 60 s after boot and
    // sweepNotificationDigests 120 s (server-bootstrap/service-init.ts), each once and then on a
    // five-minute / one-hour interval. Data written after the first shot waits for the next one,
    // which is longer than this suite is allowed to take.
    console.log('\nPhase 1 — the sweep owner, written before the 60 s and 120 s timers fire');

    await test('the sweep owner registers through the web door and verifies its address', async () => {
        const reg = await json('/v1/ghii/register-web', {
            method: 'POST',
            body: JSON.stringify({ username: sweepOwner, display_name: 'Sweep Owner', email: sweepEmail }),
        });
        assert(reg.status === 201, `register-web ${reg.status}: ${short(reg.body)}`);
        sweepToken = await ownerToken(sweepOwner, reg.body.data.private_key);
        const mail: ParsedMail = await smtp!.waitForMail(sweepEmail, /\b\d{6}\b/);
        const code = /\b(\d{6})\b/.exec(mail.text)?.[1];
        assert(typeof code === 'string' && code.length === 6, `no six-digit code in the message: ${mail.text.slice(0, 300)}`);
        const verify = await json('/v1/ghii/verify-email', {
            method: 'POST',
            body: JSON.stringify({ verification_id: reg.body.data.verification_id, code }),
        });
        assert(verify.status === 200, `verify-email ${verify.status}: ${short(verify.body)}`);
        // The digest sweep sends only to an address the account has PROVEN, so this is the
        // precondition for phase 6 rather than a test of registration.
        assert(verify.body.data.verification_level === 1, `expected level 1, got ${verify.body.data.verification_level}`);
    });

    await test('a bell notification through the public door, before any device is registered', async () => {
        // Created first on purpose: notify() mirrors a new notification to the owner's devices, so
        // a subscription registered before this would receive a push that phase 6 could not tell
        // apart from the sweep's. This one is also the control for the digest: it is younger than
        // the digest's cutoff and must NOT appear in the mail.
        const r = await json('/v1/notifications', {
            method: 'POST', headers: bearer(sweepToken),
            body: JSON.stringify({ title: 'Fresh, and too young for the digest', body: 'created now', type: 'report' }),
        });
        assert(r.status === 201, `create notification ${r.status}: ${short(r.body)}`);
        assert(r.body.data.created === true, `stored: ${short(r.body.data)}`);
    });

    await test('the sweep owner registers the device the held-push sweep will reach', async () => {
        const r = await json('/v1/push/subscribe', {
            method: 'POST', headers: bearer(sweepToken),
            body: JSON.stringify({ endpoint: rx!.endpoint(sweepPath), keys: browserKeys() }),
        });
        assert(r.status === 201, `subscribe ${r.status}: ${short(r.body)}`);
        assert(rx!.hitsFor(sweepPath).length === 0, 'registering a device must not itself send anything');
    });

    await test('two notifications held during quiet hours, and a settings record that asks for a digest', async () => {
        // The quiet window ENDED a minute ago, so quietJustEnded() is true for the six minutes the
        // sweep looks back over, which covers the 60 s shot with room to spare.
        const cur = utcMinutes();
        const settings = {
            groups: {}, senders: {},
            quiet: { start: hhmm(cur - 61), end: hhmm(cur - 1), tz: 'UTC', breakthrough: [] },
            throttleMinutes: 0,
            emailDigest: { enabled: true, afterHours: 1 },
            email: { workflowEnd: true },
            lastDigestAt: null,
        };
        const w = await json('/v1/memory', {
            method: 'POST', headers: bearer(sweepToken),
            body: JSON.stringify({ key: 'notifications.settings', value: settings, visibility: 'private', tags: ['settings'] }),
        });
        // 201 rather than 200: POST /v1/memory answers 200 only when it overwrote an existing key,
        // and nothing has written this owner's settings record yet.
        assert(w.status === 201, `settings write ${w.status}: ${short(w.body)}`);

        // Two notifications old enough to be past the digest's one-hour cutoff and marked held, so
        // one arc of fixtures drives both sweeps.
        const old = new Date(Date.now() - 2 * 3_600_000).toISOString();
        for (const tag of ['aaaaaaaa', 'bbbbbbbb']) {
            const value = {
                id: `${tag}-${STAMP}`, type: 'report', title: `Held while quiet (${tag})`,
                body: 'waited for the morning', link: '', actions: [], read: false, held: true, createdAt: old,
            };
            const n = await json('/v1/memory', {
                method: 'POST', headers: bearer(sweepToken),
                body: JSON.stringify({ key: `notif.${old}.${tag}`, value, visibility: 'private', tags: ['notif'], ttl_hours: 24 }),
            });
            assert(n.status === 201, `held notification write ${n.status}: ${short(n.body)}`);
        }
        const list = await json('/v1/notifications', { headers: bearer(sweepToken) });
        assert(list.status === 200, `list ${list.status}`);
        // Count nothing: registering through the web door leaves its own notifications behind, and
        // what matters is that these three are readable and that the two are marked held.
        const held = (list.body.data.notifications as Array<{ title: string; held?: boolean }>)
            .filter(n => n.title.startsWith('Held while quiet'));
        assert(held.length === 2, `both held notifications must be readable: ${short(list.body.data.notifications)}`);
        assert(held.every(n => n.held === true), `both must still carry the held mark: ${short(held)}`);
    });

    // ── Phase 2 ── services/push.ts and routes/push.ts, on owner A.
    console.log('\nPhase 2 — the owner web-push routes');

    await test('POST /v1/push/subscribe registers two devices, and the list shows both', async () => {
        const first = await json('/v1/push/subscribe', {
            method: 'POST', headers: bearer(tokenA),
            body: JSON.stringify({ endpoint: rx!.endpoint(okPath), keys: browserKeys() }),
        });
        assert(first.status === 201, `subscribe ok-device ${first.status}: ${short(first.body)}`);
        assert(first.body.data.subscription.ownerName === ownerA, `owner: ${first.body.data.subscription.ownerName}`);
        const second = await json('/v1/push/subscribe', {
            method: 'POST', headers: bearer(tokenA),
            body: JSON.stringify({ endpoint: rx!.endpoint(gonePath), keys: browserKeys() }),
        });
        assert(second.status === 201, `subscribe gone-device ${second.status}: ${short(second.body)}`);
        const list = await json('/v1/push/subscriptions', { headers: bearer(tokenA) });
        assert(list.status === 200 && list.body.data.total === 2,
            `a second device must JOIN the first, not replace it: ${short(list.body.data)}`);
    });

    await test('POST /v1/push/subscribe refuses an endpoint validateOutboundUrl rejects', async () => {
        // Loopback is allowed on this node (AIMEAT_ALLOW_PRIVATE_EGRESS), link-local never is: the
        // cloud metadata address is the case the guard was written for.
        const r = await json('/v1/push/subscribe', {
            method: 'POST', headers: bearer(tokenA),
            body: JSON.stringify({ endpoint: 'http://169.254.169.254/latest/meta-data/', keys: browserKeys() }),
        });
        assert(r.status === 400, `expected 400, got ${r.status}: ${short(r.body)}`);
        assert(r.body.error?.code === 'INVALID_ENDPOINT', `expected INVALID_ENDPOINT, got ${r.body.error?.code}`);
        const list = await json('/v1/push/subscriptions', { headers: bearer(tokenA) });
        assert(list.body.data.total === 2, `the refusal must not have stored anything: ${short(list.body.data)}`);
    });

    await test('POST /v1/push/test fans out to every device, encrypted and signed', async () => {
        const r = await json('/v1/push/test', { method: 'POST', headers: bearer(tokenA), body: '{}' });
        assert(r.status === 200 && r.body.data.sent === true, `test push ${r.status}: ${short(r.body)}`);
        const ok = await rx!.waitForHit(okPath);
        const gone = await rx!.waitForHit(gonePath);
        for (const [label, hit] of [['ok device', ok], ['gone device', gone]] as const) {
            assert(hit.method === 'POST', `${label}: method ${hit.method}`);
            assert(hit.ttl === '86400', `${label}: services/push.ts asks for TTL 86400, got ${hit.ttl}`);
            // aes128gcm is RFC 8291, which is what web-push 3.x emits. Named exactly, so that a
            // library change back to the draft `aesgcm` encoding is a failure rather than a shrug.
            assert(hit.contentEncoding === 'aes128gcm',
                `${label}: the payload must be encrypted, Content-Encoding was ${hit.contentEncoding}`);
            assert(hit.authorization.startsWith('vapid'), `${label}: no VAPID signature: ${hit.authorization}`);
            assert(hit.bytes > 0, `${label}: an empty body is not an encrypted payload`);
        }
    });

    await test('a 410 prunes THAT endpoint and leaves the working device alone', async () => {
        const list = await json('/v1/push/subscriptions', { headers: bearer(tokenA) });
        assert(list.body.data.total === 1, `the gone device should be pruned: ${short(list.body.data)}`);
        assert(list.body.data.subscriptions[0].endpoint === rx!.endpoint(okPath),
            `the surviving device must be the one that answered 201: ${short(list.body.data.subscriptions)}`);
    });

    await test('a 500 is warned about and the device is KEPT', async () => {
        const sub = await json('/v1/push/subscribe', {
            method: 'POST', headers: bearer(tokenA),
            body: JSON.stringify({ endpoint: rx!.endpoint(boomPath), keys: browserKeys() }),
        });
        assert(sub.status === 201, `subscribe boom-device ${sub.status}: ${short(sub.body)}`);
        const r = await json('/v1/push/test', { method: 'POST', headers: bearer(tokenA), body: '{}' });
        // One device accepted it, so the route still reports a send: delivery is per device.
        assert(r.status === 200 && r.body.data.sent === true, `test push ${r.status}: ${short(r.body)}`);
        await rx!.waitForHit(boomPath);
        const list = await json('/v1/push/subscriptions', { headers: bearer(tokenA) });
        assert(list.body.data.total === 2,
            `a 500 says nothing about the registration, so it must be kept: ${short(list.body.data)}`);
        assert(rx!.hitsFor(okPath).length === 2, `the healthy device received both sends: ${rx!.hitsFor(okPath).length}`);
    });

    await test('POST /v1/push/test answers 404 when the owner has no device at all', async () => {
        const r = await json('/v1/push/test', { method: 'POST', headers: bearer(tokenB), body: '{}' });
        assert(r.status === 404, `expected 404 for an owner with no subscription, got ${r.status}: ${short(r.body)}`);
    });

    // ── Phase 3 ── services/mailbox-notification.ts, on owner A's personal node.
    console.log('\nPhase 3 — the mailbox notification service');

    await test('the personal node is anchored, and its preferences start as the node defaults', async () => {
        const anchor = await json('/v1/personal/anchor', {
            method: 'POST', headers: bearer(tokenA),
            body: JSON.stringify({
                node_id: personalNodeId, owner_name: ownerA, public_key: 'test-key-base64',
                agent_gaiis: [], visibility: 'private',
            }),
        });
        assert(anchor.status === 201, `anchor ${anchor.status}: ${short(anchor.body)}`);
        const prefs = await json(`/v1/personal/anchor/${encodeURIComponent(personalNodeId)}/notifications`, { headers: bearer(tokenA) });
        assert(prefs.status === 200, `prefs ${prefs.status}: ${short(prefs.body)}`);
        assert(prefs.body.data.is_default === true, 'nothing is stored yet, so these must be the defaults');
        assert(prefs.body.data.cooldown_minutes === 1000, `AIMEAT_PUSH_COOLDOWN_MIN must reach the defaults: ${prefs.body.data.cooldown_minutes}`);
        assert(JSON.stringify(prefs.body.data.channels) === '["web_push"]', `channels: ${short(prefs.body.data.channels)}`);
        assert(prefs.body.data.notify_types.includes('action_request'), `notify_types: ${short(prefs.body.data.notify_types)}`);
    });

    await test('with no preferences record and no device, notify() runs on defaultPreferences', async () => {
        const r = await json(`/v1/personal/push/test/${encodeURIComponent(personalNodeId)}`, { method: 'POST', headers: bearer(tokenA), body: '{}' });
        assert(r.status === 200, `test ${r.status}: ${short(r.body)}`);
        assert(r.body.data.test_sent === false, `nothing to send to: ${short(r.body.data)}`);
        assert(r.body.data.reason === null, `the defaults let it through to the channels, so no reason: ${r.body.data.reason}`);
    });

    await test('enabled:false stops it before anything else', async () => {
        const patch = await json(`/v1/personal/anchor/${encodeURIComponent(personalNodeId)}/notifications`, {
            method: 'PATCH', headers: bearer(tokenA), body: JSON.stringify({ enabled: false }),
        });
        assert(patch.status === 200 && patch.body.data.enabled === false, `patch ${patch.status}: ${short(patch.body)}`);
        const r = await json(`/v1/personal/push/test/${encodeURIComponent(personalNodeId)}`, { method: 'POST', headers: bearer(tokenA), body: '{}' });
        assert(r.body.data.reason === 'notifications_disabled', `reason: ${short(r.body.data)}`);
    });

    await test('a type the owner did not ask for is dropped', async () => {
        const patch = await json(`/v1/personal/anchor/${encodeURIComponent(personalNodeId)}/notifications`, {
            method: 'PATCH', headers: bearer(tokenA), body: JSON.stringify({ enabled: true, notifyTypes: ['work_assignment'] }),
        });
        assert(patch.status === 200, `patch ${patch.status}: ${short(patch.body)}`);
        // The test item this route synthesises is an 'action_request'.
        const r = await json(`/v1/personal/push/test/${encodeURIComponent(personalNodeId)}`, { method: 'POST', headers: bearer(tokenA), body: '{}' });
        assert(r.body.data.reason === 'type_not_configured', `reason: ${short(r.body.data)}`);
    });

    await test('quiet hours hold it, in both the non-wrapping and the wrapping form', async () => {
        // isInQuietHours has two arms and they are chosen by start <= end. Both windows below are
        // built around the current UTC minute so each arm is genuinely entered.
        if (utcMinutes() === 1439) {
            // 23:59 UTC is the one minute of the day no non-wrapping window can contain, because
            // the check is `cur < end` and end cannot exceed 23:59. Roll past midnight.
            await sleep(61_000);
        }
        const base = { enabled: true, notifyTypes: ['work_assignment', 'action_request'] };

        const nonWrapping = { start: '00:00', end: hhmm(utcMinutes() + 1) };
        let patch = await json(`/v1/personal/anchor/${encodeURIComponent(personalNodeId)}/notifications`, {
            method: 'PATCH', headers: bearer(tokenA), body: JSON.stringify({ ...base, quietHoursUtc: nonWrapping }),
        });
        assert(patch.status === 200, `patch non-wrapping ${patch.status}: ${short(patch.body)}`);
        let r = await json(`/v1/personal/push/test/${encodeURIComponent(personalNodeId)}`, { method: 'POST', headers: bearer(tokenA), body: '{}' });
        assert(r.body.data.reason === 'quiet_hours', `non-wrapping ${JSON.stringify(nonWrapping)}: ${short(r.body.data)}`);

        const cur = utcMinutes();
        const wrapping = cur >= 1 ? { start: hhmm(cur), end: hhmm(cur - 1) } : { start: '00:02', end: '00:01' };
        patch = await json(`/v1/personal/anchor/${encodeURIComponent(personalNodeId)}/notifications`, {
            method: 'PATCH', headers: bearer(tokenA), body: JSON.stringify({ ...base, quietHoursUtc: wrapping }),
        });
        assert(patch.status === 200, `patch wrapping ${patch.status}: ${short(patch.body)}`);
        r = await json(`/v1/personal/push/test/${encodeURIComponent(personalNodeId)}`, { method: 'POST', headers: bearer(tokenA), body: '{}' });
        assert(r.body.data.reason === 'quiet_hours', `wrapping ${JSON.stringify(wrapping)}: ${short(r.body.data)}`);
    });

    await test('the personal push allow-list refuses this suite\'s own receiver and a malformed URL', async () => {
        const loopback = await json('/v1/personal/push/subscribe', {
            method: 'POST', headers: bearer(tokenA),
            body: JSON.stringify({ personalNodeId, endpoint: rx!.endpoint('/should-never-be-stored'), keys: browserKeys() }),
        });
        assert(loopback.status === 400, `loopback endpoint ${loopback.status}: ${short(loopback.body)}`);
        assert(/domain is not allowed/i.test(String(loopback.body.error?.message)),
            `the allow-list is what must refuse it, not the shape check: ${short(loopback.body.error)}`);

        const malformed = await json('/v1/personal/push/subscribe', {
            method: 'POST', headers: bearer(tokenA),
            body: JSON.stringify({ personalNodeId, endpoint: 'not a url at all', keys: browserKeys() }),
        });
        assert(malformed.status === 400, `malformed endpoint ${malformed.status}: ${short(malformed.body)}`);
        assert(/domain is not allowed/i.test(String(malformed.body.error?.message)),
            `new URL() throwing IS the answer here: ${short(malformed.body.error)}`);
    });

    await test('an fcm endpoint is accepted, and one send later it is counted as failed', async () => {
        const sub = await json('/v1/personal/push/subscribe', {
            method: 'POST', headers: bearer(tokenA),
            body: JSON.stringify({ personalNodeId, endpoint: mailboxEndpoint, keys: browserKeys() }),
        });
        assert(sub.status === 201, `fcm subscribe ${sub.status}: ${short(sub.body)}`);
        mailboxSubId = sub.body.data.id as string;
        const list = await json(`/v1/personal/push/subscriptions/${encodeURIComponent(personalNodeId)}`, { headers: bearer(tokenA) });
        assert(list.body.data.total === 1, `one subscription expected: ${short(list.body.data)}`);
        assert(list.body.data.subscriptions[0].failure_count === 0, `starts clean: ${short(list.body.data.subscriptions[0])}`);
    });

    await test('web push fails, email succeeds, and the mail says what is waiting', async () => {
        const patch = await json(`/v1/personal/anchor/${encodeURIComponent(personalNodeId)}/notifications`, {
            method: 'PATCH', headers: bearer(tokenA),
            body: JSON.stringify({
                enabled: true, quietHoursUtc: null, cooldownMinutes: 1,
                channels: ['web_push', 'email'], email: mailboxEmail,
                notifyTypes: ['work_assignment', 'action_request'],
            }),
        });
        assert(patch.status === 200, `patch ${patch.status}: ${short(patch.body)}`);
        const r = await json(`/v1/personal/push/test/${encodeURIComponent(personalNodeId)}`, { method: 'POST', headers: bearer(tokenA), body: '{}' });
        assert(r.status === 200, `test ${r.status}: ${short(r.body)}`);
        assert(r.body.data.test_sent === true, `the email channel carried it: ${short(r.body.data)}`);
        assert(r.body.data.channel === 'email', `only email can have succeeded: ${short(r.body.data)}`);
        cooldownSetAt = Date.now();   // notify() stamps its cooldown on a send that succeeded
        const mail = await smtp!.waitForMail(mailboxEmail, /pending message/i);
        assert(/AIMEAT: 0 pending message\(s\) for your node/.test(mail.subject),
            `the email_mailbox template subject: ${mail.subject}`);
        assert(mail.text.includes(personalNodeId), `the mail must name the node: ${mail.text.slice(0, 300)}`);
        assert(mail.text.includes('action_request'), `and the type that triggered it: ${mail.text.slice(0, 300)}`);
        const list = await json(`/v1/personal/push/subscriptions/${encodeURIComponent(personalNodeId)}`, { headers: bearer(tokenA) });
        assert(list.body.data.subscriptions[0].failure_count === 1,
            `the unreachable endpoint must be counted, not deleted: ${short(list.body.data.subscriptions[0])}`);
    });

    await test('a second call inside the cooldown window is refused before any channel', async () => {
        const r = await json(`/v1/personal/push/test/${encodeURIComponent(personalNodeId)}`, { method: 'POST', headers: bearer(tokenA), body: '{}' });
        assert(r.body.data.reason === 'cooldown_active', `reason: ${short(r.body.data)}`);
        assert(r.body.data.test_sent === false, `nothing was sent: ${short(r.body.data)}`);
        const list = await json(`/v1/personal/push/subscriptions/${encodeURIComponent(personalNodeId)}`, { headers: bearer(tokenA) });
        assert(list.body.data.subscriptions[0].failure_count === 1,
            `the cooldown returns before sendWebPush, so the counter must not move: ${short(list.body.data.subscriptions[0])}`);
    });

    // ── Phase 4 ── The refusals.
    console.log('\nPhase 4 — the refusals');

    await test('a second owner is refused every personal push door with 403', async () => {
        const url = `/v1/personal/push/test/${encodeURIComponent(personalNodeId)}`;
        const t = await json(url, { method: 'POST', headers: bearer(tokenB), body: '{}' });
        assert(t.status === 403, `cross-owner test push must be 403, got ${t.status}: ${short(t.body)}`);
        assert(t.body.error?.code === 'FORBIDDEN', `expected FORBIDDEN, got ${t.body.error?.code}`);

        const sub = await json('/v1/personal/push/subscribe', {
            method: 'POST', headers: bearer(tokenB),
            body: JSON.stringify({ personalNodeId, endpoint: 'https://fcm.googleapis.com/wp/stolen', keys: browserKeys() }),
        });
        assert(sub.status === 403, `cross-owner subscribe must be 403, got ${sub.status}: ${short(sub.body)}`);

        const list = await json(`/v1/personal/push/subscriptions/${encodeURIComponent(personalNodeId)}`, { headers: bearer(tokenB) });
        assert(list.status === 403, `cross-owner list must be 403, got ${list.status}: ${short(list.body)}`);

        const prefs = await json(`/v1/personal/anchor/${encodeURIComponent(personalNodeId)}/notifications`, {
            method: 'PATCH', headers: bearer(tokenB), body: JSON.stringify({ enabled: false }),
        });
        assert(prefs.status === 403, `cross-owner preference change must be 403, got ${prefs.status}: ${short(prefs.body)}`);

        const del = await json(`/v1/personal/push/subscribe/${encodeURIComponent(mailboxSubId)}`, { method: 'DELETE', headers: bearer(tokenB) });
        assert(del.status === 403, `cross-owner subscription delete must be 403, got ${del.status}: ${short(del.body)}`);

        // The refusals were real: owner A's node still has its one subscription and is still on.
        const still = await json(`/v1/personal/push/subscriptions/${encodeURIComponent(personalNodeId)}`, { headers: bearer(tokenA) });
        assert(still.body.data.total === 1, `owner B must not have changed anything: ${short(still.body.data)}`);
    });

    await test('no credential is 401 on every one of those doors', async () => {
        const doors: Array<[string, RequestInit]> = [
            [`/v1/personal/push/test/${encodeURIComponent(personalNodeId)}`, { method: 'POST', body: '{}' }],
            ['/v1/personal/push/subscribe', { method: 'POST', body: JSON.stringify({ personalNodeId, endpoint: 'https://fcm.googleapis.com/wp/x', keys: browserKeys() }) }],
            [`/v1/personal/push/subscriptions/${encodeURIComponent(personalNodeId)}`, {}],
            ['/v1/push/subscribe', { method: 'POST', body: JSON.stringify({ endpoint: 'https://fcm.googleapis.com/wp/x', keys: browserKeys() }) }],
            ['/v1/push/test', { method: 'POST', body: '{}' }],
            ['/v1/push/subscriptions', {}],
        ];
        for (const [path, opts] of doors) {
            const r = await json(path, opts);
            assert(r.status === 401, `${path} with no credential must be 401, got ${r.status}: ${short(r.body)}`);
        }
    });

    await test('a token without push:manage is refused the web-push routes with 403', async () => {
        const anon = await json('/v1/auth/anonymous', { method: 'POST', body: '{}' });
        assert(anon.status === 200, `anonymous token ${anon.status}: ${short(anon.body)}`);
        const token = anon.body.data.token as string;
        const sub = await json('/v1/push/subscribe', {
            method: 'POST', headers: bearer(token),
            body: JSON.stringify({ endpoint: 'https://fcm.googleapis.com/wp/anon', keys: browserKeys() }),
        });
        assert(sub.status === 403, `subscribe without push:manage must be 403, got ${sub.status}: ${short(sub.body)}`);
        const t = await json('/v1/push/test', { method: 'POST', headers: bearer(token), body: '{}' });
        assert(t.status === 403, `test without push:manage must be 403, got ${t.status}: ${short(t.body)}`);
    });

    // ── Phase 5 ── What happens once the one-minute cooldown has expired.
    console.log('\nPhase 5 — the cooldown expires, and the second failure ends the subscription');

    await test('after the cooldown: the max-failures delete, and the email rate limit returning false', async () => {
        // cooldownMinutes is 1 and it was set at the successful send above; AIMEAT_EMAIL_RATE_LIMIT_MIN
        // is 1000, so this call passes the outer cooldown, fails web push a SECOND time (which is
        // AIMEAT_PUSH_MAX_FAILURES) and finds the email channel still rate-limited.
        const wait = 63_000 - (Date.now() - cooldownSetAt);
        if (wait > 0) await sleep(wait);
        const before = smtp!.mailTo(mailboxEmail).length;
        const r = await json(`/v1/personal/push/test/${encodeURIComponent(personalNodeId)}`, { method: 'POST', headers: bearer(tokenA), body: '{}' });
        assert(r.status === 200, `test ${r.status}: ${short(r.body)}`);
        assert(r.body.data.reason !== 'cooldown_active', `the cooldown should have expired: ${short(r.body.data)}`);
        assert(r.body.data.test_sent === false, `both channels must have declined: ${short(r.body.data)}`);
        const list = await json(`/v1/personal/push/subscriptions/${encodeURIComponent(personalNodeId)}`, { headers: bearer(tokenA) });
        assert(list.body.data.total === 0,
            `the second failure reaches AIMEAT_PUSH_MAX_FAILURES, so the subscription is deleted: ${short(list.body.data)}`);
        assert(smtp!.mailTo(mailboxEmail).length === before,
            `the email rate limit must return before sendMail, so no second message: ${smtp!.mailTo(mailboxEmail).length} vs ${before}`);
    });

    // ── Phase 6 ── The two timers.
    console.log('\nPhase 6 — the held-push sweep (60 s) and the digest sweep (120 s)');

    await test('sweepHeldPushes sends the held notifications as one push once quiet hours end', async () => {
        const hit = await rx!.waitForHit(sweepPath, Math.max(20_000, 100_000 - sinceBoot()));
        assert(hit.ttl === '86400', `the sweep goes through the same service: TTL ${hit.ttl}`);
        assert(hit.contentEncoding === 'aes128gcm', `Content-Encoding: ${hit.contentEncoding}`);
        // The marks are cleared so the next run five minutes later is silent. The bell entries stay.
        const list = await json('/v1/notifications', { headers: bearer(sweepToken) });
        assert(list.status === 200, `list ${list.status}: ${short(list.body)}`);
        const held = (list.body.data.notifications as Array<{ title: string; held?: boolean }>)
            .filter(n => n.title.startsWith('Held while quiet'));
        assert(held.length === 2, `the sweep clears the held mark, it does not delete: ${short(list.body.data.notifications)}`);
        assert(held.every(n => n.held === false), `the mark must be cleared, so the next run is silent: ${short(held)}`);
    });

    await test('sweepNotificationDigests mails the unread notifications older than the owner asked for', async () => {
        const remaining = Math.max(30_000, 170_000 - sinceBoot());
        const mail = await smtp!.waitForMail(sweepEmail, /notifications waiting for you/, remaining);
        assert(/^2 notifications waiting for you on AIMEAT$/.test(mail.subject),
            `only the two past the one-hour cutoff belong in it: ${mail.subject}`);
        assert(mail.text.includes('Held while quiet (aaaaaaaa)'), `the first held entry: ${mail.text.slice(0, 400)}`);
        assert(mail.text.includes('Held while quiet (bbbbbbbb)'), `the second held entry: ${mail.text.slice(0, 400)}`);
        assert(!mail.text.includes('too young for the digest'),
            'a notification younger than the cutoff must not be in the digest');
        assert(mail.text.includes('/v1/profile?tab=notifications'), `the digest links to the page: ${mail.text.slice(0, 400)}`);
        // lastDigestAt is stamped so the next hourly run sends nothing, and the send is logged.
        const settings = await json('/v1/notifications/settings', { headers: bearer(sweepToken) });
        assert(settings.status === 200, `settings ${settings.status}: ${short(settings.body)}`);
        assert(typeof settings.body.data.settings?.lastDigestAt === 'string',
            `lastDigestAt must be stamped after a digest: ${short(settings.body.data)}`);
    });
}

try {
    await run();
} catch (err) {
    failed++;
    console.error(`\n  ❌ the run itself failed: ${(err as Error).message}`);
    if (process.env.E2E_MAILBOX_PUSH_DEBUG) console.error(nodeLog.slice(-4000));
} finally {
    await stopAll();
}

console.log(`\nMailbox push E2E: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
