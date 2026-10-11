# AIMEAT Observability Guide

Operator guide for monitoring a node: the JSON statistics, the Prometheus metrics and the built-in pages.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `AIMEAT_STATS_ENABLED` | `true` | Enable `GET /v1/stats` JSON endpoint |
| `AIMEAT_STATS_ACCESS` | `public` | Access level: `public`, `authenticated`, `operator` |
| `AIMEAT_METRICS_ENABLED` | `false` | Enable `GET /v1/metrics` Prometheus endpoint |
| `AIMEAT_METRICS_ACCESS` | `operator` | Access level: `public`, `authenticated`, `operator` |

Set these in your `.env` file or via environment variables. The `aimeat init` wizard prompts for metrics settings when using the `public` or `custom` use case.

## Stats Endpoint — `GET /v1/stats`

Returns a JSON snapshot of node health and activity:

```
GET /v1/stats
Authorization: Bearer <token>   # if access != public
```

Response fields:

- `uptime_seconds`, `started_at` — node health
- `requests_total`, `requests_by_method`, `requests_by_status` — HTTP traffic
- `memory_writes`, `memory_reads` — storage activity
- `consent_grants`, `consent_revocations` — privacy operations
- `schema_validations`, `schema_validation_failures` — data quality
- `tunnel.*` — WebSocket tunnel metrics (active connections, messages, latency, failures)
- `mailbox.*` — offline message queue (items, bytes, delivery, expiration)
- `auth_failures_total`, `rate_limit_hits_total`, `scope_denials_total` — security events
- `active_owners`, `active_agents` — registered entity counts
- `daily_history` — per-day counter breakdown (rolling 30 days)

## Metrics Endpoint — `GET /v1/metrics`

Prometheus-compatible text format. Scrape with any Prometheus-compatible collector.

```
GET /v1/metrics
Authorization: Bearer <token>   # if access != public
```

The node's own metrics, as registered in `src/services/prometheus.ts` (all with the `aimeat_` prefix):

| Metric | Type | Description |
|--------|------|-------------|
| `aimeat_http_requests_total` | Counter | HTTP requests (labels: method, route, status) |
| `aimeat_http_request_duration_ms` | Histogram | HTTP request duration in ms (labels: method, route; buckets 5 to 5000) |
| `aimeat_tunnel_connections_active` | Gauge | WebSocket tunnels open now |
| `aimeat_tunnel_connections_total` | Counter | Tunnel connections established |
| `aimeat_tunnel_disconnections_total` | Counter | Tunnel disconnections (label: reason) |
| `aimeat_tunnel_reconnects_total` | Counter | Tunnel reconnection attempts |
| `aimeat_tunnel_messages_sent_total` | Counter | Tunnel messages sent (label: type) |
| `aimeat_tunnel_messages_received_total` | Counter | Tunnel messages received (label: type) |
| `aimeat_tunnel_delivery_failures_total` | Counter | Failed message deliveries |
| `aimeat_tunnel_delivery_latency_ms` | Histogram | Delivery latency in ms (buckets 50 to 60000) |
| `aimeat_tunnel_heartbeat_misses_total` | Counter | Missed tunnel heartbeats |
| `aimeat_tunnel_mailbox_fallbacks_total` | Counter | Messages that fell back to mailbox delivery |
| `aimeat_mailbox_items_total` | Gauge | Items queued in all mailboxes now |
| `aimeat_mailbox_bytes_total` | Gauge | Bytes queued in all mailboxes now |
| `aimeat_mailbox_oldest_item_age_seconds` | Gauge | Age of the oldest queued item |
| `aimeat_mailbox_enqueued_total` | Counter | Items enqueued (label: type) |
| `aimeat_mailbox_delivered_total` | Counter | Items delivered from mailboxes |
| `aimeat_mailbox_expired_total` | Counter | Items that expired unread |
| `aimeat_mailbox_quota_rejections_total` | Counter | Enqueues refused because a mailbox was full |
| `aimeat_auth_failures_total` | Counter | Failed authentication attempts |
| `aimeat_rate_limit_hits_total` | Counter | Rate limit triggers (label: tier) |
| `aimeat_scope_denials_total` | Counter | Scope/permission denials |

The endpoint also carries the Node.js process metrics of `prom-client` (`collectDefaultMetrics`): `process_*` and `nodejs_*` (CPU, resident memory, heap, event-loop lag, garbage collection), without the `aimeat_` prefix.

Uptime, the number of owners and agents, memory reads and writes, consent operations and schema validations are not Prometheus metrics. They are in the JSON from `GET /v1/stats` (`uptime_seconds`, `active_owners`, `active_agents`, `memory_writes`, and the rest listed above).

### Prometheus scrape config example

```yaml
scrape_configs:
  - job_name: 'aimeat'
    scrape_interval: 30s
    static_configs:
      - targets: ['localhost:40050']
    metrics_path: '/v1/metrics'
    # If metrics_access is not 'public':
    bearer_token: '<operator-jwt>'
```

## Built-in UI

### Admin Dashboard (operators)

Navigate to the admin dashboard and open the **Stats** section. Shows:

- Node overview (uptime, request count, owners, agents)
- Tunnel statistics (active connections, messages, latency, failures)
- Tunnel activity chart (doughnut — sent/received/failures/fallbacks)
- Mailbox queue status (items, bytes, delivery rates)
- Security counters (auth failures, rate limits, scope denials)

All values are color-coded: green for healthy, yellow for warnings, red for problems.

### Profile Page (users)

The **Node Stats** tab on the profile page (`/v1/profile`) shows the same statistics in a user-friendly layout. Available to any authenticated user if `AIMEAT_STATS_ACCESS` allows it.

Sections: overview cards, requests by method/status, tunnel, mailbox, security.

## Alerting Guidelines

Key thresholds to monitor:

| Metric | Warning | Critical |
|--------|---------|----------|
| `auth_failures_total` | > 10/hour | > 50/hour |
| `rate_limit_hits_total` | > 20/hour | > 100/hour |
| `tunnel.delivery_failures_total` | any increase | sustained increase |
| `tunnel.delivery_latency_p95_ms` | > 200ms | > 1000ms |
| `mailbox.expired_total` | any increase | sustained increase |
| `mailbox.bytes_total` | > 50MB | > 200MB |

## Quick Start

1. Set `AIMEAT_METRICS_ENABLED=true` in `.env`
2. Restart the node
3. Verify: `curl http://localhost:40050/v1/stats`
4. View dashboard: sign in as operator, navigate to Stats tab
5. (Optional) Point Prometheus at `http://localhost:40050/v1/metrics`
