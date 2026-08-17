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
 */
import { describe, it, expect } from 'vitest';
import { AgentChannel } from '../../src/cli/connect/mcp/local-server.js';
import type { RegisteredAgent } from '../../src/cli/connect/agent-registry.js';

// nextWake/signalWake touch nothing on the entry; handleRecord is the side-effect-free push source.
const entry = { agent: 'unit-agent', owner: 'unit-owner' } as RegisteredAgent;

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

  it('several pushes before one park still cost one wake', async () => {
    const ch = new AgentChannel(entry);
    ch.handleRecord({ organism_id: 'org', ws: 'ws', space: 'draft' });
    ch.handleDm({ from: 'someone@node' });
    ch.handleRecord({ organism_id: 'org', ws: 'ws', space: 'draft' });

    await expect(ch.nextWake(0)).resolves.toBe(true);
    await expect(ch.nextWake(0)).resolves.toBe(false);
  });
});
