/**
 * @file test/unit/content-facts-store.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The content facts shards and text files on a real in-memory SQLite storage: facts
 *   round-trip through their shard, two sources in one shard both survive, a delete removes one,
 *   listing filters and pages, coverage counts, and a text file round-trips.
 * @structure shard keys · round trip · same shard · list and coverage · text
 * @usage cd aimeat && pnpm exec vitest run test/unit/content-facts-store.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig } from '../../src/config.js';
import type { ContentWriter } from '../../src/services/content/classes.js';
import {
  FACT_SHARDS, coverage, deleteFacts, deleteText, getFacts, getText, listFacts, putFacts, putText, shardKeyOf, sourceHash, sourceIdOf,
} from '../../src/services/content/facts-store.js';
import type { ContentFacts, ContentKind } from '../../src/services/content/types.js';

type TestStorage = Storage & { close(): void | Promise<void> };
let storage: TestStorage;
const config = loadConfig().config;

beforeAll(async () => { storage = await createStorage({ provider: 'sqlite', sqlitePath: ':memory:' }) as TestStorage; });
afterAll(async () => { await storage.close(); });

function owner(): { deps: { storage: Storage; config: typeof config }; writer: ContentWriter; ghii: string } {
  const ghii = `cf-${randomUUID().slice(0, 8)}@${config.nodeId}`;
  return { deps: { storage, config }, writer: { principal: ghii, ownerGhii: ghii, scopes: ['memory:write', 'storage:write'], roles: ['owner'] }, ghii };
}

function facts(ghii: string, key: string, kind: ContentKind, updatedAt: string, extra: Partial<ContentFacts> = {}): ContentFacts {
  const source = { kind: 'file' as const, owner: ghii, key };
  return {
    source, sourceId: sourceIdOf(source), stages: { technical: { at: updatedAt, ok: true } }, readFrom: 'sha256:a', updatedAt,
    technical: { kind, mimeType: 'application/octet-stream', size: 1, contentHash: 'sha256:a', ai: { verdict: 'unknown', sources: [], euAiAct: { marked: false, how: [], markMissing: false } } },
    ...extra,
  };
}

/** Two keys whose source ids land in the same shard. */
function sameShardKeys(ghii: string): [string, string] {
  const seen = new Map<string, string>();
  for (let i = 0; ; i++) {
    const key = `docs/f${i}.pdf`;
    const shard = shardKeyOf(sourceIdOf({ kind: 'file', owner: ghii, key }));
    const other = seen.get(shard);
    if (other) return [other, key];
    seen.set(shard, key);
  }
}

describe('ids and shard keys', () => {
  it('are stable and fall in 00..31', () => {
    expect(sourceIdOf({ kind: 'memory', owner: 'a@n', key: 'k.1' })).toBe('memory:a@n:k.1');
    expect(sourceHash('x')).toMatch(/^[0-9a-f]{24}$/);
    const keys = new Set(Array.from({ length: 500 }, (_, i) => shardKeyOf(`file:a@n:${i}`)));
    for (const k of keys) expect(k).toMatch(/^contentclass\.facts\.(0\d|1\d|2\d|3[01])$/);
    expect(keys.size).toBe(FACT_SHARDS);
    expect(shardKeyOf('file:a@n:1')).toBe(shardKeyOf('file:a@n:1'));
  });
});

