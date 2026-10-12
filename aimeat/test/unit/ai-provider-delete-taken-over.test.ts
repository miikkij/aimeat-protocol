/**
 * @file test/unit/ai-provider-delete-taken-over.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Deleting a provider the owner took over from the migration deletes it for good
 *   (services/ai/provider-store.ts deleteOwnerAiProvider). An owner whose old setting was migrated
 *   into the provider `openrouter`, and who then changed it through PUT /v1/ai/providers/openrouter,
 *   holds a provider without the migration's mark while the old records (openrouter.settings and
 *   openrouter.apikey) still describe it. The delete removed the old records only for a provider that
 *   still carried the mark, so the next read migrated them into the same provider again: the deleted
 *   provider came back with the old key, and that key went on paying. Found on node 4.0.0, where the
 *   AI page and the older panel write the connection through the provider routes (2026-10-13).
 * @usage cd aimeat && pnpm exec vitest run test/unit/ai-provider-delete-taken-over.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-13 — Initial (the 4.0.0 sweep: removing the AI connection on the provider routes).
 */
import { describe, it, expect } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig } from '../../src/config.js';
import { providersForOwner, putOwnerAiProvider, deleteOwnerAiProvider } from '../../src/services/ai/provider-store.js';

const GAII = 'alice@node-test';

async function put(storage: Storage, key: string, value: Record<string, unknown>): Promise<void> {
  const now = new Date().toISOString();
  const existing = await storage.getMemory(GAII, key);
  await storage.setMemory({
    key, ownerGaii: GAII, value, visibility: 'private', tags: [], ttlHours: null,
    version: existing ? existing.version + 1 : 1, createdAt: now, updatedAt: now,
  });
}

async function migratedOwner(): Promise<{ storage: Storage; config: ReturnType<typeof loadConfig>['config'] }> {
  const storage = new SqliteStorage(':memory:') as unknown as Storage;
  const config = { ...loadConfig().config, nodeId: 'node-test' };
  await put(storage, 'openrouter.settings', { provider: 'openrouter' });
  await put(storage, 'openrouter.apikey', { encrypted: 'ciphertext-of-a-key' });
  const { owner } = await providersForOwner(storage, config, GAII);
  expect(owner.find((p) => p.id === 'openrouter')?.legacy).toBeTruthy();
  return { storage, config };
}

describe('deleting a provider taken over from the migration', () => {
  it('stays deleted: the old records do not migrate into it again', async () => {
    const { storage, config } = await migratedOwner();
    await putOwnerAiProvider(storage, config, GAII, 'openrouter', {
      title: 'OpenRouter', type: 'openrouter', auth: { type: 'key' },
      capabilities: { text: { enabled: true, pool: true, model: 'openai/gpt-4o-mini' } },
    });
    const { owner: taken } = await providersForOwner(storage, config, GAII);
    expect(taken.find((p) => p.id === 'openrouter')?.legacy).toBeFalsy();

    expect(await deleteOwnerAiProvider(storage, config, GAII, 'openrouter')).toBe(true);
    const { owner } = await providersForOwner(storage, config, GAII);
    expect(owner.map((p) => p.id)).not.toContain('openrouter');
    expect(await storage.getMemory(GAII, 'openrouter.apikey')).toBeNull();
  });

  it('a migrated provider still carrying the mark is deleted as before', async () => {
    const { storage, config } = await migratedOwner();
    expect(await deleteOwnerAiProvider(storage, config, GAII, 'openrouter')).toBe(true);
    const { owner } = await providersForOwner(storage, config, GAII);
    expect(owner.map((p) => p.id)).not.toContain('openrouter');
  });

  it('deleting another provider leaves the old records that describe the migrated one', async () => {
    const { storage, config } = await migratedOwner();
    await putOwnerAiProvider(storage, config, GAII, 'mine', {
      title: 'Mine', type: 'openrouter', auth: { type: 'key' },
      capabilities: { text: { enabled: true, pool: false } },
    });
    expect(await deleteOwnerAiProvider(storage, config, GAII, 'mine')).toBe(true);
    expect(await storage.getMemory(GAII, 'openrouter.apikey')).not.toBeNull();
    const { owner } = await providersForOwner(storage, config, GAII);
    expect(owner.map((p) => p.id)).toContain('openrouter');
  });
});
