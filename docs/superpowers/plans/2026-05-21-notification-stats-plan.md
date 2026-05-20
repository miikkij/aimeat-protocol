# Notification Statistics & Persistent Stats -- Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add email/push/mailbox notification counters with type breakdown, persist all stats to storage, add time-range-filtered `GET /v1/stats` API, and build Stats tab UI sections with per-day charts.

**Architecture:** In-memory `StatsCollector` remains the hot write path. A 60s flush timer persists counter snapshots to a new `stats_counters` table (SQLite) / `StatsCounter` model (MongoDB). Daily history also persists. The stats route gains `from`/`to` query params that filter from `stats_daily_history`. The frontend Stats tab gains a time range selector, email delivery section, push notification section, and mailbox notification section with per-day bar charts.

**Tech Stack:** TypeScript, Express, better-sqlite3, Prisma (MongoDB), Preact + HTM (frontend), Chart.js (charts)

**Design spec:** `docs/superpowers/specs/2026-05-21-notification-stats-design.md`

---

## File Structure

### New files

| File | Purpose |
|------|---------|
| `src/storage/repositories/stats.repository.ts` | Repository interface: `flushStats`, `loadStats`, `flushDailyHistory`, `loadDailyHistory` |

### Modified files

| File | Change |
|------|--------|
| `src/services/stats.ts` | Add `incrementTyped()`, persistence init/flush/shutdown, typed counter grouping in `snapshot()` |
| `src/services/email.ts` | Increment email counters via `getStats()` |
| `src/services/push.ts` | Increment push counters via `getStats()` |
| `src/services/mailbox-notification.ts` | Increment mailbox notification counters via `getStats()` |
| `src/storage/interface.ts` | Add `StatsRepository` to Storage composition |
| `src/storage/repositories/index.ts` | Re-export StatsRepository |
| `src/storage/providers/sqlite/schema.ts` | Add `stats_counters` and `stats_daily_history` tables |
| `src/storage/providers/sqlite/index.ts` | Implement stats repository methods |
| `src/storage/providers/mongodb/index.ts` | Implement stats repository methods via Prisma |
| `prisma/schema.prisma` | Add `StatsCounter` and `StatsDailyHistory` models |
| `src/routes/stats.ts` | Parse `from`/`to` query params, return filtered + daily data with typed counter grouping |
| `src/server-bootstrap/routes-loader.ts` | Pass `storage` to `initStats()` |
| `src/index.ts` | Add SIGTERM/SIGINT handler calling `stats.shutdown()` |
| `public/views/admin/stats-tab.js` | Time range selector, email/push/mailbox sections, per-day charts |
| `public/js/services/admin.js` | Pass `from`/`to` query params to `GET /v1/stats` |
| `public/css/views/admin.css` | Styles for time range selector and breakdown tables |
| `locales/en.json` | New translation keys |
| `locales/fi.json` | New translation keys |
| `test/unit/stats.test.ts` | Tests for typed counters, snapshot grouping, persistence |

---

## Task 1: Stats Repository Interface

**Files:**
- Create: `src/storage/repositories/stats.repository.ts`
- Modify: `src/storage/repositories/index.ts`
- Modify: `src/storage/interface.ts`

- [ ] **Step 1: Create the repository interface**

Create `aimeat/src/storage/repositories/stats.repository.ts`:

```typescript
/**
 * @file stats.repository.ts
 * @description Storage repository for persisting stats counters and daily history.
 * @version-history v1.0.0 -- 2026-05-21 -- Initial creation
 */

export interface StatsRepository {
  flushStats(counters: Record<string, number>): Promise<void>;
  loadStats(): Promise<Record<string, number>>;
  flushDailyHistory(history: Record<string, Record<string, number>>): Promise<void>;
  loadDailyHistory(): Promise<Record<string, Record<string, number>>>;
}
```

- [ ] **Step 2: Re-export from index**

In `aimeat/src/storage/repositories/index.ts`, add:

```typescript
export type { StatsRepository } from './stats.repository.js';
```

- [ ] **Step 3: Add StatsRepository to Storage composition**

In `aimeat/src/storage/interface.ts`, add the import and extend the `Storage` interface:

```typescript
import type { StatsRepository } from './repositories/stats.repository.js';
```

Add `StatsRepository` to the `extends` list in the `Storage` interface (after `CapabilityRepository`).

- [ ] **Step 4: Run typecheck to confirm the interface compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: Errors about missing implementations in SqliteStorage and MongoStorage (expected -- implementations come in later tasks).

- [ ] **Step 5: Commit**

```bash
git add src/storage/repositories/stats.repository.ts src/storage/repositories/index.ts src/storage/interface.ts
git commit -m "feat: add StatsRepository interface for persistent stats"
```

---

## Task 2: SQLite Stats Persistence

**Files:**
- Modify: `src/storage/providers/sqlite/schema.ts`
- Modify: `src/storage/providers/sqlite/index.ts`

- [ ] **Step 1: Add tables to SQLite schema**

In `aimeat/src/storage/providers/sqlite/schema.ts`, add inside the `initializeSchema` function (after the last `CREATE TABLE`):

```sql
-- ── Stats Persistence ──
CREATE TABLE IF NOT EXISTS stats_counters (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stats_daily_history (
  date  TEXT NOT NULL,
  key   TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, key)
);
```

- [ ] **Step 2: Implement stats methods in SqliteStorage**

In `aimeat/src/storage/providers/sqlite/index.ts`, add these methods to the `SqliteStorage` class. Find a good location (near the end of the class, before the closing brace):

```typescript
// ── Stats Persistence ──

async flushStats(counters: Record<string, number>): Promise<void> {
  const upsert = this.db.prepare(
    `INSERT INTO stats_counters (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  );
  const tx = this.db.transaction((entries: [string, number][]) => {
    for (const [key, value] of entries) {
      upsert.run(key, value);
    }
  });
  tx(Object.entries(counters));
}