describe('facts', () => {
  it('round-trip through a shard, and two sources in one shard both survive a delete of neither', async () => {
    const { deps, writer, ghii } = owner();
    const [k1, k2] = sameShardKeys(ghii);
    const a = facts(ghii, k1, 'pdf', '2026-10-20T10:00:00.000Z');
    const b = facts(ghii, k2, 'image', '2026-10-20T11:00:00.000Z');
    await Promise.all([putFacts(deps, writer, a), putFacts(deps, writer, b)]);
    expect(await getFacts(storage, ghii, a.sourceId)).toEqual(a);
    expect(await getFacts(storage, ghii, b.sourceId)).toEqual(b);
    const rec = await storage.getMemory(ghii, shardKeyOf(a.sourceId));
    expect(rec?.visibility).toBe('private');
    expect(Object.keys((rec?.value as { items: object }).items)).toHaveLength(2);
    await deleteFacts(deps, writer, a.sourceId);
    expect(await getFacts(storage, ghii, a.sourceId)).toBeNull();
    expect(await getFacts(storage, ghii, b.sourceId)).toEqual(b);
    const v = (await storage.getMemory(ghii, shardKeyOf(a.sourceId)))?.version;
    await deleteFacts(deps, writer, a.sourceId);
    expect((await storage.getMemory(ghii, shardKeyOf(a.sourceId)))?.version).toBe(v);
  });

  it('refuse a write that would take the shard past its limit', async () => {
    const { deps, writer } = owner();
    const big = facts('x@n', 'big.txt', 'text', '2026-10-20T10:00:00.000Z', { description: { text: 'x'.repeat(950 * 1024), model: 'm', at: 'now' } });
    await expect(putFacts(deps, writer, big)).rejects.toMatchObject({ code: 'SHARD_FULL', status: 507, message: expect.stringContaining('deleteFacts') });
  });
});

describe('listFacts and coverage', () => {
  it('filter by kind and class, page newest first, and count', async () => {
    const { deps, writer, ghii } = owner();
    const items = [
      facts(ghii, 'a.pdf', 'pdf', '2026-10-20T01:00:00.000Z', { classes: [{ id: 'invoice', confidence: 0.9, by: 'model' }], description: { text: 'An invoice', model: 'm', at: 'now' } }),
      facts(ghii, 'b.pdf', 'pdf', '2026-10-20T03:00:00.000Z', { classes: [{ id: 'invoice', confidence: 0.8, by: 'model' }, { id: 'contract', confidence: 0.7, by: 'model' }] }),
      facts(ghii, 'c.jpg', 'image', '2026-10-20T02:00:00.000Z', { readFrom: 'sha256:old' }),
    ];
    for (const f of items) await putFacts(deps, writer, f);
    const pdfs = await listFacts(storage, ghii, { kind: 'pdf' });
    expect(pdfs.items.map((f) => f.source.key)).toEqual(['b.pdf', 'a.pdf']);
    expect((await listFacts(storage, ghii, { classId: 'contract' })).items.map((f) => f.source.key)).toEqual(['b.pdf']);
    expect((await listFacts(storage, ghii, { stale: true })).items.map((f) => f.source.key)).toEqual(['c.jpg']);
    const p1 = await listFacts(storage, ghii, { limit: 2 });
    expect(p1.items.map((f) => f.source.key)).toEqual(['b.pdf', 'c.jpg']);
    expect(p1.total).toBe(3);
    const p2 = await listFacts(storage, ghii, { limit: 2, after: p1.next });
    expect(p2.items.map((f) => f.source.key)).toEqual(['a.pdf']);
    expect(p2.next).toBeUndefined();
    const c = await coverage(storage, ghii);
    expect(c).toEqual({ total: 3, byKind: { pdf: 2, image: 1, video: 0, text: 0, other: 0 }, withDescription: 1, withClasses: 2, byClass: { invoice: 2, contract: 1 } });
  });
});

describe('text files', () => {
  it('round-trip, overwrite and delete', async () => {
    const { deps, writer, ghii } = owner();
    const id = sourceIdOf({ kind: 'file', owner: ghii, key: 'docs/a.pdf' });
    const key = await putText(deps, writer, id, 'Lasku 12,50 € — eräpäivä');
    expect(key).toBe(`contentclass-text/${sourceHash(id)}.txt`);
    expect(await getText(storage, ghii, key)).toBe('Lasku 12,50 € — eräpäivä');
    const file = await storage.getStorageFile(ghii, key);
    expect(file).toMatchObject({ visibility: 'private', mimeType: 'text/plain; charset=utf-8' });
    await putText(deps, writer, id, 'second');
    expect(await getText(storage, ghii, key)).toBe('second');
    expect(await deleteText(deps, ghii, key)).toBe(true);
    expect(await getText(storage, ghii, key)).toBeNull();
    expect(await deleteText(deps, ghii, key)).toBe(false);
  });
});
