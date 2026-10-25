/**
 * @file test/e2e-sse-revocation.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A live event stream (GET /v1/events) ends when the node stops honouring the credential
 *   that opened it (secaudit2026oct22, events-stream-outlives-revoked-credential). An agent's stream
 *   receives its domains while the agent exists; after the owner deletes the agent, the next change
 *   reaches the stream as an `event: revoked` frame and the stream ends, with no further domain frame.
 *   A stream whose credential stands keeps receiving its domains.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-sse-revocation
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22).
 */
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const stamp = Date.now();

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    return { status: res.status, body: ct.includes('json') ? await res.json() as any : { _raw: await res.text() } };
}

interface Stream { text(): string; ended(): boolean; close(): void }

async function openStream(token: string): Promise<Stream> {
    const t = await json('/v1/events/ticket', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    assert(t.status === 200 && !!t.body.data.ticket, `ticket: ${t.status} ${JSON.stringify(t.body)}`);
    const ctrl = new AbortController();
    const res = await fetch(`${BASE}/v1/events?ticket=${t.body.data.ticket}`, { signal: ctrl.signal });
    assert(res.status === 200, `stream status ${res.status}`);
    let buf = '';
    let done = false;
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    void (async () => {
        try {
            for (;;) {
                const { value, done: end } = await reader.read();
                if (end) break;
                if (value) buf += dec.decode(value, { stream: true });
            }
        } catch { /* aborted on close() */ }
        done = true;
    })();
    return { text: () => buf, ended: () => done, close: () => ctrl.abort() };
}

const memoryFrames = (text: string): number => text.split('\n')
    .filter(l => l.startsWith('data: '))
    .filter(l => { try { return (JSON.parse(l.slice(6)).domains ?? []).includes('memory'); } catch { return false; } }).length;

async function waitUntil(pred: () => boolean, ms: number, what: string): Promise<void> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) { if (pred()) return; await sleep(50); }
    throw new Error(`timed out after ${ms} ms waiting for ${what}`);
}

console.log('\n=== A live event stream ends when its credential is revoked (secaudit2026oct22) ===\n');

const owner = await registerOwner(BASE, `sserev${stamp}`);
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const write = (n: number) => json('/v1/memory', {
    method: 'POST', headers: bearer(owner.token), body: JSON.stringify({ key: `sserev.note.${n}`, value: { n }, visibility: 'private' }),
});
const doomed = await makeAgent(BASE, owner, ['memory:read'], `sserevd${stamp % 100000}`);
const kept = await makeAgent(BASE, owner, ['memory:read'], `sserevk${stamp % 100000}`);
let doomedStream!: Stream;
let keptStream!: Stream;

await test('Two agents\' streams receive the owner\'s memory domain', async () => {
    doomedStream = await openStream(doomed.token);
    keptStream = await openStream(kept.token);
    await sleep(300);
    const w = await write(1);
    assert(w.status === 201 || w.status === 200, `write: ${w.status} ${JSON.stringify(w.body?.error)}`);
    await waitUntil(() => memoryFrames(doomedStream.text()) >= 1 && memoryFrames(keptStream.text()) >= 1, 5000, 'a memory frame on both streams');
});

await test('FAILURE: another agent without agent:delete cannot delete it, and its stream stays open', async () => {
    const del = await json(`/v1/agents/${doomed.name}`, { method: 'DELETE', headers: bearer(kept.token) });
    assert(del.status === 403, `expected 403, got ${del.status} ${JSON.stringify(del.body?.error)}`);
    assert(!doomedStream.ended() && !doomedStream.text().includes('event: revoked'), 'the stream ended on a refused delete');
});

await test('FAILURE: after the agent is deleted, its stream gets a revoked frame and ends, with no further domain frame', async () => {
    const del = await json(`/v1/agents/${doomed.name}`, { method: 'DELETE', headers: bearer(owner.token) });
    assert(del.status === 200, `delete agent: ${del.status} ${JSON.stringify(del.body?.error)}`);
    const before = memoryFrames(doomedStream.text());
    // The stream asks again at most every few seconds; the change below comes after that interval.
    await sleep(6000);
    const w = await write(2);
    assert(w.status === 201 || w.status === 200, `write: ${w.status} ${JSON.stringify(w.body?.error)}`);
    await waitUntil(() => doomedStream.ended() || doomedStream.text().includes('event: revoked'), 5000, 'the revoked frame');
    await sleep(1500);
    assert(doomedStream.text().includes('event: revoked'), 'no revoked frame');
    assert(memoryFrames(doomedStream.text()) === before, `a domain frame reached the deleted agent's stream (${memoryFrames(doomedStream.text())} > ${before})`);
});

await test('The other agent\'s stream still receives the owner\'s memory domain', async () => {
    await waitUntil(() => memoryFrames(keptStream.text()) >= 2, 5000, 'the second memory frame on the kept stream');
    assert(!keptStream.text().includes('event: revoked'), 'the kept stream was told revoked');
});

doomedStream?.close();
keptStream?.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
