/**
 * @file test/e2e-personal-tunnel.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The personal-node WebSocket tunnel, driven over a real socket for the first time.
 *
 *   WHY THIS SUITE EXISTS. src/services/personal-tunnel.ts was 21 % covered. e2e-personal-node.ts
 *   anchors a personal node, reads the `tunnel_url` the anchor hands back, asserts it is a string,
 *   and never opens it — so everything the tunnel is FOR was untested: the welcome frame that tells a
 *   home node how often to beat, the mailbox sync that hands it the work waiting for it, the ack that
 *   deletes those items, the heartbeat, the replacement of a stale socket, the graceful disconnect,
 *   and the two branches of the heartbeat monitor.
 *
 *   The mailbox item is a real one. POST /v1/work naming a provider that lives on an anchored
 *   personal node enqueues a `work_assignment` (src/routes/work.ts), the tunnel delivers it inside
 *   `mailbox_sync` on connect, the ack deletes it, and GET /v1/personal/mailbox/:nodeId is asked
 *   afterwards whether it is really gone. Nothing here is stubbed: the provider GAII is deliberately
 *   NOT a registered local agent, because resolveGaii checks local agents before personal nodes and
 *   a local agent would be served locally and enqueue nothing.
 *
 *   THE LAST PHASE SELF-SPAWNS A NODE, on 40299 (E2E_TUNNEL_HB_PORT), because the heartbeat monitor's
 *   degraded and timeout branches are reachable only with a short offline threshold, and that is
 *   process-wide configuration: AIMEAT_PERSONAL_HEARTBEAT_MS=10000 with AIMEAT_PERSONAL_OFFLINE_MS
 *   =12000 turns a five-minute wait into twenty seconds. The shared-node phases run first so a
 *   failure there is reported before the slow part starts. `degraded` is read through
 *   GET /v1/personal/nodes?status=degraded, because /v1/personal/status reports `online` for any open
 *   socket and would hide the stored status the monitor writes.
 *
 * @structure Phase 1 setup · 2 handshake refusals · 3 welcome + mailbox sync · 4 heartbeat, unknown
 *   type, malformed frame · 5 mailbox ack · 6 graceful disconnect · 7 a second socket replaces the
 *   first · 8 deregistering closes the socket · 9 cleanup · 10 the self-spawned node: degraded, then
 *   heartbeat timeout.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-personal-tunnel
 * @version-history
 *   v1.0.0 — 2026-09-08 — Written to cover src/services/personal-tunnel.ts end to end.
 */
import { WebSocket } from 'ws';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import * as ed from '@noble/ed25519';
import { waitForServer } from './helpers/wait-for-server.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const HB_PORT = Number(process.env.E2E_TUNNEL_HB_PORT ?? 40299);
const HB_BASE = `http://127.0.0.1:${HB_PORT}`;
const HB_NODE_ID = 'aimeat-tunnel-heartbeat-test';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err) {
        failed++;
        console.error(`  ❌ ${name}: ${(err as Error).message}`);
    }
}

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function api(base: string) {
    return async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
        const res = await fetch(`${base}${path}`, {
            ...opts,
            headers: { 'Content-Type': 'application/json', ...opts.headers },
        });
        const ct = res.headers.get('content-type') ?? '';
        const body = res.status === 204 ? null : ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
        return { status: res.status, body };
    };
}
const json = api(BASE);

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

/** Register an owner and return its token. The first owner on a fresh node is also the operator. */
async function registerOwner(call: ReturnType<typeof api>, name: string, nodeId: string): Promise<string> {
    const reg = await call('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name, public_key: 'placeholder' }),
    });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const timestamp = new Date().toISOString();
    const signature = await signMsg(reg.body.data.private_key, name + nodeId + timestamp);
    const tok = await call('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp, signature }),
    });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}

// ─── The home node's end of the tunnel ────────────────────────────────────────
//
// A real socket speaking the protocol in src/services/personal-tunnel.ts: it reads `welcome` and
// `mailbox_sync`, sends `heartbeat`, `mailbox_ack` and `disconnect`, and remembers how it was closed
// so a test can hold the server to the code and the reason it promised.

interface Frame { type: string; id?: string; payload?: string; timestamp?: string }

