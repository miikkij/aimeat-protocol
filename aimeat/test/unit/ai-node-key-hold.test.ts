/**
 * @file test/unit/ai-node-key-hold.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A call on the node's shared AI key is priced before it runs and held against what is
 *   left of the person's allowance (services/ai/node-key-hold.ts, services/ai/route-plan.ts;
 *   secaudit2026oct22, node-key-allowance-precheck-unbounded-call-cost). The planner runs for real
 *   over an in-memory storage with the model catalogue's seed; no provider is called.
 * @usage cd aimeat && pnpm exec vitest run test/unit/ai-node-key-hold.test.ts
 * @version-history
 *   2026-10-25 — The free model as the last resort: the node default, the account's rule, and the
 *     order behind the account's own provider (secaudit2026oct22 follow-up).
 *   2026-10-25 — Initial.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, GHIIRecord } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { loadCatalog } from '../../src/services/ai/catalog/store.js';
import { prepareAiCall } from '../../src/services/ai/completion.js';
import { nodeKeyOutputCap, holdNodeKeyCandidates } from '../../src/services/ai/node-key-hold.js';
import { setRouting } from '../../src/services/ai/routing.js';
import { putOwnerAiProvider, setOwnerProviderKey } from '../../src/services/ai/provider-store.js';
import { NODE_OPENROUTER_ID } from '../../src/services/ai/providers.js';

const NODE = 'node-hold';
const EXPENSIVE = 'anthropic/claude-opus-4.1';   // $15 in, $75 out per million tokens in the seed

let n = 0;
async function owner(config: AimeatConfig): Promise<{ storage: Storage; gaii: string }> {
  const storage = new SqliteStorage(':memory:') as unknown as Storage;
  const name = `alice${n++}`;
  const gaii = `${name}@${NODE}`;
  const now = new Date().toISOString();
  await storage.createGHII({ username: name, nodeId: NODE, ghii: gaii, displayName: name, verificationLevel: 0, ownerName: name, createdAt: now, updatedAt: now, totpEnabled: false } as GHIIRecord);
  await loadCatalog(storage, config);
  return { storage, gaii };
}

let base: AimeatConfig;
beforeAll(() => {
  base = { ...loadConfig().config, nodeId: NODE, openrouterInstanceKey: 'sk-node-never-sent', chatFreeAllowanceUsd: 0.05,
    aiNodeKeyWhenSpent: 'refuse', aiNodeKeyMaxOutputTokens: 32000, modelFreeFallback: 'openrouter/free' } as AimeatConfig;
});

describe('the answer\'s length on the node\'s key', () => {
  it('is the caller\'s, at most the operator\'s limit, and the limit when the caller named none; 0 is no limit', () => {
    expect(nodeKeyOutputCap({ aiNodeKeyMaxOutputTokens: 32000 }, 500)).toBe(500);
    expect(nodeKeyOutputCap({ aiNodeKeyMaxOutputTokens: 32000 }, 100000)).toBe(32000);
    expect(nodeKeyOutputCap({ aiNodeKeyMaxOutputTokens: 32000 }, undefined)).toBe(32000);
    expect(nodeKeyOutputCap({ aiNodeKeyMaxOutputTokens: 0 }, undefined)).toBeUndefined();
    expect(nodeKeyOutputCap({ aiNodeKeyMaxOutputTokens: 0 }, 100000)).toBe(100000);
  });
});

describe('a node-key call is priced before it runs', () => {
  it('refuses a named expensive model with a long answer that costs more than is left, with the price and the ways forward', async () => {
    const { storage, gaii } = await owner(base);
    const out = prepareAiCall(storage, base, gaii, { caller: 'owner', model: EXPENSIVE, estimate: { promptTokens: 1000, maxTokens: 100000 } });
    await expect(out).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED', status: 402 });
    await expect(out).rejects.toThrow(/could cost up to about \$/);
  });

  it('lets the same model through with a short answer that fits, and carries the length limit to the call', async () => {
    const { storage, gaii } = await owner(base);
    const plan = await prepareAiCall(storage, base, gaii, { caller: 'owner', model: EXPENSIVE, estimate: { promptTokens: 100, maxTokens: 50 } });
    expect(plan.keyScope).toBe('node');
    const first = plan.candidates[0] as { nodeKey?: { estimateUsd: number; maxTokens?: number } };
    expect(first.nodeKey?.maxTokens).toBe(50);
    expect(first.nodeKey!.estimateUsd).toBeGreaterThan(0);
    expect(first.nodeKey!.estimateUsd).toBeLessThan(0.05);
  });

  it('gives a text call that named no model the free model when an unnamed long answer would cost more than is left', async () => {
    const config = { ...base, modelDefaultChat: EXPENSIVE } as AimeatConfig;
    const { storage, gaii } = await owner(config);
    const plan = await prepareAiCall(storage, config, gaii, { caller: 'owner', estimate: { promptTokens: 1000 } });
    expect(plan.keyScope).toBe('node');
    expect(plan.candidates[0].model).toBe('openrouter/free');
    expect(plan.candidates[0].degradedToFree).toBe(true);
  });

  it('with no limit on the length, a call that names none is priced as before (1,024 tokens) and runs', async () => {
    const config = { ...base, aiNodeKeyMaxOutputTokens: 0, chatFreeAllowanceUsd: 1 } as AimeatConfig;
    const { storage, gaii } = await owner(config);
    const plan = await prepareAiCall(storage, config, gaii, { caller: 'owner', model: EXPENSIVE, estimate: { promptTokens: 100 } });
    expect(plan.candidates[0].model).toBe(EXPENSIVE);
  });
});

describe('the free model is the last resort, and the operator and the account decide whether it is used', () => {
  const unnamedLong = { caller: 'owner' as const, estimate: { promptTokens: 1000 } };
  const rule = (storage: Storage, gaii: string, freeModelLastResort: boolean | null, ids: string[] = []) =>
    setRouting(storage, gaii, { rules: { freeModelLastResort } }, new Set(ids), { kind: 'owner' });

  it('with the node default off, an unnamed call that costs more than is left is refused with the price and where to turn it on', async () => {
    const config = { ...base, modelDefaultChat: EXPENSIVE, aiFreeModelLastResort: false } as AimeatConfig;
    const { storage, gaii } = await owner(config);
    const out = prepareAiCall(storage, config, gaii, unnamedLong);
    await expect(out).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED', status: 402 });
    await expect(out).rejects.toThrow(/could cost up to about \$.*last resort is off for you/);
  });

  it('the account turns it on for itself when the node default is off, and off when the node default is on', async () => {
    const off = { ...base, modelDefaultChat: EXPENSIVE, aiFreeModelLastResort: false } as AimeatConfig;
    const a = await owner(off);
    await rule(a.storage, a.gaii, true);
    expect((await prepareAiCall(a.storage, off, a.gaii, unnamedLong)).candidates[0].model).toBe('openrouter/free');

    const on = { ...base, modelDefaultChat: EXPENSIVE } as AimeatConfig;
    const b = await owner(on);
    await rule(b.storage, b.gaii, false);
    await expect(prepareAiCall(b.storage, on, b.gaii, unnamedLong)).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED' });
    await rule(b.storage, b.gaii, null);
    expect((await prepareAiCall(b.storage, on, b.gaii, unnamedLong)).candidates[0].model).toBe('openrouter/free');
  });

  it('a provider of the account\'s own that answers with the normal model comes before the free model', async () => {
    const config = { ...base, modelDefaultChat: EXPENSIVE, encryptionKey: 'ab'.repeat(32) } as AimeatConfig;
    const { storage, gaii } = await owner(config);
    await putOwnerAiProvider(storage, config, gaii, 'mine', {
      title: 'Mine', type: 'openrouter', auth: { type: 'key' }, capabilities: { text: { enabled: true, pool: false, model: EXPENSIVE } },
    });
    await setOwnerProviderKey(storage, config, gaii, 'mine', 'sk-mine-never-sent');
    await setRouting(storage, gaii, { defaults: { text: [NODE_OPENROUTER_ID, 'mine'] }, rules: { onlyTested: false } },
      new Set([NODE_OPENROUTER_ID, 'mine']), { kind: 'owner' });
    const plan = await prepareAiCall(storage, config, gaii, unnamedLong);
    expect(plan.candidates.map((c) => [c.provider.id, c.model])).toEqual([['mine', EXPENSIVE], [NODE_OPENROUTER_ID, 'openrouter/free']]);
  });

  it('designed use: a call that fits what is left runs on the normal model whatever the setting', async () => {
    const config = { ...base, aiFreeModelLastResort: false, chatFreeAllowanceUsd: 1 } as AimeatConfig;
    const { storage, gaii } = await owner(config);
    const plan = await prepareAiCall(storage, config, gaii, { caller: 'owner', model: EXPENSIVE, estimate: { promptTokens: 100, maxTokens: 50 } });
    expect(plan.candidates[0].model).toBe(EXPENSIVE);
    expect(plan.candidates[0].degradedToFree).toBeFalsy();
  });
});

describe('calls side by side hold their estimates', () => {
  it('a second call that no longer fits beside one in flight is refused, and fits again once the first is settled', async () => {
    const { storage, gaii } = await owner(base);
    // Each call: 100 prompt tokens and 400 answer tokens on the expensive model, about $0.0315; $0.05 is left.
    const plan = () => prepareAiCall(storage, base, gaii, { caller: 'owner', model: EXPENSIVE, estimate: { promptTokens: 100, maxTokens: 400 } });
    // Two calls planned at the same moment: the first to start holds its estimate, the second no longer fits.
    const [a, b] = [await plan(), await plan()];
    const first = holdNodeKeyCandidates(gaii, a.candidates);
    expect(first.candidates.length).toBe(1);
    expect(() => holdNodeKeyCandidates(gaii, b.candidates)).toThrow(/could cost up to about/);
    // A call planned while the first is in flight is refused at once.
    await expect(plan()).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED', status: 402 });
    first.release();
    const third = holdNodeKeyCandidates(gaii, (await plan()).candidates);
    expect(third.candidates.length).toBe(1);
    third.release();
  });
});
