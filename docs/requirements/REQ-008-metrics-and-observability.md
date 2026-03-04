# REQ-008: Metrics, Observability, and Tunnel Telemetry

**Status:** Draft  
**Priority:** Medium  
**Type:** Observability / Infrastructure  
**Created:** 2026-03-04  
**References:** [personal-node-tunnel-reliability.md](../research/personal-node-tunnel-reliability.md)

---

## 1. Summary

Extend the AIMEAT stats system with tunnel-specific telemetry (message counts, latency, reconnect statistics), a Prometheus-compatible `/metrics` endpoint, structured logging with correlation IDs, and a health check that covers tunnel subsystem health. Today the stats system is a custom in-memory counter with no external metrics export, no tunnel telemetry, and no request tracing.

## 2. Problem Statement

### 2.1 Current Observability State

| Component | Current | Gap |
|-----------|---------|-----|
| **Stats collector** | In-memory counters: `requests_total`, `memory_writes/reads`, `consent_grants/revocations`, `schema_validations/failures` | No tunnel metrics, no latency histograms, no agent-level breakdown |
| **Stats API** | `GET /v1/stats` returns JSON snapshot with daily history (90-day retention) | Not consumable by Prometheus/Grafana |
| **Health check** | `GET /v1/health` — uptime + heap memory + optional site-LB sync status | No tunnel health, no mailbox health, no dependency checks |
| **Logging** | Winston — JSON in production, colorized in dev | No request correlation IDs, no structured tunnel event logging |
| **Rate limiting** | Per-tier with role multipliers, standard `X-RateLimit-*` headers | No rate-limit hit counters in stats |
| **Tunnel telemetry** | None — no message counts, latency tracking, or reconnect stats | Complete gap |
| **External integration** | None — no Prometheus, no OpenTelemetry, no StatsD | Complete gap |

### 2.2 Why This Matters

Without tunnel telemetry, an operator cannot answer:
- How many personal nodes are connected right now?
- What is the average tunnel message delivery latency?
- How often do personal nodes reconnect? Is reconnect frequency increasing?
- Are mailbox items piling up because nodes are staying offline longer?
- Which agents generate the most tunnel traffic?
- Is the tunnel subsystem healthy or degraded?

Without Prometheus/Grafana integration, the custom `GET /v1/stats` endpoint requires custom tooling to monitor and alert.

## 3. Requirements

### 3.1 Tunnel Telemetry Counters

| ID | Requirement | Priority |
|----|-------------|----------|
| R-007-01 | Track `tunnel_connections_total` — total WebSocket connections established | Must |
| R-007-02 | Track `tunnel_connections_active` — current open tunnel connections (gauge) | Must |
| R-007-03 | Track `tunnel_disconnections_total` — total disconnections, labeled by reason (`clean`, `timeout`, `error`) | Must |
| R-007-04 | Track `tunnel_reconnects_total` — reconnections from known nodes (node was previously connected) | Must |
| R-007-05 | Track `tunnel_messages_sent_total` — messages sent to personal nodes, labeled by type | Must |
| R-007-06 | Track `tunnel_messages_received_total` — messages received from personal nodes, labeled by type | Must |
| R-007-07 | Track `tunnel_delivery_failures_total` — failed tunnel deliveries (timeout, node gone) | Must |
| R-007-08 | Track `tunnel_delivery_latency_ms` — histogram of request→response round-trip time | Must |
| R-007-09 | Track `tunnel_heartbeat_misses_total` — heartbeats expected but not received | Should |
| R-007-10 | Track `tunnel_mailbox_fallbacks_total` — messages that fell back to mailbox after tunnel failure | Must |

### 3.2 Mailbox Metrics

| ID | Requirement | Priority |
|----|-------------|----------|
| R-007-11 | Track `mailbox_items_total` — current total items across all mailboxes (gauge) | Must |
| R-007-12 | Track `mailbox_bytes_total` — current total bytes across all mailboxes (gauge) | Must |
| R-007-13 | Track `mailbox_enqueued_total` — total items enqueued, labeled by type | Must |
| R-007-14 | Track `mailbox_delivered_total` — total items delivered to reconnecting nodes | Must |
| R-007-15 | Track `mailbox_expired_total` — total items expired and cleaned up | Must |
| R-007-16 | Track `mailbox_quota_rejections_total` — enqueue attempts rejected due to quota | Should |
| R-007-17 | Track `mailbox_oldest_item_age_seconds` — age of the oldest undelivered item (gauge) | Should |