class HomeNodeSocket {
    private ws!: WebSocket;
    readonly frames: Frame[] = [];
    private cursor = 0;
    closeCode: number | null = null;
    closeReason = '';

    static connect(base: string, token: string): Promise<HomeNodeSocket> {
        const c = new HomeNodeSocket();
        return c.open(base, token);
    }

    private open(base: string, token: string): Promise<HomeNodeSocket> {
        const url = `${base.replace(/^http/, 'ws').replace(/\/+$/, '')}/v1/personal/tunnel?token=${encodeURIComponent(token)}`;
        this.ws = new WebSocket(url);
        return new Promise((resolve, reject) => {
            let settled = false;
            this.ws.on('message', (data) => {
                let frame: Frame;
                try { frame = JSON.parse(data.toString()); } catch { return; }
                this.frames.push(frame);
                if (frame.type === 'welcome' && !settled) { settled = true; resolve(this); }
            });
            // The upgrade is refused with a bare status line, which ws hands over here.
            this.ws.on('unexpected-response', (_req, res) => {
                if (!settled) { settled = true; reject(new Error(`HTTP ${res.statusCode}`)); }
            });
            this.ws.on('error', (err) => {
                if (!settled) { settled = true; reject(err); }
            });
            this.ws.on('close', (code, reason) => {
                this.closeCode = code;
                this.closeReason = reason.toString();
                if (!settled) { settled = true; reject(new Error(`closed before welcome (${code})`)); }
            });
        });
    }

    /** The next frame of this type that no earlier wait has consumed. */
    async waitFor(type: string, timeoutMs = 3000): Promise<Frame | null> {
        const start = Date.now();
        for (;;) {
            while (this.cursor < this.frames.length) {
                const f = this.frames[this.cursor++];
                if (f.type === type) return f;
            }
            if (Date.now() - start >= timeoutMs) return null;
            await sleep(20);
        }
    }

    send(msg: Record<string, unknown>): void { this.ws.send(JSON.stringify(msg)); }
    sendRaw(text: string): void { this.ws.send(text); }
    get isOpen(): boolean { return this.ws.readyState === WebSocket.OPEN; }

    /** Send a heartbeat and resolve with the ack that echoes its id. */
    async heartbeat(id: string, timeoutMs = 3000): Promise<Frame> {
        this.send({ type: 'heartbeat', id, timestamp: new Date().toISOString() });
        const start = Date.now();
        for (;;) {
            const ack = this.frames.find(f => f.type === 'heartbeat_ack' && f.id === id);
            if (ack) return ack;
            if (Date.now() - start >= timeoutMs) throw new Error(`no heartbeat_ack for ${id} within ${timeoutMs}ms`);
            await sleep(20);
        }
    }

    async waitClosed(timeoutMs = 5000): Promise<{ code: number; reason: string }> {
        const start = Date.now();
        while (this.closeCode === null) {
            if (Date.now() - start >= timeoutMs) throw new Error(`socket did not close within ${timeoutMs}ms`);
            await sleep(20);
        }
        return { code: this.closeCode, reason: this.closeReason };
    }

    async close(): Promise<void> {
        if (this.ws.readyState === WebSocket.CLOSED) return;
        try { this.ws.close(); } catch { /* already gone; the close event is what matters */ }
        const start = Date.now();
        while (this.closeCode === null && Date.now() - start < 3000) await sleep(20);
    }
}

/** Poll a JSON call until `check` holds, or give up and let the caller assert on the last answer. */
async function pollUntil(fn: () => Promise<any>, check: (v: any) => boolean, timeoutMs = 5000): Promise<any> {
    const start = Date.now();
    for (;;) {
        const last = await fn();
        if (check(last)) return last;
        if (Date.now() - start >= timeoutMs) return last;
        await sleep(150);
    }
}

// ─── State ───
const stamp = Date.now().toString(36);
const ownerName = `ptowner${stamp}`;
const strangerName = `ptstranger${stamp}`;
const agentName = `ptagent${stamp}`;
const personalNodeId = `personal-tunnel-${stamp}`;
const providerGaii = `homebot#${ownerName}@${personalNodeId}`;
let ownerToken = '';
let strangerToken = '';
let agentToken = '';
let trackingCode = '';
let mailboxItemId = '';
const openSockets: HomeNodeSocket[] = [];

