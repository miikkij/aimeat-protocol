/**
 * @file test/unit/tunnel-lib-ticket.test.ts
 * @description The served personal-tunnel lib (/v1/libs/aimeat-tunnel.js) opens its socket with a
 *   single-use ticket and never with the session jwt in the URL, where reverse proxies logged it
 *   (secrets audit 2026-10-09, d3). The shipped bundle (src/static/sdk-libs/dist/aimeat-tunnel.js)
 *   is run in a VM with a fake WebSocket, fetch and AIMEAT.auth session, so what is tested is the
 *   file that is served.
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(root, 'src/static/sdk-libs/dist/aimeat-tunnel.js'), 'utf8');

const JWT = 'jwt-canary-tunnel-51c2';

function load(opts: { refuseTicket?: boolean } = {}) {
  const sockets: string[] = [];
  const calls: Array<{ url: string; init: any }> = [];
  class FakeSocket {
    static OPEN = 1;
    readyState = 0;
    onopen: (() => void) | null = null;
    onmessage: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(url: string) { sockets.push(url); }
    send() { /* not used here */ }
    close() { /* not used here */ }
  }
  const fetch = async (url: string, init: any) => {
    calls.push({ url, init });
    if (opts.refuseTicket) return { ok: false, status: 401, json: async () => ({ ok: false, error: { message: 'refused' } }) };
    return { ok: true, status: 200, json: async () => ({ ok: true, data: { ticket: 'tkt-1', socket: 'personal-tunnel', expires: 60 } }) };
  };
  const window: Record<string, any> = {
    __AIMEAT_SDK_CFG__: { nodeId: 'n', baseUrl: 'https://node.example' },
    AIMEAT: { auth: { getSession: () => ({ jwt: JWT }) } },
  };
  const sandbox: Record<string, any> = {
    window,
    document: { querySelector: () => null },
    location: { protocol: 'https:', origin: 'https://node.example' },
    WebSocket: FakeSocket,
    fetch,
    console,
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000000' },
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => undefined,
  };
  window.window = window;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return { tunnel: window.AIMEAT.tunnel, sockets, calls };
}

const tick = () => new Promise(r => setTimeout(r, 0));

describe('aimeat-tunnel.js: the session jwt never goes in the socket URL', () => {
  it('connect() POSTs /v1/ws/ticket with the bearer and opens with ?ticket=', async () => {
    const { tunnel, sockets, calls } = load();
    const client = tunnel.create({ reconnect: false });
    client.connect();
    for (let i = 0; i < 5 && sockets.length === 0; i++) await tick();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://node.example/v1/ws/ticket');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${JWT}`);
    expect(JSON.parse(calls[0].init.body)).toEqual({ socket: 'personal-tunnel' });
    expect(sockets).toEqual(['wss://node.example/v1/personal/tunnel?ticket=tkt-1']);
    expect(sockets.join(' ')).not.toContain(JWT);
    client.close();
  });

  it('a refused ticket goes offline, reports the error and opens no socket', async () => {
    const { tunnel, sockets } = load({ refuseTicket: true });
    const errors: unknown[] = [];
    const client = tunnel.create({ reconnect: false, onError: (e: unknown) => errors.push(e) });
    client.connect();
    for (let i = 0; i < 5 && errors.length === 0; i++) await tick();
    expect(sockets).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(client.getStatus()).toBe('offline');
  });
});
