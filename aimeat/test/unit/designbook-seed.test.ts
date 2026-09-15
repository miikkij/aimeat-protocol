/**
 * @file designbook-seed.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Server-less tests for the Design Book's boot seed when the registry changes.
 *
 *   The leiskat were rewritten on 2026-09-05, and every node that had seeded them before kept the
 *   old, mostly bare layouts, because the seed wrote only to an empty address. A seeded part now
 *   follows its registry entry, keeping the status the operator gave it; a retired part is left.
 * @usage cd aimeat && pnpm vitest run test/unit/designbook-seed.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-15 — initial: follow the registry, keep the status, leave a retired part,
 *     write nothing on an unchanged boot.
 */
import { describe, it, expect } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { seedDesignBook } from '../../src/services/design-book/lifecycle.js';
import { DesignBookService, partKey } from '../../src/services/design-book/service.js';
import { UI_LAYOUT_PRESETS } from '../../src/services/app-ui/layouts.js';
import { stableStringify } from '../../src/utils/stable-json.js';

const config = { nodeId: 'aimeat-test-001-dev', baseUrl: 'http://localhost', aiProvenance: false } as unknown as AimeatConfig;
const SYSTEM = `system@${config.nodeId}`;
const PRESET = UI_LAYOUT_PRESETS[0]!;
const ID = `leiska-${PRESET.id}`;

async function seededBook(): Promise<{ storage: Storage; book: DesignBookService }> {
  const storage = new SqliteStorage(':memory:') as unknown as Storage;
  await seedDesignBook(storage, config);
  return { storage, book: new DesignBookService(storage, config) };
}

/** Make the stored part what an earlier registry seeded: the same address, an older body. */
async function makeStale(storage: Storage, id: string): Promise<void> {
  const record = (await storage.getMemory(SYSTEM, partKey(id)))!;
  const part = JSON.parse(record.value as string) as { body: Record<string, unknown> };
  part.body = { ...part.body, note: 'the layout before 2026-09-05' };
  await storage.setMemory({ ...record, value: JSON.stringify(part), version: record.version + 1 });
}

describe('Design Book seed when the registry changes', () => {
  it('brings a seeded part up to the registry, and keeps the status the operator gave it', async () => {
    const { storage, book } = await seededBook();
    await book.setStatus(SYSTEM, true, ID, 'aging');
    await makeStale(storage, ID);

    await seedDesignBook(storage, config);

    // The bench normalises a body, so the reference is a fresh node's copy, not the raw preset.
    const fresh = await seededBook();
    const { part } = await book.get(ID);
    expect(part.body.note).toBeUndefined();
    expect(stableStringify(part.body)).toBe(stableStringify((await fresh.book.get(ID)).part.body));
    expect(part.status).toBe('aging');
  });

  it('leaves a retired part exactly as it is', async () => {
    const { storage, book } = await seededBook();
    await book.setStatus(SYSTEM, true, ID, 'retired');
    await makeStale(storage, ID);
    const before = await book.getRecordVersion(ID);

    await seedDesignBook(storage, config);

    expect(await book.getRecordVersion(ID)).toBe(before);
    expect((await book.get(ID)).part.body.note).toBe('the layout before 2026-09-05');
  });

  it('writes nothing on a boot where the registry has not changed', async () => {
    const { storage, book } = await seededBook();
    const before = await book.getRecordVersion(ID);
    await seedDesignBook(storage, config);
    expect(await book.getRecordVersion(ID)).toBe(before);
  });
});
