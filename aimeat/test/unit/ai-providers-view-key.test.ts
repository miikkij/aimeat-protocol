/**
 * @file test/unit/ai-providers-view-key.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET /v1/ai/providers says the migrated provider has its key on the FIRST read after the
 *   legacy setting gained one (services/ai/provider-store.ts aiProvidersView). The view read the set
 *   of key records in parallel with the migration that writes the key's copy, so the first read
 *   answered `has_key: false` for a key that was there, and only a reload said true. The AI page reads
 *   the owner's connection from this view since node 4.0.0 removed GET /v1/openrouter/settings, so
 *   the page said "no key" once to every owner whose old setting was migrated on that load.
 * @usage cd aimeat && pnpm exec vitest run test/unit/ai-providers-view-key.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-12 — Initial (the 4.0.0 sweep: the AI page on the provider routes).
 */
import { describe, it, expect } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig } from '../../src/config.js';
import { aiProvidersView } from '../../src/services/ai/provider-store.js';

const GAII = 'alice@node-test';

async function put(storage: Storage, key: string, value: Record<string, unknown>): Promise<void> {
  const now = new Date().toISOString();
  const existing = await storage.getMemory(GAII, key);
  await storage.setMemory({
    key, ownerGaii: GAII, value, visibility: 'private', tags: [], ttlHours: null,
    version: existing ? existing.version + 1 : 1, createdAt: now, updatedAt: now,
  });
}

describe('the providers view and the key of a migrated provider', () => {
  it('says has_key on the first read after the legacy setting gained a key', async () => {
    const storage = new SqliteStorage(':memory:') as unknown as Storage;
    const config = { ...loadConfig().config, nodeId: 'node-test' };
    await put(storage, 'openrouter.settings', { provider: 'openrouter', model: 'openai/gpt-4o-mini' });
    await put(storage, 'openrouter.apikey', { encrypted: 'ciphertext-of-a-key' });
    const first = await aiProvidersView(storage, config, GAII);
    const p = first.providers.find((x) => x.id === 'openrouter') as { auth?: { has_key?: boolean }; migrated_from?: string } | undefined;
    expect(p?.migrated_from).toBe('openrouter.settings');
    expect(p?.auth?.has_key).toBe(true);
  });
});
