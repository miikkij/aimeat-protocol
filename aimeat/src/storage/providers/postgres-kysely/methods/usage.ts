/**
 * @file src/storage/providers/postgres-kysely/methods/usage.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Postgres implementation of usage telemetry's three layers: the hot call stream, the
 *   archive sweep, and the discriminated serving rollup with its transactional fold.
 *   Design: docs/internal/telemetria/02-design.md
 *
 *   BIGINT ARRIVES AS A STRING. node-postgres returns int8 as text to avoid silent precision loss,
 *   so every metric read goes through `num()`. Reading them raw would put "42" where 42 belongs and
 *   turn a sum into concatenation, which is exactly the kind of defect a chart makes look plausible.
 * @structure
 *   - usageMethods.appendUsageCall / listUsageCalls / *ForFold
 *   - usageMethods.archiveUsageRows
 *   - usageMethods.getUsageCursor / setUsageCursor / advanceUsageRollup
 *   - usageMethods.queryUsageRollup / clearUsageRollupRange
 * @usage Object.assign(PostgresKyselyStorage.prototype, usageMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-08-14 — Initial: three-layer usage telemetry substrate.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
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
import type { PostgresKyselyStorage } from '../index.js';

/** int8 comes back as a string; anything unparseable is 0 rather than NaN reaching a chart. */
function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string') { const n = Number(v); return Number.isFinite(n) ? n : 0; }
  return 0;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function numObj(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(obj(v))) out[k] = num(val);
  return out;
}

function toCall(r: Record<string, unknown>): UsageCallRecord {
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
    meta: obj(r.meta),
  };
}

function toRollup(r: Record<string, unknown>): UsageRollupRow {
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

/** The LLM-ledger row shape the fold consumes. Kept local — the ledger's own mapper is private. */
function toEvent(r: Record<string, unknown>): AgentUsageEvent & { appId?: string; surface?: string } {
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
  };
}

