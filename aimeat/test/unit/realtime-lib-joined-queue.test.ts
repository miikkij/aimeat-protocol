/**
 * @file realtime-lib-joined-queue.test.ts
 * @description The served /lib/realtime.js does not lose what an app does in the order its own header
 *   showed: connect(), then on(...), then broadcast(). A 'joined' handler registered after the room
 *   was joined used to wait for a frame that had already come and gone, and a broadcast sent while
 *   the socket was still opening was dropped without a word (curated pitfall
 *   realtime-handlers-before-connect). The lib is run in a VM with a fake WebSocket, the same way
 *   library-packs-doc-truth.test.ts runs it, so what is tested is the file that ships.
 * @version-history
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

function load() {
    const sandbox: Record<string, unknown> = { console, WebSocket: FakeSocket };
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);
    return sandbox.AimeatRealtime as new (a: string, b: string) => any;
}

describe('realtime.js: the order an app writes things in does not lose frames', () => {
    it('a broadcast sent while the socket is still opening goes out once it opens', () => {
        const AR = load();
        const rt = new AR('https://node.example', 'jwt');
        rt.connect('room-1', 'alice');
        rt.broadcast({ hello: 1 });
        const ws = FakeSocket.last!;
        expect(ws.sent).toHaveLength(0);
        ws.open();
        expect(ws.sent.map(s => JSON.parse(s))).toEqual([{ type: 'broadcast', payload: { hello: 1 } }]);
    });

    it('a joined handler registered after the room was joined is called with that join', () => {
        const AR = load();
        const rt = new AR('https://node.example', 'jwt');
        rt.connect('room-2', 'alice');
        const ws = FakeSocket.last!;
        ws.open();
        ws.deliver({ type: 'joined', peerId: 'p1', roomId: 'room-2', peers: [] });
        const seen: any[] = [];
        rt.on('joined', (m: any) => seen.push(m));
        expect(seen).toHaveLength(1);
        expect(seen[0].peerId).toBe('p1');
    });

    it('after the socket closes a late joined handler is not handed a stale join, and a send is not queued forever', () => {
        const AR = load();
        const rt = new AR('https://node.example', 'jwt');
        rt.connect('room-3', 'alice');
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
