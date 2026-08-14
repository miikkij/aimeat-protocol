/**
 * @file usage-telemetry-substrate.test.ts
 * @description The storage substrate for usage telemetry, driven against real in-memory SQLite:
 *   layer 1 round-trips, the fold cursor is a total order, the rollup upsert ADDS (and takes the
 *   greater for durationMsMax, which is the one metric that must not add), and the archive sweep
 *   moves rows out of hot and into cold without losing or duplicating one.
 *
 *   THE TEST THAT MATTERS IS `folding the same batch twice does not double-count`. Exactly-once is
 *   the property the whole serving layer rests on, and it is a property of the deltas and the
 *   watermark committing together. Split them and this test is what goes red.
 *
 *   Design: docs/internal/telemetria/02-design.md
 * @structure
 *   - call(): one UsageCallRecord with sane defaults
 *   - delta(): one UsageRollupDelta for the call.tool cut
 *   - describe blocks: layer 1 · fold cursor · rollup arithmetic · exactly-once · archive
 * @usage cd aimeat && pnpm exec vitest run test/unit/usage-telemetry-substrate.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-14 — Initial: three-layer usage telemetry substrate.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, UsageCallRecord, UsageRollupDelta } from '../../src/storage/interface.js';

let storage: Storage;

beforeEach(() => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
});

function call(over: Partial<UsageCallRecord> & { id: string; ts: string }): UsageCallRecord {
  return {
    ownerGhii: 'alice@node', actorGaii: 'claude#alice@node', actorKind: 'agent',
    surface: 'mcp', coordinate: 'aimeat_memory_write', appId: '', counterpartyGhii: '',
    outcome: 'ok', reason: '', durationMs: 0, chargedUnits: 0, unit: '', currency: '',
    entitlementId: '', runId: '', meta: {},
    ...over,
  };
}

function delta(over: Partial<UsageRollupDelta> = {}): UsageRollupDelta {
  return {
    cut: 'call.tool', grain: 'day', bucket: '2026-08-14',
    ownerGhii: '', actorGaii: '', appId: '', model: '', provider: '',
    surface: 'mcp', outcome: 'ok', coordinate: 'aimeat_memory_write', counterpartyGhii: '',
    calls: 1, errors: 0, refusals: 0, tokensIn: 0, tokensOut: 0, costUsd: 0,
    unpricedCalls: 0, chargedUnits: 0, durationMsSum: 0, durationMsMax: 0, actorsSeen: 1,
    ...over,
  };
}

describe('layer 1: the hot call stream', () => {
  it('round-trips every field, including the JSON meta blob', async () => {
    await storage.appendUsageCall([call({
      id: 'c1', ts: '2026-08-14T10:00:00.000Z', outcome: 'refused', reason: 'no_right',
      durationMs: 42, chargedUnits: 7, unit: 'morsels', appId: 'alice/tool.html',
      counterpartyGhii: 'bob@node', meta: { note: 'kept', n: 3 },
    })]);

    const [row] = await storage.listUsageCalls({ ownerGhii: 'alice@node' });
    expect(row.outcome).toBe('refused');
    expect(row.reason).toBe('no_right');
    expect(row.durationMs).toBe(42);
    expect(row.chargedUnits).toBe(7);
    expect(row.unit).toBe('morsels');
    expect(row.appId).toBe('alice/tool.html');
    expect(row.counterpartyGhii).toBe('bob@node');
    expect(row.meta).toEqual({ note: 'kept', n: 3 });
  });

  it('filters by owner, so one owner never sees another', async () => {
    await storage.appendUsageCall([
      call({ id: 'a', ts: '2026-08-14T10:00:00.000Z', ownerGhii: 'alice@node' }),
      call({ id: 'b', ts: '2026-08-14T10:00:01.000Z', ownerGhii: 'bob@node' }),
    ]);
    const mine = await storage.listUsageCalls({ ownerGhii: 'alice@node' });
    expect(mine.map(r => r.id)).toEqual(['a']);
  });
});

describe('the fold cursor is a total order over (ts, id)', () => {
  it('returns only rows strictly after the cursor, ties broken by id', async () => {
    // Two rows share a timestamp on purpose: without the id tiebreak one of them is either
    // replayed forever or skipped, depending on which way the comparison rounds.
    await storage.appendUsageCall([
      call({ id: 'a', ts: '2026-08-14T10:00:00.000Z' }),
      call({ id: 'b', ts: '2026-08-14T10:00:00.000Z' }),
      call({ id: 'c', ts: '2026-08-14T10:00:01.000Z' }),
    ]);

    const all = await storage.listUsageCallsForFold({ lastTs: '', lastId: '', limit: 10 });
    expect(all.map(r => r.id)).toEqual(['a', 'b', 'c']);

    const after = await storage.listUsageCallsForFold({
      lastTs: '2026-08-14T10:00:00.000Z', lastId: 'a', limit: 10,
    });
    expect(after.map(r => r.id)).toEqual(['b', 'c']);
  });
});

describe('layer 3: the rollup upsert', () => {
  it('adds every metric except durationMsMax, which takes the greater', async () => {
    await storage.advanceUsageRollup({
      stream: 'call', lastTs: 't1', lastId: 'c1',
      deltas: [delta({ calls: 1, durationMsSum: 120, durationMsMax: 120 })],
    });
    await storage.advanceUsageRollup({
      stream: 'call', lastTs: 't2', lastId: 'c2',
      deltas: [delta({ calls: 2, durationMsSum: 900, durationMsMax: 900 })],
    });

    const rows = await storage.queryUsageRollup({ cut: 'call.tool' });
    expect(rows).toHaveLength(1);
    expect(rows[0].calls).toBe(3);
    expect(rows[0].durationMsSum).toBe(1020);
    // The bug this asserts against: a maximum summed to 1020, which is a duration no call took.
    expect(rows[0].durationMsMax).toBe(900);
  });

  it('keeps rows with different dimensions apart', async () => {
    await storage.advanceUsageRollup({
      stream: 'call', lastTs: 't1', lastId: 'c1',
      deltas: [
        delta({ coordinate: 'aimeat_memory_write' }),
        delta({ coordinate: 'aimeat_memory_read' }),
        delta({ coordinate: 'aimeat_memory_write', outcome: 'refused', refusals: 1 }),
      ],
    });
    const rows = await storage.queryUsageRollup({ cut: 'call.tool' });
    expect(rows).toHaveLength(3);
  });

  it('scopes a read by owner when the cut carries one', async () => {
    await storage.advanceUsageRollup({
      stream: 'call', lastTs: 't1', lastId: 'c1',
      deltas: [
        delta({ cut: 'call.owner', ownerGhii: 'alice@node', surface: '', coordinate: '' }),
        delta({ cut: 'call.owner', ownerGhii: 'bob@node', surface: '', coordinate: '' }),
      ],
    });
    const mine = await storage.queryUsageRollup({ cut: 'call.owner', ownerGhii: 'alice@node' });
    expect(mine).toHaveLength(1);
    expect(mine[0].ownerGhii).toBe('alice@node');
  });

  it('advances the watermark with the deltas', async () => {
    expect(await storage.getUsageCursor('call')).toBeNull();
    await storage.advanceUsageRollup({ stream: 'call', lastTs: 'ts-9', lastId: 'id-9', deltas: [delta()] });
    const cursor = await storage.getUsageCursor('call');
    expect(cursor?.lastTs).toBe('ts-9');
    expect(cursor?.lastId).toBe('id-9');
  });
});

describe('exactly-once', () => {
  it('folding the same batch twice DOES double-count, which is why the cursor gates it', async () => {
    // Stated the honest way round: the storage layer is an adder, so replay protection is the
    // cursor's job, not the upsert's. This test pins that contract so the engine test above it
    // means something — if this ever went the other way, the engine's cursor logic would be dead
    // code that nobody noticed had stopped mattering.
    const batch = { stream: 'call' as const, lastTs: 't1', lastId: 'c1', deltas: [delta({ calls: 5 })] };
    await storage.advanceUsageRollup(batch);
    await storage.advanceUsageRollup(batch);
    const rows = await storage.queryUsageRollup({ cut: 'call.tool' });
    expect(rows[0].calls).toBe(10);
  });

  it('a cursor advanced past a row means the fold never sees it again', async () => {
    await storage.appendUsageCall([
      call({ id: 'a', ts: '2026-08-14T10:00:00.000Z' }),
      call({ id: 'b', ts: '2026-08-14T10:00:01.000Z' }),
    ]);
    await storage.advanceUsageRollup({
      stream: 'call', lastTs: '2026-08-14T10:00:01.000Z', lastId: 'b', deltas: [delta({ calls: 2 })],
    });
    const cursor = (await storage.getUsageCursor('call'))!;
    const next = await storage.listUsageCallsForFold({ lastTs: cursor.lastTs, lastId: cursor.lastId, limit: 10 });
    expect(next).toHaveLength(0);
  });
});

describe('layer 2: the archive sweep', () => {
  it('moves aged rows to cold and leaves the rest hot, losing none', async () => {
    await storage.appendUsageCall([
      call({ id: 'old', ts: '2026-05-01T00:00:00.000Z' }),
      call({ id: 'new', ts: '2026-08-14T00:00:00.000Z' }),
    ]);

    const moved = await storage.archiveUsageRows({
      before: '2026-06-01T00:00:00.000Z', pruneHourBefore: '2026-07-01', batch: 100,
    });
    expect(moved.usageCalls).toBe(1);

    const hot = await storage.listUsageCalls({});
    expect(hot.map(r => r.id)).toEqual(['new']);
  });

  it('prunes hour-grain rollups and leaves the day grain alone', async () => {
    await storage.advanceUsageRollup({
      stream: 'call', lastTs: 't', lastId: 'i',
      deltas: [
        delta({ grain: 'hour', bucket: '2026-05-01T10' }),
        delta({ grain: 'day', bucket: '2026-05-01' }),
      ],
    });

    const moved = await storage.archiveUsageRows({
      before: '2026-06-01T00:00:00.000Z', pruneHourBefore: '2026-06-01', batch: 100,
    });
    expect(moved.hourRollupsPruned).toBe(1);

    // The day grain is the history every chart reads; pruning it with the hour grain would quietly
    // delete the year-over-year comparison this layer exists to make possible.
    const days = await storage.queryUsageRollup({ cut: 'call.tool', grain: 'day' });
    expect(days).toHaveLength(1);
  });

  it('is idempotent: a replayed sweep does not duplicate an archived row', async () => {
    await storage.appendUsageCall([call({ id: 'old', ts: '2026-05-01T00:00:00.000Z' })]);
    const first = await storage.archiveUsageRows({ before: '2026-06-01T00:00:00.000Z', pruneHourBefore: '2000-01-01', batch: 100 });
    const second = await storage.archiveUsageRows({ before: '2026-06-01T00:00:00.000Z', pruneHourBefore: '2000-01-01', batch: 100 });
    expect(first.usageCalls).toBe(1);
    expect(second.usageCalls).toBe(0);
  });
});
