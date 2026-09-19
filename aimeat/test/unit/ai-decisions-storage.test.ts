/**
 * @file test/unit/ai-decisions-storage.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The AI decision store (TARGET-080) against SqliteStorage(':memory:'): all six
 *   repository methods, the owner fence on review, the cache rule (a cached row never serves as a
 *   source), the list cursor and bounds, and the age-out. Postgres mirrors this file's expectations
 *   but is not run here.
 * @version-history
 *   v1.0.0 — 2026-09-19 — TARGET-080. Initial.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { AiDecisionRow } from '../../src/storage/interface.js';

const ALICE = 'alice@test-node';
const BOB = 'bob@test-node';

function makeRow(over: Partial<AiDecisionRow> & { id: string; createdAt: string }, cachedFrom?: string): AiDecisionRow {
  const ownerGhii = over.ownerGhii ?? ALICE;
  return {
    ownerGhii,
    principal: `claude#${ownerGhii}`,
    appId: null,
    subject: 'user:alice/lead-42',
    cacheKey: 'ck-1',
    model: 'jev-2026-09-01',
    ...over,
    record: {
      spec: 'aimeat.decision/v1',
      model: 'jev-2026-09-01',
      provider: 'typesafe',
      questions: {
        topic: { type: 'choice', instructions: 'Which topic?', criteria: { billing: null, sales: 'a buyer' } },
        urgent: { type: 'noul', instructions: 'Is it urgent?' },
      },
      answers: {
        topic: { type: 'choice', value: 'sales', probabilities: { billing: 0.1, sales: 0.9 }, confidence: 0.9 },
        urgent: { type: 'noul', value: 0.72 },
      },
      thresholds: { urgent: 0.6 },
      gates: 'send the lead to the sales queue',
      subject: over.subject ?? 'user:alice/lead-42',
      stateHash: 'sha256:' + 'a'.repeat(64),
      scrub: { removed: { email: 1, person: 2 }, total: 3 },
      usage: { inputTokens: 812, costUsd: 0.0012 },
      requestId: 'req_1',
      keyScope: 'own',
      ...(cachedFrom ? { cachedFrom } : {}),
    },
  };
}

describe('ai_decisions storage (sqlite)', () => {
  let storage: SqliteStorage;
  beforeEach(() => { storage = new SqliteStorage(':memory:'); });
  afterEach(() => { storage.close(); });

  it('createAiDecision + getAiDecision round-trip the row and the document', async () => {
    const row = makeRow({ id: 'd1', createdAt: '2026-09-19T10:00:00.000Z', appId: 'app-cadence' });
    await storage.createAiDecision(row);
    expect(await storage.getAiDecision('d1')).toEqual(row);
    expect(await storage.getAiDecision('nope')).toBeUndefined();
  });

  it('findCachedAiDecision returns the newest fresh non-cached row for the owner and key', async () => {
    await storage.createAiDecision(makeRow({ id: 'old', createdAt: '2026-09-19T08:00:00.000Z' }));
    await storage.createAiDecision(makeRow({ id: 'real', createdAt: '2026-09-19T10:00:00.000Z' }));
    // Newer, but itself a cache hit: must not be returned as a source.
    await storage.createAiDecision(makeRow({ id: 'hit', createdAt: '2026-09-19T11:00:00.000Z' }, 'real'));
    // Same key, other owner.
    await storage.createAiDecision(makeRow({ id: 'bob', ownerGhii: BOB, createdAt: '2026-09-19T12:00:00.000Z' }));
    // Other key.
    await storage.createAiDecision(makeRow({ id: 'k2', cacheKey: 'ck-2', createdAt: '2026-09-19T12:00:00.000Z' }));

    expect((await storage.findCachedAiDecision(ALICE, 'ck-1', '2026-09-19T09:00:00.000Z'))?.id).toBe('real');
    // `since` is inclusive.
    expect((await storage.findCachedAiDecision(ALICE, 'ck-1', '2026-09-19T10:00:00.000Z'))?.id).toBe('real');
    expect(await storage.findCachedAiDecision(ALICE, 'ck-1', '2026-09-19T10:00:00.001Z')).toBeUndefined();
    expect((await storage.findCachedAiDecision(BOB, 'ck-1', '2026-09-19T00:00:00.000Z'))?.id).toBe('bob');
    expect(await storage.findCachedAiDecision(BOB, 'ck-2', '2026-09-19T00:00:00.000Z')).toBeUndefined();
  });

  it('listAiDecisions: owner-fenced, newest first, filters, cursor, bounds, total', async () => {
    for (let i = 0; i < 5; i++) {
      await storage.createAiDecision(makeRow({
        id: `a${i}`, createdAt: `2026-09-19T10:0${i}:00.000Z`,
        subject: i % 2 === 0 ? 'even' : 'odd', appId: i < 2 ? 'app-x' : null,
      }));
    }
    await storage.createAiDecision(makeRow({ id: 'b0', ownerGhii: BOB, createdAt: '2026-09-19T10:09:00.000Z' }));

    const all = await storage.listAiDecisions({ ownerGhii: ALICE });
    expect(all.total).toBe(5);
    expect(all.items.map((r) => r.id)).toEqual(['a4', 'a3', 'a2', 'a1', 'a0']);

    const even = await storage.listAiDecisions({ ownerGhii: ALICE, subject: 'even' });
    expect(even.items.map((r) => r.id)).toEqual(['a4', 'a2', 'a0']);
    expect(even.total).toBe(3);

    const app = await storage.listAiDecisions({ ownerGhii: ALICE, appId: 'app-x' });
    expect(app.items.map((r) => r.id)).toEqual(['a1', 'a0']);

    const page1 = await storage.listAiDecisions({ ownerGhii: ALICE, limit: 2 });
    expect(page1.items.map((r) => r.id)).toEqual(['a4', 'a3']);
    const page2 = await storage.listAiDecisions({ ownerGhii: ALICE, limit: 2, before: page1.items[1].createdAt });
    expect(page2.items.map((r) => r.id)).toEqual(['a2', 'a1']);
    // The total counts the whole filtered population, not what is left after the cursor.
    expect(page2.total).toBe(5);

    // limit is clamped to at least 1.
    expect((await storage.listAiDecisions({ ownerGhii: ALICE, limit: 0 })).items).toHaveLength(1);
  });

  it('listAiDecisions caps the page at 200 and defaults to 50', async () => {
    for (let i = 0; i < 205; i++) {
      await storage.createAiDecision(makeRow({ id: `r${i}`, createdAt: new Date(Date.UTC(2026, 8, 19, 0, 0, i)).toISOString() }));
    }
    expect((await storage.listAiDecisions({ ownerGhii: ALICE })).items).toHaveLength(50);
    const big = await storage.listAiDecisions({ ownerGhii: ALICE, limit: 1000 });
    expect(big.items).toHaveLength(200);
    expect(big.total).toBe(205);
  });

  it('setAiDecisionReview writes record.review only, and only for the owner', async () => {
    const row = makeRow({ id: 'd1', createdAt: '2026-09-19T10:00:00.000Z' });
    await storage.createAiDecision(row);
    const review = { outcome: 'overridden' as const, by: ALICE, at: '2026-09-19T12:00:00.000Z', note: 'it was billing', override: { topic: 'billing' } };

    expect(await storage.setAiDecisionReview('d1', BOB, review)).toBe(false);
    expect((await storage.getAiDecision('d1'))?.record.review).toBeUndefined();
    expect(await storage.setAiDecisionReview('missing', ALICE, review)).toBe(false);

    expect(await storage.setAiDecisionReview('d1', ALICE, review)).toBe(true);
    const after = await storage.getAiDecision('d1');
    expect(after?.record.review).toEqual(review);
    // Everything else is unchanged.
    expect({ ...after, record: { ...after!.record, review: undefined } }).toEqual({ ...row, record: { ...row.record, review: undefined } });

    // A second review replaces the first.
    const confirm = { outcome: 'confirmed' as const, by: ALICE, at: '2026-09-19T13:00:00.000Z' };
    expect(await storage.setAiDecisionReview('d1', ALICE, confirm)).toBe(true);
    expect((await storage.getAiDecision('d1'))?.record.review).toEqual(confirm);
  });

  it('deleteAiDecisionsBefore removes rows older than the cut across owners and returns the count', async () => {
    await storage.createAiDecision(makeRow({ id: 'a-old', createdAt: '2026-06-01T00:00:00.000Z' }));
    await storage.createAiDecision(makeRow({ id: 'b-old', ownerGhii: BOB, createdAt: '2026-06-02T00:00:00.000Z' }));
    await storage.createAiDecision(makeRow({ id: 'edge', createdAt: '2026-07-01T00:00:00.000Z' }));
    await storage.createAiDecision(makeRow({ id: 'new', createdAt: '2026-09-19T00:00:00.000Z' }));

    expect(await storage.deleteAiDecisionsBefore('2026-07-01T00:00:00.000Z')).toBe(2);
    expect(await storage.getAiDecision('a-old')).toBeUndefined();
    expect(await storage.getAiDecision('b-old')).toBeUndefined();
    expect(await storage.getAiDecision('edge')).toBeDefined();
    expect(await storage.getAiDecision('new')).toBeDefined();
    expect(await storage.deleteAiDecisionsBefore('2026-07-01T00:00:00.000Z')).toBe(0);
  });
});