async loadStats(): Promise<Record<string, number>> {
  const rows = this.db.prepare('SELECT key, value FROM stats_counters').all() as Array<{ key: string; value: number }>;
  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

async flushDailyHistory(history: Record<string, Record<string, number>>): Promise<void> {
  const upsert = this.db.prepare(
    `INSERT INTO stats_daily_history (date, key, value) VALUES (?, ?, ?)
     ON CONFLICT(date, key) DO UPDATE SET value = excluded.value`
  );
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const tx = this.db.transaction((entries: [string, Record<string, number>][]) => {
    for (const [date, counters] of entries) {
      for (const [key, value] of Object.entries(counters)) {
        upsert.run(date, key, value);
      }
    }
    this.db.prepare('DELETE FROM stats_daily_history WHERE date < ?').run(cutoffStr);
  });
  tx(Object.entries(history));
}

async loadDailyHistory(): Promise<Record<string, Record<string, number>>> {
  const rows = this.db.prepare('SELECT date, key, value FROM stats_daily_history ORDER BY date').all() as Array<{ date: string; key: string; value: number }>;
  const result: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    if (!result[row.date]) result[row.date] = {};
    result[row.date][row.key] = row.value;
  }
  return result;
}
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: Only MongoStorage errors remain (SQLite should be clean).

- [ ] **Step 4: Commit**

```bash
git add src/storage/providers/sqlite/schema.ts src/storage/providers/sqlite/index.ts
git commit -m "feat: implement stats persistence for SQLite backend"
```

---

## Task 3: MongoDB Stats Persistence

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/storage/providers/mongodb/index.ts`

- [ ] **Step 1: Add Prisma models**

In `aimeat/prisma/schema.prisma`, add at the end:

```prisma
model StatsCounter {
  id    String @id @map("_id")
  value Int    @default(0)
}

model StatsDailyHistory {
  id    String @id @default(auto()) @map("_id") @db.ObjectId
  date  String
  key   String
  value Int    @default(0)

  @@unique([date, key])
}
```

Note: MongoDB Prisma requires `@id @map("_id")`. For `StatsCounter`, we use the counter key as the id. For `StatsDailyHistory`, we use a composite unique index on `[date, key]` and auto-generated ObjectId as `_id`.

- [ ] **Step 2: Generate Prisma client**

Run: `cd aimeat && npx prisma generate`

Expected: "Generated Prisma Client" success message.

- [ ] **Step 3: Implement stats methods in MongoStorage**

In `aimeat/src/storage/providers/mongodb/index.ts`, add these methods to the `MongoStorage` class (near the end, before the closing brace):

```typescript
// ── Stats Persistence ──

async flushStats(counters: Record<string, number>): Promise<void> {
  const ops = Object.entries(counters).map(([key, value]) =>
    this.prisma.statsCounter.upsert({
      where: { id: key },
      create: { id: key, value },
      update: { value },
    })
  );
  await Promise.all(ops);
}

async loadStats(): Promise<Record<string, number>> {
  const rows = await this.prisma.statsCounter.findMany();
  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.id] = row.value;
  }
  return result;
}

async flushDailyHistory(history: Record<string, Record<string, number>>): Promise<void> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const ops: Promise<unknown>[] = [];
  for (const [date, counters] of Object.entries(history)) {
    for (const [key, value] of Object.entries(counters)) {
      ops.push(
        this.prisma.statsDailyHistory.upsert({
          where: { date_key: { date, key } },
          create: { date, key, value },
          update: { value },
        })
      );
    }
  }
  ops.push(
    this.prisma.statsDailyHistory.deleteMany({ where: { date: { lt: cutoffStr } } })
  );
  await Promise.all(ops);
}

async loadDailyHistory(): Promise<Record<string, Record<string, number>>> {
  const rows = await this.prisma.statsDailyHistory.findMany({ orderBy: { date: 'asc' } });
  const result: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    if (!result[row.date]) result[row.date] = {};
    result[row.date][row.key] = row.value;
  }
  return result;
}
```

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | head -5`

Expected: Clean (no errors).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma src/storage/providers/mongodb/index.ts
git commit -m "feat: implement stats persistence for MongoDB backend"
```

---

## Task 4: StatsCollector -- Typed Counters + Persistence

**Files:**
- Modify: `src/services/stats.ts`
- Modify: `src/server-bootstrap/routes-loader.ts`
- Modify: `src/index.ts`
- Test: `test/unit/stats.test.ts`

- [ ] **Step 1: Write tests for typed counters and snapshot grouping**

Add to `aimeat/test/unit/stats.test.ts` inside the main `describe` block:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd aimeat && npx vitest run test/unit/stats.test.ts 2>&1 | tail -20`

Expected: FAIL -- `incrementTyped` is not a function.

- [ ] **Step 3: Implement StatsCollector changes**

Replace the full content of `aimeat/src/services/stats.ts`. Key changes:
1. Add `incrementTyped(name, type)` that calls `this.increment()` on `${name}:${type}`.
2. Change `increment()` signature to accept `string` (not just `CounterName`) -- the typed keys like `email_sent:verification` are dynamic.
3. Update `snapshot()` to detect `:` in counter keys, group them into `{base}` totals and `{base}_by_type` objects.
4. Add `storage` field, `init(storage)` async method, `shutdown()` async method, and flush timer.
5. Update `initStats()` to optionally accept `Storage` and call `init()`.
6. Add `getSnapshotForRange(from, to)` method that sums daily history for a date range.
7. The return type of `snapshot()` changes from the fixed `StatsSnapshot` interface to a more flexible shape. Add `[key: string]: unknown` to `StatsSnapshot` to accommodate dynamic typed counter fields.

The full implementation:

