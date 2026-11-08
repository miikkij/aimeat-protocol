/**
 * @file test/unit/mcp-session-close-cross-process.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Deleting, rekeying or re-approving an agent closes its open MCP sessions on every
 *   process of the node, not only on the process that served the request (mcp/session-registry.ts
 *   closeMcpSessionsForGaii and the mcpSessionsClose event; secaudit2026nov08b round 15b, group
 *   sessions). The three routes (routes/agents/management.ts, rekey.ts, device-auth-approve.ts) call
 *   closeMcpSessionsForGaii, so the test calls it as they do.
 *
 *   Two processes: each one is its own copy of the event bus and the session registry
 *   (vi.resetModules), and the two are joined by the real bus relay (services/bus-relay.ts) over an
 *   in-memory wire that hands every message to every relay, its sender included, as PostgreSQL NOTIFY
 *   does. Process B holds the agent's session; the close is asked on process A.
 *   - the harness carries events: an account erased on A closes its session on B (round 15's event);
 *   - the session on B closes, and B's sessions of other principals stay open;
 *   - A closes its own session of the agent once and answers its own count, as before;
 *   - with one process (no relay) the close and its count are what they were before.
 * @usage cd aimeat && pnpm exec vitest run test/unit/mcp-session-close-cross-process.test.ts
 * @version-history
 *   v1.0.0 -- 2026-11-08 -- Initial (secaudit2026nov08b round 15b).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const NODE = 'node';
const AGENT = 'helper#alice@node';
const settle = () => new Promise((r) => setTimeout(r, 20));

type Bus = typeof import('../../src/services/event-bus.js');
type Registry = typeof import('../../src/mcp/session-registry.js');
type Relay = import('../../src/services/bus-relay.js').BusRelay;

interface Process { bus: Bus; registry: Registry; relay: Relay; closed: string[]; open(id: string, principal: string): void }

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

/** The wire both relays send on: each message reaches every relay, its sender included. */
function hub() {
  const relays: Relay[] = [];
  const wire = {
    async send(payloads: readonly string[]) {
      setImmediate(() => { for (const p of payloads) for (const r of relays) r.receive(p); });
    },
  };
  return { relays, wire };
}

/** One process of the node: a fresh copy of the bus, the registry and the relay, on the shared wire. */
async function aProcess(id: string, h: ReturnType<typeof hub>): Promise<Process> {
  vi.resetModules();
  const bus = await import('../../src/services/event-bus.js');
  const registry = await import('../../src/mcp/session-registry.js');
  const { createBusRelay } = await import('../../src/services/bus-relay.js');
  const relay = createBusRelay({ wire: h.wire, nodeId: NODE, processId: id });
  h.relays.push(relay);
  cleanups.push(bus.addBusTransport(relay));
  const closed: string[] = [];
  const ids: string[] = [];
  cleanups.push(() => { for (const s of ids) registry.forgetMcpSession(s); });
  return {
    bus, registry, relay, closed,
    open(sessionId, principal) { ids.push(sessionId); registry.noteMcpSession(sessionId, principal, () => { closed.push(sessionId); }); },
  };
}

async function flush(...ps: Process[]): Promise<void> {
  for (const p of ps) await p.relay.idle();
  await settle();
  for (const p of ps) await p.relay.idle();
}

describe('an agent\'s MCP sessions close on every process', () => {
  it('the two processes hear each other: an account erased on A closes its session on B (round 15)', async () => {
    const h = hub();
    const a = await aProcess('A', h);
    const b = await aProcess('B', h);
    b.open('b-helper', AGENT);

    a.bus.emitAccountErased(NODE, 'alice');
    await flush(a, b);

    expect(b.closed).toEqual(['b-helper']);
  });

  it('a close asked on process A closes the agent\'s session that process B holds', async () => {
    const h = hub();
    const a = await aProcess('A', h);
    const b = await aProcess('B', h);
    b.open('b-helper', AGENT);
    b.open('b-scout', 'scout#alice@node');
    b.open('b-lookalike', 'xhelper#alice@node');

    expect(a.registry.closeMcpSessionsForGaii(AGENT)).toBe(0);   // A holds none of the agent's sessions
    await flush(a, b);

    expect(b.closed).toEqual(['b-helper']);
  });

  it('A closes its own session of the agent once and answers its own count', async () => {
    const h = hub();
    const a = await aProcess('A', h);
    const b = await aProcess('B', h);
    a.open('a-helper', AGENT);
    a.open('a-scout', 'scout#alice@node');
    b.open('b-helper', AGENT);

    expect(a.registry.closeMcpSessionsForGaii(AGENT)).toBe(1);
    expect(a.closed).toEqual(['a-helper']);                        // closed at once, before the bus answered
    await flush(a, b);

    expect(a.closed).toEqual(['a-helper']);                        // its own event back on the wire closes nothing twice
    expect(b.closed).toEqual(['b-helper']);
  });

  it('a close asked on B reaches A the same way', async () => {
    const h = hub();
    const a = await aProcess('A', h);
    const b = await aProcess('B', h);
    a.open('a-helper', AGENT);

    b.registry.closeMcpSessionsForGaii(AGENT);
    await flush(a, b);

    expect(a.closed).toEqual(['a-helper']);
  });
});

describe('one process, as before', () => {
  it('closes the agent\'s sessions and answers how many, with no relay', async () => {
    vi.resetModules();
    const registry = await import('../../src/mcp/session-registry.js');
    const closed: string[] = [];
    registry.noteMcpSession('s1', AGENT, () => { closed.push('s1'); });
    registry.noteMcpSession('s2', AGENT, () => { closed.push('s2'); });
    registry.noteMcpSession('s3', 'scout#alice@node', () => { closed.push('s3'); });
    cleanups.push(() => { for (const s of ['s1', 's2', 's3']) registry.forgetMcpSession(s); });

    expect(registry.closeMcpSessionsForGaii(AGENT)).toBe(2);
    expect(closed.sort()).toEqual(['s1', 's2']);
    expect(registry.closeMcpSessionsForGaii(AGENT)).toBe(0);
    await settle();
    expect(closed.sort()).toEqual(['s1', 's2']);
  });
});
