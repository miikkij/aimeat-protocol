/**
 * @file e2e-sse.ts
 * @description E2E for the SSE live-update stream (/v1/events). Self-spawns a server with the
 *   app origin enabled so a real app-grant token can be minted, and verifies the three things
 *   that were wrong:
 *     1. The stream OPENS immediately. It used to send nothing until the 30s keepalive, which is
 *        indistinguishable from a hung connection (and reads as "SSE is broken" to anyone
 *        debugging an app).
 *     2. Change domains are SCOPE-GATED for a restricted principal: an app grant holding only
 *        memory scopes is told about `memory` but never about `organisms`.
 *     3. An app-grant stream does NOT mark the owner present. Only a real owner session may.
 * @usage cd aimeat && pnpm exec node --import tsx test/e2e-sse.ts
 * @version-history
 *   v1.4.0 — 2026-10-25 — Phase 1: the 15 s keepalive is `event: alive`, which the shared-stream
 *     failover in public/lib/live-updates.js listens for.
 *   v1.3.0 — 2026-10-18 — Phase 7: a change in one workspace is that workspace's own domain, told to
 *     the organism's members and to nobody else.
 *   2026-10-16 — The node(s) this suite starts follow the run's backend (test/helpers/own-node-db.ts); they were SQLite on both runs (QA audit P1-02).
 *   v1.2.0 — 2026-10-11 — Phase 6: one owner's private record and file are not another owner's
 *     event, a public record still is, and so is the write that takes it private. The last test
 *     of v1.0.0 measured the leak and left it; this closes it.
 *   v1.1.0 — 2026-10-11 — A memory delete reaches the stream as `memory`, which the live library's
 *     description now states and used to deny.
 *   v1.0.0 — 2026-07-25 — Initial, with the SSE open-immediately fix + scope gate.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { waitForServer } from './helpers/wait-for-server.js';
import { ownNodeDb } from './helpers/own-node-db.js';

const PORT = process.env.E2E_SSE_PORT ?? '28268';
const BASE = `http://localhost:${PORT}`;
const APP_HOST = 'apps.aimeat.test';
const NODE_ID = 'aimeat-local-001-dev';
const DB_PATH = resolve(process.cwd(), 'test/.test-sse.db');

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    const setCookie = res.headers.get('set-cookie') ?? '';
    const rt = /aimeat_rt=([^;]+)/.exec(setCookie)?.[1] ?? null;
    return { status: res.status, body, rt };
}

function cleanupDb() {
    for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
        try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ }
    }
}

async function startServer(): Promise<ChildProcess> {
    cleanupDb();
    const db = await ownNodeDb(String(PORT), { sqlitePath: DB_PATH });
    const env = {
        ...process.env, ...db.env, AIMEAT_PORT: PORT, AIMEAT_BASE_URL: BASE, AIMEAT_NODE_ID: NODE_ID,
        AIMEAT_APP_HOST: APP_HOST, AIMEAT_APP_ORIGIN_ENABLED: 'true',
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_MEMORY: '1000',
    };
    const child = spawn('node', [...nodeEntryArgs(), 'start', ...db.args],
        { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    return waitForServer(child, BASE, { label: 'the SSE node' });
}

async function register(username: string): Promise<{ rt: string; token: string }> {
    const pw = 'SsePw#2026';
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username, display_name: username, password: pw }) });
    assert(reg.status === 201, `register ${username}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const login = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username, password: pw }) });
    assert(login.status === 200 && !!login.rt, `login ${username}: ${login.status}`);
    return { rt: login.rt!, token: login.body.data.token };
}

/** Mint an app-grant token for the owner's OWN app with an exact scope (the silent bridge). */
async function appToken(origin: string, scope: string, cookie: string): Promise<string> {
    const res = await fetch(
        `${BASE}/v1/auth/app-grant-silent?origin=${encodeURIComponent(origin)}&scope=${encodeURIComponent(scope)}`,
        { headers: { Cookie: `aimeat_rt=${encodeURIComponent(cookie)}` } });
    const body = await res.json() as any;
    const d = body.data;
    assert(!!d && d.ok === true && !!d.access_token, `app token for ${scope}: ${JSON.stringify(d)}`);
    return d.access_token as string;
}

/** An open SSE stream we can read incrementally and close deterministically. */
interface Stream {
    text(): string;
    /** Resolves once `pred` matches the accumulated text, or rejects after `ms`. */
    waitFor(pred: (t: string) => boolean, ms: number, what: string): Promise<number>;
    close(): void;
    openedAfterMs: number;
}

