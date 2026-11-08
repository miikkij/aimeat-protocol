/**
 * @file test/unit/connect-tunnel-cross-process.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A tunnel decision made on another process of the node reaches the socket this process
 *   holds (services/connect-tunnel-cross-process.ts; secaudit2026nov08 round 14,
 *   connect-tunnel-revocation.ts:revoke-process-local-while-bus-delivers-cross-process). The manager
 *   here is process B: it holds the agent's socket, and the decision arrives as an event of another
 *   process (emitRemote), the way services/bus-relay.ts tells it. Covered: agent rekeyed, deleted and
 *   moved, account deactivated, token revoked (by its id), agent stopped and started, a permission
 *   change. After a revocation, a delivery for the agent that arrives from the other process is not
 *   pushed. The manager's own decisions go out on the channel and are not applied twice here; a
 *   decision for another node is ignored. test/e2e-two-process-bus.ts runs it over PostgreSQL.
 * @usage cd aimeat && pnpm exec vitest run test/unit/connect-tunnel-cross-process.test.ts
 * @version-history
 *   v1.0.0 -- 2026-11-08 -- Initial (secaudit2026nov08 round 14).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { ConnectTunnelManager } from '../../src/services/connect-tunnel.js';
import { emitRemote, onTunnelControlEvent, offTunnelControlEvent, type TunnelControlEvent } from '../../src/services/event-bus.js';
import { tokenIdOf, type VerifiedToken } from '../../src/auth/jwt.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';

const NODE = 'node';
const AGENT = 'helper#alice@node';
const OTHER = 'scout#bob@node';
const RAW = 'header.payload.signature';

const config = {
  nodeId: NODE, port: 0,
  connectTunnelHeartbeatIntervalMs: 10_000, connectTunnelOfflineThresholdMs: 5_000, connectTunnelRequestTimeoutMs: 30_000,
  connectTunnelMaxInflightPerIdentity: 8, connectTunnelMaxResponseBytes: 1_000_000,
} as unknown as AimeatConfig;

class FakeWs extends EventEmitter {
  readyState = 1;
  sent: Array<Record<string, unknown>> = [];
  closed: Array<{ code: number; reason: string }> = [];
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close(code: number, reason: string) { this.closed.push({ code, reason }); this.readyState = 3; }
}

const token = (sub: string): VerifiedToken =>
  ({ sub, owner: sub.split('#')[1]?.split('@')[0] ?? sub, roles: ['agent'], scopes: ['*'], exp: Math.floor(Date.now() / 1000) + 3600 } as unknown as VerifiedToken);

const managers: ConnectTunnelManager[] = [];
afterEach(async () => { while (managers.length) await managers.pop()!.shutdown(); });

/** Process B: the agent's socket is held here; a second owner's agent rides its own socket. */
function processB() {
  const storage = { listAgentTasks: async () => [], getAgentTasks: async () => [], listMessages: async () => [] } as unknown as Storage;
  const mgr = new ConnectTunnelManager(config, storage);
  managers.push(mgr);
  const ws = new FakeWs();
  const other = new FakeWs();
  mgr.handleConnection(ws as never, token(AGENT), RAW);
  mgr.handleConnection(other as never, token(OTHER), 'other.raw.token');
  const frames = (t: string) => ws.sent.filter(f => f.type === t);
  return { mgr, ws, other, frames };
}

const fromOtherProcess = (evt: Record<string, unknown>, nodeId = NODE) =>
  emitRemote('tunnelControl', { ...evt, nodeId, timestamp: Date.now() });
const deliveryFromOtherProcess = (id: string) =>
  emitRemote('delivery', { target: AGENT, kind: 'task_assigned', id, payload: { id, title: 'secret task' }, timestamp: Date.now() });

