/**
 * @file test/unit/connect-tunnel-heartbeat.test.ts
 * @description One heartbeat per socket keeps EVERY identity on that socket alive.
 *
 *   THE DEFECT. The connector sends a single, unstamped heartbeat per connection, so on the node
 *   it resolves to the socket's opener, and until 2026-09-05 only the opener's `lastHeartbeat`
 *   moved. Every ATTACHED identity kept the timestamp from its attach, aged past
 *   `connectTunnelOfflineThresholdMs`, and the monitor judged it silent and closed its ws — which
 *   is the SHARED ws. A socket carrying two or more identities was therefore torn down about one
 *   threshold after the first attach, every time, and each reconnect re-attached the whole fleet:
 *   one mint per identity, in a burst, against a per-minute budget. Found by an adversarial review
 *   the same day the mint-budget refusal was fixed on the client, which is how the two compounded.
 *
 *   THE FAKE IS THE NODE'S OWN ENTRY POINTS. `handleConnection` is called with a stand-in ws, the
 *   attached identity is registered exactly as `handleAttach` registers one (mirrored on the
 *   private index and map, because the real path verifies a JWT this test has no business minting),
 *   and the heartbeat arrives as a `message` event the way it does over the wire. The monitor runs
 *   on fake timers, so a ninety-second threshold is asserted in milliseconds.
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial, with the fix it exists to hold.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { ConnectTunnelManager } from '../../src/services/connect-tunnel.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';
import type { VerifiedToken } from '../../src/auth/jwt.js';

const OPENER = 'concierge#alice@node';
const RIDER = 'news-fetcher#bob@node';

/** The seven fields the manager reads. Threshold small, interval at the monitor's own floor. */
const config = {
  nodeId: 'node',
  port: 0,
  connectTunnelHeartbeatIntervalMs: 10_000,
  connectTunnelOfflineThresholdMs: 5_000,
  connectTunnelRequestTimeoutMs: 30_000,
  connectTunnelMaxInflightPerIdentity: 8,
  connectTunnelMaxResponseBytes: 1_000_000,
} as unknown as AimeatConfig;

/** A ws the manager can register, send to, close, and hear messages from. */
class FakeWs extends EventEmitter {
  readyState = 1;
  sent: unknown[] = [];
  closed: Array<{ code: number; reason: string }> = [];
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close(code: number, reason: string) { this.closed.push({ code, reason }); this.readyState = 3; }
}

const token = (sub: string): VerifiedToken =>
  ({ sub, owner: sub.split('#')[1]?.split('@')[0] ?? sub, roles: ['agent'], scopes: ['*'], exp: Math.floor(Date.now() / 1000) + 3600 } as unknown as VerifiedToken);

/** Opener on a socket, RIDER attached to it, both with a lastHeartbeat of `at`. */
function fixture(at: number) {
  const mgr = new ConnectTunnelManager(config, {} as Storage);
  const ws = new FakeWs();
  mgr.handleConnection(ws as never, token(OPENER), 'raw-opener');
  const internals = mgr as unknown as {
    connections: Map<string, { socketId: string; lastHeartbeat: number; ws: FakeWs }>;
    sockets: { attach(socketId: string, principal: string): boolean };
    heartbeatInterval: ReturnType<typeof setInterval> | null;
  };
  const opener = internals.connections.get(OPENER)!;
  // Registered the way handleAttach registers one, minus the JWT verification.
  internals.sockets.attach(opener.socketId, RIDER);
  internals.connections.set(RIDER, { ...opener, principal: RIDER, identity: token(RIDER), rawToken: 'raw-rider', lastHeartbeat: at } as never);
  opener.lastHeartbeat = at;
  return { mgr, ws, internals, opener, rider: internals.connections.get(RIDER)! };
}

afterEach(() => { vi.useRealTimers(); });

describe('one heartbeat per socket', () => {
  it('refreshes every identity riding the socket, not only the one that sent it', () => {
    const stale = Date.now() - 60_000;
    const { ws, opener, rider } = fixture(stale);
    // Unstamped, exactly as the connector sends it: the node resolves it to the opener.
    ws.emit('message', JSON.stringify({ type: 'heartbeat', id: 'hb-1' }));
    expect(opener.lastHeartbeat).toBeGreaterThan(stale);
    // THE LINE THAT WAS FALSE. The rider never sends a heartbeat of its own, and before the fix
    // nothing else moved its clock.
    expect(rider.lastHeartbeat).toBeGreaterThan(stale);
    expect(rider.lastHeartbeat).toBe(opener.lastHeartbeat);
  });

  it('so the monitor no longer closes a shared socket for a rider that was alive all along', () => {
    vi.useFakeTimers();
    const { mgr, ws, internals } = fixture(Date.now());
    mgr.startHeartbeatMonitor();
    // The socket heartbeats every 4 s, inside the 5 s threshold, for a minute.
    for (let i = 0; i < 15; i++) {
      vi.advanceTimersByTime(4_000);
      ws.emit('message', JSON.stringify({ type: 'heartbeat', id: `hb-${i}` }));
    }
    // Before the fix the first monitor tick after 5 s found RIDER silent and closed THIS ws —
    // the one every identity on the socket was riding.
    expect(ws.closed).toEqual([]);
    expect(internals.connections.has(RIDER)).toBe(true);
    expect(internals.connections.has(OPENER)).toBe(true);
    clearInterval(internals.heartbeatInterval!);
  });

  it('and still closes a socket that genuinely went silent', () => {
    // The fix must not disable the monitor. No heartbeat at all for longer than the threshold is
    // exactly the case it exists for.
    vi.useFakeTimers();
    const { mgr, ws, internals } = fixture(Date.now());
    mgr.startHeartbeatMonitor();
    vi.advanceTimersByTime(20_000);
    expect(ws.closed.length).toBeGreaterThan(0);
    expect(ws.closed[0].reason).toBe('heartbeat_timeout');
    clearInterval(internals.heartbeatInterval!);
  });
});
