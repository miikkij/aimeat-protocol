/**
 * @file realtime-lib-clock-chunks.test.ts
 * @description What realtime apps kept building themselves (Band Jam 4.x did all three), now in the
 *   served /lib/realtime.js: a frame over the relay's 16 KB limit goes in parts and arrives whole,
 *   pace() keeps a burst under the relay's per-peer rate instead of losing it, and SharedClock
 *   measures two machines' clock offset, turns a peer's t0 into this clock and schedules each step
 *   once, ahead of time, through a tempo change. The lib is run in a VM with a fake WebSocket, the way
 *   realtime-lib-joined-queue.test.ts runs it, so what is tested is the file that ships.
 * @version-history
 *   v1.0.0 — 2026-10-22 — Initial (realtime.js 1.5.0, session cc-jouni-audioclock-1022).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(root, 'public/lib/realtime.js'), 'utf8');

class FakeSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;
    static last: FakeSocket | null = null;
    readyState = FakeSocket.CONNECTING;
    sent: string[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    onclose: ((e: { code: number; reason: string }) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    constructor(public url: string) { FakeSocket.last = this; }
    send(data: string) { this.sent.push(data); }
    close() { this.readyState = FakeSocket.CLOSED; }
    open() { this.readyState = FakeSocket.OPEN; this.onopen?.(); }
    deliver(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }); }
}

function load() {
    const fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, data: { ticket: 't', socket: 'realtime', expires: 60 } }) });
    const sandbox: Record<string, unknown> = { console, WebSocket: FakeSocket, fetch, setTimeout, clearTimeout, setInterval, clearInterval };
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);
    return { AR: sandbox.AimeatRealtime as any, SC: sandbox.SharedClock as any };
}
async function openRoom(AR: any) {
    const rt = new AR('https://node.example', 'jwt');
    await rt.connect('room', 'alice');
    const ws = FakeSocket.last!;
    ws.open();
    ws.deliver({ type: 'joined', peerId: 'me', roomId: 'room', peers: [{ peerId: 'bob', nick: 'bob' }] });
    return { rt, ws };
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('realtime.js: a frame over the relay limit goes in parts and arrives whole', () => {
    it('a 60 KB broadcast is sent as part frames, each well under 16 KB', async () => {
        const { AR } = load();
        const { rt, ws } = await openRoom(AR);
        const song = { type: 'ops', ops: Array.from({ length: 3000 }, (_, i) => ['c.p0.1.' + i, ['C4', 100, 'A', 55], i, 'peer"quoted"']) };
        rt.broadcast(song);
        const frames = ws.sent.map(s => JSON.parse(s));
        expect(frames.length).toBeGreaterThan(4);
        for (const [i, s] of ws.sent.entries()) expect(new TextEncoder().encode(s).length, 'frame ' + i).toBeLessThan(16 * 1024);
        expect(frames.every(f => f.type === 'broadcast' && f.payload.type === 'part' && f.payload.n === frames.length)).toBe(true);
    });

    it('the parts are joined before any handler sees them, in any order, once', async () => {
        const { AR } = load();
        const sender = await openRoom(AR);
        const big = { type: 'snap', blob: 'x'.repeat(45000), n: 7 };
        sender.rt.broadcast(big);
        const parts = sender.ws.sent.map(s => JSON.parse(s).payload);
        const receiver = await openRoom(AR);
        const seen: any[] = [];
        receiver.rt.on('broadcast', (m: any) => seen.push(m));
        for (const p of [...parts].reverse()) receiver.ws.deliver({ type: 'broadcast', from: 'bob', payload: p });
        receiver.ws.deliver({ type: 'broadcast', from: 'bob', payload: parts[0] });   // a duplicate after the whole
        expect(seen).toHaveLength(1);
        expect(seen[0].from).toBe('bob');
        expect(seen[0].payload).toEqual(big);
    });

    it('a small frame is sent as it is', async () => {
        const { AR } = load();
        const { rt, ws } = await openRoom(AR);
        rt.broadcast({ type: 'note', note: 'C4' });
        rt.signal('bob', { type: 'data', payload: { type: 'ping', t: 1 } });
        expect(ws.sent.map(s => JSON.parse(s))).toEqual([
            { type: 'broadcast', payload: { type: 'note', note: 'C4' } },
            { type: 'signal', to: 'bob', payload: { type: 'data', payload: { type: 'ping', t: 1 } } },
        ]);
    });
});

describe('realtime.js: pace() queues a burst instead of losing it', () => {
    it('at 50 frames a second, 6 broadcasts leave in order, spread over about 100 ms', async () => {
        const { AR } = load();
        const { rt, ws } = await openRoom(AR);
        rt.pace(50);
        const t0 = Date.now();
        for (let i = 0; i < 6; i++) rt.broadcast({ type: 'n', i });
        expect(ws.sent).toHaveLength(1);
        while (ws.sent.length < 6 && Date.now() - t0 < 1000) await sleep(5);
        expect(ws.sent.map(s => JSON.parse(s).payload.i)).toEqual([0, 1, 2, 3, 4, 5]);
        expect(Date.now() - t0).toBeGreaterThanOrEqual(90);
    });
});

/** Two SharedClocks whose machines disagree by `skew` ms, joined by a fake room that delivers signals. */
function pair(SC: any, skew: number) {
    let now = 1_000_000;
    const handlers: Record<string, Record<string, Function[]>> = { a: {}, b: {} };
    const room = (me: 'a' | 'b', other: 'a' | 'b') => ({
        peers: new Map([[other, { nick: other }]]),
        on(ev: string, h: Function) { (handlers[me][ev] ||= []).push(h); },
        off(ev: string, h: Function) { handlers[me][ev] = (handlers[me][ev] || []).filter(x => x !== h); },
        signal(to: string, payload: unknown) { for (const h of handlers[to][ 'signal'] || []) h({ type: 'signal', from: me, payload }); },
    });
    const a = new SC({ bpm: 120, now: () => now });
    const b = new SC({ bpm: 120, now: () => now + skew });
    a.measure(room('a', 'b'), { every: 1e9 });
    b.measure(room('b', 'a'), { every: 1e9 });
    return { a, b, tick: (ms: number) => { now += ms; } };
}

