/**
 * @file test/e2e-two-process-bus.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two processes of one node on one PostgreSQL database, A and B, and the event bus between
 *   them (services/bus-relay.ts over LISTEN/NOTIFY):
 *     1. a memory write on A reaches a live stream (SSE) opened on B;
 *     2. a federation peer the operator adds on A is known on B; a plain owner's removal on B is
 *        refused (403) and the peer stays; after the operator's emergency removal on A, B refuses
 *        that peer's signed request within a second;
 *     3. a setting saved on A (registration closed) is in force on B;
 *     4. one append of workspace rows on A starts its `workspace.rows` workflow once, not once per
 *        process (the origin rule in services/event-bus.ts). The workflow is `parallel`, so the
 *        overlap guard would not hide a second start;
 *     5. a task created on A reaches its agent at once when the agent's tunnel is held by B;
 *     6. after the listening connections of A and B are dropped (pg_terminate_backend), B reads its
 *        registries again when it listens again, so a setting changed in the database while no
 *        event could arrive (registration closed with no NOTIFY) is in force on B; before the drop
 *        B does not see it, which shows the reconnect is what applied it.
 *
 *   WHY. With the bus in one process, a change made on A reached only A: B's pages did not update,
 *   B kept accepting a peer the operator had removed in an emergency, and B ran with the old settings
 *   until it restarted (codebase analysis 2026-11-03, HA stage 2). Carrying every event to B makes the
 *   other half true; the origin rule keeps a write from starting its work twice.
 *
 *   A starts first and B after it is ready, so the node key A writes at its first start is the one B
 *   reads, and a token from one process is honoured by the other. SQLite is one file for one process,
 *   so on a SQLite run the suite is skipped with that reason.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.postgres-kysely --import tsx test/run-e2e-ci.ts --test=e2e-two-process-bus
 * @version-history
 *   v1.1.0 — 2026-11-04 — Case 6: a dropped listening connection, and the registries read again
 *     after it (codebase analysis 2026-11-03, item HA stage 3).
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, HA stage 2, e2-bus).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb, runBackend, type OwnNodeDb } from './helpers/own-node-db.js';
import { skip, isSkip } from './helpers/skip.js';
import { setupOperator, registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { generateKeyPair, sign } from '../src/auth/keypair.js';
import { audienceProof } from '../src/services/signed-node-request.js';
import { presenceSignString } from '../src/services/presence.js';
import { TunnelClient } from './helpers/tunnel-harness.js';

const PORTS = { A: 28761, B: 28762 } as const;
const NODE_ID = 'aimeat-two-process-bus-001';
const base = (p: 'A' | 'B') => `http://127.0.0.1:${PORTS[p]}`;
const stamp = Date.now().toString(36).slice(-6);

let passed = 0;
let failed = 0;
let skipped = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) {
        if (isSkip(err)) { skipped++; console.log(`  ⏭ ${name}: ${err.message}`); return; }
        failed++; console.log(`  ❌ ${name}: ${(err as Error).message}`);
    }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const short = (v: unknown) => JSON.stringify(v).slice(0, 300);

async function json(p: 'A' | 'B', path: string, opts: RequestInit & { token?: string } = {}): Promise<{ status: number; body: any }> {
    const { token, ...rest } = opts;
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${base(p)}${path}`, {
            ...rest,
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(rest.headers ?? {}) },
        });
        if (res.status === 429 && attempt < 5) { await sleep(1500); continue; }
        const text = await res.text();
        let body: any;
        try { body = JSON.parse(text); } catch { body = { _raw: text.slice(0, 300) }; }
        return { status: res.status, body };
    }
}

const procs: Array<{ name: string; proc: ChildProcess; out: () => string; exit: () => number | null }> = [];

async function startProcess(name: 'A' | 'B', db: { args: string[]; env: Record<string, string> }): Promise<void> {
    let out = '';
    let code: number | null = null;
    const proc = spawn(process.execPath, [...nodeEntryArgs(), 'start', ...db.args, '--port', String(PORTS[name])], {
        cwd: process.cwd(),
        env: {
            ...process.env, ...db.env,
            AIMEAT_PORT: String(PORTS[name]), AIMEAT_BASE_URL: base(name), AIMEAT_NODE_ID: NODE_ID, AIMEAT_LOG_LEVEL: 'warn',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout?.on('data', (c: Buffer) => { out += c.toString(); });
    proc.stderr?.on('data', (c: Buffer) => { out += c.toString(); });
    proc.once('exit', (c) => { code = c ?? -1; });
    const entry = { name, proc, out: () => out, exit: () => code };
    procs.push(entry);
    const deadline = Date.now() + Number(process.env.AIMEAT_E2E_SERVER_READY_MS ?? 240_000);
    while (Date.now() < deadline) {
        assert(entry.exit() === null, `process ${name} exited with code ${entry.exit()} while booting: ${out.slice(-1200)}`);
        const r = await fetch(`${base(name)}/v1/health/ready`, { signal: AbortSignal.timeout(2_000) }).catch(() => null);
        if (r?.status === 200) return;
        await sleep(500);
    }
    throw new Error(`process ${name} did not answer ready: ${out.slice(-1200)}`);
}

/** A live stream on one process, read as it arrives. */
async function openStream(p: 'A' | 'B', token: string) {
    const t = await json(p, '/v1/events/ticket', { method: 'POST', token });
    assert(t.status === 200 && !!t.body.data?.ticket, `ticket on ${p}: ${t.status} ${short(t.body)}`);
    const ctrl = new AbortController();
    const res = await fetch(`${base(p)}/v1/events?ticket=${t.body.data.ticket}`, { signal: ctrl.signal });
    assert(res.status === 200, `stream on ${p}: ${res.status}`);
    let buf = '';
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    void (async () => {
        try { for (;;) { const { value, done } = await reader.read(); if (done) break; if (value) buf += dec.decode(value, { stream: true }); } }
        catch { /* closed */ }
    })();
    const domains = () => {
        const out: string[] = [];
        for (const line of buf.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try { const d = JSON.parse(line.slice(6)); if (Array.isArray(d.domains)) out.push(...d.domains); } catch { /* partial */ }
        }
        return out;
    };
    return { domains, close: () => ctrl.abort() };
}