```typescript
/**
 * @file stats.ts
 * @description In-memory stats collector with typed counters and periodic persistence.
 * @version-history
 *   v1.0.0 -- 2026-04-15 -- Initial stats collector
 *   v2.0.0 -- 2026-05-21 -- Typed counters, persistence, time-range support
 */

import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

export interface TunnelStats {
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
}

export interface MailboxStats {
  items_total: number;
  bytes_total: number;
  enqueued_total: number;
  delivered_total: number;
  expired_total: number;
  quota_rejections_total: number;
  oldest_item_age_seconds: number;
}

export interface StatsSnapshot {
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
  tunnel: TunnelStats;
  mailbox: MailboxStats;
  auth_failures_total: number;
  rate_limit_hits_total: number;
  scope_denials_total: number;
  [key: string]: unknown;
}

const TRACKED_COUNTERS = [
  'requests_total', 'memory_writes', 'memory_reads',
  'consent_grants', 'consent_revocations',
  'schema_validations', 'schema_validation_failures',
  'auth_failures_total', 'rate_limit_hits_total', 'scope_denials_total',
] as const;

export type CounterName = (typeof TRACKED_COUNTERS)[number];

export type TunnelCounterName =
  | 'connections_total'
  | 'disconnections_total'
  | 'reconnects_total'
  | 'messages_sent_total'
  | 'messages_received_total'
  | 'delivery_failures_total'
  | 'heartbeat_misses_total'
  | 'mailbox_fallbacks_total';

export type MailboxCounterName =
  | 'enqueued_total'
  | 'delivered_total'
  | 'expired_total'
  | 'quota_rejections_total';

export type MailboxGaugeName =
  | 'items_total'
  | 'bytes_total'
  | 'oldest_item_age_seconds';

const LATENCY_WINDOW_SIZE = 1000;
const FLUSH_INTERVAL_MS = 60_000;

export class StatsCollector {
  private counters = new Map<string, number>();
  private methods = new Map<string, number>();
  private statuses = new Map<string, number>();
  private dailyHistory = new Map<string, Map<string, number>>();
  private startedAt = new Date().toISOString();

  private tunnelCounters = new Map<string, number>();
  private tunnelGauges = new Map<string, number>();

  private mailboxCounters = new Map<string, number>();
  private mailboxGauges = new Map<string, number>();

  private latencySamples: number[] = [];

  private storage: Storage | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  increment(name: string): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + 1);
    const day = new Date().toISOString().split('T')[0];
    if (!this.dailyHistory.has(day)) this.dailyHistory.set(day, new Map());
    const dayMap = this.dailyHistory.get(day)!;
    dayMap.set(name, (dayMap.get(name) ?? 0) + 1);
  }

  incrementTyped(name: string, type: string): void {
    this.increment(`${name}:${type}`);
  }

  incrementMethod(method: string): void {
    this.methods.set(method, (this.methods.get(method) ?? 0) + 1);
  }

  incrementStatus(code: number): void {
    const bucket = code < 400 ? '2xx' : code < 500 ? '4xx' : '5xx';
    this.statuses.set(bucket, (this.statuses.get(bucket) ?? 0) + 1);
  }

  incrementTunnel(name: TunnelCounterName): void {
    this.tunnelCounters.set(name, (this.tunnelCounters.get(name) ?? 0) + 1);
  }

  setTunnelGauge(name: 'connections_active', value: number): void {
    this.tunnelGauges.set(name, value);
  }

  incrementMailbox(name: MailboxCounterName): void {
    this.mailboxCounters.set(name, (this.mailboxCounters.get(name) ?? 0) + 1);
  }

  setMailboxGauge(name: MailboxGaugeName, value: number): void {
    this.mailboxGauges.set(name, value);
  }

  recordDeliveryLatency(ms: number): void {
    this.latencySamples.push(ms);
    if (this.latencySamples.length > LATENCY_WINDOW_SIZE) {
      this.latencySamples = this.latencySamples.slice(-LATENCY_WINDOW_SIZE);
    }
  }

  private computeLatencyStats(): { avg: number; p95: number } {
    const samples = this.latencySamples;
    if (samples.length === 0) return { avg: 0, p95: 0 };
    const sum = samples.reduce((a, b) => a + b, 0);
    const avg = sum / samples.length;
    const sorted = [...samples].sort((a, b) => a - b);
    const p95Index = Math.ceil(0.95 * sorted.length) - 1;
    const p95 = sorted[p95Index];
    return { avg, p95 };
  }

  /**
   * Build grouped typed counters from all counter keys containing ':'.
   * e.g. { 'email_sent:verification': 5, 'email_sent:magic_link': 3 }
   *   -> { email_sent: 8, email_sent_by_type: { verification: 5, magic_link: 3 } }
   */
  private buildTypedGroups(): Record<string, unknown> {
    const groups = new Map<string, Map<string, number>>();
    for (const [key, value] of this.counters) {
      const colonIdx = key.indexOf(':');
      if (colonIdx < 0) continue;
      const base = key.slice(0, colonIdx);
      const type = key.slice(colonIdx + 1);
      if (!groups.has(base)) groups.set(base, new Map());
      groups.get(base)!.set(type, value);
    }
    const result: Record<string, unknown> = {};
    for (const [base, types] of groups) {
      let total = 0;
      const byType: Record<string, number> = {};
      for (const [type, value] of types) {
        total += value;
        byType[type] = value;
      }
      result[base] = total;
      result[`${base}_by_type`] = byType;
    }
    return result;
  }

  snapshot(): StatsSnapshot {
    const daily: Record<string, Record<string, number>> = {};
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    for (const [day, counters] of this.dailyHistory) {
      if (day < cutoffStr) { this.dailyHistory.delete(day); continue; }
      daily[day] = Object.fromEntries(counters);
    }

    const latency = this.computeLatencyStats();

    return {
      uptime_seconds: Math.floor((Date.now() - new Date(this.startedAt).getTime()) / 1000),
      started_at: this.startedAt,
      requests_total: this.counters.get('requests_total') ?? 0,
      requests_by_method: Object.fromEntries(this.methods),
      requests_by_status: Object.fromEntries(this.statuses),
      memory_writes: this.counters.get('memory_writes') ?? 0,
      memory_reads: this.counters.get('memory_reads') ?? 0,
      consent_grants: this.counters.get('consent_grants') ?? 0,
      consent_revocations: this.counters.get('consent_revocations') ?? 0,
      schema_validations: this.counters.get('schema_validations') ?? 0,
      schema_validation_failures: this.counters.get('schema_validation_failures') ?? 0,
      daily_history: daily,
      tunnel: {
        connections_active: this.tunnelGauges.get('connections_active') ?? 0,
        connections_total: this.tunnelCounters.get('connections_total') ?? 0,
        disconnections_total: this.tunnelCounters.get('disconnections_total') ?? 0,
        reconnects_total: this.tunnelCounters.get('reconnects_total') ?? 0,
        messages_sent_total: this.tunnelCounters.get('messages_sent_total') ?? 0,
        messages_received_total: this.tunnelCounters.get('messages_received_total') ?? 0,
        delivery_failures_total: this.tunnelCounters.get('delivery_failures_total') ?? 0,
        delivery_latency_avg_ms: latency.avg,
        delivery_latency_p95_ms: latency.p95,
        heartbeat_misses_total: this.tunnelCounters.get('heartbeat_misses_total') ?? 0,
        mailbox_fallbacks_total: this.tunnelCounters.get('mailbox_fallbacks_total') ?? 0,
      },
      mailbox: {
        items_total: this.mailboxGauges.get('items_total') ?? 0,
        bytes_total: this.mailboxGauges.get('bytes_total') ?? 0,
        enqueued_total: this.mailboxCounters.get('enqueued_total') ?? 0,
        delivered_total: this.mailboxCounters.get('delivered_total') ?? 0,
        expired_total: this.mailboxCounters.get('expired_total') ?? 0,
        quota_rejections_total: this.mailboxCounters.get('quota_rejections_total') ?? 0,
        oldest_item_age_seconds: this.mailboxGauges.get('oldest_item_age_seconds') ?? 0,
      },
      auth_failures_total: this.counters.get('auth_failures_total') ?? 0,
      rate_limit_hits_total: this.counters.get('rate_limit_hits_total') ?? 0,
      scope_denials_total: this.counters.get('scope_denials_total') ?? 0,
      ...this.buildTypedGroups(),
    };
  }

  /**
   * Sum daily history for a date range. Returns totals and per-day breakdown.
   * Typed counters in daily history (e.g. 'email_sent:verification') are grouped
   * the same way as in snapshot().
   */
  snapshotForRange(from: string, to: string): { totals: Record<string, unknown>; daily: Record<string, Record<string, number>> } {
    const daily: Record<string, Record<string, number>> = {};
    const summed = new Map<string, number>();

    for (const [day, counters] of this.dailyHistory) {
      if (day < from || day > to) continue;
      daily[day] = Object.fromEntries(counters);
      for (const [key, value] of counters) {
        summed.set(key, (summed.get(key) ?? 0) + value);
      }
    }

    // Build totals with typed grouping
    const totals: Record<string, unknown> = {};
    const groups = new Map<string, Map<string, number>>();

    for (const [key, value] of summed) {
      const colonIdx = key.indexOf(':');
      if (colonIdx < 0) {
        totals[key] = value;
      } else {
        const base = key.slice(0, colonIdx);
        const type = key.slice(colonIdx + 1);
        if (!groups.has(base)) groups.set(base, new Map());
        groups.get(base)!.set(type, value);
      }
    }
    for (const [base, types] of groups) {
      let total = 0;
      const byType: Record<string, number> = {};
      for (const [type, value] of types) {
        total += value;
        byType[type] = value;
      }
      totals[base] = total;
      totals[`${base}_by_type`] = byType;
    }

    return { totals, daily };
  }

  // ── Persistence ──

  async init(storage: Storage): Promise<void> {
    this.storage = storage;
    try {
      const saved = await storage.loadStats();
      for (const [key, value] of Object.entries(saved)) {
        this.counters.set(key, (this.counters.get(key) ?? 0) + value);
      }
      const history = await storage.loadDailyHistory();
      for (const [day, counters] of Object.entries(history)) {
        const dayMap = this.dailyHistory.get(day) ?? new Map();
        for (const [key, value] of Object.entries(counters)) {
          dayMap.set(key, (dayMap.get(key) ?? 0) + value);
        }
        this.dailyHistory.set(day, dayMap);
      }
      logger.info('Stats loaded from storage', { counters: Object.keys(saved).length, days: Object.keys(history).length });
    } catch (err) {
      logger.warn('Failed to load persisted stats', { error: String(err) });
    }
    this.flushTimer = setInterval(() => { void this.flush(); }, FLUSH_INTERVAL_MS);
  }

  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  private async flush(): Promise<void> {
    if (!this.storage) return;
    try {
      const allCounters: Record<string, number> = {};
      for (const [key, value] of this.counters) {
        allCounters[key] = value;
      }
      // Include tunnel and mailbox counters
      for (const [key, value] of this.tunnelCounters) {
        allCounters[`tunnel:${key}`] = value;
      }
      for (const [key, value] of this.mailboxCounters) {
        allCounters[`mailbox:${key}`] = value;
      }
      // Include method and status counters
      for (const [key, value] of this.methods) {
        allCounters[`method:${key}`] = value;
      }
      for (const [key, value] of this.statuses) {
        allCounters[`status:${key}`] = value;
      }

      const history: Record<string, Record<string, number>> = {};
      for (const [day, counters] of this.dailyHistory) {
        history[day] = Object.fromEntries(counters);
      }

      await Promise.all([
        this.storage.flushStats(allCounters),
        this.storage.flushDailyHistory(history),
      ]);
    } catch (err) {
      logger.warn('Stats flush failed', { error: String(err) });
    }
  }
}

let _instance: StatsCollector | null = null;
export function getStats(): StatsCollector | null { return _instance; }
export async function initStats(storage?: Storage): Promise<StatsCollector> {
  _instance = new StatsCollector();
  if (storage) await _instance.init(storage);
  return _instance;
}
```

