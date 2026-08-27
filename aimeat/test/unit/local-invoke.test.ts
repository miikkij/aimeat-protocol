/**
 * @file local-invoke.test.ts
 * @description Unit tests for InvokeChannel (src/cli/connect/mcp/local-invoke.ts): the serve
 *   daemon's queue between a tunnel `invoke` frame and the crew that answers it. Proves the two
 *   decisions the node relies on — a call with nobody collecting is refused at once as NO_HANDLER
 *   rather than left to time out, and an uncollected call is dropped once the node has stopped
 *   waiting — plus the plain path: queued, collected, answered, and a second answer refused.
 * @version-history
 *   v1.0.0 -- 2026-08-28 -- Initial.
 */
import { describe, it, expect, vi } from 'vitest';
import { InvokeChannel } from '../../src/cli/connect/mcp/local-invoke.js';

function channel() {
  const replies: Array<{ id: string; ok: boolean; result: unknown }> = [];
  const ch = new InvokeChannel((id, ok, result) => replies.push({ id, ok, result }));
  return { ch, replies };
}

describe('InvokeChannel', () => {
  it('refuses at once as NO_HANDLER when nobody has polled', () => {
    const { ch, replies } = channel();
    ch.handleInvoke({ id: 'i1', capability: 'crew.validate', input: { doc: {} } });
    expect(replies).toHaveLength(1);
    expect(replies[0].id).toBe('i1');
    expect(replies[0].ok).toBe(false);
    expect((replies[0].result as { code: string }).code).toBe('NO_HANDLER');
    expect(ch.pendingCount()).toBe(0);
  });

  it('hands a queued invoke to a parked consumer and forwards its answer once', async () => {
    const { ch, replies } = channel();
    const parked = ch.next(5_000);                       // a parked long-poll is a live handler
    ch.handleInvoke({ id: 'i2', capability: 'crew.validate', input: { doc: { agent_name: 'x' } }, caller: 'alice@node', timeout_ms: 30_000 });
    const item = await parked;
    expect(item?.id).toBe('i2');
    expect(item?.capability).toBe('crew.validate');
    expect(item?.caller).toBe('alice@node');
    expect(item?.timeout_ms).toBe(30_000);
    expect(ch.pendingCount()).toBe(1);

    expect(ch.result('i2', true, { errors: [] })).toBe(true);
    expect(replies).toEqual([{ id: 'i2', ok: true, result: { errors: [] } }]);
    expect(ch.pendingCount()).toBe(0);
    // A second answer for the same id is not attributed to anything.
    expect(ch.result('i2', true, { errors: [] })).toBe(false);
    expect(replies).toHaveLength(1);
  });

  it('queues an invoke that arrives between polls and returns it on the next poll', async () => {
    const { ch } = channel();
    await ch.next(0);                                    // the consumer has been here recently
    ch.handleInvoke({ id: 'i3', capability: 'crew.try', input: { prompt: 'p' } });
    const item = await ch.next(0);
    expect(item?.id).toBe('i3');
  });

  it('drops an uncollected invoke once the node has stopped waiting', async () => {
    vi.useFakeTimers();
    try {
      const { ch } = channel();
      await ch.next(0);
      ch.handleInvoke({ id: 'i4', capability: 'crew.validate', input: {}, timeout_ms: 1_000 });
      expect(ch.pendingCount()).toBe(1);
      vi.advanceTimersByTime(1_100);
      expect(ch.pendingCount()).toBe(0);
      const item = await ch.next(0);
      expect(item).toBeNull();
      expect(ch.result('i4', true, {})).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats a consumer as gone after the stale window', async () => {
    vi.useFakeTimers();
    try {
      const { ch } = channel();
      await ch.next(0);
      expect(ch.hasHandler()).toBe(true);
      vi.advanceTimersByTime(91_000);
      expect(ch.hasHandler()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves parked waiters with null on drain', async () => {
    const { ch } = channel();
    const parked = ch.next(5_000);
    ch.drainWaiters();
    await expect(parked).resolves.toBeNull();
  });
});
