/**
 * @file src/storage/providers/sqlite/repos/usage.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite implementation of usage telemetry's three layers: the hot call stream, the
 *   archive sweep, and the discriminated serving rollup with its transactional fold.
 *   Design: docs/internal/telemetria/02-design.md
 *
 *   SYNCHRONOUS BY NATURE. better-sqlite3 is sync, so these are plain functions; the storage class
 *   wraps them in the async Storage surface. The fold's atomicity therefore comes from
 *   db.transaction(), which better-sqlite3 runs synchronously — no await can slip between the
 *   deltas and the watermark, which is stronger than the Postgres side needs to be explicit about.
 * @structure
 *   - appendUsageCall / listUsageCalls / listUsageCallsForFold / listUsageEventsForFold
 *   - archiveUsageRows
 *   - getUsageCursor / setUsageCursor / advanceUsageRollup
 *   - queryUsageRollup / clearUsageRollupRange
 * @version-history
 *   v1.0.0 — 2026-08-14 — Initial: three-layer usage telemetry substrate.
 */
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { logger } from '../../../../utils/logger.js';
import type {
  AgentUsageEvent,
  UsageCallRecord,
  UsageCallFilter,
  UsageRollupRow,
  UsageRollupDelta,
  UsageRollupFilter,
  UsageRollupCursor,
  UsageArchiveResult,
  UsageFoldCursor,
  UsageSurface,
  UsageActorKind,
  UsageOutcome,
} from '../../../interface.js';

type Row = Record<string, unknown>;

function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string') { const n = Number(v); return Number.isFinite(n) ? n : 0; }
  return 0;
}

/** SQLite stores JSON as TEXT. A malformed blob is a lost detail, never a thrown read. */
function parseObj(v: unknown): Record<string, unknown> {
  if (typeof v !== 'string' || !v) return {};
  try {
    const p = JSON.parse(v) as unknown;
    return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
  } catch (err) {
    // A malformed meta/extra blob costs ONE row its detail; throwing would cost the whole report.
    // Logged rather than swallowed: the only way this happens is a writer putting something other
    // than JSON in the column, and that is a defect someone should see.
    logger.warn('usage: unparseable JSON column, returning empty', { error: String(err) });
    return {};
  }
}

function numObj(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(parseObj(v))) out[k] = num(val);
  return out;
}

function toCall(r: Row): UsageCallRecord {
  return {
    id: r.id as string,
    ts: r.ts as string,
    ownerGhii: r.ownerGhii as string,
    actorGaii: (r.actorGaii as string) ?? '',
    actorKind: ((r.actorKind as string) || 'owner') as UsageActorKind,
    surface: r.surface as UsageSurface,
    coordinate: (r.coordinate as string) ?? '',
    appId: (r.appId as string) ?? '',
    counterpartyGhii: (r.counterpartyGhii as string) ?? '',
    outcome: ((r.outcome as string) || 'ok') as UsageOutcome,
    reason: (r.reason as string) ?? '',
    durationMs: num(r.durationMs),
    chargedUnits: num(r.chargedUnits),
    unit: ((r.unit as string) ?? '') as UsageCallRecord['unit'],
    currency: (r.currency as string) ?? '',
    entitlementId: (r.entitlementId as string) ?? '',
    runId: (r.runId as string) ?? '',
    meta: parseObj(r.meta),
  };
}

function toRollup(r: Row): UsageRollupRow {
  return {
    id: r.id as string,
    cut: r.cut as string,
    grain: r.grain as 'hour' | 'day',
    bucket: r.bucket as string,
    ownerGhii: (r.ownerGhii as string) ?? '',
    actorGaii: (r.actorGaii as string) ?? '',
    appId: (r.appId as string) ?? '',
    model: (r.model as string) ?? '',
    provider: (r.provider as string) ?? '',
    surface: (r.surface as string) ?? '',
    outcome: (r.outcome as string) ?? '',
    coordinate: (r.coordinate as string) ?? '',
    counterpartyGhii: (r.counterpartyGhii as string) ?? '',
    calls: num(r.calls),
    errors: num(r.errors),
    refusals: num(r.refusals),
    tokensIn: num(r.tokensIn),
    tokensOut: num(r.tokensOut),
    costUsd: num(r.costUsd),
    unpricedCalls: num(r.unpricedCalls),
    chargedUnits: num(r.chargedUnits),
    durationMsSum: num(r.durationMsSum),
    durationMsMax: num(r.durationMsMax),
    actorsSeen: num(r.actorsSeen),
    extra: numObj(r.extra),
    updatedAt: r.updatedAt as string,
  };
}