### 3.3 General Request Metrics Enhancement

| ID | Requirement | Priority |
|----|-------------|----------|
| R-007-18 | Track `http_request_duration_ms` — histogram of request latency, labeled by method + route pattern | Must |
| R-007-19 | Track `http_requests_total` labeled by method, route pattern, and status code | Must |
| R-007-20 | Track `rate_limit_hits_total` — total 429 responses, labeled by tier (global, auth, work, memory, boards) | Should |
| R-007-21 | Track `auth_failures_total` — total 401 responses | Should |
| R-007-22 | Track `scope_denials_total` — total 403 from `requireScope()` (see REQ-005) | Should |

### 3.4 Prometheus Metrics Endpoint

| ID | Requirement | Priority |
|----|-------------|----------|
| R-007-23 | Expose `GET /v1/metrics` returning Prometheus text exposition format | Must |
| R-007-24 | Metrics endpoint access control configurable: `public`, `authenticated`, `operator` (default: `operator`) | Must |
| R-007-25 | Include Node.js process metrics: heap usage, event loop lag, active handles, GC stats | Should |
| R-007-26 | Include AIMEAT version and node ID as metric labels | Must |
| R-007-27 | Use `prom-client` npm package (de facto Node.js Prometheus library) | Should |
| R-007-28 | Existing `GET /v1/stats` remains unchanged (backward compatible) | Must |
| R-007-29 | Enable/disable metrics endpoint via `AIMEAT_METRICS_ENABLED` | Must |

### 3.5 Enhanced Health Check

| ID | Requirement | Priority |
|----|-------------|----------|
| R-007-30 | Extend `GET /v1/health` with tunnel subsystem status | Must |
| R-007-31 | Include: `tunnel.connections_active`, `tunnel.last_connection_at`, `tunnel.healthy` | Must |
| R-007-32 | Include: `mailbox.items_total`, `mailbox.bytes_total`, `mailbox.oldest_item_age_seconds` | Must |
| R-007-33 | Include: `storage.healthy` (basic read/write probe) | Should |
| R-007-34 | Overall health degrades to `degraded` if any subsystem check fails | Must |
| R-007-35 | Health response time must be < 100ms (no expensive queries) | Must |

### 3.6 Structured Logging

| ID | Requirement | Priority |
|----|-------------|----------|
| R-007-36 | Add `request_id` (UUID) to every HTTP request and include in all log entries for that request | Must |
| R-007-37 | Return `request_id` in response header `X-Request-Id` | Must |
| R-007-38 | Add structured tunnel event logging: `tunnel.connect`, `tunnel.disconnect`, `tunnel.timeout`, `tunnel.heartbeat_miss` | Must |
| R-007-39 | Log entries must include: timestamp, level, message, request_id, agent GAII (if authenticated), node_id | Must |
| R-007-40 | Tunnel log entries must include: personal_node_id, event_type, latency_ms (where applicable) | Must |
| R-007-41 | Support log level configuration via `LOG_LEVEL` env var (existing — no change) | Must |

### 3.7 Backward Compatibility

| ID | Requirement | Priority |
|----|-------------|----------|
| R-007-42 | `GET /v1/stats` response format must not have breaking changes | Must |
| R-007-43 | New tunnel metrics are additive fields in the stats snapshot | Must |
| R-007-44 | No existing E2E test may break | Must |
| R-007-45 | Metrics endpoint is opt-in (`AIMEAT_METRICS_ENABLED=true`) — disabled by default | Must |

## 4. Design

### 4.1 Metrics Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                       AIMEAT Observability                           │
│                                                                      │
│  ┌────────────────┐   ┌─────────────────┐   ┌───────────────────┐  │
│  │ Stats Collector│   │ Prometheus       │   │ Structured Logger │  │
│  │ (existing)     │   │ Registry (new)   │   │ (enhanced)        │  │
│  │                │   │                  │   │                   │  │
│  │ requests_total │   │ histograms       │   │ request_id        │  │
│  │ memory_reads   │   │ gauges           │   │ tunnel events     │  │
│  │ daily_history  │   │ counters         │   │ correlation       │  │
│  └───────┬────────┘   └────────┬─────────┘   └────────┬──────────┘  │
│          │                     │                       │             │
│          ▼                     ▼                       ▼             │
│    GET /v1/stats         GET /v1/metrics          stdout/stderr     │
│    (JSON — existing)     (Prometheus text)        (Winston JSON)    │
│                               │                                     │
│                               ▼                                     │
│                        Prometheus ──► Grafana                       │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.2 Extended StatsSnapshot