async function closeAll(): Promise<void> {
    for (const s of openSockets) await s.close();
    openSockets.length = 0;
}

console.log('\n=== AIMEAT personal tunnel E2E: the socket a home node actually opens ===\n');

async function sharedNodePhases() {
    // ─── Phase 1: Setup ───
    console.log('Phase 1 — Setup');

    await test('an owner, an agent of that owner, and a second owner with no personal node', async () => {
        ownerToken = await registerOwner(json, ownerName, NODE_ID);
        strangerToken = await registerOwner(json, strangerName, NODE_ID);
        const agent = await json('/v1/agents', {
            method: 'POST',
            headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({
                name: agentName,
                owner: ownerName,
                capabilities: ['actions'],
                scopes: ['work:request', 'work:read', 'memory:read'],
                model: 'test-model',
            }),
        });
        assert(agent.status === 201, `agent register ${agent.status}: ${JSON.stringify(agent.body)}`);
        const agentGaii = agent.body.data.agent.gaii as string;
        const timestamp = new Date().toISOString();
        const signature = await signMsg(agent.body.data.private_key, agentGaii + timestamp);
        const tok = await json('/v1/auth/token', {
            method: 'POST',
            body: JSON.stringify({ gaii: agentGaii, timestamp, signature }),
        });
        assert(tok.body.ok === true, `agent token: ${JSON.stringify(tok.body.error)}`);
        agentToken = tok.body.data.token;
    });

    await test('POST /v1/personal/anchor — the node is anchored, with one agent on it', async () => {
        const { status, body } = await json('/v1/personal/anchor', {
            method: 'POST',
            headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({
                node_id: personalNodeId,
                owner_name: ownerName,
                public_key: 'test-key-base64',
                agent_gaiis: [providerGaii],
                visibility: 'private',
            }),
        });
        assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.data.status === 'offline', `a node nothing has connected from is offline: ${body.data.status}`);
        assert(typeof body.data.tunnel_url === 'string' && body.data.tunnel_url.startsWith('ws'),
            `tunnel_url: ${body.data.tunnel_url}`);
    });

    await test('POST /v1/work — work for that node\'s agent is queued in its mailbox', async () => {
        const { status, body } = await json('/v1/work', {
            method: 'POST',
            headers: { Authorization: `Bearer ${agentToken}` },
            body: JSON.stringify({
                action_id: 'summarize',
                provider_gaii: providerGaii,
                input: { text: 'the tunnel carries this' },
            }),
        });
        assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
        trackingCode = body.data.tracking_code;
        const mail = await pollUntil(
            () => json(`/v1/personal/mailbox/${encodeURIComponent(personalNodeId)}`, { headers: { Authorization: `Bearer ${ownerToken}` } }),
            r => r.body?.data?.items === 1,
        );
        assert(mail.body.data.items === 1, `one item should be waiting, got ${JSON.stringify(mail.body?.data)}`);
        assert(mail.body.data.by_type?.work_assignment === 1, `by_type: ${JSON.stringify(mail.body.data.by_type)}`);
    });

    // ─── Phase 2: The handshake refuses before it upgrades ───
    console.log('Phase 2 — Handshake refusals');

    await test('no token — the upgrade is refused with 401', async () => {
        const url = `${BASE.replace(/^http/, 'ws').replace(/\/+$/, '')}/v1/personal/tunnel`;
        const ws = new WebSocket(url);
        const status = await new Promise<string>((resolve) => {
            ws.on('unexpected-response', (_r, res) => resolve(String(res.statusCode)));
            ws.on('error', (err) => resolve(err.message));
            ws.on('open', () => resolve('opened'));
        });
        ws.terminate();
        assert(status.includes('401'), `a tokenless upgrade must be 401, got ${status}`);
    });

    await test('a valid owner with NO anchored node is refused with 403', async () => {
        let refusal = 'opened';
        try {
            const s = await HomeNodeSocket.connect(BASE, strangerToken);
            openSockets.push(s);
        } catch (err) { refusal = (err as Error).message; }
        assert(refusal.includes('403'),
            `a token is not enough: the tunnel is for an anchored node, expected 403, got ${refusal}`);
    });

    // ─── Phase 3: Welcome and mailbox sync ───
    console.log('Phase 3 — Welcome and mailbox sync');

    let socket1: HomeNodeSocket;

    await test('the welcome frame carries the protocol the home node has to follow', async () => {
        socket1 = await HomeNodeSocket.connect(BASE, ownerToken);
        openSockets.push(socket1);
        const welcome = socket1.frames.find(f => f.type === 'welcome');
        assert(!!welcome, `no welcome frame: ${JSON.stringify(socket1.frames.map(f => f.type))}`);
        const p = JSON.parse(welcome!.payload!);
        assert(p.protocol_version === '1.0', `protocol_version: ${p.protocol_version}`);
        assert(typeof p.heartbeat_interval_ms === 'number' && p.heartbeat_interval_ms > 0, `heartbeat_interval_ms: ${p.heartbeat_interval_ms}`);
        assert(typeof p.offline_threshold_ms === 'number' && p.offline_threshold_ms > p.heartbeat_interval_ms,
            `the offline threshold must leave room for more than one beat: ${p.offline_threshold_ms} vs ${p.heartbeat_interval_ms}`);
        assert(typeof p.request_timeout_ms === 'number', `request_timeout_ms: ${p.request_timeout_ms}`);
        assert(p.reconnect_hint?.strategy === 'exponential_backoff', `reconnect_hint: ${JSON.stringify(p.reconnect_hint)}`);
        assert(p.reconnect_hint.jitter === true, 'the reconnect hint asks for jitter');
    });

    await test('mailbox_sync hands the waiting work over on connect', async () => {
        const sync = await socket1.waitFor('mailbox_sync');
        assert(!!sync, 'no mailbox_sync frame arrived');
        const p = JSON.parse(sync!.payload!);
        assert(p.items === 1, `items: ${p.items}`);
        assert(typeof p.total_bytes === 'number', `total_bytes: ${p.total_bytes}`);
        assert(p.by_type?.work_assignment === 1, `by_type: ${JSON.stringify(p.by_type)}`);
        assert(typeof p.oldest === 'string' && typeof p.newest === 'string', `oldest/newest: ${p.oldest} ${p.newest}`);
        assert(Array.isArray(p.mailbox_items) && p.mailbox_items.length === 1,
            `the sync must carry the items themselves, got ${JSON.stringify(p.mailbox_items)}`);
        const item = p.mailbox_items[0];
        mailboxItemId = item.id;
        assert(typeof mailboxItemId === 'string' && mailboxItemId.length > 0, `item id: ${mailboxItemId}`);
        assert(item.type === 'work_assignment', `item type: ${item.type}`);
        assert(item.to === providerGaii, `the item is addressed to the node's agent: ${item.to}`);
        const payload = JSON.parse(item.payload);
        assert(payload.event === 'work.assigned', `event: ${payload.event}`);
        assert(payload.tracking_code === trackingCode, `tracking_code: ${payload.tracking_code} vs ${trackingCode}`);
    });

    await test('the node reads as online while the socket is up, on status and on health', async () => {
        const status = await pollUntil(
            () => json('/v1/personal/status', { headers: { Authorization: `Bearer ${ownerToken}` } }),
            r => r.body?.data?.status === 'online',
        );
        assert(status.body.data.status === 'online', `status: ${status.body?.data?.status}`);
        const health = await json('/v1/health');
        assert(health.body.data?.subsystems?.tunnel !== undefined, `no tunnel subsystem: ${JSON.stringify(Object.keys(health.body.data?.subsystems ?? {}))}`);
        assert(health.body.data.subsystems.tunnel.connections_active >= 1,
            `connections_active: ${health.body.data.subsystems.tunnel.connections_active}`);
    });

    // ─── Phase 4: What the socket does with what it is sent ───
    console.log('Phase 4 — Heartbeat, unknown type, malformed frame');

    await test('a heartbeat is acknowledged with its own id', async () => {
        const id = `hb-${stamp}-1`;
        const ack = await socket1.heartbeat(id);
        assert(ack.id === id, `the ack must echo the heartbeat id, got ${ack.id}`);
        assert(typeof ack.timestamp === 'string', `ack timestamp: ${ack.timestamp}`);
    });

    await test('an unknown message type is ignored and the socket stays open', async () => {
        socket1.send({ type: 'teleport', id: 'x1', timestamp: new Date().toISOString() });
        await sleep(200);
        assert(socket1.isOpen, 'an unknown type must not drop the connection');
        const ack = await socket1.heartbeat(`hb-${stamp}-2`);
        assert(ack.id === `hb-${stamp}-2`, 'the socket still answers after an unknown type');
    });

    await test('a malformed frame is ignored and the socket stays open', async () => {
        socket1.sendRaw('{not json at all');
        await sleep(200);
        assert(socket1.isOpen, 'a malformed frame must not drop the connection');
        const ack = await socket1.heartbeat(`hb-${stamp}-3`);
        assert(ack.id === `hb-${stamp}-3`, 'the socket still answers after a malformed frame');
    });

    // ─── Phase 5: The ack that deletes ───
    console.log('Phase 5 — Mailbox ack');

    await test('mailbox_ack deletes the acknowledged item', async () => {
        socket1.send({ type: 'mailbox_ack', id: `ack-${stamp}`, payload: JSON.stringify([mailboxItemId]), timestamp: new Date().toISOString() });
        const mail = await pollUntil(
            () => json(`/v1/personal/mailbox/${encodeURIComponent(personalNodeId)}`, { headers: { Authorization: `Bearer ${ownerToken}` } }),
            r => r.body?.data?.items === 0,
        );
        assert(mail.body.data.items === 0, `the acknowledged item must be gone, mailbox says ${JSON.stringify(mail.body?.data)}`);
        assert(mail.body.data.total_bytes === 0, `total_bytes: ${mail.body.data.total_bytes}`);
        assert(socket1.isOpen, 'the socket stays open after an ack');
    });

    await test('a reconnect after the ack syncs an empty mailbox', async () => {
        // Proves the deletion is on the node, not only in the answer the stats route gives: a fresh
        // socket is built from storage, and it now has nothing to hand over.
        socket1.send({ type: 'disconnect', id: `dc-${stamp}-0`, timestamp: new Date().toISOString() });
        await socket1.waitClosed();
        const again = await HomeNodeSocket.connect(BASE, ownerToken);
        openSockets.push(again);
        const sync = await again.waitFor('mailbox_sync');
        const p = JSON.parse(sync!.payload!);
        assert(p.items === 0, `items after the ack: ${p.items}`);
        assert(Array.isArray(p.mailbox_items) && p.mailbox_items.length === 0, `mailbox_items: ${JSON.stringify(p.mailbox_items)}`);
        assert(p.oldest === null && p.newest === null, `an empty mailbox has no oldest or newest: ${p.oldest} ${p.newest}`);
        socket1 = again;
    });

    // ─── Phase 6: Going away politely ───
    console.log('Phase 6 — Graceful disconnect');

    await test('a disconnect frame closes the socket and puts the node offline', async () => {
        socket1.send({ type: 'disconnect', id: `dc-${stamp}`, timestamp: new Date().toISOString() });
        const closed = await socket1.waitClosed();
        assert(closed.code === 1000, `a graceful disconnect closes with 1000, got ${closed.code}`);
        const status = await pollUntil(
            () => json('/v1/personal/status', { headers: { Authorization: `Bearer ${ownerToken}` } }),
            r => r.body?.data?.status === 'offline',
        );
        assert(status.body.data.status === 'offline', `status after disconnect: ${status.body?.data?.status}`);
        const health = await pollUntil(() => json('/v1/health'), r => r.body?.data?.subsystems?.tunnel?.connections_active === 0);
        assert(health.body.data.subsystems.tunnel.connections_active === 0,
            `connections_active after disconnect: ${health.body.data.subsystems.tunnel.connections_active}`);
    });

    // ─── Phase 7: One node, one socket ───
    console.log('Phase 7 — A second socket replaces the first');

    await test('the older socket is closed with reason "replaced"', async () => {
        const first = await HomeNodeSocket.connect(BASE, ownerToken);
        openSockets.push(first);
        await first.waitFor('mailbox_sync');
        const second = await HomeNodeSocket.connect(BASE, ownerToken);
        openSockets.push(second);
        const closed = await first.waitClosed();
        assert(closed.code === 1000, `replacement closes with 1000, got ${closed.code}`);
        assert(closed.reason === 'replaced', `reason: "${closed.reason}"`);
        assert(second.isOpen, 'the new socket must survive the replacement');
        await second.close();
    });

    await test('the replacing socket stays registered: online on status, counted on health', async () => {
        // Before 2026-09-08 the replaced socket's own close handler deleted the registry entry by
        // node id, which by then held the NEW socket: connections_active read 0 and the status
        // route said offline while a healthy tunnel was open. This asserted that hole first.
        const first = await HomeNodeSocket.connect(BASE, ownerToken);
        openSockets.push(first);
        await first.waitFor('mailbox_sync');
        const second = await HomeNodeSocket.connect(BASE, ownerToken);
        openSockets.push(second);
        await first.waitClosed();
        await second.waitFor('mailbox_sync');
        await new Promise(r => setTimeout(r, 500));
        const health = await json('/v1/health');
        assert(health.body.data.subsystems.tunnel.connections_active >= 1,
            `connections_active after a replacement: ${health.body.data.subsystems.tunnel.connections_active}`);
        const status = await json('/v1/personal/status', { headers: { Authorization: `Bearer ${ownerToken}` } });
        assert(status.body.data.status === 'online', `status after a replacement: ${status.body?.data?.status}`);
        await second.close();
    });

    // ─── Phase 8: Deregistering closes the socket ───
    console.log('Phase 8 — Deregister closes the tunnel');

    await test('DELETE /v1/personal/anchor/:nodeId closes the live socket with reason "deregistered"', async () => {
        const live = await HomeNodeSocket.connect(BASE, ownerToken);
        openSockets.push(live);
        await live.waitFor('mailbox_sync');
        const del = await json(`/v1/personal/anchor/${encodeURIComponent(personalNodeId)}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${ownerToken}` },
        });
        assert(del.status === 200, `deregister ${del.status}: ${JSON.stringify(del.body)}`);
        const closed = await live.waitClosed();
        assert(closed.code === 1000, `deregister closes with 1000, got ${closed.code}`);
        assert(closed.reason === 'deregistered', `reason: "${closed.reason}"`);
    });

    await test('the tunnel is refused once the anchor is gone', async () => {
        let refusal = 'opened';
        try {
            const s = await HomeNodeSocket.connect(BASE, ownerToken);
            openSockets.push(s);
        } catch (err) { refusal = (err as Error).message; }
        assert(refusal.includes('403'), `expected 403 after deregister, got ${refusal}`);
    });

    // ─── Phase 9: Cleanup ───
    console.log('Phase 9 — Cleanup');

    await test('the owners are removed', async () => {
        await closeAll();
        for (const [name, token] of [[ownerName, ownerToken], [strangerName, strangerToken]] as const) {
            const { body } = await json(`/v1/owners/${name}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            });
            assert(body.ok === true, `delete ${name}: ${JSON.stringify(body.error)}`);
        }
    });
}

// ─── A node of our own, with a ten-second heartbeat ───────────────────────────

let hbNode: ChildProcess | null = null;
let hbLog = '';
let hbDir = '';

async function startHeartbeatNode(): Promise<void> {
    hbDir = mkdtempSync(join(tmpdir(), 'aimeat-tunnel-hb-'));
    hbNode = spawn('node', ['--import', 'tsx', 'src/index.ts', 'start', '--db', 'sqlite', '--db-path', join(hbDir, 'tunnel.db'), '--port', String(HB_PORT)], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            AIMEAT_PORT: String(HB_PORT),
            AIMEAT_BASE_URL: HB_BASE,
            AIMEAT_NODE_TYPE: 'full',
            // Pinned rather than read back off the running node: the owner-auth message is signed
            // over the node id, and asking a booting node for its own id through the bootstrap route
            // answered with the SPA's HTML once in four runs.
            AIMEAT_NODE_ID: HB_NODE_ID,
            AIMEAT_NODE_KEY_PATH: join(hbDir, 'node-key.json'),
            AIMEAT_SQLITE_PATH: join(hbDir, 'tunnel.db'),
            AIMEAT_PERSONAL_NODES_ENABLED: 'true',
            // The whole point of this node: a threshold short enough to watch. The monitor's own
            // interval is floored at 10 s in startHeartbeatMonitor, so 12 s is the smallest
            // threshold that still gives a degraded tick before the timeout tick.
            AIMEAT_PERSONAL_HEARTBEAT_MS: '10000',
            AIMEAT_PERSONAL_OFFLINE_MS: '12000',
            AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000', AIMEAT_RL_MEMORY: '1000',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    hbNode.stdout?.on('data', c => { hbLog += c.toString(); });
    hbNode.stderr?.on('data', c => { hbLog += c.toString(); });
    await waitForServer(hbNode, HB_BASE, { label: 'the heartbeat node' });
}

async function stopHeartbeatNode(): Promise<void> {
    if (hbNode) {
        const child = hbNode;
        hbNode = null;
        child.kill();
        // Wait for the exit rather than the clock: the coverage preload writes its file on the way
        // out, and killing the runner's process first loses it.
        await once(child, 'exit');
    }
    if (hbDir) {
        try { rmSync(hbDir, { recursive: true, force: true }); } catch { /* the OS will get it */ }
        hbDir = '';
    }
}

async function heartbeatMonitorPhase() {
    console.log('Phase 10 — The heartbeat monitor, on a node of our own');

    const hbJson = api(HB_BASE);
    const hbOwner = `hbowner${stamp}`;
    const hbNodeId = `personal-hb-${stamp}`;
    let hbToken = '';
    let silent: HomeNodeSocket | null = null;

    await test('a node with a twelve-second offline threshold is up, anchored and connected', async () => {
        await startHeartbeatNode();
        // Its own node id, not the shared runner's: the owner-auth message is signed over it.
        hbToken = await registerOwner(hbJson, hbOwner, HB_NODE_ID);
        const anchor = await hbJson('/v1/personal/anchor', {
            method: 'POST',
            headers: { Authorization: `Bearer ${hbToken}` },
            body: JSON.stringify({
                node_id: hbNodeId, owner_name: hbOwner, public_key: 'test-key-base64',
                agent_gaiis: [], visibility: 'private',
            }),
        });
        assert(anchor.status === 201, `anchor ${anchor.status}: ${JSON.stringify(anchor.body)}`);
        silent = await HomeNodeSocket.connect(HB_BASE, hbToken);
        openSockets.push(silent);
        const welcome = JSON.parse(silent.frames.find(f => f.type === 'welcome')!.payload!);
        assert(welcome.offline_threshold_ms === 12000, `the node must be running the short threshold, got ${welcome.offline_threshold_ms}`);
        await silent.heartbeat(`hb-${stamp}-only`);
    });

    await test('a socket that stops beating is marked degraded', async () => {
        // Read through the operator inventory filtered by STORED status: /v1/personal/status reports
        // `online` for any open socket, so it cannot see what the monitor wrote.
        const found = await pollUntil(
            () => hbJson(`/v1/personal/nodes?status=degraded`, { headers: { Authorization: `Bearer ${hbToken}` } }),
            r => (r.body?.data?.personal_nodes ?? []).some((n: any) => n.node_id === hbNodeId),
            25_000,
        );
        const nodes = found.body?.data?.personal_nodes ?? [];
        assert(nodes.some((n: any) => n.node_id === hbNodeId),
            `the silent node should be degraded, the degraded list holds ${JSON.stringify(nodes.map((n: any) => n.node_id))}`);
        assert(silent!.isOpen, 'degraded is not disconnected: the socket is still open at this point');
    });

    await test('…and then closed with reason "heartbeat_timeout", the node offline', async () => {
        const closed = await silent!.waitClosed(30_000);
        assert(closed.code === 1000, `timeout closes with 1000, got ${closed.code}`);
        assert(closed.reason === 'heartbeat_timeout', `reason: "${closed.reason}"`);
        const status = await pollUntil(
            () => hbJson('/v1/personal/status', { headers: { Authorization: `Bearer ${hbToken}` } }),
            r => r.body?.data?.status === 'offline',
        );
        assert(status.body?.data?.status === 'offline', `status after the timeout: ${status.body?.data?.status}`);
    });

    // The socket is closed by the node itself in the test above; closeAll() sweeps it if a failure
    // meant it never got that far.
    await stopHeartbeatNode();
}

async function run() {
    await sharedNodePhases();
    await heartbeatMonitorPhase();
    await closeAll();
    console.log(`\nPersonal tunnel E2E: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(async (err) => {
    console.error('Suite crashed:', err);
    await closeAll();
    await stopHeartbeatNode();
    process.exit(1);
});
