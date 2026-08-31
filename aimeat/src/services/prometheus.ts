/**
 * @file src/services/prometheus.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Prometheus metrics registry — defines all AIMEAT metrics (tunnel connections/messages,
 *   mailbox, auth failures, rate-limit hits, scope denials) plus Node.js process metrics, exposed as
 *   a singleton for the /metrics endpoint and auth middleware to record against.
 *
 * @structure
 *   - createMetricsRegistry(config): builds the Registry + all metrics, stores the singleton
 *   - getPromMetrics(): returns the typed PromMetrics handle (or null before init)
 *   - PromMetrics: interface listing every counter/gauge/histogram
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import {
  Registry,
  Counter,
  Gauge,
  Histogram,
  collectDefaultMetrics,
} from '@prometheus-io/client';
import type { AimeatConfig } from '../config.js';

/**
 * Typed handle for all AIMEAT Prometheus metrics, accessible via getPromMetrics().
 *
 * The `<string>` on each one is load-bearing and was not needed before 2026-08-31. prom-client
 * defaulted a metric's label names to `string`, so a bare `Counter` accepted `inc({ reason })`.
 * @prometheus-io/client defaults them to `never` instead, which makes an unparameterised metric one
 * that takes no labels at all — and every labelled call site then fails to compile with a message
 * about `never` that says nothing about labels. Naming the parameter restores the old meaning.
 */
export interface PromMetrics {
  tunnelConnectionsActive: Gauge<string>;
  tunnelConnectionsTotal: Counter<string>;
  tunnelDisconnectionsTotal: Counter<string>;
  tunnelReconnectsTotal: Counter<string>;
  tunnelMessagesSentTotal: Counter<string>;
  tunnelMessagesReceivedTotal: Counter<string>;
  tunnelDeliveryFailuresTotal: Counter<string>;
  tunnelDeliveryLatencyMs: Histogram<string>;
  tunnelHeartbeatMissesTotal: Counter<string>;
  tunnelMailboxFallbacksTotal: Counter<string>;
  mailboxItemsTotal: Gauge<string>;
  mailboxBytesTotal: Gauge<string>;
  mailboxEnqueuedTotal: Counter<string>;
  mailboxDeliveredTotal: Counter<string>;
  mailboxExpiredTotal: Counter<string>;
  mailboxQuotaRejectionsTotal: Counter<string>;
  mailboxOldestItemAgeSeconds: Gauge<string>;
  authFailuresTotal: Counter<string>;
  rateLimitHitsTotal: Counter<string>;
  scopeDenialsTotal: Counter<string>;
}

// Singleton — set by createMetricsRegistry(), read by getPromMetrics().
let _promMetrics: PromMetrics | null = null;
export function getPromMetrics(): PromMetrics | null { return _promMetrics; }

/**
 * Creates and returns a Prometheus Registry pre-loaded with all AIMEAT metrics
 * and Node.js process metrics (CPU, memory, event loop, GC, etc.).
 */
