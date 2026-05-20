# Notification Statistics & Persistent Stats -- Design Spec

**Date:** 2026-05-21
**Status:** Approved
**Scope:** Email/push notification counters, full stats persistence, time-range-filtered Stats tab

---

## Goals

1. **Operational visibility** -- confirm email and push notification delivery works, see success/failure counts broken down by type.
2. **Abuse detection** -- spot anomalies like verification email spikes (potential bombardment) through type-level breakdown and per-day charts.
3. **Persistent stats** -- all counters survive server restarts. Historical daily data available for trend analysis.
4. **Time range filtering** -- view stats for today, this week, last 7 days, last 30 days, or a custom date range.

---

## 1. New Notification Counters

### 1.1 Email Counters

Tracked by type: `verification`, `magic_link`, `notification`, `match_suggestion`, `group_send`.

| Counter | Incremented by |
|---------|----------------|
| `email_sent:{type}` | `EmailService.send()` on success |
| `email_failed:{type}` | `EmailService.send()` after retry exhaustion |
| `email_retried:{type}` | `withRetry()` on each retry attempt |

### 1.2 Push Counters

Tracked by type: `test`, `work`, `board`, `federation`, `organism`.

| Counter | Incremented by |
|---------|----------------|
| `push_sent:{type}` | `PushService.sendNotification()` on success |
| `push_failed:{type}` | `PushService.sendNotification()` on failure |
| `push_expired_subs` | `PushService` on 404/410 auto-cleanup (no type breakdown) |

### 1.3 Mailbox Notification Counters

Tracked by channel (`push`, `email`) or block reason (`cooldown`, `quiet_hours`, `disabled`).

| Counter | Incremented by |
|---------|----------------|
| `mailbox_notif_sent:{channel}` | `MailboxNotificationService.notify()` on success |
| `mailbox_notif_failed:{channel}` | `MailboxNotificationService.notify()` on failure |
| `mailbox_notif_blocked:{reason}` | `MailboxNotificationService.notify()` when skipped |

### 1.4 Typed Counter Mechanism

The existing `StatsCollector` uses flat string keys. A new `incrementTyped(name, type)` method stores as `{name}:{type}` (e.g., `email_sent:verification`). The `snapshot()` method returns both the aggregate total and per-type breakdown for typed counters.

```typescript
// New method on StatsCollector
incrementTyped(name: string, type: string): void {
  this.increment(`${name}:${type}`);
}
```

The snapshot output groups typed counters:

```json
{
  "email_sent": 127,
  "email_sent_by_type": {
    "verification": 45,
    "magic_link": 32,
    "notification": 28,
    "match_suggestion": 12,
    "group_send": 10
  }
}
```

Grouping logic: any counter containing `:` is split into `{base}:{type}`. The snapshot collects all matching keys, sums them for the aggregate, and provides the `{base}_by_type` sub-object.

---

## 2. Stats Persistence Layer

### 2.1 Approach: Periodic Flush

Keep the in-memory `StatsCollector` as the hot write path (zero-latency increments). A periodic flush (every 60s) writes accumulated counter values to storage. On startup, load persisted values back into memory.

**Trade-off:** At most 60s of data lost on unclean shutdown. Acceptable for operational counters.

### 2.2 Storage Interface

New methods on the `Storage` interface:

```typescript
flushStats(counters: Record<string, number>): Promise<void>;
loadStats(): Promise<Record<string, number>>;
flushDailyHistory(history: Record<string, Record<string, number>>): Promise<void>;
loadDailyHistory(): Promise<Record<string, Record<string, number>>>;
```

### 2.3 Database Schema

**SQLite:**

```sql
CREATE TABLE stats_counters (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE stats_daily_history (
  date  TEXT NOT NULL,
  key   TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, key)
);
```

**MongoDB (Prisma):**

```prisma
model StatsCounter {
  key   String @id
  value Int    @default(0)
}

model StatsDailyHistory {
  date  String
  key   String
  value Int    @default(0)

  @@id([date, key])
}
```

### 2.4 Lifecycle

1. **Startup:** `loadStats()` + `loadDailyHistory()` seed `StatsCollector` maps with persisted values.
2. **Runtime:** Services call `stats.increment()` / `stats.incrementTyped()` as before (in-memory only).
3. **Flush (every 60s):** `setInterval` calls `storage.flushStats()` with absolute counter values (upsert). Daily history flushed similarly.
4. **Graceful shutdown:** `stats.shutdown()` does one final flush. Wired into the existing SIGTERM/SIGINT handler in `server.ts`.
5. **Daily history pruning:** Keep 90 days in both memory and storage. Flush deletes rows older than 90 days.

### 2.5 Flush Semantics

