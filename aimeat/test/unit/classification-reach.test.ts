/**
 * @file test/unit/classification-reach.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The gate that keeps stored content from reaching a caller around the classification
 *   check (scripts/check-classification-reach.ts), and the check component in V1 (reader.ts): what
 *   the gate counts and what it ignores, a new, grown and stale read each refused, and the three
 *   operations passing everything through without reading storage.
 * @version-history
 *   v1.1.0 — 2026-09-29 — V4: "reads nothing" holds with the switch off; the decisions are tested in
 *     classification-reader.test.ts.
 *   v1.0.0 — 2026-09-29 — TARGET-082 V1. Initial.
 */
import { describe, it, expect, vi } from 'vitest';
import { findingsOf, compare } from '../../scripts/check-classification-reach.js';
import { readerFor, readerForAgent, systemReader } from '../../src/services/classification/reader.js';
import { memoryTarget } from '../../src/services/classification/labels.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';

describe('check:classification-reach', () => {
  it('counts content reads on a storage receiver and the owner-scope wrappers, and nothing else', () => {
    const src = `
      async function f(storage, deps, memoryDb) {
        await storage.getMemory(a, b);
        await deps.storage.listAllMemory({});
        await this.storage.getStorageFile(a, b);
        await getOwnerScopeMemory(storage, n, o, k);
        await memoryDb.listOwnerScope(o, {});
        await storage.setMemory(r);            // a write, not a read
        await other.getMemory(a, b);           // not storage
        const s = 'storage.getMemory(x)';      // a string
        // storage.listMemory(x) in a comment
      }`;
    expect(findingsOf('x.ts', src)).toEqual({
      getMemory: 1, listAllMemory: 1, getStorageFile: 1, getOwnerScopeMemory: 1, 'memoryDb.listOwnerScope': 1,
    });
  });

  it('refuses a new file, a grown count and a stale line', () => {
    const listed = {
      'src/a.ts': { reads: { getMemory: 1 }, why: 'x' },
      'src/b.ts': { reads: { listMemory: 2 }, why: 'x' },
      'src/gone.ts': { reads: { getMemory: 1 }, why: 'x' },
    };
    const found = { 'src/a.ts': { getMemory: 2 }, 'src/b.ts': { listMemory: 1 }, 'src/new.ts': { searchText: 1 } };
    const p = compare(found, listed);
    expect(p.added).toEqual(['src/new.ts: {"searchText":1}']);
    expect(p.grew).toEqual(['src/a.ts: getMemory 1 → 2']);
    expect(p.stale).toEqual(['src/b.ts: listMemory 2 → 1', 'src/gone.ts: no content read any more']);
    expect(compare({ 'src/a.ts': { getMemory: 1 } }, { 'src/a.ts': { reads: { getMemory: 1 }, why: 'x' } }))
      .toEqual({ added: [], grew: [], stale: [] });
  });
});

describe('the check component with the switch off', () => {
  const items = [{ ownerGaii: 'alice@n', key: 'a' }, { ownerGaii: 'alice@n', key: 'b' }];
  const target = (r: { ownerGaii: string; key: string }) => memoryTarget(r.ownerGaii, r.key);

  // V1 held this for every switch position, because nothing was decided yet. From V4 the check reads
  // labels where the switch is on (classification-reader.test.ts); off still reads nothing at all.
  for (const mode of ['off'] as const) {
    it(`passes everything through and reads nothing, switch ${mode}`, async () => {
      const storage = new SqliteStorage(':memory:');
      const spies = [
        vi.spyOn(storage, 'getMemory'), vi.spyOn(storage, 'getContentLabels'), vi.spyOn(storage, 'getContentLabel'),
        vi.spyOn(storage, 'getMembership'),
      ];
      const deps = { storage, config: { classificationMode: mode, nodeId: 'n' } };
      for (const reader of [
        readerFor(deps, { sub: 'alice', owner: 'alice', roles: ['owner'] }),
        readerForAgent(deps, 'claude#alice@n'),
        systemReader(deps, 'alice@n'),
        readerFor(deps, null),
      ]) {
        expect(await reader.show(items, target)).toEqual(items);
        await expect(reader.useForAi(items.map(target), { capability: 'text' })).resolves.toBeUndefined();
        expect(await reader.leave(items, target, { kind: 'export', organismId: 'o1' })).toEqual({ kept: items, left: [] });
      }
      for (const s of spies) expect(s).not.toHaveBeenCalled();
      storage.close();
    });
  }

  it('names the reader from the credential', () => {
    const deps = { storage: {} as never, config: { classificationMode: 'off' as const, nodeId: 'n' } };
    expect(readerFor(deps, { sub: 'alice', owner: 'alice', roles: ['owner'] })).toMatchObject({ kind: 'human', identity: 'alice@n' });
    expect(readerFor(deps, { sub: 'claude#alice@n', owner: 'alice', roles: ['agent'] })).toMatchObject({ kind: 'ai', identity: 'claude#alice@n' });
    expect(readerFor(deps, undefined)).toMatchObject({ kind: 'anonymous', identity: '' });
    expect(readerForAgent(deps, 'claude#alice@n')).toMatchObject({ kind: 'ai', auth: { owner: 'alice', roles: ['agent'] } });
    expect(systemReader(deps, 'alice@n')).toMatchObject({ kind: 'system', auth: null });
  });
});
