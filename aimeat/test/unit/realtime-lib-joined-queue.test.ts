/**
 * @file realtime-lib-joined-queue.test.ts
 * @description The served /lib/realtime.js does not lose what an app does in the order its own header
 *   showed: connect(), then on(...), then broadcast(). A 'joined' handler registered after the room
 *   was joined used to wait for a frame that had already come and gone, and a broadcast sent while
 *   the socket was still opening was dropped without a word (curated pitfall
 *   realtime-handlers-before-connect). The lib is run in a VM with a fake WebSocket, the same way
 *   library-packs-doc-truth.test.ts runs it, so what is tested is the file that ships.
 * @version-history
 *   v1.1.0 — 2026-10-09 — connect() mints a single-use ticket (POST /v1/ws/ticket, faked here) and
 *     opens with ?ticket=, never ?token= (secrets audit 2026-10-09, d3); a refused ticket, a token-less
 *     connect and a disconnect during the fetch are covered; the existing cases await connect().
 *   v1.0.0 — 2026-09-13 — Initial.
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

/** Every fetch the lib made, and a fake POST /v1/ws/ticket that answers `ticket-<n>`. */
interface FetchCall { url: string; init: { method?: string; headers?: Record<string, string>; body?: string } }

function load(opts: { refuseTicket?: boolean } = {}) {
    const calls: FetchCall[] = [];
    let n = 0;
    const fetch = async (url: string, init: FetchCall['init'] = {}) => {
        calls.push({ url, init });
        if (opts.refuseTicket) {
            return { ok: false, status: 401, json: async () => ({ ok: false, error: { code: 'AUTH_REQUIRED', message: 'no' } }) };
        }
        n++;
        return { ok: true, status: 200, json: async () => ({ ok: true, data: { ticket: `ticket-${n}`, socket: 'realtime', expires: 60 } }) };
    };
    const sandbox: Record<string, unknown> = { console, WebSocket: FakeSocket, fetch };
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);
    return { AR: sandbox.AimeatRealtime as new (a: string, b: string | null) => any, calls };
}

describe('realtime.js: the session token never goes in the socket URL (secrets audit 2026-10-09, d3)', () => {
    it('connect() mints a realtime ticket with the bearer and opens with ?ticket=, not ?token=', async () => {
        const { AR, calls } = load();
        FakeSocket.last = null;
        const rt = new AR('https://node.example', 'jwt-secret-1');
        await rt.connect('room-t', 'alice');
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('https://node.example/v1/ws/ticket');
        expect(calls[0].init.method).toBe('POST');
        expect(calls[0].init.headers?.Authorization).toBe('Bearer jwt-secret-1');
        expect(JSON.parse(calls[0].init.body!)).toEqual({ socket: 'realtime' });
        const ws = FakeSocket.last!;
        expect(ws.url).toBe('wss://node.example/v1/realtime/ws?room=room-t&nick=alice&ticket=ticket-1');
        expect(ws.url).not.toContain('jwt-secret-1');
        expect(ws.url).not.toContain('token=');
    });

    it('without a token (anonymous mode) it connects bare and asks for no ticket', async () => {
        const { AR, calls } = load();
        const rt = new AR('http://node.example', null);
        await rt.connect('room-a', 'anon');
        expect(calls).toHaveLength(0);
        expect(FakeSocket.last!.url).toBe('ws://node.example/v1/realtime/ws?room=room-a&nick=anon');
    });

    it('a refused ticket emits error and close, opens no socket, and does not reject', async () => {
        const { AR } = load({ refuseTicket: true });
        FakeSocket.last = null;
        const rt = new AR('https://node.example', 'jwt');
        const events: string[] = [];
        rt.on('error', () => events.push('error'));
        rt.on('close', (e: any) => events.push(`close:${e.code}`));
        await rt.connect('room-x', 'alice');
        expect(FakeSocket.last).toBeNull();
        expect(events).toEqual(['error', 'close:4401']);
    });

    it('a disconnect() while the ticket is being fetched opens nothing', async () => {
        const { AR } = load();
        FakeSocket.last = null;
        const rt = new AR('https://node.example', 'jwt');
        const pending = rt.connect('room-d', 'alice');
        rt.disconnect();
        await pending;
        expect(FakeSocket.last).toBeNull();
    });
});

describe('realtime.js: the order an app writes things in does not lose frames', () => {
    it('a broadcast sent while the ticket is fetched and the socket is opening goes out once it opens', async () => {
        const { AR } = load();
        const rt = new AR('https://node.example', 'jwt');
        const pending = rt.connect('room-1', 'alice');
        rt.broadcast({ hello: 1 });
        await pending;
        const ws = FakeSocket.last!;
        expect(ws.sent).toHaveLength(0);
        ws.open();
        expect(ws.sent.map(s => JSON.parse(s))).toEqual([{ type: 'broadcast', payload: { hello: 1 } }]);
    });

    it('a joined handler registered after the room was joined is called with that join', async () => {
        const { AR } = load();
        const rt = new AR('https://node.example', 'jwt');
        await rt.connect('room-2', 'alice');
        const ws = FakeSocket.last!;
        ws.open();
        ws.deliver({ type: 'joined', peerId: 'p1', roomId: 'room-2', peers: [] });
        const seen: any[] = [];
        rt.on('joined', (m: any) => seen.push(m));
        expect(seen).toHaveLength(1);
        expect(seen[0].peerId).toBe('p1');
    });

    it('after the socket closes a late joined handler is not handed a stale join, and a send is not queued forever', async () => {
        const { AR } = load();
        const rt = new AR('https://node.example', 'jwt');
        await rt.connect('room-3', 'alice');
        const ws = FakeSocket.last!;
        ws.open();
        ws.deliver({ type: 'joined', peerId: 'p1', roomId: 'room-3', peers: [] });
        ws.readyState = FakeSocket.CLOSED;
        ws.onclose?.({ code: 1000, reason: '' });
        const seen: any[] = [];
        rt.on('joined', (m: any) => seen.push(m));
        expect(seen).toHaveLength(0);
        rt.broadcast({ late: true });
        expect(ws.sent.some(s => s.includes('late'))).toBe(false);
    });
});