Note: `initStats` is now `async` and optionally accepts `Storage`.

- [ ] **Step 4: Update routes-loader.ts to pass storage and await initStats**

In `aimeat/src/server-bootstrap/routes-loader.ts`, the `mountRoutes` function currently calls `const stats = initStats();` synchronously. Change it:

Find the line:
```typescript
const stats = initStats();
```
Replace with:
```typescript
const stats = await initStats(storage);
```

The `mountRoutes` function is already `async` (it returns `Promise`), so this is safe. Check the signature -- if it's not already async, make it async.

- [ ] **Step 5: Add graceful shutdown handler in index.ts**

In `aimeat/src/index.ts`, inside the `else if (subcommand === 'start' || subcommand === 'serve')` block, after the `server.listen(...)` call and after the WebSocket setup block, add:

```typescript
// Graceful shutdown -- flush stats before exit
const { getStats: getStatsInstance } = await import('./services/stats.js');
const handleShutdown = async (signal: string) => {
  logger.info(`Received ${signal}, shutting down...`);
  const statsInstance = getStatsInstance();
  if (statsInstance) await statsInstance.shutdown();
  if (tunnelManager) await tunnelManager.shutdown();
  if (realtimeManager) await realtimeManager.shutdown();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
};
process.on('SIGTERM', () => void handleShutdown('SIGTERM'));
process.on('SIGINT', () => void handleShutdown('SIGINT'));
```