```typescript
interface StatsSnapshot {
  // ── Existing fields (unchanged) ──
  uptime_seconds: number;
  started_at: string;
  requests_total: number;
  requests_by_method: Record<string, number>;
  requests_by_status: Record<string, number>;
  memory_writes: number;
  memory_reads: number;
  consent_grants: number;
  consent_revocations: number;
  schema_validations: number;
  schema_validation_failures: number;
  daily_history: Record<string, Record<string, number>>;

  // ── New: tunnel metrics ──
  tunnel: {
    connections_active: number;
    connections_total: number;
    disconnections_total: number;
    reconnects_total: number;
    messages_sent_total: number;
    messages_received_total: number;
    delivery_failures_total: number;
    delivery_latency_avg_ms: number;
    delivery_latency_p95_ms: number;
    heartbeat_misses_total: number;
    mailbox_fallbacks_total: number;
  };

  // ── New: mailbox metrics ──
  mailbox: {
    items_total: number;
    bytes_total: number;
    enqueued_total: number;
    delivered_total: number;
    expired_total: number;
    quota_rejections_total: number;
    oldest_item_age_seconds: number;
  };

  // ── New: auth/scope metrics ──
  auth_failures_total: number;
  rate_limit_hits_total: number;
  scope_denials_total: number;
}
```

### 4.3 Prometheus Metric Definitions

```typescript
// src/services/prometheus.ts

import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

export function createMetricsRegistry(config: AimeatConfig): Registry {
  const register = new Registry();
  register.setDefaultLabels({ node_id: config.nodeId });

  collectDefaultMetrics({ register }); // Node.js process metrics

  // ── HTTP ──
  new Counter({
    name: 'aimeat_http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status'],
    registers: [register],
  });

  new Histogram({
    name: 'aimeat_http_request_duration_ms',
    help: 'HTTP request duration in milliseconds',
    labelNames: ['method', 'route'],
    buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
    registers: [register],
  });

  // ── Tunnel ──
  new Gauge({
    name: 'aimeat_tunnel_connections_active',
    help: 'Current active tunnel connections',
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
    labelNames: ['reason'],
    registers: [register],
  });

  new Counter({
    name: 'aimeat_tunnel_messages_total',
    help: 'Total tunnel messages',
    labelNames: ['direction', 'type'],
    registers: [register],
  });

  new Histogram({
    name: 'aimeat_tunnel_delivery_latency_ms',
    help: 'Tunnel message delivery round-trip time',
    buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000],
    registers: [register],
  });

  new Counter({
    name: 'aimeat_tunnel_delivery_failures_total',
    help: 'Failed tunnel deliveries',
    registers: [register],
  });

  // ── Mailbox ──
  new Gauge({
    name: 'aimeat_mailbox_items_total',
    help: 'Current mailbox items across all nodes',
    registers: [register],
  });

  new Gauge({
    name: 'aimeat_mailbox_bytes_total',
    help: 'Current mailbox size in bytes',
    registers: [register],
  });

  new Counter({
    name: 'aimeat_mailbox_enqueued_total',
    help: 'Total items enqueued to mailbox',
    labelNames: ['type'],
    registers: [register],
  });

  // ── Auth ──
  new Counter({
    name: 'aimeat_auth_failures_total',
    help: 'Total authentication failures',
    registers: [register],
  });

  new Counter({
    name: 'aimeat_rate_limit_hits_total',
    help: 'Total rate limit hits (429 responses)',
    labelNames: ['tier'],
    registers: [register],
  });

  return register;
}
```

### 4.4 Request Correlation Middleware

```typescript
// src/middleware/request-id.ts

import { v4 as uuidv4 } from 'uuid';

export function requestIdMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  };
}
```

### 4.5 Enhanced Health Check Response

