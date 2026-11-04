/**
 * @file test/e2e-graceful-shutdown.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A stop drains first. On a node of its own, with a live stream open and a request in
 *   flight (its body half sent), the suite stops the node and checks:
 *     - a request that started before the stop finishes with its normal answer;
 *     - GET /v1/health/ready asked on a connection opened before the stop answers 503 NOT_READY
 *       with phase `draining`;
 *     - a new connection is refused, so a load balancer tries the next process;
 *     - the live stream is ended within a few seconds, not held until a hard exit;
 *     - the buffered rows are written, and the process exits with code 0.
 *   The stop is SIGTERM where the system has one. Windows has no stop signal a process can catch
 *   (process.kill ends it at once), so there the suite sends the same stop over the IPC channel a
 *   test node listens on (src/index-start.ts, test mode only).
 *
 *   WHY. Until 2026-11-04 the stop kept accepting requests for its first 4 s, then cut them, and an
 *   open live stream kept server.close() from finishing, so every stop ended in the 5 s hard exit
 *   with code 1 (codebase analysis 2026-11-03, HA stage 1).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-graceful-shutdown
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, HA stage 1: drain-first shutdown).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { registerOwner } from './helpers/owner-login.js';

const PORT = 28746;
const BASE = `http://127.0.0.1:${PORT}`;
const NODE_ID = 'aimeat-graceful-stop-001';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.log(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

console.log('\n=== GRACEFUL SHUTDOWN E2E (a stop drains first, then exits 0) ===\n');

const dbDir = mkdtempSync(join(tmpdir(), 'aimeat-graceful-'));
const db = await ownNodeDb(String(PORT), { sqlitePath: join(dbDir, 'stop.db') });
let output = '';
const proc: ChildProcess = spawn(process.execPath, [...nodeEntryArgs(), 'start', ...db.args, '--port', String(PORT)], {
    cwd: process.cwd(),
    env: {
        ...process.env,
        ...db.env,
        AIMEAT_PORT: String(PORT),
        AIMEAT_BASE_URL: BASE,
        AIMEAT_NODE_ID: NODE_ID,
        AIMEAT_TEST_MODE: 'true',
        // The stop's own lines are logged at info.
        AIMEAT_LOG_LEVEL: 'info',
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
});
proc.stdout?.on('data', (c: Buffer) => { output += c.toString(); });
proc.stderr?.on('data', (c: Buffer) => { output += c.toString(); });
const exited = new Promise<number | null>((r) => { proc.once('exit', (code) => r(code)); });

function stopNode(): void {
    if (process.platform === 'win32') proc.send?.('aimeat:stop');
    else proc.kill('SIGTERM');
}

/** A POST whose body is sent in two halves: the first now, the second when `finish` is called. */
function halfSentPost(path: string, body: string): { finish: () => void; answer: Promise<{ status: number; body: string }> } {
    const bytes = Buffer.from(body);
    const cut = Math.floor(bytes.length / 2);
    let req: http.ClientRequest;
    const answer = new Promise<{ status: number; body: string }>((resolve) => {
        req = http.request(`${BASE}${path}`, {
            method: 'POST', agent: false,
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Length': String(bytes.length) },
        }, (res) => {
            let text = '';
            res.on('data', (c: Buffer) => { text += c.toString(); });
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }));
        });
        // Answered as status 0, so a cut connection fails the assertion instead of the suite.
        req.on('error', (err: NodeJS.ErrnoException) => resolve({ status: 0, body: `connection error: ${err.code ?? err.message}` }));
        req.write(bytes.subarray(0, cut));
    });
    return { finish: () => { req.end(bytes.subarray(cut)); }, answer };
}