- [ ] **Step 6: Run tests**

Run: `cd aimeat && npx vitest run test/unit/stats.test.ts 2>&1 | tail -30`

Expected: All tests pass including new typed counter tests.

- [ ] **Step 7: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | head -10`

Expected: Clean.

- [ ] **Step 8: Commit**

```bash
git add src/services/stats.ts src/server-bootstrap/routes-loader.ts src/index.ts test/unit/stats.test.ts
git commit -m "feat: add typed counters, persistence, and graceful shutdown to StatsCollector"
```

---

## Task 5: Instrument Email, Push, and Mailbox Services

**Files:**
- Modify: `src/services/email.ts`
- Modify: `src/services/push.ts`
- Modify: `src/services/mailbox-notification.ts`

- [ ] **Step 1: Instrument EmailService**

In `aimeat/src/services/email.ts`:

Add import at the top:
```typescript
import { getStats } from './stats.js';
```

The `send()` function (line ~90) needs a `type` parameter. Refactor the internal `send` function to accept a type:

```typescript
async function send(to: string, subject: string, html: string, text: string, type: string): Promise<boolean> {
  try {
    await withRetry(
      () => transporter.sendMail({ from, to, subject, html, text }),
      subject,
      type,
    );
    logger.info(`Email sent successfully: ${subject}`);
    getStats()?.incrementTyped('email_sent', type);
    return true;
  } catch (err) {
    logger.error(`Email send failed after retries: ${subject}`, { error: (err as Error).message });
    getStats()?.incrementTyped('email_failed', type);
    return false;
  }
}
```

Update `withRetry` to also increment retries:

```typescript
async function withRetry<T>(fn: () => Promise<T>, label: string, emailType?: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < RETRY_DELAYS.length) {
        const delay = RETRY_DELAYS[attempt];
        logger.warn(`Email send failed (${label}), retry ${attempt + 1}/${RETRY_DELAYS.length} in ${delay}ms`);
        if (emailType) getStats()?.incrementTyped('email_retried', emailType);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}
```

Update each method call to pass the type:
- `sendVerificationCode`: `return send(to, subject, html, text, 'verification');`
- `sendMagicLink`: `return send(to, subject, html, text, 'magic_link');`
- `sendNotification`: `return send(to, subject, html, text, 'notification');`
- `sendMatchSuggestion`: `return send(to, subject, html, text, 'match_suggestion');`
- `sendRaw`: `return send(to, subject, rawHtml, rawText, 'group_send');`

- [ ] **Step 2: Instrument PushService**

In `aimeat/src/services/push.ts`:

Add import at the top:
```typescript
import { getStats } from './stats.js';
```

In the `sendNotification` method (line ~62), after the successful `sendNotification` call:
```typescript
// After: await storage.createPushSubscription({ ...sub, lastUsedAt: ... });
getStats()?.incrementTyped('push_sent', 'general');
return true;
```

In the catch block:
```typescript
} catch (err: unknown) {
  const statusCode = (err as { statusCode?: number }).statusCode;
  if (statusCode === 404 || statusCode === 410) {
    await storage.deletePushSubscription(ownerName);
    logger.info('Push subscription expired, removed', { ownerName });
    getStats()?.increment('push_expired_subs');
  } else {
    logger.warn('Push notification failed', { ownerName, error: String(err) });
  }
  getStats()?.incrementTyped('push_failed', 'general');
  return false;
}
```

Note: PushService currently doesn't know the "type" of notification being sent (the payload is opaque). We use `'general'` as the type. The caller-side can be instrumented later if finer granularity is needed by passing type info through the payload.

- [ ] **Step 3: Instrument MailboxNotificationService**

In `aimeat/src/services/mailbox-notification.ts`:

Add import at the top:
```typescript
import { getStats } from './stats.js';
```

In the `notify` method, add counter increments at each decision point:

After `if (!prefs.enabled)`:
```typescript
if (!prefs.enabled) {
  getStats()?.incrementTyped('mailbox_notif_blocked', 'disabled');
  return { sent: false, reason: 'notifications_disabled' };
}
```

After cooldown check:
```typescript
if (now - lastNotified < cooldownMs) {
  getStats()?.incrementTyped('mailbox_notif_blocked', 'cooldown');
  return { sent: false, reason: 'cooldown_active' };
}
```

After quiet hours check:
```typescript
if (this.isInQuietHours(prefs)) {
  getStats()?.incrementTyped('mailbox_notif_blocked', 'quiet_hours');
  return { sent: false, reason: 'quiet_hours' };
}
```

In the web push success path (after `if (ok)`):
```typescript
if (ok) { sentAny = true; sentChannels.push('web_push'); getStats()?.incrementTyped('mailbox_notif_sent', 'push'); }
```

For web push failures -- in `sendWebPush`, add at the end of the catch block (before `return false`):
```typescript
getStats()?.incrementTyped('mailbox_notif_failed', 'push');
return false;
```

In the email success path:
```typescript
if (emailSent) { sentAny = true; sentChannels.push('email'); getStats()?.incrementTyped('mailbox_notif_sent', 'email'); }
```

In `sendEmail`, catch block (before `return false`):
```typescript
getStats()?.incrementTyped('mailbox_notif_failed', 'email');
return false;
```

Also handle `type_not_configured` -- this is a different kind of block but not really abuse-relevant. We can skip it to avoid noise, or add if desired. Skip for now.

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | head -10`

Expected: Clean.

- [ ] **Step 5: Commit**

```bash
git add src/services/email.ts src/services/push.ts src/services/mailbox-notification.ts
git commit -m "feat: instrument email, push, and mailbox services with stats counters"
```

---

## Task 6: Stats Route -- Time Range Support

**Files:**
- Modify: `src/routes/stats.ts`