describe('a revocation made on another process', () => {
  it('a rekey there detaches the socket here, and a later delivery is not pushed', () => {
    const b = processB();
    deliveryFromOtherProcess('t-before');
    expect(b.frames('deliver').map(f => f.id)).toEqual(['t-before']);   // the delivery path works

    fromOtherProcess({ op: 'gaii', gaii: AGENT, reason: 'rekeyed' });
    expect(b.frames('auth_revoked')).toHaveLength(1);
    expect(b.mgr.isConnected(AGENT)).toBe(false);
    deliveryFromOtherProcess('t-after');
    expect(b.frames('deliver').map(f => f.id)).toEqual(['t-before']);
    expect(b.mgr.isConnected(OTHER)).toBe(true);                       // nobody else is touched
  });

  it('an agent deleted or moved there is told the reason here', () => {
    const b = processB();
    fromOtherProcess({ op: 'gaii', gaii: AGENT, reason: 'moved' });
    expect(b.frames('auth_revoked')[0]).toMatchObject({ agent: AGENT, reason: 'moved' });
    const c = processB();
    fromOtherProcess({ op: 'gaii', gaii: AGENT, reason: 'deleted' });
    expect(c.frames('auth_revoked')[0]).toMatchObject({ agent: AGENT, reason: 'deleted' });
  });

  it('an account deactivated there closes every socket of that account here, and no other', () => {
    const b = processB();
    fromOtherProcess({ op: 'owner', owner: 'alice' });
    expect(b.mgr.isConnected(AGENT)).toBe(false);
    expect(b.mgr.isConnected(OTHER)).toBe(true);
  });

  it('a token revoked there, named by its id, closes the socket that holds it here', () => {
    const b = processB();
    fromOtherProcess({ op: 'token', tokenId: tokenIdOf(RAW) });
    expect(b.frames('auth_revoked')).toHaveLength(1);
    expect(b.mgr.isConnected(AGENT)).toBe(false);
  });

  it('a decision for another node is ignored', () => {
    const b = processB();
    fromOtherProcess({ op: 'gaii', gaii: AGENT, reason: 'deleted' }, 'another-node');
    expect(b.mgr.isConnected(AGENT)).toBe(true);
  });
});

describe('a stop and a permission change made on another process', () => {
  it('a stopped agent takes no wake delivery here; a start lets it through again', () => {
    const b = processB();
    fromOtherProcess({ op: 'stopped', gaii: AGENT, stopped: true });
    expect(b.mgr.stoppedOf(AGENT)).toBe(true);
    deliveryFromOtherProcess('t-stopped');
    expect(b.frames('deliver')).toHaveLength(0);
    fromOtherProcess({ op: 'stopped', gaii: AGENT, stopped: false });
    expect(b.mgr.stoppedOf(AGENT)).toBe(false);
  });

  it('a permission change is told to the socket here without detaching it', () => {
    const b = processB();
    fromOtherProcess({ op: 'scopes', gaii: AGENT });
    expect(b.frames('scopes_changed')).toHaveLength(1);
    expect(b.mgr.isConnected(AGENT)).toBe(true);
  });
});

describe('this process\'s own decisions', () => {
  it('apply here once and go out to the other processes', () => {
    const b = processB();
    const heard: TunnelControlEvent[] = [];
    const listen = (e: TunnelControlEvent) => { heard.push(e); };
    onTunnelControlEvent(listen);
    try {
      b.mgr.notifyScopesChanged(AGENT);
      b.mgr.setStopped(AGENT, true);
      b.mgr.closeForGaii(AGENT, 'rekeyed');
      b.mgr.onTokenRevoked('other.raw.token');
      b.mgr.closeForOwner('carol');
    } finally { offTunnelControlEvent(listen); }
    expect(b.frames('scopes_changed')).toHaveLength(1);
    expect(b.frames('auth_revoked')).toHaveLength(1);
    expect(heard.map(e => e.op)).toEqual(['scopes', 'stopped', 'gaii', 'token', 'owner']);
    expect(heard.every(e => e.nodeId === NODE)).toBe(true);
    // The token itself never goes out: only its id.
    expect(JSON.stringify(heard)).not.toContain('other.raw.token');
    expect(heard.find(e => e.op === 'token')).toMatchObject({ tokenId: tokenIdOf('other.raw.token') });
  });
});