let op: RegisteredOwner;
let plain: RegisteredOwner;
let nodeDb: OwnNodeDb | undefined;

console.log('\n=== TWO PROCESSES, ONE BUS (the event bus over PostgreSQL LISTEN/NOTIFY) ===\n');

try {
    await test('Setup: process A, then process B, of one node on one empty database; the operator\'s token works on both', async () => {
        if (runBackend() !== 'postgres-kysely') skip('SQLite is one file for one process; the bus between processes is PostgreSQL only');
        const db = await ownNodeDb('two-process-bus');
        nodeDb = db;
        await startProcess('A', db);
        await startProcess('B', db);
        op = await setupOperator(base('A'), process.env.AIMEAT_ADMIN_PASSWORD ?? '', `busop${stamp}`);
        const onB = await json('B', '/v1/memory?limit=1', { token: op.token });
        assert(onB.status === 200, `the operator on B: ${onB.status} ${short(onB.body)}`);
        plain = await registerOwner(base('A'), `buspl${stamp}`);
        const plainOnB = await json('B', '/v1/memory?limit=1', { token: plain.token });
        assert(plainOnB.status === 200, `the plain owner on B: ${plainOnB.status} ${short(plainOnB.body)}`);
    });

    await test('1. A memory write on A reaches a live stream opened on B', async () => {
        if (!op) skip('no setup');
        const stream = await openStream('B', op.token);
        try {
            await sleep(500);
            const before = stream.domains().filter(d => d === 'memory').length;
            const w = await json('A', '/v1/memory', { method: 'POST', token: op.token, body: JSON.stringify({ key: `bus.note.${stamp}`, value: { n: 1 }, visibility: 'private' }) });
            assert(w.status === 201 || w.status === 200, `write on A: ${w.status} ${short(w.body)}`);
            const deadline = Date.now() + 5_000;
            while (Date.now() < deadline && stream.domains().filter(d => d === 'memory').length <= before) await sleep(50);
            assert(stream.domains().filter(d => d === 'memory').length > before, `B's stream heard no memory change within 5 s: ${short(stream.domains())}`);
        } finally { stream.close(); }
    });

    await test('2. A peer added on A is known on B; after an emergency removal on A, B refuses its signed request within a second', async () => {
        if (!op) skip('no setup');
        const keys = await generateKeyPair();
        const peerId = `aimeat-bus-peer-${stamp}`;
        const add = await json('A', '/v1/federation/peers', { method: 'POST', token: op.token, body: JSON.stringify({ node_id: peerId, url: 'http://127.0.0.1:28769', public_key: keys.publicKey }) });
        assert(add.status === 201, `add the peer on A: ${add.status} ${short(add.body)}`);
        const act = await json('A', `/v1/federation/peers/${peerId}`, { method: 'PUT', token: op.token, body: JSON.stringify({ status: 'active' }) });
        assert(act.status === 200, `activate the peer on A: ${act.status} ${short(act.body)}`);

        let tick = 0;
        const presence = async () => {
            const timestamp = new Date(Date.now() + tick++).toISOString();
            const signed = presenceSignString(peerId, timestamp, []);
            return json('B', '/v1/federation/presence', {
                method: 'POST',
                body: JSON.stringify({ from_node_id: peerId, timestamp, updates: [], signature: await sign(keys.privateKey, signed), ...await audienceProof(keys.privateKey, signed, NODE_ID) }),
            });
        };
        let known = await presence();
        for (let i = 0; i < 20 && known.status !== 200; i++) { await sleep(100); known = await presence(); }
        assert(known.status === 200 && known.body.data?.accepted === true, `B did not accept the peer A added: ${known.status} ${short(known.body)}`);

        // Only the operator removes a peer, on either process: a plain owner is refused on B, and the peer stays.
        const notOp = await json('B', `/v1/federation/peers/${peerId}?emergency=true`, { method: 'DELETE', token: plain.token });
        assert(notOp.status === 403, `a plain owner's removal on B: ${notOp.status} ${short(notOp.body)}`);
        const still = await presence();
        assert(still.status === 200, `the peer went after a refused removal: ${still.status} ${short(still.body)}`);

        const del = await json('A', `/v1/federation/peers/${peerId}?emergency=true`, { method: 'DELETE', token: op.token });
        assert(del.status === 200 && del.body.data?.deleted === true, `emergency removal on A: ${del.status} ${short(del.body)}`);
        const removedAt = Date.now();
        let after = await presence();
        while (after.status === 200 && Date.now() - removedAt < 1_000) { await sleep(50); after = await presence(); }
        assert(after.status !== 200, `B still accepts the removed peer ${Date.now() - removedAt} ms after the removal: ${after.status} ${short(after.body)}`);
        const list = await json('B', '/v1/federation/peers', { token: op.token });
        assert(list.status === 200 && !(list.body.data?.peers ?? []).some((p: any) => p.node_id === peerId), `B's peer list still names the peer: ${short(list.body.data?.peers)}`);
    });

    await test('3. Registration closed on A is in force on B', async () => {
        if (!op) skip('no setup');
        const before = await json('B', '/v1/admin/config', { token: op.token });
        assert(before.status === 200, `config on B: ${before.status}`);
        const close = await json('A', '/v1/admin/config', { method: 'PUT', token: op.token, body: JSON.stringify({ changes: [{ path: 'registration.mode', value: 'closed' }] }) });
        assert(close.status === 200 && (close.body.data?.applied ?? []).some((a: any) => a.path === 'registration.mode'), `close on A: ${close.status} ${short(close.body)}`);
        try {
            let reg = await json('B', '/v1/ghii', { method: 'POST', body: JSON.stringify({ username: `busnew${stamp}`, display_name: 'x', password: 'E2eOwnerPass-2026' }) });
            for (let i = 0; i < 20 && reg.status === 201; i++) { await sleep(100); reg = await json('B', '/v1/ghii', { method: 'POST', body: JSON.stringify({ username: `busnew${stamp}${i}`, display_name: 'x', password: 'E2eOwnerPass-2026' }) }); }
            assert(reg.status !== 201, `B still registers new accounts: ${reg.status} ${short(reg.body)}`);
        } finally {
            await json('A', '/v1/admin/config', { method: 'PUT', token: op.token, body: JSON.stringify({ changes: [{ path: 'registration.mode', value: 'open' }] }) });
        }
    });

    await test('4. One append of workspace rows on A starts its workflow once, not once per process', async () => {
        if (!op) skip('no setup');
        const o = await json('A', '/v1/organisms', { method: 'POST', token: op.token, body: JSON.stringify({ name: `Bus Org ${stamp}`, description: 'x', type: 'project', join_policy: 'open', visibility: 'public' }) });
        assert(o.status === 201, `organism: ${o.status} ${short(o.body)}`);
        const orgId = o.body.data.organism.id as string;
        const WS = 'ws-bus';
        const manifest = {
            manifestVersion: '1', id: orgId, name: 'Bus WS', kind: 'workspace', status: 'active',
            objectTypes: [{ name: 'inbox', schemaRef: 'schema:mail@1', namespace: 'mail.inbox', backing: 'rows', writeRole: 'member', mode: 'records' }],
        };
        const m = await json('A', '/v1/memory', { method: 'POST', token: op.token, body: JSON.stringify({ key: `organism.${orgId}.w.${WS}.meta.manifest`, value: manifest, visibility: 'private' }) });
        assert(m.status === 201, `manifest: ${m.status} ${short(m.body)}`);
        const def = {
            title: { en_US: 'Bus intake' }, description: { en_US: 'one human gate, held open' },
            trigger: { kind: 'event', on: 'workspace.rows', match: { organism: orgId, workspace: WS, space: 'inbox' } },
            on_step_fail: 'inspect', vars: [], parallel: true,
            steps: [{
                id: 'gate', description: { en_US: 'Look at what arrived' }, required_to_function: 'none',
                action: { kind: 'human-input', question: { header: 'Intake', prompt: 'Handle it?', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] }, answer_to_key: 'buswf.{run}.decision' },
            }],
        };
        const s = await json('A', '/v1/workflows/bus-rows', { method: 'PUT', token: op.token, body: JSON.stringify(def) });
        assert(s.status === 200, `save the workflow: ${s.status} ${short(s.body)}`);
        const a = await json('A', `/v1/organisms/${orgId}/workspace/rows/inbox?ws=${WS}`, { method: 'POST', token: op.token, body: JSON.stringify({ rows: [{ row_id: 'r-1', body: { subject: 'one' } }] }) });
        assert(a.status === 200 && a.body.data?.written === 1, `append on A: ${a.status} ${short(a.body)}`);
        const runs = async () => ((await json('A', '/v1/workflows/bus-rows/runs', { token: op.token })).body.data?.runs ?? []) as any[];
        const deadline = Date.now() + 5_000;
        while (Date.now() < deadline && (await runs()).length < 1) await sleep(200);
        await sleep(2_000);   // time for a second process to start one too, if it would
        const all = await runs();
        assert(all.length === 1, `one append started ${all.length} run(s): ${short(all.map(r => ({ id: r.runId, status: r.status })))}`);
        for (const r of all) await json('A', `/v1/workflows/bus-rows/runs/${r.runId}/cancel`, { method: 'POST', token: op.token });
    });

    await test('5. A task created on A reaches the agent whose tunnel is held by B, at once', async () => {
        if (!op) skip('no setup');
        const reg = await json('A', '/v1/agents', { method: 'POST', token: op.token, body: JSON.stringify({ name: 'busbot', owner: op.name, capabilities: ['memory'], scopes: ['*'] }) });
        assert(reg.status === 201, `agent on A: ${reg.status} ${short(reg.body)}`);
        const gaii = reg.body.data.agent.gaii as string;
        const timestamp = new Date().toISOString();
        const tok = await json('A', '/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature: await sign(reg.body.data.private_key, gaii + timestamp) }) });
        assert(tok.status === 200 && !!tok.body.data?.token, `agent token: ${tok.status} ${short(tok.body)}`);
        const tunnel = await TunnelClient.connect(base('B'), tok.body.data.token);
        try {
            await tunnel.waitForBacklog(3_000);
            const t = await json('A', '/v1/agents/busbot/tasks', { method: 'POST', token: op.token, body: JSON.stringify({ title: 'Across processes', description: 'x', status: 'queued' }) });
            assert(t.status === 201, `task on A: ${t.status} ${short(t.body)}`);
            const d = await tunnel.waitForDeliver(3_000);
            assert(d !== null, 'the tunnel on B got no deliver frame for the task created on A');
            assert((d!.payload as any)?.id === t.body.data.task.id && d!.kind === 'task_assigned', `deliver: ${short(d)}`);
        } finally { await tunnel.close(); }
    });

    await test('6. After the listening connections drop, B reads its settings again: a change no event announced is in force on B', async () => {
        if (!op || !nodeDb) skip('no setup');
        const pg = (await import('pg')).default;
        const admin = new pg.Client(nodeDb.dbUrl);
        await admin.connect();
        const register = (name: string) => json('B', '/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'x', password: 'E2eOwnerPass-2026' }) });
        try {
            // Registration closed in the database with no NOTIFY: a change whose event was lost.
            const row = await admin.query('UPDATE "SystemSetting" SET "value" = \'closed\' WHERE "key" = \'config:registration.mode\'');
            assert(row.rowCount === 1, `the stored registration setting (left by case 3): ${row.rowCount} row(s)`);
            await sleep(1_500);
            const unchanged = await register(`busgap${stamp}`);
            assert(unchanged.status === 201, `B applied a change no event announced, before any drop: ${unchanged.status} ${short(unchanged.body)}`);

            const dropped = await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity
                WHERE datname = current_database() AND pid <> pg_backend_pid() AND query = 'LISTEN aimeat_bus'`);
            assert((dropped.rowCount ?? 0) >= 2, `the listening connections of A and B: ${dropped.rowCount} dropped`);
            const droppedAt = Date.now();
            let reg = await register(`busgap${stamp}a`);
            for (let i = 0; reg.status === 201 && Date.now() - droppedAt < 15_000; i++) { await sleep(250); reg = await register(`busgap${stamp}b${i}`); }
            assert(reg.status !== 201, `B still registers new accounts ${Date.now() - droppedAt} ms after its listening connection dropped: ${reg.status} ${short(reg.body)}`);
            const listening = await admin.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND query = 'LISTEN aimeat_bus'`);
            assert(listening.rows[0].n >= 2, `A and B listen again: ${listening.rows[0].n}`);
        } finally {
            await admin.end();
            await json('A', '/v1/admin/config', { method: 'PUT', token: op.token, body: JSON.stringify({ changes: [{ path: 'registration.mode', value: 'open' }] }) });
        }
    });
} finally {
    for (const p of procs) if (p.exit() === null) p.proc.kill();
}

console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
process.exit(failed > 0 ? 1 : 0);