- [ ] **Step 1: Update stats route to support from/to query params**

Replace the `GET /v1/stats` handler in `aimeat/src/routes/stats.ts`:

```typescript
router.get('/v1/stats', async (req, res) => {
  if (!config.statsEnabled) {
    res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Statistics are disabled'));
    return;
  }

  if (config.statsAccess === 'operator') {
    if (!req.auth?.roles?.includes('operator')) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Operator role required'));
      return;
    }
  } else if (config.statsAccess === 'authenticated') {
    if (!req.auth) {
      res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Authentication required'));
      return;
    }
  }

  const fromParam = req.query.from as string | undefined;
  const toParam = req.query.to as string | undefined;

  const owners = await storage.listOwners();
  const agents = await storage.listAgents();

  // Consent permission breakdown
  const permStats = { active_rules: 0, by_gaii: 0, by_ghii: 0, by_organism: 0, by_domain: 0, by_node: 0, by_wildcard: 0, unique_patterns: new Set<string>() };
  for (const o of owners) {
    const gaii = (o as { gaii?: string }).gaii || `${(o as { name?: string }).name || ''}@${config.nodeId}`;
    try {
      const consents = await storage.listConsents(gaii, { status: 'active' });
      for (const c of consents) {
        permStats.active_rules++;
        const r = c.recipient || '';
        if (r === '*') permStats.by_wildcard++;
        else if (r.startsWith('ghii:')) permStats.by_ghii++;
        else if (r.startsWith('organism.')) permStats.by_organism++;
        else if (r.startsWith('domain:')) permStats.by_domain++;
        else if (r.startsWith('node:')) permStats.by_node++;
        else permStats.by_gaii++;
        permStats.unique_patterns.add(c.dataPattern);
      }
    } catch { /* skip */ }
  }

  const consentPermissions = {
    active_rules: permStats.active_rules,
    by_gaii: permStats.by_gaii,
    by_ghii: permStats.by_ghii,
    by_organism: permStats.by_organism,
    by_domain: permStats.by_domain,
    by_node: permStats.by_node,
    by_wildcard: permStats.by_wildcard,
    unique_patterns: permStats.unique_patterns.size,
  };

  // Gauges are always current regardless of time range
  const snap = stats.snapshot();
  const gauges = {
    tunnel_connections_active: snap.tunnel.connections_active,
    mailbox_items_total: snap.mailbox.items_total,
    mailbox_bytes_total: snap.mailbox.bytes_total,
    mailbox_oldest_item_age_seconds: snap.mailbox.oldest_item_age_seconds,
  };

  if (fromParam && toParam) {
    const rangeData = stats.snapshotForRange(fromParam, toParam);
    res.json(success(config.nodeId, {
      node_id: config.nodeId,
      ...rangeData.totals,
      daily: rangeData.daily,
      gauges,
      active_owners: owners.length,
      active_agents: agents.length,
      push_notifications: {
        enabled: config.pushEnabled && !!config.vapidPublicKey,
        personal_node_support: config.personalNodesEnabled,
      },
      consent_permissions: consentPermissions,
    }));
  } else {
    res.json(success(config.nodeId, {
      node_id: config.nodeId,
      ...snap,
      gauges,
      active_owners: owners.length,
      active_agents: agents.length,
      push_notifications: {
        enabled: config.pushEnabled && !!config.vapidPublicKey,
        personal_node_support: config.personalNodesEnabled,
      },
      consent_permissions: consentPermissions,
    }));
  }
});
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | head -10`

Expected: Clean.

- [ ] **Step 3: Commit**

```bash
git add src/routes/stats.ts
git commit -m "feat: add time range support (from/to) to GET /v1/stats"
```

---

## Task 7: i18n Translation Keys

**Files:**
- Modify: `locales/en.json`
- Modify: `locales/fi.json`

- [ ] **Step 1: Add English translation keys**

In `aimeat/locales/en.json`, find the dashboard section and add these keys (keeping alphabetical order within the section):

```json
"dashboard.emailDelivery": "Email Delivery",
"dashboard.emailsSent": "Emails Sent",
"dashboard.emailsFailed": "Emails Failed",
"dashboard.emailsRetried": "Emails Retried",
"dashboard.successRate": "Success Rate",
"dashboard.emailType.verification": "Verification",
"dashboard.emailType.magic_link": "Magic Link",
"dashboard.emailType.notification": "Notification",
"dashboard.emailType.match_suggestion": "Match Suggestion",
"dashboard.emailType.group_send": "Group Send",
"dashboard.pushDelivery": "Push Notifications",
"dashboard.pushSent": "Push Sent",
"dashboard.pushFailed": "Push Failed",
"dashboard.expiredSubs": "Expired Subs",
"dashboard.pushType.general": "General",
"dashboard.pushType.test": "Test",
"dashboard.pushType.work": "Work",
"dashboard.pushType.board": "Board",
"dashboard.pushType.federation": "Federation",
"dashboard.pushType.organism": "Organism",
"dashboard.mailboxNotifications": "Mailbox Notifications",
"dashboard.mailboxNotifSent": "Mailbox Sent",
"dashboard.mailboxNotifFailed": "Mailbox Failed",
"dashboard.mailboxNotifBlocked": "Mailbox Blocked",
"dashboard.blockedCooldown": "Cooldown",
"dashboard.blockedQuietHours": "Quiet Hours",
"dashboard.blockedDisabled": "Disabled",
"dashboard.channelPush": "Push",
"dashboard.channelEmail": "Email",
"dashboard.periodToday": "Today",
"dashboard.periodThisWeek": "This Week",
"dashboard.period7Days": "7 Days",
"dashboard.period30Days": "30 Days",
"dashboard.periodAll": "All",
"dashboard.periodCustom": "Custom",
"dashboard.periodApply": "Apply",
"dashboard.periodFrom": "From",
"dashboard.periodTo": "To",
"dashboard.live": "live",
"dashboard.breakdownType": "Type",
"dashboard.breakdownSent": "Sent",
"dashboard.breakdownFailed": "Failed",
"dashboard.breakdownRetried": "Retried",
"dashboard.channels": "Channels",
"dashboard.blocked": "Blocked",
```