```json
{
  "ok": true,
  "data": {
    "status": "healthy",
    "uptime_seconds": 86400,
    "memory_mb": 128,
    "subsystems": {
      "tunnel": {
        "healthy": true,
        "connections_active": 12,
        "last_connection_at": "2026-03-04T10:30:00Z"
      },
      "mailbox": {
        "healthy": true,
        "items_total": 45,
        "bytes_total": 102400,
        "oldest_item_age_seconds": 3600
      },
      "storage": {
        "healthy": true,
        "type": "memory"
      }
    }
  }
}
```

### 4.6 Latency Tracking in Tunnel Manager

```typescript
// In TunnelManager.sendRequest() — measure round-trip time
const startTime = Date.now();
const response = await this.waitForResponse(messageId, timeoutMs);
const latencyMs = Date.now() - startTime;

// Record in histogram
this.metricsRegistry
  ?.getSingleMetric('aimeat_tunnel_delivery_latency_ms')
  ?.observe(latencyMs);

// Update rolling average for stats API
this.recordLatency(latencyMs);
```

## 5. Implementation Plan

### Phase 1 — Tunnel & Mailbox Telemetry

| Step | Change | File(s) |
|------|--------|---------|
| 1.1 | Add tunnel counter fields to `StatsCollector` | `src/services/stats.ts` |
| 1.2 | Add mailbox counter fields to `StatsCollector` | `src/services/stats.ts` |
| 1.3 | Instrument `TunnelManager`: connect, disconnect, send, receive, timeout, heartbeat miss | `src/services/personal-tunnel.ts` |
| 1.4 | Instrument `MailboxService`: enqueue, deliver, expire, quota reject | `src/services/mailbox.ts` |
| 1.5 | Instrument `routeToPersonalNode()`: fallback counter | `src/services/personal-routing.ts` |
| 1.6 | Add latency tracking to `TunnelManager.sendRequest()` | `src/services/personal-tunnel.ts` |
| 1.7 | Extend `StatsSnapshot` type with `tunnel` and `mailbox` sections | `src/services/stats.ts` |
| 1.8 | Return extended stats in `GET /v1/stats` | `src/routes/stats.ts` |

### Phase 2 — Prometheus Endpoint

| Step | Change | File(s) |
|------|--------|---------|
| 2.1 | Add `prom-client` npm dependency | `package.json` |
| 2.2 | Create `createMetricsRegistry()` | `src/services/prometheus.ts` (new) |
| 2.3 | Create metrics collection middleware | `src/middleware/metrics.ts` (new) |
| 2.4 | Create `GET /v1/metrics` route | `src/routes/stats.ts` (extend) |
| 2.5 | Wire Prometheus counters to tunnel/mailbox instrumentation points | `src/services/personal-tunnel.ts`, `src/services/mailbox.ts` |
| 2.6 | Add `AIMEAT_METRICS_ENABLED` and `AIMEAT_METRICS_ACCESS` config | `src/config.ts` |

### Phase 3 — Structured Logging & Health

| Step | Change | File(s) |
|------|--------|---------|
| 3.1 | Create `requestIdMiddleware` | `src/middleware/request-id.ts` (new) |
| 3.2 | Wire request ID into Winston log context | `src/utils/logger.ts` |
| 3.3 | Add structured tunnel event logs | `src/services/personal-tunnel.ts` |
| 3.4 | Extend `GET /v1/health` with subsystem checks | `src/routes/bootstrap.ts` |
| 3.5 | Add rate-limit hit counter | `src/middleware/rate-limit.ts` |
| 3.6 | Add auth failure counter | `src/auth/middleware.ts` |

### Phase 4 — Dashboarding (Optional)

| Step | Change | Description |
|------|--------|-------------|
| 4.1 | Create Grafana dashboard JSON | `docs/grafana/aimeat-dashboard.json` |
| 4.2 | Create `docker-compose.monitoring.yml` | Prometheus + Grafana sidecar config |
| 4.3 | Document alerting rules | `docs/manuals/observability.md` |

