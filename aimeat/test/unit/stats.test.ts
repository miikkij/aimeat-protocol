import { describe, it, expect, beforeEach } from 'vitest';
import { StatsCollector } from '../../src/services/stats.js';
import type { TunnelStats, MailboxStats } from '../../src/services/stats.js';

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