export const usageMethods = {
  // ── Layer 1 ──

  async appendUsageCall(this: PostgresKyselyStorage, rows: UsageCallRecord[]): Promise<void> {
    if (!rows.length) return;
    await this.db.insertInto('UsageCall').values(rows.map(r => ({
      id: r.id, ts: r.ts, ownerGhii: r.ownerGhii,
      actorGaii: r.actorGaii, actorKind: r.actorKind, surface: r.surface,
      coordinate: r.coordinate, appId: r.appId, counterpartyGhii: r.counterpartyGhii,
      outcome: r.outcome, reason: r.reason, durationMs: r.durationMs,
      chargedUnits: r.chargedUnits, unit: r.unit, currency: r.currency,
      entitlementId: r.entitlementId, runId: r.runId,
      meta: JSON.stringify(r.meta),
    }))).execute();
  },

  async listUsageCalls(this: PostgresKyselyStorage, filter: UsageCallFilter): Promise<UsageCallRecord[]> {
    // NOT owner-scoped unless the filter says so: the route gates this on the operator role and
    // records its own inspection (design: the audit rule).
    let q = this.db.selectFrom('UsageCall').selectAll();
    if (filter.ownerGhii) q = q.where('ownerGhii', '=', filter.ownerGhii);
    if (filter.actorGaii) q = q.where('actorGaii', '=', filter.actorGaii);
    if (filter.surface) q = q.where('surface', '=', filter.surface);
    if (filter.appId) q = q.where('appId', '=', filter.appId);
    if (filter.outcome) q = q.where('outcome', '=', filter.outcome);
    if (filter.from) q = q.where('ts', '>=', filter.from);
    if (filter.to) q = q.where('ts', '<=', filter.to);
    const limit = Math.min(Math.max(filter.limit ?? 200, 1), 2000);
    const rows = await q.orderBy('ts', 'desc').limit(limit).execute();
    return rows.map(r => toCall(r as unknown as Record<string, unknown>));
  },

  async listUsageCallsForFold(this: PostgresKyselyStorage, c: UsageFoldCursor): Promise<UsageCallRecord[]> {
    // Strictly AFTER (lastTs, lastId) in the stream's total order. A row-value comparison, so the
    // second field only decides ties — the plain `ts > x OR (ts = x AND id > y)` written out.
    const rows = await this.db.selectFrom('UsageCall').selectAll()
      .where(sql<boolean>`("ts", "id") > (${c.lastTs}, ${c.lastId})`)
      .orderBy('ts', 'asc').orderBy('id', 'asc')
      .limit(Math.min(Math.max(c.limit, 1), 20_000))
      .execute();
    return rows.map(r => toCall(r as unknown as Record<string, unknown>));
  },

  async listUsageEventsForFold(this: PostgresKyselyStorage, c: UsageFoldCursor): Promise<AgentUsageEvent[]> {
    const rows = await this.db.selectFrom('AgentUsageEvent').selectAll()
      .where(sql<boolean>`("ts", "id") > (${c.lastTs}, ${c.lastId})`)
      .orderBy('ts', 'asc').orderBy('id', 'asc')
      .limit(Math.min(Math.max(c.limit, 1), 20_000))
      .execute();
    return rows.map(r => toEvent(r as unknown as Record<string, unknown>));
  },

  // ── Layer 2 ──

  async archiveUsageRows(
    this: PostgresKyselyStorage,
    args: { before: string; pruneHourBefore: string; batch: number },
  ): Promise<UsageArchiveResult> {
    const batch = Math.min(Math.max(args.batch, 1), 20_000);
    const archivedAt = new Date().toISOString();

    // INSERT … SELECT then DELETE, per table, inside one transaction each: a crash between the two
    // halves must not leave a row in both places or in neither. `ON CONFLICT DO NOTHING` makes a
    // replayed batch idempotent (the id is the archive's primary key too).
    //
    // COLUMNS ARE NAMED, not `SELECT *`. A positional copy works until someone ALTERs the hot table,
    // and then it either fails loudly or, if the new column happens to type-match, writes values
    // into the wrong columns of a table nobody looks at.
    const usageCalls = await this.transaction(async () => {
      const picked = await this.db.selectFrom('UsageCall').select('id')
        .where('ts', '<', args.before).orderBy('ts', 'asc').limit(batch).execute();
      const ids = picked.map(p => p.id);
      if (!ids.length) return 0;
      await sql`
        INSERT INTO "UsageCallArchive" (
          "id","ts","ownerGhii","actorGaii","actorKind","surface","coordinate","appId",
          "counterpartyGhii","outcome","reason","durationMs","chargedUnits","unit","currency",
          "entitlementId","runId","meta","archivedAt")
        SELECT
          "id","ts","ownerGhii","actorGaii","actorKind","surface","coordinate","appId",
          "counterpartyGhii","outcome","reason","durationMs","chargedUnits","unit","currency",
          "entitlementId","runId","meta", ${archivedAt}
        FROM "UsageCall" WHERE "id" = ANY(${ids})
        ON CONFLICT ("id") DO NOTHING
      `.execute(this.db);
      await this.db.deleteFrom('UsageCall').where('id', 'in', ids).execute();
      return ids.length;
    });

    const usageEvents = await this.transaction(async () => {
      const picked = await this.db.selectFrom('AgentUsageEvent').select('id')
        .where('ts', '<', args.before).orderBy('ts', 'asc').limit(batch).execute();
      const ids = picked.map(p => p.id);
      if (!ids.length) return 0;
      await sql`
        INSERT INTO "AgentUsageEventArchive" (
          "id","ts","agentGaii","ownerGhii","runId","model","provider","promptTokens",
          "completionTokens","costUsd","priceRef","source","apiKeyScope","organismId",
          "workspaceId","capabilityId","consumerGhii","provenanceId","appId","surface","archivedAt")
        SELECT
          "id","ts","agentGaii","ownerGhii","runId","model","provider","promptTokens",
          "completionTokens","costUsd","priceRef","source","apiKeyScope","organismId",
          "workspaceId","capabilityId","consumerGhii","provenanceId","appId","surface", ${archivedAt}
        FROM "AgentUsageEvent" WHERE "id" = ANY(${ids})
        ON CONFLICT ("id") DO NOTHING
      `.execute(this.db);
      await this.db.deleteFrom('AgentUsageEvent').where('id', 'in', ids).execute();
      return ids.length;
    });

    // Hour-grain rollups are the live-dashboard resolution and are not kept: the day grain carries
    // the history. Deleted rather than archived — it is derived data, rebuildable from raw.
    const pruned = await this.db.deleteFrom('UsageRollup')
      .where('grain', '=', 'hour').where('bucket', '<', args.pruneHourBefore)
      .executeTakeFirst();

    return { usageCalls, usageEvents, hourRollupsPruned: Number(pruned?.numDeletedRows ?? 0) };
  },

  async pruneUsageArchive(
    this: PostgresKyselyStorage, before: string,
  ): Promise<{ usageCalls: number; usageEvents: number }> {
    const calls = await this.db.deleteFrom('UsageCallArchive').where('ts', '<', before).executeTakeFirst();
    const events = await this.db.deleteFrom('AgentUsageEventArchive').where('ts', '<', before).executeTakeFirst();
    return {
      usageCalls: Number(calls?.numDeletedRows ?? 0),
      usageEvents: Number(events?.numDeletedRows ?? 0),
    };
  },

  // ── Layer 3 ──

  async getUsageCursor(this: PostgresKyselyStorage, stream: 'llm' | 'call'): Promise<UsageRollupCursor | null> {
    const row = await this.db.selectFrom('UsageRollupState').selectAll()
      .where('stream', '=', stream).executeTakeFirst();
    if (!row) return null;
    return { stream, lastTs: row.lastTs, lastId: row.lastId, updatedAt: row.updatedAt };
  },

  async setUsageCursor(this: PostgresKyselyStorage, stream: 'llm' | 'call', lastTs: string, lastId: string): Promise<void> {
    const updatedAt = new Date().toISOString();
    await this.db.insertInto('UsageRollupState')
      .values({ stream, lastTs, lastId, updatedAt })
      .onConflict(oc => oc.column('stream').doUpdateSet({ lastTs, lastId, updatedAt }))
      .execute();
  },

  async advanceUsageRollup(
    this: PostgresKyselyStorage,
    args: { stream: 'llm' | 'call'; deltas: UsageRollupDelta[]; lastTs: string; lastId: string },
  ): Promise<void> {
    const updatedAt = new Date().toISOString();
    // ONE transaction, and that is the whole exactly-once guarantee. A crash before commit replays
    // these rows; a crash after commit continues past them. Split the two halves and one of those
    // outcomes becomes a double count.
    await this.transaction(async () => {
      for (const d of args.deltas) {
        await this.db.insertInto('UsageRollup').values({
          id: randomUUID(),
          cut: d.cut, grain: d.grain, bucket: d.bucket,
          ownerGhii: d.ownerGhii, actorGaii: d.actorGaii, appId: d.appId,
          model: d.model, provider: d.provider, surface: d.surface,
          outcome: d.outcome, coordinate: d.coordinate, counterpartyGhii: d.counterpartyGhii,
          calls: d.calls, errors: d.errors, refusals: d.refusals,
          tokensIn: d.tokensIn, tokensOut: d.tokensOut, costUsd: d.costUsd,
          unpricedCalls: d.unpricedCalls, chargedUnits: d.chargedUnits,
          durationMsSum: d.durationMsSum, durationMsMax: d.durationMsMax,
          actorsSeen: d.actorsSeen,
          extra: JSON.stringify(d.extra ?? {}),
          updatedAt,
        }).onConflict(oc => oc
          .columns(['cut', 'grain', 'bucket', 'ownerGhii', 'actorGaii', 'appId', 'model',
                    'provider', 'surface', 'outcome', 'coordinate', 'counterpartyGhii'])
          .doUpdateSet({
            calls: sql`"UsageRollup"."calls" + ${d.calls}`,
            errors: sql`"UsageRollup"."errors" + ${d.errors}`,
            refusals: sql`"UsageRollup"."refusals" + ${d.refusals}`,
            tokensIn: sql`"UsageRollup"."tokensIn" + ${d.tokensIn}`,
            tokensOut: sql`"UsageRollup"."tokensOut" + ${d.tokensOut}`,
            costUsd: sql`"UsageRollup"."costUsd" + ${d.costUsd}`,
            unpricedCalls: sql`"UsageRollup"."unpricedCalls" + ${d.unpricedCalls}`,
            chargedUnits: sql`"UsageRollup"."chargedUnits" + ${d.chargedUnits}`,
            durationMsSum: sql`"UsageRollup"."durationMsSum" + ${d.durationMsSum}`,
            // A maximum is not a sum. This is the one metric that does not add.
            durationMsMax: sql`GREATEST("UsageRollup"."durationMsMax", ${d.durationMsMax})`,
            actorsSeen: sql`"UsageRollup"."actorsSeen" + ${d.actorsSeen}`,
            extra: sql`"UsageRollup"."extra" || ${JSON.stringify(d.extra ?? {})}::jsonb`,
            updatedAt,
          })).execute();
      }
      await this.db.insertInto('UsageRollupState')
        .values({ stream: args.stream, lastTs: args.lastTs, lastId: args.lastId, updatedAt })
        .onConflict(oc => oc.column('stream')
          .doUpdateSet({ lastTs: args.lastTs, lastId: args.lastId, updatedAt }))
        .execute();
    });
  },

  async queryUsageRollup(this: PostgresKyselyStorage, filter: UsageRollupFilter): Promise<UsageRollupRow[]> {
    let q = this.db.selectFrom('UsageRollup').selectAll().where('cut', '=', filter.cut);
    if (filter.grain) q = q.where('grain', '=', filter.grain);
    if (filter.from) q = q.where('bucket', '>=', filter.from);
    if (filter.to) q = q.where('bucket', '<=', filter.to);
    if (filter.ownerGhii) q = q.where('ownerGhii', '=', filter.ownerGhii);
    if (filter.appId) q = q.where('appId', '=', filter.appId);
    if (filter.actorGaii) q = q.where('actorGaii', '=', filter.actorGaii);
    if (filter.counterpartyGhii) q = q.where('counterpartyGhii', '=', filter.counterpartyGhii);
    const limit = Math.min(Math.max(filter.limit ?? 5000, 1), 50_000);
    const rows = await q.orderBy('bucket', 'asc').limit(limit).execute();
    return rows.map(r => toRollup(r as unknown as Record<string, unknown>));
  },

  async clearUsageRollupRange(
    this: PostgresKyselyStorage,
    args: { from?: string; to?: string; grain?: 'hour' | 'day' },
  ): Promise<number> {
    let q = this.db.deleteFrom('UsageRollup');
    if (args.grain) q = q.where('grain', '=', args.grain);
    if (args.from) q = q.where('bucket', '>=', args.from);
    if (args.to) q = q.where('bucket', '<=', args.to);
    const res = await q.executeTakeFirst();
    return Number(res?.numDeletedRows ?? 0);
  },
};