function toEvent(r: Row): AgentUsageEvent {
  return {
    id: r.id as string,
    ts: r.ts as string,
    agentGaii: r.agentGaii as string,
    ownerGhii: r.ownerGhii as string,
    runId: (r.runId as string | null) ?? undefined,
    model: r.model as string,
    provider: r.provider as string,
    promptTokens: num(r.promptTokens),
    completionTokens: num(r.completionTokens),
    costUsd: r.costUsd == null ? null : num(r.costUsd),
    priceRef: (r.priceRef as string | null) ?? null,
    source: r.source as string,
    apiKeyScope: r.apiKeyScope as 'own' | 'node',
    organismId: (r.organismId as string | null) ?? undefined,
    workspaceId: (r.workspaceId as string | null) ?? undefined,
    capabilityId: (r.capabilityId as string | null) ?? undefined,
    consumerGhii: (r.consumerGhii as string | null) ?? undefined,
    provenanceId: (r.provenanceId as string | null) ?? undefined,
    appId: (r.appId as string) ?? '',
    surface: (r.surface as string) ?? '',
  } as AgentUsageEvent;
}

// ── Layer 1 ──

export function appendUsageCall(db: Database.Database, rows: UsageCallRecord[]): void {
  if (!rows.length) return;
  const stmt = db.prepare(
    `INSERT INTO usage_calls
       (id, ts, ownerGhii, actorGaii, actorKind, surface, coordinate, appId, counterpartyGhii,
        outcome, reason, durationMs, chargedUnits, unit, currency, entitlementId, runId, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertAll = db.transaction((batch: UsageCallRecord[]) => {
    for (const r of batch) {
      stmt.run(r.id, r.ts, r.ownerGhii, r.actorGaii, r.actorKind, r.surface, r.coordinate,
        r.appId, r.counterpartyGhii, r.outcome, r.reason, r.durationMs, r.chargedUnits,
        r.unit, r.currency, r.entitlementId, r.runId, JSON.stringify(r.meta));
    }
  });
  insertAll(rows);
}

export function listUsageCalls(db: Database.Database, filter: UsageCallFilter): UsageCallRecord[] {
  // NOT owner-scoped unless the filter says so: the route gates on the operator role.
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.ownerGhii) { clauses.push('ownerGhii = ?'); params.push(filter.ownerGhii); }
  if (filter.actorGaii) { clauses.push('actorGaii = ?'); params.push(filter.actorGaii); }
  if (filter.surface) { clauses.push('surface = ?'); params.push(filter.surface); }
  if (filter.appId) { clauses.push('appId = ?'); params.push(filter.appId); }
  if (filter.outcome) { clauses.push('outcome = ?'); params.push(filter.outcome); }
  if (filter.from) { clauses.push('ts >= ?'); params.push(filter.from); }
  if (filter.to) { clauses.push('ts <= ?'); params.push(filter.to); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 2000);
  const rows = db.prepare(`SELECT * FROM usage_calls ${where} ORDER BY ts DESC LIMIT ?`)
    .all(...params, limit) as Row[];
  return rows.map(toCall);
}

/** Strictly after (lastTs, lastId) in the stream's total order. */
export function listUsageCallsForFold(db: Database.Database, c: UsageFoldCursor): UsageCallRecord[] {
  const limit = Math.min(Math.max(c.limit, 1), 20_000);
  const rows = db.prepare(
    `SELECT * FROM usage_calls
     WHERE ts > ? OR (ts = ? AND id > ?)
     ORDER BY ts ASC, id ASC LIMIT ?`
  ).all(c.lastTs, c.lastTs, c.lastId, limit) as Row[];
  return rows.map(toCall);
}

export function listUsageEventsForFold(db: Database.Database, c: UsageFoldCursor): AgentUsageEvent[] {
  const limit = Math.min(Math.max(c.limit, 1), 20_000);
  const rows = db.prepare(
    `SELECT * FROM agent_usage_event
     WHERE ts > ? OR (ts = ? AND id > ?)
     ORDER BY ts ASC, id ASC LIMIT ?`
  ).all(c.lastTs, c.lastTs, c.lastId, limit) as Row[];
  return rows.map(toEvent);
}

// ── Layer 2 ──

/** Columns are NAMED rather than copied positionally, so a later ALTER on a hot table cannot
 *  silently shift values into the wrong archive columns. */
const CALL_COLS =
  'id, ts, ownerGhii, actorGaii, actorKind, surface, coordinate, appId, counterpartyGhii, ' +
  'outcome, reason, durationMs, chargedUnits, unit, currency, entitlementId, runId, meta';
const EVENT_COLS =
  'id, ts, agentGaii, ownerGhii, runId, model, provider, promptTokens, completionTokens, ' +
  'costUsd, priceRef, source, apiKeyScope, organismId, workspaceId, capabilityId, ' +
  'consumerGhii, provenanceId, appId, surface';

export function archiveUsageRows(
  db: Database.Database,
  args: { before: string; pruneHourBefore: string; batch: number },
): UsageArchiveResult {
  const batch = Math.min(Math.max(args.batch, 1), 20_000);
  const archivedAt = new Date().toISOString();

  const moveCalls = db.transaction(() => {
    const ids = (db.prepare('SELECT id FROM usage_calls WHERE ts < ? ORDER BY ts ASC LIMIT ?')
      .all(args.before, batch) as Array<{ id: string }>).map(r => r.id);
    if (!ids.length) return 0;
    const holes = ids.map(() => '?').join(',');
    db.prepare(
      `INSERT OR IGNORE INTO usage_calls_archive (${CALL_COLS}, archivedAt)
       SELECT ${CALL_COLS}, ? FROM usage_calls WHERE id IN (${holes})`
    ).run(archivedAt, ...ids);
    db.prepare(`DELETE FROM usage_calls WHERE id IN (${holes})`).run(...ids);
    return ids.length;
  });

  const moveEvents = db.transaction(() => {
    const ids = (db.prepare('SELECT id FROM agent_usage_event WHERE ts < ? ORDER BY ts ASC LIMIT ?')
      .all(args.before, batch) as Array<{ id: string }>).map(r => r.id);
    if (!ids.length) return 0;
    const holes = ids.map(() => '?').join(',');
    db.prepare(
      `INSERT OR IGNORE INTO agent_usage_event_archive (${EVENT_COLS}, archivedAt)
       SELECT ${EVENT_COLS}, ? FROM agent_usage_event WHERE id IN (${holes})`
    ).run(archivedAt, ...ids);
    db.prepare(`DELETE FROM agent_usage_event WHERE id IN (${holes})`).run(...ids);
    return ids.length;
  });

  const usageCalls = moveCalls();
  const usageEvents = moveEvents();

  // Hour-grain rollups are the live-dashboard resolution; the day grain carries the history.
  // Deleted rather than archived — derived data, rebuildable from raw.
  const pruned = db.prepare("DELETE FROM usage_rollup WHERE grain = 'hour' AND bucket < ?")
    .run(args.pruneHourBefore);

  return { usageCalls, usageEvents, hourRollupsPruned: pruned.changes };
}

export function pruneUsageArchive(
  db: Database.Database, before: string,
): { usageCalls: number; usageEvents: number } {
  const calls = db.prepare('DELETE FROM usage_calls_archive WHERE ts < ?').run(before).changes;
  const events = db.prepare('DELETE FROM agent_usage_event_archive WHERE ts < ?').run(before).changes;
  return { usageCalls: calls, usageEvents: events };
}

// ── Layer 3 ──

export function getUsageCursor(db: Database.Database, stream: 'llm' | 'call'): UsageRollupCursor | null {
  const row = db.prepare('SELECT * FROM usage_rollup_state WHERE stream = ?').get(stream) as Row | undefined;
  if (!row) return null;
  return {
    stream,
    lastTs: (row.lastTs as string) ?? '',
    lastId: (row.lastId as string) ?? '',
    updatedAt: row.updatedAt as string,
  };
}

export function setUsageCursor(db: Database.Database, stream: 'llm' | 'call', lastTs: string, lastId: string): void {
  db.prepare(
    `INSERT INTO usage_rollup_state (stream, lastTs, lastId, updatedAt) VALUES (?, ?, ?, ?)
     ON CONFLICT(stream) DO UPDATE SET lastTs = excluded.lastTs, lastId = excluded.lastId,
       updatedAt = excluded.updatedAt`
  ).run(stream, lastTs, lastId, new Date().toISOString());
}

/**
 * Apply every delta and advance the cursor in ONE transaction. That is the whole exactly-once
 * guarantee: a crash before commit replays these rows, a crash after commit continues past them.
 */
export function advanceUsageRollup(
  db: Database.Database,
  args: { stream: 'llm' | 'call'; deltas: UsageRollupDelta[]; lastTs: string; lastId: string },
): void {
  const updatedAt = new Date().toISOString();
  const upsert = db.prepare(
    `INSERT INTO usage_rollup
       (id, cut, grain, bucket, ownerGhii, actorGaii, appId, model, provider, surface, outcome,
        coordinate, counterpartyGhii, calls, errors, refusals, tokensIn, tokensOut, costUsd,
        unpricedCalls, chargedUnits, durationMsSum, durationMsMax, actorsSeen, extra, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(cut, grain, bucket, ownerGhii, actorGaii, appId, model, provider, surface,
                 outcome, coordinate, counterpartyGhii)
     DO UPDATE SET
       calls         = usage_rollup.calls + excluded.calls,
       errors        = usage_rollup.errors + excluded.errors,
       refusals      = usage_rollup.refusals + excluded.refusals,
       tokensIn      = usage_rollup.tokensIn + excluded.tokensIn,
       tokensOut     = usage_rollup.tokensOut + excluded.tokensOut,
       costUsd       = usage_rollup.costUsd + excluded.costUsd,
       unpricedCalls = usage_rollup.unpricedCalls + excluded.unpricedCalls,
       chargedUnits  = usage_rollup.chargedUnits + excluded.chargedUnits,
       durationMsSum = usage_rollup.durationMsSum + excluded.durationMsSum,
       -- A maximum is not a sum. This is the one metric that does not add.
       durationMsMax = MAX(usage_rollup.durationMsMax, excluded.durationMsMax),
       actorsSeen    = usage_rollup.actorsSeen + excluded.actorsSeen,
       extra         = json_patch(usage_rollup.extra, excluded.extra),
       updatedAt     = excluded.updatedAt`
  );
  const cursor = db.prepare(
    `INSERT INTO usage_rollup_state (stream, lastTs, lastId, updatedAt) VALUES (?, ?, ?, ?)
     ON CONFLICT(stream) DO UPDATE SET lastTs = excluded.lastTs, lastId = excluded.lastId,
       updatedAt = excluded.updatedAt`
  );

  db.transaction(() => {
    for (const d of args.deltas) {
      upsert.run(
        randomUUID(), d.cut, d.grain, d.bucket, d.ownerGhii, d.actorGaii, d.appId, d.model,
        d.provider, d.surface, d.outcome, d.coordinate, d.counterpartyGhii,
        d.calls, d.errors, d.refusals, d.tokensIn, d.tokensOut, d.costUsd,
        d.unpricedCalls, d.chargedUnits, d.durationMsSum, d.durationMsMax, d.actorsSeen,
        JSON.stringify(d.extra ?? {}), updatedAt,
      );
    }
    cursor.run(args.stream, args.lastTs, args.lastId, updatedAt);
  })();
}

export function queryUsageRollup(db: Database.Database, filter: UsageRollupFilter): UsageRollupRow[] {
  const clauses: string[] = ['cut = ?'];
  const params: unknown[] = [filter.cut];
  if (filter.grain) { clauses.push('grain = ?'); params.push(filter.grain); }
  if (filter.from) { clauses.push('bucket >= ?'); params.push(filter.from); }
  if (filter.to) { clauses.push('bucket <= ?'); params.push(filter.to); }
  if (filter.ownerGhii) { clauses.push('ownerGhii = ?'); params.push(filter.ownerGhii); }
  if (filter.appId) { clauses.push('appId = ?'); params.push(filter.appId); }
  if (filter.actorGaii) { clauses.push('actorGaii = ?'); params.push(filter.actorGaii); }
  if (filter.counterpartyGhii) { clauses.push('counterpartyGhii = ?'); params.push(filter.counterpartyGhii); }
  const limit = Math.min(Math.max(filter.limit ?? 5000, 1), 50_000);
  const rows = db.prepare(
    `SELECT * FROM usage_rollup WHERE ${clauses.join(' AND ')} ORDER BY bucket ASC LIMIT ?`
  ).all(...params, limit) as Row[];
  return rows.map(toRollup);
}

export function clearUsageRollupRange(
  db: Database.Database,
  args: { from?: string; to?: string; grain?: 'hour' | 'day' },
): number {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (args.grain) { clauses.push('grain = ?'); params.push(args.grain); }
  if (args.from) { clauses.push('bucket >= ?'); params.push(args.from); }
  if (args.to) { clauses.push('bucket <= ?'); params.push(args.to); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`DELETE FROM usage_rollup ${where}`).run(...params).changes;
}
