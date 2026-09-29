/**
 * @file test/unit/content-labels-storage.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The classification label store (TARGET-082) against SqliteStorage(':memory:'): the
 *   round trip, the batch read (one scope, many keys, duplicates, a list longer than one chunk),
 *   replace-by-address keeping the id, the page cursor, the deletes, and the two erasure paths (an
 *   owner's cascade, an organism's delete). Postgres mirrors these expectations.
 * @version-history
 *   v1.0.0 — 2026-09-29 — TARGET-082 V1. Initial.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { ContentLabelRow } from '../../src/storage/interface.js';

const ALICE = 'alice@test-node';
const BOB = 'bob@test-node';

function row(over: Partial<ContentLabelRow> & { key: string }): ContentLabelRow {
  return {
    id: `id-${over.kind ?? 'memory'}-${over.scope ?? ALICE}-${over.key}`,
    kind: 'memory',
    scope: ALICE,
    ownerGaii: ALICE,
    label: 'sisainen',
    source: 'human',
    locked: true,
    suggestion: null,
    justification: null,
    humanSaid: null,
    history: [{ at: '2026-09-29T10:00:00.000Z', by: ALICE, source: 'human', action: 'set', from: null, to: 'sisainen' }],
    setBy: ALICE,
    updatedAt: '2026-09-29T10:00:00.000Z',
    ...over,
  };
}

describe('content_labels storage (sqlite)', () => {
  let storage: SqliteStorage;
  beforeEach(() => { storage = new SqliteStorage(':memory:'); });
  afterEach(() => { storage.close(); });

  it('putContentLabel + getContentLabel round-trip every field', async () => {
    const r = row({
      key: 'notes.a', label: 'luottamuksellinen', source: 'human-via-ai', humanSaid: 'Merkitse tämä luottamukselliseksi.',
      justification: null, suggestion: { label: 'erittain-luottamuksellinen', by: 'claude#alice@test-node', at: '2026-09-29T11:00:00.000Z', source: 'ai', confidence: 0.9, reason: 'IBAN', why: 'HUMAN_LABEL' },
    });
    await storage.putContentLabel(r);
    expect(await storage.getContentLabel({ kind: 'memory', scope: ALICE, key: 'notes.a' })).toEqual(r);
    expect(await storage.getContentLabel({ kind: 'file', scope: ALICE, key: 'notes.a' })).toBeUndefined();
  });

  it('getContentLabels answers one scope in one call, ignoring duplicates and other scopes', async () => {
    await storage.putContentLabel(row({ key: 'a' }));
    await storage.putContentLabel(row({ key: 'b', label: 'julkinen' }));
    await storage.putContentLabel(row({ key: 'a', scope: BOB, ownerGaii: BOB }));
    const got = await storage.getContentLabels('memory', ALICE, ['a', 'b', 'a', 'missing']);
    expect(got.map(g => g.key).sort()).toEqual(['a', 'b']);
    expect(got.every(g => g.scope === ALICE)).toBe(true);
    expect(await storage.getContentLabels('memory', ALICE, [])).toEqual([]);
  });

  it('getContentLabels reads past one chunk of keys', async () => {
    const keys = Array.from({ length: 1203 }, (_, i) => `k${String(i).padStart(4, '0')}`);
    for (const k of keys.filter((_, i) => i % 100 === 0)) await storage.putContentLabel(row({ key: k }));
    const got = await storage.getContentLabels('memory', ALICE, keys);
    expect(got).toHaveLength(13);
  });

  it('a put on an existing address replaces it and keeps the id; history is capped at 50', async () => {
    await storage.putContentLabel(row({ key: 'x', id: 'first' }));
    const history = Array.from({ length: 60 }, (_, i) => ({ at: `2026-09-29T10:${String(i).padStart(2, '0')}:00.000Z`, by: ALICE, source: 'human' as const, action: 'set' as const, from: null, to: 'julkinen' }));
    await storage.putContentLabel(row({ key: 'x', id: 'second', label: 'julkinen', history }));
    const got = await storage.getContentLabel({ kind: 'memory', scope: ALICE, key: 'x' });
    expect(got?.id).toBe('first');
    expect(got?.label).toBe('julkinen');
    expect(got?.history).toHaveLength(50);
    expect(got?.history[49].at).toBe(history[59].at);
  });

  it('listContentLabels pages one scope in key order', async () => {
    for (const k of ['c', 'a', 'b', 'd']) await storage.putContentLabel(row({ key: k }));
    await storage.putContentLabel(row({ key: 'e', scope: BOB, ownerGaii: BOB }));
    const first = await storage.listContentLabels({ scope: ALICE, limit: 2 });
    expect(first.map(r => r.key)).toEqual(['a', 'b']);
    const next = await storage.listContentLabels({ scope: ALICE, after: 'b', limit: 2 });
    expect(next.map(r => r.key)).toEqual(['c', 'd']);
  });

  it('deleteContentLabel and deleteContentLabelsByScope remove what they name', async () => {
    await storage.putContentLabel(row({ key: 'a' }));
    await storage.putContentLabel(row({ key: 'w1/task/r1', kind: 'row', scope: 'organism:o1', ownerGaii: null }));
    await storage.putContentLabel(row({ key: 'w1/task/r2', kind: 'row', scope: 'organism:o1', ownerGaii: null }));
    expect(await storage.deleteContentLabel({ kind: 'memory', scope: ALICE, key: 'a' })).toBe(true);
    expect(await storage.deleteContentLabel({ kind: 'memory', scope: ALICE, key: 'a' })).toBe(false);
    expect(await storage.deleteContentLabelsByScope('organism:o1')).toBe(2);
  });

  it("an owner's erasure takes the labels on their own content and leaves organism labels", async () => {
    await storage.putContentLabel(row({ key: 'mine' }));
    await storage.putContentLabel(row({ key: 'bobs', scope: BOB, ownerGaii: BOB }));
    await storage.putContentLabel(row({ key: 'organism.o1.w.ws1.x', scope: 'organism:o1', ownerGaii: null, setBy: ALICE }));
    await storage.cascadeDeleteAgentData(ALICE);
    expect(await storage.getContentLabel({ kind: 'memory', scope: ALICE, key: 'mine' })).toBeUndefined();
    expect(await storage.getContentLabel({ kind: 'memory', scope: BOB, key: 'bobs' })).toBeDefined();
    expect(await storage.getContentLabel({ kind: 'memory', scope: 'organism:o1', key: 'organism.o1.w.ws1.x' })).toBeDefined();
  });

  it("an organism's delete takes the labels on its content", async () => {
    await storage.putContentLabel(row({ key: 'organism.o1.w.ws1.x', scope: 'organism:o1', ownerGaii: null }));
    await storage.putContentLabel(row({ key: 'mine' }));
    await storage.deleteOrganism('o1');
    expect(await storage.listContentLabels({ scope: 'organism:o1' })).toEqual([]);
    expect(await storage.getContentLabel({ kind: 'memory', scope: ALICE, key: 'mine' })).toBeDefined();
  });
});