Writes absolute values (upsert), not deltas. If the process dies mid-flush, the next startup loads whatever was last persisted. No double-counting risk.

### 2.6 StatsCollector Changes

The `StatsCollector` class gains:

- `storage` reference (injected at init, optional for backward compat in tests)
- `flushInterval` timer (60s)
- `async init()` -- load persisted data, start flush timer
- `async shutdown()` -- final flush, clear timer
- `incrementTyped(name, type)` -- typed counter method
- Updated `snapshot()` -- groups typed counters into `{base}` totals + `{base}_by_type` sub-objects

The singleton `initStats()` call in `server.ts` passes the `storage` instance.

---

## 3. API Changes

### 3.1 `GET /v1/stats` -- Time Range Support

New optional query parameters:

```
GET /v1/stats?from=2026-05-14&to=2026-05-21
```

| Param | Format | Default |
|-------|--------|---------|
| `from` | `YYYY-MM-DD` | absent (return lifetime totals) |
| `to` | `YYYY-MM-DD` | absent (return lifetime totals) |

**When `from`/`to` are present:**

The backend sums `stats_daily_history` rows in the date range for each counter key. Returns:

```json
{
  "totals": {
    "requests_total": 4521,
    "email_sent": 127,
    "email_sent_by_type": { "verification": 45, "magic_link": 32, ... },
    ...
  },
  "daily": {
    "2026-05-14": { "requests_total": 612, "email_sent": 32, ... },
    "2026-05-15": { "requests_total": 703, "email_sent": 45, ... },
    ...
  }
}
```

**When absent:** Returns current counter totals (backward compatible with existing behavior). The `daily` field is still included, containing the last 30 days of history for charts.

### 3.2 Gauge Handling

Gauges (`connections_active`, `items_total`, `bytes_total`, `oldest_item_age_seconds`) are point-in-time values. They always return current values regardless of time range. Marked with a `_gauge` suffix convention or a separate `gauges` key in the response so the UI can distinguish them.

```json
{
  "totals": { ... },
  "daily": { ... },
  "gauges": {
    "tunnel_connections_active": 3,
    "mailbox_items_total": 42,
    "mailbox_bytes_total": 128000,
    "mailbox_oldest_item_age_seconds": 3600
  }
}
```

---

## 4. Stats Tab UI

### 4.1 Time Range Selector

Placed at the top of the Stats tab, above all sections:

```
Stats Period:  [Today] [This Week] [7 Days] [30 Days] [All]

Custom: [____-__-__] to [____-__-__]  [Apply]
```

**Presets:**
- **Today** -- current calendar day (midnight to now)
- **This Week** -- Monday through today
- **7 Days** -- last 7 calendar days including today (default)
- **30 Days** -- last 30 calendar days
- **All** -- all persisted data (lifetime totals)

**Custom range:** Two date inputs with an Apply button.

**Default on page load:** 7 Days.

Selecting a range re-fetches `GET /v1/stats?from=...&to=...` and updates all sections.

### 4.2 Email Delivery Section

Placed after existing Mailbox Stats, before Consent Permission Stats.

**Stat cards (4-column grid):**

| Card | Value | Color logic |
|------|-------|-------------|
| Emails Sent | sum of `email_sent` | default |
| Emails Failed | sum of `email_failed` | red if > 0 |
| Emails Retried | sum of `email_retried` | yellow if > 0 |
| Success Rate | sent / (sent + failed) * 100 | green > 95%, yellow 80-95%, red < 80% |

**Breakdown table:**

| Type | Sent | Failed | Retried |
|------|------|--------|---------|
| Verification | N | N | N |
| Magic Link | N | N | N |
| Notification | N | N | N |
| Match Suggestion | N | N | N |
| Group Send | N | N | N |

**Per-day bar chart** (shown when range > 1 day):

Stacked/grouped bar chart using Chart.js. X-axis: dates. Bars: Sent (blue), Failed (red), Retried (yellow). Same Chart.js setup already used by the Daily Activity chart.

### 4.3 Push Notification Section

Immediately after Email Delivery.

**Stat cards (4-column grid):**

| Card | Value | Color logic |
|------|-------|-------------|
| Push Sent | sum of `push_sent` | default |
| Push Failed | sum of `push_failed` | red if > 0 |
| Expired Subs | `push_expired_subs` | yellow if > 0 |
| Success Rate | sent / (sent + failed) * 100 | green > 95%, yellow 80-95%, red < 80% |

**Breakdown table:**

| Type | Sent | Failed |
|------|------|--------|
| Test | N | N |
| Work | N | N |
| Board | N | N |
| Federation | N | N |
| Organism | N | N |

**Per-day bar chart:** Same pattern as email -- Sent (blue), Failed (red).

