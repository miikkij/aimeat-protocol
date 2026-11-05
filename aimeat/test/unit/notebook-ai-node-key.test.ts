/**
 * @file test/unit/notebook-ai-node-key.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The notebook AI features (classify, distribute, plan, tracked triage and fill, the
 *   living author) ask the same question every other AI call asks before they start: can any key pay
 *   for this person (services/ai/completion.ts prepareAiCall). resolveOwnerModel (services/notebook-ai.ts)
 *   refused a person with no key of their own with NO_OPENROUTER_KEY even on a node whose shared key
 *   would pay from their allowance, so chat worked and these six features did not (codebase analysis
 *   2026-11-03, item A10). Usage kept: a person with no key on a node with no shared key gets the same
 *   NO_OPENROUTER_KEY as before; a person with a key of their own keeps the model they chose.
 *   The planner runs for real over an in-memory storage with the model catalogue's seed; no provider
 *   is called.
 * @usage cd aimeat && pnpm exec vitest run test/unit/notebook-ai-node-key.test.ts
 * @version-history
 *   v1.0.0 -- 2026-11-04 -- Initial (codebase analysis 2026-11-03, item A10).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, GHIIRecord } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { loadCatalog } from '../../src/services/ai/catalog/store.js';
import { resolveOwnerModel } from '../../src/services/notebook-ai.js';
import { debitAllowance } from '../../src/services/ai/allowance.js';

const NODE = 'node-notebook';
let n = 0;

async function person(config: AimeatConfig): Promise<{ storage: Storage; gaii: string }> {
  const storage = new SqliteStorage(':memory:') as unknown as Storage;
  const name = `nora${n++}`;
  const gaii = `${name}@${NODE}`;
  const now = new Date().toISOString();
  await storage.createGHII({ username: name, nodeId: NODE, ghii: gaii, displayName: name, verificationLevel: 0, ownerName: name, createdAt: now, updatedAt: now, totpEnabled: false } as GHIIRecord);
  await loadCatalog(storage, config);
  return { storage, gaii };
}

let withNodeKey: AimeatConfig;
let withoutNodeKey: AimeatConfig;
beforeAll(() => {
  const base = loadConfig().config;
  withNodeKey = { ...base, nodeId: NODE, openrouterInstanceKey: 'sk-node-never-sent', chatFreeAllowanceUsd: 1,
    aiNodeKeyWhenSpent: 'refuse', modelFreeFallback: 'openrouter/free', aiRegionMode: '' } as AimeatConfig;
  withoutNodeKey = { ...withNodeKey, openrouterInstanceKey: '' } as AimeatConfig;
});

describe('a person with no AI key of their own', () => {
  it('may start a notebook AI feature when the node\'s shared key pays from their allowance', async () => {
    const { storage, gaii } = await person(withNodeKey);
    const owner = await resolveOwnerModel(storage, withNodeKey, gaii, 'notebook:classify');
    expect(owner).toMatchObject({ gaii, appId: 'notebook:classify' });
    // The plan chooses the model, as it does for chat: no model is named for the call, so a spent
    // allowance falls back to the free model instead of refusing a model the caller "named".
    expect(owner.model).toBeUndefined();
  });

  it('may start one when the allowance is spent, because a call that names no model falls back to the free model', async () => {
    const { storage, gaii } = await person(withNodeKey);
    await debitAllowance(storage, withNodeKey, gaii, 5);
    await expect(resolveOwnerModel(storage, withNodeKey, gaii, 'notebook:plan')).resolves.toMatchObject({ gaii });
  });

  it('usage kept: is refused with NO_OPENROUTER_KEY on a node with no shared key, before any prompt is built', async () => {
    const { storage, gaii } = await person(withoutNodeKey);
    await expect(resolveOwnerModel(storage, withoutNodeKey, gaii, 'notebook:classify')).rejects.toMatchObject({ code: 'NO_OPENROUTER_KEY', status: 400 });
  });
});
