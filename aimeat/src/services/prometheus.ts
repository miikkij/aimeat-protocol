import {
  Registry,
  Counter,
  Gauge,
  Histogram,
  collectDefaultMetrics,
} from 'prom-client';
import type { AimeatConfig } from '../config.js';

/**
 * Creates and returns a Prometheus Registry pre-loaded with all AIMEAT metrics
 * and Node.js process metrics (CPU, memory, event loop, GC, etc.).
 */
export function createMetricsRegistry(config: AimeatConfig): Registry {
  const register = new Registry();
  register.setDefaultLabels({ node_id: config.nodeId });

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

  new Gauge({
    name: 'aimeat_tunnel_connections_active',
    help: 'Number of currently active tunnel connections',
    registers: [register],
  });

  new Counter({
    name: 'aimeat_tunnel_connections_total',
    help: 'Total tunnel connections established',
    registers: [register],
  });

  new Counter({
    name: 'aimeat_tunnel_disconnections_total',
    help: 'Total tunnel disconnections',
    labelNames: ['reason'] as const,
    registers: [register],
  });

  new Counter({
    name: 'aimeat_tunnel_reconnects_total',
    help: 'Total tunnel reconnection attempts',
    registers: [register],
  });

  new Counter({
    name: 'aimeat_tunnel_messages_sent_total',
    help: 'Total tunnel messages sent',
    labelNames: ['type'] as const,
    registers: [register],
  });

  new Counter({
    name: 'aimeat_tunnel_messages_received_total',
    help: 'Total tunnel messages received',
    labelNames: ['type'] as const,
    registers: [register],
  });

  new Counter({
    name: 'aimeat_tunnel_delivery_failures_total',
    help: 'Total tunnel delivery failures',
    registers: [register],
  });

  new Histogram({
    name: 'aimeat_tunnel_delivery_latency_ms',
    help: 'Tunnel message delivery latency in milliseconds',
    buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000],
    registers: [register],
  });

  new Counter({
    name: 'aimeat_tunnel_heartbeat_misses_total',
    help: 'Total missed tunnel heartbeats',
    registers: [register],
  });

  new Counter({
    name: 'aimeat_tunnel_mailbox_fallbacks_total',
    help: 'Total times a message fell back to mailbox delivery',
    registers: [register],
  });

  // ── Mailbox ───────────────────────────────────────────────

  new Gauge({
    name: 'aimeat_mailbox_items_total',
    help: 'Current number of items in all mailboxes',
    registers: [register],
  });

  new Gauge({
    name: 'aimeat_mailbox_bytes_total',
    help: 'Current total bytes across all mailboxes',
    registers: [register],
  });

  new Counter({
    name: 'aimeat_mailbox_enqueued_total',
    help: 'Total items enqueued into mailboxes',
    labelNames: ['type'] as const,
    registers: [register],
  });

  new Counter({
    name: 'aimeat_mailbox_delivered_total',
    help: 'Total items delivered from mailboxes',
    registers: [register],
  });

  new Counter({
    name: 'aimeat_mailbox_expired_total',
    help: 'Total items expired from mailboxes',
    registers: [register],
  });

  new Counter({
    name: 'aimeat_mailbox_quota_rejections_total',
    help: 'Total mailbox enqueue rejections due to quota',
    registers: [register],
  });

  new Gauge({
    name: 'aimeat_mailbox_oldest_item_age_seconds',
    help: 'Age of the oldest item in any mailbox in seconds',
    registers: [register],
  });

  // ── Auth / Rate limiting ──────────────────────────────────

  new Counter({
    name: 'aimeat_auth_failures_total',
    help: 'Total authentication failures',
    registers: [register],
  });

  new Counter({
    name: 'aimeat_rate_limit_hits_total',
    help: 'Total rate limit hits',
    labelNames: ['tier'] as const,
    registers: [register],
  });

  new Counter({
    name: 'aimeat_scope_denials_total',
    help: 'Total scope/permission denials',
    registers: [register],
  });

  return register;
}
