/**
 * @file stats.ts
 * @description StatsCollector service -- tracks request counters, tunnel/mailbox stats,
 *   typed counters (name:type grouping), daily history, and optional persistence via Storage.
 * @structure
 *   - StatsCollector class (singleton via initStats/getStats)
 *   - TunnelStats, MailboxStats, StatsSnapshot interfaces
 *   - incrementTyped() for typed counter families
 *   - Persistence: init(storage), flush(), shutdown()
 * @version-history
 *   v1.0.0 -- 2026-05-01 -- Initial stats collector
 *   v1.1.0 -- 2026-05-21 -- Add typed counters, persistence, graceful shutdown, snapshotForRange
 *   v1.1.1 -- 2026-05-21 -- Reduce flush interval from 60s to 15s to minimize data loss on force-kill
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
  /** Index signature for dynamic typed counter fields (e.g. email_sent, email_sent_by_type) */
  [key: string]: unknown;
}

export type CounterName =
  | 'requests_total'
  | 'memory_writes'
  | 'memory_reads'
  | 'consent_grants'
  | 'consent_revocations'
  | 'schema_validations'
  | 'schema_validation_failures'
  | 'auth_failures_total'
  | 'rate_limit_hits_total'
  | 'scope_denials_total';

/** Tunnel counter fields (excludes gauges and computed latency fields). */
export type TunnelCounterName =
  | 'connections_total'
  | 'disconnections_total'
  | 'reconnects_total'
  | 'messages_sent_total'
  | 'messages_received_total'
  | 'delivery_failures_total'
  | 'heartbeat_misses_total'
  | 'mailbox_fallbacks_total';

/** Mailbox counter fields (excludes gauges). */
export type MailboxCounterName =
  | 'enqueued_total'
  | 'delivered_total'
  | 'expired_total'
  | 'quota_rejections_total';

/** Mailbox gauge fields. */
export type MailboxGaugeName =
  | 'items_total'
  | 'bytes_total'
  | 'oldest_item_age_seconds';

const LATENCY_WINDOW_SIZE = 1000;
const FLUSH_INTERVAL_MS = 15_000;

export class StatsCollector {
  private counters = new Map<string, number>();
  private methods = new Map<string, number>();
  private statuses = new Map<string, number>();
  private dailyHistory = new Map<string, Map<string, number>>();
  private startedAt = new Date().toISOString();

  // Tunnel state
  private tunnelCounters = new Map<string, number>();
  private tunnelGauges = new Map<string, number>();

  // Mailbox state
  private mailboxCounters = new Map<string, number>();
  private mailboxGauges = new Map<string, number>();

  // Delivery latency rolling window
  private latencySamples: number[] = [];

