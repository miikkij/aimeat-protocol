/**
 * @file usage-rollup-engine.test.ts
 * @description The fold, driven against real in-memory SQLite. The test this file exists for is
 *   `running the fold twice does not double-count`: exactly-once is the property the whole serving
 *   layer rests on, and it is the one a future refactor is most likely to break by separating the
 *   deltas from the watermark they account for.
 *
 *   The rest hold the fold's arithmetic to what the cuts declare: one raw row lands in every cut it
 *   belongs to and in none it does not, refusals are counted apart from errors, a tied timestamp
 *   does not lose its tail, and a rebuild corrects a window instead of doubling it.
 *
 *   Design: docs/internal/telemetria/02-design.md
 * @structure
 *   - seedCalls / seedEvents: raw rows straight into storage, bypassing the buffer
 *   - describe blocks: projection into cuts · refusals · exactly-once · resume · rebuild
 * @usage cd aimeat && pnpm exec vitest run test/unit/usage-rollup-engine.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-14 — Initial: the fold's correctness gates.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, UsageCallRecord, AgentUsageEvent } from '../../src/storage/interface.js';
import { runUsageRollup, rebuildUsageRollup } from '../../src/services/usage/rollup-engine.js';
import { CUTS } from '../../src/services/usage/rollup-cuts.js';

let storage: Storage;

beforeEach(() => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
});

function seedCalls(rows: Array<Partial<UsageCallRecord> & { id: string; ts: string }>): Promise<void> {
  return storage.appendUsageCall(rows.map(r => ({
    ownerGhii: 'alice@node', actorGaii: 'claude#alice@node', actorKind: 'agent' as const,
    surface: 'mcp' as const, coordinate: 'aimeat_memory_write', appId: '', counterpartyGhii: '',
    outcome: 'ok' as const, reason: '', durationMs: 0, chargedUnits: 0, unit: '' as const,
    currency: '', entitlementId: '', runId: '', meta: {},
    ...r,
  })));
}

async function seedEvents(rows: Array<Partial<AgentUsageEvent> & { id: string; ts: string }>): Promise<void> {
  for (const r of rows) {
    await storage.appendUsageEvent({
      agentGaii: 'claude#alice@node', ownerGhii: 'alice@node',
      model: 'anthropic/claude-opus-5', provider: 'openrouter',
      promptTokens: 100, completionTokens: 50, costUsd: 0.01, priceRef: 'provider:openrouter',
      source: 'telemetry', apiKeyScope: 'own', appId: '', surface: '',
      ...r,
    } as AgentUsageEvent);
  }
}

describe('the cut table', () => {
  it('has no duplicate names, because a name IS the stored identity of a row', () => {
    const names = CUTS.map(c => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('projection into cuts', () => {
  it('lands one LLM event in every llm cut and no call cut', async () => {
    await seedEvents([{ id: 'e1', ts: '2026-08-14T10:00:00.000Z', appId: 'alice/app.html' }]);
    await runUsageRollup(storage);

    const model = await storage.queryUsageRollup({ cut: 'llm.model' });
    expect(model).toHaveLength(1);
    expect(model[0].model).toBe('anthropic/claude-opus-5');
    expect(model[0].provider).toBe('openrouter');
    expect(model[0].tokensIn).toBe(100);
    expect(model[0].tokensOut).toBe(50);
    expect(model[0].costUsd).toBeCloseTo(0.01);

    // The dimension that did not exist before this change: which model an app actually calls.
    const appModel = await storage.queryUsageRollup({ cut: 'llm.app.model' });
    expect(appModel).toHaveLength(1);
    expect(appModel[0].appId).toBe('alice/app.html');
    expect(appModel[0].model).toBe('anthropic/claude-opus-5');

    expect(await storage.queryUsageRollup({ cut: 'call.node' })).toHaveLength(0);
  });

  it('rolls a dimension outside the cut over into one row', async () => {
    await seedEvents([
      { id: 'e1', ts: '2026-08-14T10:00:00.000Z', model: 'a', ownerGhii: 'alice@node' },
      { id: 'e2', ts: '2026-08-14T10:00:01.000Z', model: 'b', ownerGhii: 'alice@node' },
    ]);
    await runUsageRollup(storage);

    // llm.owner does not key on model, so two models collapse into the owner's one row.
    const owner = await storage.queryUsageRollup({ cut: 'llm.owner', grain: 'day' });
    expect(owner).toHaveLength(1);
    expect(owner[0].calls).toBe(2);
    expect(owner[0].model).toBe('');

    // llm.model does, so they stay apart.
    expect(await storage.queryUsageRollup({ cut: 'llm.model' })).toHaveLength(2);
  });

  it('writes hour buckets only for the cuts that declare them', async () => {
    await seedEvents([{ id: 'e1', ts: '2026-08-14T10:00:00.000Z' }]);
    await runUsageRollup(storage);

    const hourly = await storage.queryUsageRollup({ cut: 'llm.node', grain: 'hour' });
    expect(hourly.map(r => r.bucket)).toEqual(['2026-08-14T10']);
    // llm.model is day-only: an hour row for it would multiply the biggest cut by 24 for a view
    // nothing renders.
    expect(await storage.queryUsageRollup({ cut: 'llm.model', grain: 'hour' })).toHaveLength(0);
  });

  it('records the unpriced call rather than counting it as free', async () => {
    await seedEvents([
      { id: 'e1', ts: '2026-08-14T10:00:00.000Z', costUsd: null, priceRef: null },
      { id: 'e2', ts: '2026-08-14T10:00:01.000Z', costUsd: 0.02 },
    ]);
    await runUsageRollup(storage);
    const [row] = await storage.queryUsageRollup({ cut: 'llm.node', grain: 'day' });
    expect(row.calls).toBe(2);
    expect(row.unpricedCalls).toBe(1);
    expect(row.costUsd).toBeCloseTo(0.02);
  });
});

describe('refusals are counted apart from errors', () => {
  it('separates ok, refused and error on the same coordinate', async () => {
    await seedCalls([
      { id: 'c1', ts: '2026-08-14T10:00:00.000Z', outcome: 'ok' },
      { id: 'c2', ts: '2026-08-14T10:00:01.000Z', outcome: 'refused', reason: 'no_right' },
      { id: 'c3', ts: '2026-08-14T10:00:02.000Z', outcome: 'error', reason: 'throw' },
    ]);
    await runUsageRollup(storage);

    // call.node does not key on outcome, so all three land in one row with three counters.
    const [node] = await storage.queryUsageRollup({ cut: 'call.node', grain: 'day' });
    expect(node.calls).toBe(3);
    expect(node.refusals).toBe(1);
    expect(node.errors).toBe(1);

    // The refusal row is the one that had no home anywhere before this design.
    const tools = await storage.queryUsageRollup({ cut: 'call.tool' });
    const refused = tools.find(r => r.outcome === 'refused');
    expect(refused?.refusals).toBe(1);
  });

  it('takes the greater duration, never the sum', async () => {
    await seedCalls([
      { id: 'c1', ts: '2026-08-14T10:00:00.000Z', durationMs: 100 },
      { id: 'c2', ts: '2026-08-14T10:00:01.000Z', durationMs: 700 },
    ]);
    await runUsageRollup(storage);
    const [node] = await storage.queryUsageRollup({ cut: 'call.node', grain: 'day' });
    expect(node.durationMsSum).toBe(800);
    expect(node.durationMsMax).toBe(700);
  });
});

describe('exactly-once', () => {
  it('running the fold twice does not double-count', async () => {
    await seedCalls([
      { id: 'c1', ts: '2026-08-14T10:00:00.000Z' },
      { id: 'c2', ts: '2026-08-14T10:00:01.000Z' },
    ]);

    await runUsageRollup(storage);
    const first = (await storage.queryUsageRollup({ cut: 'call.node', grain: 'day' }))[0].calls;

    await runUsageRollup(storage);
    const second = (await storage.queryUsageRollup({ cut: 'call.node', grain: 'day' }))[0].calls;

    expect(first).toBe(2);
    // If this ever reads 4, the watermark stopped moving with the deltas.
    expect(second).toBe(2);
  });

  it('picks up only new rows on the next run', async () => {
    await seedCalls([{ id: 'c1', ts: '2026-08-14T10:00:00.000Z' }]);
    await runUsageRollup(storage);
    await seedCalls([{ id: 'c2', ts: '2026-08-14T11:00:00.000Z' }]);
    await runUsageRollup(storage);

    const [node] = await storage.queryUsageRollup({ cut: 'call.node', grain: 'day' });
    expect(node.calls).toBe(2);
  });

  it('does not lose the tail of a tied timestamp', async () => {
    // Three rows sharing one timestamp. A cursor that stored only `ts` would either replay them
    // forever or skip two of them, depending on which way the comparison rounded.
    await seedCalls([
      { id: 'a', ts: '2026-08-14T10:00:00.000Z' },
      { id: 'b', ts: '2026-08-14T10:00:00.000Z' },
      { id: 'c', ts: '2026-08-14T10:00:00.000Z' },
    ]);
    await runUsageRollup(storage);
    await runUsageRollup(storage);

    const [node] = await storage.queryUsageRollup({ cut: 'call.node', grain: 'day' });
    expect(node.calls).toBe(3);
  });
});

describe('rebuild', () => {
  it('corrects a window instead of doubling it', async () => {
    await seedCalls([
      { id: 'c1', ts: '2026-08-14T10:00:00.000Z' },
      { id: 'c2', ts: '2026-08-14T10:00:01.000Z' },
    ]);
    await runUsageRollup(storage);

    const { cleared } = await rebuildUsageRollup(storage, { from: '2026-08-14' });
    expect(cleared).toBeGreaterThan(0);

    const [node] = await storage.queryUsageRollup({ cut: 'call.node', grain: 'day' });
    // The point of clearing first: the fold ADDS, so a rebuild without the delete reads 4 here.
    expect(node.calls).toBe(2);
  });

  it('a new cut gets its history from a rebuild', async () => {
    await seedCalls([{ id: 'c1', ts: '2026-08-14T10:00:00.000Z' }]);
    await runUsageRollup(storage);

    // Simulate the "cut added after the fact" case by deleting one cut's rows and rebuilding.
    await storage.clearUsageRollupRange({});
    await rebuildUsageRollup(storage, { from: '2026-08-14' });

    const [node] = await storage.queryUsageRollup({ cut: 'call.node', grain: 'day' });
    expect(node.calls).toBe(1);
  });
});
