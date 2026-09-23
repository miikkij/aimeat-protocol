/**
 * @file test/unit/ai-decisions-storage.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The AI decision store (TARGET-080) against SqliteStorage(':memory:'): all six
 *   repository methods, the owner fence on review, the cache rule (a cached row never serves as a
 *   source), the list cursor and bounds, and the age-out. Postgres mirrors this file's expectations
 *   but is not run here.
 * @version-history
 *   v1.1.0 — 2026-09-23 — Decision providers: the provider columns, their pre-column fallback, the
 *     list filter and the count per provider.
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
    rule: null,
    ruleVersion: null,
    outcome: null,
    keyScope: 'own',
    provider: 'typesafe',
    providerKind: 'hosted',
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

  it('a row keeps its rule, version, outcome and key scope, and the list filters by rule and principal', async () => {
    const row = makeRow({ id: 'r1', createdAt: '2026-09-20T10:00:00.000Z', rule: 'send-reply', ruleVersion: 3, outcome: 'ask', keyScope: 'agent' });
    await storage.createAiDecision(row);
    await storage.createAiDecision(makeRow({ id: 'r2', createdAt: '2026-09-20T10:01:00.000Z', rule: 'other', ruleVersion: 1, outcome: 'act', principal: `codex#${ALICE}` }));
    await storage.createAiDecision(makeRow({ id: 'r3', createdAt: '2026-09-20T10:02:00.000Z' }));
    expect(await storage.getAiDecision('r1')).toEqual(row);

    const byRule = await storage.listAiDecisions({ ownerGhii: ALICE, rule: 'send-reply' });
    expect(byRule.items.map(r => r.id)).toEqual(['r1']);
    expect(byRule.total).toBe(1);
    const byPrincipal = await storage.listAiDecisions({ ownerGhii: ALICE, principal: `codex#${ALICE}` });
    expect(byPrincipal.items.map(r => r.id)).toEqual(['r2']);
  });

  it('aiDecisionStats counts decisions, outcomes, gate stops, reviews and cost per rule and per principal', async () => {
    const at = (m: number) => `2026-09-20T10:0${m}:00.000Z`;
    await storage.createAiDecision(makeRow({ id: 's1', createdAt: at(1), rule: 'send-reply', ruleVersion: 1, outcome: 'act' }));
    const stopped = makeRow({ id: 's2', createdAt: at(2), rule: 'send-reply', ruleVersion: 1, outcome: 'ask' });
    stopped.record.gate = { on: true, stopped: true, task: 't1' };
    await storage.createAiDecision(stopped);
    await storage.createAiDecision(makeRow({ id: 's3', createdAt: at(3), rule: 'send-reply', ruleVersion: 2, outcome: 'stop', principal: `codex#${ALICE}` }));
    await storage.createAiDecision(makeRow({ id: 's4', createdAt: at(4), rule: 'triage', ruleVersion: 1, outcome: 'act' }));
    await storage.createAiDecision(makeRow({ id: 's5', createdAt: at(5) }));
    await storage.createAiDecision(makeRow({ id: 'sb', ownerGhii: BOB, createdAt: at(6), rule: 'send-reply', ruleVersion: 1, outcome: 'act' }));
    await storage.setAiDecisionReview('s1', ALICE, { outcome: 'overridden', by: ALICE, at: at(7) });

    const perRule = await storage.aiDecisionStats({ ownerGhii: ALICE }, 'rule');
    // A decision that named no rule is not a rule's decision; another owner's rows are not counted.
    expect(perRule.map(g => g.key).sort()).toEqual(['send-reply', 'triage']);
    const send = perRule.find(g => g.key === 'send-reply')!;
    expect(send.decisions).toBe(3);
    expect(send.outcomes).toEqual({ act: 1, ask: 1, stop: 1 });
    expect(send.gateStops).toBe(1);
    expect(send.overridden).toBe(1);
    expect(send.confirmed).toBe(0);
    expect(send.costUsd).toBeCloseTo(0.0036, 6);
    expect(send.lastAt).toBe(at(3));

    const codex = await storage.aiDecisionStats({ ownerGhii: ALICE, principal: `codex#${ALICE}` }, 'principal');
    expect(codex).toHaveLength(1);
    expect(codex[0].decisions).toBe(1);
    expect(codex[0].outcomes.stop).toBe(1);

    expect(await storage.aiDecisionStats({ ownerGhii: ALICE, rule: 'nothing-here' }, 'rule')).toEqual([]);
  });

  it('a row keeps its provider; the list filters by it and the counts group by it, an older row as typesafe', async () => {
    const local = makeRow({ id: 'p1', createdAt: '2026-09-23T10:00:00.000Z', provider: 'laya', providerKind: 'local', keyScope: 'none' });
    local.record.usage = { inputTokens: 150, costUsd: 0 };
    await storage.createAiDecision(local);
    await storage.createAiDecision(makeRow({ id: 'p2', createdAt: '2026-09-23T10:01:00.000Z' }));
    // A row written before the provider column existed: the columns are empty, the document says typesafe.
    await storage.createAiDecision(makeRow({ id: 'p3', createdAt: '2026-09-23T10:02:00.000Z' }));
    (storage as unknown as { db: { prepare(s: string): { run(...a: unknown[]): void } } }).db
      .prepare('UPDATE ai_decisions SET provider = NULL, providerKind = NULL WHERE id = ?').run('p3');

    expect(await storage.getAiDecision('p1')).toEqual(local);
    const old = await storage.getAiDecision('p3');
    expect([old?.provider, old?.providerKind]).toEqual(['typesafe', 'hosted']);
    expect((await storage.listAiDecisions({ ownerGhii: ALICE, provider: 'laya' })).items.map(r => r.id)).toEqual(['p1']);
    expect((await storage.listAiDecisions({ ownerGhii: ALICE, provider: 'typesafe' })).total).toBe(2);

    const per = await storage.aiDecisionStats({ ownerGhii: ALICE }, 'provider');
    expect(Object.fromEntries(per.map(g => [g.key, g.decisions]))).toEqual({ laya: 1, typesafe: 2 });
    expect(per.find(g => g.key === 'laya')?.costUsd).toBe(0);
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
