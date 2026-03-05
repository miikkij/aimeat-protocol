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
}

const TRACKED_COUNTERS = [
  'requests_total', 'memory_writes', 'memory_reads',
  'consent_grants', 'consent_revocations',
  'schema_validations', 'schema_validation_failures',
  'auth_failures_total', 'rate_limit_hits_total', 'scope_denials_total',
] as const;

export type CounterName = (typeof TRACKED_COUNTERS)[number];

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

  increment(name: CounterName): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + 1);
    const day = new Date().toISOString().split('T')[0];
    if (!this.dailyHistory.has(day)) this.dailyHistory.set(day, new Map());
    const dayMap = this.dailyHistory.get(day)!;
    dayMap.set(name, (dayMap.get(name) ?? 0) + 1);
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
    };
  }
}

// Singleton pattern for use in services that can't accept constructor params
let _instance: StatsCollector | null = null;
export function getStats(): StatsCollector | null { return _instance; }
export function initStats(): StatsCollector { _instance = new StatsCollector(); return _instance; }