/** A request whose headers are sent up to the last line now, and completed by `finish`. */
function halfSentGet(path: string): { finish: () => void; answer: Promise<string> } {
    const socket = net.connect(PORT, '127.0.0.1');
    let text = '';
    const answer = new Promise<string>((resolve) => {
        socket.on('data', (c: Buffer) => { text += c.toString(); });
        socket.on('end', () => resolve(text));
        socket.on('close', () => resolve(text));
        // Answered as text, so a cut connection fails the assertion instead of the suite.
        socket.on('error', (err: NodeJS.ErrnoException) => resolve(text || `connection error: ${err.code ?? err.message}`));
    });
    socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nAccept: application/json\r\n`);
    return { finish: () => { socket.write('\r\n'); }, answer };
}

try {
    await waitForServer(proc, BASE, { label: `the graceful-stop node on port ${PORT}` });

    const stamp = Date.now().toString(36).slice(-5);
    const owner = await registerOwner(BASE, `gsop${stamp}`);

    // A live stream, open before the stop.
    const ticketRes = await fetch(`${BASE}/v1/events/ticket`, { method: 'POST', headers: { Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/json' }, body: '{}' });
    const ticket = ((await ticketRes.json()) as any)?.data?.ticket as string;
    assert(ticket, `no stream ticket: ${ticketRes.status}`);
    let streamEndedAt = 0;
    const streamOpen = new Promise<void>((resolve, reject) => {
        const req = http.get(`${BASE}/v1/events?ticket=${encodeURIComponent(ticket)}`, { agent: false }, (res) => {
            res.once('data', () => resolve());
            const ended = () => { if (!streamEndedAt) streamEndedAt = Date.now(); };
            res.on('end', ended);
            res.on('close', ended);
            res.resume();
        });
        req.on('error', reject);
    });
    await streamOpen;

    // A request in flight across the stop, and a readiness probe whose headers end after it.
    const registration = halfSentPost('/v1/ghii', JSON.stringify({ username: `gsin${stamp}`, display_name: 'In flight', password: owner.password }));
    const probe = halfSentGet('/v1/health/ready');
    await sleep(300);

    const stoppedAt = Date.now();
    stopNode();
    await sleep(500);

    await test('a new connection after the stop is refused', async () => {
        const r = await fetch(`${BASE}/v1/health/ready`, { signal: AbortSignal.timeout(3_000) }).then((res) => `answered ${res.status}`, (err: Error) => `refused: ${String((err as any).cause?.code ?? err.message)}`);
        assert(r.startsWith('refused'), `a new connection was ${r}`);
    });

    await test('the readiness probe that began before the stop answers 503 NOT_READY, phase draining', async () => {
        probe.finish();
        const raw = await probe.answer;
        assert(/^HTTP\/1\.1 503/.test(raw), `probe answer: ${raw.slice(0, 200)}`);
        assert(raw.includes('"NOT_READY"') && raw.includes('"draining"'), `probe body: ${raw.slice(-300)}`);
    });

    await test('the request in flight finishes with its normal answer', async () => {
        registration.finish();
        const r = await registration.answer;
        assert(r.status === 201, `registration in flight: ${r.status} ${r.body.slice(0, 200)}`);
    });

    await test('the live stream is ended within 3 s of the stop', async () => {
        const deadline = stoppedAt + 3_000;
        while (!streamEndedAt && Date.now() < deadline) await sleep(100);
        assert(streamEndedAt > 0, 'the live stream was still open 3 s after the stop');
    });

    await test('the process writes its buffers and exits with code 0', async () => {
        const code = await Promise.race([exited, sleep(30_000).then(() => 'timeout' as const)]);
        assert(code === 0, `exit code ${String(code)}; last output: ${output.slice(-800)}`);
        assert(output.includes('Stop: buffered rows written'), `no buffer line: ${output.slice(-800)}`);
        assert(output.includes('Server closed'), `no close line: ${output.slice(-800)}`);
    });
} catch (err) {
    failed++;
    console.log(`  ❌ the suite could not run: ${(err as Error).message}\n${output.slice(-1500)}`);
} finally {
    if (proc.exitCode === null) proc.kill();
    try { rmSync(dbDir, { recursive: true, force: true }); } catch { /* a locked file on Windows; the temp dir is cleaned later */ }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
