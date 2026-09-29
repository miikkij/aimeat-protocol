/**
 * @file test/unit/design-book-part-door.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A Design Book part is read through the Design Book and through no generic memory
 *   door. An extension's public read refuses it and names the Book's door, the librarian's public
 *   search leaves it out, and the check the generic doors share answers for a part under the node's
 *   own system identity only: a record an owner keeps under the same key is theirs, and it reads.
 * @usage cd aimeat && pnpm exec vitest run test/unit/design-book-part-door.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig } from '../../src/config.js';
import { buildExtensionCtx } from '../../src/services/extension-ctx.js';
import { librarianSearch } from '../../src/services/librarian.js';
import { systemReader } from '../../src/services/classification/reader.js';

const config = loadConfig().config;
const SYSTEM = `system@${config.nodeId}`;
const ALICE = `alice@${config.nodeId}`;
const KEY = 'atelier.book.part.comp-stale';

// A component stored when it passed an older bench: `.wkgrid ~ p` reaches the page beside it.
const STALE_PART = {
  spec: 'aimeat.designbook.part/v1', id: 'comp-stale', kind: 'component', title: 'A week you tick', summary: 'Rows against seven days.',
  body: {
    prefix: 'wkgrid', html: '<div class="wkgrid" role="grid"></div>',
    css: '.wkgrid { color: var(--ak-ink); }\n.wkgrid ~ p { color: var(--ak-accent); }',
    use: 'One .wkgrid-cell button per day with data-day.', judgement: { reach: 'general', why: 'Any app where a person ticks days uses it.' },
  },
  tags: [], status: 'published', proposed_by: ALICE, proposed_by_owner: ALICE,
};

async function store(): Promise<Storage> {
  const storage = new SqliteStorage(':memory:') as unknown as Storage;
  const now = new Date().toISOString();
  const put = (ownerGaii: string, key: string, value: unknown) => storage.setMemory({
    key, ownerGaii, value, visibility: 'public', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
  });
  await put(SYSTEM, KEY, JSON.stringify(STALE_PART));
  // The same key in an owner's own namespace is that owner's record, and a public one reads.
  await put(ALICE, KEY, { note: 'my own wkgrid sketch' });
  await put(ALICE, 'notes.grid', { text: 'a wkgrid of days' });
  return storage;
}

describe('a Design Book part through the generic memory doors', () => {
  it('an extension\'s public read refuses it and names the Book\'s own door', async () => {
    const storage = await store();
    const ctx = buildExtensionCtx({
      config, storage: storage as never, extMemoryOwner: 'ext:reader', extConfig: {}, logPrefix: 'test',
      caller: { gaii: ALICE, owner: 'alice', roles: ['owner'] } as never,
    });
    await expect(ctx.memory.getPublic(SYSTEM, KEY)).rejects.toThrow(/^DESIGN_BOOK_PART: .*GET \/v1\/designbook\/comp-stale/);
    expect(await ctx.memory.getPublic(ALICE, KEY)).toEqual({ note: 'my own wkgrid sketch' });
    expect(await ctx.memory.getPublic(ALICE, 'notes.grid')).toEqual({ text: 'a wkgrid of days' });
  });

  it('the librarian\'s public search leaves it out, and finds everything else that is public', async () => {
    const storage = await store();
    const { hits } = await librarianSearch(storage, config, {
      ownerName: 'bob', fanOutOwner: false, viewerGaii: `bob@${config.nodeId}`, query: 'wkgrid', scope: 'public',
      reader: systemReader({ storage, config }, `bob@${config.nodeId}`),
    });
    const found = hits.map(h => `${h.ownerGaii} ${h.key}`);
    expect(found).not.toContain(`${SYSTEM} ${KEY}`);
    expect(found).toContain(`${ALICE} notes.grid`);
    expect(found).toContain(`${ALICE} ${KEY}`);
    expect(hits.some(h => /wkgrid ~ p/.test(h.snippet))).toBe(false);
  });

  it('the check the generic doors share answers for a part under the node\'s own identity only', async () => {
    const { ownDoorRefusal } = await import('../../src/utils/own-door-keys.js');
    expect(ownDoorRefusal(SYSTEM, KEY, config.nodeId)).toEqual({
      code: 'DESIGN_BOOK_PART', door: '/v1/designbook/comp-stale',
      message: expect.stringMatching(/Design Book part.*GET \/v1\/designbook\/comp-stale.*aimeat_designbook_get/),
    });
    expect(ownDoorRefusal(ALICE, KEY, config.nodeId)).toBeNull();
    expect(ownDoorRefusal(SYSTEM, 'atelier.book.usage.comp-stale', config.nodeId)).toBeNull();
    expect(ownDoorRefusal('system@another-node', KEY, config.nodeId)).toBeNull();
    expect(ownDoorRefusal(SYSTEM, 42, config.nodeId)).toBeNull();
  });
});
