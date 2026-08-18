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
} from 'prom-client';
import type { AimeatConfig } from '../config.js';

/** Typed handle for all AIMEAT Prometheus metrics, accessible via getPromMetrics(). */
export interface PromMetrics {
  tunnelConnectionsActive: Gauge;
  tunnelConnectionsTotal: Counter;
  tunnelDisconnectionsTotal: Counter;
  tunnelReconnectsTotal: Counter;
  tunnelMessagesSentTotal: Counter;
  tunnelMessagesReceivedTotal: Counter;
  tunnelDeliveryFailuresTotal: Counter;
  tunnelDeliveryLatencyMs: Histogram;
  tunnelHeartbeatMissesTotal: Counter;
  tunnelMailboxFallbacksTotal: Counter;
  mailboxItemsTotal: Gauge;
  mailboxBytesTotal: Gauge;
  mailboxEnqueuedTotal: Counter;
  mailboxDeliveredTotal: Counter;
  mailboxExpiredTotal: Counter;
  mailboxQuotaRejectionsTotal: Counter;
  mailboxOldestItemAgeSeconds: Gauge;
  authFailuresTotal: Counter;
  rateLimitHitsTotal: Counter;
  scopeDenialsTotal: Counter;
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

  new Counter({
    name: 'aimeat_http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [register],
  });

  new Histogram({
    name: 'aimeat_http_request_duration_ms',
    help: 'HTTP request duration in milliseconds',
    labelNames: ['method', 'route'] as const,
    buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
    registers: [register],
  });

  // ── Tunnel ────────────────────────────────────────────────

  const tunnelConnectionsActive = new Gauge({
    name: 'aimeat_tunnel_connections_active',
    help: 'Number of currently active tunnel connections',
    registers: [register],
  });

  const tunnelConnectionsTotal = new Counter({
    name: 'aimeat_tunnel_connections_total',
    help: 'Total tunnel connections established',
    registers: [register],
  });

  const tunnelDisconnectionsTotal = new Counter({
    name: 'aimeat_tunnel_disconnections_total',
    help: 'Total tunnel disconnections',
    labelNames: ['reason'] as const,
    registers: [register],
  });

  const tunnelReconnectsTotal = new Counter({
    name: 'aimeat_tunnel_reconnects_total',
    help: 'Total tunnel reconnection attempts',
    registers: [register],
  });

  const tunnelMessagesSentTotal = new Counter({
    name: 'aimeat_tunnel_messages_sent_total',
    help: 'Total tunnel messages sent',
    labelNames: ['type'] as const,
    registers: [register],
  });

  const tunnelMessagesReceivedTotal = new Counter({
    name: 'aimeat_tunnel_messages_received_total',
    help: 'Total tunnel messages received',
    labelNames: ['type'] as const,
    registers: [register],
  });

  const tunnelDeliveryFailuresTotal = new Counter({
    name: 'aimeat_tunnel_delivery_failures_total',
    help: 'Total tunnel delivery failures',
    registers: [register],
  });

  const tunnelDeliveryLatencyMs = new Histogram({
    name: 'aimeat_tunnel_delivery_latency_ms',
    help: 'Tunnel message delivery latency in milliseconds',
    buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000],
    registers: [register],
  });

  const tunnelHeartbeatMissesTotal = new Counter({
    name: 'aimeat_tunnel_heartbeat_misses_total',
    help: 'Total missed tunnel heartbeats',
    registers: [register],
  });

  const tunnelMailboxFallbacksTotal = new Counter({
    name: 'aimeat_tunnel_mailbox_fallbacks_total',
    help: 'Total times a message fell back to mailbox delivery',
    registers: [register],
  });

  // ── Mailbox ───────────────────────────────────────────────

  const mailboxItemsTotal = new Gauge({
    name: 'aimeat_mailbox_items_total',
    help: 'Current number of items in all mailboxes',
    registers: [register],
  });

  const mailboxBytesTotal = new Gauge({
    name: 'aimeat_mailbox_bytes_total',
    help: 'Current total bytes across all mailboxes',
    registers: [register],
  });

  const mailboxEnqueuedTotal = new Counter({
    name: 'aimeat_mailbox_enqueued_total',
    help: 'Total items enqueued into mailboxes',
    labelNames: ['type'] as const,
    registers: [register],
  });

  const mailboxDeliveredTotal = new Counter({
    name: 'aimeat_mailbox_delivered_total',
    help: 'Total items delivered from mailboxes',
    registers: [register],
  });

  const mailboxExpiredTotal = new Counter({
    name: 'aimeat_mailbox_expired_total',
    help: 'Total items expired from mailboxes',
    registers: [register],
  });

  const mailboxQuotaRejectionsTotal = new Counter({
    name: 'aimeat_mailbox_quota_rejections_total',
    help: 'Total mailbox enqueue rejections due to quota',
    registers: [register],
  });

  const mailboxOldestItemAgeSeconds = new Gauge({
    name: 'aimeat_mailbox_oldest_item_age_seconds',
    help: 'Age of the oldest item in any mailbox in seconds',
    registers: [register],
  });

  // ── Auth / Rate limiting ──────────────────────────────────

  const authFailuresTotal = new Counter({
    name: 'aimeat_auth_failures_total',
    help: 'Total authentication failures',
    registers: [register],
  });

  const rateLimitHitsTotal = new Counter({
    name: 'aimeat_rate_limit_hits_total',
    help: 'Total rate limit hits',
    labelNames: ['tier'] as const,
    registers: [register],
  });

  const scopeDenialsTotal = new Counter({
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
