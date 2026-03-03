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
}

const TRACKED_COUNTERS = [
  'requests_total', 'memory_writes', 'memory_reads',
  'consent_grants', 'consent_revocations',
  'schema_validations', 'schema_validation_failures',
] as const;

export type CounterName = (typeof TRACKED_COUNTERS)[number];

export class StatsCollector {
  private counters = new Map<string, number>();
  private methods = new Map<string, number>();
  private statuses = new Map<string, number>();
  private dailyHistory = new Map<string, Map<string, number>>();
  private startedAt = new Date().toISOString();

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

  snapshot(): StatsSnapshot {
    const daily: Record<string, Record<string, number>> = {};
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    for (const [day, counters] of this.dailyHistory) {
      if (day < cutoffStr) { this.dailyHistory.delete(day); continue; }
      daily[day] = Object.fromEntries(counters);
    }

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
    };
  }
}

// Singleton pattern for use in services that can't accept constructor params
let _instance: StatsCollector | null = null;
export function getStats(): StatsCollector | null { return _instance; }
export function initStats(): StatsCollector { _instance = new StatsCollector(); return _instance; }
