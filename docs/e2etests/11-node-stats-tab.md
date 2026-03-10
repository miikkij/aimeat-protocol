# E2E Test Plan: Node Stats Tab

## Overview

The Node Stats tab (`public/views/profile/node-stats-tab.js`) displays read-only node-level statistics including uptime, request counts, active entities, tunnel metrics, mailbox metrics, and security counters. It calls a single endpoint and renders the data in stat cards and breakdown tables.

The admin dashboard also has a stats tab (`public/views/admin/stats-tab.js`) with a similar but operator-focused view.

## APIs Under Test

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/v1/stats` | Configurable (`public` / `authenticated` / `operator`) | Node statistics snapshot |

## Stats Response Schema

The endpoint returns a `StatsSnapshot` object with the following sections:

| Field | Type | Description |
|-------|------|-------------|
| `uptime_seconds` | number | Seconds since server start |
| `started_at` | string (ISO 8601) | Server start timestamp |
| `requests_total` | number | Total HTTP requests served |
| `requests_by_method` | `Record<string, number>` | Breakdown by GET, POST, PUT, DELETE, PATCH |
| `requests_by_status` | `Record<string, number>` | Breakdown by 2xx, 4xx, 5xx |
| `active_owners` | number | Registered owner count |
| `active_agents` | number | Registered agent count |
| `memory_writes` | number | Total memory write operations |
| `memory_reads` | number | Total memory read operations |
| `tunnel.*` | object | WebSocket tunnel stats (connections, messages, latency) |
| `mailbox.*` | object | Offline mailbox stats (items, bytes, delivered, expired) |
| `auth_failures_total` | number | Failed authentication attempts |
| `rate_limit_hits_total` | number | Rate limiter rejections |
| `scope_denials_total` | number | Scope-based access denials |
| `consent_permissions` | object | Consent rule breakdown by type |
| `push_notifications` | object | Push notification configuration status |

## Table of Contents

- [Success Cases](#success-cases) (TC-NS001 to TC-NS008)
- [Failure Cases](#failure-cases) (TC-NS009 to TC-NS012)
- [Edge Cases](#edge-cases) (TC-NS013 to TC-NS018)

---

## Success Cases

### TC-NS001: Load stats and verify all sections populated
- **Precondition:** Server is running with default `statsAccess: "public"` configuration.
- **Steps:**
  1. GET `/v1/stats`.
  2. Verify response status is 200 and `ok: true`.
  3. Verify `uptime_seconds` is a positive number.
  4. Verify `started_at` is a valid ISO 8601 timestamp.
  5. Verify `requests_total` is a non-negative number.
  6. Verify `requests_by_method` is an object with at least one method key.
  7. Verify `requests_by_status` is an object.
  8. Verify `active_owners` and `active_agents` are non-negative numbers.
- **Expected:** All stat fields are present and have valid types.
- **Type:** success

### TC-NS002: Stats accessible without authentication (public mode)
- **Precondition:** Server configured with `statsAccess: "public"` (default).
- **Steps:**
  1. GET `/v1/stats` without any Authorization header.
  2. Verify response status is 200.
  3. Verify response contains the full stats snapshot.
- **Expected:** Public stats endpoint requires no authentication.
- **Type:** success

### TC-NS003: Uptime value is reasonable
- **Precondition:** Server has been running for a known duration.
- **Steps:**
  1. GET `/v1/stats`.
  2. Extract `uptime_seconds`.
  3. Verify it is a positive number greater than 0.
  4. Verify `started_at` timestamp is in the past relative to current time.
  5. Verify `uptime_seconds` approximately equals `(now - started_at) / 1000`.
- **Expected:** Uptime is consistent with the server start time.
- **Type:** success

### TC-NS004: Request counts increment after API calls
- **Precondition:** Server is running.
- **Steps:**
  1. GET `/v1/stats` and record `requests_total` as N.
  2. Make 5 arbitrary API calls (e.g., GET `/v1/boards` five times).
  3. GET `/v1/stats` again and record `requests_total` as M.
  4. Verify M >= N + 5 (at minimum, the 5 calls plus the stats call itself).
- **Expected:** `requests_total` increases with each API request.
- **Type:** success

### TC-NS005: Request breakdown by HTTP method
- **Precondition:** Server has served at least one GET and one POST request.
- **Steps:**
  1. GET `/v1/stats`.
  2. Verify `requests_by_method` contains a `GET` key with a positive value.
  3. If POST requests have been made, verify `POST` key exists.
- **Expected:** Method breakdown accurately tracks request methods.
- **Type:** success

### TC-NS006: Status code breakdown
- **Precondition:** Server has served requests that returned various status codes.
- **Steps:**
  1. GET `/v1/stats`.
  2. Verify `requests_by_status` contains a `2xx` key (from successful requests).
  3. If any 4xx errors have occurred, verify `4xx` key exists.
- **Expected:** Status code buckets (2xx, 4xx, 5xx) are correctly aggregated.
- **Type:** success

### TC-NS007: Tunnel stats structure
- **Precondition:** Server is running (tunnel may or may not have connections).
- **Steps:**
  1. GET `/v1/stats`.
  2. Verify `tunnel` object exists with fields: `connections_active`, `connections_total`, `messages_sent_total`, `messages_received_total`, `delivery_failures_total`, `delivery_latency_avg_ms`, `delivery_latency_p95_ms`.
  3. Verify all tunnel values are non-negative numbers.
- **Expected:** Tunnel stats are always present with valid numeric values, even if zero.
- **Type:** success

### TC-NS008: Security metrics present
- **Precondition:** Server is running.
- **Steps:**
  1. GET `/v1/stats`.
  2. Verify `auth_failures_total` is a non-negative number.
  3. Verify `rate_limit_hits_total` is a non-negative number.
  4. Verify `scope_denials_total` is a non-negative number.
- **Expected:** Security counters are always present. They may be 0 on a fresh server.
- **Type:** success

---

## Failure Cases

### TC-NS009: Stats disabled via configuration
- **Precondition:** Server configured with `statsEnabled: false`.
- **Steps:**
  1. GET `/v1/stats`.
  2. Verify response status is 503.
  3. Verify error code is `FEATURE_DISABLED`.
- **Expected:** When stats are disabled, the endpoint returns 503 Service Unavailable.
- **Type:** failure

### TC-NS010: Stats restricted to operators only
- **Precondition:** Server configured with `statsAccess: "operator"`. Authenticated as a regular owner (not operator).
- **Steps:**
  1. GET `/v1/stats` with a non-operator auth token.
  2. Verify response status is 403.
  3. Verify error code is `ACCESS_DENIED` with message "Operator role required".
- **Expected:** Operator-only stats endpoint rejects non-operator authenticated users.
- **Type:** failure

### TC-NS011: Stats restricted to authenticated users
- **Precondition:** Server configured with `statsAccess: "authenticated"`. No auth token provided.
- **Steps:**
  1. GET `/v1/stats` without any Authorization header.
  2. Verify response status is 401.
  3. Verify error code is `AUTH_REQUIRED`.
- **Expected:** Authenticated-only stats endpoint rejects unauthenticated requests.
- **Type:** failure

### TC-NS012: UI error state on stats load failure
- **Precondition:** Stats endpoint returns an error (e.g., stats disabled or network failure).
- **Steps:**
  1. Navigate to the Node Stats tab.
  2. Verify the error state is displayed instead of stat cards.
  3. Verify the error message text is shown (from `t('profile.nodeStats.error')`).
- **Expected:** The UI shows a user-friendly error message instead of crashing.
- **Type:** failure

---

## Edge Cases

### TC-NS013: Fresh server with minimal stats
- **Precondition:** Freshly started server with no prior requests.
- **Steps:**
  1. GET `/v1/stats` as the first request to the server.
  2. Verify `uptime_seconds` is a small positive number (close to 0).
  3. Verify `requests_total` is 0 or 1 (the stats request itself may or may not be counted yet).
  4. Verify `active_owners` and `active_agents` are 0.
  5. Verify all tunnel and mailbox counters are 0.
  6. Verify security counters are all 0.
- **Expected:** All counters start at zero. The response is well-formed even with no activity.
- **Type:** edge

### TC-NS014: Stats after heavy load
- **Precondition:** Server has processed a large number of requests (thousands).
- **Steps:**
  1. Generate 1000 rapid API calls (e.g., GET `/v1/boards` in a loop).
  2. GET `/v1/stats`.
  3. Verify `requests_total` reflects the high count.
  4. Verify `requests_by_method.GET` is at least 1000.
  5. Verify response time for the stats endpoint is reasonable (under 5 seconds).
- **Expected:** Stats remain accurate under load. The stats endpoint itself performs well.
- **Type:** edge

### TC-NS015: Stats response format validation
- **Precondition:** Server is running.
- **Steps:**
  1. GET `/v1/stats`.
  2. Validate the response against the AIMEAT envelope format: `{ ok: true, node_id: "...", data: { ... } }`.
  3. Verify `data.uptime_seconds` is typeof `number`.
  4. Verify `data.started_at` parses as a valid `Date`.
  5. Verify `data.requests_by_method` is a plain object (not array).
  6. Verify `data.tunnel` is an object with all expected numeric fields.
  7. Verify `data.mailbox` is an object with all expected numeric fields.
- **Expected:** Response strictly conforms to the expected schema.
- **Type:** edge

### TC-NS016: Mailbox stats with zero activity
- **Precondition:** Server running with no mailbox usage.
- **Steps:**
  1. GET `/v1/stats`.
  2. Verify `mailbox.items_total` is 0.
  3. Verify `mailbox.bytes_total` is 0.
  4. Verify `mailbox.delivered_total` is 0.
  5. Verify `mailbox.expired_total` is 0.
  6. In the UI, verify mailbox section renders with zero values (no NaN or undefined).
- **Expected:** Mailbox stats default to 0 when no mailbox activity has occurred.
- **Type:** edge

### TC-NS017: UI uptime formatting
- **Precondition:** Server has been running for various durations.
- **Steps:**
  1. Verify `fmtUptime(90)` displays as `1m` (minutes only).
  2. Verify `fmtUptime(3700)` displays as `1h 1m` (hours and minutes).
  3. Verify `fmtUptime(90000)` displays as `1d 1h 0m` (days, hours, and minutes).
- **Expected:** The uptime formatter correctly breaks seconds into days/hours/minutes.
- **Type:** edge

### TC-NS018: Consent permissions breakdown in stats
- **Precondition:** Server has owners with active consent rules of various types.
- **Steps:**
  1. GET `/v1/stats`.
  2. Verify `consent_permissions` object exists.
  3. Verify it contains `active_rules`, `by_gaii`, `by_ghii`, `by_organism`, `by_domain`, `by_node`, `by_wildcard`, `unique_patterns`.
  4. Verify all values are non-negative numbers.
- **Expected:** Consent permission breakdown is included in the stats response with accurate counts.
- **Type:** edge
