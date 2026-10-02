/**
 * @file test/unit/route-run-no-credit.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A spent own key gets the free router once (services/ai/route-run.ts noCreditRetry):
 *   a 402 from OpenRouter on the owner's or the agent's key is retried on the same provider with
 *   the free model, marked degradedToFree; the node's key, another provider type, a call already on
 *   the free model and any other status are not. Ruled by Jouni on 2026-10-02: an own key uses the
 *   node's default model, and a free model only when the key has no money left.
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { noCreditRetry, runRoute } from '../../src/services/ai/route-run.js';
import type { AiCandidate } from '../../src/services/ai/route-plan.js';
import type { Storage } from '../../src/storage/interface.js';
import { DEFAULT_RULES } from '../../src/services/ai/routing.js';

const FREE = 'openrouter/free';

function candidate(over: Partial<AiCandidate> & { type?: string } = {}): AiCandidate {
  const { type = 'openrouter', ...rest } = over;
  return {
    provider: { id: 'openrouter', title: 'OpenRouter', type, source: 'owner', baseUrl: 'https://openrouter.ai/api/v1', auth: { type: 'key' }, leaves: true, dataStatement: '', capabilities: {}, health: { byCapability: {} } } as unknown as AiCandidate['provider'],
    model: 'deepseek/deepseek-chat', target: { baseUrl: 'https://openrouter.ai/api/v1', key: 'sk-own' } as unknown as AiCandidate['target'],
    keyScope: 'own', chosenBy: 'node-default', policyChoseModel: false,
    ...rest,
  };
}

const spent = Object.assign(new Error('Provider 402: Insufficient credits'), { status: 402 });

describe('noCreditRetry', () => {
  it('retries a 402 on the owner\'s or the agent\'s OpenRouter key on the free router, marked degraded', () => {
    const own = noCreditRetry({ noCreditModel: FREE }, candidate(), spent);
    expect(own).toMatchObject({ model: FREE, degradedToFree: true, policyChoseModel: false, keyScope: 'own' });
    expect(noCreditRetry({ noCreditModel: FREE }, candidate({ keyScope: 'agent' }), spent)?.model).toBe(FREE);
  });

  it('does not retry the node\'s key, another provider type, a call already on the free router, another status, or a call that may not use the free model', () => {
    expect(noCreditRetry({ noCreditModel: FREE }, candidate({ keyScope: 'node' }), spent)).toBeNull();
    expect(noCreditRetry({ noCreditModel: FREE }, candidate({ type: 'openai-compatible' }), spent)).toBeNull();
    expect(noCreditRetry({ noCreditModel: FREE }, candidate({ model: FREE }), spent)).toBeNull();
    expect(noCreditRetry({ noCreditModel: FREE }, candidate(), Object.assign(new Error('x'), { status: 429 }))).toBeNull();
    expect(noCreditRetry({}, candidate(), spent)).toBeNull();
  });
});

describe('runRoute with a spent key', () => {
  const ctx = (c: AiCandidate, noCreditModel?: string) => ({
    storage: {} as Storage, gaii: 'alice@node', capability: 'text' as const, candidates: [c], chosenBy: 'node-default' as const,
    allowFallback: false, rules: { ...DEFAULT_RULES }, ...(noCreditModel ? { noCreditModel } : {}),
  });

  it('answers on the free router after the 402, and the route says both attempts', async () => {
    const tried: string[] = [];
    const out = await runRoute(ctx(candidate(), FREE), async (c) => {
      tried.push(c.model);
      if (c.model !== FREE) throw spent;
      return 'answer';
    });
    expect(tried).toEqual(['deepseek/deepseek-chat', FREE]);
    expect(out.result).toBe('answer');
    expect(out.candidate.model).toBe(FREE);
    expect(out.candidate.degradedToFree).toBe(true);
    expect(out.route.attempts.map((a) => [a.model, a.ok ?? a.error])).toEqual([['deepseek/deepseek-chat', 'bad_request'], [FREE, true]]);
    expect(out.route.fellBack).toBe(true);
  });

  it('without the free model the 402 is the answer, as before', async () => {
    await expect(runRoute(ctx(candidate()), async () => { throw spent; })).rejects.toMatchObject({ status: 402 });
  });
});