### 4.4 Mailbox Notifications Section

Sub-section after Push, smaller scope.

**Stat cards (3-column grid):**

| Card | Value | Color logic |
|------|-------|-------------|
| Mailbox Sent | sum of `mailbox_notif_sent` | default |
| Mailbox Failed | sum of `mailbox_notif_failed` | red if > 0 |
| Mailbox Blocked | sum of `mailbox_notif_blocked` | yellow if > 0 |

**Inline breakdowns (text, not table):**
- Blocked: Cooldown: N | Quiet Hours: N | Disabled: N
- Channels: Push: N sent, N failed | Email: N sent, N failed

No per-day chart for mailbox notifications (lower volume, not worth the visual space).

### 4.5 Existing Sections -- Updated

All existing stat card sections (Requests, Memory Ops, Tunnel, Mailbox, Security, Consent) now show values filtered by the selected time range. Gauges always show current values with a "live" indicator badge.

The existing Daily Activity chart, Weekly Comparison chart, and Monthly Trend chart use the same time-range-filtered `daily` data from the API instead of their current hardcoded 30-day window.

### 4.6 i18n

New translation keys for both `en.json` and `fi.json`:

- Section headers: `dashboard.emailDelivery`, `dashboard.pushNotifications`, `dashboard.mailboxNotifications`
- Stat cards: `dashboard.emailsSent`, `dashboard.emailsFailed`, `dashboard.emailsRetried`, `dashboard.successRate`, `dashboard.pushSent`, `dashboard.pushFailed`, `dashboard.expiredSubs`, `dashboard.mailboxNotifSent`, `dashboard.mailboxNotifFailed`, `dashboard.mailboxNotifBlocked`
- Types: `dashboard.emailType.verification`, `dashboard.emailType.magic_link`, etc.
- Time range: `dashboard.periodToday`, `dashboard.periodThisWeek`, `dashboard.period7Days`, `dashboard.period30Days`, `dashboard.periodAll`, `dashboard.periodCustom`, `dashboard.periodApply`
- Gauge badge: `dashboard.live`
- Blocked reasons: `dashboard.blockedCooldown`, `dashboard.blockedQuietHours`, `dashboard.blockedDisabled`
- Channel labels: `dashboard.channelPush`, `dashboard.channelEmail`

---

## 5. Files Affected

### Backend (new/modified)

| File | Change |
|------|--------|
| `src/services/stats.ts` | `incrementTyped()`, `init(storage)`, `shutdown()`, flush timer, load on startup, typed counter grouping in `snapshot()` |
| `src/services/email.ts` | Increment `email_sent:{type}`, `email_failed:{type}`, `email_retried:{type}` |
| `src/services/push.ts` | Increment `push_sent:{type}`, `push_failed:{type}`, `push_expired_subs` |
| `src/services/mailbox-notification.ts` | Increment `mailbox_notif_sent:{channel}`, `mailbox_notif_failed:{channel}`, `mailbox_notif_blocked:{reason}` |
| `src/storage/interface.ts` | Add `flushStats`, `loadStats`, `flushDailyHistory`, `loadDailyHistory` methods |
| `src/storage/providers/sqlite/index.ts` | Implement new storage methods, create tables |
| `src/storage/providers/mongodb/index.ts` | Implement new storage methods via Prisma |
| `aimeat/prisma/schema.prisma` | Add `StatsCounter` and `StatsDailyHistory` models |
| `src/routes/stats.ts` | Parse `from`/`to` query params, return filtered + daily data |
| `src/server.ts` | Pass `storage` to `initStats()`, wire `stats.shutdown()` to graceful shutdown |

### Frontend (new/modified)

| File | Change |
|------|--------|
| `public/views/admin/stats-tab.js` | Time range selector, Email Delivery section, Push Notification section, Mailbox Notifications section, per-day charts |
| `public/js/services/admin.js` or `stats.js` | Pass `from`/`to` query params to `GET /v1/stats` |
| `public/css/views/admin.css` | Styles for time range selector, breakdown tables |
| `locales/en.json` | New translation keys |
| `locales/fi.json` | New translation keys |

### Tests

| File | Change |
|------|--------|
| `test/unit/stats.test.ts` | Test typed counters, persistence load/flush, daily history, snapshot grouping |
| `test/` (new or existing E2E) | Test `GET /v1/stats?from=...&to=...` returns filtered data |

---

## 6. Out of Scope

- Per-recipient tracking (privacy concern, memory cost)
- Automatic alerting/thresholds (can be added later based on these counters)
- Email bounce/delivery receipt tracking (would require webhook integration with SMTP provider)
- Prometheus metrics for notification counters (existing `/v1/metrics` endpoint can be extended later)
