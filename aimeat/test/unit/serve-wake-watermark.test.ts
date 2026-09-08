/**
 * @file serve-wake-watermark.test.ts
 * @description Unit tests for AgentChannel.nextWake / signalWake (src/cli/connect/mcp/local-server.ts).
 *   The unified wake signal must be edge-triggered: a consumer that parks on /local/wake/next and
 *   lists its work from the node store (never draining the local queues) gets exactly ONE wake per
 *   event, not a permanent instant-200 that turns its idle wait into a hot loop. Covers: one push →
 *   one wake, the second park blocks; an event landing between listing and parking is not lost; a
 *   parked waiter's resolution counts as the report; quiet timeout stays false.
 * @version-history
 *   v1.0.0 — 2026-08-17 — Written against the level-triggered hasPendingWake bug (one stuck agent
 *     measured at 28 req/s and 76% node CPU); red on the old code, green with the watermark.
 *   v1.1.0 — 2026-08-17 — Restart case from production: the tunnel's on-connect backlog frame fills
 *     the task queue through handleTask, so the old level check spun from the daemon's first second
 *     on every tenant with one open task (measured: clean container start, 3 agents stuck, 91% CPU).
 */
import { describe, it, expect } from 'vitest';
import { AgentChannel } from '../../src/cli/connect/mcp/local-server.js';
import type { RegisteredAgent } from '../../src/cli/connect/agent-registry.js';

// nextWake/signalWake touch nothing on the entry. handleTask reads config.wake (absent → wakeAgent
// returns before doing anything) and config.runner (absent → no runner launch), so an empty config
// keeps the task path side-effect free too; handleRecord/handleDm never read the entry at all.
const entry = { agent: 'unit-agent', owner: 'unit-owner', config: {} } as RegisteredAgent;

describe('AgentChannel unified wake watermark', () => {
  it('one push wakes exactly once: the second park blocks even with the queue undrained', async () => {
    const ch = new AgentChannel(entry);
    ch.handleRecord({ organism_id: 'org', ws: 'ws', space: 'draft' });

    await expect(ch.nextWake(0)).resolves.toBe(true);
    // The consumer never called nextRecord, so the queue still holds the item. Level-triggered
    // reads of the queue made this return true forever — the hot loop this file exists to refuse.
    await expect(ch.nextWake(0)).resolves.toBe(false);
  });

  it('an event between listing and parking is not lost: the next park returns immediately', async () => {
    const ch = new AgentChannel(entry);
    // Consumer has listed its work (nothing parked), then the push lands.
    ch.handleRecord({ organism_id: 'org', ws: 'ws', space: 'draft' });

    const started = Date.now();
    await expect(ch.nextWake(5_000)).resolves.toBe(true);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('resolving a parked waiter is the report: a re-park after the wake blocks', async () => {
    const ch = new AgentChannel(entry);
    const parked = ch.nextWake(5_000);
    ch.handleRecord({ organism_id: 'org', ws: 'ws', space: 'draft' });

    await expect(parked).resolves.toBe(true);
    await expect(ch.nextWake(0)).resolves.toBe(false);
  });

  it('a quiet park times out false', async () => {
    const ch = new AgentChannel(entry);
    await expect(ch.nextWake(20)).resolves.toBe(false);
  });

  it('an on-connect backlog fill costs one wake, not a spin from the first second', async () => {
    const ch = new AgentChannel(entry);
    // A daemon restart with open tasks: the tunnel's backlog frame queues them before anyone parks.
    ch.handleTask({ id: 'task-open-1', title: 'left open across the restart' }, 'backlog');
    ch.handleTask({ id: 'task-open-2', title: 'second open task' }, 'backlog');

    // The daemon lists its tasks from the node store and never drains this queue — one wake to
    // trigger that listing is correct, a second instant wake is the boot-time spin.
    await expect(ch.nextWake(0)).resolves.toBe(true);
    await expect(ch.nextWake(0)).resolves.toBe(false);
  });

  it('several pushes before one park still cost one wake', async () => {
    const ch = new AgentChannel(entry);
    ch.handleRecord({ organism_id: 'org', ws: 'ws', space: 'draft' });
    ch.handleDm({ from: 'someone@node' });
    ch.handleRecord({ organism_id: 'org', ws: 'ws', space: 'draft' });

    await expect(ch.nextWake(0)).resolves.toBe(true);
    await expect(ch.nextWake(0)).resolves.toBe(false);
  });
});

/**
 * Dedup must stop double WORK, never double NOTICE. seenTaskIds and seenMessageIds live for the
 * daemon's whole life, and both handlers used to return on a seen id BEFORE signalWake — so one id
 * was worth exactly one wake, for ever. A delivery that arrived while nobody was listening could
 * never be re-announced: no resend, no re-list, no second chance, and every surface still read
 * healthy (task active, agent online, park open, nothing in an error state). handleRecord and
 * handleDm never had the fault; they signal on every event and let the queue hold the item.
 * Measured by crewaimeat 2026-09-07 and 2026-09-08: two nights, 0/6 steps, agents reachable.
 */
describe('a re-delivered id still announces itself', () => {
  it('the same task delivered twice wakes twice', async () => {
    const ch = new AgentChannel(entry);
    ch.handleTask({ id: 'task-1', title: 'the evening fetch' }, 'deliver');
    await expect(ch.nextWake(0)).resolves.toBe(true);

    // The node re-pushes it (a reconnect backlog, a resend, a second deliver). The consumer has
    // already reported the first wake, so this is the only signal it will get.
    ch.handleTask({ id: 'task-1', title: 'the evening fetch' }, 'backlog');
    await expect(ch.nextWake(0)).resolves.toBe(true);
  });

  it('but the task is queued once, so the runner and the long-poll still see it once', async () => {
    const ch = new AgentChannel(entry);
    ch.handleTask({ id: 'task-1', title: 'the evening fetch' }, 'deliver');
    ch.handleTask({ id: 'task-1', title: 'the evening fetch' }, 'backlog');

    await expect(ch.nextTask(0)).resolves.toMatchObject({ task: { id: 'task-1' } });
    await expect(ch.nextTask(0)).resolves.toBeNull();
  });

  it('the same message delivered twice wakes twice', async () => {
    const ch = new AgentChannel(entry);
    ch.handleMessages([{ id: 'msg-1' }]);
    await expect(ch.nextWake(0)).resolves.toBe(true);

    // Messages have no drainable queue: the wake is the whole mechanism, so losing it hides the
    // message until some unrelated event happens to start a cycle.
    ch.handleMessages([{ id: 'msg-1' }]);
    await expect(ch.nextWake(0)).resolves.toBe(true);
  });

  it('a messages frame with nothing in it wakes nobody', async () => {
    const ch = new AgentChannel(entry);
    ch.handleMessages([]);
    await expect(ch.nextWake(0)).resolves.toBe(false);
  });
});