## 6. Configuration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `AIMEAT_METRICS_ENABLED` | Boolean | `false` | Enable `/v1/metrics` Prometheus endpoint |
| `AIMEAT_METRICS_ACCESS` | `public` / `authenticated` / `operator` | `operator` | Who can access `/v1/metrics` |
| `AIMEAT_LATENCY_HISTOGRAM_BUCKETS` | Comma-separated numbers | `5,10,25,50,100,250,500,1000,2500,5000` | HTTP latency histogram bucket boundaries (ms) |
| `AIMEAT_TUNNEL_LATENCY_BUCKETS` | Comma-separated numbers | `50,100,250,500,1000,2500,5000,10000,30000,60000` | Tunnel latency histogram bucket boundaries (ms) |
| `AIMEAT_STATS_ENABLED` | Boolean | `true` | Existing — no change |
| `AIMEAT_STATS_ACCESS` | String | `public` | Existing — no change |
| `LOG_LEVEL` | String | `info` | Existing — no change |

## 7. Metric Naming Conventions

All AIMEAT Prometheus metrics follow these conventions:

| Convention | Rule | Example |
|------------|------|---------|
| Prefix | `aimeat_` | `aimeat_http_requests_total` |
| Suffix: counter | `_total` | `aimeat_tunnel_connections_total` |
| Suffix: gauge | (no suffix) | `aimeat_tunnel_connections_active` |
| Suffix: histogram | `_ms` or `_seconds` or `_bytes` | `aimeat_tunnel_delivery_latency_ms` |
| Labels | lowercase, underscore-separated | `method`, `route`, `status`, `type`, `reason` |
| Units | always in metric name | `_ms`, `_bytes`, `_seconds` |

## 8. Security Considerations

### 8.1 Metrics Endpoint Access
- Default access is `operator` — only authenticated operators can scrape metrics
- Prometheus scraper authenticates via JWT or IP allowlist
- No sensitive data in metric values (no GAIIs, no payloads, no keys)

### 8.2 Request ID Injection
- If the incoming `X-Request-Id` header is present, use it (for distributed tracing)
- If absent, generate a UUIDv4
- Never use request IDs from untrusted sources as storage keys or in queries (prevent injection)

### 8.3 Log Sanitization
- GAII values in structured logs are acceptable (they are public identifiers)
- Never log JWT tokens, private keys, or message payloads
- Ensure error stack traces do not leak file system paths in production

## 9. Testing Strategy

| Test | Description | Phase |
|------|-------------|-------|
| Unit: tunnel counters | Verify increment on connect/disconnect/send/receive | 1 |
| Unit: latency tracking | Verify histogram records correct round-trip time | 1 |
| Unit: mailbox counters | Verify counters on enqueue/deliver/expire | 1 |
| E2E: extended stats | `GET /v1/stats` includes `tunnel` and `mailbox` sections | 1 |
| E2E: Prometheus output | `GET /v1/metrics` returns valid Prometheus text format | 2 |
| E2E: metrics access control | Unauthenticated request → 403 when access = operator | 2 |
| E2E: request ID | Response includes `X-Request-Id` header | 3 |
| E2E: health subsystems | `GET /v1/health` includes tunnel + mailbox subsystem status | 3 |
| E2E: backward compat | All existing 35 tests pass unchanged | All |

## 10. Open Questions

| # | Question | Impact |
|---|----------|--------|
| 1 | Should `prom-client` be a required or optional dependency? If optional, metrics can be disabled entirely without the package installed. | Phase 2 |
| 2 | Should per-agent metrics breakdown be available (e.g., `tunnel_messages_total{agent="..."}`)? High cardinality risk. | Phase 2 |
| 3 | Should OpenTelemetry be supported in addition to or instead of Prometheus? OTEL is gaining traction but adds complexity. | Future |
| 4 | Should the Grafana dashboard be a first-class deliverable or a documentation example? | Phase 4 |
| 5 | Should latency percentiles (p50, p95, p99) be computed server-side and included in `GET /v1/stats`, or left to Prometheus? | Phase 1 |

## 11. Success Criteria

1. **Tunnel visibility** — operator can see active connections, message rates, and delivery latency via `GET /v1/stats` and `GET /v1/metrics`
2. **Prometheus-compatible** — metrics scrapeable by standard Prometheus with no custom tooling
3. **Sub-100ms health check** — `GET /v1/health` responds within 100ms including all subsystem probes
4. **Request tracing** — every response includes `X-Request-Id` and all related log entries share that ID
5. **No breaking changes** — existing `GET /v1/stats` and `GET /v1/health` formats remain backward compatible
6. **Alertable** — operators can set Prometheus alerting rules for tunnel disconnections, mailbox growth, and delivery latency spikes