export function createMetricsRegistry(config: AimeatConfig): Registry {
  const register = new Registry();
  register.setDefaultLabels({ node_id: config.nodeId, version: 'v1.3' });

  // Node.js process metrics (CPU, memory, event loop, GC, file descriptors)
  collectDefaultMetrics({ register });

  // ── HTTP ──────────────────────────────────────────────────

  new Counter<string>({
    name: 'aimeat_http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [register],
  });

  new Histogram<string>({
    name: 'aimeat_http_request_duration_ms',
    help: 'HTTP request duration in milliseconds',
    labelNames: ['method', 'route'] as const,
    buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
    registers: [register],
  });

  // ── Tunnel ────────────────────────────────────────────────

  const tunnelConnectionsActive = new Gauge<string>({
    name: 'aimeat_tunnel_connections_active',
    help: 'Number of currently active tunnel connections',
    registers: [register],
  });

  const tunnelConnectionsTotal = new Counter<string>({
    name: 'aimeat_tunnel_connections_total',
    help: 'Total tunnel connections established',
    registers: [register],
  });

  const tunnelDisconnectionsTotal = new Counter<string>({
    name: 'aimeat_tunnel_disconnections_total',
    help: 'Total tunnel disconnections',
    labelNames: ['reason'] as const,
    registers: [register],
  });

  const tunnelReconnectsTotal = new Counter<string>({
    name: 'aimeat_tunnel_reconnects_total',
    help: 'Total tunnel reconnection attempts',
    registers: [register],
  });

  const tunnelMessagesSentTotal = new Counter<string>({
    name: 'aimeat_tunnel_messages_sent_total',
    help: 'Total tunnel messages sent',
    labelNames: ['type'] as const,
    registers: [register],
  });

  const tunnelMessagesReceivedTotal = new Counter<string>({
    name: 'aimeat_tunnel_messages_received_total',
    help: 'Total tunnel messages received',
    labelNames: ['type'] as const,
    registers: [register],
  });

  const tunnelDeliveryFailuresTotal = new Counter<string>({
    name: 'aimeat_tunnel_delivery_failures_total',
    help: 'Total tunnel delivery failures',
    registers: [register],
  });

  const tunnelDeliveryLatencyMs = new Histogram<string>({
    name: 'aimeat_tunnel_delivery_latency_ms',
    help: 'Tunnel message delivery latency in milliseconds',
    buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000],
    registers: [register],
  });

  const tunnelHeartbeatMissesTotal = new Counter<string>({
    name: 'aimeat_tunnel_heartbeat_misses_total',
    help: 'Total missed tunnel heartbeats',
    registers: [register],
  });

  const tunnelMailboxFallbacksTotal = new Counter<string>({
    name: 'aimeat_tunnel_mailbox_fallbacks_total',
    help: 'Total times a message fell back to mailbox delivery',
    registers: [register],
  });

  // ── Mailbox ───────────────────────────────────────────────

  const mailboxItemsTotal = new Gauge<string>({
    name: 'aimeat_mailbox_items_total',
    help: 'Current number of items in all mailboxes',
    registers: [register],
  });

  const mailboxBytesTotal = new Gauge<string>({
    name: 'aimeat_mailbox_bytes_total',
    help: 'Current total bytes across all mailboxes',
    registers: [register],
  });

  const mailboxEnqueuedTotal = new Counter<string>({
    name: 'aimeat_mailbox_enqueued_total',
    help: 'Total items enqueued into mailboxes',
    labelNames: ['type'] as const,
    registers: [register],
  });

  const mailboxDeliveredTotal = new Counter<string>({
    name: 'aimeat_mailbox_delivered_total',
    help: 'Total items delivered from mailboxes',
    registers: [register],
  });

  const mailboxExpiredTotal = new Counter<string>({
    name: 'aimeat_mailbox_expired_total',
    help: 'Total items expired from mailboxes',
    registers: [register],
  });

  const mailboxQuotaRejectionsTotal = new Counter<string>({
    name: 'aimeat_mailbox_quota_rejections_total',
    help: 'Total mailbox enqueue rejections due to quota',
    registers: [register],
  });

  const mailboxOldestItemAgeSeconds = new Gauge<string>({
    name: 'aimeat_mailbox_oldest_item_age_seconds',
    help: 'Age of the oldest item in any mailbox in seconds',
    registers: [register],
  });

  // ── Auth / Rate limiting ──────────────────────────────────

  const authFailuresTotal = new Counter<string>({
    name: 'aimeat_auth_failures_total',
    help: 'Total authentication failures',
    registers: [register],
  });

  const rateLimitHitsTotal = new Counter<string>({
    name: 'aimeat_rate_limit_hits_total',
    help: 'Total rate limit hits',
    labelNames: ['tier'] as const,
    registers: [register],
  });

  const scopeDenialsTotal = new Counter<string>({
    name: 'aimeat_scope_denials_total',
    help: 'Total scope/permission denials',
    registers: [register],
  });

  // Expose typed handles via singleton
  _promMetrics = {
    tunnelConnectionsActive,
    tunnelConnectionsTotal,
    tunnelDisconnectionsTotal,
    tunnelReconnectsTotal,
    tunnelMessagesSentTotal,
    tunnelMessagesReceivedTotal,
    tunnelDeliveryFailuresTotal,
    tunnelDeliveryLatencyMs,
    tunnelHeartbeatMissesTotal,
    tunnelMailboxFallbacksTotal,
    mailboxItemsTotal,
    mailboxBytesTotal,
    mailboxEnqueuedTotal,
    mailboxDeliveredTotal,
    mailboxExpiredTotal,
    mailboxQuotaRejectionsTotal,
    mailboxOldestItemAgeSeconds,
    authFailuresTotal,
    rateLimitHitsTotal,
    scopeDenialsTotal,
  };

  return register;
}