describe('SharedClock: offsets, adopting a peer\'s t0, steps placed ahead', () => {
    it('measures a 750 ms skew and turns the peer\'s t0 into this clock', () => {
        const { SC } = load();
        const { a, b } = pair(SC, 750);
        a.ping('b', 1);
        expect(Math.round(a.offsetOf('b'))).toBe(750);
        expect(a.rttOf('b')).toBe(0);
        const play = b.start();                       // b's t0 is on b's clock
        a.adopt(play, 'b');
        expect(a.t0).toBe(play.t0 - 750);
        expect(a.playing).toBe(true);
        a.destroy(); b.destroy();
    });

    it('without a peer id adopt() keeps the old behaviour (t0 taken as it is)', () => {
        const { SC } = load();
        const c = new SC({ bpm: 100 });
        c.adopt({ type: 'transport', state: 'play', t0: 12345, bpm: 90 });
        expect(c.t0).toBe(12345);
        expect(c.bpm).toBe(90);
        c.destroy();
    });

    it('schedule() places every step once, ahead of time, and keeps counting through a tempo change', () => {
        const { SC } = load();
        let now = 5_000_000;
        const c = new SC({ bpm: 120, now: () => now });
        const got: Array<[number, number]> = [];
        c.start(now);
        c.schedule((n: number, at: number) => got.push([n, at]), { lookahead: 100, interval: 1e9 });
        const run = (ms: number) => { for (let t = 0; t < ms; t += 25) { now += 25; c._tick(c._sched); } };
        run(1000);                                   // 125 ms steps: steps 0..8 placed by 1000 + 100 ms
        expect(got.map(g => g[0])).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
        for (const [n, at] of got) expect(at).toBe(5_000_000 + n * 125);
        c.setBpm(240);                               // 62.5 ms steps from here, no step repeated
        run(500);
        const steps = got.map(g => g[0]);
        expect(new Set(steps).size).toBe(steps.length);
        expect(steps).toEqual(Array.from({ length: steps.length }, (_, i) => i));
        expect(steps.length).toBeGreaterThan(14);
        c.stop();
        const before = got.length;
        run(300);
        expect(got.length).toBe(before);
        c.destroy();
    });

    it('with an AudioContext the callback gets the step on its clock', () => {
        const { SC } = load();
        let now = 1_000;
        const audio = { currentTime: 42 };
        const c = new SC({ bpm: 120, now: () => now });
        const got: number[] = [];
        c.start(now + 50);
        c.schedule((_n: number, _at: number, atAudio: number) => got.push(atAudio), { lookahead: 100, audio, interval: 1e9 });
        expect(got[0]).toBeCloseTo(42.05, 5);
        c.destroy();
    });
});