async function openStream(token: string): Promise<Stream> {
    const t = await json('/v1/events/ticket', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    assert(t.status === 200 && !!t.body.data.ticket, `ticket: ${t.status} ${JSON.stringify(t.body)}`);
    const ctrl = new AbortController();
    const started = Date.now();
    const res = await fetch(`${BASE}/v1/events?ticket=${t.body.data.ticket}`, { signal: ctrl.signal });
    assert(res.status === 200, `stream status ${res.status}`);
    assert((res.headers.get('content-type') ?? '').includes('text/event-stream'), 'content-type must be text/event-stream');

    let buf = '';
    let openedAfterMs = -1;
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    (async () => {
        try {
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                if (value) {
                    buf += dec.decode(value, { stream: true });
                    if (openedAfterMs < 0) openedAfterMs = Date.now() - started;
                }
            }
        } catch { /* aborted on close() */ }
    })();

    const stream: Stream = {
        text: () => buf,
        get openedAfterMs() { return openedAfterMs; },
        async waitFor(pred, ms, what) {
            const deadline = Date.now() + ms;
            while (Date.now() < deadline) {
                if (pred(buf)) return Date.now() - started;
                await new Promise(r => setTimeout(r, 50));
            }
            throw new Error(`timed out after ${ms}ms waiting for ${what}; got: ${JSON.stringify(buf.slice(0, 200))}`);
        },
        close() { ctrl.abort(); },
    };
    return stream;
}

/** The domains delivered so far, flattened from every `data:` frame. */
function domainsSeen(text: string): string[] {
    const out: string[] = [];
    for (const line of text.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try {
            const parsed = JSON.parse(line.slice(6));
            if (Array.isArray(parsed.domains)) out.push(...parsed.domains);
        } catch { /* partial frame */ }
    }
    return out;
}

