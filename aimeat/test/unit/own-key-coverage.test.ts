/**
 * @file test/unit/own-key-coverage.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an owner's own AI key reaches on this node (services/own-key-coverage.ts): the
 *   coverage per configuration, and whether a key counts as set, including the legacy copy that a
 *   deleted key leaves behind until the next providers read.
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, GHIIRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { ownKeyCoverageOf, hasOwnAiKey, ownKeyCoverage } from '../../src/services/own-key-coverage.js';

const NODE = 'node-test';
const GAII = `alice@${NODE}`;

async function freshStorage(): Promise<Storage> {
  const storage = new SqliteStorage(':memory:');
  const now = new Date().toISOString();
  const ghii: GHIIRecord = {
    username: 'alice', nodeId: NODE, ghii: GAII, displayName: 'alice',
    verificationLevel: 0, ownerName: 'alice', createdAt: now, updatedAt: now, totpEnabled: false,
  };
  await storage.createGHII(ghii);
  return storage as unknown as Storage;
}

async function put(storage: Storage, key: string, value: Record<string, unknown>): Promise<void> {
  const now = new Date().toISOString();
  await storage.setMemory({
    key, ownerGaii: GAII, value, visibility: 'private', tags: [], ttlHours: null,
    version: 1, createdAt: now, updatedAt: now,
  });
}

describe('ownKeyCoverageOf', () => {
  it('on the node route an own key reaches the chat, the node\'s AI calls and agents through the node, never a crew', () => {
    const c = ownKeyCoverageOf({ gooseProviderApiKey: '' }, true);
    expect(c.set).toBe(true);
    expect(c.covers).toEqual(['node_ai', 'agent_calls_via_node', 'chat']);
    expect(c.not_covered).toEqual([{ part: 'agent_runtimes', reason: 'runtime_uses_machine_key' }]);
  });

  it('on the shared chat key the chat is out of reach, with that reason', () => {
    const c = ownKeyCoverageOf({ gooseProviderApiKey: 'sk-shared' }, true);
    expect(c.covers).toEqual(['node_ai', 'agent_calls_via_node']);
    expect(c.not_covered).toEqual([
      { part: 'chat', reason: 'shared_chat_key' },
      { part: 'agent_runtimes', reason: 'runtime_uses_machine_key' },
    ]);
  });

  it('says what a key WOULD reach when none is set, so the page can say it before one is saved', () => {
    const c = ownKeyCoverageOf({ gooseProviderApiKey: '' }, false);
    expect(c.set).toBe(false);
    expect(c.covers).toContain('chat');
  });
});

describe('hasOwnAiKey', () => {
  it('is false with nothing stored', async () => {
    expect(await hasOwnAiKey(await freshStorage(), GAII)).toBe(false);
  });

  it('is true for the legacy OpenRouter key', async () => {
    const s = await freshStorage();
    await put(s, 'openrouter.apikey', { encrypted: 'ciphertext' });
    expect(await hasOwnAiKey(s, GAII)).toBe(true);
  });

  it('is true for a key on one of the owner\'s providers', async () => {
    const s = await freshStorage();
    await put(s, 'ai.apikey.provider.mistral', { encrypted: 'ciphertext', set_at: 'now' });
    expect(await hasOwnAiKey(s, GAII)).toBe(true);
  });

  it('does NOT count the legacy copy alone: a key the owner just deleted reads as not set', async () => {
    // provider-store.ts copies the legacy key to ai.apikey.provider.<id> with legacy:true and removes
    // the copy on the next providers read, so after DELETE /v1/openrouter/settings the copy lingers.
    const s = await freshStorage();
    await put(s, 'ai.apikey.provider.openrouter', { encrypted: 'ciphertext', legacy: true });
    expect(await hasOwnAiKey(s, GAII)).toBe(false);
  });

  it('a record with no ciphertext is not a key', async () => {
    const s = await freshStorage();
    await put(s, 'openrouter.apikey', {});
    expect(await hasOwnAiKey(s, GAII)).toBe(false);
  });
});

describe('ownKeyCoverage', () => {
  it('joins the configuration and the stored key', async () => {
    const s = await freshStorage();
    await put(s, 'openrouter.apikey', { encrypted: 'ciphertext' });
    const c = await ownKeyCoverage(s, { gooseProviderApiKey: 'sk-shared' } as unknown as AimeatConfig, GAII);
    expect(c.set).toBe(true);
    expect(c.not_covered.map((g) => g.part)).toEqual(['chat', 'agent_runtimes']);
  });
});
