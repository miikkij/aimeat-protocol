import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StatsCollector } from '../../src/services/stats.js';
import type { TunnelStats, MailboxStats } from '../../src/services/stats.js';
import type { Storage } from '../../src/storage/interface.js';

describe('StatsCollector', () => {
  let stats: StatsCollector;

  beforeEach(() => {
    stats = new StatsCollector();
  });

  // --- Existing tests (backward compatibility) ---

  it('starts with zero counters', () => {
    const snap = stats.snapshot();
    expect(snap.requests_total).toBe(0);
    expect(snap.memory_writes).toBe(0);
  });

  it('increments named counters', () => {
    stats.increment('requests_total');
    stats.increment('requests_total');
    stats.increment('memory_writes');
    const snap = stats.snapshot();
    expect(snap.requests_total).toBe(2);
    expect(snap.memory_writes).toBe(1);
  });

  it('increments method counters', () => {
    stats.incrementMethod('GET');
    stats.incrementMethod('POST');
    stats.incrementMethod('GET');
    const snap = stats.snapshot();
    expect(snap.requests_by_method.GET).toBe(2);
    expect(snap.requests_by_method.POST).toBe(1);
  });

  it('increments status counters', () => {
    stats.incrementStatus(200);
    stats.incrementStatus(404);
    stats.incrementStatus(500);
    const snap = stats.snapshot();
    expect(snap.requests_by_status['2xx']).toBe(1);
    expect(snap.requests_by_status['4xx']).toBe(1);
    expect(snap.requests_by_status['5xx']).toBe(1);
  });

  it('records daily history', () => {
    stats.increment('requests_total');
    stats.increment('memory_writes');
    const snap = stats.snapshot();
    const today = new Date().toISOString().split('T')[0];
    expect(snap.daily_history).toBeDefined();
    expect(snap.daily_history[today]).toBeDefined();
    expect(snap.daily_history[today].requests_total).toBe(1);
  });

  it('reports uptime and started_at', () => {
    const snap = stats.snapshot();
    expect(snap.uptime_seconds).toBeGreaterThanOrEqual(0);
    expect(snap.started_at).toBeTruthy();
  });

  // --- Tunnel stats ---

  describe('tunnel stats', () => {
    it('snapshot includes tunnel section with zero defaults', () => {
      const snap = stats.snapshot();
      const tunnel: TunnelStats = snap.tunnel;
      expect(tunnel.connections_active).toBe(0);
      expect(tunnel.connections_total).toBe(0);
      expect(tunnel.disconnections_total).toBe(0);
      expect(tunnel.reconnects_total).toBe(0);
      expect(tunnel.messages_sent_total).toBe(0);
      expect(tunnel.messages_received_total).toBe(0);
      expect(tunnel.delivery_failures_total).toBe(0);
      expect(tunnel.delivery_latency_avg_ms).toBe(0);
      expect(tunnel.delivery_latency_p95_ms).toBe(0);
      expect(tunnel.heartbeat_misses_total).toBe(0);
      expect(tunnel.mailbox_fallbacks_total).toBe(0);
    });

    it('incrementTunnel increments tunnel counters', () => {
      stats.incrementTunnel('connections_total');
      stats.incrementTunnel('connections_total');
      stats.incrementTunnel('disconnections_total');
      stats.incrementTunnel('messages_sent_total');
      stats.incrementTunnel('messages_received_total');
      stats.incrementTunnel('reconnects_total');
      stats.incrementTunnel('delivery_failures_total');
      stats.incrementTunnel('heartbeat_misses_total');
      stats.incrementTunnel('mailbox_fallbacks_total');

      const snap = stats.snapshot();
      expect(snap.tunnel.connections_total).toBe(2);
      expect(snap.tunnel.disconnections_total).toBe(1);
      expect(snap.tunnel.messages_sent_total).toBe(1);
      expect(snap.tunnel.messages_received_total).toBe(1);
      expect(snap.tunnel.reconnects_total).toBe(1);
      expect(snap.tunnel.delivery_failures_total).toBe(1);
      expect(snap.tunnel.heartbeat_misses_total).toBe(1);
      expect(snap.tunnel.mailbox_fallbacks_total).toBe(1);
    });

    it('setTunnelGauge sets gauge values', () => {
      stats.setTunnelGauge('connections_active', 5);
      expect(stats.snapshot().tunnel.connections_active).toBe(5);

      stats.setTunnelGauge('connections_active', 3);
      expect(stats.snapshot().tunnel.connections_active).toBe(3);

      stats.setTunnelGauge('connections_active', 0);
      expect(stats.snapshot().tunnel.connections_active).toBe(0);
    });
  });

  // --- Mailbox stats ---

  describe('mailbox stats', () => {
    it('snapshot includes mailbox section with zero defaults', () => {
      const snap = stats.snapshot();
      const mailbox: MailboxStats = snap.mailbox;
      expect(mailbox.items_total).toBe(0);
      expect(mailbox.bytes_total).toBe(0);
      expect(mailbox.enqueued_total).toBe(0);
      expect(mailbox.delivered_total).toBe(0);
      expect(mailbox.expired_total).toBe(0);
      expect(mailbox.quota_rejections_total).toBe(0);
      expect(mailbox.oldest_item_age_seconds).toBe(0);
    });

    it('incrementMailbox increments mailbox counters', () => {
      stats.incrementMailbox('enqueued_total');
      stats.incrementMailbox('enqueued_total');
      stats.incrementMailbox('delivered_total');
      stats.incrementMailbox('expired_total');
      stats.incrementMailbox('quota_rejections_total');

      const snap = stats.snapshot();
      expect(snap.mailbox.enqueued_total).toBe(2);
      expect(snap.mailbox.delivered_total).toBe(1);
      expect(snap.mailbox.expired_total).toBe(1);
      expect(snap.mailbox.quota_rejections_total).toBe(1);
    });

    it('setMailboxGauge sets gauge values', () => {
      stats.setMailboxGauge('items_total', 42);
      stats.setMailboxGauge('bytes_total', 10240);
      stats.setMailboxGauge('oldest_item_age_seconds', 300);

      const snap = stats.snapshot();
      expect(snap.mailbox.items_total).toBe(42);
      expect(snap.mailbox.bytes_total).toBe(10240);
      expect(snap.mailbox.oldest_item_age_seconds).toBe(300);

      // Verify overwrite behavior
      stats.setMailboxGauge('items_total', 10);
      expect(stats.snapshot().mailbox.items_total).toBe(10);
    });
  });

  // --- Auth/rate-limit/scope counters ---

  describe('auth and rate-limit counters', () => {
    it('snapshot includes auth/rate-limit counters with zero defaults', () => {
      const snap = stats.snapshot();
      expect(snap.auth_failures_total).toBe(0);
      expect(snap.rate_limit_hits_total).toBe(0);
      expect(snap.scope_denials_total).toBe(0);
    });

    it('increments auth_failures_total', () => {
      stats.increment('auth_failures_total');
      stats.increment('auth_failures_total');
      expect(stats.snapshot().auth_failures_total).toBe(2);
    });

    it('increments rate_limit_hits_total', () => {
      stats.increment('rate_limit_hits_total');
      expect(stats.snapshot().rate_limit_hits_total).toBe(1);
    });

    it('increments scope_denials_total', () => {
      stats.increment('scope_denials_total');
      stats.increment('scope_denials_total');
      stats.increment('scope_denials_total');
      expect(stats.snapshot().scope_denials_total).toBe(3);
    });
  });

  // --- Delivery latency ---

  describe('recordDeliveryLatency', () => {
    it('computes avg and p95 for a single sample', () => {
      stats.recordDeliveryLatency(50);
      const snap = stats.snapshot();
      expect(snap.tunnel.delivery_latency_avg_ms).toBe(50);
      expect(snap.tunnel.delivery_latency_p95_ms).toBe(50);
    });

    it('computes avg and p95 for multiple samples', () => {
      // Feed 100 samples: 1, 2, 3, ..., 100
      for (let i = 1; i <= 100; i++) {
        stats.recordDeliveryLatency(i);
      }
      const snap = stats.snapshot();
      // avg of 1..100 = 50.5
      expect(snap.tunnel.delivery_latency_avg_ms).toBe(50.5);
      // p95 of 1..100: index = ceil(0.95 * 100) - 1 = 94, value = 95
      expect(snap.tunnel.delivery_latency_p95_ms).toBe(95);
    });

    it('uses rolling window of last 1000 samples', () => {
      // Add 1000 samples of value 10
      for (let i = 0; i < 1000; i++) {
        stats.recordDeliveryLatency(10);
      }
      // Now add 1000 more samples of value 100 — should push out all old ones
      for (let i = 0; i < 1000; i++) {
        stats.recordDeliveryLatency(100);
      }
      const snap = stats.snapshot();
      expect(snap.tunnel.delivery_latency_avg_ms).toBe(100);
      expect(snap.tunnel.delivery_latency_p95_ms).toBe(100);
    });

    it('returns zero when no samples recorded', () => {
      const snap = stats.snapshot();
      expect(snap.tunnel.delivery_latency_avg_ms).toBe(0);
      expect(snap.tunnel.delivery_latency_p95_ms).toBe(0);
    });
  });

  // --- Typed counters ---

  describe('typed counters', () => {
    it('incrementTyped stores as name:type', () => {
      stats.incrementTyped('email_sent', 'verification');
      stats.incrementTyped('email_sent', 'verification');
      stats.incrementTyped('email_sent', 'magic_link');
      const snap = stats.snapshot();
      expect(snap.email_sent).toBe(3);
      expect(snap.email_sent_by_type).toEqual({
        verification: 2,
        magic_link: 1,
      });
    });

    it('incrementTyped records in daily history', () => {
      stats.incrementTyped('push_sent', 'test');
      const snap = stats.snapshot();
      const today = new Date().toISOString().split('T')[0];
      expect(snap.daily_history[today]['push_sent:test']).toBe(1);
    });

    it('snapshot groups multiple typed counter families', () => {
      stats.incrementTyped('email_sent', 'verification');
      stats.incrementTyped('email_failed', 'verification');
      stats.incrementTyped('push_sent', 'board');
      const snap = stats.snapshot();
      expect(snap.email_sent).toBe(1);
      expect(snap.email_sent_by_type).toEqual({ verification: 1 });
      expect(snap.email_failed).toBe(1);
      expect(snap.email_failed_by_type).toEqual({ verification: 1 });
      expect(snap.push_sent).toBe(1);
      expect(snap.push_sent_by_type).toEqual({ board: 1 });
    });

    it('non-typed counters are unaffected by grouping', () => {
      stats.increment('requests_total');
      stats.incrementTyped('email_sent', 'notification');
      const snap = stats.snapshot();
      expect(snap.requests_total).toBe(1);
      expect((snap as Record<string, unknown>).requests_total_by_type).toBeUndefined();
    });
  });

  // --- snapshotForRange ---

  describe('snapshotForRange', () => {
    it('includes daily entries within the date range', () => {
      const today = new Date().toISOString().split('T')[0];
      stats.increment('requests_total');
      stats.increment('memory_writes');

      // Range that includes today
      const result = stats.snapshotForRange(today, today);
      expect(result.daily[today]).toBeDefined();
      expect(result.daily[today].requests_total).toBe(1);
      expect(result.daily[today].memory_writes).toBe(1);
      expect(result.totals.requests_total).toBe(1);
      expect(result.totals.memory_writes).toBe(1);
    });

    it('excludes daily entries outside the date range', () => {
      stats.increment('requests_total');

      // Range that excludes today (past dates only)
      const result = stats.snapshotForRange('2020-01-01', '2020-01-02');
      expect(Object.keys(result.daily)).toHaveLength(0);
      expect(Object.keys(result.totals)).toHaveLength(0);
    });

    it('groups typed counters in range results', () => {
      stats.incrementTyped('email_sent', 'verification');
      stats.incrementTyped('email_sent', 'magic_link');

      const today = new Date().toISOString().split('T')[0];
      const result = stats.snapshotForRange(today, today);

      expect(result.totals.email_sent).toBe(2);
      expect(result.totals.email_sent_by_type).toEqual({
        verification: 1,
        magic_link: 1,
      });
    });

    it('returns empty objects for a range with no data', () => {
      const result = stats.snapshotForRange('2020-01-01', '2020-01-02');
      expect(result.totals).toEqual({});
      expect(result.daily).toEqual({});
    });

    it('does not leak colon-keyed counters into totals', () => {
      stats.incrementTyped('email_sent', 'verification');
      stats.incrementTyped('email_sent', 'magic_link');
      stats.incrementTyped('push_sent', 'board');

      const today = new Date().toISOString().split('T')[0];
      const result = stats.snapshotForRange(today, today);

      // Verify no colon keys in totals
      for (const key of Object.keys(result.totals)) {
        expect(key).not.toContain(':');
      }

      // Verify the grouped keys are present instead
      expect(result.totals.email_sent).toBe(2);
      expect(result.totals.email_sent_by_type).toBeDefined();
      expect(result.totals.push_sent).toBe(1);
      expect(result.totals.push_sent_by_type).toBeDefined();
    });
  });

  // --- Persistence ---

  describe('persistence', () => {
    function createMockStorage() {
      let savedCounters: Record<string, number> = {};
      let savedHistory: Record<string, Record<string, number>> = {};
      return {
        flushStats: async (counters: Record<string, number>) => { savedCounters = { ...counters }; },
        loadStats: async () => ({ ...savedCounters }),
        flushDailyHistory: async (history: Record<string, Record<string, number>>) => { savedHistory = JSON.parse(JSON.stringify(history)); },
        loadDailyHistory: async () => JSON.parse(JSON.stringify(savedHistory)) as Record<string, Record<string, number>>,
        getSavedCounters: () => savedCounters,
        getSavedHistory: () => savedHistory,
      };
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it('init loads persisted counters', async () => {
      const mock = createMockStorage();
      mock.flushStats({ requests_total: 10, 'email_sent:verification': 5 });

      await stats.init(mock as unknown as Storage);

      const snap = stats.snapshot();
      expect(snap.requests_total).toBe(10);
      expect(snap.email_sent).toBe(5);

      await stats.shutdown();
    });

    it('init loads prefixed counters', async () => {
      const mock = createMockStorage();
      mock.flushStats({ 'tunnel:connections_total': 3, 'method:GET': 7, 'status:2xx': 15 });

      await stats.init(mock as unknown as Storage);

      const snap = stats.snapshot();
      expect(snap.tunnel.connections_total).toBe(3);
      expect(snap.requests_by_method.GET).toBe(7);
      expect(snap.requests_by_status['2xx']).toBe(15);

      await stats.shutdown();
    });

    it('init loads daily history', async () => {
      const mock = createMockStorage();
      const testDate = new Date().toISOString().split('T')[0];
      await mock.flushDailyHistory({ [testDate]: { requests_total: 5, memory_writes: 2 } });

      await stats.init(mock as unknown as Storage);

      const snap = stats.snapshot();
      expect(snap.daily_history[testDate]).toBeDefined();
      expect(snap.daily_history[testDate].requests_total).toBe(5);
      expect(snap.daily_history[testDate].memory_writes).toBe(2);

      await stats.shutdown();
    });

    it('shutdown flushes counters to storage', async () => {
      const mock = createMockStorage();
      await stats.init(mock as unknown as Storage);

      stats.increment('requests_total');
      stats.increment('requests_total');
      stats.incrementTunnel('connections_total');
      stats.incrementMethod('POST');
      stats.incrementStatus(200);

      await stats.shutdown();

      const saved = mock.getSavedCounters();
      expect(saved.requests_total).toBe(2);
      expect(saved['tunnel:connections_total']).toBe(1);
      expect(saved['method:POST']).toBe(1);
      expect(saved['status:2xx']).toBe(1);
    });

    it('shutdown clears the flush timer', async () => {
      vi.useFakeTimers();
      const mock = createMockStorage();
      await stats.init(mock as unknown as Storage);

      stats.increment('requests_total');
      await stats.shutdown();

      // After shutdown, the saved counters should reflect the final flush
      const savedAfterShutdown = { ...mock.getSavedCounters() };
      expect(savedAfterShutdown.requests_total).toBe(1);

      // Increment more counters after shutdown
      stats.increment('requests_total');
      stats.increment('requests_total');

      // Advance time past the flush interval -- timer should be cleared
      await vi.advanceTimersByTimeAsync(120_000);

      // Storage should NOT have been updated since shutdown cleared the timer
      const savedAfterTimer = mock.getSavedCounters();
      expect(savedAfterTimer.requests_total).toBe(1);
    });

    it('flush error is caught gracefully', async () => {
      const mock = {
        flushStats: async () => { throw new Error('disk full'); },
        loadStats: async () => ({}),
        flushDailyHistory: async () => { throw new Error('disk full'); },
        loadDailyHistory: async () => ({}),
      };

      await stats.init(mock as unknown as Storage);
      stats.increment('requests_total');

      // shutdown calls flush internally -- should not throw
      await expect(stats.shutdown()).resolves.toBeUndefined();
    });

    it('init error falls back to fresh state', async () => {
      const mock = {
        flushStats: async () => {},
        loadStats: async () => { throw new Error('corrupt data'); },
        flushDailyHistory: async () => {},
        loadDailyHistory: async () => { throw new Error('corrupt data'); },
      };

      // init should not throw despite loadStats throwing
      await expect(stats.init(mock as unknown as Storage)).resolves.toBeUndefined();

      const snap = stats.snapshot();
      expect(snap.requests_total).toBe(0);
      expect(snap.memory_writes).toBe(0);

      await stats.shutdown();
    });
  });

  // --- Backward compatibility ---

  describe('backward compatibility', () => {
    it('existing counters still work after extension', () => {
      stats.increment('requests_total');
      stats.increment('memory_writes');
      stats.increment('memory_reads');
      stats.increment('consent_grants');
      stats.increment('consent_revocations');
      stats.increment('schema_validations');
      stats.increment('schema_validation_failures');
      stats.incrementMethod('GET');
      stats.incrementStatus(200);

      const snap = stats.snapshot();
      expect(snap.requests_total).toBe(1);
      expect(snap.memory_writes).toBe(1);
      expect(snap.memory_reads).toBe(1);
      expect(snap.consent_grants).toBe(1);
      expect(snap.consent_revocations).toBe(1);
      expect(snap.schema_validations).toBe(1);
      expect(snap.schema_validation_failures).toBe(1);
      expect(snap.requests_by_method.GET).toBe(1);
      expect(snap.requests_by_status['2xx']).toBe(1);
      expect(snap.daily_history).toBeDefined();
    });
  });
});