async function main() {
    const server = await startServer();
    try {
        const user = `sseu${Date.now() % 100000}`;
        console.log('\n=== SSE live-update stream E2E ===\n');
        console.log('Phase 0: Setup (owner + own app on its own subdomain)');
        const A = await register(user);
        const pub = await json('/v1/apps', {
            method: 'POST', headers: { Authorization: `Bearer ${A.token}` },
            body: JSON.stringify({
                filename: 'sse-app.html', content: b64('<!DOCTYPE html><html><body>a</body></html>'),
                name: 'sse-app', description: 'd', category: 'utility',
            }),
        });
        assert(pub.status === 201, `publish: ${pub.status} ${JSON.stringify(pub.body)}`);
        const sub = await json('/v1/admin/subdomains', {
            method: 'POST', headers: { Authorization: `Bearer ${A.token}` },
            body: JSON.stringify({ subdomain: 'ssea', kind: 'app', target: `${user}/sse-app.html` }),
        });
        assert(sub.status === 201, `assign subdomain: ${sub.status} ${JSON.stringify(sub.body)}`);
        const ORIGIN = `https://ssea.${APP_HOST}`;

        console.log('\nPhase 1: The stream opens immediately');
        let owner: Stream | null = null;
        await test('owner stream sends its first bytes in well under a second', async () => {
            owner = await openStream(A.token);
            const at = await owner.waitFor(t => t.includes(':open'), 3_000, 'the :open comment');
            assert(at < 3_000, `first bytes took ${at}ms`);
            assert(owner.text().includes('retry:'), 'a retry hint must be sent so the browser knows the backoff');
        });

        // The tab holding a browser's shared stream relays this keepalive to the other tabs, and a tab
        // that stops hearing it takes the stream over (public/lib/live-updates.js). A comment line is
        // invisible to the page, so it has to be a named event.
        await test('the 15 s keepalive is an "alive" event the page can see', async () => {
            assert(!!owner, 'owner stream open');
            await owner!.waitFor(t => t.includes('event: alive\ndata: {}\n\n'), 18_000, 'the alive event');
            assert(!owner!.text().includes(':keepalive'), 'the keepalive is no longer a comment line');
        });

        console.log('\nPhase 2: The owner sees their own changes');
        await test('a memory write is reported as the "memory" domain', async () => {
            assert(!!owner, 'owner stream open');
            const w = await json('/v1/memory', {
                method: 'POST', headers: { Authorization: `Bearer ${A.token}` },
                body: JSON.stringify({ key: 'sse.probe.owner', value: { at: 1 }, visibility: 'private' }),
            });
            assert(w.status === 200 || w.status === 201, `memory write: ${w.status}`);
            await owner!.waitFor(t => domainsSeen(t).includes('memory'), 6_000, 'the memory domain');
        });

        // The live library's description said "Deletes do not emit a change event" until 2026-10-11.
        // It says now that a delete emits its domain as a write does, and this holds it to that for
        // the record an app deletes most. The stream coalesces for a second, so the write's frame is
        // let through first and the delete has to produce a frame of its own.
        await test('a memory delete is reported as the "memory" domain too', async () => {
            assert(!!owner, 'owner stream open');
            await new Promise(r => setTimeout(r, 2_500));
            const before = domainsSeen(owner!.text()).filter(d => d === 'memory').length;
            const d = await json('/v1/memory/sse.probe.owner', { method: 'DELETE', headers: { Authorization: `Bearer ${A.token}` } });
            assert(d.status === 200, `memory delete: ${d.status} ${JSON.stringify(d.body)}`);
            await owner!.waitFor(t => domainsSeen(t).filter(x => x === 'memory').length > before, 6_000, 'a memory frame after the delete');
        });

        console.log('\nPhase 3: Scope gate — an app grant is told only what its scopes cover');
        let app: Stream | null = null;
        await test('app-grant stream (memory scopes only) opens', async () => {
            const tok = await appToken(ORIGIN, 'memory:read memory:write', A.rt);
            app = await openStream(tok);
            await app.waitFor(t => t.includes(':open'), 3_000, 'the :open comment');
        });
        await test('an organism change reaches the OWNER stream but never the app stream', async () => {
            assert(!!owner && !!app, 'both streams open');
            const org = await json('/v1/organisms', {
                method: 'POST', headers: { Authorization: `Bearer ${A.token}` },
                body: JSON.stringify({ name: 'SSE Gate Org', description: 'd', type: 'project', visibility: 'private' }),
            });
            assert(org.status === 201, `organism create: ${org.status} ${JSON.stringify(org.body)}`);
            // The owner is entitled to it, so this also proves the event really fired.
            await owner!.waitFor(t => domainsSeen(t).includes('organisms'), 6_000, 'organisms on the owner stream');
            assert(!domainsSeen(app!.text()).includes('organisms'),
                `app stream must not see organisms without organism:read; saw ${JSON.stringify(domainsSeen(app!.text()))}`);
        });
        await test('the app stream is alive and still gets the domain it IS scoped for', async () => {
            // Proves the gate is selective rather than the stream simply being dead.
            const w = await json('/v1/memory', {
                method: 'POST', headers: { Authorization: `Bearer ${A.token}` },
                body: JSON.stringify({ key: 'sse.probe.app', value: { at: 2 }, visibility: 'private' }),
            });
            assert(w.status === 200 || w.status === 201, `memory write: ${w.status}`);
            await app!.waitFor(t => domainsSeen(t).includes('memory'), 6_000, 'memory on the app stream');
            assert(!domainsSeen(app!.text()).includes('organisms'), 'organisms must still be absent');
        });
        await test('a new realtime room reaches an app holding social:read as "realtime-rooms", and not the memory-only one', async () => {
            // A lobby (Band Jam) re-reads the public room list on this domain instead of waiting for Refresh.
            const tok = await appToken(ORIGIN, 'social:read social:write', A.rt);
            const lobby = await openStream(tok);
            try {
                await lobby.waitFor(t => t.includes(':open'), 3_000, 'the :open comment on the lobby stream');
                const room = await json('/v1/realtime/rooms', {
                    method: 'POST', headers: { Authorization: `Bearer ${A.token}` },
                    body: JSON.stringify({ app_type: 'sse-lobby', name: 'SSE lobby room', is_public: true }),
                });
                assert(room.status === 201, `room create: ${room.status} ${JSON.stringify(room.body)}`);
                await lobby.waitFor(t => domainsSeen(t).includes('realtime-rooms'), 6_000, 'realtime-rooms on the lobby stream');
                assert(!domainsSeen(app!.text()).includes('realtime-rooms'), 'the memory-only app stream must not hear the room list');
                assert(!domainsSeen(lobby.text()).includes('realtime'), 'the infra domain "realtime" must stay hidden from apps');
            } finally { lobby.close(); }
        });

        console.log('\nPhase 4: An app may not speak for the human');
        await test('with only the app stream open, the owner is not marked available', async () => {
            owner!.close();                                  // the human closes their portal
            await new Promise(r => setTimeout(r, 500));
            const me = await json('/v1/presence/me', { headers: { Authorization: `Bearer ${A.token}` } });
            assert(me.status === 200, `presence/me: ${me.status}`);
            const status = me.body.data?.status ?? me.body.data?.presence?.status;
            assert(status !== 'available',
                `an app-grant stream must not hold the owner available; presence/me says ${JSON.stringify(status)}`);
        });
        await test('a real owner stream still marks them available', async () => {
            const again = await openStream(A.token);
            await again.waitFor(t => t.includes(':open'), 3_000, 'the :open comment');
            await new Promise(r => setTimeout(r, 400));
            const me = await json('/v1/presence/me', { headers: { Authorization: `Bearer ${A.token}` } });
            const status = me.body.data?.status ?? me.body.data?.presence?.status;
            assert(status === 'available', `owner stream should mark available, got ${JSON.stringify(status)}`);
            again.close();
        });

        console.log('\nPhase 5: The ticket is a bearer credential in a query string');
        // It is minted single-use with a thirty-second life, and openStream() only ever consumes a
        // fresh, valid one. Delete `tickets.delete(ticketId)` (single-use consumption) or the expiry
        // test in routes/sse.ts and all seven tests stay green while a ticket leaked through a Referer
        // header, browser history or a proxy log becomes a permanently replayable read of the owner's
        // live event stream.
        const openRaw = async (query: string): Promise<number> => {
            const ctrl = new AbortController();
            const res = await fetch(`${BASE}/v1/events${query}`, { signal: ctrl.signal });
            ctrl.abort();
            return res.status;
        };

        await test('no ticket, and a ticket nobody minted, are both refused', async () => {
            const none = await openRaw('');
            assert(none === 400, `a stream opened with no ticket: ${none}`);
            const bogus = await openRaw(`?ticket=${'a'.repeat(64)}`);
            assert(bogus === 401, `a stream opened with an invented ticket: ${bogus}`);
        });

        await test('a ticket is SINGLE USE — the second attempt is refused', async () => {
            const t = await json('/v1/events/ticket', { method: 'POST', headers: { Authorization: `Bearer ${A.token}` } });
            assert(t.status === 200 && !!t.body.data.ticket, `ticket: ${t.status}`);
            const first = await openRaw(`?ticket=${t.body.data.ticket}`);
            assert(first === 200, `the fresh ticket must open the stream: ${first}`);
            const replay = await openRaw(`?ticket=${t.body.data.ticket}`);
            assert(replay === 401, `the same ticket opened the stream twice: ${replay}`);
        });

        const B = await register(`${user}b`);
        await test('a second owner opens THEIR OWN stream with THEIR OWN ticket', async () => {
            // The credential half of the question. The other half is Phase 6.
            const t = await json('/v1/events/ticket', { method: 'POST', headers: { Authorization: `Bearer ${B.token}` } });
            assert(t.status === 200, `B ticket: ${t.status}`);
            const own = await openRaw(`?ticket=${t.body.data.ticket}`);
            assert(own === 200, `B could not open their own stream: ${own}`);
        });

        console.log('\nPhase 6: One owner\'s private records are nobody else\'s event');
        // Until 2026-10-11 every `memory` and `files` change was sent with no owner, so routes/sse.ts
        // forwarded it to every open stream: one frame on B's stream for each write by A, measured
        // here by the session that wrote this suite's v1.0.0 and left for the developer to decide.
        // The payload is a domain name only, and the name plus its timing is still something B was
        // never entitled to: that A, or an agent of A's, is writing right now. Decided 2026-10-11:
        // a record only its owner reads is told to that owner's streams (event-bus.ts
        // emitRecordChange). A record other people read stays a global event, and so does a write
        // that takes a record away from them.
        const authA = { Authorization: `Bearer ${A.token}` };
        const count = (s: Stream, domain: string) => domainsSeen(s.text()).filter(d => d === domain).length;
        // The stream coalesces for a second: a frame is waited for with waitFor, and an absence is
        // only asserted after the window has had time to flush.
        const SETTLE_MS = 2_500;
        // PUT asks for the version it replaces.
        const versionOf = async (key: string): Promise<number> => {
            const g = await json(`/v1/memory/${key}`, { headers: authA });
            assert(g.status === 200 && typeof g.body.data?.version === 'number', `read ${key}: ${g.status} ${JSON.stringify(g.body).slice(0, 200)}`);
            return g.body.data.version;
        };
        const settle = () => new Promise(r => setTimeout(r, SETTLE_MS));
        let other: Stream | null = null;
        let mine: Stream | null = null;

        await test('B\'s stream stays silent through A\'s private write, update, patch and delete', async () => {
            other = await openStream(B.token);
            mine = await openStream(A.token);
            await other.waitFor(t => t.includes(':open'), 3_000, 'the :open comment on B');
            await mine.waitFor(t => t.includes(':open'), 3_000, 'the :open comment on A');
            await settle();
            const before = count(other, 'memory');
            const mineBefore = count(mine, 'memory');

            const w = await json('/v1/memory', { method: 'POST', headers: authA, body: JSON.stringify({ key: 'sse.private.a', value: { n: 1 }, visibility: 'private' }) });
            assert(w.status === 200 || w.status === 201, `private write: ${w.status}`);
            const u = await json('/v1/memory/sse.private.a', { method: 'PUT', headers: authA, body: JSON.stringify({ value: { n: 2 }, version: await versionOf('sse.private.a') }) });
            assert(u.status === 200, `private update: ${u.status} ${JSON.stringify(u.body)}`);
            const p = await json('/v1/memory/sse.private.a', { method: 'PATCH', headers: authA, body: JSON.stringify({ patch: { m: 3 } }) });
            assert(p.status === 200 || p.status === 201, `private patch: ${p.status} ${JSON.stringify(p.body)}`);
            const d = await json('/v1/memory/sse.private.a', { method: 'DELETE', headers: authA });
            assert(d.status === 200, `private delete: ${d.status}`);

            // A hears their own record change, which also proves the four writes emitted at all.
            await mine.waitFor(t => domainsSeen(t).filter(x => x === 'memory').length > mineBefore, 6_000, 'memory on A\'s own stream');
            await settle();
            assert(count(other, 'memory') === before,
                `B heard ${count(other, 'memory') - before} memory frame(s) for A's private record; frames: ${JSON.stringify(domainsSeen(other.text()))}`);
        });

        await test('B\'s stream stays silent through A\'s private file upload and delete', async () => {
            assert(!!other && !!mine, 'both streams open');
            const before = { memory: count(other!, 'memory'), files: count(other!, 'files') };
            const mineBefore = count(mine!, 'files');
            const up = await json('/v1/storage', { method: 'POST', headers: authA, body: JSON.stringify({ key: 'sse/private.txt', data: b64('hello'), mime_type: 'text/plain', visibility: 'private' }) });
            assert(up.status === 200 || up.status === 201, `private upload: ${up.status} ${JSON.stringify(up.body)}`);
            const del = await json('/v1/storage/sse/private.txt', { method: 'DELETE', headers: authA });
            assert(del.status === 200, `private file delete: ${del.status} ${JSON.stringify(del.body)}`);
            await mine!.waitFor(t => domainsSeen(t).filter(x => x === 'files').length > mineBefore, 6_000, 'files on A\'s own stream');
            await settle();
            assert(count(other!, 'files') === before.files && count(other!, 'memory') === before.memory,
                `B heard A's private file: ${JSON.stringify(domainsSeen(other!.text()))}`);
        });

        await test('a PUBLIC record of A\'s still reaches B, because B may read it', async () => {
            assert(!!other, 'B stream open');
            const before = count(other!, 'memory');
            const w = await json('/v1/memory', { method: 'POST', headers: authA, body: JSON.stringify({ key: 'sse.public.a', value: { n: 1 }, visibility: 'public' }) });
            assert(w.status === 200 || w.status === 201, `public write: ${w.status}`);
            await other!.waitFor(t => domainsSeen(t).filter(x => x === 'memory').length > before, 6_000, 'memory on B for A\'s public record');
        });

        await test('taking that record private is told to B once more, and after that it is silent', async () => {
            assert(!!other, 'B stream open');
            await settle();
            const before = count(other!, 'memory');
            const u = await json('/v1/memory/sse.public.a', { method: 'PUT', headers: authA, body: JSON.stringify({ value: { n: 2 }, visibility: 'private', version: await versionOf('sse.public.a') }) });
            assert(u.status === 200, `public to private: ${u.status} ${JSON.stringify(u.body)}`);
            await other!.waitFor(t => domainsSeen(t).filter(x => x === 'memory').length > before, 6_000, 'memory on B when the record left public');
            await settle();
            const after = count(other!, 'memory');
            const again = await json('/v1/memory/sse.public.a', { method: 'PUT', headers: authA, body: JSON.stringify({ value: { n: 3 }, version: await versionOf('sse.public.a') }) });
            assert(again.status === 200, `private update: ${again.status}`);
            await settle();
            assert(count(other!, 'memory') === after, `B heard a write to a record that is private now: ${JSON.stringify(domainsSeen(other!.text()))}`);
        });

        console.log('\nPhase 7: A workspace\'s own domain, told to the organism\'s members only');
        // Until 2026-10-18 a page showing one workspace had only `memory` and `organisms` to listen
        // to, and a memory write anywhere on the node is a `memory` frame for every open stream: the
        // Kehitysputki app re-read its workspace and redrew about once a second on aimeat.io. A change
        // in one workspace is now `workspace:<organismId>/<ws>`, sent to the organism's members alone
        // (wish-reaaliaikainen-tapahtuma-kertoo-mink-ty-tilan-tieto-muuttui).
        const WS = 'ssews';
        let wsOrg = '';
        const wsDomain = () => `workspace:${wsOrg}/${WS}`;
        const writeInWs = async (id: string) => {
            const w = await json('/v1/memory', { method: 'POST', headers: authA, body: JSON.stringify({ key: `organism.${wsOrg}.w.${WS}.shared.note.${id}.draft`, value: { id, title: id }, visibility: 'private' }) });
            assert(w.status === 200 || w.status === 201, `workspace write ${id}: ${w.status} ${JSON.stringify(w.body?.error)}`);
        };
        await test('a write in a workspace reaches a member\'s stream as that workspace\'s domain', async () => {
            assert(!!mine, 'A stream open');
            const org = await json('/v1/organisms', { method: 'POST', headers: authA, body: JSON.stringify({ name: 'SSE Workspace Org', description: 'd', type: 'project', join_policy: 'open', visibility: 'public' }) });
            assert(org.status === 201, `organism: ${org.status} ${JSON.stringify(org.body?.error)}`);
            wsOrg = org.body.data.organism.id;
            const reg = await json('/v1/memory', { method: 'POST', headers: authA, body: JSON.stringify({ key: `organism.${wsOrg}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Notes', createdAt: new Date().toISOString(), createdBy: user }] }, visibility: 'private' }) });
            assert(reg.status === 200 || reg.status === 201, `registry: ${reg.status}`);
            const man = { manifestVersion: '1.0', id: wsOrg, name: 'Notes', kind: 'project', status: 'active',
                objectTypes: [{ name: 'note', schemaRef: 'schema:note@1', namespace: 'shared.note', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'records', versioned: true }] };
            const mr = await json('/v1/memory', { method: 'POST', headers: authA, body: JSON.stringify({ key: `organism.${wsOrg}.w.${WS}.meta.manifest`, value: man, visibility: 'private' }) });
            assert(mr.status === 200 || mr.status === 201, `manifest: ${mr.status} ${JSON.stringify(mr.body?.error)}`);
            await settle();
            await writeInWs('n1');
            // HOLE: before this change no frame named the workspace; a page could only hear `memory`.
            await mine!.waitFor(t => domainsSeen(t).includes(wsDomain()), 6_000, 'the workspace domain on A\'s stream');
        });

        await test('a stream of someone outside the organism never hears that workspace', async () => {
            assert(!!other, 'B stream open');
            await settle();
            assert(!domainsSeen(other!.text()).some(d => d.startsWith('workspace:')),
                `B is no member and heard: ${JSON.stringify(domainsSeen(other!.text()).filter(d => d.startsWith('workspace:')))}`);
        });

        await test('once B joins, B\'s new stream hears the workspace too', async () => {
            const j = await json(`/v1/organisms/${wsOrg}/join`, { method: 'POST', headers: { Authorization: `Bearer ${B.token}` }, body: '{}' });
            assert(j.status === 201 || j.status === 200, `B joins: ${j.status} ${JSON.stringify(j.body?.error)}`);
            const joined = await openStream(B.token);
            await joined.waitFor(t => t.includes(':open'), 3_000, 'the :open comment on B\'s new stream');
            await writeInWs('n2');
            await joined.waitFor(t => domainsSeen(t).includes(wsDomain()), 6_000, 'the workspace domain on B\'s stream after joining');
            joined.close();
        });

        other?.close();
        mine?.close();
        app?.close();
        console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
    } finally {
        server.kill('SIGTERM');
        await new Promise(r => setTimeout(r, 500));
        cleanupDb();
    }
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
