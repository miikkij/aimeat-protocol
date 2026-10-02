/**
 * @file test/unit/openrouter-settings-migration.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one-time clearing of the free router a key-only save wrote as the owner's chat
 *   model (services/openrouter-settings-migration.ts): positive evidence only, once per node, and a
 *   chosen free router stays.
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { migrateImplicitFreeModelOnce, IMPLICIT_FREE_MODEL_KEY } from '../../src/services/openrouter-settings-migration.js';

const NODE = 'node-test';

async function freshStorage(owners: string[]): Promise<Storage> {
  const storage = new SqliteStorage(':memory:') as unknown as Storage;
  const now = new Date().toISOString();
  for (const name of owners) {
    await storage.createOwner({ name, publicKey: 'pk', roles: ['owner'], createdAt: now });
  }
  return storage;
}

async function put(storage: Storage, owner: string, value: Record<string, unknown>): Promise<void> {
  const now = new Date().toISOString();
  await storage.setMemory({
    key: 'openrouter.settings', ownerGaii: `${owner}@${NODE}`, value, visibility: 'private', tags: ['openrouter'],
    ttlHours: null, version: 3, createdAt: now, updatedAt: now,
  });
}

const read = async (storage: Storage, owner: string) => (await storage.getMemory(`${owner}@${NODE}`, 'openrouter.settings'));

describe('migrateImplicitFreeModelOnce', () => {
  it('clears the free router nobody chose, keeps a chosen one and every other model, and runs once', async () => {
    const s = await freshStorage(['implicit', 'chosen', 'other', 'none']);
    await put(s, 'implicit', { model: 'openrouter/free', autoRetry: true, maxRetries: 2, provider: 'openrouter' });
    await put(s, 'chosen', { model: 'openrouter/free', modelChosen: true, provider: 'openrouter' });
    await put(s, 'other', { model: 'openai/gpt-4o-mini', provider: 'openrouter' });

    const first = await migrateImplicitFreeModelOnce(s, NODE);
    expect(first).toEqual({ ran: true, cleared: 1 });

    const implicit = await read(s, 'implicit');
    expect(implicit?.value).toEqual({ autoRetry: true, maxRetries: 2, provider: 'openrouter' });
    expect(implicit?.version).toBe(4);
    expect((await read(s, 'chosen'))?.value).toEqual({ model: 'openrouter/free', modelChosen: true, provider: 'openrouter' });
    expect((await read(s, 'other'))?.value).toEqual({ model: 'openai/gpt-4o-mini', provider: 'openrouter' });
    expect(await read(s, 'none')).toBeNull();

    expect(await s.getMemory(`system@${NODE}`, IMPLICIT_FREE_MODEL_KEY)).not.toBeNull();
    // A record written the old way after the run is not touched again: the read side handles it.
    await put(s, 'none', { model: 'openrouter/free' });
    expect(await migrateImplicitFreeModelOnce(s, NODE)).toEqual({ ran: false, cleared: 0 });
    expect((await read(s, 'none'))?.value).toEqual({ model: 'openrouter/free' });
  });

  it('a node with no owners marks itself done and changes nothing', async () => {
    const s = await freshStorage([]);
    expect(await migrateImplicitFreeModelOnce(s, NODE)).toEqual({ ran: true, cleared: 0 });
  });
});