- [ ] **Step 2: Add Finnish translation keys**

In `aimeat/locales/fi.json`, add the corresponding Finnish translations:

```json
"dashboard.emailDelivery": "Sahkopostin toimitus",
"dashboard.emailsSent": "Lahetetyt",
"dashboard.emailsFailed": "Epaonnistuneet",
"dashboard.emailsRetried": "Uudelleenyritykset",
"dashboard.successRate": "Onnistumisprosentti",
"dashboard.emailType.verification": "Vahvistus",
"dashboard.emailType.magic_link": "Kirjautumislinkki",
"dashboard.emailType.notification": "Ilmoitus",
"dashboard.emailType.match_suggestion": "Ehdotus",
"dashboard.emailType.group_send": "Ryhmalahetus",
"dashboard.pushDelivery": "Push-ilmoitukset",
"dashboard.pushSent": "Lahetetyt",
"dashboard.pushFailed": "Epaonnistuneet",
"dashboard.expiredSubs": "Vanhentuneet",
"dashboard.pushType.general": "Yleinen",
"dashboard.pushType.test": "Testi",
"dashboard.pushType.work": "Tyo",
"dashboard.pushType.board": "Keskustelu",
"dashboard.pushType.federation": "Federaatio",
"dashboard.pushType.organism": "Organismi",
"dashboard.mailboxNotifications": "Postilaatikkoilmoitukset",
"dashboard.mailboxNotifSent": "Lahetetyt",
"dashboard.mailboxNotifFailed": "Epaonnistuneet",
"dashboard.mailboxNotifBlocked": "Estetyt",
"dashboard.blockedCooldown": "Jaahdytys",
"dashboard.blockedQuietHours": "Hiljaiset tunnit",
"dashboard.blockedDisabled": "Poissa kaytosta",
"dashboard.channelPush": "Push",
"dashboard.channelEmail": "Sahkoposti",
"dashboard.periodToday": "Tanaan",
"dashboard.periodThisWeek": "Tama viikko",
"dashboard.period7Days": "7 paivaa",
"dashboard.period30Days": "30 paivaa",
"dashboard.periodAll": "Kaikki",
"dashboard.periodCustom": "Mukautettu",
"dashboard.periodApply": "Hae",
"dashboard.periodFrom": "Alkaen",
"dashboard.periodTo": "Asti",
"dashboard.live": "live",
"dashboard.breakdownType": "Tyyppi",
"dashboard.breakdownSent": "Lahetetyt",
"dashboard.breakdownFailed": "Epaonnistuneet",
"dashboard.breakdownRetried": "Uudelleenyritykset",
"dashboard.channels": "Kanavat",
"dashboard.blocked": "Estetyt",
```

Note: Use ASCII-safe Finnish (no diacritics in key values -- the frontend renders them via i18n). Actually, Finnish translations need proper characters. Use the actual Finnish with proper characters: "Sahkoposti" should be "Sahkoposti" etc. The implementer should use the correct Finnish characters (a with umlaut etc.) when writing the actual code.

- [ ] **Step 3: Commit**

```bash
git add locales/en.json locales/fi.json
git commit -m "feat: add i18n keys for notification stats (en + fi)"
```

---

## Task 8: Frontend API -- Pass Time Range to Stats

**Files:**
- Modify: `public/js/services/admin.js`

- [ ] **Step 1: Update getStats to accept from/to params**

In `aimeat/public/js/services/admin.js`, find:

```javascript
export const getStats        = ()       => apiGet('/v1/stats');
```

Replace with:

```javascript
export const getStats = (from, to) => {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();
  return apiGet('/v1/stats' + (qs ? '?' + qs : ''));
};
```

- [ ] **Step 2: Update admin.js loadData to pass time range**

In `aimeat/public/views/admin.js`, the `loadData` function currently calls:
```javascript
try { const sr = await api.getStats(); if (sr.data) d.stats = sr.data; } catch { d.stats = null; }
```

This will be updated in Task 9 when we add the time range state to the Stats tab. For now, this call remains backward compatible (no params = lifetime totals).

- [ ] **Step 3: Commit**

```bash
git add public/js/services/admin.js
git commit -m "feat: add from/to params to frontend getStats API call"
```

---

## Task 9: Stats Tab UI -- Time Range Selector + Notification Sections

**Files:**
- Modify: `public/views/admin/stats-tab.js`
- Modify: `public/views/admin.js`
- Modify: `public/css/views/admin.css`

This is the largest UI task. The Stats tab needs:
1. Time range selector at the top
2. Email Delivery section with stat cards, breakdown table, per-day chart
3. Push Notification section with stat cards, breakdown table, per-day chart
4. Mailbox Notification section with stat cards and inline breakdowns
5. Existing sections updated to use time-range-filtered data

- [ ] **Step 1: Add CSS for time range selector and breakdown tables**

In `aimeat/public/css/views/admin.css`, add:

```css
/* ── Stats Time Range Selector ── */
.adm-time-range {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 20px;
  padding: 12px 16px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.adm-time-range-label {
  font-size: 0.8rem;
  color: var(--text-dim);
  margin-right: 4px;
}
.adm-time-btn {
  padding: 4px 12px;
  font-size: 0.75rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  transition: all 0.15s;
}
.adm-time-btn:hover { border-color: var(--accent); color: var(--accent); }
.adm-time-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }
.adm-time-custom {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}
.adm-time-custom input[type="date"] {
  padding: 3px 8px;
  font-size: 0.75rem;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface);
  color: var(--text);
}

/* ── Stats Breakdown Table ── */
.adm-breakdown-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.78rem;
  margin-top: 8px;
}
.adm-breakdown-table th {
  text-align: left;
  padding: 6px 10px;
  color: var(--text-dim);
  border-bottom: 1px solid var(--border);
  font-weight: 500;
}
.adm-breakdown-table td {
  padding: 5px 10px;
  border-bottom: 1px solid var(--border-dim, rgba(255,255,255,0.05));
}
.adm-breakdown-table td.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* ── Live badge ── */
.adm-badge-live {
  display: inline-block;
  font-size: 0.6rem;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--accent);
  color: #fff;
  vertical-align: middle;
  margin-left: 6px;
}
```

