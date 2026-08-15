/**
 * @file usage-read-grouping.test.ts
 * @description How a report decides what counts as ONE ROW. Three rules, each of which shipped wrong
 *   first and was caught by looking at the screen rather than by a test:
 *
 *     1. `outcome` never groups. It qualifies a call; `refusals` and `errors` are already metrics on
 *        every row. Grouping by it split one surface into an ok row and an error row that BOTH read
 *        "mcp" — a table answering no question anyone asked.
 *     2. A dimension the scope already pinned never groups either. An owner reading `llm.owner` has
 *        ownerGhii pinned, so the only thing left to tell rows apart is time: "spend per day" must
 *        group by bucket, not show one row labelled with the reader's own identity.
 *     3. `outcome` never LABELS a row either, for the same reason — it made an app-opens table
 *        title an unattributed row "ok".
 *
 *   Design: docs/internal/telemetria/02-design.md
 * @usage cd aimeat && pnpm exec vitest run test/unit/usage-read-grouping.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-15 — Initial: the three grouping rules, after all three were found by eye.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, UsageRollupDelta } from '../../src/storage/interface.js';
import { readUsageReport } from '../../src/services/usage/usage-read.js';

const OWNER = 'alice@node';
let storage: Storage;

beforeEach(() => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
});

function delta(over: Partial<UsageRollupDelta> & { cut: string }): UsageRollupDelta {
  return {
    grain: 'day', bucket: '2026-08-15',
    ownerGhii: '', actorGaii: '', appId: '', model: '', provider: '',
    surface: '', outcome: '', coordinate: '', counterpartyGhii: '',
    calls: 0, errors: 0, refusals: 0, tokensIn: 0, tokensOut: 0, costUsd: 0,
    unpricedCalls: 0, chargedUnits: 0, durationMsSum: 0, durationMsMax: 0, actorsSeen: 0,
    ...over,
  };
}

/** Write straight into the serving layer: this file is about the READ, not about the fold. */
async function seed(deltas: UsageRollupDelta[]): Promise<void> {
  await storage.advanceUsageRollup({ stream: 'call', deltas, lastTs: 't', lastId: 'i' });
}

const window = { from: '2026-08-01', to: '2026-08-31' } as const;

describe('outcome qualifies a row, it does not identify one', () => {
  it('collapses the ok and error rows of one surface into a single row', async () => {
    // Exactly the shape the screen showed: 139 clean MCP calls and 3 that failed, stored as two
    // rollup rows because the cut carries `outcome`.
    await seed([
      delta({ cut: 'call.owner.surface', ownerGhii: OWNER, surface: 'mcp', outcome: 'ok',
              calls: 139, durationMsSum: 12927, durationMsMax: 1900 }),
      delta({ cut: 'call.owner.surface', ownerGhii: OWNER, surface: 'mcp', outcome: 'error',
              calls: 3, errors: 3, durationMsSum: 18, durationMsMax: 6 }),
    ]);

    const report = await readUsageReport(storage, {
      report: 'surface', scope: 'owner', ownerGhii: OWNER, ...window,
    });

    // One surface, one row. Two rows here is the defect this test exists for.
    expect(report.groups).toHaveLength(1);
    expect(report.groups[0].key).toBe('mcp');
    expect(report.groups[0].calls).toBe(142);
    expect(report.groups[0].errors).toBe(3);
    expect(report.groups[0].refusals).toBe(0);
    // The slowest call, not the sum of two maxima.
    expect(report.groups[0].duration_ms_max).toBe(1900);
  });

  it('keeps refusals and errors apart inside that one row', async () => {
    await seed([
      delta({ cut: 'call.owner.surface', ownerGhii: OWNER, surface: 'mcp', outcome: 'ok', calls: 10 }),
      delta({ cut: 'call.owner.surface', ownerGhii: OWNER, surface: 'mcp', outcome: 'refused', calls: 4, refusals: 4 }),
      delta({ cut: 'call.owner.surface', ownerGhii: OWNER, surface: 'mcp', outcome: 'error', calls: 1, errors: 1 }),
    ]);

    const report = await readUsageReport(storage, {
      report: 'surface', scope: 'owner', ownerGhii: OWNER, ...window,
    });
    expect(report.groups).toHaveLength(1);
    expect(report.groups[0].calls).toBe(15);
    expect(report.groups[0].refusals).toBe(4);
    expect(report.groups[0].errors).toBe(1);
  });

  it('still separates rows by a dimension that DOES identify them', async () => {
    await seed([
      delta({ cut: 'call.owner.surface', ownerGhii: OWNER, surface: 'mcp', outcome: 'ok', calls: 5 }),
      delta({ cut: 'call.owner.surface', ownerGhii: OWNER, surface: 'app', outcome: 'ok', calls: 2 }),
    ]);
    const report = await readUsageReport(storage, {
      report: 'surface', scope: 'owner', ownerGhii: OWNER, ...window,
    });
    expect(report.groups.map(g => g.key).sort()).toEqual(['app', 'mcp']);
  });

  it('never labels a row with an outcome when nothing else names it', async () => {
    // A call carrying no app id, in a cut keyed by (appId, outcome). Before the fix this row was
    // labelled "ok" and appeared in an apps table as if it were an app.
    await seed([delta({ cut: 'call.app', appId: '', outcome: 'ok', calls: 3 })]);
    const report = await readUsageReport(storage, { report: 'apps-used', scope: 'node', ...window });
    expect(report.groups[0].key).toBe('(unattributed)');
  });
});

describe('a dimension the scope already pinned does not group either', () => {
  it('makes an owner-scoped spend report a time series', async () => {
    await seed([
      delta({ cut: 'llm.owner', ownerGhii: OWNER, bucket: '2026-08-14', calls: 2, costUsd: 0.2 }),
      delta({ cut: 'llm.owner', ownerGhii: OWNER, bucket: '2026-08-15', calls: 3, costUsd: 0.4 }),
    ]);
    const report = await readUsageReport(storage, {
      report: 'day', scope: 'owner', ownerGhii: OWNER, ...window,
    });

    // Two days, chronological. One row labelled with the reader's own GHII is the defect.
    expect(report.groups.map(g => g.key)).toEqual(['2026-08-14', '2026-08-15']);
    expect(report.totals.cost_usd).toBeCloseTo(0.6);
  });

  it('keeps that same cut per-owner when the operator reads it across owners', async () => {
    await seed([
      delta({ cut: 'llm.owner', ownerGhii: OWNER, calls: 2, costUsd: 0.2 }),
      delta({ cut: 'llm.owner', ownerGhii: 'bob@node', calls: 1, costUsd: 0.9 }),
    ]);
    const report = await readUsageReport(storage, { report: 'user', scope: 'node', ...window });
    expect(report.groups.map(g => g.key).sort()).toEqual(['alice@node', 'bob@node']);
    // Biggest first, because that is what someone opening a spend report is looking for.
    expect(report.groups[0].key).toBe('bob@node');
  });
});

describe('owner scoping', () => {
  it('never returns another owner rows', async () => {
    await seed([
      delta({ cut: 'call.owner.surface', ownerGhii: OWNER, surface: 'mcp', outcome: 'ok', calls: 5 }),
      delta({ cut: 'call.owner.surface', ownerGhii: 'bob@node', surface: 'mcp', outcome: 'ok', calls: 99 }),
    ]);
    const report = await readUsageReport(storage, {
      report: 'surface', scope: 'owner', ownerGhii: OWNER, ...window,
    });
    expect(report.totals.calls).toBe(5);
  });
});
