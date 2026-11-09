/**
 * @file test/unit/connect-tunnel-recheck.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A revocation or a stop decided on another process, whose tunnelControl event was lost,
 *   is in force on the process that holds the socket within HELD_IDENTITY_RECHECK_MS
 *   (services/connect-tunnel/recheck.ts; secaudit2026nov08b round 15,
 *   connect-tunnel/cross-process.ts:tunnel-control-lost-event-unbounded). The manager here is process
 *   B on a node with several processes: no event reaches it, the credential check answers what the
 *   storage now says, and the timer is what applies it. A valid connector keeps its socket and its
 *   deliveries across the rounds; with one process per node (the default) no round runs.
 * @usage cd aimeat && pnpm exec vitest run test/unit/connect-tunnel-recheck.test.ts
 * @version-history
 *   v1.0.0 -- 2026-11-08 -- Initial (secaudit2026nov08b round 15).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const revoked = new Set<string>();
const checked: string[] = [];
vi.mock('../../src/auth/credential-revoked.js', () => ({
  credentialRevoked: async (token: string) => { checked.push(token); return revoked.has(token); },
}));

const { ConnectTunnelManager } = await import('../../src/services/connect-tunnel.js');
const { HELD_IDENTITY_RECHECK_MS } = await import('../../src/services/connect-tunnel/recheck.js');
const { emitRemote } = await import('../../src/services/event-bus.js');
import type { VerifiedToken } from '../../src/auth/jwt.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';

const NODE = 'node';
const AGENT = 'helper#alice@node';
const OTHER = 'scout#bob@node';
const RAW = 'header.payload.signature';
const OTHER_RAW = 'other.raw.token';

const configFor = (nodeProcesses?: 'single' | 'multiple') => ({
  nodeId: NODE, port: 0, ...(nodeProcesses ? { nodeProcesses } : {}),
  connectTunnelHeartbeatIntervalMs: 10_000, connectTunnelOfflineThresholdMs: 1_000_000_000, connectTunnelRequestTimeoutMs: 30_000,
  connectTunnelMaxInflightPerIdentity: 8, connectTunnelMaxResponseBytes: 1_000_000,
} as unknown as AimeatConfig);

class FakeWs extends EventEmitter {
  readyState = 1;
  sent: Array<Record<string, unknown>> = [];
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; }
}

const token = (sub: string): VerifiedToken =>
  ({ sub, owner: sub.split('#')[1]?.split('@')[0] ?? sub, roles: ['agent'], scopes: ['*'], exp: Math.floor(Date.now() / 1000) + 3600 } as unknown as VerifiedToken);

type Manager = InstanceType<typeof ConnectTunnelManager>;
const managers: Manager[] = [];
beforeEach(() => { vi.useFakeTimers(); revoked.clear(); checked.length = 0; });
afterEach(async () => { while (managers.length) await managers.pop()!.shutdown(); vi.useRealTimers(); });

/** Process B, holding AGENT's socket and OTHER's. `stoppedAt` is what the agent records say now. */
async function processB(nodeProcesses?: 'single' | 'multiple') {
  const records: Record<string, { stoppedAt?: string | null }> = { [AGENT]: { stoppedAt: null }, [OTHER]: { stoppedAt: null } };
  const storage = {
    listAgentTasks: async () => ({ tasks: [] }), getAgentTasks: async () => [], listMessages: async () => [],
    listPendingMessages: async () => [], getAgent: async (gaii: string) => records[gaii] ?? null,
  } as unknown as Storage;
  const mgr = new ConnectTunnelManager(configFor(nodeProcesses), storage);
  managers.push(mgr);
  mgr.startHeartbeatMonitor();
  const ws = new FakeWs();
  const other = new FakeWs();
  mgr.handleConnection(ws as never, token(AGENT), RAW);
  mgr.handleConnection(other as never, token(OTHER), OTHER_RAW);
  await vi.advanceTimersByTimeAsync(0);
  const frames = (w: FakeWs, t: string) => w.sent.filter(f => f.type === t);
  return { mgr, ws, other, records, frames };
}

let n = 0;
const deliveryFromOtherProcess = (target = AGENT) => {
  const id = `t-${++n}`;
  emitRemote('delivery', { target, kind: 'task_assigned', id, payload: { id, title: 'secret task' }, timestamp: Date.now() });
  return id;
};

describe('several processes: a decision whose event was lost', () => {
  it('a token revoked on another process: the socket here is told and detached within the bound, and a later delivery is not pushed', async () => {
    const b = await processB('multiple');
    revoked.add(RAW);                                   // revoked on A; the tunnelControl event never came
    const before = deliveryFromOtherProcess();
    expect(b.frames(b.ws, 'deliver').map(f => f.id)).toEqual([before]);   // the gap

    await vi.advanceTimersByTimeAsync(HELD_IDENTITY_RECHECK_MS);
    expect(b.frames(b.ws, 'auth_revoked')).toHaveLength(1);
    expect(b.mgr.isConnected(AGENT)).toBe(false);
    deliveryFromOtherProcess();
    expect(b.frames(b.ws, 'deliver').map(f => f.id)).toEqual([before]);
    expect(b.mgr.isConnected(OTHER)).toBe(true);        // nobody else is touched
  });

  it('an agent stopped on another process takes no wake delivery here after the bound; a start lets it through again', async () => {
    const b = await processB('multiple');
    b.records[AGENT] = { stoppedAt: new Date().toISOString() };
    await vi.advanceTimersByTimeAsync(HELD_IDENTITY_RECHECK_MS);
    expect(b.mgr.stoppedOf(AGENT)).toBe(true);
    deliveryFromOtherProcess();
    expect(b.frames(b.ws, 'deliver')).toHaveLength(0);

    b.records[AGENT] = { stoppedAt: null };
    await vi.advanceTimersByTimeAsync(HELD_IDENTITY_RECHECK_MS);
    expect(b.mgr.stoppedOf(AGENT)).toBe(false);
    const after = deliveryFromOtherProcess();
    expect(b.frames(b.ws, 'deliver').map(f => f.id)).toEqual([after]);
  });

  it('each round asks every held credential once', async () => {
    await processB('multiple');
    await vi.advanceTimersByTimeAsync(HELD_IDENTITY_RECHECK_MS * 3);
    expect(checked.filter(t => t === RAW)).toHaveLength(3);
    expect(checked.filter(t => t === OTHER_RAW)).toHaveLength(3);
  });
});

describe('the uses that stay as they were', () => {
  it('a valid connector keeps its socket and its deliveries across the rounds', async () => {
    const b = await processB('multiple');
    await vi.advanceTimersByTimeAsync(HELD_IDENTITY_RECHECK_MS * 3);
    expect(b.mgr.isConnected(AGENT)).toBe(true);
    expect(b.frames(b.ws, 'auth_revoked')).toHaveLength(0);
    const id = deliveryFromOtherProcess();
    expect(b.frames(b.ws, 'deliver').map(f => f.id)).toEqual([id]);
  });

  it('one process per node, the default: no round runs', async () => {
    const b = await processB();
    revoked.add(RAW);
    await vi.advanceTimersByTimeAsync(HELD_IDENTITY_RECHECK_MS * 3);
    expect(checked).toHaveLength(0);
    expect(b.mgr.isConnected(AGENT)).toBe(true);
  });
});