- [ ] **Step 2: Rewrite stats-tab.js with time range selector and notification sections**

This is a full rewrite of `aimeat/public/views/admin/stats-tab.js`. The key changes:
- Add `useState` for time range (`period` state: `'7d'` default, plus `customFrom`/`customTo`)
- Add a `useEffect` that re-fetches stats when period changes (calls `api.getStats(from, to)`)
- Add Email Delivery section after Mailbox Stats
- Add Push Notification section after Email Delivery
- Add Mailbox Notifications section after Push
- Add per-day bar charts for email and push
- Existing charts use the time-range-filtered `daily` data

The complete implementation should follow the existing patterns in the file (using `html` tagged templates, `StatCard` from shared.js, Chart.js for charts). The Stats tab now manages its own data fetching for time ranges rather than relying solely on the parent's `data.stats`.

Key structure:
```javascript
import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, fmtUp, fmtBytes, StatsGrid, StatCard, EconRow } from './shared.js';
import * as api from '/js/services/admin.js';

function getDateRange(period) {
  const today = new Date();
  const fmt = d => d.toISOString().split('T')[0];
  const to = fmt(today);
  switch (period) {
    case 'today': return { from: to, to };
    case 'week': {
      const mon = new Date(today);
      mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
      return { from: fmt(mon), to };
    }
    case '7d': {
      const d = new Date(today);
      d.setDate(d.getDate() - 6);
      return { from: fmt(d), to };
    }
    case '30d': {
      const d = new Date(today);
      d.setDate(d.getDate() - 29);
      return { from: fmt(d), to };
    }
    default: return null; // 'all'
  }
}

function successRate(sent, failed) {
  if (!sent && !failed) return null;
  return ((sent / (sent + failed)) * 100).toFixed(1);
}

function rateColor(rate) {
  if (rate === null) return 'var(--text-dim)';
  const n = parseFloat(rate);
  if (n >= 95) return '#22c55e';
  if (n >= 80) return '#eab308';
  return '#ef4444';
}

// ... BreakdownTable component, EmailSection, PushSection, MailboxNotifSection ...

export default function StatsTab({ data }) {
  const [period, setPeriod] = useState('7d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [sd, setSd] = useState(data.stats);
  const [loading, setLoading] = useState(false);
  const chartRef = useRef(false);

  const fetchStats = useCallback(async (p, cf, ct) => {
    setLoading(true);
    try {
      const range = p === 'custom' ? { from: cf, to: ct } : getDateRange(p);
      const resp = await api.getStats(range?.from, range?.to);
      if (resp.data) setSd(resp.data);
    } catch { /* keep existing data */ }
    setLoading(false);
  }, []);

  useEffect(() => { if (period !== 'custom') fetchStats(period); }, [period]);

  // ... render time range selector, existing sections, new notification sections, charts
}
```

The implementer should write the full component following the existing conventions in the file. Use `StatCard` for stat cards (4-column grid), `adm-breakdown-table` class for tables, Chart.js for per-day bar charts (same pattern as existing `renderCharts`). Charts should be re-rendered when `sd` changes (destroy old chart instances before creating new ones).

- [ ] **Step 3: Update admin.js to pass initial stats to StatsTab**

In `aimeat/public/views/admin.js`, the existing stats load:
```javascript
try { const sr = await api.getStats(); if (sr.data) d.stats = sr.data; } catch { d.stats = null; }
```

Keep this as-is -- it provides the initial data. The Stats tab will re-fetch with time range when the user selects a period.

- [ ] **Step 4: Run typecheck (for any JS import errors)**

Run: `pnpm lint 2>&1 | head -20`

Expected: No errors in modified files.

- [ ] **Step 5: Test in browser**

Start dev server: `pnpm dev`

1. Open admin dashboard, go to Stats tab
2. Verify time range selector shows at top with "7 Days" active
3. Verify Email Delivery section shows with stat cards (values will be 0 initially)
4. Verify Push Notification section shows with stat cards
5. Verify Mailbox Notifications section shows with stat cards
6. Click "Today", "30 Days", "All" and verify data re-fetches
7. Trigger a test email from the Email tab, return to Stats tab, verify email_sent counter increments

- [ ] **Step 6: Commit**

```bash
git add public/views/admin/stats-tab.js public/views/admin.js public/css/views/admin.css
git commit -m "feat: add time range selector and notification stats sections to Stats tab"
```

---

## Task 10: E2E Tests

**Files:**
- Modify: existing E2E test or create new test file

- [ ] **Step 1: Add stats persistence and time range E2E test**

Add a test to the E2E suite that:
1. Calls `GET /v1/stats` and verifies the response includes notification counter fields (even if 0)
2. Calls `GET /v1/stats?from=2026-05-01&to=2026-05-31` and verifies the response includes `daily` and `totals` keys
3. Verifies `gauges` key exists in the response

The exact file depends on how the test suite is organized. Check if there's an existing stats test in the E2E suite. If not, add assertions to the appropriate phase of `test/api-full.ts` or create `test/stats-persistence.ts`.

- [ ] **Step 2: Run E2E tests on both backends**

Run: `pnpm test:e2e:sqlite 2>&1 | tail -20`
Run: `pnpm test:e2e:mongodb 2>&1 | tail -20`

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add test/
git commit -m "test: add E2E tests for stats persistence and time range filtering"
```

---

## Task 11: Final Verification

- [ ] **Step 1: Run typecheck**

Run: `npx tsc --noEmit`

Expected: Clean.

- [ ] **Step 2: Run lint**

Run: `pnpm lint`

Expected: Clean.

- [ ] **Step 3: Run unit tests**

Run: `cd aimeat && npx vitest run test/unit/stats.test.ts`

Expected: All pass.

- [ ] **Step 4: Run E2E tests on both backends**

Run: `pnpm test:e2e:mongodb`
Run: `pnpm test:e2e:sqlite`

Expected: 0 failures on both.

- [ ] **Step 5: Run Playwright tests if frontend changed**

Run: `pnpm test:playwright:mongodb`

Expected: All pass.

- [ ] **Step 6: Update file headers**

Add/update `@version-history` entries in all modified source files per CLAUDE.md Rule 2.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "chore: update file headers and final cleanup for notification stats feature"
```