  // Persistence
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
   * Scan all counter keys containing ':' and group them into typed families.
   * For key "email_sent:verification" with value 2 and "email_sent:magic_link" with value 1:
   *   - email_sent = 3 (total)
   *   - email_sent_by_type = { verification: 2, magic_link: 1 }
   */
  private buildTypedGroups(sourceCounters?: Map<string, number>): Record<string, unknown> {
    const counters = sourceCounters ?? this.counters;
    const groups = new Map<string, Map<string, number>>();

    for (const [key, value] of counters) {
      const colonIdx = key.indexOf(':');
      if (colonIdx === -1) continue;
      const base = key.substring(0, colonIdx);
      const type = key.substring(colonIdx + 1);
      if (!groups.has(base)) groups.set(base, new Map());
      groups.get(base)!.set(type, (groups.get(base)!.get(type) ?? 0) + value);
    }

    const result: Record<string, unknown> = {};
    for (const [base, types] of groups) {
      let total = 0;
      const byType: Record<string, number> = {};
      for (const [type, count] of types) {
        total += count;
        byType[type] = count;
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
   * Sum counters for days within [from, to] range (inclusive, ISO date strings).
   * Returns totals (with typed grouping) and per-day breakdown.
   */
  snapshotForRange(from: string, to: string): { totals: Record<string, unknown>; daily: Record<string, Record<string, number>> } {
    const summed = new Map<string, number>();
    const daily: Record<string, Record<string, number>> = {};

    for (const [day, counters] of this.dailyHistory) {
      if (day < from || day > to) continue;
      daily[day] = Object.fromEntries(counters);
      for (const [key, value] of counters) {
        summed.set(key, (summed.get(key) ?? 0) + value);
      }
    }

    // Build totals with typed grouping
    const totals: Record<string, unknown> = {};
    for (const [key, value] of summed) {
      if (!key.includes(':')) totals[key] = value;
    }
    // Merge typed groups from the summed counters
    Object.assign(totals, this.buildTypedGroups(summed));

    return { totals, daily };
  }

  // ── Persistence ──

  /** Initialize persistence: load saved counters from storage and start flush timer. */
  async init(storage: Storage): Promise<void> {
    this.storage = storage;

    try {
      const saved = await storage.loadStats();
      for (const [key, value] of Object.entries(saved)) {
        if (key.startsWith('tunnel:')) {
          const tunnelKey = key.substring(7);
          this.tunnelCounters.set(tunnelKey, (this.tunnelCounters.get(tunnelKey) ?? 0) + value);
        } else if (key.startsWith('mailbox:')) {
          const mailboxKey = key.substring(8);
          this.mailboxCounters.set(mailboxKey, (this.mailboxCounters.get(mailboxKey) ?? 0) + value);
        } else if (key.startsWith('method:')) {
          const methodKey = key.substring(7);
          this.methods.set(methodKey, (this.methods.get(methodKey) ?? 0) + value);
        } else if (key.startsWith('status:')) {
          const statusKey = key.substring(7);
          this.statuses.set(statusKey, (this.statuses.get(statusKey) ?? 0) + value);
        } else {
          this.counters.set(key, (this.counters.get(key) ?? 0) + value);
        }
      }

      const savedHistory = await storage.loadDailyHistory();
      for (const [day, counters] of Object.entries(savedHistory)) {
        if (!this.dailyHistory.has(day)) this.dailyHistory.set(day, new Map());
        const dayMap = this.dailyHistory.get(day)!;
        for (const [key, value] of Object.entries(counters)) {
          dayMap.set(key, (dayMap.get(key) ?? 0) + value);
        }
      }

      logger.info('Stats loaded from storage', {
        counters: Object.keys(saved).length,
        historyDays: Object.keys(savedHistory).length,
      });
    } catch (err) {
      logger.warn('Failed to load persisted stats, starting fresh', { error: String(err) });
    }

    this.flushTimer = setInterval(() => {
      void this.flush();
    }, FLUSH_INTERVAL_MS);
  }

  /** Stop the flush timer and do one final flush. */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  /** Persist all counters and daily history to storage. */
  private async flush(): Promise<void> {
    if (!this.storage) return;

    try {
      // Collect all counters into one flat record with prefixed keys
      const allCounters: Record<string, number> = {};

      for (const [key, value] of this.counters) {
        allCounters[key] = value;
      }
      for (const [key, value] of this.tunnelCounters) {
        allCounters[`tunnel:${key}`] = value;
      }
      for (const [key, value] of this.mailboxCounters) {
        allCounters[`mailbox:${key}`] = value;
      }
      for (const [key, value] of this.methods) {
        allCounters[`method:${key}`] = value;
      }
      for (const [key, value] of this.statuses) {
        allCounters[`status:${key}`] = value;
      }

      await this.storage.flushStats(allCounters);

      // Flush daily history
      const history: Record<string, Record<string, number>> = {};
      for (const [day, counters] of this.dailyHistory) {
        history[day] = Object.fromEntries(counters);
      }
      await this.storage.flushDailyHistory(history);
    } catch (err) {
      logger.warn('Stats flush failed', { error: String(err) });
    }
  }
}

// Singleton pattern for use in services that can't accept constructor params
let _instance: StatsCollector | null = null;
export function getStats(): StatsCollector | null { return _instance; }
export async function initStats(storage?: Storage): Promise<StatsCollector> {
  _instance = new StatsCollector();
  if (storage) {
    await _instance.init(storage);
  }
  return _instance;
}
